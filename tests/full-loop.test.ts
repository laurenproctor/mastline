/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPackageFromSelection } from "../src/lib/data/packages";
import {
  approvePackageAndCreateSubmission,
  recordSubmissionOutcome,
} from "../src/lib/data/submissions";
import { createDelivery, markDeliveryShared } from "../src/lib/data/delivery-links";
import {
  allocatePayment,
  getMoneySummary,
  listLicenses,
  recordLicense,
  recordPayment,
} from "../src/lib/data/money";
import { money } from "../src/lib/money";
import {
  ORG_A,
  anonClient,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * One shoot, all the way from selection to money in the bank.
 *
 * This is the definition-of-done path: create, package, approve, send, record
 * the outcome, record the sale, take the payment, attribute it, and see the
 * earnings appear against the frame that produced them. Each step runs as the
 * role that would really perform it.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const EDITOR = "22222222-2222-2222-2222-222222222222";
const DISPATCHER = "33333333-3333-3333-3333-333333333333";
const FINANCE = "44444444-4444-4444-4444-444444444444";
const MEGA = "a0000000-0000-0000-0000-0000000000b2";

const cleanup: { shoots: string[]; payments: string[]; licenses: string[] } = {
  shoots: [],
  payments: [],
  licenses: [],
};

afterAll(async () => {
  const service = serviceClient();
  for (const id of cleanup.payments) await service.from("payments").delete().eq("id", id);
  for (const id of cleanup.licenses) await service.from("licenses").delete().eq("id", id);
  for (const shootId of cleanup.shoots) await purgeShoot(shootId);
});

describeIf("assignment to payment", () => {
  it("carries one frame from selection through to recorded earnings", async () => {
    const service = serviceClient();
    const editor = await clientFor("editor");
    const dispatcher = await clientFor("dispatcher");
    const finance = await clientFor("finance");

    // --- A shoot with one complete, selected frame -------------------------
    const { data: shoot } = await service
      .from("shoots")
      .insert({
        organization_id: ORG_A,
        title: `Full loop ${Date.now()}`,
        status: "preparing",
        starts_at: new Date(Date.now() - 1_800_000).toISOString(),
        created_by: OWNER,
      })
      .select("id")
      .single();
    const shootId = shoot!.id as string;
    cleanup.shoots.push(shootId);

    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        status: "active",
        canonical_filename: "MH_LOOP_0001",
        captured_at: new Date(Date.now() - 1_800_000).toISOString(),
        caption: "A complete caption describing the frame.",
        credit_line: "Marcus Hale / Mastline",
        copyright_notice: "© 2026 Marcus Hale",
        selected: true,
        created_by: OWNER,
      })
      .select("id")
      .single();
    const assetId = asset!.id as string;

    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`loop-${Date.now()}`)),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: assetId,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${ORG_A}/${shootId}/loop.arw`,
      sha256: hash,
      bytes: 1000,
      mime_type: "image/x-sony-arw",
      created_by: OWNER,
    });

    // --- Editor builds the package -----------------------------------------
    const { id: packageId, assetCount } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: EDITOR,
      shootId,
      buyerId: MEGA,
      name: "Full loop package",
      deliveryMethod: "SFTP",
      proposedTerms: "Non-exclusive agency distribution; photographer retains copyright.",
      restrictions: "Editorial use only.",
    });
    expect(assetCount).toBe(1);

    // --- Dispatcher approves. Nothing is sent. -----------------------------
    const { submissionId, reference } = await approvePackageAndCreateSubmission({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      packageId,
      recipientLabel: "Chicago picture desk",
    });
    expect(reference).toBeTruthy();

    const { data: approved } = await service
      .from("submissions")
      .select("status, sent_at, delivered_at, terms_snapshot, delivery_manifest")
      .eq("id", submissionId)
      .single();
    expect(approved!.status).toBe("queued");
    expect(approved!.sent_at).toBeNull();
    const manifest = (approved!.delivery_manifest as { assets: { assetId: string }[] }).assets;
    expect(manifest).toHaveLength(1);
    expect(manifest[0].assetId).toBe(assetId);

    // --- A link for one recipient. Still nothing sent. ----------------------
    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      recipientLabel: "Chicago picture desk",
      customParameters: { campaign: "awards-season", channel: "email" },
      windowDays: 7,
    });

    const { data: afterLink } = await service
      .from("submissions")
      .select("status, sent_at")
      .eq("id", submissionId)
      .single();
    expect(afterLink!.status).toBe("queued");
    expect(afterLink!.sent_at).toBeNull();

    // --- The photographer says they passed it on ----------------------------
    await markDeliveryShared({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      deliveryId: link.id,
    });

    const { data: afterShare } = await service
      .from("submissions")
      .select("status, sent_at, delivered_at")
      .eq("id", submissionId)
      .single();
    expect(afterShare!.status).toBe("sent");
    expect(afterShare!.sent_at).toBeTruthy();
    expect(afterShare!.delivered_at).toBeNull();

    // The package is sending, not delivered: nobody has opened anything.
    const { data: sendingPackage } = await service
      .from("packages")
      .select("status")
      .eq("id", packageId)
      .single();
    expect(sendingPackage!.status).toBe("sending");

    // --- The desk opens it. That is the delivery. ---------------------------
    const anon = anonClient();
    await anon.rpc("open_delivery", { delivery_token: link.token });

    const { data: afterOpen } = await service
      .from("submissions")
      .select("status, sent_at, delivered_at")
      .eq("id", submissionId)
      .single();
    expect(afterOpen!.status).toBe("delivered");
    expect(afterOpen!.delivered_at).toBeTruthy();
    // The send timestamp is the share, not the open, and it did not move.
    expect(afterOpen!.sent_at).toBe(afterShare!.sent_at);

    // --- Somebody identifies themselves by accepting ------------------------
    await anon.rpc("accept_delivery", {
      delivery_token: link.token,
      accepted_by_name: "Dana Whitfield",
    });

    const { data: afterAccept } = await service
      .from("submissions")
      .select("status, acknowledged_at, delivered_at")
      .eq("id", submissionId)
      .single();
    expect(afterAccept!.status).toBe("acknowledged");
    expect(afterAccept!.acknowledged_at).toBeTruthy();
    // The first delivery time survives the acceptance.
    expect(afterAccept!.delivered_at).toBe(afterOpen!.delivered_at);

    // --- The buyer comes back -----------------------------------------------
    await recordSubmissionOutcome({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      status: "sold",
      outcomeNote: "Sold for a print run.",
    });

    // --- Finance records the sale. Generated inside Mastline, so 70/30. -----
    const sale = await recordLicense({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      submissionId,
      buyerId: MEGA,
      licenseeName: "The Mega Agency",
      origin: "mastline_sales_engine",
      saleBase: money(85_000),
      media: "US editorial",
      territory: "United States",
      assetIds: [assetId],
    });
    cleanup.licenses.push(sale.id);

    expect(sale.salesEngineShare.minor).toBe(25_500);
    expect(sale.photographerShare.minor).toBe(59_500);
    expect(sale.salesEngineShare.minor + sale.photographerShare.minor).toBe(85_000);

    // --- The money arrives ---------------------------------------------------
    const { id: paymentId } = await recordPayment({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      buyerId: MEGA,
      status: "received",
      source: "checkout",
      reference: `LOOP-${Date.now()}`,
      gross: money(85_000),
      platformFee: money(sale.salesEngineShare.minor),
      net: money(sale.photographerShare.minor),
      receivedAt: new Date().toISOString(),
    });
    cleanup.payments.push(paymentId);

    await allocatePayment({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      paymentId,
      licenseId: sale.id,
      assetId,
      amount: money(sale.photographerShare.minor),
    });

    // --- The frame now carries its own commercial history --------------------
    const { data: earnings } = await service
      .from("asset_lifetime_earnings")
      .select("lifetime_earnings_minor")
      .eq("asset_id", assetId)
      .single();
    expect(Number(earnings!.lifetime_earnings_minor)).toBe(59_500);

    // The workspace summary includes this payment. Asserting on a delta would
    // be fragile, so this checks that the figures are at least what this loop
    // contributed and that the specific records carry the exact amounts.
    const summaryAfter = await getMoneySummary(ORG_A, finance);
    expect(summaryAfter.netReceived.minor).toBeGreaterThanOrEqual(59_500);
    expect(summaryAfter.salesEngineShareToDate.minor).toBeGreaterThanOrEqual(25_500);

    const { data: storedPayment } = await service
      .from("payments")
      .select("gross_minor, platform_fee_minor, net_minor")
      .eq("id", paymentId)
      .single();
    expect(Number(storedPayment!.gross_minor)).toBe(85_000);
    expect(Number(storedPayment!.platform_fee_minor)).toBe(25_500);
    expect(Number(storedPayment!.net_minor)).toBe(59_500);

    // --- The whole chain is traceable ---------------------------------------
    const licenses = await listLicenses(ORG_A, finance);
    const recorded = licenses.find((license) => license.id === sale.id);
    expect(recorded?.submissionId).toBe(submissionId);
    expect(recorded?.assetIds).toContain(assetId);

    const { data: events } = await service
      .from("activity_events")
      .select("action")
      .in("entity_id", [packageId, submissionId, sale.id, paymentId]);
    const actions = new Set((events ?? []).map((event) => event.action));
    expect(actions.has("package.created")).toBe(true);
    expect(actions.has("package.approved")).toBe(true);
    /*
     * The two steps that used to be invisible. Approval no longer writes a
     * `submission.sent`, because approving sends nothing; what the timeline now
     * carries is the link being made and, separately, the photographer saying
     * they passed it on.
     */
    expect(actions.has("delivery.link_created")).toBe(true);
    expect(actions.has("delivery.link_shared")).toBe(true);
    expect(actions.has("submission.sent")).toBe(false);
    expect(actions.has("submission.sold")).toBe(true);
    expect(actions.has("license.recorded")).toBe(true);
    expect(actions.has("payment.recorded")).toBe(true);
    expect(actions.has("payment.allocated")).toBe(true);

    // --- And what was sent is still exactly what was sent --------------------
    const rewrite = await service
      .from("submissions")
      .update({ terms_snapshot: "Rewritten after the sale" })
      .eq("id", submissionId);
    expect(rewrite.error).not.toBeNull();
  });
});
