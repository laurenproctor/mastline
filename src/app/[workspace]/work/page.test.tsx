import { cleanup, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkQueueDashboard, WorkQueueItem } from "@/lib/data/work-queue";
import { money } from "@/lib/money";
import { queueFilterHref } from "./_components/queue-filters";

/*
 * The Work Queue on the Stage 4A surfaces. The data layer is stood in for,
 * so what is asserted is the contract the screen keeps with it: the ranking
 * order and every basis rendered as given, the filter as a set of links that
 * keep the rest of the address, the permission gate, the empty states, and
 * the absence of anything that should not be on a page -- nested controls,
 * fake tab semantics, a delivery credential.
 */
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-shell>{children}</div>,
}));
vi.mock("@/lib/session-context", () => ({
  workspaceContext: vi.fn(async () => ({
    session: { activeWorkspace: { role: state.role } },
    organizationId: "org-1",
    canonicalSlug: "studio",
  })),
}));
vi.mock("@/lib/data/work-queue-page", () => ({
  loadWorkQueuePage: vi.fn(async () => ({ dashboard: state.dashboard, activity: state.activity })),
}));

import WorkQueuePage from "./page";

const TOKEN = "Xf_g4ZUwZX1EtXWqqmrejBkuYH0pl34Pj6rQI2jqqLg";

function item(over: Partial<WorkQueueItem> & { id: string }): WorkQueueItem {
  return {
    kind: "Submission",
    category: "awaiting-outcome",
    priority: 7,
    title: `Record outcome — ${over.id}`,
    detail: "No sale or no-sale recorded yet",
    occurredAt: "2026-08-27T10:00:00Z",
    urgent: false,
    actionLabel: "Review",
    href: `/studio/submissions/${over.id}`,
    rankingBasis: "A submission with no recorded outcome",
    ...over,
  };
}

const QUEUE: WorkQueueItem[] = [
  item({
    id: "f1",
    priority: 1,
    category: "ready-to-send",
    title: "Delivery failed — BG-1",
    detail: "The buyer's system rejected or never received this package",
    urgent: true,
    actionLabel: "Retry",
    rankingBasis: "A recorded delivery failure",
  }),
  item({
    id: "o1",
    kind: "Money",
    category: "money",
    priority: 2,
    title: "Overdue — MEGA-5610",
    detail: "$1,200 past its due date",
    urgent: true,
    actionLabel: "Chase",
    href: "/studio/money",
    rankingBasis: "Payment is past its recorded due date",
  }),
  item({
    id: "c1",
    kind: "Shoot",
    category: "in-preparation",
    priority: 4,
    title: "Finish metadata — Hotel Chelsea departure",
    detail: "1 of 2 selected photos missing required metadata",
    actionLabel: "Continue",
    href: "/studio/shoots/s1",
    rankingBasis: "Selected photos are blocked from dispatch by required metadata",
  }),
  item({ id: "w1" }),
  item({
    id: "u1",
    kind: "Money",
    category: "money",
    priority: 8,
    title: "Allocate — BG-882341",
    detail: "$1,720 received but not attributed to work",
    actionLabel: "Allocate",
    href: "/studio/money",
    rankingBasis: "A received payment with an unallocated balance",
  }),
];

function dashboard(queue: readonly WorkQueueItem[]): WorkQueueDashboard {
  return {
    nextUp: queue[0] ?? null,
    queue,
    counts: {
      all: queue.length,
      inPreparation: queue.filter((i) => i.category === "in-preparation").length,
      readyToSend: queue.filter((i) => i.category === "ready-to-send").length,
      awaitingOutcome: queue.filter((i) => i.category === "awaiting-outcome").length,
      money: queue.filter((i) => i.category === "money").length,
    },
    activeShoots: [
      {
        id: "s1",
        title: "Hotel Chelsea departure",
        status: "preparing",
        locationName: "222 W 23rd St, New York, NY",
        totalAssets: 2,
        selectedCount: 2,
        metadataPercent: 50,
        blockedCount: 1,
        packageLabel: "Needs review",
        linkLabel: null,
        lastActivityAt: "2026-08-27T10:00:00Z",
        actionLabel: "Complete metadata",
        actionHref: "/studio/shoots/s1",
        previewUrls: [],
      },
    ],
    recipientActivity: [],
    money: {
      expectedNet: money(120000),
      expectedCount: 1,
      unallocatedNet: money(172000),
      unallocatedCount: 1,
      awaitingOutcomeCount: 1,
    },
    pulse: {
      netReceived: money(278800),
      outstanding: money(120000),
      unmatched: money(172000),
      overdueCount: 1,
      medianDispatchMinutes: 22,
    },
  };
}

