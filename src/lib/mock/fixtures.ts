/**
 * Demo fixtures for the Mastline scaffold.
 *
 * These are DEMO VALUES, not customer data. They exist so the whole product can
 * be reviewed before auth, storage, and the database are wired in.
 *
 * The point of this file is that the records are genuinely connected: a payment
 * allocates to a license, which came from a submission, which shipped exact
 * versions of assets, which belong to a shoot. Screens derive their figures
 * from these relations rather than restating hard-coded strings, so a change
 * here moves every screen consistently.
 *
 * The demo clock is fixed so that "2 hours ago" is deterministic in tests.
 */

import type {
  ActivityEvent,
  Asset,
  Buyer,
  DispatchPackage,
  Expense,
  License,
  Member,
  Opportunity,
  Organization,
  Payment,
  RightsMatch,
  Shoot,
  Submission,
} from "../domain";
import { money } from "../money";

/** Fixed "now" for the demo dataset: Thursday, August 20 2026, 6:00 PM UTC. */
export const DEMO_NOW = new Date("2026-08-20T18:00:00.000Z");

const usd = (minor: number) => money(minor, "USD");

export const ORGANIZATION: Organization = {
  id: "org_mhs",
  name: "Marcus Hale Studio",
  slug: "marcus-hale-studio",
  timezone: "America/New_York",
  currency: "USD",
};

export const MEMBERS: readonly Member[] = [
  {
    userId: "usr_marcus",
    organizationId: ORGANIZATION.id,
    displayName: "Marcus Hale",
    initials: "MH",
    role: "owner",
    status: "active",
  },
  {
    userId: "usr_jordan",
    organizationId: ORGANIZATION.id,
    displayName: "Jordan Ellis",
    initials: "JE",
    role: "editor",
    status: "active",
  },
];

export const CURRENT_USER_ID = "usr_marcus";

export const BUYERS: readonly Buyer[] = [
  {
    id: "buy_backgrid",
    organizationId: ORGANIZATION.id,
    name: "Backgrid",
    buyerType: "agency",
    contactName: "New York picture desk",
    deliveryProfile: "Backgrid Editorial — SFTP",
    defaultTerms: "Standard agency distribution; non-exclusive; photographer retains copyright.",
  },
  {
    id: "buy_mega",
    organizationId: ORGANIZATION.id,
    name: "The Mega Agency",
    buyerType: "agency",
    deliveryProfile: "Mega Editorial — SFTP",
  },
  {
    id: "buy_getty",
    organizationId: ORGANIZATION.id,
    name: "Getty Images",
    buyerType: "agency",
    deliveryProfile: "Getty Contributor — API",
  },
  {
    id: "buy_citypaper",
    organizationId: ORGANIZATION.id,
    name: "The City Paper",
    buyerType: "publisher",
    contactName: "Picture editor",
    deliveryProfile: "Direct editorial license — signed URL",
  },
  {
    id: "buy_sceneweekly",
    organizationId: ORGANIZATION.id,
    name: "Scene Weekly",
    buyerType: "publisher",
  },
];

