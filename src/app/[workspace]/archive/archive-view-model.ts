import type { ArchiveResult, EarningFilter } from "@/lib/data/archive";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { WorkspaceRoutes } from "@/lib/workspace-routes";

/**
 * The archive's presentation model.
 *
 * Everything here formats or selects a fact the search already returned. It
 * adds nothing: no inferred location, no estimated value, no state the
 * database does not hold. The screen reads from these shapes so the components
 * stay free of string-building, and so the rules can be tested without a
 * browser.
 */

export type ArchiveView = "grid" | "list";

export interface ArchiveState {
  readonly query: string;
  readonly filter: EarningFilter;
  readonly page: number;
  readonly view: ArchiveView;
}

export const COMMERCIAL_FILTERS: readonly { value: EarningFilter; label: string }[] = [
  { value: "all", label: "All assets" },
  { value: "unsold", label: "No recorded sale" },
  { value: "earning", label: "Has earned" },
];

export function filterLabel(filter: EarningFilter): string {
  return COMMERCIAL_FILTERS.find((entry) => entry.value === filter)?.label ?? "All assets";
}

/** Read the address into a state, ignoring anything it does not recognise. */
export function parseArchiveState(params: {
  q?: string;
  filter?: string;
  page?: string;
  view?: string;
}): ArchiveState {
  const query = (params.q ?? "").trim();
  const filter = COMMERCIAL_FILTERS.find((entry) => entry.value === params.filter)?.value ?? "all";
  const page = Math.max(Math.floor(Number(params.page ?? 1)) || 1, 1);
  const view: ArchiveView = params.view === "list" ? "list" : "grid";
  return { query, filter, page, view };
}

/**
 * The address for a change of state.
 *
 * A new query or filter starts again from the first page, because page 4 of a
 * different result set is not a place anybody meant to go. Defaults are
 * dropped from the address so the plain archive stays at the plain address.
 */
export function archiveHref(
  routes: WorkspaceRoutes,
  state: ArchiveState,
  changes: Partial<ArchiveState> = {},
): string {
  const next: ArchiveState = { ...state, ...changes };
  const restarts =
    (changes.query !== undefined && changes.query !== state.query) ||
    (changes.filter !== undefined && changes.filter !== state.filter);
  const page = changes.page !== undefined ? changes.page : restarts ? 1 : next.page;

  return routes.archive({
    query: {
      q: next.query || undefined,
      filter: next.filter === "all" ? undefined : next.filter,
      view: next.view === "grid" ? undefined : next.view,
      page: page > 1 ? page : undefined,
    },
  });
}

export type CommercialKind = "earned" | "sent" | "never_sent";

export interface CommercialState {
  readonly kind: CommercialKind;
  /** The state in words: "Has earned", "2 packages", "Never sent". */
  readonly label: string;
  /** A second fact, when there is one: the package count, or "No recorded sale". */
  readonly detail?: string;
  /** Lifetime earnings, formatted. Only present when something was recorded. */
  readonly amount?: string;
}

function packages(count: number): string {
  return `${count} ${count === 1 ? "package" : "packages"}`;
}

/**
 * What has happened to a photograph commercially, from the two facts the
 * search returns: how many packages it went out in, and what was allocated to
 * it from payments.
 */
export function commercialState(result: ArchiveResult): CommercialState {
  if (result.lifetimeEarnings.minor > 0) {
    return {
      kind: "earned",
      label: "Has earned",
      detail: result.submissionCount > 0 ? packages(result.submissionCount) : undefined,
      amount: formatMoney(result.lifetimeEarnings),
    };
  }
  if (result.submissionCount > 0) {
    return {
      kind: "sent",
      label: packages(result.submissionCount),
      detail: "No recorded sale",
    };
  }
  return { kind: "never_sent", label: "Never sent" };
}

export interface ArchiveCard {
  readonly assetId: string;
  readonly href: string;
  readonly title: string;
  /** True when there is no headline and the filename stands in for one. */
  readonly titleIsFilename: boolean;
  readonly caption?: string;
  readonly capturedAt?: string;
  readonly capturedLabel?: string;
  readonly previewUrl?: string;
  readonly commercial: CommercialState;
}

export function toArchiveCard(
  result: ArchiveResult,
  routes: WorkspaceRoutes,
  previewUrls: ReadonlyMap<string, string>,
): ArchiveCard {
  const caption = result.caption?.trim();
  return {
    assetId: result.assetId,
    href: routes.asset(result.assetId),
    title: result.headline ?? result.canonicalFilename,
    titleIsFilename: !result.headline,
    // A caption that only repeats the headline is not a second fact.
    caption: caption && caption !== result.headline ? caption : undefined,
    capturedAt: result.capturedAt,
    capturedLabel: result.capturedAt
      ? formatDate(result.capturedAt, { withYear: true })
      : undefined,
    previewUrl: result.previewObjectKey ? previewUrls.get(result.previewObjectKey) : undefined,
    commercial: commercialState(result),
  };
}

export interface ActiveConstraint {
  readonly key: "query" | "filter";
  readonly label: string;
  readonly removeHref: string;
}

/** The constraints narrowing the results, each with the address that drops it. */
export function activeConstraints(
  routes: WorkspaceRoutes,
  state: ArchiveState,
): ActiveConstraint[] {
  const constraints: ActiveConstraint[] = [];
  if (state.query) {
    constraints.push({
      key: "query",
      label: `“${state.query}”`,
      removeHref: archiveHref(routes, state, { query: "" }),
    });
  }
  if (state.filter !== "all") {
    constraints.push({
      key: "filter",
      label: filterLabel(state.filter),
      removeHref: archiveHref(routes, state, { filter: "all" }),
    });
  }
  return constraints;
}

export type PageToken = number | "gap";

/**
 * Which page numbers to offer: the first, the last, the current page and its
 * neighbours, with a gap wherever pages are skipped. Never more than seven
 * entries, so the control is the same width on page 1 and page 140.
 */
export function pageWindow(page: number, totalPages: number): PageToken[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const current = Math.min(Math.max(page, 1), totalPages);
  let low = Math.max(2, current - 1);
  let high = Math.min(totalPages - 1, current + 1);
  // Keep three in the middle even at the ends, so the width holds.
  if (current <= 3) high = 4;
  if (current >= totalPages - 2) low = totalPages - 3;

  const tokens: PageToken[] = [1];
  if (low > 2) tokens.push("gap");
  for (let n = low; n <= high; n += 1) tokens.push(n);
  if (high < totalPages - 1) tokens.push("gap");
  tokens.push(totalPages);
  return tokens;
}

/** The positions shown on a page, one-based and clamped to the total. */
export function resultRange(
  page: number,
  pageSize: number,
  total: number,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from: Math.min(from, total), to: Math.min(page * pageSize, total) };
}

const COUNT = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return COUNT.format(value);
}

export function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}