const EVENT = {
  id: "e1",
  organizationId: "org-1",
  entityType: "package",
  action: "approved",
  summary: "Package approved · 1 frame · nothing sent yet",
  createdAt: "2026-08-27T10:00:00Z",
};

const state = { role: "owner", dashboard: dashboard(QUEUE), activity: [EVENT] };

/** A row's title without the hidden priority prefix a screen reader hears. */
const visibleTitle = (row: HTMLElement) =>
  within(row)
    .getByRole("heading", { level: 3 })
    .textContent?.replace(/^Urgent: /, "") ?? "";

async function renderWork(query: Record<string, string | string[] | undefined> = {}) {
  const tree = await WorkQueuePage({
    params: Promise.resolve({ workspace: "studio" }),
    searchParams: Promise.resolve(query),
  });
  return render(tree);
}

describe("queueFilterHref", () => {
  it("keeps every other parameter and drops queue for All", () => {
    const params = new URLSearchParams("from=archive&queue=money&tag=a&tag=b");
    expect(queueFilterHref("/studio/work", params, "ready-to-send")).toBe(
      "/studio/work?from=archive&queue=ready-to-send&tag=a&tag=b",
    );
    expect(queueFilterHref("/studio/work", params, "all")).toBe(
      "/studio/work?from=archive&tag=a&tag=b",
    );
    expect(queueFilterHref("/studio/work", new URLSearchParams(), "all")).toBe("/studio/work");
  });
});

