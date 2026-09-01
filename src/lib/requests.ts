/**
 * The lifecycle of a buyer request, as rules rather than as a screen.
 *
 * Pure and free of any database import, so the rules can be tested without one
 * and read from a client component. The writes live in src/lib/data/requests.ts
 * and the database enforces the half of this that must hold whatever a client
 * believes -- see 20260828035034_buyer_requests.sql.
 *
 * Why a table rather than a chain of ifs: a request is a conversation with a
 * picture desk, and conversations do not run in one direction. A qualified
 * request goes back to needs_clarification when the desk turns out to have
 * meant something else; a planned shoot falls through and becomes a matching
 * problem instead. What must never happen is a request coming back from the
 * dead, so every closed state has an empty row and both the transition table
 * and a database trigger say so.
 */

import type { Money } from "./money";
import { formatMoney } from "./money";
import type { BuyerRequest, RequestStatus } from "./domain";

/** What the interface renders when a buyer said nothing about a term. */
export const NOT_PROVIDED = "Not provided";

/**
 * The states a request does not come back from.
 *
 * Not "cannot return to an active state" but cannot move at all. Recording a
 * request as lost and then rewriting it as cancelled changes what happened, and
 * the commercial record is worth more than the convenience of tidying it. A
 * mistake here is corrected the way every other closed record in this system is
 * corrected: by an audited purge, not by an edit nobody can see.
 */
export const CLOSED_STATUSES: readonly RequestStatus[] = [
  "won",
  "lost",
  "expired",
  "declined",
  "cancelled",
];

export function isClosed(status: RequestStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

/**
 * Statuses the vocabulary contains and this phase cannot reach.
 *
 * `won` means a request turned into a license, and nothing in Mastline connects
 * those two records yet. Offering the button anyway would let somebody record
 * a win that points at no money, in the one product whose entire premise is
 * that a sale connects back to the work. It is in the enum so that Phase 2 adds
 * a link rather than a migration.
 */
export const UNAVAILABLE_STATUSES: readonly RequestStatus[] = ["won"];

/** Decisions that mean nothing without an explanation. */
export const REASON_REQUIRED_STATUSES: readonly RequestStatus[] = ["lost", "declined"];

export const REASON_MIN_LENGTH = 4;
export const REASON_MAX_LENGTH = 1000;

export function requiresReason(status: RequestStatus): boolean {
  return REASON_REQUIRED_STATUSES.includes(status);
}

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  // A draft is private and unposted. It can only be put into the inbox or
  // abandoned; it cannot be lost or declined, because nobody has seen it.
  draft: ["new", "cancelled"],
  new: ["needs_clarification", "qualified", "declined", "lost", "expired", "cancelled"],
  // Back to new is the ordinary path: the desk answered the question.
  needs_clarification: ["new", "qualified", "declined", "lost", "expired", "cancelled"],
  qualified: [
    "matching",
    "coverage_planned",
    "preparing_response",
    "needs_clarification",
    "declined",
    "lost",
    "expired",
    "cancelled",
  ],
  matching: [
    "coverage_planned",
    "preparing_response",
    "needs_clarification",
    "declined",
    "lost",
    "expired",
    "cancelled",
  ],
  coverage_planned: [
    "preparing_response",
    "matching",
    "needs_clarification",
    "declined",
    "lost",
    "expired",
    "cancelled",
  ],
  preparing_response: [
    "submitted",
    "matching",
    "coverage_planned",
    "declined",
    "lost",
    "expired",
    "cancelled",
  ],
  submitted: ["negotiating", "won", "lost", "declined", "expired", "cancelled"],
  negotiating: ["won", "lost", "declined", "expired", "cancelled"],
  won: [],
  lost: [],
  expired: [],
  declined: [],
  cancelled: [],
};

/**
 * Where a request may go from here, in this phase.
 *
 * `unfiltered` returns the whole row including states this phase cannot reach,
 * which is what a test comparing the table against the database enum needs. The
 * default filters them out, which is what a screen needs: a control nobody can
 * complete is worse than no control.
 */
