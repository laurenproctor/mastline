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
  /**
   * The shoot the package landed on, read back from the row rather than echoed
   * from the caller. The dispatch review is addressed by shoot, so this is what
   * the redirect after building a package is built from, and it has to be what
   * the database actually holds.
   */
}): Promise<{ id: Id; shootId: Id; assetCount: number }> {
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
    .select("id, shoot_id")
    .single();

  if (error || !pkg) throw new Error(`Could not create the package: ${error?.message}`);
  const packageId = pkg.id as string;
  const storedShootId = pkg.shoot_id as string;

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

  return { id: packageId, shootId: storedShootId, assetCount: members.length };
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

  // Once a package is approved, its terms, name, and note are part of the
  // commercial record and the database refuses to change them. Saying so here
  // gives the operator a sentence rather than a constraint violation.
  if (current && ["approved", "sending", "delivered"].includes(current.status as string)) {
    throw new Error(
      "This package has been approved and can no longer be edited. Prepare a new package to send something different.",
    );
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

/**
 * The one live draft this operator has on this shoot, creating it if none
 * exists.
 *
 * The delivery flow needs a persistent object from its first click, and it
 * needs the same object back after a double-click, a retry, or a refresh --
 * without a schema change to hang an idempotency key on. So the draft is
 * addressed deterministically: the earliest unapproved `draft` package this
 * operator created on this shoot. Two racing calls may both insert; both then
 * re-read, agree on the earliest row, and the loser deletes its own memberless
 * insert. Convergence rather than prevention, and safe because a draft that
 * lost the race holds nothing.
 *
 * Scoped to the creator on purpose: two people preparing packages on one shoot
 * are preparing two packages, and reusing a colleague's draft would hand one of
 * them the other's selection.
 */
export async function ensureDraftPackage(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  shootId: Id;
  name?: string;
}): Promise<{ id: Id; shootId: Id; created: boolean }> {
  const { organizationId, actorId, shootId } = input;
  const supabase = input.client ?? (await createClient());

  const earliest = () =>
    supabase
      .from("packages")
      .select("id, shoot_id")
      .eq("organization_id", organizationId)
      .eq("shoot_id", shootId)
      .eq("created_by", actorId)
      .eq("status", "draft")
      .is("approved_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

  const { data: existing, error: readError } = await earliest();
  if (readError) throw new Error(`Could not look for a draft: ${readError.message}`);
  if (existing) {
    return { id: existing.id as string, shootId: existing.shoot_id as string, created: false };
  }

  const { data: inserted, error } = await supabase
    .from("packages")
    .insert({
      organization_id: organizationId,
      shoot_id: shootId,
      buyer_id: null,
      name: input.name?.trim() || "Private delivery",
      status: "draft",
      created_by: actorId,
    })
    .select("id, shoot_id")
    .single();

  if (error || !inserted) throw new Error(`Could not start a draft: ${error?.message}`);

  const { data: winner, error: rereadError } = await earliest();
  if (rereadError || !winner) {
    // The re-read failing does not undo the insert; the draft just made is real.
    return { id: inserted.id as string, shootId: inserted.shoot_id as string, created: true };
  }

  if (winner.id !== inserted.id) {
    // A concurrent call made the draft first. Ours holds nothing; remove it so
    // a double-click leaves one draft, not two.
    await supabase.from("packages").delete().eq("id", inserted.id).eq("status", "draft");
    return { id: winner.id as string, shootId: winner.shoot_id as string, created: false };
  }

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "package",
    entityId: inserted.id as string,
    action: "package.created",
    data: { summary: "Draft package started for a private delivery", count: 0 },
  });

  return { id: inserted.id as string, shootId: inserted.shoot_id as string, created: true };
}

/**
 * Make the package hold exactly these frames, in exactly this order.
 *
 * Reconciliation rather than a diff of add/remove calls, so retrying a save
 * that half-landed converges on the same state -- sending the same list twice
 * is the same selection. A frame already in the package keeps the version that
 * was pinned when it entered; a new frame pins its version now (delivery
 * derivative first, then the original), so the record of what is being offered
 * cannot drift with later derivatives.
 *
 * Only an unapproved package can move. The database trigger refuses the write
 * after approval whatever this function checks; the check here exists so the
 * operator gets a sentence rather than a constraint violation.
 */
