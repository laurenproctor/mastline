/**
 * What onboarding asks, and what the answers are called in the database.
 *
 * The seven-step flow renders from these lists, the Server Action validates
 * against them, and the migration's check constraints repeat them in SQL. All
 * three have to agree, so they are written once here and imported rather than
 * retyped in a component.
 *
 * Keys are machine values and never change. Labels are interface copy and may.
 */

/**
 * The version of the flow a photographer completed.
 *
 * Stamped onto the organization so a funnel stays readable after the questions
 * change. Bump this whenever a step is added, removed, or reworded enough that
 * the answers mean something different.
 */
export const ONBOARDING_VERSION = 1;

/**
 * The commercial terms shown beside the Sales Engine opt-in.
 *
 * Stored with the consent. The 70/30 split is the thing being agreed to, so
 * "they said yes" is only meaningful alongside "to this". Bump this when the
 * presented terms change, never retroactively.
 */
export const SALES_ENGINE_TERMS_VERSION = "2026-08-25";

export const WORK_STYLES = [
  {
    key: "independent",
    label: "Independent photographer",
    description: "I run my own assignments, archive, and buyer relationships.",
  },
  {
    key: "agency",
    label: "Working with an agency",
    description: "I deliver through one or more agencies while keeping my own record.",
  },
  {
    key: "team",
    label: "Studio or team",
    description: "Two or more people collaborate on shoots, selects, dispatch, or finance.",
  },
  {
    key: "contributor",
    label: "Occasional contributor",
    description: "I shoot selected events or stories alongside other work.",
  },
] as const;
export type WorkStyle = (typeof WORK_STYLES)[number]["key"];

export const SPECIALTIES = [
  { key: "celebrity", label: "Celebrity" },
  { key: "street_style", label: "Street style" },
  { key: "entertainment", label: "Entertainment" },
  { key: "events", label: "Events" },
  { key: "news", label: "News" },
  { key: "portraits", label: "Portraits" },
] as const;
export type Specialty = (typeof SPECIALTIES)[number]["key"];

export const ONBOARDING_GOALS = [
  {
    key: "organize",
    label: "Organize shoots and assets",
    description: "Keep originals, selects, captions, and commercial history connected.",
  },
  {
    key: "dispatch",
    label: "Prepare and track submissions",
    description: "Know exactly what went out, to whom, and under which terms.",
  },
  {
    key: "editorial",
    label: "Find editorial opportunities",
    description: "Turn a shoot into a buyer-ready package while the story is live.",
  },
  {
    key: "brands",
    label: "Identify brand opportunities",
    description: "Review visible clothing and potential commercial matches.",
  },
  {
    key: "rights",
    label: "Monitor usage rights",
    description: "Route possible uses through evidence and human review.",
  },
  {
    key: "archive",
    label: "Reactivate archived work",
    description: "Find new relevance in pictures you already own.",
  },
] as const;
export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number]["key"];

const WORK_STYLE_KEYS: readonly string[] = WORK_STYLES.map((entry) => entry.key);
const SPECIALTY_KEYS: readonly string[] = SPECIALTIES.map((entry) => entry.key);
const GOAL_KEYS: readonly string[] = ONBOARDING_GOALS.map((entry) => entry.key);

export function isWorkStyle(value: string): value is WorkStyle {
  return WORK_STYLE_KEYS.includes(value);
}

export function isSpecialty(value: string): value is Specialty {
  return SPECIALTY_KEYS.includes(value);
}

export function isOnboardingGoal(value: string): value is OnboardingGoal {
  return GOAL_KEYS.includes(value);
}

export function specialtyLabel(key: string): string {
  return SPECIALTIES.find((entry) => entry.key === key)?.label ?? key;
}

export function goalLabel(key: string): string {
  return ONBOARDING_GOALS.find((entry) => entry.key === key)?.label ?? key;
}

/**
 * The profile handed to `create_workspace` as one jsonb argument.
 *
 * `sales_engine_enabled_at` is deliberately absent: the database stamps consent
 * with its own clock, so a client cannot backdate it.
 */
export interface OnboardingProfile {
  readonly work_style: WorkStyle | null;
  readonly base_city: string | null;
  readonly specialties: readonly Specialty[];
  readonly goals: readonly OnboardingGoal[];
  readonly sales_engine_enabled: boolean;
  readonly sales_engine_terms_version: string | null;
  readonly onboarding_version: number;
}