export const SHOOTS: readonly Shoot[] = [
  {
    id: "sht_chelsea",
    organizationId: ORGANIZATION.id,
    title: "Hotel Chelsea departure",
    storyAngle: "Departure after the Midnight Hotel cast announcement.",
    status: "preparing",
    priority: "high",
    startsAt: "2026-08-19T18:30:00.000Z",
    locationName: "222 W 23rd St, New York, NY",
    assignmentLabel: "Direct",
    targetBuyerIds: ["buy_backgrid", "buy_mega"],
    exclusivity: "None",
    sensitiveContent: false,
    hasSensitiveNote: true,
    createdAt: "2026-08-19T19:26:00.000Z",
    updatedAt: "2026-08-20T17:18:00.000Z",
  },
  {
    id: "sht_nyfw",
    organizationId: ORGANIZATION.id,
    title: "NYFW Street Style",
    status: "dispatched",
    priority: "standard",
    startsAt: "2026-08-18T14:00:00.000Z",
    locationName: "SoHo, New York, NY",
    assignmentLabel: "Backgrid",
    targetBuyerIds: ["buy_backgrid"],
    sensitiveContent: false,
    hasSensitiveNote: false,
    createdAt: "2026-08-18T15:10:00.000Z",
    updatedAt: "2026-08-19T21:04:00.000Z",
  },
  {
    id: "sht_usopen",
    organizationId: ORGANIZATION.id,
    title: "US Open Qualifying",
    status: "completed",
    priority: "standard",
    startsAt: "2026-08-15T16:00:00.000Z",
    locationName: "Flushing Meadows, Queens, NY",
    assignmentLabel: "Getty Images",
    targetBuyerIds: ["buy_getty"],
    sensitiveContent: false,
    hasSensitiveNote: false,
    createdAt: "2026-08-15T17:20:00.000Z",
    updatedAt: "2026-08-18T12:00:00.000Z",
  },
  {
    id: "sht_premiere",
    organizationId: ORGANIZATION.id,
    title: "Premiere: The Night Before",
    status: "completed",
    priority: "standard",
    startsAt: "2026-08-08T23:00:00.000Z",
    locationName: "Lincoln Center, New York, NY",
    assignmentLabel: "The Mega Agency",
    targetBuyerIds: ["buy_mega"],
    sensitiveContent: false,
    hasSensitiveNote: false,
    createdAt: "2026-08-09T01:15:00.000Z",
    updatedAt: "2026-08-12T09:30:00.000Z",
  },
];

const sha = (seed: string) => seed.padEnd(64, "0").slice(0, 64);

function imageAsset(params: {
  id: string;
  shootId: string;
  filename: string;
  capturedAt: string;
  headline?: string;
  caption?: string;
  subjects?: string[];
  selected: boolean;
  rating?: number;
  lifetimeEarningsMinor?: number;
  keywords?: string[];
}): Asset {
  const {
    id,
    shootId,
    filename,
    capturedAt,
    headline,
    caption,
    subjects = [],
    selected,
    rating,
    lifetimeEarningsMinor = 0,
    keywords = [],
  } = params;
  return {
    id,
    organizationId: ORGANIZATION.id,
    shootId,
    status: "active",
    canonicalFilename: filename,
    capturedAt,
    headline,
    caption,
    subjects,
    locationName: "New York, NY, USA",
    keywords,
    creatorName: "Marcus Hale",
    copyrightNotice: "© 2026 Marcus Hale",
    creditLine: "Marcus Hale / Mastline",
    usageRestrictions: "Editorial use only. No commercial use.",
    selected,
    rating,
    versions: [
      {
        id: `${id}_v_original`,
        assetId: id,
        versionKind: "original",
        storageBucket: "originals",
        objectKey: `${ORGANIZATION.id}/${shootId}/${filename}.arw`,
        sha256: sha(`${id}a1b2c3d4e5f6`),
        bytes: 52_428_800,
        mimeType: "image/x-sony-arw",
        width: 8640,
        height: 5760,
        createdAt: "2026-08-19T19:26:00.000Z",
      },
      {
        id: `${id}_v_delivery`,
        assetId: id,
        versionKind: "delivery",
        storageBucket: "derivatives",
        objectKey: `${ORGANIZATION.id}/${shootId}/${filename}_delivery.jpg`,
        sha256: sha(`${id}f6e5d4c3b2a1`),
        bytes: 6_291_456,
        mimeType: "image/jpeg",
        width: 5760,
        height: 3840,
        createdAt: "2026-08-19T19:41:00.000Z",
      },
    ],
    captionHistory: caption
      ? [
          {
            id: `${id}_cap_2`,
            assetId: id,
            headline,
            caption,
            editedBy: "usr_marcus",
            editedAt: "2026-08-20T14:22:00.000Z",
          },
          {
            id: `${id}_cap_1`,
            assetId: id,
            headline: "Avery Hart leaves hotel",
            caption: "Avery Hart leaving a hotel in New York.",
            editedBy: "usr_jordan",
            editedAt: "2026-08-20T11:05:00.000Z",
          },
        ]
      : [],
    lifetimeEarnings: usd(lifetimeEarningsMinor),
  };
}

