"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import {
  applyMetadataToMany,
  setRating,
  setSelection,
  tombstoneAsset,
  updateAssetMetadata,
} from "@/lib/data/assets";
import { registerDerivative, registerImport, stagingKeyFor } from "@/lib/data/imports";
import { draftCaptionOnImport, suggestMetadataForAsset } from "@/lib/data/metadata-suggestions";
import type { MetadataSuggestion } from "@/lib/metadata-suggestions";
import {
  createShoot,
  getShoot,
  setShootStatus,
  shootCreatedWithToken,
  updateShootBrief,
} from "@/lib/data/shoots";
import { assertCan } from "@/lib/permissions";
import { requireWorkspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import { createClient } from "@/lib/supabase/server";
import {
  type FieldErrors,
  parseAssetMetadata,
  parseShootAssetDefaults,
  parseShootBrief,
  parseStagedPhotographs,
} from "@/lib/validation";
import type {
  AssetMetadataInput,
  ShootAssetDefaultsInput,
  ShootBriefInput,
  StagedPhotographInput,
} from "@/lib/validation";

/**
 * The errors a brief can produce, plus the one the photographs can.
 *
 * `photographs` is not a field of the brief -- it is a hidden input carrying a
 * list -- but it is rendered next to the others and read the same way, so it
 * shares the shape rather than needing a second channel.
 */
export type CreateShootErrors = FieldErrors<ShootBriefInput> & { photographs?: string };

export interface ActionState {
  readonly errors?: CreateShootErrors;
  readonly message?: string;
  readonly ok?: boolean;
}

/**
 * The metadata one photograph ends up with.
 *
 * One fact entered once: the shoot supplies the credit, the copyright, the
 * restrictions, the shared keywords and the place, and anything typed against
 * an individual frame wins over its shoot-level counterpart. Nothing is
 * invented -- a field nobody filled in stays empty rather than being guessed,
 * which is what keeps the dispatch gate meaningful.
 */
function mergeMetadata(
  photograph: StagedPhotographInput,
  defaults: ShootAssetDefaultsInput,
  shootLocationName: string | undefined,
): AssetMetadataInput {
  const own = photograph.metadata;
  return {
    headline: own.headline,
    caption: own.caption,
    subjects: own.subjects,
    locationName: own.locationName ?? shootLocationName,
    keywords: [...new Set([...defaults.keywords, ...own.keywords])],
    creditLine: own.creditLine ?? defaults.creditLine,
    copyrightNotice: own.copyrightNotice ?? defaults.copyrightNotice,
    usageRestrictions: own.usageRestrictions ?? defaults.usageRestrictions,
  };
}

/** True when there is anything to write beyond what registerImport stored. */
function hasOwnMetadata(metadata: AssetMetadataInput): boolean {
  return Boolean(
    metadata.headline ||
      metadata.caption ||
      metadata.subjects.length > 0 ||
      metadata.keywords.length > 0,
  );
}

/**
 * Create a shoot from the brief, its photographs, and its metadata.
 *
 * This writes a PRIVATE DRAFT and nothing else. It does not build a package,
 * does not create a submission, does not contact a buyer, and does not move the
 * shoot past `draft`. Approval is a separate screen with its own confirmation
 * (approvePackageAction), and the two must never be reachable from one button.
 * Sending is a third thing again, further along still: a link, shared by hand.
 *
 * Files are not required and never have been: the brief usually exists before
 * anyone has left for the location. When files ARE present they have already
 * been hashed and staged by the browser, so all that happens here is
 * registration -- the same registerImport() the shoot workspace uses, against
 * the shoot that was just created.
 *
 * A file that fails to register does not lose the shoot. The draft is written
 * first and the failures are reported on the shoot it landed on, so a partial
 * batch leaves one shoot with some frames rather than no shoot at all, and
 * never two shoots.
 */
export async function createShootAction(
  workspaceSlug: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseShootBrief(formData);
  const staged = parseStagedPhotographs(formData);

  // Both are reported at once. Fixing the title only to be told about the
  // photographs is two round trips for one form.
  if (!parsed.ok || !staged.ok) {
    return {
      errors: {
        ...(parsed.ok ? {} : parsed.errors),
        ...(staged.ok ? {} : { photographs: staged.error }),
      },
    };
  }

  const defaults = parseShootAssetDefaults(formData);
  const clientToken = String(formData.get("clientToken") ?? "").slice(0, 64);

  const { organizationId, actorId, canonicalSlug, session, workspace } =
    await requireWorkspaceContext(workspaceSlug, "shoot.write");

  // Importing is a capability of its own. A role that may brief a shoot but not
  // touch assets gets told so, rather than having the files silently dropped.
  if (staged.value.length > 0) assertCan(workspace.role, "asset.write");

  const routes = workspaceRoutes(canonicalSlug);
  // One client for the whole action: the shoot, the imports, and the metadata
  // all run as the caller, so row level security applies to every step.
  const supabase = await createClient();

  // A repeat of a submission that already succeeded lands on what it made.
  const alreadyCreated = clientToken
    ? await shootCreatedWithToken({ client: supabase, organizationId, actorId, clientToken })
    : null;
  if (alreadyCreated) redirect(routes.shoot(alreadyCreated, { query: { created: "1" } }));

  let shootId: string;
  try {
    const created = await createShoot({
      client: supabase,
      organizationId,
      actorId,
      brief: parsed.value,
      clientToken,
    });
    shootId = created.id;
  } catch (error) {
    return { errors: { _form: error instanceof Error ? error.message : "Unknown error" } };
  }

  let failed = 0;
  if (staged.value.length > 0) {
    // Sequential: each registration moves an object into place and the storage
    // API is the slow part, so this is politeness rather than caution. The
    // shoot workspace's queue is the path for a card dump.
    for (const photograph of staged.value) {
      try {
        const imported = await registerImport({
          supabase,
          organizationId,
          actorId,
          shootId,
          facts: {
            filename: photograph.filename,
            sha256: photograph.sha256,
            bytes: photograph.bytes,
            mimeType: photograph.mimeType,
            capturedAt: photograph.capturedAt,
            width: photograph.width,
            height: photograph.height,
            stagingKey: photograph.stagingKey,
          },
          defaults: {
            creatorName: session.displayName,
            creditLine:
              defaults.creditLine ?? `${session.displayName} / ${session.activeWorkspace.name}`,
            copyrightNotice:
              defaults.copyrightNotice ?? `© ${new Date().getFullYear()} ${session.displayName}`,
            locationName: parsed.value.locationName,
            usageRestrictions: defaults.usageRestrictions,
          },
        });

        const metadata = mergeMetadata(photograph, defaults, parsed.value.locationName);
        if (hasOwnMetadata(metadata)) {
          await updateAssetMetadata({
            client: supabase,
            organizationId,
            actorId,
            assetId: imported.assetId,
            metadata,
          });
        }

        // A missing preview costs a thumbnail, never a frame.
        if (photograph.preview) {
          try {
            await registerDerivative({
              supabase,
              organizationId,
              actorId,
              assetId: imported.assetId,
              versionKind: "preview",
              facts: {
                filename: "preview.jpg",
                sha256: photograph.preview.sha256,
                bytes: photograph.preview.bytes,
                mimeType: "image/jpeg",
                width: photograph.preview.width,
                height: photograph.preview.height,
                stagingKey: photograph.preview.stagingKey,
              },
            });
          } catch {
            // Reported by its absence on the contact sheet, not by failing.
          }
        }
      } catch {
        failed += 1;
      }
    }
  }

  revalidatePath(routes.shoots());
  revalidatePath(routes.work());
  redirect(
    routes.shoot(shootId, {
      query: { created: "1", ...(failed > 0 ? { importFailed: String(failed) } : {}) },
    }),
  );
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

    /*
     * The caption is drafted here, and only here, because this is the first
     * moment it is possible.
     *
     * A vision model needs an image. The preview is that image -- resized in
     * the browser, and for a clip it is the poster frame -- so the instant it
     * is registered is the earliest a frame can be described at all. A RAW or a
     * container with no browser preview never reaches this action, which is
     * exactly right: there would be nothing to read, and a caption guessed from
     * a filename is worse than an empty field.
     *
     * after() rather than an await, and rather than a call from the browser:
     *
     *   - The import queue is not made to wait on a model. Uploading is what
     *     the operator is watching, and a four second read per frame would show
     *     up as the import being slower than it was.
     *   - It survives them navigating away. A card dump is started and then
     *     abandoned to get on with something else; the captions still arrive.
     *   - The dropzone already limits itself to three files in flight, so this
     *     inherits a sane concurrency without inventing another queue.
     *
     * The draft failing is never surfaced here. The import has already stored
     * the original safely, and an uncaptioned frame is a state the inspector
     * has always handled -- with the manual Suggest button still sitting there.
     */
    after(async () => {
      /*
       * Warned rather than swallowed, and warned rather than surfaced.
       *
       * Nobody is waiting on this, so there is no screen to put a failure on --
       * but an automation that can fail invisibly is one nobody can hold to
       * account. A key that has stopped working, or a model returning 400 for
       * every frame, should be findable in a log rather than inferred from a
       * shoot full of empty captions.
       */
      try {
        const outcome = await draftCaptionOnImport({
          organizationId,
          actorId,
          assetId: input.assetId,
        });
        if (!outcome.written && outcome.reason !== "disabled") {
          console.warn(`Could not draft a caption for ${input.assetId}: ${outcome.reason}`);
        }
      } catch (error) {
        console.warn(
          `Could not draft a caption for ${input.assetId}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
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
    await updateAssetMetadata({
      organizationId,
      actorId,
      assetId,
      metadata: parsed.value,
      // This save came from the inspector, where the caption was on screen in
      // an editable field. That is the confirm step: whatever it says now, a
      // person has read it and is standing behind it.
      captionReviewed: true,
    });
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
