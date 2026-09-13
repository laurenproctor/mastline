"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  type MetadataInput,
  describeStatus,
  requiresIndividualConfirmation,
} from "@/lib/asset-metadata";
import { listAssets } from "@/lib/data/assets";
import {
  confirmMetadata,
  ensureMetadataRecord,
  listMetadata,
  saveMetadata,
} from "@/lib/data/asset-metadata";
import {
  drainMetadataJobs,
  enqueueGeneration,
  generationIsAvailable,
} from "@/lib/data/metadata-jobs";
import { getShoot } from "@/lib/data/shoots";
import { requireWorkspaceContext } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/server";
import { parseExpectedVersion, parseMetadataForm } from "@/lib/validation";
import { workspaceRoutes } from "@/lib/workspace-routes";

/**
 * The photograph metadata panel's server side.
 *
 * Every action here re-derives the workspace from the slug and checks
 * `asset.write` before it touches anything. The slug arrives bound at render
 * time and may have gone stale, so it is a lookup key and never an
 * authorization input -- `requireWorkspaceContext` is what decides.
 *
 * Generation is enqueued, never awaited. The row is durable before the action
 * returns, and `after()` borrows the tail of this same invocation to drain a
 * few jobs once the response has gone out. A photographer sees "Queued"
 * immediately and the panel fills in underneath them; nothing about that
 * depends on the tab staying open.
 */

export interface MetadataFormState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly errors?: Record<string, string>;
  /** Sent back after a save so the form can keep saving without a reload. */
  readonly version?: number;
  /** True when the record moved underneath this edit. */
  readonly stale?: boolean;
}

/** Kick the worker without making the caller wait for it. */
function drainAfterResponse(): void {
  after(async () => {
    try {
      await drainMetadataJobs();
    } catch {
      // The response has already gone out; there is nobody to tell, and the job
      // is still in the queue for the next drain or the sweep.
    }
  });
}

export interface GenerateState {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Ask for one photograph to be described.
 *
 * Used for the first generation, for Retry after a failure, and for Regenerate.
 * All three are the same request: a job row. What differs is only what the
 * interface warned about before calling it.
 */
export async function generateMetadataAction(
  workspaceSlug: string,
  input: { assetId: string; shootId?: string },
): Promise<GenerateState> {
  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "asset.write",
  );

  const supabase = await createClient();

  // The record has to exist before the panel can show a status against it, and
  // an asset imported before this feature existed will not have one.
  try {
    await ensureMetadataRecord({ supabase, organizationId, assetId: input.assetId });
  } catch {
    return { ok: false, message: "That photograph could not be read in this workspace." };
  }

  const outcome = await enqueueGeneration({
    supabase,
    organizationId,
    actorId,
    assetId: input.assetId,
    reason: "manual",
  });

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.asset(input.assetId));
  if (input.shootId) revalidatePath(routes.shoot(input.shootId));

  if (!outcome.ok) {
    // Already queued is not a failure the photographer needs to act on.
    return { ok: outcome.reason === "already_queued", message: outcome.message };
  }

  drainAfterResponse();
  return { ok: true, message: "Queued. This finishes on its own." };
}

export interface BulkGenerateState {
  readonly ok: boolean;
  readonly message: string;
  readonly queued?: number;
}

/**
 * Describe everything on a shoot that has nothing yet.
 *
 * Deliberately narrow: only photographs with no generated values and no job in
 * flight. A bulk control that re-ran confirmed frames, or raced the queue, would
 * be a way to spend money by accident.
 */