/** Eighteen selects from the Hotel Chelsea shoot, seven still needing captions. */
const CHELSEA_ASSETS: readonly Asset[] = Array.from({ length: 18 }, (_, index) => {
  const number = 470 + index;
  const captioned = index < 11;
  return imageAsset({
    id: `ast_chelsea_${number}`,
    shootId: "sht_chelsea",
    filename: `MH_0819_${number}`,
    capturedAt: `2026-08-19T18:4${index % 10}:18.000Z`,
    headline: captioned ? "Avery Hart departs Hotel Chelsea" : undefined,
    caption: captioned
      ? "Avery Hart is seen leaving Hotel Chelsea in New York City on August 19, 2026."
      : undefined,
    subjects: ["Avery Hart"],
    keywords: ["Avery Hart", "Hotel Chelsea", "departure"],
    selected: true,
    rating: index < 6 ? 5 : 4,
    lifetimeEarningsMinor: index === 2 ? 142_000 : 0,
  });
});

const OTHER_ASSETS: readonly Asset[] = [
  imageAsset({
    id: "ast_nyfw_221",
    shootId: "sht_nyfw",
    filename: "MH_0818_0221",
    capturedAt: "2026-08-18T14:32:00.000Z",
    headline: "Street style outside the Mercer",
    caption: "A model is seen during New York Fashion Week on August 18, 2026.",
    subjects: ["Maya Chen"],
    keywords: ["NYFW", "street style"],
    selected: true,
    rating: 5,
    lifetimeEarningsMinor: 62_000,
  }),
  imageAsset({
    id: "ast_usopen_118",
    shootId: "sht_usopen",
    filename: "MH_0815_0118",
    capturedAt: "2026-08-15T16:44:00.000Z",
    headline: "Qualifying round serve",
    caption: "A player serves during US Open qualifying on August 15, 2026.",
    subjects: [],
    keywords: ["US Open", "tennis"],
    selected: true,
    rating: 4,
    lifetimeEarningsMinor: 78_000,
  }),
  imageAsset({
    id: "ast_premiere_1120",
    shootId: "sht_premiere",
    filename: "MH_0728_1120",
    capturedAt: "2026-08-08T23:18:00.000Z",
    headline: "Arrivals at the premiere",
    caption: "Guests arrive at The Night Before premiere on August 8, 2026.",
    subjects: ["Noah Vale"],
    keywords: ["premiere", "red carpet"],
    selected: true,
    rating: 5,
    lifetimeEarningsMinor: 110_000,
  }),
];

export const ASSETS: readonly Asset[] = [...CHELSEA_ASSETS, ...OTHER_ASSETS];

/** The canonical asset used by the asset-record screen. */
export const FEATURED_ASSET_ID = "ast_chelsea_472";