export function allowedTransitions(
  from: RequestStatus,
  options: { readonly unfiltered?: boolean } = {},
): readonly RequestStatus[] {
  const all = TRANSITIONS[from];
  return options.unfiltered ? all : all.filter((next) => !UNAVAILABLE_STATUSES.includes(next));
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return allowedTransitions(from).includes(to);
}

export type RequestErrorReason =
  | "not_found"
  | "denied"
  | "conflict"
  | "invalid_status"
  | "invalid_transition"
  | "reason_required"
  | "reason_too_long"
  | "unavailable_in_phase"
  | "not_a_member"
  | "cross_workspace"
  | "unknown";

/** A refusal a form can render next to the control that caused it. */
export class RequestError extends Error {
  readonly reason: RequestErrorReason;

  constructor(reason: RequestErrorReason, message: string) {
    super(message);
    this.name = "RequestError";
    this.reason = reason;
  }
}

export interface TransitionCheck {
  readonly from: RequestStatus;
  readonly to: RequestStatus;
  readonly reason?: string | null;
}

/**
 * Everything that can be decided about a transition without a database.
 *
 * Returns the trimmed reason on success so the caller writes the same string
 * that was validated, rather than re-trimming and drifting.
 */
export function checkTransition(
  input: TransitionCheck,
): { ok: true; reason?: string } | { ok: false; error: RequestError } {
  const { from, to } = input;

  if (isClosed(from)) {
    return {
      ok: false,
      error: new RequestError(
        "invalid_transition",
        `This request is already recorded as ${statusLabel(from).toLowerCase()}. A closed request cannot be reopened.`,
      ),
    };
  }

  if (UNAVAILABLE_STATUSES.includes(to)) {
    return {
      ok: false,
      error: new RequestError(
        "unavailable_in_phase",
        "Recording a win means connecting this request to a license, and that connection does not exist yet.",
      ),
    };
  }

  if (!TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      error: new RequestError(
        "invalid_transition",
        `A request recorded as ${statusLabel(from).toLowerCase()} cannot be moved to ${statusLabel(to).toLowerCase()}.`,
      ),
    };
  }

  const reason = (input.reason ?? "").trim();

  if (requiresReason(to)) {
    if (reason.length < REASON_MIN_LENGTH) {
      return {
        ok: false,
        error: new RequestError(
          "reason_required",
          `Recording this as ${statusLabel(to).toLowerCase()} needs a reason. Give at least ${REASON_MIN_LENGTH} characters.`,
        ),
      };
    }
  }

  if (reason.length > REASON_MAX_LENGTH) {
    return {
      ok: false,
      error: new RequestError(
        "reason_too_long",
        `Keep the reason under ${REASON_MAX_LENGTH} characters.`,
      ),
    };
  }

  return { ok: true, reason: reason === "" ? undefined : reason };
}

const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Draft",
  new: "New",
  needs_clarification: "Needs clarification",
  qualified: "Qualified",
  matching: "Matching archive",
  coverage_planned: "Coverage planned",
  preparing_response: "Preparing response",
  submitted: "Submitted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  expired: "Expired",
  declined: "Declined",
  cancelled: "Cancelled",
};

export function statusLabel(status: RequestStatus): string {
  return STATUS_LABELS[status];
}

/**
 * Colour is a second signal and never the only one.
 *
 * Every place these tones are used renders the status word beside them, so a
 * screen read in greyscale, in sunlight, or by somebody who does not
 * distinguish red from amber loses nothing.
 */
export type StatusTone = "neutral" | "good" | "warn" | "danger" | "blue";

const STATUS_TONES: Record<RequestStatus, StatusTone> = {
  draft: "neutral",
  new: "blue",
  needs_clarification: "warn",
  qualified: "blue",
  matching: "blue",
  coverage_planned: "blue",
  preparing_response: "warn",
  submitted: "good",
  negotiating: "warn",
  won: "good",
  lost: "danger",
  expired: "neutral",
  declined: "neutral",
  cancelled: "neutral",
};

export function statusTone(status: RequestStatus): StatusTone {
  return STATUS_TONES[status];
}

/**
 * Whether the buyer's deadline has gone by on a request still in play.
 *
 * Derived at read time, never written. Nothing in this system moves a request
 * to `expired` because a clock passed a number: there is no scheduler to do it,
 * and a status that changes while nobody is watching is one nobody can rely on.
 * A closed request is never past its deadline -- it is finished, and saying
 * otherwise would put a red flag on completed work for ever.
 */