export async function generateForShootAction(
  workspaceSlug: string,
  input: { shootId: string; includeFailed?: boolean },
): Promise<BulkGenerateState> {
  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "asset.write",
  );

  if (!generationIsAvailable()) {
    return { ok: false, message: "Metadata generation is not configured for this deployment." };
  }

  const supabase = await createClient();
  const assets = await listAssets(organizationId, { shootId: input.shootId }, supabase);
  const records = await listMetadata(
    organizationId,
    assets.map((asset) => asset.id),
    supabase,
  );

  const wanted = assets.filter((asset) => {
    const record = records.get(asset.id);
    if (!record) return true;
    if (record.generationStatus === "failed") return input.includeFailed === true;
    return record.generationStatus === "not_generated";
  });

  let queued = 0;
  for (const asset of wanted) {
    await ensureMetadataRecord({ supabase, organizationId, assetId: asset.id });
    const outcome = await enqueueGeneration({
      supabase,
      organizationId,
      actorId,
      assetId: asset.id,
      reason: "bulk",
    });
    if (outcome.ok) queued += 1;
  }

  revalidatePath(workspaceRoutes(canonicalSlug).shoot(input.shootId));

  if (queued === 0) {
    return { ok: true, queued: 0, message: "Nothing needed generating." };
  }

  drainAfterResponse();
  return {
    ok: true,
    queued,
    message: `${queued} ${queued === 1 ? "photograph" : "photographs"} queued. They finish on their own.`,
  };
}

/**
 * Save the panel.
 *
 * The version the form was rendered with travels with it. If the record has
 * moved on -- a generation landed, another tab saved -- nothing is written and
 * the photographer is told, rather than one of the two edits disappearing.
 */
export async function saveMetadataAction(
  workspaceSlug: string,
  _previous: MetadataFormState,
  formData: FormData,
): Promise<MetadataFormState> {
  const assetId = String(formData.get("assetId") ?? "");
  const shootId = String(formData.get("shootId") ?? "");
  const confirm = formData.get("confirm") === "yes";

  const expectedVersion = parseExpectedVersion(formData);
  if (expectedVersion === null) {
    return { errors: { _form: "That form is out of date. Reload the photograph and try again." } };
  }

  const parsed = parseMetadataForm(formData);
  if (!parsed.ok) return { errors: parsed.errors as Record<string, string> };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "asset.write",
  );

  return persistSave({
    organizationId,
    actorId,
    canonicalSlug,
    assetId,
    shootId,
    values: parsed.value,
    expectedVersion,
    confirm,
  });
}

async function persistSave(input: {
  organizationId: string;
  actorId: string;
  canonicalSlug: string;
  assetId: string;
  shootId: string;
  values: MetadataInput;
  expectedVersion: number;
  confirm: boolean;
}): Promise<MetadataFormState> {
  const supabase = await createClient();

  // The shoot is read so the save can tell an untouched inherited value from a
  // deliberate one. Without it, saving a form would freeze every inherited
  // field as an override and a later brief correction would stop reaching it.
  const asset = await getShoot(input.organizationId, input.shootId, supabase);

  let outcome;
  try {
    outcome = await saveMetadata({
      organizationId: input.organizationId,
      actorId: input.actorId,
      assetId: input.assetId,
      values: input.values,
      expectedVersion: input.expectedVersion,
      shoot: asset,
      confirm: input.confirm,
      client: supabase,
    });
  } catch (error) {
    return { errors: { _form: error instanceof Error ? error.message : "Save failed." } };
  }

  if (!outcome.ok) {
    return outcome.reason === "missing"
      ? { errors: { _form: "That photograph no longer has a metadata record." } }
      : {
          stale: true,
          version: outcome.metadata.version,
          errors: {
            _form:
              "This photograph changed while you were editing it, so nothing was saved. Reload to see the current values.",
          },
        };
  }

  const routes = workspaceRoutes(input.canonicalSlug);
  revalidatePath(routes.asset(input.assetId));
  if (input.shootId) revalidatePath(routes.shoot(input.shootId));

  return {
    ok: true,
    version: outcome.metadata.version,
    message: input.confirm
      ? "Confirmed. This metadata may now be included in buyer submissions and licensing records."
      : "Saved. Nothing here reaches a buyer until you confirm it.",
  };
}

/**
 * Confirm without re-submitting the form.
 *
 * A confirmation is a statement about what is on the record, so it carries the
 * version it was made against and nothing else. Sending the form fields as well
 * would let a confirmation assert something other than what was read.
 */