export const PACKAGES: readonly DispatchPackage[] = [
  {
    id: "pkg_chelsea_01",
    organizationId: ORGANIZATION.id,
    shootId: "sht_chelsea",
    buyerId: "buy_backgrid",
    name: "Hotel Chelsea departure — Package 01",
    status: "delivered",
    deliveryMethod: "SFTP",
    proposedTerms: "Standard agency distribution; non-exclusive; photographer retains copyright.",
    restrictions: "Editorial use only. No commercial use.",
    packageNote: "First six frames, sent while the story was breaking.",
    assets: CHELSEA_ASSETS.slice(0, 6).map((asset, position) => ({
      assetId: asset.id,
      assetVersionId: `${asset.id}_v_delivery`,
      position,
    })),
    approvedBy: "usr_marcus",
    approvedAt: "2026-08-19T18:50:00.000Z",
  },
  {
    // The second buyer's package. Still short of captions, so it cannot be
    // approved -- this is what the dispatch review screen opens.
    id: "pkg_chelsea_02",
    organizationId: ORGANIZATION.id,
    shootId: "sht_chelsea",
    buyerId: "buy_mega",
    name: "Hotel Chelsea departure — Package 02",
    status: "needs_review",
    deliveryMethod: "SFTP",
    proposedTerms: "Standard agency distribution; non-exclusive; photographer retains copyright.",
    restrictions: "Editorial use only. No commercial use.",
    packageNote:
      "Avery Hart leaving Hotel Chelsea following the Midnight Hotel casting announcement.",
    assets: CHELSEA_ASSETS.map((asset, position) => ({
      assetId: asset.id,
      assetVersionId: `${asset.id}_v_delivery`,
      position,
    })),
  },
  {
    id: "pkg_nyfw_02",
    organizationId: ORGANIZATION.id,
    shootId: "sht_nyfw",
    buyerId: "buy_backgrid",
    name: "NYFW Street Style — Package 02",
    status: "delivered",
    deliveryMethod: "SFTP",
    proposedTerms: "Standard agency distribution; non-exclusive.",
    assets: [{ assetId: "ast_nyfw_221", assetVersionId: "ast_nyfw_221_v_delivery", position: 0 }],
    approvedBy: "usr_marcus",
    approvedAt: "2026-08-18T14:14:00.000Z",
  },
];

export const SUBMISSIONS: readonly Submission[] = [
  {
    id: "sub_bg_0820_441",
    organizationId: ORGANIZATION.id,
    packageId: "pkg_chelsea_01",
    buyerId: "buy_backgrid",
    status: "delivered",
    reference: "BG-0820-441",
    recipientLabel: "New York picture desk",
    termsSnapshot: "Standard agency distribution; non-exclusive; photographer retains copyright.",
    restrictionsSnapshot: "Editorial use only. No commercial use.",
    manifest: CHELSEA_ASSETS.slice(0, 6).map((asset, position) => ({
      assetId: asset.id,
      assetVersionId: `${asset.id}_v_delivery`,
      position,
    })),
    deliveryMethod: "SFTP",
    // 22 minutes from capture to dispatch.
    sentAt: "2026-08-19T18:52:00.000Z",
    deliveredAt: "2026-08-19T18:53:00.000Z",
    followUpAt: "2026-08-22T14:00:00.000Z",
  },
  {
    id: "sub_bg_0819_402",
    organizationId: ORGANIZATION.id,
    packageId: "pkg_nyfw_02",
    buyerId: "buy_backgrid",
    status: "sold",
    reference: "BG-0819-402",
    recipientLabel: "New York picture desk",
    termsSnapshot: "Standard agency distribution; non-exclusive.",
    manifest: [{ assetId: "ast_nyfw_221", assetVersionId: "ast_nyfw_221_v_delivery", position: 0 }],
    deliveryMethod: "SFTP",
    // 16 minutes from capture to dispatch.
    sentAt: "2026-08-18T14:16:00.000Z",
    deliveredAt: "2026-08-18T14:18:00.000Z",
    outcomeNote: "Sold to two outlets through Backgrid distribution.",
  },
];

