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

/**
 * How far one queued import has got.
 *
 * The happy path is the first six, in order:
 *
 *   pending -> staged -> uploading -> uploaded -> finalizing -> complete
 *
 * `staged` means the bytes are held locally in a place that survives a reload,
 * not that they have reached the server. The four that follow are the ways a
 * run can be interrupted rather than finished. The transitions between them
 * are in src/lib/import-queue/state.ts, which is the only thing entitled to
 * move an item from one to another.
 */
export const IMPORT_FILE_STATUSES = [
  "pending",
  "staged",
  "uploading",
  "uploaded",
  "finalizing",
  "complete",
  "paused",
  "retrying",
  "failed",
  "canceled",
] as const;
export type ImportFileStatus = (typeof IMPORT_FILE_STATUSES)[number];

/** The batch's own state. Derived from its files, except when a person pauses
 *  or cancels the whole thing, which is a decision the counters do not overrule. */
export const IMPORT_BATCH_STATUSES = [
  "pending",
  "uploading",
  "paused",
  "complete",
  "failed",
  "canceled",
] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

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
 * Inbound demand: what a buyer asked for.
 *
 * The happy path runs left to right, and the last five are closed states:
 *
 *   draft -> new -> needs_clarification -> qualified -> matching
 *         -> coverage_planned -> preparing_response -> submitted -> negotiating
 *
 * Two things about this vocabulary are worth knowing before reading it:
 *
 *   * `cancelled`, not `canceled`. SHOOT_STATUSES and LICENSE_STATUSES already
 *     spell it with two Ls and the Postgres enums with them, so the alternative
 *     was two spellings of one word in one schema.
 *   * `won` is here and is NOT reachable yet. Winning means connecting the
 *     request to a license, and that connection is Phase 2. The transition
 *     table in src/lib/requests.ts refuses it; the value exists so that adding
 *     the link later is a code change rather than an enum migration.
 *
 * Nothing moves to `expired` on its own. There is no scheduler, so a passing
 * deadline is rendered as a derived fact -- see `isPastDeadline` -- and the
 * status only changes when somebody says so.
 */
export const REQUEST_STATUSES = [
  "draft",
  "new",
  "needs_clarification",
  "qualified",
  "matching",
  "coverage_planned",
  "preparing_response",
  "submitted",
  "negotiating",
  "won",
  "lost",
  "expired",
  "declined",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** How the record reached Mastline. Only `manual` is written in this phase. */
export const REQUEST_SOURCES = ["manual", "email", "portal", "api"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export const REQUEST_TYPES = ["archive", "coverage", "commission", "exclusive", "other"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/**
 * How the buyer got hold of the photographer. Separate from `source`, which is
 * how the record got into Mastline. Undefined is "not recorded", which is not
 * the same as "other".
 */
export const REQUEST_CHANNELS = [
  "phone",
  "text_message",
  "whatsapp",
  "email",
  "in_person",
  "buyer_relationship",
  "other",
] as const;
export type RequestChannel = (typeof REQUEST_CHANNELS)[number];

export const REQUEST_ORIENTATIONS = ["landscape", "portrait", "square", "any"] as const;
export type RequestOrientation = (typeof REQUEST_ORIENTATIONS)[number];

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
export type OpportunitySignal = "rising" | "high" | "steady" | "watch";

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

export interface Opportunity {
  readonly id: Id;
  readonly organizationId: Id;
  readonly title: string;
  readonly sourceName: string;
  readonly sourcePublishedAt: IsoTimestamp;
  readonly signal: OpportunitySignal;
  readonly summary?: string;
  readonly relatedTopics: readonly string[];
  readonly status: "new" | "watching" | "pitching" | "acted" | "dismissed" | "expired";
  /** Suggested, not asserted. Carries basis and confidence. */
  readonly archiveMatch: Suggestion<{
    assetIds: readonly Id[];
    estimatedLow: Money;
    estimatedHigh: Money;
  }>;
  readonly windowClosesAt?: IsoTimestamp;
}

/**
 * A commercial term a buyer either stated or did not.
 *
 * `undefined` throughout the request means "not provided", and the interface is
 * required to render it as those words. A desk that said nothing about
 * territory has not asked for worldwide; one that mentioned no fee has not
 * offered zero. Budget is the sharp case, so it carries `budgetDisclosed`
 * alongside the figures: false with no figures is silence, true with a zero
 * minimum is a desk saying out loud that there is no money in it.
 */
export interface BuyerRequest {
  readonly id: Id;
  readonly organizationId: Id;
  readonly buyerId?: Id;
  /** Resolved for display. Absent when no buyer has been identified yet. */
  readonly buyerName?: string;
  readonly createdBy: Id;
  readonly assignedTo?: Id;
  readonly assignedAt?: IsoTimestamp;
  readonly assignedBy?: Id;
  /** Unique within the workspace, e.g. REQ-0827-4417. Fixed at creation. */
  readonly reference: string;
  readonly source: RequestSource;
  readonly receivedVia?: RequestChannel;
  readonly requestType: RequestType;
  readonly status: RequestStatus;
  readonly title: string;
  readonly brief?: string;
  readonly subjectOrEvent?: string;
  readonly subjectNames: readonly string[];
  readonly topics: readonly string[];
  readonly eventAt?: IsoTimestamp;
  readonly locationName?: string;
  readonly responseDeadline?: IsoTimestamp;
  readonly expiresAt?: IsoTimestamp;
  readonly deliverables?: string;
  readonly requestedFormats: readonly string[];
  readonly orientation?: RequestOrientation;
  readonly approximateQuantity?: number;
  readonly usageMedia?: string;
  readonly territory?: string;
  readonly usageDuration?: string;
  readonly exclusivity?: string;
  /** Whether a budget was stated at all. See the note on this interface. */
  readonly budgetDisclosed: boolean;
  readonly budgetMin?: Money;
  readonly budgetMax?: Money;
  readonly currency: Money["currency"];
  readonly embargoUntil?: IsoTimestamp;
  readonly deliveryRequirements?: string;
  readonly usageRestrictions?: string;
  readonly closedReason?: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly qualifiedAt?: IsoTimestamp;
  readonly closedAt?: IsoTimestamp;
  /** True when a confidential note exists. The body lives behind a role check. */
  readonly hasSensitiveNote: boolean;
}

/** Source protection for a request. Only owners and editors can read this. */
export interface RequestSensitiveNote {
  readonly sourceNote?: string;
  readonly confidentialLocation?: string;
  readonly confidentialIdentity?: string;
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
