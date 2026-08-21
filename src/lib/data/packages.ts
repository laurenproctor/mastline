import type { SupabaseClient } from "@supabase/supabase-js";
import type { DispatchPackage, Id, PackageStatus } from "../domain";
import { createClient } from "../supabase/server";
import { isRecordId } from "../validation";
import { recordEventWith } from "./activity";

const PACKAGE_COLUMNS =
  "id, organization_id, shoot_id, buyer_id, name, status, delivery_method, proposed_terms, exclusivity, embargo_until, restrictions, package_note, approved_by, approved_at, created_at, updated_at";

interface PackageRow {
  id: string;
  organization_id: string;
  shoot_id: string;
  buyer_id: string | null;
  name: string;
  status: string;
  delivery_method: string | null;
  proposed_terms: string | null;
  exclusivity: string | null;
  embargo_until: string | null;
  restrictions: string | null;
  package_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

function toPackage(
  row: PackageRow,
  assets: readonly { assetId: string; assetVersionId: string; position: number }[],
): DispatchPackage {
  return {
    id: row.id,
    organizationId: row.organization_id,
    shootId: row.shoot_id,
    buyerId: row.buyer_id ?? undefined,
    name: row.name,
    status: row.status as PackageStatus,
    deliveryMethod: row.delivery_method ?? undefined,
    proposedTerms: row.proposed_terms ?? undefined,
    exclusivity: row.exclusivity ?? undefined,
    embargoUntil: row.embargo_until ?? undefined,
    restrictions: row.restrictions ?? undefined,
    packageNote: row.package_note ?? undefined,
    assets,
    approvedBy: row.approved_by ?? undefined,
    approvedAt: row.approved_at ?? undefined,
  };
}

async function loadMembers(packageIds: readonly Id[], client?: SupabaseClient) {
  if (packageIds.length === 0)
    return new Map<string, { assetId: string; assetVersionId: string; position: number }[]>();
  const supabase = client ?? (await createClient());
  const { data } = await supabase
    .from("package_assets")
    .select("package_id, asset_id, asset_version_id, position")
    .in("package_id", [...packageIds])
    .order("position");

  const grouped = new Map<
    string,
    { assetId: string; assetVersionId: string; position: number }[]
  >();
  for (const row of data ?? []) {
    const key = row.package_id as string;
    grouped.set(key, [
      ...(grouped.get(key) ?? []),
      {
        assetId: row.asset_id as string,
        assetVersionId: row.asset_version_id as string,
        position: row.position as number,
      },
    ]);
  }
  return grouped;
}

export async function listPackages(
  organizationId: Id,
  filter: { shootId?: Id } = {},
  client?: SupabaseClient,
): Promise<readonly DispatchPackage[]> {
  const supabase = client ?? (await createClient());
  let query = supabase
    .from("packages")
    .select(PACKAGE_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (filter.shootId) query = query.eq("shoot_id", filter.shootId);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load packages: ${error.message}`);

  const rows = (data ?? []) as unknown as PackageRow[];
  const members = await loadMembers(
    rows.map((row) => row.id),
    supabase,
  );
  return rows.map((row) => toPackage(row, members.get(row.id) ?? []));
}

export async function getPackage(
  organizationId: Id,
  packageId: Id,
): Promise<DispatchPackage | null> {
  // A malformed id is "no such record", not a database error.
  if (!isRecordId(packageId)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("packages")
    .select(PACKAGE_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", packageId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the package: ${error.message}`);
  if (!data) return null;

  const members = await loadMembers([packageId]);
  return toPackage(data as unknown as PackageRow, members.get(packageId) ?? []);
}

/**
 * Build a package from the selected assets on a shoot.
 *
 * Each entry names a specific asset version, not just an asset, so the record
 * of what was offered cannot drift when a new derivative is generated later.
 * A delivery derivative is preferred; the original is used when there is none.
 */
export async function createPackageFromSelection(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  shootId: Id;
  buyerId: Id | null;
  name: string;
  deliveryMethod?: string;
  proposedTerms?: string;
  restrictions?: string;
  packageNote?: string;
  exclusivity?: string;
  embargoUntil?: string;
}): Promise<{ id: Id; assetCount: number }> {
  const { organizationId, actorId, shootId, buyerId, name } = input;
  const supabase = input.client ?? (await createClient());

  const { data: assets, error: assetError } = await supabase
    .from("assets")
    .select("id, canonical_filename, asset_versions(id, version_kind)")
    .eq("organization_id", organizationId)
    .eq("shoot_id", shootId)
    .eq("selected", true)
    .eq("status", "active")
    .order("canonical_filename");

  if (assetError) throw new Error(`Could not read the selection: ${assetError.message}`);
  if (!assets || assets.length === 0) {
    throw new Error("Select at least one asset before building a package.");
  }

  const { data: pkg, error } = await supabase
    .from("packages")
    .insert({
      organization_id: organizationId,
      shoot_id: shootId,
      buyer_id: buyerId,
      name,
      status: "draft",
      delivery_method: input.deliveryMethod ?? null,
      proposed_terms: input.proposedTerms ?? null,
      restrictions: input.restrictions ?? null,
      package_note: input.packageNote ?? null,
      exclusivity: input.exclusivity ?? null,
      embargo_until: input.embargoUntil ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error || !pkg) throw new Error(`Could not create the package: ${error?.message}`);
  const packageId = pkg.id as string;

  const members = assets.map((asset, position) => {
    const versions = (asset.asset_versions ?? []) as { id: string; version_kind: string }[];
    const delivery = versions.find((version) => version.version_kind === "delivery");
    const original = versions.find((version) => version.version_kind === "original");
    const chosen = delivery ?? original ?? versions[0];
    if (!chosen) {
      throw new Error(`${asset.canonical_filename} has no stored file to send.`);
    }
    return {
      package_id: packageId,
      organization_id: organizationId,
      asset_id: asset.id as string,
      asset_version_id: chosen.id,
      position,
    };
  });

  const { error: memberError } = await supabase.from("package_assets").insert(members);
  if (memberError) {
    await supabase.from("packages").delete().eq("id", packageId);
    throw new Error(`Could not add assets to the package: ${memberError.message}`);
  }

  await supabase.from("packages").update({ status: "needs_review" }).eq("id", packageId);

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "package",
    entityId: packageId,
    action: "package.created",
    data: {
      summary: `${name} created from ${members.length} selected assets`,
      count: members.length,
    },
  });

  return { id: packageId, assetCount: members.length };
}