export const LICENSES: readonly License[] = [
  {
    id: "lic_citypaper_0820",
    organizationId: ORGANIZATION.id,
    buyerId: "buy_citypaper",
    status: "active",
    licenseeName: "The City Paper",
    media: "US editorial, web and print",
    territory: "United States",
    startsAt: "2026-08-20T00:00:00.000Z",
    endsAt: "2026-09-19T00:00:00.000Z",
    exclusivity: "None",
    saleBase: usd(64_000),
    // Generated inside Mastline, so the Sales Engine share applies.
    origin: "mastline_sales_engine",
    assetIds: [FEATURED_ASSET_ID],
  },
  {
    id: "lic_backgrid_nyfw",
    organizationId: ORGANIZATION.id,
    submissionId: "sub_bg_0819_402",
    buyerId: "buy_backgrid",
    status: "active",
    licenseeName: "Backgrid syndication",
    media: "Worldwide editorial",
    territory: "Worldwide",
    startsAt: "2026-08-19T00:00:00.000Z",
    exclusivity: "None",
    saleBase: usd(62_000),
    // Sold through the agency relationship, so Mastline takes nothing.
    origin: "external",
    assetIds: ["ast_nyfw_221"],
  },
];

export const PAYMENTS: readonly Payment[] = [
  {
    id: "pay_bg_882341",
    organizationId: ORGANIZATION.id,
    buyerId: "buy_backgrid",
    status: "received",
    source: "statement",
    reference: "BG-882341",
    gross: usd(390_000),
    deductions: usd(156_000),
    platformFee: usd(0),
    tax: usd(0),
    net: usd(234_000),
    receivedAt: "2026-08-18T00:00:00.000Z",
    dueAt: "2026-08-15T00:00:00.000Z",
    expectedAt: "2026-07-25T00:00:00.000Z",
    allocations: [
      {
        id: "alc_bg_882341_1",
        paymentId: "pay_bg_882341",
        licenseId: "lic_backgrid_nyfw",
        submissionId: "sub_bg_0819_402",
        assetId: "ast_nyfw_221",
        allocated: usd(62_000),
      },
      {
        id: "alc_bg_882341_2",
        paymentId: "pay_bg_882341",
        assetId: "ast_premiere_1120",
        allocated: usd(110_000),
      },
    ],
  },
  {
    id: "pay_bg_874102",
    organizationId: ORGANIZATION.id,
    buyerId: "buy_backgrid",
    status: "received",
    source: "statement",
    reference: "BG-874102",
    gross: usd(296_000),
    deductions: usd(118_000),
    platformFee: usd(0),
    tax: usd(0),
    net: usd(178_000),
    receivedAt: "2026-08-06T00:00:00.000Z",
    dueAt: "2026-08-05T00:00:00.000Z",
    expectedAt: "2026-07-10T00:00:00.000Z",
    allocations: [
      {
        id: "alc_bg_874102_1",
        paymentId: "pay_bg_874102",
        assetId: "ast_usopen_118",
        allocated: usd(78_000),
      },
    ],
  },
  {
    id: "pay_mega_5521",
    organizationId: ORGANIZATION.id,
    buyerId: "buy_mega",
    status: "received",
    source: "statement",
    reference: "MEGA-5521",
    gross: usd(410_000),
    deductions: usd(164_000),
    platformFee: usd(0),
    tax: usd(0),
    net: usd(246_000),
    receivedAt: "2026-08-12T00:00:00.000Z",
    dueAt: "2026-08-10T00:00:00.000Z",
    expectedAt: "2026-07-14T00:00:00.000Z",
    allocations: [
      {
        id: "alc_mega_5521_1",
        paymentId: "pay_mega_5521",
        assetId: "ast_premiere_1120",
        allocated: usd(246_000),
      },
    ],
  },
  {
    id: "pay_citypaper_0820",
    organizationId: ORGANIZATION.id,
    buyerId: "buy_citypaper",
    status: "received",
    source: "checkout",
    reference: "MS-DIRECT-1042",
    gross: usd(64_000),
    deductions: usd(0),
    // 30% of the $640 sale base, because Mastline generated this license.
    platformFee: usd(19_200),
    tax: usd(0),
    net: usd(44_800),
    receivedAt: "2026-08-20T00:00:00.000Z",
    dueAt: "2026-08-20T00:00:00.000Z",
    expectedAt: "2026-08-20T00:00:00.000Z",
    allocations: [
      {
        id: "alc_citypaper_1",
        paymentId: "pay_citypaper_0820",
        licenseId: "lic_citypaper_0820",
        assetId: FEATURED_ASSET_ID,
        // Allocations attribute the NET that arrived, not the gross sale base.
        // The $640 base and the $192 Sales Engine share stay on the payment.
        allocated: usd(44_800),
      },
    ],
  },
  {
    id: "pay_recovery_scene",
    organizationId: ORGANIZATION.id,
    buyerId: "buy_sceneweekly",
    status: "received",
    source: "recovery",
    reference: "REC-0811",
    gross: usd(139_200),
    deductions: usd(0),
    platformFee: usd(0),
    tax: usd(0),
    net: usd(139_200),
    receivedAt: "2026-08-11T00:00:00.000Z",
    dueAt: "2026-08-11T00:00:00.000Z",
    expectedAt: "2026-08-01T00:00:00.000Z",
    allocations: [
      {
        id: "alc_recovery_1",
        paymentId: "pay_recovery_scene",
        assetId: "ast_premiere_1120",
        allocated: usd(139_200),
      },
    ],
  },
  {
    id: "pay_bg_889002",
    organizationId: ORGANIZATION.id,
    buyerId: "buy_backgrid",
    status: "invoiced",
    source: "invoice",
    reference: "BG-889002",
    gross: usd(198_000),
    deductions: usd(0),
    platformFee: usd(0),
    tax: usd(0),
    net: usd(198_000),
    expectedAt: "2026-08-20T00:00:00.000Z",
    dueAt: "2026-08-28T00:00:00.000Z",
    allocations: [],
  },
  {
    id: "pay_mega_5610",
    organizationId: ORGANIZATION.id,
    buyerId: "buy_mega",
    status: "overdue",
    source: "invoice",
    reference: "MEGA-5610",
    gross: usd(120_000),
    deductions: usd(0),
    platformFee: usd(0),
    tax: usd(0),
    net: usd(120_000),
    expectedAt: "2026-08-01T00:00:00.000Z",
    dueAt: "2026-08-16T00:00:00.000Z",
    allocations: [],
  },
  {
    id: "pay_bg_stmt_0820",
    organizationId: ORGANIZATION.id,
    buyerId: "buy_backgrid",
    status: "reported",
    source: "statement",
    reference: "BG-STMT-0820",
    gross: usd(84_000),
    deductions: usd(0),
    platformFee: usd(0),
    tax: usd(0),
    net: usd(84_000),
    expectedAt: "2026-08-20T00:00:00.000Z",
    allocations: [],
  },
  {
    id: "pay_mega_stmt_0819",
    organizationId: ORGANIZATION.id,
    buyerId: "buy_mega",
    status: "disputed",
    source: "statement",
    reference: "MEGA-STMT-0819",
    gross: usd(110_000),
    deductions: usd(0),
    platformFee: usd(0),
    tax: usd(0),
    net: usd(110_000),
    expectedAt: "2026-08-19T00:00:00.000Z",
    allocations: [],
  },
];