describe("Work queue on the Stage 4A surfaces", () => {
  beforeEach(() => {
    state.role = "owner";
    state.dashboard = dashboard(QUEUE);
    state.activity = [EVENT];
  });

  it("keeps one h1, the gated Create shoot action, and the four header figures", async () => {
    await renderWork();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Work queue");
    expect(screen.getByRole("link", { name: "Create shoot" })).toHaveAttribute(
      "href",
      "/studio/shoots/new",
    );
    const pulse = screen.getByRole("group", { name: "This period" });
    expect(Array.from(pulse.querySelectorAll("dt")).map((t) => t.textContent)).toEqual([
      "Received",
      "Outstanding",
      "Median dispatch",
      "Unmatched",
    ]);
    expect(within(pulse).getByText("$2,788")).toBeInTheDocument();
    expect(within(pulse).getByText("22 min")).toBeInTheDocument();
    expect(within(pulse).getByText("1 overdue")).toHaveAttribute("data-tone", "danger");
    expect(screen.getByRole("link", { name: "View money" })).toHaveAttribute(
      "href",
      "/studio/money",
    );
  });

  it("puts the first ranked item in the Next up card with its own basis and action", async () => {
    await renderWork();
    const next = screen.getByRole("region", { name: "Next up" });
    const card = next.querySelector(".ml-priority-card") as HTMLElement;
    expect(card).toHaveAttribute("data-tone", "danger");
    expect(within(card).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Delivery failed — BG-1",
    );
    expect(card).toHaveTextContent("A recorded delivery failure");
    expect(within(card).getByRole("link", { name: "Retry" })).toHaveAttribute(
      "href",
      "/studio/submissions/f1",
    );
  });

  it("lists the queue in ranking order with every basis and an explicit action per row", async () => {
    await renderWork();
    const list = screen.getByRole("list", { name: "Ranked queue" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map(visibleTitle)).toEqual(QUEUE.map((entry) => entry.title));
    for (const [index, row] of rows.entries()) {
      expect(row).toHaveTextContent(QUEUE[index].rankingBasis);
      const action = within(row).getByRole("link", { name: QUEUE[index].actionLabel });
      expect(action).toHaveAttribute("href", QUEUE[index].href);
      // The row is a record, not a control.
      expect(row.tagName).toBe("LI");
      expect(row.getAttribute("role")).toBeNull();
    }
    expect(rows[0]).toHaveAttribute("data-priority", "high");
    expect(rows[0].querySelector(".ml-visually-hidden")).toHaveTextContent("Urgent:");
    expect(rows[3]).not.toHaveAttribute("data-priority");
  });

  it("renders the filters as links that carry counts, mark the current one, and keep other parameters", async () => {
    await renderWork({ queue: "money", from: "archive" });
    const nav = screen.getByRole("navigation", { name: "Queue filters" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "All5",
      "In preparation1",
      "Ready to send1",
      "Awaiting outcome1",
      "Money2",
    ]);
    expect(within(nav).getByRole("link", { name: /^Money/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(nav).getByRole("link", { name: /^All/ })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: /^All/ })).toHaveAttribute(
      "href",
      "/studio/work?from=archive",
    );
    expect(within(nav).getByRole("link", { name: /^Ready/ })).toHaveAttribute(
      "href",
      "/studio/work?queue=ready-to-send&from=archive",
    );
    // Filtering narrows the list to the count the link advertises, in ranking order.
    const rows = within(screen.getByRole("list", { name: "Ranked queue" })).getAllByRole(
      "listitem",
    );
    expect(rows.map(visibleTitle)).toEqual(["Overdue — MEGA-5610", "Allocate — BG-882341"]);
    // No fake tab semantics anywhere.
    expect(
      document.querySelectorAll("[role='tab'], [role='tablist'], [aria-selected]"),
    ).toHaveLength(0);
  });

  it("treats an unknown filter as All", async () => {
    await renderWork({ queue: "everything" });
    const nav = screen.getByRole("navigation", { name: "Queue filters" });
    expect(within(nav).getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "true");
    expect(
      within(screen.getByRole("list", { name: "Ranked queue" })).getAllByRole("listitem"),
    ).toHaveLength(5);
  });

  it("says when a filter is empty, and when the whole queue is", async () => {
    state.dashboard = dashboard(QUEUE.filter((entry) => entry.category !== "ready-to-send"));
    const filtered = await renderWork({ queue: "ready-to-send" });
    expect(
      screen.getByRole("heading", { level: 3, name: "Nothing in this part of the queue" }),
    ).toBeInTheDocument();
    filtered.unmount();

    state.dashboard = { ...dashboard([]), activeShoots: [] };
    state.activity = [];
    await renderWork();
    expect(
      screen.getAllByRole("heading", { level: 3, name: "Everything is up to date" }),
    ).toHaveLength(2);
    expect(
      screen.getByRole("heading", { level: 3, name: "No shoot is in progress" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Nothing recorded yet." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing needs attention/)).toBeInTheDocument();
  });

  it("shows the active shoot's totals, readiness, and next action, and keeps a viewer to reading", async () => {
    await renderWork();
    const panel = screen.getByRole("region", { name: "Active shoots" });
    expect(panel).toHaveTextContent(
      "2 files · 2 selected · 222 W 23rd St, New York, NY · Needs review",
    );
    expect(within(panel).getByRole("progressbar", { name: "Ready to dispatch" })).toHaveAttribute(
      "aria-valuetext",
      "50%",
    );
    expect(within(panel).getByRole("link", { name: "Complete metadata" })).toHaveAttribute(
      "href",
      "/studio/shoots/s1",
    );

    state.role = "viewer";
    cleanup();
    await renderWork();
    expect(screen.queryByRole("link", { name: "Create shoot" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Complete metadata" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Open shoot" })[0]).toHaveAttribute(
      "href",
      "/studio/shoots/s1",
    );
  });

  it("keeps recent activity's wording and archive link", async () => {
    await renderWork();
    const panel = screen.getByRole("region", { name: "Recent activity" });
    expect(within(panel).getByRole("link", { name: "View archive" })).toHaveAttribute(
      "href",
      "/studio/archive",
    );
    expect(within(panel).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Package approved · 1 frame · nothing sent yet",
    );
  });

  it("nests no control inside another, keeps headings in order, and exposes no delivery credential", async () => {
    // A hostile dashboard: a token where no token should ever reach a page.
    state.dashboard = dashboard([
      item({ id: "t1", title: "Record outcome — REF", href: `/studio/submissions/${TOKEN}` }),
    ]);
    await renderWork();
    expect(document.querySelectorAll("a a, a button, button a, button button")).toHaveLength(0);
    const levels = Array.from(document.querySelectorAll("h1, h2, h3")).map((h) =>
      Number(h.tagName[1]),
    );
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
    // The page renders what the data layer hands it; the data layer is what
    // keeps the token out (tests/work-queue-isolation). No href here points
    // at the recipient surface.
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      expect(anchor.getAttribute("href")?.startsWith("/d/")).toBe(false);
    }
  });
});
