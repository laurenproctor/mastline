import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Money screen on the Stage 4A surfaces. The data layer is stood in for,
 * so what is asserted is the contract the screen keeps: which figures it
 * shows and how they are formatted, which records land in which table, which
 * actions a role sees, and where every link goes.
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
vi.mock("@/lib/data/money", () => ({
  getMoneySummary: vi.fn(async () => state.summary),
  getRevenueBySource: vi.fn(async () => state.sources),
  listPayments: vi.fn(async () => state.payments),
  listLicenses: vi.fn(async () => state.licenses),
}));
vi.mock("@/lib/data/submissions", () => ({ listSubmissions: vi.fn(async () => []) }));
vi.mock("@/lib/data/workspace", () => ({
  listWorkspaceBuyers: vi.fn(async () => [{ id: "b1", name: "The Mega Agency" }]),
}));
vi.mock("@/lib/data/statements", () => ({
  listStatementImports: vi.fn(async () => state.statements),
}));
vi.mock("./_components/allocate", () => ({
  AllocateForm: ({ reference }: { reference: string }) => (
    <button type="button">Match {reference}</button>
  ),
}));
vi.mock("./_components/record-payment", () => ({
  RecordPayment: () => <div data-testid="record-payment">Record a payment</div>,
}));
vi.mock("./_components/statement-import", () => ({
  ImportStatement: () => <div data-testid="import-statement">Import a statement</div>,
  ConfirmLine: ({ lineId }: { lineId: string }) => <button type="button">Confirm {lineId}</button>,
}));

import MoneyPage from "./page";

const usd = (minor: number) => ({ minor, currency: "USD" as const });

const state = {
  role: "owner",
  summary: {
    netReceived: usd(278800),
    outstanding: usd(120000),
    unallocatedStatementTotal: usd(172000),
    salesEngineShareToDate: usd(0),
    averageDaysToPayment: 30,
    overdueCount: 1,
  },
  sources: [
    { label: "Agency statement", amount: usd(200000) },
    { label: "Direct license", amount: usd(50000) },
  ],
  payments: [] as Array<Record<string, unknown>>,
  licenses: [] as Array<Record<string, unknown>>,
  statements: [] as Array<Record<string, unknown>>,
};

function payment(over: Record<string, unknown>) {
  return {
    id: "p1",
    reference: "BG-882341",
    buyerId: "b1",
    source: "statement",
    status: "received",
    receivedAt: "2026-08-28T10:00:00Z",
    dueAt: null,
    gross: usd(390000),
    deductions: usd(156000),
    platformFee: usd(0),
    tax: usd(0),
    net: usd(234000),
    allocatedTotal: usd(234000),
    unallocated: usd(0),
    ...over,
  };
}

async function renderMoney() {
  const tree = await MoneyPage({ params: Promise.resolve({ workspace: "studio" }) });
  return render(tree);
}