export const EXPENSES: readonly Expense[] = [
  {
    id: "exp_chelsea_1",
    organizationId: ORGANIZATION.id,
    shootId: "sht_chelsea",
    category: "Transport",
    amount: usd(8_500),
    incurredAt: "2026-08-19T18:00:00.000Z",
    note: "Car to and from 23rd St.",
  },
  {
    id: "exp_nyfw_1",
    organizationId: ORGANIZATION.id,
    shootId: "sht_nyfw",
    category: "Transport",
    amount: usd(4_200),
    incurredAt: "2026-08-18T13:00:00.000Z",
  },
];

export const RIGHTS_MATCHES: readonly RightsMatch[] = [
  {
    id: "rm_dailyedit",
    organizationId: ORGANIZATION.id,
    assetId: FEATURED_ASSET_ID,
    status: "new",
    sourceUrl: "https://thedailyedit.example/avery-hart-new-york-era",
    publisherName: "The Daily Edit",
    pageTitle: "Avery Hart's New York era begins",
    firstObservedAt: "2026-08-20T13:02:00.000Z",
    lastObservedAt: "2026-08-20T16:02:00.000Z",
    matchMethod: "Perceptual hash + crop tolerance",
    confidence: 0.94,
    licenseCheck: "no_linked_license_found",
    hasEvidence: true,
  },
  {
    id: "rm_styleledger",
    organizationId: ORGANIZATION.id,
    assetId: "ast_chelsea_468",
    status: "reviewing",
    sourceUrl: "https://styleledger.example/chelsea-departure",
    publisherName: "Style Ledger",
    pageTitle: "The Chelsea departure, annotated",
    firstObservedAt: "2026-08-20T09:40:00.000Z",
    lastObservedAt: "2026-08-20T12:10:00.000Z",
    matchMethod: "Perceptual hash",
    confidence: 0.87,
    licenseCheck: "possible_license",
    hasEvidence: true,
    decisionNote: "Possible Backgrid syndication. Checking the August statement.",
  },
  {
    id: "rm_sceneweekly",
    organizationId: ORGANIZATION.id,
    assetId: "ast_premiere_1120",
    status: "licensed",
    sourceUrl: "https://sceneweekly.example/night-before-premiere",
    publisherName: "Scene Weekly",
    pageTitle: "Inside The Night Before premiere",
    firstObservedAt: "2026-08-19T11:00:00.000Z",
    lastObservedAt: "2026-08-20T08:00:00.000Z",
    matchMethod: "Perceptual hash",
    confidence: 0.81,
    licenseCheck: "linked_license_found",
    hasEvidence: true,
    decisionNote: "Matched to a Backgrid sale recorded on the August statement.",
  },
];

