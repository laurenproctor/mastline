import { NextResponse } from "next/server";
import { recordDeliveryAttempt } from "@/lib/data/delivery";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDeliveryPayload, verifySignature } from "@/lib/webhook";

/**
 * Delivery status callbacks from a buyer's system.
 *
 * There is no user session here, so this runs with the service role and scopes
 * every query by hand. That is exactly the situation the admin client exists
 * for, and the reason it is confined to one module.
 *
 * The order matters: verify, parse, CLAIM the event id, then act. Claiming
 * first is what makes a provider retry safe -- the second delivery of the same
 * event collides on the unique constraint and is answered with a 200 so the
 * provider stops retrying, without anything being processed twice.
 */

const SUPPORTED_PROVIDERS = new Set(["backgrid", "mega", "getty", "test"]);

function secretFor(provider: string): string | null {
  const key = `WEBHOOK_SECRET_${provider.toUpperCase()}`;
  return process.env[key] ?? process.env.WEBHOOK_SECRET_DEFAULT ?? null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }

  const secret = secretFor(provider);
  if (!secret) {
    // Refuse rather than accept unverified writes into a workspace.
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }

  const body = await request.text();
  const signed = await verifySignature(body, request.headers.get("x-mastline-signature"), secret);
  if (!signed) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Body was not JSON." }, { status: 400 });
  }

  const payload = parseDeliveryPayload(json);
  if (!payload) {
    return NextResponse.json({ error: "Unrecognised delivery event." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Find the submission this event is about, and with it the organization.
  const { data: submission } = await admin
    .from("submissions")
    .select("id, organization_id, status")
    .eq("external_reference", payload.reference)
    .maybeSingle();

  if (!submission) {
    // Answer 200: the reference is not ours, and a provider retrying forever
    // helps nobody. The event is still recorded below for diagnosis.
    await admin.from("webhook_events").insert({
      provider,
      external_event_id: payload.eventId,
      event_type: payload.status,
      payload: json as Record<string, unknown>,
      processing_error: `No submission with reference ${payload.reference}`,
      processed_at: new Date().toISOString(),
    });
    return NextResponse.json({ status: "ignored", reason: "unknown reference" });
  }

  const organizationId = submission.organization_id as string;

  // Claim the event. A duplicate collides here, before anything is written.
  const { error: claimError } = await admin.from("webhook_events").insert({
    organization_id: organizationId,
    provider,
    external_event_id: payload.eventId,
    event_type: payload.status,
    payload: json as Record<string, unknown>,
  });

  if (claimError) {
    if (claimError.code === "23505") {
      return NextResponse.json({ status: "duplicate", eventId: payload.eventId });
    }
    return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
  }

  try {
    await recordDeliveryAttempt({
      client: admin,
      organizationId,
      submissionId: submission.id as string,
      status: payload.status,
      errorCode: payload.errorCode,
      errorDetail: payload.errorDetail,
    });

    await admin
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", provider)
      .eq("external_event_id", payload.eventId);

    return NextResponse.json({ status: "processed", submissionId: submission.id });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    await admin
      .from("webhook_events")
      .update({ processing_error: detail })
      .eq("provider", provider)
      .eq("external_event_id", payload.eventId);
    return NextResponse.json({ error: "Could not process the event." }, { status: 500 });
  }
}
