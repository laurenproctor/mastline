import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Creating a shoot, on one page.
 *
 * The flow this replaced entered a brief here and did everything else on the
 * next screen, behind a button called "Create shoot and review". These tests
 * hold the two properties that change was for:
 *
 *   1. every part of the shoot is on this page at once, and stays on it while
 *      you move around -- nothing is a step, nothing is unmounted
 *   2. the one action at the bottom writes a private draft, and its copy never
 *      borrows a verb from the dispatch gate
 *
 * The Server Action is mocked because it is a network boundary. What it does
 * with what this form sends is tested against the database in
 * tests/shoot-draft-creation.test.ts; what this form SENDS is tested here.
 */

const submitted: FormData[] = [];
let resolveAction: (() => void) | null = null;
let actionResult: unknown = {};

vi.mock("../actions", () => ({
  createShootAction: vi.fn(async (_workspaceSlug: string, _previous: unknown, form: FormData) => {
    submitted.push(form);
    if (resolveAction) {
      await new Promise<void>((resolve) => {
        const previous = resolveAction;
        resolveAction = () => {
          previous?.();
          resolve();
        };
      });
    }
    return actionResult;
  }),
}));

vi.mock("@/app/buyer-actions", () => ({
  createBuyerAction: vi.fn(async () => ({ ok: true })),
}));

// The staging pipeline is the browser half of the import path and is covered by
// src/lib/upload.test.ts and the dropzone's own tests. Here it is noise, and
// jsdom has neither crypto.subtle over real files nor a canvas.
const stageOriginal = vi.fn(async (_workspaceSlug: string, file: File) => ({
  filename: file.name,
  sha256: "a".repeat(64),
  bytes: file.size,
  mimeType: file.type,
  capturedAt: "2026-08-27T10:00:00.000Z",
  width: 6000,
  height: 4000,
  stagingKey: `org/_staging/${file.name}`,
}));

let holdStaging: (() => void) | null = null;

vi.mock("@/components/upload-staging", () => ({
  stageOriginal: (workspaceSlug: string, file: File, onPhase?: (phase: string) => void) => {
    onPhase?.("uploading");
    if (holdStaging) {
      return new Promise((resolve) => {
        const previous = holdStaging;
        holdStaging = () => {
          previous?.();
          resolve(stageOriginal(workspaceSlug, file));
        };
      });
    }
    return stageOriginal(workspaceSlug, file);
  },
  stagePreview: vi.fn(async () => null),
}));

const { CreateShootForm } = await import("./shoot-form");

const jpeg = (name: string) => new File(["bytes"], name, { type: "image/jpeg" });

function renderForm() {
  return render(
    <CreateShootForm
      workspaceSlug="hale-studio"
      buyers={[{ id: "buyer-1", name: "Northern Wire" }]}
      canSeeSourceNote
    />,
  );
}

/** The payload the Server Action would receive, decoded. */
function lastPayload(): Record<string, unknown>[] {
  const form = submitted.at(-1);
  return JSON.parse(String(form?.get("photographs") ?? "[]"));
}

beforeEach(() => {
  submitted.length = 0;
  resolveAction = null;
  holdStaging = null;
  actionResult = {};
});

describe("one page, not two", () => {
  it("puts details, photographs, metadata, rights, and the review on the same page", () => {
    renderForm();

    for (const heading of [
      "Shoot details",
      "Photographs",
      "Metadata",
      "Rights and usage",
      "Final review",
    ]) {
      expect(screen.getByRole("heading", { name: heading, level: 2 })).toBeInTheDocument();
    }
  });

  it("keeps every section mounted, so moving between them loses nothing", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Subject or event/), "Hotel Chelsea departure");
    await user.type(screen.getByLabelText(/Credit line/), "Marcus Hale / Mastline");
    await user.type(screen.getByLabelText(/Usage restrictions/), "Editorial use only");

    // The section index is anchors within this document, not steps.
    const nav = screen.getByRole("navigation", { name: /sections of this page/i });
    for (const label of ["Shoot details", "Photographs", "Final review"]) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        expect.stringMatching(/^#/),
      );
    }

    expect(screen.getByLabelText(/Subject or event/)).toHaveValue("Hotel Chelsea departure");
    expect(screen.getByLabelText(/Credit line/)).toHaveValue("Marcus Hale / Mastline");
    expect(screen.getByLabelText(/Usage restrictions/)).toHaveValue("Editorial use only");
  });

  it("keeps the rights facts on the page rather than behind a second screen", () => {
    renderForm();
    expect(screen.getByLabelText(/Embargo until/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Exclusivity/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sensitive content/)).toBeInTheDocument();
  });
});

describe("the action creates a draft and says so", () => {
  it("is called Create shoot, and reports a draft rather than a submission", () => {
    renderForm();

    const submit = screen.getByRole("button", { name: "Create shoot" });
    expect(submit).toHaveAttribute("type", "submit");
    expect(
      screen.getByText(/remain private until you choose to dispatch it/i),
    ).toBeInTheDocument();
  });

  it("never borrows the dispatch gate's words for anything clickable", () => {
    renderForm();

    // The prose may say what will NOT happen ("does not send, publish, or
    // submit"). What must not happen is a control offering to do it.
    const names = [
      ...screen.getAllByRole("button").map((control) => control.textContent ?? ""),
      ...screen.getAllByRole("link").map((control) => control.textContent ?? ""),
    ];

    for (const forbidden of [/submit/i, /publish/i, /confirm/i, /send/i, /dispatch/i]) {
      expect(
        names.filter((name) => forbidden.test(name)),
        `no control should be named ${forbidden}`,
      ).toEqual([]);
    }

    expect(screen.getByRole("button", { name: "Create shoot" })).toBeInTheDocument();
  });

  it("says plainly that nothing leaves the workspace", () => {
    renderForm();
    expect(
      screen.getByText(/does not send, publish, submit, or offer anything to anyone/i),
    ).toBeInTheDocument();
  });

  it("does not claim Mastline clears or verifies anything", () => {
    renderForm();
    expect(
      screen.getByText(/does not verify ownership, check whether a subject consented/i),
    ).toBeInTheDocument();
  });
});

