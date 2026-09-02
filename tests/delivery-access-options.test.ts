/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPrivateDeliveryLink } from "@/lib/data/delivery-links";
import {
  ORG_A,
  anonClient,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * The per-delivery access options of migration 20260831120000, proved against
 * the database rather than the page:
 *
 *   - a link that withholds the frames until acceptance returns no frames and
 *     no preview identity to anyone, page or not, until the yes is recorded;
 *   - a link that does not offer full-resolution files refuses the download
 *     after acceptance too, and the photographer's record says which gate
 *     answered;
 *   - a link created without options behaves exactly as links always have;
 *   - the options freeze when the link is marked shared;
 *   - "Create private delivery" is idempotent per recipient: asking again
 *     returns the link already made, and only a share, a withdrawal, or an
 *     expiry makes the same recipient a new delivery.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const BACKGRID = "a0000000-0000-0000-0000-0000000000b1";
const createdShoots: string[] = [];

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** An approved submission with one snapshotted frame, ready for links. */
async function approvedSubmission(label: string) {
  const service = serviceClient();
  const owner = await clientFor("owner");

  const { data: shoot } = await service
    .from("shoots")
    .insert({
      organization_id: ORG_A,
      title: `${label} ${Date.now()}`,
      status: "preparing",
      starts_at: new Date(Date.now() - 3_600_000).toISOString(),
      created_by: OWNER,
    })
    .select("id")
    .single();
  const shootId = shoot!.id as string;
  createdShoots.push(shootId);

  const { data: asset } = await service
    .from("assets")
    .insert({
      organization_id: ORG_A,
      shoot_id: shootId,
      status: "active",
      canonical_filename: `MH_${label}_0001`,
      captured_at: new Date(Date.now() - 3_600_000).toISOString(),
      caption: "A complete caption describing the frame.",
      credit_line: "Marcus Hale / Mastline",
      copyright_notice: "© 2026 Marcus Hale",
      selected: true,
      created_by: OWNER,
    })
    .select("id")
    .single();
  const assetId = asset!.id as string;

  const { data: version } = await service
    .from("asset_versions")
    .insert({
      organization_id: ORG_A,
      asset_id: assetId,
      version_kind: "delivery",
      storage_bucket: "derivatives",
      object_key: `${ORG_A}/${shootId}/${label}.jpg`,
      sha256: await digest(`${label}-${Date.now()}`),
      bytes: 1000,
      mime_type: "image/jpeg",
      created_by: OWNER,
    })
    .select("id")
    .single();

  const { data: pkg } = await service
    .from("packages")
    .insert({
      organization_id: ORG_A,
      shoot_id: shootId,
      buyer_id: BACKGRID,
      name: `${label} package`,
      status: "needs_review",
      delivery_method: "Private delivery link",
      proposed_terms: "Non-exclusive, editorial.",
      restrictions: "Editorial use only. No commercial use.",
      created_by: OWNER,
    })
    .select("id")
    .single();
  const packageId = pkg!.id as string;

  await service.from("package_assets").insert({
    package_id: packageId,
    organization_id: ORG_A,
    asset_id: assetId,
    asset_version_id: version!.id as string,
    position: 0,
  });

  const { data: approvedRows, error } = await owner.rpc("approve_package", {
    target_package: packageId,
  });
  if (error) throw new Error(`approve_package failed: ${error.message}`);
  const submissionId = (approvedRows as { submission_id: string }[])[0].submission_id;

  return { shootId, assetId, packageId, submissionId };
}

const openAs = async (token: string) => {
  const anon = anonClient();
  const { data, error } = await anon.rpc("open_delivery", { delivery_token: token });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[])[0];
};

const framesFor = async (token: string) => {
  const anon = anonClient();
  const { data, error } = await anon.rpc("delivery_assets", { delivery_token: token });
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
};

const accept = async (token: string, name: string) => {
  const anon = anonClient();
  const { data, error } = await anon.rpc("accept_delivery", {
    delivery_token: token,
    accepted_by_name: name,
  });
  if (error) throw new Error(error.message);
  return (data ?? [])[0];
};

afterAll(async () => {
  for (const shootId of createdShoots) await purgeShoot(shootId);
});

