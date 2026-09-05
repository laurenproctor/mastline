import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueueStore } from "@/lib/import-queue/memory-store";
import { ImportQueue } from "@/lib/import-queue/queue";
import { ImportQueueRunner } from "@/lib/import-queue/runner";
import {
  FakeCoordinator,
  FakeImportServer,
  FakeStorageCapacity,
  FakeUploadTransport,
  MemoryStagingArea,
} from "@/lib/import-queue/testing";
import type { ImportSession } from "@/lib/import-queue/session";
import type { QueueSnapshot } from "@/lib/import-queue/runner";

/**
 * The import control, over a real queue and a real runner with fake bytes.
 *
 * A card dump is many files, not one, and the one place in this product where
 * losing a file would be silent. So these are about counting -- every file
 * chosen is a file queued, and every file queued becomes an asset -- and about
 * the row a photographer has to act on when one of them does not.
 */

const ORG = "aaaaaaaa-0000-0000-0000-000000000001";

const finished: string[] = [];

vi.mock("@/app/[workspace]/shoots/actions", () => ({
  finishImportAction: vi.fn(async (_workspaceSlug: string, shootId: string) => {
    finished.push(shootId);
  }),
  registerPreviewAction: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

// The browser bits the real helpers need are not in jsdom, and hashing is
// covered by src/lib/upload.test.ts.
vi.mock("@/lib/upload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/upload")>("@/lib/upload");
  return { ...actual, hashFile: async () => "a".repeat(64), makePreview: async () => null };
});

interface TestSession extends ImportSession {
  readonly server: FakeImportServer;
  readonly transport: FakeUploadTransport;
  readonly staging: MemoryStagingArea;
}

let current: TestSession;

function buildSession(): TestSession {
  const server = new FakeImportServer(ORG);
  const staging = new MemoryStagingArea();
  const transport = new FakeUploadTransport(server);
  const coordinator = new FakeCoordinator("tab-a");

  let counter = 0;
  const queue = new ImportQueue({
    organizationId: ORG,
    store: new MemoryQueueStore(),
    staging,
    capacity: new FakeStorageCapacity(),
    server,
    hash: async () => "a".repeat(64),
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  });

  const listeners = new Set<(snapshot: QueueSnapshot) => void>();
  let latest: QueueSnapshot | null = null;

  const runner = new ImportQueueRunner({
    queue,
    transport,
    coordinator,
    onChange: (snapshot) => {
      latest = snapshot;
      for (const listener of listeners) listener(snapshot);
    },
  });
  runner.start();

  return {
    workspaceSlug: "marcus-hale-studio",
    organizationId: ORG,
    queue,
    runner,
    durableMetadata: true,
    durableStaging: true,
    coordination: "web-locks",
    limitations: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    latest: () => latest,
    ready: async () => {},
    server,
    transport,
    staging,
  };
}

vi.mock("@/lib/import-queue/session", () => ({
  importSession: () => current,
  // The component takes the session through the hook, which is null until the
  // browser has one. Here it is available from the first render.
  useImportSession: () => current,
}));

const { ImportDropzone } = await import("./import-dropzone");

const jpeg = (name: string) => new File([`bytes of ${name}`], name, { type: "image/jpeg" });

function renderDropzone() {
  return render(
    <ImportDropzone
      organizationId={ORG}
      shootId="a0000000-0000-0000-0000-0000000000c1"
      workspaceSlug="marcus-hale-studio"
    />,
  );
}

beforeEach(() => {
  finished.length = 0;
  current = buildSession();
});

describe("choosing several files at once", () => {
  it("queues every file, not just the first", async () => {
    const user = userEvent.setup();
    renderDropzone();

    // The uploads are held open, because the thing being checked is what the
    // queue looks like while it is working. A real upload always takes time;
    // one that finishes within a microtask would be off the screen before
    // React had drawn it.
    let release!: () => void;
    current.transport.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    await user.upload(input, [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg"), jpeg("d.jpg")]);

    for (const name of ["a.jpg", "b.jpg", "c.jpg", "d.jpg"]) {
      expect(await screen.findByText(name)).toBeInTheDocument();
    }

    release();
    current.transport.gate = null;

    // Every file chosen is a file imported -- including the two that were
    // waiting behind the concurrency limit.
    await waitFor(() => expect(current.server.assetsCreated).toBe(4));
    // And they are still on screen afterwards, marked as imported, rather than
    // disappearing as the queue cleans up behind them.
    await waitFor(() => expect(screen.getAllByText("Imported")).toHaveLength(4));
  });

  it("advances the shoot once for the batch, not once per file", async () => {
    const user = userEvent.setup();
    renderDropzone();

    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    await user.upload(input, [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")]);

    await waitFor(() => expect(current.server.assetsCreated).toBe(3));
    await waitFor(() => expect(finished).toEqual(["a0000000-0000-0000-0000-0000000000c1"]));
  });

  it("clears the control so the same file can be chosen again", async () => {
    const user = userEvent.setup();
    renderDropzone();

    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    await user.upload(input, [jpeg("a.jpg")]);

    await waitFor(() => expect(input.value).toBe(""));
  });

  it("says how many are queued rather than appearing to do nothing", async () => {
    const user = userEvent.setup();
    renderDropzone();

    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    await user.upload(input, [jpeg("a.jpg"), jpeg("b.jpg")]);

    expect(await screen.findByText(/2 files queued/)).toBeInTheDocument();
  });
});

describe("a file that will not upload", () => {
  it("offers a retry and says what to do, without stopping the others", async () => {
    const user = userEvent.setup();
    renderDropzone();

    // Fail whichever file the queue gives the second client id: the component
    // does not choose them, so the failure is scripted after they exist.
    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    const failing = current.transport;
    const originalUpload = failing.upload.bind(failing);
    failing.upload = async (request) => {
      if (request.item.originalFilename === "bad.jpg") {
        return {
          ok: false,
          failure: {
            code: "quota_exceeded" as const,
            message: "This workspace is out of storage. Free some space or upgrade the plan.",
            retryable: false,
          },
          bytesUploaded: 0,
        };
      }
      return originalUpload(request);
    };

    await user.upload(input, [jpeg("good.jpg"), jpeg("bad.jpg")]);

    // The good one still lands.
    await waitFor(() => expect(current.server.assetsCreated).toBe(1));

    const row = (await screen.findByText("bad.jpg")).closest("li")!;
    expect(within(row).getByText("Failed")).toBeInTheDocument();
    expect(within(row).getByText(/out of storage/)).toBeInTheDocument();
    // A control per row, labelled for a screen reader with the file it acts on.
    expect(within(row).getByRole("button", { name: /Retry bad\.jpg/ })).toBeInTheDocument();

    // And it can be tried again once the person has done something about it.
    failing.upload = originalUpload;
    await user.click(within(row).getByRole("button", { name: /Retry bad\.jpg/ }));
    await waitFor(() => expect(current.server.assetsCreated).toBe(2));
  });
});

describe("what the screen tells somebody who cannot see it", () => {
  it("announces the batch as it moves, and labels every control", async () => {
    const user = userEvent.setup();
    renderDropzone();

    const input = document.querySelector<HTMLInputElement>("#import-files")!;
    // Hold the upload open so there is something in flight to describe.
    let release!: () => void;
    current.transport.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await user.upload(input, [jpeg("a.jpg"), jpeg("b.jpg")]);

    const live = await screen.findByText(/imported,/);
    expect(live).toHaveTextContent(/0 of 2 imported/);

    const bars = await screen.findAllByRole("progressbar");
    expect(bars[0]).toHaveAttribute("aria-valuenow");
    expect(bars[0]).toHaveAccessibleName(/a\.jpg/);

    expect(screen.getByRole("button", { name: /Pause all/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resume all/ })).toBeInTheDocument();

    release();
    current.transport.gate = null;
    await waitFor(() => expect(current.server.assetsCreated).toBe(2));
  });

  it("never promises that uploads survive the browser being closed", () => {
    renderDropzone();
    const note = screen.getByText(/Uploads continue while Mastline is open/);
    expect(note).toBeInTheDocument();
    expect(note.textContent).toContain("pick up where they left off next time you open it");
  });
});
