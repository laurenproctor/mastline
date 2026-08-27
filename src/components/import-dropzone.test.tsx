import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A card dump is many files, not one.
 *
 * The import queue is the only place in the product where losing a file is
 * silent: an original that never reaches storage leaves no record saying it was
 * meant to. So these tests are about counting -- every file chosen is a file
 * registered, including files chosen while an earlier batch is still running.
 */

const registered: string[] = [];
const finished: string[] = [];
const failing = new Set<string>();
let releaseRegister: (() => void) | null = null;

vi.mock("@/app/[workspace]/shoots/actions", () => ({
  prepareUploadAction: vi.fn(async (_workspaceSlug: string, token: string) => ({ stagingKey: `org/_staging/${token}` })),
  registerImportAction: vi.fn(async (_workspaceSlug: string, input: { filename: string }) => {
    // Held open on demand so a second selection can arrive mid-flight.
    if (releaseRegister) {
      await new Promise<void>((resolve) => {
        const previous = releaseRegister;
        releaseRegister = () => {
          previous?.();
          resolve();
        };
      });
    }
    if (failing.has(input.filename)) {
      return { ok: false, filename: input.filename, error: "Storage refused it" };
    }
    registered.push(input.filename);
    return { ok: true, assetId: `asset-${registered.length}`, filename: input.filename };
  }),
  registerPreviewAction: vi.fn(async (_workspaceSlug: string, ) => ({ ok: true })),
  finishImportAction: vi.fn(async (_workspaceSlug: string, shootId: string) => {
    finished.push(shootId);
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ upload: async () => ({ error: null }) }),
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

// The browser bits the real helpers need are not in jsdom. Hashing and preview
// generation are covered by src/lib/upload.test.ts; here they are noise.
vi.mock("@/lib/upload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/upload")>("@/lib/upload");
  return {
    ...actual,
    hashFile: async () => "a".repeat(64),
    readDimensions: async () => null,
    makePreview: async () => null,
    uploadToken: () => Math.random().toString(16).slice(2),
  };
});

const { ImportDropzone } = await import("./import-dropzone");

const jpeg = (name: string) => new File(["bytes"], name, { type: "image/jpeg" });

beforeEach(() => {
  registered.length = 0;
  finished.length = 0;
  failing.clear();
  releaseRegister = null;
});

describe("choosing several files at once", () => {
  it("registers every file, not just the first", async () => {
    const user = userEvent.setup();
    render(<ImportDropzone shootId="shoot-1" workspaceSlug="marcus-hale-studio" />);

    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    await user.upload(input, [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg"), jpeg("d.jpg")]);

    await waitFor(() => expect(registered).toHaveLength(4));
    expect(registered.sort()).toEqual(["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
  });

  it("lists every chosen file so the count is visible before it finishes", async () => {
    const user = userEvent.setup();
    render(<ImportDropzone shootId="shoot-1" workspaceSlug="marcus-hale-studio" />);

    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    await user.upload(input, [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]);

    for (const name of ["a.jpg", "b.jpg", "c.jpg"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByText(/3 imported/)).toBeInTheDocument());
  });

  it("advances the shoot once for the batch, not once per file", async () => {
    const user = userEvent.setup();
    render(<ImportDropzone shootId="shoot-1" workspaceSlug="marcus-hale-studio" />);

    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    await user.upload(input, [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]);

    await waitFor(() => expect(registered).toHaveLength(3));
    await waitFor(() => expect(finished).toEqual(["shoot-1"]));
  });

  it("clears the control so the same file can be chosen again", async () => {
    const user = userEvent.setup();
    render(<ImportDropzone shootId="shoot-1" workspaceSlug="marcus-hale-studio" />);

    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    await user.upload(input, [jpeg("a.jpg")]);

    await waitFor(() => expect(registered).toHaveLength(1));
    expect(input.value).toBe("");
  });
});

describe("choosing more files while a batch is still running", () => {
  it("queues them instead of dropping them on the floor", async () => {
    const user = userEvent.setup();
    render(<ImportDropzone shootId="shoot-1" workspaceSlug="marcus-hale-studio" />);

    // Hold the first batch open so the second selection lands mid-flight,
    // which is exactly when the earlier version silently discarded it.
    let release: (() => void) | undefined;
    releaseRegister = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    releaseRegister = () => void release?.();

    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    await user.upload(input, [jpeg("first.jpg")]);
    await user.upload(input, [jpeg("second.jpg"), jpeg("third.jpg")]);

    expect(screen.getByText("second.jpg")).toBeInTheDocument();
    expect(screen.getByText("third.jpg")).toBeInTheDocument();

    releaseRegister?.();
    await held;
    releaseRegister = null;

    await waitFor(() => expect(registered).toHaveLength(3));
    expect(registered.sort()).toEqual(["first.jpg", "second.jpg", "third.jpg"]);
  });
});

describe("when one file fails", () => {
  it("keeps going and reports the failure alongside what landed", async () => {
    // Keyed on the filename rather than call order: the files run
    // concurrently, so "the first call" is not a fixed file.
    failing.add("broken.jpg");

    const user = userEvent.setup();
    render(<ImportDropzone shootId="shoot-1" workspaceSlug="marcus-hale-studio" />);

    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    await user.upload(input, [jpeg("broken.jpg"), jpeg("fine.jpg"), jpeg("also-fine.jpg")]);

    await waitFor(() => expect(screen.getByText("2 imported · 1 failed")).toBeInTheDocument());
    expect(screen.getByText("Storage refused it")).toBeInTheDocument();
    expect(registered.sort()).toEqual(["also-fine.jpg", "fine.jpg"]);
  });
});