export const OPPORTUNITIES: readonly Opportunity[] = [
  {
    id: "opp_averyhart",
    organizationId: ORGANIZATION.id,
    title: "Avery Hart cast in Midnight Hotel",
    sourceName: "Entertainment Wire",
    sourcePublishedAt: "2026-08-20T17:46:00.000Z",
    signal: "rising",
    summary:
      "Avery Hart will star in Midnight Hotel, a psychological thriller set in a historic Manhattan hotel. Production begins this fall in New York.",
    relatedTopics: ["Film", "Casting", "New York"],
    status: "new",
    archiveMatch: {
      value: {
        assetIds: CHELSEA_ASSETS.slice(0, 12).map((asset) => asset.id),
        estimatedLow: usd(90_000),
        estimatedHigh: usd(140_000),
      },
      basis: "12 archive assets of this subject; 5 comparable editorial sales in the last 90 days",
      confidence: 0.92,
    },
    windowClosesAt: "2026-08-20T21:00:00.000Z",
  },
  {
    id: "opp_mayachen",
    organizationId: ORGANIZATION.id,
    title: "Maya Chen confirms September tour",
    sourceName: "Music Daily",
    sourcePublishedAt: "2026-08-20T17:33:00.000Z",
    signal: "high",
    summary: "Maya Chen confirmed a twelve-city September tour opening in New York.",
    relatedTopics: ["Music", "Touring"],
    status: "new",
    archiveMatch: {
      value: {
        assetIds: ["ast_nyfw_221"],
        estimatedLow: usd(70_000),
        estimatedHigh: usd(120_000),
      },
      basis: "18 archive assets of this subject; 3 comparable sales in the last 90 days",
      confidence: 0.88,
    },
    windowClosesAt: "2026-08-20T22:00:00.000Z",
  },
  {
    id: "opp_noahvale",
    organizationId: ORGANIZATION.id,
    title: "Noah Vale returns to New York",
    sourceName: "City Beat",
    sourcePublishedAt: "2026-08-20T17:17:00.000Z",
    signal: "high",
    summary: "Noah Vale was seen arriving in New York ahead of a press week.",
    relatedTopics: ["Film", "New York"],
    status: "watching",
    archiveMatch: {
      value: {
        assetIds: ["ast_premiere_1120"],
        estimatedLow: usd(60_000),
        estimatedHigh: usd(100_000),
      },
      basis: "9 archive assets of this subject; 2 comparable sales in the last 90 days",
      confidence: 0.81,
    },
    windowClosesAt: "2026-08-20T23:00:00.000Z",
  },
  {
    id: "opp_riviera",
    organizationId: ORGANIZATION.id,
    title: "Riviera Nights renewed",
    sourceName: "TV Insider",
    sourcePublishedAt: "2026-08-20T16:48:00.000Z",
    signal: "steady",
    summary: "Riviera Nights was renewed for a third season.",
    relatedTopics: ["Television"],
    status: "watching",
    archiveMatch: {
      value: {
        assetIds: ["ast_usopen_118"],
        estimatedLow: usd(40_000),
        estimatedHigh: usd(75_000),
      },
      basis: "7 archive assets loosely matched by cast; 1 comparable sale in the last 90 days",
      confidence: 0.64,
    },
    windowClosesAt: "2026-08-20T20:10:00.000Z",
  },
];

