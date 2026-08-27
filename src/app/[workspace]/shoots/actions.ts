"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  applyMetadataToMany,
  setRating,
  setSelection,
  tombstoneAsset,
  updateAssetMetadata,
} from "@/lib/data/assets";
import { registerDerivative, registerImport, stagingKeyFor } from "@/lib/data/imports";
import { suggestMetadataForAsset } from "@/lib/data/metadata-suggestions";
import type { MetadataSuggestion } from "@/lib/metadata-suggestions";
import { createShoot, getShoot, setShootStatus, updateShootBrief } from "@/lib/data/shoots";
import { requireWorkspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { createClient } from "@/lib/supabase/server";
import { type FieldErrors, parseAssetMetadata, parseShootBrief } from "@/lib/validation";
import type { ShootBriefInput } from "@/lib/validation";

export interface ActionState {
  readonly errors?: FieldErrors<ShootBriefInput>;
  readonly message?: string;
  readonly ok?: boolean;
}

/**
 * Create a shoot from a brief.
 *
 * Files are not required and never have been: the brief usually exists before
 * anyone has left for the location.
 */
export async function createShootAction(
  workspaceSlug: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseShootBrief(formData);
  if (!parsed.ok) return { errors: parsed.errors };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "shoot.write");

  let shootId: string;
  try {
    const created = await createShoot({ organizationId, actorId, brief: parsed.value });
    shootId = created.id;
  } catch (error) {
    return { errors: { _form: error instanceof Error ? error.message : "Unknown error" } };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.shoots());
  revalidatePath(routes.work());
  redirect(routes.shoot(shootId));
}

export async function updateShootBriefAction(
  workspaceSlug: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shootId = String(formData.get("shootId") ?? "");
  const parsed = parseShootBrief(formData);
  if (!parsed.ok) return { errors: parsed.errors };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "shoot.write");

  try {
    await updateShootBrief({ organizationId, actorId, shootId, brief: parsed.value });
  } catch (error) {
    return { errors: { _form: error instanceof Error ? error.message : "Unknown error" } };
  }

  revalidatePath(workspaceRoutes(canonicalSlug).shoot(shootId));
  return { ok: true, message: "Brief saved." };
}

/**
 * Where the browser should stage an upload.
 *
 * The key is built server-side from the session's organization so a client
 * cannot choose a path in someone else's workspace. Storage policies enforce
 * the same thing independently.
 */
export async function prepareUploadAction(
  workspaceSlug: string,token: string): Promise<{ stagingKey: string }> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!safeToken) throw new Error("Invalid upload token.");
  return { stagingKey: stagingKeyFor(organizationId, safeToken) };
}

export interface ImportResult {
  readonly ok: boolean;
  readonly assetId?: string;
  readonly filename: string;
  readonly duplicateOf?: string;
  readonly error?: string;
}

/** Register one staged upload against a shoot. */
export async function registerImportAction(
  workspaceSlug: string,input: {
  shootId: string;
  filename: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  capturedAt?: string;
  width?: number;
  height?: number;
  stagingKey: string;
}): Promise<ImportResult> {
  const { organizationId, actorId, session } = await requireWorkspaceContext(workspaceSlug, "asset.write");

  try {
    const shoot = await getShoot(organizationId, input.shootId);
    if (!shoot)
      return { ok: false, filename: input.filename, error: "That shoot no longer exists." };

    const imported = await registerImport({
      supabase: await createClient(),
      organizationId,
      actorId,
      shootId: input.shootId,
      facts: {
        filename: input.filename,
        sha256: input.sha256,
        bytes: input.bytes,
        mimeType: input.mimeType,
        capturedAt: input.capturedAt,
        width: input.width,
        height: input.height,
        stagingKey: input.stagingKey,
      },
      // One fact entered once: the shoot and workspace supply the defaults.
      defaults: {
        creatorName: session.displayName,
        creditLine: `${session.displayName} / ${session.activeWorkspace.name}`,
        copyrightNotice: `© ${new Date().getFullYear()} ${session.displayName}`,
        locationName: shoot.locationName,
      },
    });

    return {
      ok: true,
      assetId: imported.assetId,
      filename: imported.filename,
      duplicateOf: imported.duplicateOf,
    };
  } catch (error) {
    return {
      ok: false,
      filename: input.filename,
      error: error instanceof Error ? error.message : "Import failed.",
    };
  }
}

export async function registerPreviewAction(
  workspaceSlug: string,input: {
  assetId: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  stagingKey: string;
}): Promise<{ ok: boolean }> {
  const { organizationId, actorId } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  try {
    await registerDerivative({
      supabase: await createClient(),
      organizationId,
      actorId,
      assetId: input.assetId,
      versionKind: "preview",
      facts: {
        filename: "preview.jpg",
        sha256: input.sha256,
        bytes: input.bytes,
        mimeType: "image/jpeg",
        width: input.width,
        height: input.height,
        stagingKey: input.stagingKey,
      },
    });
    return { ok: true };
  } catch {
    // A missing preview degrades the contact sheet; it never blocks an import.
    return { ok: false };
  }
}