describe("Money on the Stage 4A surfaces", () => {
  beforeEach(() => {
    state.role = "owner";
    state.payments = [];
    state.licenses = [];
    state.statements = [];
  });

  it("keeps one page title and shows the four summary figures, formatted by the money helpers", async () => {
    await renderMoney();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Revenue & payments");
    const summary = screen.getByRole("group", { name: "Revenue summary" });
    const terms = Array.from(summary.querySelectorAll("dt")).map((t) => t.textContent);
    expect(terms).toEqual(["Net received", "Outstanding", "Unmatched", "Average time to payment"]);
    expect(within(summary).getByText("$2,788")).toBeInTheDocument();
    expect(within(summary).getByText("$1,200")).toBeInTheDocument();
    expect(within(summary).getByText("$1,720")).toBeInTheDocument();
    expect(within(summary).getByText("30 days")).toBeInTheDocument();
    expect(within(summary).getByText("1 overdue")).toHaveAttribute("data-tone", "danger");
  });

  it("puts the reconciliation queue in a native table with the same columns and the allocate action for a writer", async () => {
    state.payments = [
      payment({
        id: "p2",
        reference: "STMT-9",
        status: "reported",
        net: usd(500000),
        allocatedTotal: usd(0),
        unallocated: usd(500000),
      }),
      payment({ id: "p3", reference: "OK-1" }),
    ];
    await renderMoney();
    const region = screen.getByRole("region", { name: "Payments with unattributed amounts" });
    const table = within(region).getByRole("table", { name: "Payments with unattributed amounts" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Status", "Reference", "Buyer", "Net", "Attributed", "Unattributed", "Action"]);
    // Only the payment with an unattributed remainder is queued, and its action is the match form.
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("STMT-9")).toBeInTheDocument();
    expect(within(table).queryByText("OK-1")).toBeNull();
    expect(within(table).getByRole("button", { name: "Match STMT-9" })).toBeInTheDocument();
    expect(within(table).getByText("Reported")).toHaveClass("ml-badge");
    expect(within(table).getByText("$5,000", { selector: "strong" })).toBeInTheDocument();
  });

  it("hides every write action from a role without payment.write, without hiding the records", async () => {
    state.role = "viewer";
    state.payments = [
      payment({
        id: "p2",
        reference: "STMT-9",
        status: "reported",
        allocatedTotal: usd(0),
        unallocated: usd(500000),
      }),
    ];
    state.statements = [{ filename: "s.csv", lines: [{ id: "l1", matchStatus: "suggested" }] }];
    await renderMoney();
    expect(screen.queryByTestId("record-payment")).toBeNull();
    expect(screen.queryByTestId("import-statement")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Record" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Statement lines awaiting confirmation" }),
    ).toBeNull();
    const table = screen.getByRole("table", { name: "Payments with unattributed amounts" });
    expect(within(table).queryByRole("columnheader", { name: "Action" })).toBeNull();
    expect(within(table).queryByRole("button")).toBeNull();
    expect(within(table).getByText("STMT-9")).toBeInTheDocument();
  });

  it("shows statement lines to a writer, with confirm actions and the file each line came from", async () => {
    state.statements = [
      {
        filename: "august.csv",
        lines: [
          {
            id: "l1",
            matchStatus: "suggested",
            externalReference: "AG-1",
            description: "Hotel",
            gross: usd(1000),
            deductions: usd(100),
            net: usd(900),
            matchBasis: "Reference matched",
            matchedSubmissionId: "s1",
          },
          { id: "l2", matchStatus: "confirmed" },
        ],
      },
    ];
    await renderMoney();
    const table = screen.getByRole("table", { name: "Open statement lines" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("august.csv")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Confirm l1" })).toBeInTheDocument();
    expect(screen.getByText("1 lines")).toBeInTheDocument();
  });

  it("says plainly when there is nothing to reconcile, no license, and no receivable", async () => {
    await renderMoney();
    expect(
      screen.getByRole("heading", { level: 3, name: "Nothing to reconcile" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "No licenses recorded yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Nothing outstanding" }),
    ).toBeInTheDocument();
    const recent = screen.getByRole("table", { name: "Payments received, newest first" });
    expect(
      within(recent).getByRole("cell", { name: "No payments have been received yet." }),
    ).toHaveAttribute("colspan", "7");
  });

  it("lists receivables as rows with the overdue one marked in words, not colour alone", async () => {
    state.payments = [
      payment({
        id: "p4",
        reference: "INV-2",
        status: "overdue",
        receivedAt: null,
        dueAt: "2026-08-12T00:00:00Z",
        net: usd(120000),
      }),
      payment({
        id: "p5",
        reference: "INV-3",
        status: "invoiced",
        receivedAt: null,
        dueAt: "2026-09-12T00:00:00Z",
        net: usd(80000),
      }),
    ];
    await renderMoney();
    const list = screen.getByRole("list", { name: "Receivables" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-priority", "high");
    expect(rows[0].querySelector(".ml-visually-hidden")).toHaveTextContent("Overdue:");
    expect(within(rows[0]).getByRole("heading", { level: 3 })).toHaveTextContent(
      "The Mega Agency · $1,200",
    );
    expect(within(rows[0]).getByText(/Overdue since/)).toBeInTheDocument();
    expect(within(rows[0]).getByText("Overdue", { selector: ".ml-badge" })).toBeInTheDocument();
    expect(rows[1]).not.toHaveAttribute("data-priority");
    expect(within(rows[1]).getByText(/^Due /)).toBeInTheDocument();
  });

  it("keeps the recent-payments and licenses columns and the archive link", async () => {
    state.payments = [payment({})];
    state.licenses = [
      {
        id: "L1",
        licenseeName: "Daily Ledger",
        origin: "mastline_sales_engine",
        media: "Web",
        territory: "US",
        saleBase: usd(100000),
        photographerShare: usd(70000),
        salesEngineShare: usd(30000),
      },
    ];
    await renderMoney();
    const recent = screen.getByRole("table", { name: "Payments received, newest first" });
    expect(
      within(recent)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Received", "Source", "Gross", "Deductions", "Sales Engine", "Tax", "Net"]);
    expect(within(recent).getByText("$3,900")).toBeInTheDocument();
    const licenses = screen.getByRole("table", { name: "Licenses recorded" });
    expect(within(licenses).getByText("Via Mastline")).toHaveAttribute("data-tone", "info");
    expect(within(licenses).getByText("$700", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the archive/ })).toHaveAttribute(
      "href",
      "/studio/archive",
    );
  });

  it("draws received-by-source as determinate bars against the largest source, with the amount in words", async () => {
    await renderMoney();
    const bars = screen.getAllByRole("progressbar");
    expect(bars.map((bar) => bar.getAttribute("aria-valuetext"))).toEqual(["$2,000", "$500"]);
    expect(bars[0]).toHaveAttribute("aria-valuenow", "200000");
    expect(bars[0]).toHaveAttribute("aria-valuemax", "200000");
    expect(bars[1].querySelector(".ml-progress__bar")).toHaveStyle({ width: "25%" });
  });

  it("nests no control inside another and keeps headings in order", async () => {
    state.payments = [
      payment({ id: "p2", status: "reported", allocatedTotal: usd(0), unallocated: usd(500000) }),
    ];
    await renderMoney();
    expect(document.querySelectorAll("a a, a button, button a, button button")).toHaveLength(0);
    const levels = Array.from(document.querySelectorAll("h1, h2, h3")).map((h) =>
      Number(h.tagName[1]),
    );
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1)
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });
});
