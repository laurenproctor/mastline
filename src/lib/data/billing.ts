import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingEvent } from "../billing/provider";
import type { Id } from "../domain";
import { PLAN_SEATS, PLAN_STORAGE_BYTES, type PlanId } from "../pricing";

/**
 * Applying a provider event to a workspace.
 *
 * Every billing change goes through apply_billing_state, which is the only
 * thing permitted to touch these columns. A workspace owner cannot grant
 * themselves a plan; the database refuses it.
 */

/** Find the workspace an event is about, by metadata or by provider ids. */
export async function resolveOrganization(
  admin: SupabaseClient,
  event: BillingEvent,
): Promise<Id | null> {
  if (event.organizationId) return event.organizationId;

  for (const [column, value] of [
    ["stripe_subscription_id", event.subscriptionId],
    ["stripe_customer_id", event.customerId],
  ] as const) {
    if (!value) continue;
    const { data } = await admin.from("organizations").select("id").eq(column, value).maybeSingle();
    if (data) return data.id as string;
  }
  return null;
}

export interface AppliedBilling {
  readonly organizationId: Id;
  readonly kind: BillingEvent["kind"];
  readonly summary: string;
}

export async function applyBillingEvent(
  admin: SupabaseClient,
  organizationId: Id,
  event: BillingEvent,
  plan?: PlanId,
): Promise<AppliedBilling> {
  const nowIso = new Date().toISOString();

  // A plan change carries its allowances with it, so the recorded limits never
  // drift from what the customer is actually paying for.
  const limits = plan
    ? {
        new_storage_limit_bytes: PLAN_STORAGE_BYTES[plan],
        new_seat_limit: PLAN_SEATS[plan],
      }
    : {};

  const patch: Record<string, unknown> = {
    target_org: organizationId,
    new_customer_id: event.customerId ?? null,
    new_subscription_id: event.subscriptionId ?? null,
    new_plan: plan ?? null,
    ...limits,
  };

  let summary: string;

  switch (event.kind) {
    case "subscription_started":
      Object.assign(patch, {
        new_status: "active",
        new_payment_method_attached_at: nowIso,
        // The trial has served its purpose once a subscription exists.
        clear_trial: true,
      });
      summary = "Subscription started";
      break;

    case "payment_succeeded":
      Object.assign(patch, {
        new_status: "active",
        new_current_period_end: event.currentPeriodEnd,
      });
      summary = "Payment received";
      break;

    case "payment_failed":
      // past_due_since is set by apply_billing_state when it is not already,
      // which is what starts the grace window.
      Object.assign(patch, { new_status: "past_due", new_past_due_since: nowIso });
      summary = "Payment failed; grace period started";
      break;

    case "subscription_cancelled":
      Object.assign(patch, { new_status: "cancelled", clear_subscription: true });
      summary = "Subscription cancelled";
      break;

    case "subscription_updated":
      Object.assign(patch, {
        new_status: event.status ?? null,
        new_current_period_end: event.currentPeriodEnd ?? null,
        new_cancel_at_period_end: event.cancelAtPeriodEnd ?? null,
        ...(event.status === "active" ? { clear_trial: true } : {}),
      });
      summary = event.cancelAtPeriodEnd
        ? "Subscription set to end at the period end"
        : `Subscription updated${event.status ? ` to ${event.status}` : ""}`;
      break;

    default:
      return { organizationId, kind: event.kind, summary: "No action taken" };
  }

  const { error } = await admin.rpc("apply_billing_state", patch);
  if (error) throw new Error(`Could not apply billing state: ${error.message}`);

  // System events carry a null actor, which only the service role may write.
  await admin.from("activity_events").insert({
    organization_id: organizationId,
    actor_id: null,
    entity_type: "organization",
    entity_id: organizationId,
    action: `billing.${event.kind}`,
    event_data: { summary, provider_event_id: event.eventId },
  });

  return { organizationId, kind: event.kind, summary };
}