export async function finishImportAction(
  workspaceSlug: string,shootId: string): Promise<void> {
  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "shoot.write");
  await setShootStatus({ organizationId, actorId, shootId, status: "preparing" });
  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.shoot(shootId));
  revalidatePath(routes.work());
}

export async function setSelectionAction(
  workspaceSlug: string,input: {
  shootId: string;
  assetIds: string[];
  selected: boolean;
}): Promise<{ updated: number }> {
  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  const result = await setSelection({
    organizationId,
    actorId,
    assetIds: input.assetIds,
    selected: input.selected,
  });
  revalidatePath(workspaceRoutes(canonicalSlug).shoot(input.shootId));
  return result;
}

export async function setRatingAction(
  workspaceSlug: string,input: {
  shootId: string;
  assetId: string;
  rating: number | null;
}): Promise<void> {
  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  await setRating({ organizationId, actorId, assetId: input.assetId, rating: input.rating });
  revalidatePath(workspaceRoutes(canonicalSlug).shoot(input.shootId));
}

export interface SuggestionState {
  readonly ok: boolean;
  readonly suggestion?: MetadataSuggestion;
  readonly error?: string;
}

/**
 * Draft caption metadata for one frame.
 *
 * This writes nothing. It returns a draft the operator reads, edits, and saves
 * through saveAssetMetadataAction like anything they typed themselves, which is
 * what keeps an inferred caption from ever becoming a recorded fact without a
 * human deciding it should.
 */
export async function suggestAssetMetadataAction(
  workspaceSlug: string,assetId: string): Promise<SuggestionState> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.write");
  const outcome = await suggestMetadataForAsset({ organizationId, assetId });
  return { ok: outcome.ok, suggestion: outcome.suggestion, error: outcome.error };
}

export interface MetadataState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly errors?: Record<string, string>;
}

export async function saveAssetMetadataAction(
  workspaceSlug: string,
  _previous: MetadataState,
  formData: FormData,
): Promise<MetadataState> {
  const assetId = String(formData.get("assetId") ?? "");
  const shootId = String(formData.get("shootId") ?? "");

  const parsed = parseAssetMetadata(formData);
  if (!parsed.ok) return { errors: parsed.errors as Record<string, string> };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "asset.write");

  try {
    await updateAssetMetadata({ organizationId, actorId, assetId, metadata: parsed.value });
  } catch (error) {
    return { errors: { _form: error instanceof Error ? error.message : "Save failed." } };
  }

  const routes = workspaceRoutes(canonicalSlug);
  if (shootId) revalidatePath(routes.shoot(shootId));
  revalidatePath(routes.asset(assetId));
  return { ok: true, message: "Saved. The previous version is kept in the caption history." };
}

/** Apply one set of metadata across a selection. */
export async function applyMetadataToManyAction(
  workspaceSlug: string,
  _previous: MetadataState,
  formData: FormData,
): Promise<MetadataState> {
  const shootId = String(formData.get("shootId") ?? "");
  const assetIds = formData
    .getAll("assetIds")
    .map(String)
    .filter((id) => id !== "");

  if (assetIds.length === 0) return { errors: { _form: "Select at least one asset first." } };

  const parsed = parseAssetMetadata(formData);
  if (!parsed.ok) return { errors: parsed.errors as Record<string, string> };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "asset.write");

  // A field left empty is left alone. Blanking eighteen captions because a box
  // was untouched would be a far worse mistake than not applying anything.
  const provided = parsed.value;
  const hasAnything =
    provided.headline ||
    provided.caption ||
    provided.locationName ||
    provided.creditLine ||
    provided.copyrightNotice ||
    provided.usageRestrictions ||
    provided.subjects.length > 0 ||
    provided.keywords.length > 0;

  if (!hasAnything) {
    return { errors: { _form: "Fill in at least one field to apply." } };
  }

  try {
    const { updated } = await applyMetadataToMany({
      organizationId,
      actorId,
      assetIds,
      metadata: provided,
    });
    revalidatePath(workspaceRoutes(canonicalSlug).shoot(shootId));
    return { ok: true, message: `Applied to ${updated} ${updated === 1 ? "asset" : "assets"}.` };
  } catch (error) {
    return { errors: { _form: error instanceof Error ? error.message : "Bulk apply failed." } };
  }
}

export async function tombstoneAssetAction(
  workspaceSlug: string,input: {
  shootId: string;
  assetId: string;
  reason: string;
}): Promise<void> {
  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "asset.tombstone");
  await tombstoneAsset({
    organizationId,
    actorId,
    assetId: input.assetId,
    reason: input.reason || "Removed by the operator",
  });
  revalidatePath(workspaceRoutes(canonicalSlug).shoot(input.shootId));
}