describe("what the submission carries", () => {
  it("sends the brief, the shoot metadata, and the staged photographs together", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Subject or event/), "Hotel Chelsea departure");
    await user.type(screen.getByLabelText(/Credit line/), "Marcus Hale / Mastline");
    await user.type(screen.getByLabelText(/Copyright notice/), "© 2026 Marcus Hale");
    await user.upload(screen.getByLabelText("Add photographs"), [
      jpeg("MH_0001.jpg"),
    ]);

    await screen.findByText(/1 of 1 ready/);

    await user.type(
      screen.getByLabelText(/^Caption$/),
      "Marcus Hale leaves the Hotel Chelsea.",
    );

    await user.click(screen.getByRole("button", { name: "Create shoot" }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    const form = submitted[0];

    expect(form.get("title")).toBe("Hotel Chelsea departure");
    expect(form.get("defaultCreditLine")).toBe("Marcus Hale / Mastline");
    expect(form.get("defaultCopyrightNotice")).toBe("© 2026 Marcus Hale");

    const photographs = lastPayload();
    expect(photographs).toHaveLength(1);
    expect(photographs[0]).toMatchObject({
      filename: "MH_0001.jpg",
      sha256: "a".repeat(64),
      stagingKey: "org/_staging/MH_0001.jpg",
    });
    expect((photographs[0].metadata as Record<string, unknown>).caption).toBe(
      "Marcus Hale leaves the Hotel Chelsea.",
    );
  });

  it("carries an idempotency token so a repeat lands on the first shoot", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Subject or event/), "Hotel Chelsea departure");
    await user.click(screen.getByRole("button", { name: "Create shoot" }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(String(submitted[0].get("clientToken"))).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("sends no photographs when there are none, rather than refusing", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Subject or event/), "Brief only");
    await user.click(screen.getByRole("button", { name: "Create shoot" }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(lastPayload()).toEqual([]);
  });

  it("leaves out a photograph that is still uploading, and will not submit until it lands", async () => {
    const user = userEvent.setup();
    holdStaging = () => {};
    renderForm();

    await user.type(screen.getByLabelText(/Subject or event/), "Hotel Chelsea departure");
    await user.upload(screen.getByLabelText("Add photographs"), [
      jpeg("MH_0001.jpg"),
    ]);

    await screen.findByText(/One photograph is still uploading/i);
    expect(screen.getByRole("button", { name: "Create shoot" })).toBeDisabled();

    holdStaging?.();
    await screen.findByText(/1 of 1 ready/);
    expect(screen.getByRole("button", { name: "Create shoot" })).toBeEnabled();
  });
});

describe("nothing is created twice", () => {
  it("disables the button while the draft is being written", async () => {
    const user = userEvent.setup();
    resolveAction = () => {};
    renderForm();

    await user.type(screen.getByLabelText(/Subject or event/), "Hotel Chelsea departure");
    await user.click(screen.getByRole("button", { name: "Create shoot" }));

    const busy = await screen.findByRole("button", { name: "Creating shoot…" });
    expect(busy).toBeDisabled();

    await user.click(busy);
    expect(submitted).toHaveLength(1);

    resolveAction?.();
  });

  it("will not submit without a subject or event, and says which section fixes it", () => {
    renderForm();

    const submit = screen.getByRole("button", { name: "Create shoot" });
    expect(submit).toBeDisabled();

    // The reason is bound to the control rather than only printed near it.
    const reason = document.getElementById(String(submit.getAttribute("aria-describedby")));
    expect(reason).not.toBeNull();
    expect(reason).toHaveTextContent(/Give the shoot a subject or event/);
    expect(within(reason as HTMLElement).getByRole("link", { name: /fix it/i })).toHaveAttribute(
      "href",
      "#details",
    );
  });
});

describe("the review reports rather than gates", () => {
  it("names what dispatch will ask for without blocking the draft", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Subject or event/), "Hotel Chelsea departure");
    await user.upload(screen.getByLabelText("Add photographs"), [
      jpeg("MH_0001.jpg"),
    ]);
    await screen.findByText(/1 of 1 ready/);

    expect(screen.getByText(/1 of 1 photograph has no caption/i)).toBeInTheDocument();
    expect(screen.getByText(/No credit line/i)).toBeInTheDocument();
    expect(screen.getByText(/None of these stop the shoot being created/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create shoot" })).toBeEnabled();
  });

  it("shows a refused submission's message and sends focus to the field", async () => {
    const user = userEvent.setup();
    actionResult = { errors: { title: "Give the shoot a subject or event." } };
    renderForm();

    await user.type(screen.getByLabelText(/Subject or event/), "Hotel Chelsea departure");
    await user.click(screen.getByRole("button", { name: "Create shoot" }));

    const field = screen.getByLabelText(/Subject or event/);
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveAttribute("aria-invalid", "true");
  });
});
