/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPackageFromSelection } from "../src/lib/data/packages";
import { approvePackageAndCreateSubmission } from "../src/lib/data/submissions";
import { createDelivery } from "../src/lib/data/delivery-links";
import { listDeliveryEngagement, describeActiveTime } from "../src/lib/data/delivery-analytics";
import {
  ORG_A,
  anonClient,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * Viewing time, and the fact that a browser is not a trustworthy clock.
 *
 * Every number the delivery page sends is a claim from a stranger, so these
 * tests are written from the attacker's side: send the same beat again, claim
 * an hour in a ten-second tick, count time for a frame that is not in the
 * package, beat against a withdrawn link. What the server actually counted is
 * the only thing asserted.
 *
 * The three defences are a per-beat ceiling, the wall clock between beats, and
 * a monotonic sequence number. They are tested separately because they fail
 * differently: a ceiling stops one enormous claim, the wall clock stops a
 * rapid burst of plausible ones, and the sequence stops the same beat arriving
 * a thousand times.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const EDITOR = "22222222-2222-2222-2222-222222222222";
const DISPATCHER = "33333333-3333-3333-3333-333333333333";
const BACKGRID = "a0000000-0000-0000-0000-0000000000b1";

/** Mirrors private.delivery_beat_ceiling_ms(). */
const BEAT_CEILING_MS = 30_000;

const shoots: string[] = [];

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function handle(seed: string): string {
  return `${seed}${"x".repeat(Math.max(0, 20 - seed.length))}`.slice(0, 24);
}

async function linkedDelivery(label: string, frames = 2) {
  const service = serviceClient();
  const editor = await clientFor("editor");
  const dispatcher = await clientFor("dispatcher");

  const { data: shoot } = await service
    .from("shoots")
    .insert({
      organization_id: ORG_A,
      title: `${label} ${Date.now()}`,
      status: "preparing",
      starts_at: new Date(Date.now() - 1_800_000).toISOString(),
      created_by: OWNER,
    })
    .select("id")
    .single();
  const shootId = shoot!.id as string;
  shoots.push(shootId);

  const assetIds: string[] = [];
  for (let index = 0; index < frames; index += 1) {
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        status: "active",
        canonical_filename: `AN_${label}_${index}`,
        captured_at: new Date(Date.now() - 1_800_000).toISOString(),
        headline: `${label} frame ${index}`,
        caption: `A caption for ${label} frame ${index}, long enough to pass the gate.`,
        credit_line: "Mastline test",
        selected: true,
        created_by: OWNER,
      })
      .select("id")
      .single();
    assetIds.push(asset!.id as string);

    await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: asset!.id,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${ORG_A}/${shootId}/${label}_${index}.arw`,
      sha256: await digest(`${label}-${index}-${shootId}`),
      bytes: 1000,
      mime_type: "image/x-sony-arw",
      created_by: OWNER,
    });
  }

  const { id: packageId } = await createPackageFromSelection({
    client: editor,
    organizationId: ORG_A,
    actorId: EDITOR,
    shootId,
    buyerId: BACKGRID,
    name: `${label} package`,
    deliveryMethod: "SFTP",
    proposedTerms: "Non-exclusive agency distribution.",
    restrictions: "Editorial use only.",
  });

  const { submissionId } = await approvePackageAndCreateSubmission({
    client: dispatcher,
    organizationId: ORG_A,
    actorId: DISPATCHER,
    packageId,
  });

  const link = await createDelivery({
    client: dispatcher,
    organizationId: ORG_A,
    actorId: DISPATCHER,
    submissionId,
    recipientLabel: "New York picture desk",
    windowDays: 7,
  });

  return { shootId, submissionId, link, assetIds, dispatcher };
}

async function sessionRow(deliveryId: string) {
  const { data } = await serviceClient()
    .from("delivery_view_sessions")
    .select("active_visible_ms, last_sequence, visitor_key, session_key, ended_at")
    .eq("delivery_id", deliveryId)
    .order("started_at", { ascending: true });
  return data ?? [];
}

afterAll(async () => {
  for (const shootId of shoots) await purgeShoot(shootId);
});

describeIf("what the server is willing to count", () => {
  it("clamps a single absurd claim to the per-beat ceiling", async () => {
    const { link } = await linkedDelivery("CLAMP", 1);
    const anon = anonClient();

    const { data } = await anon.rpc("record_delivery_activity", {
      delivery_token: link.token,
      visitor_handle: handle("clampv"),
      session_handle: handle("clamps"),
      beat_sequence: 1,
      // Twenty-four hours in a ten-second heartbeat.
      claimed_visible_ms: 86_400_000,
      asset_beats: [],
    });

    expect(data![0].accepted_ms).toBe(BEAT_CEILING_MS);
    const [session] = await sessionRow(link.id);
    expect(Number(session.active_visible_ms)).toBe(BEAT_CEILING_MS);
  });

  it("refuses a negative claim rather than subtracting time", async () => {
    const { link } = await linkedDelivery("NEGATIVE", 1);
    const anon = anonClient();

    await anon.rpc("record_delivery_activity", {
      delivery_token: link.token,
      visitor_handle: handle("negv"),
      session_handle: handle("negs"),
      beat_sequence: 1,
      claimed_visible_ms: 5_000,
      asset_beats: [],
    });
    await anon.rpc("record_delivery_activity", {
      delivery_token: link.token,
      visitor_handle: handle("negv"),
      session_handle: handle("negs"),
      beat_sequence: 2,
      claimed_visible_ms: -600_000,
      asset_beats: [],
    });

    const [session] = await sessionRow(link.id);
    expect(Number(session.active_visible_ms)).toBe(5_000);
  });

  it("bounds a burst of plausible beats by the wall clock", async () => {
    const { link } = await linkedDelivery("WALLCLOCK", 1);
    const anon = anonClient();

    // Ten beats, back to back, each claiming a legal ten seconds. Barely any
    // real time has passed, so only the first is worth its ceiling and the rest
    // are worth roughly nothing.
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      await anon.rpc("record_delivery_activity", {
        delivery_token: link.token,
        visitor_handle: handle("wallv"),
        session_handle: handle("walls"),
        beat_sequence: sequence,
        claimed_visible_ms: 10_000,
        asset_beats: [],
      });
    }

    const [session] = await sessionRow(link.id);
    // The first beat may claim its full ten seconds; the nine that follow are
    // clamped to elapsed time plus a two-second grace each.
    expect(Number(session.active_visible_ms)).toBeLessThan(35_000);
    expect(Number(session.active_visible_ms)).toBeGreaterThan(0);
  });

  it("counts a replayed heartbeat exactly once", async () => {
    const { link } = await linkedDelivery("REPLAY", 1);
    const anon = anonClient();

    const beat = {
      delivery_token: link.token,
      visitor_handle: handle("replayv"),
      session_handle: handle("replays"),
      beat_sequence: 1,
      claimed_visible_ms: 10_000,
      asset_beats: [],
    };

    const first = await anon.rpc("record_delivery_activity", beat);
    expect(first.data![0].accepted_ms).toBe(10_000);

    // The same beat, twenty more times. A retrying browser, or somebody
    // replaying the request in a loop.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const replay = await anon.rpc("record_delivery_activity", beat);
      expect(replay.data![0].accepted_ms).toBe(0);
    }

    const [session] = await sessionRow(link.id);
    expect(Number(session.active_visible_ms)).toBe(10_000);
    expect(session.last_sequence).toBe(1);
  });

  it("ignores a beat whose sequence has already been passed", async () => {
    const { link } = await linkedDelivery("REORDER", 1);
    const anon = anonClient();
    const base = {
      delivery_token: link.token,
      visitor_handle: handle("reov"),
      session_handle: handle("reos"),
      asset_beats: [],
    };

    await anon.rpc("record_delivery_activity", {
      ...base,
      beat_sequence: 5,
      claimed_visible_ms: 8_000,
    });
    const late = await anon.rpc("record_delivery_activity", {
      ...base,
      beat_sequence: 3,
      claimed_visible_ms: 8_000,
    });

    expect(late.data![0].accepted_ms).toBe(0);
    const [session] = await sessionRow(link.id);
    expect(Number(session.active_visible_ms)).toBe(8_000);
  });

  it("records nothing at all for a withdrawn link", async () => {
    const { link, submissionId, dispatcher } = await linkedDelivery("BEATREVOKED", 1);
    const { revokeDelivery } = await import("../src/lib/data/delivery-links");
    await revokeDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      deliveryId: link.id,
    });

    const { data } = await anonClient().rpc("record_delivery_activity", {
      delivery_token: link.token,
      visitor_handle: handle("revv"),
      session_handle: handle("revs"),
      beat_sequence: 1,
      claimed_visible_ms: 10_000,
      asset_beats: [],
    });

    expect(data ?? []).toHaveLength(0);
    expect(await sessionRow(link.id)).toHaveLength(0);
  });

  it("writes no session for a token nobody holds", async () => {
    const { data } = await anonClient().rpc("record_delivery_activity", {
      delivery_token: "n0tar3altoken".padEnd(40, "z"),
      visitor_handle: handle("ghostv"),
      session_handle: handle("ghosts"),
      beat_sequence: 1,
      claimed_visible_ms: 10_000,
      asset_beats: [],
    });
    expect(data ?? []).toHaveLength(0);
  });
});

describeIf("per-photograph viewing", () => {
  it("attributes time to the frames that were on screen, bounded by the beat", async () => {
    const { link, assetIds, dispatcher } = await linkedDelivery("PERFRAME", 2);
    const anon = anonClient();

    await anon.rpc("record_delivery_activity", {
      delivery_token: link.token,
      visitor_handle: handle("framev"),
      session_handle: handle("frames"),
      beat_sequence: 1,
      claimed_visible_ms: 10_000,
      asset_beats: [
        { asset_id: assetIds[0], visible_ms: 10_000, view_started: true },
        // A frame claiming far more than the session beat it arrived in.
        { asset_id: assetIds[1], visible_ms: 999_999, view_started: true },
      ],
    });

    const engagement = await listDeliveryEngagement(ORG_A, [link.id], dispatcher);
    const assets = engagement.get(link.id)!.assets;
    expect(assets).toHaveLength(2);
    for (const asset of assets) {
      // No frame can be worth more than the beat that carried it.
      expect(asset.activeVisibleMs).toBeLessThanOrEqual(10_000);
      expect(asset.activeVisibleMs).toBeGreaterThan(0);
    }
  });

  it("refuses time for a frame that is not in the package behind the link", async () => {
    const { link, dispatcher } = await linkedDelivery("FOREIGNFRAME", 1);
    const anon = anonClient();

    await anon.rpc("record_delivery_activity", {
      delivery_token: link.token,
      visitor_handle: handle("foreignv"),
      session_handle: handle("foreigns"),
      beat_sequence: 1,
      claimed_visible_ms: 10_000,
      // A real asset, in another workspace entirely.
      asset_beats: [
        {
          asset_id: "b0000000-0000-0000-0000-0000000000d1",
          visible_ms: 10_000,
          view_started: true,
        },
      ],
    });

    const engagement = await listDeliveryEngagement(ORG_A, [link.id], dispatcher);
    expect(engagement.get(link.id)!.assets).toHaveLength(0);
  });

  it("stops accruing for a frame once it leaves the viewport", async () => {
    const { link, assetIds, dispatcher } = await linkedDelivery("SCROLLAWAY", 2);
    const anon = anonClient();
    const base = {
      delivery_token: link.token,
      visitor_handle: handle("scrollv"),
      session_handle: handle("scrolls"),
    };

    // First beat: frame one is on screen.
    await anon.rpc("record_delivery_activity", {
      ...base,
      beat_sequence: 1,
      claimed_visible_ms: 10_000,
      asset_beats: [{ asset_id: assetIds[0], visible_ms: 10_000, view_started: true }],
    });

    // The visitor scrolls on. Frame one is no longer reported, so it accrues
    // nothing further however long the session runs.
    for (let sequence = 2; sequence <= 4; sequence += 1) {
      await anon.rpc("record_delivery_activity", {
        ...base,
        beat_sequence: sequence,
        claimed_visible_ms: 10_000,
        asset_beats: [{ asset_id: assetIds[1], visible_ms: 10_000, view_started: sequence === 2 }],
      });
    }

    const engagement = await listDeliveryEngagement(ORG_A, [link.id], dispatcher);
    const byAsset = new Map(engagement.get(link.id)!.assets.map((a) => [a.assetId, a]));
    expect(byAsset.get(assetIds[0])!.activeVisibleMs).toBe(10_000);
    expect(byAsset.get(assetIds[0])!.viewCount).toBe(1);
    // ...and the frame that stayed in view kept accruing.
    expect(byAsset.get(assetIds[1])!.activeVisibleMs).toBeGreaterThan(0);
  });
});

describeIf("what the photographer is shown", () => {
  it("distinguishes never opened, opened without analytics, and measured", async () => {
    const { link, dispatcher } = await linkedDelivery("STATES", 1);
    const anon = anonClient();

    // Nothing has happened.
    let engagement = await listDeliveryEngagement(ORG_A, [link.id], dispatcher);
    expect(engagement.get(link.id)!.state).toBe("never-opened");

    // Opened, but no heartbeat arrived: consent withheld, a blocker, a tab
    // closed instantly. This is unknown engagement, not zero engagement, and
    // the difference is the whole reason the state exists.
    await anon.rpc("open_delivery", { delivery_token: link.token });
    engagement = await listDeliveryEngagement(ORG_A, [link.id], dispatcher);
    expect(engagement.get(link.id)!.state).toBe("no-analytics");
    expect(engagement.get(link.id)!.openCount).toBe(1);

    // Now a real beat.
    await anon.rpc("record_delivery_activity", {
      delivery_token: link.token,
      visitor_handle: handle("statev"),
      session_handle: handle("states"),
      beat_sequence: 1,
      claimed_visible_ms: 9_000,
      asset_beats: [],
    });
    engagement = await listDeliveryEngagement(ORG_A, [link.id], dispatcher);
    expect(engagement.get(link.id)!.state).toBe("measured");
    expect(engagement.get(link.id)!.activeVisibleMs).toBe(9_000);
    expect(engagement.get(link.id)!.sessionCount).toBe(1);
  });

  it("counts a returning browser as one visitor across two sessions", async () => {
    const { link, dispatcher } = await linkedDelivery("RETURNING", 1);
    const anon = anonClient();

    for (const session of ["visitone", "visittwo"]) {
      await anon.rpc("record_delivery_activity", {
        delivery_token: link.token,
        visitor_handle: handle("returnv"),
        session_handle: handle(session),
        beat_sequence: 1,
        claimed_visible_ms: 5_000,
        asset_beats: [],
      });
    }

    const engagement = await listDeliveryEngagement(ORG_A, [link.id], dispatcher);
    expect(engagement.get(link.id)!.sessionCount).toBe(2);
    expect(engagement.get(link.id)!.visitorCount).toBe(1);
    expect(engagement.get(link.id)!.activeVisibleMs).toBe(10_000);
  });

  it("scopes the visitor identity to one link, so two links cannot be joined up", async () => {
    const { link: first } = await linkedDelivery("SCOPEONE", 1);
    const { link: second } = await linkedDelivery("SCOPETWO", 1);
    const anon = anonClient();

    // The same browser, the same handle, two different links.
    for (const link of [first, second]) {
      await anon.rpc("record_delivery_activity", {
        delivery_token: link.token,
        visitor_handle: handle("sharedbrowser"),
        session_handle: handle("sharedsession"),
        beat_sequence: 1,
        claimed_visible_ms: 5_000,
        asset_beats: [],
      });
    }

    const [a] = await sessionRow(first.id);
    const [b] = await sessionRow(second.id);
    // The delivery is hashed into the key, so nothing can tell these are the
    // same person -- which is the point.
    expect(a.visitor_key).not.toBe(b.visitor_key);
    expect(a.visitor_key).toHaveLength(64);
  });

  it("keeps the totals when the detailed sessions are pruned", async () => {
    const { link, dispatcher } = await linkedDelivery("RETENTION", 1);
    const service = serviceClient();
    const anon = anonClient();

    await anon.rpc("record_delivery_activity", {
      delivery_token: link.token,
      visitor_handle: handle("retainv"),
      session_handle: handle("retains"),
      beat_sequence: 1,
      claimed_visible_ms: 12_000,
      asset_beats: [],
    });

    // Age the session past any plausible retention window.
    await service
      .from("delivery_view_sessions")
      .update({ started_at: new Date(Date.now() - 400 * 86_400_000).toISOString() })
      .eq("delivery_id", link.id);

    const { data: pruned } = await service.rpc("prune_delivery_analytics", { retain_days: 90 });
    expect(pruned![0].sessions_removed).toBeGreaterThan(0);

    // The detail is gone...
    expect(await sessionRow(link.id)).toHaveLength(0);
    // ...and the photographer still has the totals.
    const engagement = await listDeliveryEngagement(ORG_A, [link.id], dispatcher);
    expect(engagement.get(link.id)!.activeVisibleMs).toBe(12_000);
    expect(engagement.get(link.id)!.sessionCount).toBe(1);
  });
});

describe("saying how long, approximately", () => {
  it.each([
    [0, /none recorded/],
    [4_000, /about 4s/],
    [65_000, /about 1m/],
    [3_700_000, /about 1h/],
  ])("describes %ims readably", (ms, expected) => {
    expect(describeActiveTime(ms as number)).toMatch(expected as RegExp);
  });

  it("never reports a duration without hedging it", () => {
    expect(describeActiveTime(43_000)).toContain("about");
  });
});
