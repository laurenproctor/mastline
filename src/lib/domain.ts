/**
 * Mastline domain types and status vocabularies.
 *
 * These mirror the Postgres enums in `supabase/schema/initial.sql` one for one.
 * A status value may only change by an explicit database migration, so these
 * unions and the enums must be edited together.
 *
 * The shapes here are what the data layer returns. Screens read these types,
 * never raw fixtures, so replacing the mock layer with Supabase queries in a
 * later phase does not touch a single component.
 */

import type { Money } from "./money";
import type { LicenseOrigin } from "./sales-engine";

export type Id = string;
export type IsoTimestamp = string;

export const APP_ROLES = [
  "owner",
  "editor",
  "dispatcher",
  "finance",
  "rights_reviewer",
  "viewer",
] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const SHOOT_STATUSES = [
  "draft",
  "scheduled",
  "active",
  "ingesting",
  "preparing",
  "ready",
  "dispatched",
  "completed",
  "archived",
  "cancelled",
] as const;
export type ShootStatus = (typeof SHOOT_STATUSES)[number];

export const ASSET_STATUSES = [
  "ingesting",
  "active",
  "restricted",
  "archived",
  "tombstoned",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const PACKAGE_STATUSES = [
  "draft",
  "needs_review",
  "ready",
  "approved",
  "sending",
  "delivered",
  "failed",
  "recalled",
] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const SUBMISSION_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "acknowledged",
  "sold",
  "no_sale",
  "recalled",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const LICENSE_STATUSES = ["proposed", "active", "expired", "cancelled", "disputed"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "expected",
  "invoiced",
  "reported",
  "partial",
  "received",
  "overdue",
  "disputed",
  "written_off",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const RIGHTS_MATCH_STATUSES = [
  "new",
  "reviewing",
  "licensed",
  "ignored",
  "monitoring",
  "escalated",
  "resolved",
] as const;
export type RightsMatchStatus = (typeof RIGHTS_MATCH_STATUSES)[number];

/**
 * A license check is an observation, never a legal conclusion. The product may
 * report that no linked license was found; it may not call that infringement.
 */
export const LICENSE_CHECKS = [
  "not_checked",
  "linked_license_found",
  "possible_license",
  "no_linked_license_found",
] as const;
export type LicenseCheck = (typeof LICENSE_CHECKS)[number];

export type AssetVersionKind = "original" | "preview" | "edit" | "delivery" | "thumbnail";
export type StorageBucket = "originals" | "derivatives" | "evidence";
export type BuyerType = "agency" | "publisher" | "picture_desk" | "direct_licensee" | "other";
export type ShootPriority = "watch" | "standard" | "high" | "urgent";

export const OPPORTUNITY_SIGNALS = ["rising", "high", "steady", "watch"] as const;
export type OpportunitySignal = (typeof OPPORTUNITY_SIGNALS)[number];

/**
 * The two jobs News Radar does. Two modes of one radar, not two applications:
 * an archive match may make owned work saleable again; a shoot opportunity may
 * justify creating a new shoot. One story may exist once as each.
 */
export const OPPORTUNITY_KINDS = ["archive_match", "shoot_opportunity"] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

export const OPPORTUNITY_STATUSES = [
  "new",
  "watching",
  "pitching",
  "acted",
  "dismissed",
  "expired",
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/**
 * Anything the system inferred rather than observed carries its basis and
 * confidence, and stays editable by a human. Never render one of these without
 * labelling it as a suggestion.
 */
export interface Suggestion<T> {
  readonly value: T;
  readonly basis: string;
  /** 0 to 1. */
  readonly confidence: number;
}

export interface Organization {
  readonly id: Id;
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly currency: Money["currency"];
}

export interface Member {
  readonly userId: Id;
  readonly organizationId: Id;
  readonly displayName: string;
  readonly initials: string;
  readonly role: AppRole;
  readonly status: "invited" | "active" | "suspended";
}

export interface Buyer {
  readonly id: Id;
  readonly organizationId: Id;
  readonly name: string;
  readonly buyerType: BuyerType;
  readonly contactName?: string;
  readonly deliveryProfile?: string;
  readonly defaultTerms?: string;
}

export interface Shoot {
  readonly id: Id;
  readonly organizationId: Id;
  readonly title: string;
  readonly storyAngle?: string;
  readonly status: ShootStatus;
  readonly priority: ShootPriority;
  readonly startsAt?: IsoTimestamp;
  readonly locationName?: string;
  readonly assignmentLabel?: string;
  readonly targetBuyerIds: readonly Id[];
  readonly exclusivity?: string;
  readonly embargoUntil?: IsoTimestamp;
  readonly sensitiveContent: boolean;
  /** True when a sensitive note exists. The note body lives behind a role check. */
  readonly hasSensitiveNote: boolean;
  readonly notes?: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface AssetVersion {
  readonly id: Id;
  readonly assetId: Id;
  readonly versionKind: AssetVersionKind;
  readonly storageBucket: StorageBucket;
  readonly objectKey: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly width?: number;
  readonly height?: number;
  readonly createdAt: IsoTimestamp;
}

export interface CaptionRevision {
  readonly id: Id;
  readonly assetId: Id;
  readonly headline?: string;
  readonly caption?: string;
  readonly editedBy: Id;
  readonly editedAt: IsoTimestamp;
}

export interface Asset {
  readonly id: Id;
  readonly organizationId: Id;
  readonly shootId?: Id;
  readonly status: AssetStatus;
  /** A still or a clip. Set at import from the file's MIME type. */
  readonly assetKind?: "image" | "video";
  readonly canonicalFilename: string;
  readonly capturedAt?: IsoTimestamp;
  readonly headline?: string;
  readonly caption?: string;
  /**
   * Who wrote the caption in this row.
   *
   * "model" means the caption writer drafted it at import. It stays "model"
   * until a person reads it and saves, at which point the caption is theirs.
   */
  readonly captionOrigin?: "human" | "model";
  /** When the caption writer drafted it. Absent for a caption someone typed. */
  readonly captionDraftedAt?: IsoTimestamp;
  /** When a person read the draft and stood behind it. */
  readonly captionReviewedAt?: IsoTimestamp;
  /** What the draft was made from, shown beside the field. Never hidden. */
  readonly captionBasis?: string;
  /** 0 to 1, as the model reported it. */
  readonly captionConfidence?: number;
  /**
   * True while a drafted caption has not been read. Generated in the database
   * from the two columns above so it can never disagree with them.
   */
  readonly captionAwaitsReview?: boolean;
  readonly subjects: readonly string[];
  readonly locationName?: string;
  readonly keywords: readonly string[];
  readonly creatorName?: string;
  readonly copyrightNotice?: string;
  readonly creditLine?: string;
  readonly usageRestrictions?: string;
  readonly selected: boolean;
  readonly rating?: number;
  readonly versions: readonly AssetVersion[];
  readonly captionHistory: readonly CaptionRevision[];
  /** Derived from payment allocations, never stored as a mutable counter. */
  readonly lifetimeEarnings: Money;
}

export interface PackageAsset {
  readonly assetId: Id;
  readonly assetVersionId: Id;
  readonly position: number;
}

export interface DispatchPackage {
  readonly id: Id;
  readonly organizationId: Id;
  readonly shootId: Id;
  readonly buyerId?: Id;
  readonly name: string;
  readonly status: PackageStatus;
  readonly deliveryMethod?: string;
  readonly proposedTerms?: string;
  readonly exclusivity?: string;
  readonly embargoUntil?: IsoTimestamp;
  readonly restrictions?: string;
  readonly packageNote?: string;
  readonly assets: readonly PackageAsset[];
  readonly approvedBy?: Id;
  readonly approvedAt?: IsoTimestamp;
}

export interface Submission {
  readonly id: Id;
  readonly organizationId: Id;
  readonly packageId: Id;
  readonly buyerId?: Id;
  readonly status: SubmissionStatus;
  readonly reference: string;
  readonly recipientLabel?: string;
  readonly termsSnapshot?: string;
  readonly restrictionsSnapshot?: string;
  /** Exactly which asset versions were sent. Never rewritten after send. */
  readonly manifest: readonly PackageAsset[];
  readonly deliveryMethod?: string;
  readonly sentAt?: IsoTimestamp;
  readonly deliveredAt?: IsoTimestamp;
  readonly followUpAt?: IsoTimestamp;
  readonly outcomeNote?: string;
}

export interface License {
  readonly id: Id;
  readonly organizationId: Id;
  readonly submissionId?: Id;
  readonly buyerId?: Id;
  readonly status: LicenseStatus;
  readonly licenseeName: string;
  readonly media?: string;
  readonly territory?: string;
  readonly startsAt?: IsoTimestamp;
  readonly endsAt?: IsoTimestamp;
  readonly exclusivity?: string;
  /** The contractual sale base. The 30% share is computed from this alone. */
  readonly saleBase: Money;
  /** Whether Mastline generated this license. Gates the Sales Engine share. */
  readonly origin: LicenseOrigin;
  readonly assetIds: readonly Id[];
}

/**
 * Attributes part of a payment to what earned it.
 *
 * Allocations divide the payment's NET -- the money that actually arrived --
 * so that `sum(allocations) <= payment.net` always holds. Gross, deductions,
 * tax, and the Sales Engine share stay on the payment and remain separately
 * inspectable there.
 */
export interface PaymentAllocation {
  readonly id: Id;
  readonly paymentId: Id;
  readonly licenseId?: Id;
  readonly submissionId?: Id;
  readonly assetId?: Id;
  readonly allocated: Money;
}

export interface Payment {
  readonly id: Id;
  readonly organizationId: Id;
  readonly buyerId?: Id;
  readonly status: PaymentStatus;
  readonly source: "manual" | "invoice" | "statement" | "checkout" | "recovery";
  readonly reference?: string;
  readonly gross: Money;
  readonly deductions: Money;
  readonly platformFee: Money;
  readonly tax: Money;
  readonly net: Money;
  readonly expectedAt?: IsoTimestamp;
  readonly dueAt?: IsoTimestamp;
  readonly receivedAt?: IsoTimestamp;
  readonly allocations: readonly PaymentAllocation[];
}

export interface RightsMatch {
  readonly id: Id;
  readonly organizationId: Id;
  readonly assetId: Id;
  readonly status: RightsMatchStatus;
  readonly sourceUrl: string;
  readonly publisherName: string;
  readonly pageTitle?: string;
  readonly firstObservedAt: IsoTimestamp;
  readonly lastObservedAt: IsoTimestamp;
  readonly matchMethod: string;
  /** Machine confidence, held separately from the human status. */
  readonly confidence: number;
  readonly licenseCheck: LicenseCheck;
  readonly hasEvidence: boolean;
  readonly decisionNote?: string;
}

/**
 * One story on the News Radar, mirroring public.opportunities.
 *
 * The fields fall into three groups, and the grouping is the contract:
 *
 *   1. Source facts -- title, source, publication time, summary. Observed or
 *      typed, never invented by the system.
 *   2. Inference -- signal, confidence, suggestionBasis. Claims about why the
 *      story matters, always rendered as labelled suggestions with their
 *      basis, never as facts.
 *   3. Lifecycle -- status, window, dismissal reason, acted time, authorship.
 *      Operator decisions and record-keeping.
 *
 * Matched assets are deliberately absent: an archive match carries no asset
 * list until the relational opportunity-assets model exists. Nothing here may
 * pretend that matching has run.
 */
export interface Opportunity {
  readonly id: Id;
  readonly organizationId: Id;
  readonly kind: OpportunityKind;

  // Source facts.
  readonly title: string;
  readonly sourceName?: string;
  readonly sourceUrl?: string;
  readonly sourcePublishedAt?: IsoTimestamp;
  readonly summary?: string;

  // Inference. A confidence never appears without its stated basis.
  readonly signal: OpportunitySignal;
  /** 0 to 1, when anything claimed one. Labelled a suggestion wherever shown. */
  readonly confidence?: number;
  /** The human-readable reason behind signal and confidence. */
  readonly suggestionBasis?: string;

  // Lifecycle.
  readonly status: OpportunityStatus;
  readonly windowClosesAt?: IsoTimestamp;
  readonly dismissalReason?: string;
  readonly actedAt?: IsoTimestamp;
  /** Who entered the story. Absent on rows no person typed. */
  readonly createdBy?: Id;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface Expense {
  readonly id: Id;
  readonly organizationId: Id;
  readonly shootId?: Id;
  readonly category: string;
  readonly amount: Money;
  readonly incurredAt: IsoTimestamp;
  readonly note?: string;
}

export interface ActivityEvent {
  readonly id: Id;
  readonly organizationId: Id;
  readonly actorId?: Id;
  readonly entityType: string;
  readonly entityId?: Id;
  readonly action: string;
  readonly summary: string;
  readonly createdAt: IsoTimestamp;
}
