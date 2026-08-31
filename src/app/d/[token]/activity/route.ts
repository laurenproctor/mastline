import { NextResponse } from "next/server";
import { isDeliveryToken } from "@/lib/delivery";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Where the delivery page's heartbeats land.
 *
 * A route handler rather than a server action because this has to survive the
 * page going away: the last beat and the session close are sent with
 * `sendBeacon`, which posts a blob to a URL and cannot invoke an action.
 *
 * Everything it accepts is a claim from a stranger. It does no arithmetic of its
 * own -- `record_delivery_activity` decides what to count, bounded by a per-beat
 * ceiling, the wall clock, and a monotonic sequence number -- and it returns
 * what was actually accepted so the client can stop pretending otherwise.
 *
 * The response is deliberately uninformative about why nothing happened. An
 * unknown token, a withdrawn link, and an expired one all get the same empty
 * acknowledgement, exactly as the rest of this surface does.
 */

/** Enough for every frame in a package to be on screen at once, and no more. */
const MAX_ASSET_BEATS = 60;

interface AssetBeat {
  asset_id: string;
  visible_ms: number;
  view_started: boolean;
}

function readAssetBeats(value: unknown): AssetBeat[] {
  if (!Array.isArray(value)) return [];
  const beats: AssetBeat[] = [];
  for (const entry of value.slice(0, MAX_ASSET_BEATS)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const assetId = typeof record.assetId === "string" ? record.assetId : null;
    if (!assetId) continue;
    beats.push({
      asset_id: assetId,
      // Clamped again in the database; this only keeps something absurd from
      // being sent as an integer at all.
      visible_ms: Math.max(0, Math.min(Number(record.visibleMs) || 0, 600_000)),
      view_started: record.viewStarted === true,
    });
  }
  return beats;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isDeliveryToken(token)) {
    return NextResponse.json({ accepted: 0 }, { status: 204 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ accepted: 0 }, { status: 400 });
  }

  const visitorHandle = typeof body.visitor === "string" ? body.visitor : "";
  const sessionHandle = typeof body.session === "string" ? body.session : "";
  const supabase = await createClient();

  // Closing the session. Sent on pagehide, best effort, and nothing depends on
  // it arriving: a session nobody closed is closed by the idle rule instead.
  if (body.kind === "end") {
    await supabase.rpc("end_delivery_session", {
      delivery_token: token,
      session_handle: sessionHandle,
    });
    return new NextResponse(null, { status: 204 });
  }

  const { data, error } = await supabase.rpc("record_delivery_activity", {
    delivery_token: token,
    visitor_handle: visitorHandle,
    session_handle: sessionHandle,
    beat_sequence: Number(body.sequence) || 0,
    claimed_visible_ms: Math.max(0, Math.min(Number(body.visibleMs) || 0, 600_000)),
    asset_beats: readAssetBeats(body.assets),
    caller_agent: request.headers.get("user-agent")?.slice(0, 200) ?? null,
  });

  if (error) {
    // A failed beat is not worth telling the visitor about, and not worth
    // failing the page over. The photographer's screen already distinguishes
    // "no analytics recorded" from "no engagement".
    return NextResponse.json({ accepted: 0 }, { status: 202 });
  }

  const row = (data ?? [])[0] as { accepted_ms?: number } | undefined;
  return NextResponse.json({ accepted: row?.accepted_ms ?? 0 });
}