export function isPastDeadline(
  request: Pick<BuyerRequest, "responseDeadline" | "status">,
  now: Date,
): boolean {
  if (!request.responseDeadline) return false;
  if (isClosed(request.status)) return false;
  return new Date(request.responseDeadline).getTime() < now.getTime();
}

/** The same question about the request's own expiry date. */
export function isPastExpiry(
  request: Pick<BuyerRequest, "expiresAt" | "status">,
  now: Date,
): boolean {
  if (!request.expiresAt) return false;
  if (isClosed(request.status)) return false;
  return new Date(request.expiresAt).getTime() < now.getTime();
}

const NEXT_ACTIONS: Record<RequestStatus, string> = {
  draft: "Post it to the inbox",
  new: "Qualify it, or ask what they mean",
  needs_clarification: "Chase the answer",
  qualified: "Plan coverage, or search the archive",
  matching: "Confirm what already exists",
  coverage_planned: "Prepare the response",
  preparing_response: "Send it, then record the submission",
  submitted: "Record what the desk said",
  negotiating: "Settle the terms",
  won: "Closed",
  lost: "Closed",
  expired: "Closed",
  declined: "Closed",
  cancelled: "Closed",
};

/**
 * The one thing to do next, in the operator's words.
 *
 * A past deadline outranks the status: a request that has been sitting in
 * needs_clarification since Tuesday needs chasing today, whatever the queue
 * order says.
 */
export function nextAction(request: BuyerRequest, now: Date): string {
  if (isPastDeadline(request, now)) return "Past deadline — answer or close it";
  return NEXT_ACTIONS[request.status];
}

/**
 * What a request's budget says, in one string.
 *
 * The three cases are genuinely different and the interface must not collapse
 * them: nothing was said, a range was given, or a single figure was. A disclosed
 * zero renders as a currency amount, because "$0.00" is a desk telling you there
 * is no money in it -- which is information -- and "Not provided" is a desk that
 * never raised the subject.
 */
export function describeBudget(
  request: Pick<BuyerRequest, "budgetDisclosed" | "budgetMin" | "budgetMax">,
  locale = "en-US",
): string {
  if (!request.budgetDisclosed) return NOT_PROVIDED;

  const { budgetMin: min, budgetMax: max } = request;
  if (min && max) {
    return min.minor === max.minor
      ? formatMoney(min, { locale })
      : `${formatMoney(min, { locale })} – ${formatMoney(max, { locale })}`;
  }
  if (min) return `From ${formatMoney(min, { locale })}`;
  if (max) return `Up to ${formatMoney(max, { locale })}`;

  // Unreachable through the data layer: a check constraint refuses a disclosed
  // budget with no figures in it. Handled anyway rather than rendering "undefined".
  return NOT_PROVIDED;
}

/** Any optional term, rendered so silence is legible as silence. */
export function orNotProvided(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? NOT_PROVIDED : trimmed;
}

/** A quantity nobody stated is not zero. */
export function describeQuantity(quantity: number | undefined): string {
  return quantity === undefined || quantity === null ? NOT_PROVIDED : `≈ ${quantity}`;
}

export interface BudgetInput {
  readonly disclosed: boolean;
  readonly min?: Money;
  readonly max?: Money;
}

/**
 * The budget rules, as the database states them.
 *
 * Kept here as well as in a check constraint because a form has to be able to
 * say which field is wrong before the round trip, and because "a budget cannot
 * exist without a disclosure" is a business rule rather than a storage detail.
 */
export function checkBudget(input: BudgetInput): { ok: true } | { ok: false; message: string } {
  if (!input.disclosed) {
    if (input.min || input.max) {
      return {
        ok: false,
        message: "Tick that a budget was given before entering one, or clear the figures.",
      };
    }
    return { ok: true };
  }

  if (!input.min && !input.max) {
    return {
      ok: false,
      message: "Give the figure the buyer stated, or untick that they gave one.",
    };
  }

  if (input.min && input.max && input.min.minor > input.max.minor) {
    return { ok: false, message: "The maximum cannot be below the minimum." };
  }

  return { ok: true };
}