export async function setPackageSelection(input: {
  client?: SupabaseClient;
  organizationId: Id;
  actorId: Id;
  packageId: Id;
  /** Asset ids in the order they should appear. Duplicates collapse. */
  assetIds: readonly Id[];
}): Promise<{ count: number }> {
  const { organizationId, actorId, packageId } = input;
  const supabase = input.client ?? (await createClient());
  const orderedIds = [...new Set(input.assetIds)].filter((id) => isRecordId(id));

  const { data: pkg, error: pkgError } = await supabase
    .from("packages")
    .select("id, shoot_id, status, approved_at")
    .eq("organization_id", organizationId)
    .eq("id", packageId)
    .maybeSingle();

  if (pkgError) throw new Error(`Could not read the package: ${pkgError.message}`);
  if (!pkg) throw new Error("That package could not be found in this workspace.");
  if (pkg.approved_at || ["approved", "sending", "delivered"].includes(pkg.status as string)) {
    throw new Error(
      "This package has been approved and its selection is frozen. Start a new delivery to send something different.",
    );
  }

  // Keep the version pinned when each frame entered the package.
  const { data: currentMembers, error: membersError } = await supabase
    .from("package_assets")
    .select("asset_id, asset_version_id")
    .eq("organization_id", organizationId)
    .eq("package_id", packageId);
  if (membersError) throw new Error(`Could not read the selection: ${membersError.message}`);
  const pinned = new Map(
    (currentMembers ?? []).map((row) => [row.asset_id as string, row.asset_version_id as string]),
  );

  let rows: { asset_id: string; asset_version_id: string }[] = [];
  if (orderedIds.length > 0) {
    const { data: assets, error: assetError } = await supabase
      .from("assets")
      .select("id, status, shoot_id, canonical_filename, asset_versions(id, version_kind)")
      .eq("organization_id", organizationId)
      .eq("shoot_id", pkg.shoot_id as string)
      .in("id", orderedIds);
    if (assetError) throw new Error(`Could not read the frames: ${assetError.message}`);

    const byId = new Map((assets ?? []).map((asset) => [asset.id as string, asset]));
    rows = orderedIds.map((assetId) => {
      const asset = byId.get(assetId);
      if (!asset) {
        throw new Error("A selected frame is not on this shoot or no longer exists.");
      }
      if (asset.status !== "active") {
        throw new Error(`${asset.canonical_filename} is not active and cannot be packaged.`);
      }
      const kept = pinned.get(assetId);
      if (kept) return { asset_id: assetId, asset_version_id: kept };
      const versions = (asset.asset_versions ?? []) as { id: string; version_kind: string }[];
      const chosen =
        versions.find((version) => version.version_kind === "delivery") ??
        versions.find((version) => version.version_kind === "original") ??
        versions[0];
      if (!chosen) throw new Error(`${asset.canonical_filename} has no stored file to send.`);
      return { asset_id: assetId, asset_version_id: chosen.id };
    });
  }

  /*
   * Replace the membership wholesale. Two statements, not a diff: the position
   * column is unique per package, and a reorder expressed as updates would
   * collide with itself between statements. A draft's membership is working
   * state, not evidence -- the frozen record is written at approval -- so the
   * moment between delete and insert holds nothing that needs protecting.
   */
  const { error: clearError } = await supabase
    .from("package_assets")
    .delete()
    .eq("organization_id", organizationId)
    .eq("package_id", packageId);
  if (clearError) throw new Error(`Could not update the selection: ${clearError.message}`);

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("package_assets").insert(
      rows.map((row, position) => ({
        package_id: packageId,
        organization_id: organizationId,
        asset_id: row.asset_id,
        asset_version_id: row.asset_version_id,
        position,
      })),
    );
    if (insertError) throw new Error(`Could not save the selection: ${insertError.message}`);
  }

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "package",
    entityId: packageId,
    action: "package.selection_updated",
    data: {
      summary: `Selection saved: ${rows.length} ${rows.length === 1 ? "frame" : "frames"}`,
      count: rows.length,
    },
  });

  return { count: rows.length };
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
