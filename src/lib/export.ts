/**
 * Workspace export.
 *
 * The constitution promises the photographer can take their assets, metadata,
 * financial records, and history with them. That promise is only real if the
 * export is complete, readable without Mastline, and produced on demand rather
 * than on request.
 *
 * Money is exported in BOTH minor units and a decimal string: the minor units
 * are the authoritative figure, and the decimal is what a spreadsheet will
 * open correctly.
 */

import type { Money } from "./money";

/** Escape a value for RFC 4180 CSV. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // A trailing newline keeps `wc -l` and most importers happy.
  return `${lines.join("\n")}\n`;
}

/** Minor units as a decimal string, e.g. 44800 -> "448.00". */
export function decimalString(amount: Money): string {
  const negative = amount.minor < 0;
  const absolute = Math.abs(amount.minor);
  const major = Math.floor(absolute / 100);
  const cents = String(absolute % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${major}.${cents}`;
}

export interface ExportFile {
  readonly name: string;
  readonly contentType: string;
  readonly body: string;
}

export const EXPORT_MANIFEST_NOTE = [
  "Mastline workspace export.",
  "",
  "Amounts appear twice: *_minor is an integer count of minor units and is the",
  "authoritative figure; *_decimal is the same value formatted for spreadsheets.",
  "Timestamps are UTC in ISO 8601.",
  "",
  "assets.csv          every asset and its current metadata",
  "asset_versions.csv  every stored file, with its SHA-256 and object key",
  "caption_history.csv previous captions, newest last",
  "shoots.csv          shoot briefs",
  "submissions.csv     what was sent, to whom, and under which terms",
  "licenses.csv        sales, including the Sales Engine split where it applied",
  "payments.csv        money received, with its full breakdown",
  "allocations.csv     which payment paid for which work",
  "activity.csv        the append-only operational record",
  "",
  "Confidential source notes are NOT included. Export them separately and",
  "deliberately when they are needed.",
].join("\n");

/** Build the export set from already-loaded records. */
export interface ExportInput {
  readonly organizationName: string;
  readonly generatedAt: string;
  readonly assets: readonly {
    id: string;
    shootId?: string;
    canonicalFilename: string;
    status: string;
    capturedAt?: string;
    headline?: string;
    caption?: string;
    subjects: readonly string[];
    keywords: readonly string[];
    locationName?: string;
    creatorName?: string;
    creditLine?: string;
    copyrightNotice?: string;
    usageRestrictions?: string;
    selected: boolean;
    rating?: number;
    lifetimeEarnings: Money;
    versions: readonly {
      id: string;
      versionKind: string;
      storageBucket: string;
      objectKey: string;
      sha256: string;
      bytes: number;
      mimeType: string;
      width?: number;
      height?: number;
      createdAt: string;
    }[];
    captionHistory: readonly {
      id: string;
      headline?: string;
      caption?: string;
      editedAt: string;
    }[];
  }[];
  readonly shoots: readonly {
    id: string;
    title: string;
    status: string;
    priority: string;
    startsAt?: string;
    locationName?: string;
    assignmentLabel?: string;
    storyAngle?: string;
    createdAt: string;
  }[];
  readonly submissions: readonly {
    id: string;
    reference: string;
    packageId: string;
    buyerName: string;
    status: string;
    deliveryMethod?: string;
    termsSnapshot?: string;
    restrictionsSnapshot?: string;
    sentAt?: string;
    deliveredAt?: string;
    outcomeNote?: string;
    assetCount: number;
  }[];
  readonly licenses: readonly {
    id: string;
    submissionId?: string;
    licenseeName: string;
    origin: string;
    status: string;
    media?: string;
    territory?: string;
    startsAt?: string;
    endsAt?: string;
    saleBase: Money;
    salesEngineShare: Money;
    photographerShare: Money;
  }[];
  readonly payments: readonly {
    id: string;
    reference?: string;
    buyerName: string;
    status: string;
    source: string;
    gross: Money;
    deductions: Money;
    platformFee: Money;
    tax: Money;
    net: Money;
    expectedAt?: string;
    dueAt?: string;
    receivedAt?: string;
    allocations: readonly {
      id: string;
      licenseId?: string;
      submissionId?: string;
      assetId?: string;
      allocated: Money;
    }[];
  }[];
  readonly activity: readonly {
    id: string;
    entityType: string;
    entityId?: string;
    action: string;
    summary: string;
    createdAt: string;
  }[];
}

export function buildExport(input: ExportInput): readonly ExportFile[] {
  const csv = (
    name: string,
    headers: readonly string[],
    rows: readonly unknown[][],
  ): ExportFile => ({
    name,
    contentType: "text/csv",
    body: toCsv(headers, rows),
  });

  return [
    {
      name: "README.txt",
      contentType: "text/plain",
      body: `${input.organizationName}\nGenerated ${input.generatedAt}\n\n${EXPORT_MANIFEST_NOTE}\n`,
    },

    csv(
      "assets.csv",
      [
        "asset_id",
        "shoot_id",
        "filename",
        "status",
        "captured_at",
        "headline",
        "caption",
        "subjects",
        "keywords",
        "location",
        "creator",
        "credit_line",
        "copyright",
        "usage_restrictions",
        "selected",
        "rating",
        "lifetime_earnings_minor",
        "lifetime_earnings_decimal",
        "currency",
      ],
      input.assets.map((asset) => [
        asset.id,
        asset.shootId ?? "",
        asset.canonicalFilename,
        asset.status,
        asset.capturedAt ?? "",
        asset.headline ?? "",
        asset.caption ?? "",
        asset.subjects.join("; "),
        asset.keywords.join("; "),
        asset.locationName ?? "",
        asset.creatorName ?? "",
        asset.creditLine ?? "",
        asset.copyrightNotice ?? "",
        asset.usageRestrictions ?? "",
        asset.selected ? "yes" : "no",
        asset.rating ?? "",
        asset.lifetimeEarnings.minor,
        decimalString(asset.lifetimeEarnings),
        asset.lifetimeEarnings.currency,
      ]),
    ),

    csv(
      "asset_versions.csv",
      [
        "version_id",
        "asset_id",
        "version_kind",
        "bucket",
        "object_key",
        "sha256",
        "bytes",
        "mime_type",
        "width",
        "height",
        "created_at",
      ],
      input.assets.flatMap((asset) =>
        asset.versions.map((version) => [
          version.id,
          asset.id,
          version.versionKind,
          version.storageBucket,
          version.objectKey,
          version.sha256,
          version.bytes,
          version.mimeType,
          version.width ?? "",
          version.height ?? "",
          version.createdAt,
        ]),
      ),
    ),

    csv(
      "caption_history.csv",
      ["revision_id", "asset_id", "headline", "caption", "edited_at"],
      input.assets.flatMap((asset) =>
        [...asset.captionHistory]
          .sort((a, b) => a.editedAt.localeCompare(b.editedAt))
          .map((revision) => [
            revision.id,
            asset.id,
            revision.headline ?? "",
            revision.caption ?? "",
            revision.editedAt,
          ]),
      ),
    ),

    csv(
      "shoots.csv",
      [
        "shoot_id",
        "title",
        "status",
        "priority",
        "starts_at",
        "location",
        "assignment",
        "story_angle",
        "created_at",
      ],
      input.shoots.map((shoot) => [
        shoot.id,
        shoot.title,
        shoot.status,
        shoot.priority,
        shoot.startsAt ?? "",
        shoot.locationName ?? "",
        shoot.assignmentLabel ?? "",
        shoot.storyAngle ?? "",
        shoot.createdAt,
      ]),
    ),

    csv(
      "submissions.csv",
      [
        "submission_id",
        "reference",
        "package_id",
        "buyer",
        "status",
        "delivery_method",
        "terms",
        "restrictions",
        "asset_count",
        "sent_at",
        "delivered_at",
        "outcome_note",
      ],
      input.submissions.map((submission) => [
        submission.id,
        submission.reference,
        submission.packageId,
        submission.buyerName,
        submission.status,
        submission.deliveryMethod ?? "",
        submission.termsSnapshot ?? "",
        submission.restrictionsSnapshot ?? "",
        submission.assetCount,
        submission.sentAt ?? "",
        submission.deliveredAt ?? "",
        submission.outcomeNote ?? "",
      ]),
    ),

    csv(
      "licenses.csv",
      [
        "license_id",
        "submission_id",
        "licensee",
        "origin",
        "status",
        "media",
        "territory",
        "starts_at",
        "ends_at",
        "sale_base_minor",
        "sale_base_decimal",
        "sales_engine_share_minor",
        "sales_engine_share_decimal",
        "photographer_share_minor",
        "photographer_share_decimal",
        "currency",
      ],
      input.licenses.map((license) => [
        license.id,
        license.submissionId ?? "",
        license.licenseeName,
        license.origin,
        license.status,
        license.media ?? "",
        license.territory ?? "",
        license.startsAt ?? "",
        license.endsAt ?? "",
        license.saleBase.minor,
        decimalString(license.saleBase),
        license.salesEngineShare.minor,
        decimalString(license.salesEngineShare),
        license.photographerShare.minor,
        decimalString(license.photographerShare),
        license.saleBase.currency,
      ]),
    ),

    csv(
      "payments.csv",
      [
        "payment_id",
        "reference",
        "buyer",
        "status",
        "source",
        "gross_minor",
        "gross_decimal",
        "deductions_minor",
        "deductions_decimal",
        "sales_engine_fee_minor",
        "sales_engine_fee_decimal",
        "tax_minor",
        "tax_decimal",
        "net_minor",
        "net_decimal",
        "currency",
        "expected_at",
        "due_at",
        "received_at",
      ],
      input.payments.map((payment) => [
        payment.id,
        payment.reference ?? "",
        payment.buyerName,
        payment.status,
        payment.source,
        payment.gross.minor,
        decimalString(payment.gross),
        payment.deductions.minor,
        decimalString(payment.deductions),
        payment.platformFee.minor,
        decimalString(payment.platformFee),
        payment.tax.minor,
        decimalString(payment.tax),
        payment.net.minor,
        decimalString(payment.net),
        payment.net.currency,
        payment.expectedAt ?? "",
        payment.dueAt ?? "",
        payment.receivedAt ?? "",
      ]),
    ),

    csv(
      "allocations.csv",
      [
        "allocation_id",
        "payment_id",
        "license_id",
        "submission_id",
        "asset_id",
        "allocated_minor",
        "allocated_decimal",
        "currency",
      ],
      input.payments.flatMap((payment) =>
        payment.allocations.map((allocation) => [
          allocation.id,
          payment.id,
          allocation.licenseId ?? "",
          allocation.submissionId ?? "",
          allocation.assetId ?? "",
          allocation.allocated.minor,
          decimalString(allocation.allocated),
          allocation.allocated.currency,
        ]),
      ),
    ),

    csv(
      "activity.csv",
      ["event_id", "entity_type", "entity_id", "action", "summary", "created_at"],
      input.activity.map((event) => [
        event.id,
        event.entityType,
        event.entityId ?? "",
        event.action,
        event.summary,
        event.createdAt,
      ]),
    ),
  ];
}