export async function confirmMetadataAction(
  workspaceSlug: string,
  _previous: MetadataFormState,
  formData: FormData,
): Promise<MetadataFormState> {
  const assetId = String(formData.get("assetId") ?? "");
  const shootId = String(formData.get("shootId") ?? "");

  if (formData.get("acknowledged") !== "yes") {
    return {
      errors: {
        _form: "Tick the box to confirm that this information accurately describes the photograph.",
      },
    };
  }

  const expectedVersion = parseExpectedVersion(formData);
  if (expectedVersion === null) {
    return { errors: { _form: "That form is out of date. Reload the photograph and try again." } };
  }

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "asset.write",
  );

  let outcome;
  try {
    outcome = await confirmMetadata({
      organizationId,
      actorId,
      assetId,
      expectedVersion,
    });
  } catch (error) {
    return { errors: { _form: error instanceof Error ? error.message : "Could not confirm." } };
  }

  if (!outcome.ok) {
    return outcome.reason === "missing"
      ? { errors: { _form: "That photograph no longer has a metadata record." } }
      : {
          stale: true,
          version: outcome.metadata.version,
          errors: {
            _form:
              "This photograph changed while you were reading it. Reload, check the values, then confirm.",
          },
        };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.asset(assetId));
  if (shootId) revalidatePath(routes.shoot(shootId));

  return {
    ok: true,
    version: outcome.metadata.version,
    message: "Confirmed. This metadata may be included in buyer submissions and licensing records.",
  };
}

export interface BulkConfirmState {
  readonly ok: boolean;
  readonly message: string;
  readonly confirmed?: number;
  readonly heldBack?: number;
}

/**
 * Confirm several reviewed photographs at once.
 *
 * Requires the acknowledgement, and silently confirms nothing that
 * `requiresIndividualConfirmation` holds back -- reporting how many, so a
 * photographer knows there is still work rather than believing the shoot is
 * done.
 */
export async function confirmManyAction(
  workspaceSlug: string,
  input: { shootId: string; assetIds: readonly string[]; acknowledged: boolean },
): Promise<BulkConfirmState> {
  if (!input.acknowledged) {
    return {
      ok: false,
      message:
        "Tick the box to confirm that this information accurately describes each photograph.",
    };
  }

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "asset.write",
  );

  const supabase = await createClient();
  const records = await listMetadata(organizationId, input.assetIds, supabase);

  let confirmed = 0;
  let heldBack = 0;

  for (const assetId of input.assetIds) {
    const record = records.get(assetId);
    if (!record) continue;
    if (record.generationStatus === "confirmed") continue;
    if (requiresIndividualConfirmation(record)) {
      heldBack += 1;
      continue;
    }
    const outcome = await confirmMetadata({
      organizationId,
      actorId,
      assetId,
      expectedVersion: record.version,
      client: supabase,
    });
    if (outcome.ok) confirmed += 1;
    else heldBack += 1;
  }

  revalidatePath(workspaceRoutes(canonicalSlug).shoot(input.shootId));

  const parts = [`${confirmed} confirmed`];
  if (heldBack > 0) parts.push(`${heldBack} need reading one at a time`);

  return { ok: true, confirmed, heldBack, message: parts.join(" · ") };
}

export interface StatusSnapshot {
  readonly assetId: string;
  readonly status: string;
  readonly label: string;
  readonly inFlight: boolean;
  readonly version: number;
}

/**
 * Where a set of photographs stands right now.
 *
 * Polled by the panel while anything is in flight, which is what makes the
 * status survive a refresh: the truth is a column, and the browser is only ever
 * reading it. Every id is filtered through the workspace's own query, so asking
 * about somebody else's photograph returns nothing rather than an error that
 * confirms it exists.
 */
export async function metadataStatusAction(
  workspaceSlug: string,
  assetIds: readonly string[],
): Promise<readonly StatusSnapshot[]> {
  const { organizationId } = await requireWorkspaceContext(workspaceSlug, "asset.read");
  if (assetIds.length === 0) return [];

  const records = await listMetadata(organizationId, assetIds.slice(0, 200));

  return [...records.values()].map((record) => {
    const view = describeStatus(record);
    return {
      assetId: record.assetId,
      status: view.status,
      label: view.label,
      inFlight: view.inFlight,
      version: record.version,
    };
  });
}
