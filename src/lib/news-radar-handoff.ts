import type { Id } from "./domain";
import type { RightsFact, ShootBrief } from "./news-radar-evaluation";

/**
 * News Radar handoffs: the pure rules.
 *
 * What a person may select from an archive evaluation, how a selection is
 * grouped and refused, what a confirmed shoot brief is allowed to carry, and
 * what each classified outcome says on screen. No server imports, no clock,
 * no database: the data layer and the components call these; the tests pin
 * them.
 *
 * Nothing here decides for the person. A restricted frame is not dropped,
 * it is explained; a suggestion is not promoted, it is labelled; a fact is
 * not copied, it is confirmed.
 */

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export const HANDOFF_OUTCOMES = [
  "created",
  "existing",
  "stale_evaluation",
  "invalid_selection",
  "needs_context",
  "path_closed",
  "forbidden",
  "not_found",
  "failed",
] as const;

export type HandoffOutcome = (typeof HANDOFF_OUTCOMES)[number];

export function isHandoffOutcome(value: unknown): value is HandoffOutcome {
  return typeof value === "string" && (HANDOFF_OUTCOMES as readonly string[]).includes(value);
}

/** Why a selection was refused. Mirrors the reasons the database function names. */
export const SELECTION_REASONS = [
  "empty",
  "not_matched",
  "restricted",
  "no_shoot",
  "mixed_shoots",
  "no_file",
  "request_key",
  "shape",
  "title",
  "location",
  "priority",
  "notes",
  "time",
  "timezone",
] as const;

export type SelectionReason = (typeof SELECTION_REASONS)[number];

export function isSelectionReason(value: unknown): value is SelectionReason {
  return typeof value === "string" && (SELECTION_REASONS as readonly string[]).includes(value);
}

export const SELECTION_REASON_LABELS: Record<SelectionReason, string> = {
  empty: "Select at least one photograph first.",
  not_matched:
    "A selected photograph is not one of this evaluation's recorded matches. Only matched photographs can enter the draft.",
  restricted:
    "A selected photograph is restricted. Restricted photographs cannot enter a package until their status is reviewed; unselect it to continue.",
  no_shoot:
    "A selected photograph is not on any shoot. A package belongs to a shoot, so attach the photograph to one first.",
  mixed_shoots:
    "The selection spans more than one shoot. A package belongs to one shoot; select photographs from one shoot at a time.",
  no_file: "A selected photograph has no stored file to send.",
  request_key: "The confirmation could not be identified. Reload and confirm again.",
  shape: "The confirmation could not be read. Reload and confirm again.",
  title: "Give the shoot a title of up to 200 characters.",
  location: "Keep the location under 200 characters.",
  priority: "Choose a priority.",
  notes: "Keep the notes under 4000 characters.",
  time: "The event time could not be read, or the end is before the start.",
  timezone: "That time zone is not recognised.",
};

/** What the screen says for each outcome that is not `created`. */
export const HANDOFF_OUTCOME_LABELS: Record<Exclude<HandoffOutcome, "created">, string> = {
  existing:
    "This path was already handed off. Nothing new was created; you are looking at what exists.",
  stale_evaluation:
    "News Radar was re-evaluated after this page loaded. Review the current result before confirming again.",
  invalid_selection: "The selection could not be handed off.",
  needs_context:
    "This path has no evaluation result to hand off from. Evaluate it first, and record context if it asks for some.",
  path_closed: "This path is no longer open: it was acted on, dismissed, or has expired.",
  forbidden: "Your role may not create drafts from News Radar. An owner or editor can.",
  not_found: "That opportunity is not in this workspace.",
  failed: "The draft could not be created. Nothing was changed.",
};

// ---------------------------------------------------------------------------
// Archive selection
// ---------------------------------------------------------------------------

/** The facts about one matched photograph that decide whether it may be selected. */
export interface SelectableMatch {
  readonly assetId: Id;
  readonly rank: number;
  readonly shootId?: Id;
  readonly shootTitle?: string;
  readonly restricted: boolean;
  readonly metadataComplete: boolean;
  readonly rights: readonly RightsFact[];
  readonly hasFile: boolean;
}

export type IneligibleReason = "restricted" | "no_shoot" | "no_file" | "unreadable";

export const INELIGIBLE_LABELS: Record<IneligibleReason, string> = {
  restricted: "Restricted — cannot enter a package until its status is reviewed",
  no_shoot: "Not on a shoot — a package belongs to a shoot",
  no_file: "No stored file to send",
  unreadable: "Photograph no longer readable",
};

