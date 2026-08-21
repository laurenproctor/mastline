import "server-only";

import type { Id, LicenseCheck, RightsMatch, RightsMatchStatus } from "../domain";
import { createClient } from "../supabase/server";

/**
 * Observed uses of an asset.
 *
 * Read-only in this phase. Triage actions, evidence capture, and case routing
 * are Phase 4; what exists here is the record and the language discipline
 * around it.
 *
 * Confidence is a machine observation and is stored separately from the human
 * status. A license check result of "no linked license found" is a fact about
 * our own records, never a legal conclusion.
 */
export async function listRightsMatches(organizationId: Id): Promise<readonly RightsMatch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rights_matches")
    .select(
      "id, organization_id, asset_id, status, source_url, publisher_name, publisher_domain, page_title, first_observed_at, last_observed_at, match_method, confidence, license_check, evidence_object_key, decision_note",
    )
    .eq("organization_id", organizationId)
    .order("last_observed_at", { ascending: false });

  if (error) throw new Error(`Could not load rights matches: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    organizationId: row.organization_id as string,
    assetId: row.asset_id as string,
    status: row.status as RightsMatchStatus,
    sourceUrl: row.source_url as string,
    publisherName: (row.publisher_name as string | null) ?? "Unknown publisher",
    pageTitle: (row.page_title as string | null) ?? undefined,
    firstObservedAt: row.first_observed_at as string,
    lastObservedAt: row.last_observed_at as string,
    matchMethod: (row.match_method as string | null) ?? "Unrecorded method",
    confidence: Number(row.confidence ?? 0),
    licenseCheck: row.license_check as LicenseCheck,
    hasEvidence: Boolean(row.evidence_object_key),
    decisionNote: (row.decision_note as string | null) ?? undefined,
  }));
}
