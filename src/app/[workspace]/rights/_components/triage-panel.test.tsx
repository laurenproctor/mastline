import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The triage controls, and the promises they are not allowed to make.
 *
 * Three things are easy to lose in a refactor and expensive to lose in
 * production: that setting a match aside takes two motions and a reason, that
 * "monitor" does not claim to be watching anything, and that "licensed" cannot
 * be pressed on a match whose license check found nothing. These are here so
 * losing any of them fails a test rather than a reviewer.
 */

const submitted: FormData[] = [];

vi.mock("../actions", () => ({
  recordRightsDecisionAction: vi.fn(
    async (_workspaceSlug: string, _previous: unknown, form: FormData) => {
      submitted.push(form);
      return {};
    },
  ),
}));

const { TriagePanel } = await import("./triage-panel");

const BASE = {
  workspaceSlug: "hale-studio",
  matchId: "a0000000-0000-0000-0000-0000000000d1",
  expectedUpdatedAt: "2026-08-27T10:00:00.123456+00:00",
  noteMin: 10,
  noteMax: 1000,
  licenseRequiredMessage:
    "Link and verify the applicable license before marking this use as licensed.",
};

const NEW_MATCH = {
  ...BASE,
  allowed: ["reviewing", "monitoring", "ignored", "licensed"] as const,
  hasLinkedLicense: false,
};

beforeEach(() => {
  submitted.length = 0;
});

describe("setting a match aside", () => {
  it("does not record anything on the first press", async () => {
    const user = userEvent.setup();
    render(<TriagePanel {...NEW_MATCH} />);

    await user.click(screen.getByRole("button", { name: /^ignore this match$/i }));

    expect(submitted).toHaveLength(0);
    expect(screen.getByRole("button", { name: /yes, ignore this match/i })).toBeInTheDocument();
  });

  it("asks for a reason and sends the version the reviewer was looking at", async () => {
    const user = userEvent.setup();
    render(<TriagePanel {...NEW_MATCH} />);

    await user.click(screen.getByRole("button", { name: /^ignore this match$/i }));
    const note = screen.getByLabelText(/why this is being set aside/i);
    expect(note).toBeRequired();
    await user.type(note, "Shot on assignment for this publisher in July.");
    await user.click(screen.getByRole("button", { name: /yes, ignore this match/i }));

    expect(submitted).toHaveLength(1);
    const form = submitted[0];
    expect(form.get("status")).toBe("ignored");
    expect(form.get("matchId")).toBe(BASE.matchId);
    expect(form.get("confirmed")).toBe("yes");
    expect(form.get("expectedUpdatedAt")).toBe(BASE.expectedUpdatedAt);
    expect(String(form.get("note"))).toMatch(/assignment/);
  });

  it("says the record and its evidence are kept", async () => {
    render(<TriagePanel {...NEW_MATCH} />);
    expect(screen.getByText(/nothing is deleted/i)).toBeInTheDocument();
  });
});

describe("monitoring claims nothing it does not do", () => {
  it("says no automatic monitoring is started", () => {
    render(<TriagePanel {...NEW_MATCH} />);
    expect(
      screen.getByText(/starts no crawler, schedule, or automatic re-check/i),
    ).toBeInTheDocument();
  });

  it("takes an optional note in one motion", async () => {
    const user = userEvent.setup();
    render(<TriagePanel {...NEW_MATCH} />);

    await user.click(screen.getByRole("button", { name: /hold for monitoring/i }));

    expect(submitted).toHaveLength(1);
    expect(submitted[0].get("status")).toBe("monitoring");
    expect(submitted[0].get("confirmed")).toBeNull();
  });
});

describe("licensed cannot become an unsupported assertion", () => {
  it("is blocked, and says why, when no linked license was found", () => {
    render(<TriagePanel {...NEW_MATCH} />);

    const control = screen.getByRole("button", { name: /^mark licensed$/i });
    expect(control).toBeDisabled();
    expect(screen.getByText(BASE.licenseRequiredMessage)).toBeInTheDocument();
    expect(screen.getByText(/did not find a linked license/i)).toBeInTheDocument();
  });

  it("is offered, behind a confirmation, when a license is linked", async () => {
    const user = userEvent.setup();
    render(<TriagePanel {...NEW_MATCH} hasLinkedLicense />);

    await user.click(screen.getByRole("button", { name: /^mark licensed$/i }));
    expect(submitted).toHaveLength(0);
    expect(screen.getByLabelText(/which license covers this/i)).toBeRequired();
  });
});

describe("a decision already recorded", () => {
  it("offers no controls at all", () => {
    render(<TriagePanel {...BASE} allowed={[]} hasLinkedLicense={false} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/is not reopened in place/i)).toBeInTheDocument();
  });
});

describe("starting a review", () => {
  it("is one press and carries no confirmation flag", async () => {
    const user = userEvent.setup();
    render(<TriagePanel {...NEW_MATCH} />);

    await user.click(screen.getByRole("button", { name: /^start review$/i }));

    expect(submitted).toHaveLength(1);
    expect(submitted[0].get("status")).toBe("reviewing");
    expect(submitted[0].get("confirmed")).toBeNull();
  });
});