/** Why one match cannot be selected, or undefined when it can. */
export function ineligibleReason(match: SelectableMatch): IneligibleReason | undefined {
  if (match.restricted) return "restricted";
  if (!match.shootId) return "no_shoot";
  if (!match.hasFile) return "no_file";
  return undefined;
}

export interface MatchGroup {
  readonly shootId?: Id;
  readonly shootTitle: string;
  readonly matches: readonly SelectableMatch[];
  readonly eligibleCount: number;
}

/**
 * Matches grouped by the shoot they sit on, in rank order within each group,
 * groups in order of their best-ranked member. Frames on no shoot form a
 * final group of their own, so what cannot be packaged is shown rather than
 * hidden.
 */
export function groupMatchesByShoot(matches: readonly SelectableMatch[]): readonly MatchGroup[] {
  const groups = new Map<string, SelectableMatch[]>();
  for (const match of [...matches].sort((a, b) => a.rank - b.rank)) {
    const key = match.shootId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), match]);
  }
  const ordered = [...groups.entries()].sort(([keyA, a], [keyB, b]) => {
    if (keyA === "") return 1;
    if (keyB === "") return -1;
    return a[0].rank - b[0].rank;
  });
  return ordered.map(([key, members]) => ({
    shootId: key || undefined,
    shootTitle: key ? (members[0].shootTitle ?? "Untitled shoot") : "Not on a shoot",
    matches: members,
    eligibleCount: members.filter((match) => ineligibleReason(match) === undefined).length,
  }));
}

export interface SelectionReview {
  /** The selected ids that may proceed, in rank order. */
  readonly eligible: readonly Id[];
  /** Selected ids that cannot proceed, each with why. */
  readonly blocked: readonly { assetId: Id; reason: IneligibleReason }[];
  /** Selected ids that are eligible but have incomplete metadata: allowed, but said. */
  readonly incompleteMetadata: readonly Id[];
  /** Selected ids that carry a recorded restriction or incomplete rights: allowed, but said. */
  readonly rightsAttention: readonly Id[];
  /** The shoots the selection touches. More than one is a refusal. */
  readonly shootIds: readonly Id[];
  /** The one refusal the selection as a whole earns, or undefined. */
  readonly refusal?: Extract<
    SelectionReason,
    "empty" | "mixed_shoots" | "restricted" | "no_shoot" | "no_file"
  >;
}

/**
 * Review a selection the way the database will, so the confirmation step can
 * explain every problem before anything is sent. Selected ids that are not
 * among the matches are ignored here (the server refuses them as
 * `not_matched`; the interface never offers them).
 */
export function reviewSelection(
  matches: readonly SelectableMatch[],
  selectedIds: readonly Id[],
): SelectionReview {
  const byId = new Map(matches.map((match) => [match.assetId, match]));
  const selected = [...new Set(selectedIds)]
    .map((id) => byId.get(id))
    .filter((match): match is SelectableMatch => match !== undefined)
    .sort((a, b) => a.rank - b.rank);

  const blocked: { assetId: Id; reason: IneligibleReason }[] = [];
  const eligible: Id[] = [];
  for (const match of selected) {
    const reason = ineligibleReason(match);
    if (reason) blocked.push({ assetId: match.assetId, reason });
    else eligible.push(match.assetId);
  }
  const shootIds = [
    ...new Set(selected.map((match) => match.shootId).filter((id): id is Id => id !== undefined)),
  ];

  let refusal: SelectionReview["refusal"];
  if (selected.length === 0) refusal = "empty";
  else if (blocked.some((entry) => entry.reason === "restricted")) refusal = "restricted";
  else if (blocked.some((entry) => entry.reason === "no_shoot")) refusal = "no_shoot";
  else if (blocked.some((entry) => entry.reason === "no_file")) refusal = "no_file";
  else if (shootIds.length > 1) refusal = "mixed_shoots";

  return {
    eligible,
    blocked,
    incompleteMetadata: selected
      .filter((match) => !match.metadataComplete)
      .map((match) => match.assetId),
    rightsAttention: selected
      .filter((match) =>
        match.rights.some(
          (fact) => fact === "restriction_recorded" || fact === "rights_incomplete",
        ),
      )
      .map((match) => match.assetId),
    shootIds,
    refusal,
  };
}

