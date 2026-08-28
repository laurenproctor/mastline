/**
 * A request arriving from outside.
 *
 * Pure, and deliberately free of `node:crypto` so the public form can import
 * the limits it renders against without dragging a server module into the
 * browser bundle. Token generation lives in `src/lib/data/request-intake.ts`,
 * which is `server-only`.
 *
 * Every limit here mirrors a check constraint on `buyer_requests` or
 * `request_intake_links`. The database is the authority; these exist so a
 * recipient is told what is wrong beside the field rather than by a failed
 * round trip.
 */

/** The database check, mirrored so a bad token fails before it reaches Postgres. */
export function isIntakeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

export const INTAKE_WINDOWS_DAYS = [3, 7, 14, 30] as const;
export type IntakeWindowDays = (typeof INTAKE_WINDOWS_DAYS)[number];
export const DEFAULT_INTAKE_WINDOW: IntakeWindowDays = 14;

export function isIntakeWindow(days: number): days is IntakeWindowDays {
  return (INTAKE_WINDOWS_DAYS as readonly number[]).includes(days);
}

export function intakeExpiryFrom(days: IntakeWindowDays, now: Date): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function intakeUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/r/${token}`;
}

/**
 * Field limits, mirroring the schema.
 *
 * TOTAL_BYTES is the one that is not a column constraint. It caps the whole
 * submission so a form post cannot be used to push megabytes through a
 * function that anyone holding a link may call.
 */
export const INTAKE_LIMITS = {
  title: 200,
  brief: 4000,
  subjectOrEvent: 300,
  locationName: 300,
  deliverables: 2000,
  usageMedia: 500,
  territory: 500,
  usageDuration: 500,
  exclusivity: 500,
  usageRestrictions: 2000,
  submitterName: 120,
  TOTAL_BYTES: 32_000,
} as const;

export const SUBMITTER_NAME_MIN = 2;

/** What the public form collects. Everything but a title may be left unsaid. */
export interface IntakeSubmission {
  readonly title: string;
  readonly brief?: string;
  readonly subjectOrEvent?: string;
  readonly eventAt?: string;
  readonly locationName?: string;
  readonly responseDeadline?: string;
  readonly deliverables?: string;
  readonly requestedFormats?: readonly string[];
  readonly usageMedia?: string;
  readonly territory?: string;
  readonly usageDuration?: string;
  readonly exclusivity?: string;
  readonly budgetDisclosed: boolean;
  readonly budgetMinMinor?: number;
  readonly budgetMaxMinor?: number;
  readonly currency?: string;
  readonly embargoUntil?: string;
  readonly usageRestrictions?: string;
  readonly submitterName?: string;
}

export type IntakeFailure =
  | "title_required"
  | "title_too_long"
  | "too_long"
  | "too_large"
  | "name_too_short"
  | "budget_incomplete"
  | "budget_backwards"
  | "bad_date";

export interface IntakeParse {
  readonly ok: boolean;
  readonly failure?: IntakeFailure;
  readonly field?: string;
  readonly value?: IntakeSubmission;
}

function tooLong(value: string | undefined, limit: number): boolean {
  return value !== undefined && value.length > limit;
}

function badDate(value: string | undefined): boolean {
  return value !== undefined && value !== "" && Number.isNaN(Date.parse(value));
}

/**
 * Validate what a stranger typed.
 *
 * The rule that matters commercially is the one about absence. A desk that did
 * not say which territory it wants has not asked for worldwide, and one that
 * said nothing about money has not offered zero. Empty strings become
 * `undefined` here and null in the database; nothing is defaulted to a broad
 * right nobody negotiated.
 */
export function parseIntake(raw: Record<string, unknown>): IntakeParse {
  const text = (key: string): string | undefined => {
    const value = raw[key];
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  };

  const title = text("title");
  if (!title) return { ok: false, failure: "title_required", field: "title" };
  if (title.length > INTAKE_LIMITS.title)
    return { ok: false, failure: "title_too_long", field: "title" };

  const lengths: ReadonlyArray<[string, string | undefined, number]> = [
    ["brief", text("brief"), INTAKE_LIMITS.brief],
    ["subjectOrEvent", text("subjectOrEvent"), INTAKE_LIMITS.subjectOrEvent],
    ["locationName", text("locationName"), INTAKE_LIMITS.locationName],
    ["deliverables", text("deliverables"), INTAKE_LIMITS.deliverables],
    ["usageMedia", text("usageMedia"), INTAKE_LIMITS.usageMedia],
    ["territory", text("territory"), INTAKE_LIMITS.territory],
    ["usageDuration", text("usageDuration"), INTAKE_LIMITS.usageDuration],
    ["exclusivity", text("exclusivity"), INTAKE_LIMITS.exclusivity],
    ["usageRestrictions", text("usageRestrictions"), INTAKE_LIMITS.usageRestrictions],
  ];
  for (const [field, value, limit] of lengths) {
    if (tooLong(value, limit)) return { ok: false, failure: "too_long", field };
  }

  const submitterName = text("submitterName");
  if (submitterName !== undefined && submitterName.length < SUBMITTER_NAME_MIN)
    return { ok: false, failure: "name_too_short", field: "submitterName" };
  if (tooLong(submitterName, INTAKE_LIMITS.submitterName))
    return { ok: false, failure: "too_long", field: "submitterName" };

  for (const field of ["eventAt", "responseDeadline", "embargoUntil"] as const) {
    if (badDate(text(field))) return { ok: false, failure: "bad_date", field };
  }

  // Budget: a figure cannot exist unless somebody said one, and a disclosure
  // with no figure in it is not a disclosure. Same pair of rules the schema
  // enforces, answered here so the form can point at the control.
  const disclosed = raw.budgetDisclosed === true || raw.budgetDisclosed === "on";
  const minor = (key: string): number | undefined => {
    const value = text(key);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : undefined;
  };
  const budgetMinMinor = disclosed ? minor("budgetMin") : undefined;
  const budgetMaxMinor = disclosed ? minor("budgetMax") : undefined;
  if (disclosed && budgetMinMinor === undefined && budgetMaxMinor === undefined)
    return { ok: false, failure: "budget_incomplete", field: "budgetMin" };
  if (
    budgetMinMinor !== undefined &&
    budgetMaxMinor !== undefined &&
    budgetMinMinor > budgetMaxMinor
  )
    return { ok: false, failure: "budget_backwards", field: "budgetMax" };

  const formats = Array.isArray(raw.requestedFormats)
    ? raw.requestedFormats.filter((f): f is string => typeof f === "string" && f.trim() !== "")
    : typeof raw.requestedFormats === "string" && raw.requestedFormats.trim() !== ""
      ? raw.requestedFormats.split(",").map((f) => f.trim())
      : [];

  const value: IntakeSubmission = {
    title,
    brief: text("brief"),
    subjectOrEvent: text("subjectOrEvent"),
    eventAt: text("eventAt"),
    locationName: text("locationName"),
    responseDeadline: text("responseDeadline"),
    deliverables: text("deliverables"),
    requestedFormats: formats,
    usageMedia: text("usageMedia"),
    territory: text("territory"),
    usageDuration: text("usageDuration"),
    exclusivity: text("exclusivity"),
    budgetDisclosed: disclosed && (budgetMinMinor !== undefined || budgetMaxMinor !== undefined),
    budgetMinMinor,
    budgetMaxMinor,
    currency: text("currency") ?? "USD",
    embargoUntil: text("embargoUntil"),
    usageRestrictions: text("usageRestrictions"),
    submitterName,
  };

  if (Buffer.byteLength(JSON.stringify(value), "utf8") > INTAKE_LIMITS.TOTAL_BYTES)
    return { ok: false, failure: "too_large" };

  return { ok: true, value };
}

/** One sentence a form can put beside the control that caused it. */
export function intakeFailureMessage(failure: IntakeFailure): string {
  switch (failure) {
    case "title_required":
      return "Give the request a short title.";
    case "title_too_long":
      return `Keep the title under ${INTAKE_LIMITS.title} characters.`;
    case "too_long":
      return "That is longer than this field accepts.";
    case "too_large":
      return "That submission is too large. Shorten the brief and try again.";
    case "name_too_short":
      return "Type at least two characters, or leave the name blank.";
    case "budget_incomplete":
      return "Give a figure, or choose “Not provided”.";
    case "budget_backwards":
      return "The lower figure needs to be the smaller one.";
    case "bad_date":
      return "That date could not be read.";
  }
}
