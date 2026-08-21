import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "../auth";
import type { Id } from "../domain";
import type { PlanId } from "../pricing";
import {
  type StorageState,
  type Subscription,
  type WorkspaceNotice,
  storageState,
  workspaceNotice,
} from "../subscription";
import { createClient } from "../supabase/server";

/**
 * Subscription and storage for the active workspace.
 *
 * Usage comes from the derived view rather than a counter, for the same reason
 * asset earnings do: a counter drifts, and nobody notices until the number is
 * wrong in a conversation about money.
 */

export function subscriptionFrom(workspace: Workspace): Subscription {
  return {
    plan: workspace.plan as PlanId,
    status: workspace.subscriptionStatus,
    trialEndsAt: workspace.trialEndsAt,
  };
}

export async function getStorageUsage(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<{ bytesUsed: number; objectCount: number }> {
  const supabase = client ?? (await createClient());
  const { data } = await supabase
    .from("organization_storage_usage")
    .select("bytes_used, object_count")
    .eq("organization_id", organizationId)
    .maybeSingle();

  return {
    bytesUsed: Number(data?.bytes_used ?? 0),
    objectCount: Number(data?.object_count ?? 0),
  };
}

export interface WorkspaceStatus {
  readonly subscription: Subscription;
  readonly storage: StorageState;
  readonly notice: WorkspaceNotice | null;
  readonly objectCount: number;
}

export async function getWorkspaceStatus(
  workspace: Workspace,
  client?: SupabaseClient,
): Promise<WorkspaceStatus> {
  const subscription = subscriptionFrom(workspace);
  const usage = await getStorageUsage(workspace.id, client);

  // The allowance recorded on the workspace wins, because a negotiated Agency
  // limit and a trial cap both live there and nowhere else. Falling back to the
  // plan default only matters for a workspace created before limits existed.
  const limitBytes = workspace.storageLimitBytes;
  const storage =
    limitBytes === undefined
      ? storageState(subscription, usage.bytesUsed)
      : storageStateWithLimit(usage.bytesUsed, limitBytes);

  return {
    subscription,
    storage,
    notice: workspaceNotice(subscription, storage, new Date()),
    objectCount: usage.objectCount,
  };
}

/** The same shape as storageState, against an explicitly recorded limit. */
function storageStateWithLimit(usedBytes: number, limitBytes: number): StorageState {
  const percentUsed = limitBytes === 0 ? 100 : Math.round((usedBytes / limitBytes) * 100);
  return {
    usedBytes,
    limitBytes,
    percentUsed,
    isOverLimit: usedBytes >= limitBytes,
    isNearLimit: percentUsed >= 80,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
  };
}