// ---------------------------------------------------------------------------
// Shoot confirmation
// ---------------------------------------------------------------------------

export const SHOOT_TITLE_MAX = 200;
export const SHOOT_LOCATION_MAX = 200;
export const SHOOT_NOTES_MAX = 4000;
export const SHOOT_PEOPLE_MAX = 20;

export const SHOOT_PRIORITIES = ["watch", "standard", "high", "urgent"] as const;
export type ShootHandoffPriority = (typeof SHOOT_PRIORITIES)[number];

/** What the person confirmed, as the server receives it. */
export interface ConfirmedShootFields {
  readonly title: string;
  readonly locationName?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly timezone?: string;
  readonly priority: ShootHandoffPriority;
  /** People the person confirmed are expected. Never copied unconfirmed. */
  readonly people: readonly string[];
  /** Which of the brief's suggestions the person chose to carry into the notes. */
  readonly copiedSuggestions: readonly string[];
  /** Free notes typed by the person. */
  readonly ownNotes?: string;
}

export type ConfirmedShootErrors = Partial<
  Record<
    | "title"
    | "locationName"
    | "startsAt"
    | "endsAt"
    | "timezone"
    | "priority"
    | "people"
    | "ownNotes"
    | "_form",
    string
  >
>;

export type ParsedShootConfirmation =
  | { readonly ok: true; readonly value: ConfirmedShootFields }
  | { readonly ok: false; readonly errors: ConfirmedShootErrors };

