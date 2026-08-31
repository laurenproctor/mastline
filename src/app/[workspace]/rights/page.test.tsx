import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-shell>{children}</div>,
}));
vi.mock("@/lib/session-context", () => ({
  workspaceContext: vi.fn(async () => ({
    organizationId: "org-1",
    canonicalSlug: "studio",
    workspace: { role: state.role },
  })),
}));
vi.mock("@/lib/data/rights", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/rights")>();
  return { ...actual, listRightsMatches: vi.fn(async () => state.matches) };
});
vi.mock("@/lib/data/assets", () => ({
  getAsset: vi.fn(async (_org: string, id: string) => ({ id, canonicalFilename: `${id}.jpg` })),
}));
vi.mock("@/lib/data/money", () => ({
  listPayments: vi.fn(async () => [
    { source: "recovery", net: { minor: 45000, currency: "USD" } },
    { source: "statement", net: { minor: 99999, currency: "USD" } },
  ]),
}));
vi.mock("@/lib/data/workspace", () => ({
  listWorkspaceMembers: vi.fn(async () => [{ userId: "u-rhea", displayName: "Rhea" }]),
}));
vi.mock("./_components/triage-panel", () => ({
  TriagePanel: ({ allowed }: { allowed: readonly string[] }) => (
    <div data-testid="triage">{allowed.join(",")}</div>
  ),
  ReviewNotice: ({ done }: { done: string }) => <p role="status">done:{done}</p>,
}));

import RightsPage from "./page";

function match(over: Record<string, unknown>) {
  return {
    id: "m1",
    assetId: "asset-1",
    publisherName: "Daily Ledger",
    pageTitle: "Avery Hart departs",
    sourceUrl: "https://ledger.example/story",
    firstObservedAt: "2026-08-20T10:00:00Z",
    lastObservedAt: "2026-08-21T10:00:00Z",
    confidence: 0.91,
    matchMethod: "perceptual hash",
    licenseCheck: "no_linked_license_found",
    status: "new",
    hasEvidence: true,
    reviewedBy: null,
    reviewedAt: null,
    decisionNote: null,
    updatedAt: "2026-08-21T10:00:00Z",
    ...over,
  };
}

const state = { role: "owner", matches: [] as Array<Record<string, unknown>> };

async function renderRights(query: { match?: string; done?: string } = {}) {
  const tree = await RightsPage({
    params: Promise.resolve({ workspace: "studio" }),
    searchParams: Promise.resolve(query),
  });
  return render(tree);
}

describe("Rights on the Stage 4A surfaces", () => {
  beforeEach(() => {
    state.role = "owner";
    state.matches = [
      match({}),
      match({ id: "m2", publisherName: "Gazette", status: "monitoring" }),
    ];
  });

  it("keeps one title, the primary action to settings, and the four factual counts", async () => {
    await renderRights();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Add monitored domain" })).toHaveAttribute(
      "href",
      "/studio/settings",
    );
    const summary = screen.getByRole("group", { name: "Rights summary" });
    expect(Array.from(summary.querySelectorAll("dt")).map((t) => t.textContent)).toEqual([
      "Needs review",
      "Monitoring",
      "Verified licensed",
      "Recovered",
    ]);
    const values = Array.from(summary.querySelectorAll(".ml-metric__value")).map(
      (v) => v.textContent,
    );
    expect(values).toEqual(["1", "1", "0", "$450"]);
    expect(within(summary).getByText("Awaiting a human decision")).toHaveAttribute(
      "data-tone",
      "danger",
    );
  });

  it("keeps the queue as a native table whose rows link to the asset and to the ?match= selection", async () => {
    await renderRights();
    const region = screen.getByRole("region", { name: "Observed uses" });
    const table = within(region).getByRole("table", { name: "Observed uses" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual([
      "Publisher",
      "Asset",
      "First observed",
      "Confidence",
      "License check",
      "Status",
      "Review",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    // The first match is selected by default and announced as current.
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(within(rows[0]).getByText("Selected")).toHaveClass("ml-badge");
    expect(within(rows[0]).getByRole("link", { name: "asset-1.jpg" })).toHaveAttribute(
      "href",
      "/studio/assets/asset-1",
    );
    expect(within(rows[1]).getByRole("link", { name: /Select Gazette match/ })).toHaveAttribute(
      "href",
      "/studio/rights?match=m2",
    );
    expect(within(rows[0]).getByText("New")).toHaveAttribute("data-tone", "danger");
    expect(within(rows[1]).getByText("Monitoring")).toHaveAttribute("data-tone", "info");
  });

  it("selects the match named in the address and shows its evidence, decision, and triage", async () => {
    state.matches[1] = match({
      id: "m2",
      publisherName: "Gazette",
      status: "reviewing",
      reviewedBy: "u-rhea",
      reviewedAt: "2026-08-22T10:00:00Z",
      decisionNote: "Looking into it.",
    });
    await renderRights({ match: "m2", done: "reviewing" });
    expect(screen.getByRole("heading", { level: 2, name: "Selected match" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Gazette" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("done:reviewing");
    expect(screen.getByRole("link", { name: "https://ledger.example/story" })).toHaveAttribute(
      "rel",
      "noreferrer nofollow",
    );
    const decision = screen
      .getByRole("heading", { name: "Human decision" })
      .closest(".ml-card") as HTMLElement;
    expect(decision).toHaveTextContent("Rhea");
    expect(decision).toHaveTextContent("Looking into it.");
    expect(screen.getByTestId("triage")).toHaveTextContent("monitoring,ignored,licensed,resolved");
    expect(screen.getByText("Captured and stored privately")).toBeInTheDocument();
  });

  it("does not show the decision confirmation for a done parameter that names another match", async () => {
    await renderRights({ done: "reviewing" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("answers an unknown match with one alert, keeps the queue, and selects nothing", async () => {
    await renderRights({ match: "00000000-0000-4000-8000-000000000000" });
    const queue = screen
      .getByRole("heading", { name: "Match queue" })
      .closest(".ml-panel") as HTMLElement;
    expect(within(queue).getByRole("alert")).toHaveTextContent(/not in this workspace/i);
    expect(screen.queryByRole("heading", { name: "Selected match" })).toBeNull();
    expect(screen.getByRole("table", { name: "Observed uses" })).toBeInTheDocument();
    expect(document.querySelector('tr[aria-current="true"]')).toBeNull();
  });

  it("keeps review read-only for a role without rights.triage", async () => {
    state.role = "viewer";
    await renderRights();
    expect(screen.queryByTestId("triage")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Review is read-only for your role" }),
    ).toBeInTheDocument();
  });

  it("says what an empty queue means and still shows the counts", async () => {
    state.matches = [];
    await renderRights();
    expect(
      screen.getByRole("heading", { level: 3, name: "No observed uses recorded" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Selected match" })).toBeNull();
  });

  it("nests no control inside another and keeps headings in order", async () => {
    await renderRights();
    expect(document.querySelectorAll("a a, a button, button a, button button")).toHaveLength(0);
    const levels = Array.from(document.querySelectorAll("h1, h2, h3")).map((h) =>
      Number(h.tagName[1]),
    );
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1)
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });
});
