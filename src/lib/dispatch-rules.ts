/**
 * Whether a package is buyer-ready.
 *
 * The dispatch gate is the last point before a record becomes commercial
 * history, so the checks are explicit and every failure names what to fix.
 * Asset-level completeness comes from metadata-rules so the warnings on the
 * contact sheet and the reason a dispatch is blocked can never disagree.
 *
 * A buyer profile may demand more than the baseline. That is additive: a check
 * is never dropped because a particular buyer did not ask for it.
 */

import type { Asset, Buyer, DispatchPackage } from "./domain";
import { reviewSelection } from "./metadata-rules";

export type CheckStatus = "pass" | "blocked" | "advisory";

export interface DispatchCheck {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly status: CheckStatus;
  /** What to do about it. Empty when the check passes. */
  readonly remedy?: string;
}

export interface DispatchReview {
  readonly checks: readonly DispatchCheck[];
  readonly blocking: readonly DispatchCheck[];
  readonly advisories: readonly DispatchCheck[];
  /** True only when nothing is blocking. Gates the approve action. */
  readonly isApprovable: boolean;
}

export interface DispatchInput {
  readonly pkg: DispatchPackage;
  readonly assets: readonly Asset[];
  readonly buyer: Buyer | null;
}

export function reviewDispatch({ pkg, assets, buyer }: DispatchInput): DispatchReview {
  const checks: DispatchCheck[] = [];

  // Selection ---------------------------------------------------------------
  checks.push(
    pkg.assets.length === 0
      ? {
          id: "selection",
          title: "Selection",
          detail: "The package is empty.",
          status: "blocked",
          remedy: "Add at least one asset to the package.",
        }
      : {
          id: "selection",
          title: "Selection",
          detail: `${pkg.assets.length} ${pkg.assets.length === 1 ? "asset" : "assets"} selected.`,
          status: "pass",
        },
  );

  // Every packaged asset must still exist and be usable ---------------------
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const missingAssets = pkg.assets.filter((entry) => !byId.has(entry.assetId));
  const restricted = pkg.assets
    .map((entry) => byId.get(entry.assetId))
    .filter((asset): asset is Asset => Boolean(asset))
    .filter((asset) => asset.status === "restricted" || asset.status === "tombstoned");

  if (missingAssets.length > 0) {
    checks.push({
      id: "asset_availability",
      title: "Asset availability",
      detail: `${missingAssets.length} packaged ${missingAssets.length === 1 ? "asset is" : "assets are"} no longer readable.`,
      status: "blocked",
      remedy: "Remove them from the package or restore access.",
    });
  } else if (restricted.length > 0) {
    checks.push({
      id: "asset_availability",
      title: "Asset availability",
      detail: `${restricted.length} ${restricted.length === 1 ? "asset is" : "assets are"} restricted or tombstoned.`,
      status: "blocked",
      remedy: "Remove them from the package.",
    });
  } else {
    checks.push({
      id: "asset_availability",
      title: "Asset availability",
      detail: "Every packaged asset is present and usable.",
      status: "pass",
    });
  }

  // Delivery versions -------------------------------------------------------
  const withoutVersion = pkg.assets.filter((entry) => {
    const asset = byId.get(entry.assetId);
    return asset ? !asset.versions.some((version) => version.id === entry.assetVersionId) : false;
  });
  checks.push(
    withoutVersion.length > 0
      ? {
          id: "delivery_versions",
          title: "Delivery files",
          detail: `${withoutVersion.length} ${withoutVersion.length === 1 ? "entry points" : "entries point"} at a version that no longer exists.`,
          status: "blocked",
          remedy: "Rebuild the package so it references current versions.",
        }
      : {
          id: "delivery_versions",
          title: "Delivery files",
          detail: "Every entry names a specific file version.",
          status: "pass",
        },
  );

  // Metadata completeness ---------------------------------------------------
  const packaged = pkg.assets
    .map((entry) => byId.get(entry.assetId))
    .filter((asset): asset is Asset => Boolean(asset));
  const metadata = reviewSelection(packaged);

  if (metadata.blocked > 0) {
    const fields = new Set<string>();
    for (const report of metadata.reports) {
      for (const rule of report.missingRequired) fields.add(rule.label.toLowerCase());
    }
    checks.push({
      id: "metadata",
      title: "Captions and attribution",
      detail: `${metadata.blocked} of ${metadata.total} ${metadata.blocked === 1 ? "asset is" : "assets are"} missing required metadata.`,
      status: "blocked",
      remedy: `Complete ${[...fields].join(", ")} on the affected frames.`,
    });
  } else {
    checks.push({
      id: "metadata",
      title: "Captions and attribution",
      detail: "Caption, credit, copyright, and capture time present on every asset.",
      status: "pass",
    });
  }

  const recommendations = new Set<string>();
  for (const report of metadata.reports) {
    for (const rule of report.missingRecommended) recommendations.add(rule.label.toLowerCase());
  }
  if (recommendations.size > 0) {
    checks.push({
      id: "metadata_recommended",
      title: "Optional metadata",
      detail: `Missing on some frames: ${[...recommendations].join(", ")}.`,
      status: "advisory",
      remedy: "Desks index on these. Worth filling in if there is time.",
    });
  }

  // Buyer and delivery route -------------------------------------------------
  checks.push(
    buyer
      ? {
          id: "buyer",
          title: "Buyer",
          detail: `${buyer.name}${buyer.contactName ? ` · ${buyer.contactName}` : ""}.`,
          status: "pass",
        }
      : {
          id: "buyer",
          title: "Buyer",
          detail: "No buyer is set on this package.",
          status: "blocked",
          remedy: "Choose who this package is going to.",
        },
  );

  checks.push(
    pkg.deliveryMethod
      ? {
          id: "delivery_method",
          title: "Delivery route",
          detail: `${pkg.deliveryMethod}.`,
          status: "pass",
        }
      : {
          id: "delivery_method",
          title: "Delivery route",
          detail: "No delivery method recorded.",
          status: "blocked",
          remedy: "Record how this package reaches the buyer.",
        },
  );

  // Commercial terms ---------------------------------------------------------
  checks.push(
    pkg.proposedTerms
      ? {
          id: "terms",
          title: "Terms",
          detail: "Proposed terms recorded and will be frozen on the submission.",
          status: "pass",
        }
      : {
          id: "terms",
          title: "Terms",
          detail: "No proposed terms recorded.",
          status: "blocked",
          remedy: "State the terms this package is offered under.",
        },
  );

  checks.push(
    pkg.restrictions
      ? {
          id: "restrictions",
          title: "Restrictions",
          detail: "Usage restrictions recorded.",
          status: "pass",
        }
      : {
          id: "restrictions",
          title: "Restrictions",
          detail: "No restriction note on the package.",
          status: "advisory",
          remedy: "If the images are editorial-only, say so before they leave.",
        },
  );

  // Embargo ------------------------------------------------------------------
  if (pkg.embargoUntil) {
    checks.push({
      id: "embargo",
      title: "Embargo",
      detail: `Embargoed until ${pkg.embargoUntil}.`,
      status: "advisory",
      remedy: "The embargo travels with the submission. Confirm the buyer accepts it.",
    });
  }

  const blocking = checks.filter((check) => check.status === "blocked");
  const advisories = checks.filter((check) => check.status === "advisory");

  return {
    checks,
    blocking,
    advisories,
    isApprovable: blocking.length === 0,
  };
}