/** The brief facts the form was rendered from, so what may be confirmed is bounded. */
export interface ShootBriefFacts {
  readonly knownLocation?: string;
  readonly eventStartsAt?: string;
  readonly eventEndsAt?: string;
  readonly knownPeople: readonly string[];
  readonly suggestedAngle?: string;
  readonly suggestedShots: readonly string[];
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function isoOrUndefined(value: string): string | undefined | null {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Read the confirmation form.
 *
 * An authoritative field enters the draft only when its checkbox is on AND
 * a value is present: a ticked box beside an empty field confirms nothing.
 * People and suggestions are chosen one by one; a name or a line that was
 * not offered by the brief is ignored, so the browser cannot smuggle a
 * "fact" in through the confirm step.
 */
export function parseShootConfirmation(
  form: FormData,
  brief: ShootBriefFacts,
): ParsedShootConfirmation {
  const errors: ConfirmedShootErrors = {};

  const title = text(form, "title");
  if (!title) errors.title = "Give the shoot a title.";
  else if (title.length > SHOOT_TITLE_MAX) {
    errors.title = `Keep the title under ${SHOOT_TITLE_MAX} characters.`;
  }

  const confirmLocation = form.get("confirmLocation") === "on";
  const locationName = text(form, "locationName");
  if (confirmLocation && !locationName) {
    errors.locationName = "Confirm a location, or leave it unconfirmed.";
  } else if (locationName.length > SHOOT_LOCATION_MAX) {
    errors.locationName = `Keep the location under ${SHOOT_LOCATION_MAX} characters.`;
  }

  const confirmTime = form.get("confirmTime") === "on";
  const startsAt = isoOrUndefined(text(form, "startsAt"));
  const endsAt = isoOrUndefined(text(form, "endsAt"));
  if (startsAt === null) errors.startsAt = "That date and time could not be read.";
  if (endsAt === null) errors.endsAt = "That date and time could not be read.";
  if (confirmTime && !startsAt) errors.startsAt = "Confirm a start time, or leave it unconfirmed.";
  if (startsAt && endsAt && endsAt < startsAt) errors.endsAt = "The end must be after the start.";

  const confirmTimezone = form.get("confirmTimezone") === "on";
  const timezone = text(form, "timezone");
  if (confirmTimezone && !timezone) {
    errors.timezone = "Confirm a time zone, or leave it unconfirmed.";
  } else if (timezone && !isPlausibleTimezone(timezone)) {
    errors.timezone = "That time zone is not recognised.";
  }

  const priorityRaw = text(form, "priority") || "standard";
  const priority = (SHOOT_PRIORITIES as readonly string[]).includes(priorityRaw)
    ? (priorityRaw as ShootHandoffPriority)
    : undefined;
  if (!priority) errors.priority = "Choose a priority.";

  const offeredPeople = new Set(brief.knownPeople);
  const people = form
    .getAll("people")
    .map(String)
    .filter((name) => offeredPeople.has(name));
  if (people.length > SHOOT_PEOPLE_MAX) errors.people = `Confirm up to ${SHOOT_PEOPLE_MAX} people.`;

  const offered = new Set([
    ...(brief.suggestedAngle ? [`angle:${brief.suggestedAngle}`] : []),
    ...brief.suggestedShots.map((shot) => `shot:${shot}`),
  ]);
  const copiedSuggestions = form
    .getAll("copiedSuggestions")
    .map(String)
    .filter((line) => offered.has(line));

  const ownNotes = text(form, "ownNotes");
  if (ownNotes.length > SHOOT_NOTES_MAX)
    errors.ownNotes = `Keep the notes under ${SHOOT_NOTES_MAX} characters.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      title,
      locationName: confirmLocation ? locationName : undefined,
      startsAt: confirmTime ? (startsAt ?? undefined) : undefined,
      endsAt: confirmTime ? (endsAt ?? undefined) : undefined,
      timezone: confirmTimezone ? timezone : undefined,
      priority: priority as ShootHandoffPriority,
      people: [...new Set(people)],
      copiedSuggestions: [...new Set(copiedSuggestions)],
      ownNotes: ownNotes || undefined,
    },
  };
}

/** Enough to refuse garbage; the database checks the name against its own list. */
export function isPlausibleTimezone(value: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_+\-/]{0,63}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The notes the draft shoot carries, assembled only from what was confirmed
 * or deliberately copied, each paragraph labelled as what it is. Suggestions
 * are written as suggestions; they never become the story angle.
 */
export function composeShootNotes(
  confirmed: ConfirmedShootFields,
  storyTitle: string,
): string | undefined {
  const paragraphs: string[] = [`From News Radar story: ${storyTitle}`];
  if (confirmed.people.length > 0) {
    paragraphs.push(
      `People expected (confirmed by the photographer): ${confirmed.people.join(", ")}`,
    );
  }
  const angle = confirmed.copiedSuggestions.find((line) => line.startsWith("angle:"));
  if (angle)
    paragraphs.push(`Suggested angle (News Radar suggestion, not confirmed): ${angle.slice(6)}`);
  const shots = confirmed.copiedSuggestions
    .filter((line) => line.startsWith("shot:"))
    .map((line) => line.slice(5));
  if (shots.length > 0) {
    paragraphs.push(
      `Suggested shots (News Radar suggestions, not confirmed):\n${shots.map((shot) => `- ${shot}`).join("\n")}`,
    );
  }
  if (confirmed.ownNotes) paragraphs.push(confirmed.ownNotes);
  const notes = paragraphs.join("\n\n");
  return notes.length > SHOOT_NOTES_MAX ? notes.slice(0, SHOOT_NOTES_MAX) : notes;
}

/** What the confirmation step lists as still unconfirmed for an incomplete draft. */
export function unconfirmedFacts(
  confirmed: ConfirmedShootFields,
  brief: ShootBriefFacts,
): readonly string[] {
  const missing: string[] = [];
  if (!confirmed.locationName) {
    missing.push(
      brief.knownLocation ? "Location (recorded, not confirmed)" : "Location (not recorded)",
    );
  }
  if (!confirmed.startsAt) {
    missing.push(
      brief.eventStartsAt ? "Event time (recorded, not confirmed)" : "Event time (not recorded)",
    );
  }
  if (!confirmed.timezone) missing.push("Time zone (not confirmed)");
  if (confirmed.people.length === 0) {
    missing.push(
      brief.knownPeople.length > 0
        ? "People expected (recorded, none confirmed)"
        : "People expected (none recorded)",
    );
  }
  return missing;
}

/** The brief facts a form needs, taken from a stored brief. */
export function briefFacts(
  brief: Pick<
    ShootBrief,
    | "knownLocation"
    | "eventStartsAt"
    | "eventEndsAt"
    | "knownPeople"
    | "suggestedAngle"
    | "suggestedShots"
  >,
): ShootBriefFacts {
  return {
    knownLocation: brief.knownLocation,
    eventStartsAt: brief.eventStartsAt,
    eventEndsAt: brief.eventEndsAt,
    knownPeople: brief.knownPeople,
    suggestedAngle: brief.suggestedAngle,
    suggestedShots: brief.suggestedShots,
  };
}

// ---------------------------------------------------------------------------
// Request keys
// ---------------------------------------------------------------------------

export const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isRequestKey(value: string): boolean {
  return REQUEST_KEY_PATTERN.test(value);
}