export async function updatePackage(input: {
  organizationId: Id;
  actorId: Id;
  packageId: Id;
  patch: {
    buyerId?: Id | null;
    deliveryMethod?: string;
    proposedTerms?: string;
    restrictions?: string;
    packageNote?: string;
    exclusivity?: string;
    embargoUntil?: string | null;
  };
}): Promise<void> {
  const { organizationId, actorId, packageId, patch } = input;
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("packages")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("id", packageId)
    .maybeSingle();

  // Once a package has shipped, its terms are part of the commercial record.
  if (current && ["sending", "delivered"].includes(current.status as string)) {
    throw new Error("This package has already been dispatched and can no longer be edited.");
  }

  const { error } = await supabase
    .from("packages")
    .update({
      ...(patch.buyerId !== undefined ? { buyer_id: patch.buyerId } : {}),
      ...(patch.deliveryMethod !== undefined ? { delivery_method: patch.deliveryMethod } : {}),
      ...(patch.proposedTerms !== undefined ? { proposed_terms: patch.proposedTerms } : {}),
      ...(patch.restrictions !== undefined ? { restrictions: patch.restrictions } : {}),
      ...(patch.packageNote !== undefined ? { package_note: patch.packageNote } : {}),
      ...(patch.exclusivity !== undefined ? { exclusivity: patch.exclusivity } : {}),
      ...(patch.embargoUntil !== undefined ? { embargo_until: patch.embargoUntil } : {}),
    })
    .eq("organization_id", organizationId)
    .eq("id", packageId);

  if (error) throw new Error(`Could not update the package: ${error.message}`);

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "package",
    entityId: packageId,
    action: "package.updated",
    data: { summary: "Package details updated" },
  });
}

export async function removeFromPackage(input: {
  organizationId: Id;
  actorId: Id;
  packageId: Id;
  assetId: Id;
}): Promise<void> {
  const { organizationId, actorId, packageId, assetId } = input;
  const supabase = await createClient();

  const { error } = await supabase
    .from("package_assets")
    .delete()
    .eq("organization_id", organizationId)
    .eq("package_id", packageId)
    .eq("asset_id", assetId);

  if (error) throw new Error(`Could not remove the asset: ${error.message}`);

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "package",
    entityId: packageId,
    action: "package.asset_removed",
    data: { summary: "Asset removed from package", asset_id: assetId },
  });
}