describeIf("delivery access options", () => {
  it("withholds the frames and the preview identity until acceptance when the link says so", async () => {
    const owner = await clientFor("owner");
    const service = serviceClient();
    const { submissionId, assetId } = await approvedSubmission("optgate");

    const { link } = await createPrivateDeliveryLink({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      submissionId,
      recipientLabel: "Gated desk",
      windowDays: 7,
      deliveryNote: "Three frames from this morning.",
      requireAcceptanceToView: true,
    });

    // The open still happens and still says what the link is: the count and
    // the note arrive, the frames do not.
    const opened = await openAs(link.token);
    expect(opened.require_acceptance_to_view).toBe(true);
    expect(opened.delivery_note).toBe("Three frames from this morning.");
    expect(Number(opened.asset_count)).toBe(1);
    expect(await framesFor(link.token)).toHaveLength(0);

    // The marked preview honors the same gate, service role or not.
    const before = await service.rpc("delivery_preview", {
      delivery_token: link.token,
      target_asset: assetId,
    });
    expect(before.data ?? []).toHaveLength(0);

    await accept(link.token, "Gated Reader");

    expect(await framesFor(link.token)).toHaveLength(1);
    const after = await service.rpc("delivery_preview", {
      delivery_token: link.token,
      target_asset: assetId,
    });
    expect(after.data ?? []).toHaveLength(1);
  });

  it("refuses the download when full resolution is not offered, and records which gate answered", async () => {
    const owner = await clientFor("owner");
    const service = serviceClient();
    const { submissionId, assetId } = await approvedSubmission("optnofull");

    const { link } = await createPrivateDeliveryLink({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      submissionId,
      recipientLabel: "Preview-only desk",
      windowDays: 7,
      allowFullResolution: false,
    });

    await accept(link.token, "Preview Reader");

    // Even with the terms accepted, the file is not on offer.
    const download = await service.rpc("record_delivery_download", {
      delivery_token: link.token,
      target_asset: assetId,
    });
    expect(download.error).toBeNull();
    expect(download.data ?? []).toHaveLength(0);

    const { data: events } = await service
      .from("delivery_access_events")
      .select("kind, detail")
      .eq("delivery_id", link.id)
      .order("occurred_at");
    const kinds = (events ?? []).map((event) => event.kind);
    expect(kinds).toContain("refused");
    expect(kinds).not.toContain("downloaded");
    expect((events ?? []).map((event) => event.detail)).toContain(
      "full-resolution download not offered on this link",
    );
  });

  it("keeps a link created without options behaving exactly as before", async () => {
    const owner = await clientFor("owner");
    const service = serviceClient();
    const { submissionId, assetId } = await approvedSubmission("optlegacy");

    const { link } = await createPrivateDeliveryLink({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      submissionId,
      recipientLabel: "Legacy desk",
      windowDays: 7,
    });

    // Frames visible before acceptance; downloads gated on it; then allowed.
    const opened = await openAs(link.token);
    expect(opened.require_acceptance_to_view).toBe(false);
    expect(opened.allow_full_resolution).toBe(true);
    expect(opened.delivery_note ?? null).toBeNull();
    expect(await framesFor(link.token)).toHaveLength(1);

    const early = await service.rpc("record_delivery_download", {
      delivery_token: link.token,
      target_asset: assetId,
    });
    expect(early.data ?? []).toHaveLength(0);

    await accept(link.token, "Legacy Reader");
    const allowed = await service.rpc("record_delivery_download", {
      delivery_token: link.token,
      target_asset: assetId,
    });
    expect(allowed.data ?? []).toHaveLength(1);
  });

  it("freezes the options when the link is marked shared", async () => {
    const owner = await clientFor("owner");
    const service = serviceClient();
    const { submissionId } = await approvedSubmission("optfreeze");

    const { link } = await createPrivateDeliveryLink({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      submissionId,
      recipientLabel: "Frozen desk",
      windowDays: 7,
      deliveryNote: "As offered.",
      allowFullResolution: true,
      requireAcceptanceToView: false,
    });

    // Editable before the share, even by the service role's standards: the
    // trigger only locks after shared_at.
    const beforeShare = await service
      .from("submission_deliveries")
      .update({ delivery_note: "Still a draft note." })
      .eq("id", link.id)
      .select("id");
    expect(beforeShare.error).toBeNull();

    const { error: shareError } = await owner.rpc("mark_delivery_shared", {
      target_delivery: link.id,
    });
    expect(shareError).toBeNull();

    for (const patch of [
      { delivery_note: "Rewritten after the fact." },
      { allow_full_resolution: false },
      { require_acceptance_to_view: true },
    ]) {
      const { error } = await service.from("submission_deliveries").update(patch).eq("id", link.id);
      expect(error, JSON.stringify(patch)).not.toBeNull();
      expect(error!.message).toMatch(/access options.*part of the record/);
    }
  });

  it("returns the link already made instead of minting a second one", async () => {
    const owner = await clientFor("owner");
    const service = serviceClient();
    const { submissionId } = await approvedSubmission("optidem");

    const first = await createPrivateDeliveryLink({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      submissionId,
      recipientLabel: "New York picture desk",
      windowDays: 7,
    });
    expect(first.reused).toBe(false);

    const repeat = await createPrivateDeliveryLink({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      submissionId,
      recipientLabel: "New York picture desk",
      windowDays: 7,
    });
    expect(repeat.reused).toBe(true);
    expect(repeat.link.id).toBe(first.link.id);

    // A different recipient is a different delivery.
    const other = await createPrivateDeliveryLink({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      submissionId,
      recipientLabel: "London syndication",
      windowDays: 7,
    });
    expect(other.reused).toBe(false);
    expect(other.link.id).not.toBe(first.link.id);

    // Once the first is shared, the same recipient means a new delivery --
    // that is what "Share with another recipient" does.
    const { error: shareError } = await owner.rpc("mark_delivery_shared", {
      target_delivery: first.link.id,
    });
    expect(shareError).toBeNull();

    const afterShare = await createPrivateDeliveryLink({
      client: owner,
      organizationId: ORG_A,
      actorId: OWNER,
      submissionId,
      recipientLabel: "New York picture desk",
      windowDays: 7,
    });
    expect(afterShare.reused).toBe(false);
    expect(afterShare.link.id).not.toBe(first.link.id);

    const { data: links } = await service
      .from("submission_deliveries")
      .select("id")
      .eq("submission_id", submissionId);
    expect(links).toHaveLength(3);
  });

  it("creates exactly one submission however many times the approval is asked for", async () => {
    const owner = await clientFor("owner");
    const service = serviceClient();
    const { packageId, submissionId } = await approvedSubmission("optonce");

    // The package is already approved; asking again must refuse, not duplicate.
    const again = await owner.rpc("approve_package", { target_package: packageId });
    expect(again.error).not.toBeNull();
    expect(again.error!.message).toMatch(/already been approved/);

    const { data: submissions } = await service
      .from("submissions")
      .select("id")
      .eq("package_id", packageId);
    expect(submissions).toHaveLength(1);
    expect(submissions![0].id).toBe(submissionId);
  });
});
