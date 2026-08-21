import { NextResponse } from "next/server";
import { applyBillingEvent, resolveOrganization } from "@/lib/data/billing";
import { createStripeProvider } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Billing callbacks from the payment provider.
 *
 * Same shape as the delivery webhook, for the same reason: verify, parse,
 * CLAIM the event id, then act. Claiming first is what makes a provider retry
 * safe. Stripe retries for days, and processing a payment event twice is how a
 * workspace ends up on the wrong plan or a grace window gets reset.
 *
 * No session exists here, so this runs with the service role and scopes every
 * query by hand.
 */
export async function POST(request: Request) {
  const provider = createStripeProvider();

  if (!provider.isConfigured()) {
    // Refuse rather than accept unverified writes into a workspace's billing.
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!(await provider.verifyWebhook(body, signature))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const event = provider.parseWebhook(body);
  if (!event) {
    return NextResponse.json({ error: "Unrecognised event." }, { status: 400 });
  }

  const admin = createAdminClient();
  const organizationId = await resolveOrganization(admin, event);

  if (!organizationId) {
    // Answer 200: the event is not about a workspace we know, and a provider
    // retrying forever helps nobody. It is still recorded for diagnosis.
    await admin.from("webhook_events").insert({
      provider: provider.name,
      external_event_id: event.eventId,
      event_type: event.kind,
      payload: JSON.parse(body) as Record<string, unknown>,
      processing_error: "No workspace matched this event",
      processed_at: new Date().toISOString(),
    });
    return NextResponse.json({ status: "ignored", reason: "unknown workspace" });
  }

  // Claim the event before anything is written.
  const { error: claimError } = await admin.from("webhook_events").insert({
    organization_id: organizationId,
    provider: provider.name,
    external_event_id: event.eventId,
    event_type: event.kind,
    payload: JSON.parse(body) as Record<string, unknown>,
  });

  if (claimError) {
    if (claimError.code === "23505") {
      return NextResponse.json({ status: "duplicate", eventId: event.eventId });
    }
    return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
  }

  try {
    const applied = await applyBillingEvent(admin, organizationId, event, event.plan);

    await admin
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", provider.name)
      .eq("external_event_id", event.eventId);

    return NextResponse.json({ status: "processed", detail: applied.summary });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    await admin
      .from("webhook_events")
      .update({ processing_error: detail })
      .eq("provider", provider.name)
      .eq("external_event_id", event.eventId);
    return NextResponse.json({ error: "Could not process the event." }, { status: 500 });
  }
}