export const ACTIVITY_EVENTS: readonly ActivityEvent[] = [
  {
    id: "evt_7",
    organizationId: ORGANIZATION.id,
    actorId: "usr_marcus",
    entityType: "submission",
    entityId: "sub_bg_0820_441",
    action: "submission.delivered",
    summary: "Delivery confirmed by Backgrid",
    createdAt: "2026-08-19T18:53:00.000Z",
  },
  {
    id: "evt_6",
    organizationId: ORGANIZATION.id,
    actorId: "usr_marcus",
    entityType: "submission",
    entityId: "sub_bg_0820_441",
    action: "submission.sent",
    summary: "6 files sent via SFTP",
    createdAt: "2026-08-19T18:52:00.000Z",
  },
  {
    id: "evt_5",
    organizationId: ORGANIZATION.id,
    actorId: "usr_marcus",
    entityType: "package",
    entityId: "pkg_chelsea_01",
    action: "package.approved",
    summary: "Dispatch approved by Marcus Hale",
    createdAt: "2026-08-19T18:50:00.000Z",
  },
  {
    id: "evt_4",
    organizationId: ORGANIZATION.id,
    actorId: "usr_marcus",
    entityType: "package",
    entityId: "pkg_chelsea_02",
    action: "package.created",
    summary: "Package 02 created for The Mega Agency from 18 selects",
    createdAt: "2026-08-20T17:18:00.000Z",
  },
  {
    id: "evt_3",
    organizationId: ORGANIZATION.id,
    actorId: "usr_jordan",
    entityType: "asset",
    entityId: FEATURED_ASSET_ID,
    action: "asset.caption_edited",
    summary: "Caption edited by Jordan Ellis",
    createdAt: "2026-08-20T14:22:00.000Z",
  },
  {
    id: "evt_2",
    organizationId: ORGANIZATION.id,
    actorId: "usr_marcus",
    entityType: "shoot",
    entityId: "sht_chelsea",
    action: "shoot.imported",
    summary: "312 files imported from Card A",
    createdAt: "2026-08-19T19:26:00.000Z",
  },
  {
    id: "evt_1",
    organizationId: ORGANIZATION.id,
    actorId: "usr_marcus",
    entityType: "shoot",
    entityId: "sht_chelsea",
    action: "shoot.created",
    summary: "Shoot created",
    createdAt: "2026-08-19T19:20:00.000Z",
  },
];

/** Total files on the Chelsea card, of which 18 are selects. */
export const CHELSEA_IMPORTED_FILE_COUNT = 312;
