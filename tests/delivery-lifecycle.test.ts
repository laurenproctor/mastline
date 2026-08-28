/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPackageFromSelection } from "../src/lib/data/packages";
import { approvePackageAndCreateSubmission } from "../src/lib/data/submissions";
import {
  createDelivery,
  listDeliveries,
  markDeliveryShared,
  revokeDelivery,
  updateDeliveryAttribution,
} from "../src/lib/data/delivery-links";
import { listDeliveryEngagement } from "../src/lib/data/delivery-analytics";
import { deliveryUrlWithParameters } from "../src/lib/delivery-parameters";
import {
  ORG_A,
  anonClient,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * Approval, link, share, open, view, accept, download -- seven separate facts.
 *
 * The defect this whole sprint exists to fix was that Mastline recorded the
 * first of these and reported all of them. Every test below pins one boundary
 * between two of the seven, because the states are only useful if they cannot
 * quietly collapse back into each other.
 *
 * Everything runs through the same functions a Server Action calls, against a
 * real database, with row level security in force. The heartbeat tests go
 * through the anonymous RPC exactly as a recipient's browser would, because the
 * clamping is the point and clamping in a unit test would only prove that the
 * test's own arithmetic works.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const EDITOR = "22222222-2222-2222-2222-222222222222";
const DISPATCHER = "33333333-3333-3333-3333-333333333333";
const BACKGRID = "a0000000-0000-0000-0000-0000000000b1";

const shoots: string[] = [];

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** An approved package with a queued submission, which is where a link starts. */
async function approvedSubmission(label: string, frames = 2) {
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
        canonical_filename: `ML_${label}_${index}`,
        captured_at: new Date(Date.now() - 1_800_000).toISOString(),
        headline: `${label} frame ${index}`,
        caption: `A caption for ${label} frame ${index}, long enough to pass the gate.`,
        credit_line: "Mastline test",
        selected: true,
        created_by: OWNER,
      })
      .select("id")
      .single();
    const assetId = asset!.id as string;
    assetIds.push(assetId);

    await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: assetId,
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

  return { shootId, packageId, submissionId, assetIds, dispatcher };
}

async function submissionRow(submissionId: string) {
  const { data } = await serviceClient()
    .from("submissions")
    .select("status, sent_at, delivered_at, acknowledged_at")
    .eq("id", submissionId)
    .single();
  return data!;
}

async function packageStatus(packageId: string) {
  const { data } = await serviceClient()
    .from("packages")
    .select("status")
    .eq("id", packageId)
    .single();
  return data!.status as string;
}

afterAll(async () => {
  for (const shootId of shoots) await purgeShoot(shootId);
});

describeIf("creating a link claims nothing", () => {
  it("leaves the submission queued, unsent, and the package approved", async () => {
    const { submissionId, packageId, dispatcher } = await approvedSubmission("LINKONLY", 1);

    const before = await submissionRow(submissionId);
    expect(before.status).toBe("queued");
    expect(before.sent_at).toBeNull();

    await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      recipientLabel: "New York picture desk",
      windowDays: 7,
    });

    const after = await submissionRow(submissionId);
    expect(after.status).toBe("queued");
    expect(after.sent_at).toBeNull();
    expect(after.delivered_at).toBeNull();
    expect(await packageStatus(packageId)).toBe("approved");
  });

  it("refuses a link into a package that is still editable", async () => {
    const dispatcher = await clientFor("dispatcher");
    const service = serviceClient();

    const { data: shoot } = await service
      .from("shoots")
      .insert({
        organization_id: ORG_A,
        title: `UNAPPROVED ${Date.now()}`,
        status: "preparing",
        starts_at: new Date().toISOString(),
        created_by: OWNER,
      })
      .select("id")
      .single();
    shoots.push(shoot!.id as string);

    // A submission whose package was never approved should have no link.
    const { data: pkg } = await service
      .from("packages")
      .insert({
        organization_id: ORG_A,
        shoot_id: shoot!.id,
        buyer_id: BACKGRID,
        name: "Unapproved",
        status: "needs_review",
        delivery_method: "SFTP",
        proposed_terms: "Terms.",
        created_by: OWNER,
      })
      .select("id")
      .single();

    const { data: submission } = await service
      .from("submissions")
      .insert({
        organization_id: ORG_A,
        package_id: pkg!.id,
        buyer_id: BACKGRID,
        status: "queued",
        delivery_method: "SFTP",
        external_reference: `UNAPP-${Date.now()}`,
        created_by: OWNER,
      })
      .select("id")
      .single();

    await expect(
      createDelivery({
        client: dispatcher,
        organizationId: ORG_A,
        actorId: DISPATCHER,
        submissionId: submission!.id as string,
        windowDays: 7,
      }),
    ).rejects.toThrow(/Approve the package/i);

    await service.rpc("purge_submission_admin", { target_submission: submission!.id });
    await service.rpc("purge_package_admin", { target_package: pkg!.id });
  });
});

describeIf("two recipients are measured separately", () => {
  it("gives each its own token, attribution, and activity", async () => {
    const { submissionId, dispatcher } = await approvedSubmission("TWORECIP", 1);

    const newYork = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      recipientLabel: "New York picture desk",
      contactReference: "buyer-contact-123",
      customParameters: { campaign: "awards-season", desk: "new-york" },
      windowDays: 7,
    });

    const london = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      recipientLabel: "London syndication",
      customParameters: { campaign: "awards-season", desk: "london" },
      windowDays: 7,
    });

    expect(newYork.token).not.toBe(london.token);
    expect(newYork.customParameters).toEqual({ campaign: "awards-season", desk: "new-york" });
    expect(london.customParameters).toEqual({ campaign: "awards-season", desk: "london" });

    // Only New York is opened.
    const anon = anonClient();
    await anon.rpc("open_delivery", { delivery_token: newYork.token });

    const engagement = await listDeliveryEngagement(ORG_A, [newYork.id, london.id], dispatcher);
    expect(engagement.get(newYork.id)!.openCount).toBe(1);
    expect(engagement.get(newYork.id)!.firstOpenedAt).toBeTruthy();

    // The other link is untouched, and reports as never opened rather than as
    // zero engagement.
    expect(engagement.get(london.id)!.openCount).toBe(0);
    expect(engagement.get(london.id)!.state).toBe("never-opened");
  });

  it("puts the attribution in the copied URL and the recipient nowhere near it", async () => {
    const { submissionId, dispatcher } = await approvedSubmission("URLPII", 1);

    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      recipientLabel: "Jane Smith, New York picture desk",
      contactReference: "buyer-contact-123",
      customParameters: { campaign: "awards-season", channel: "email" },
      windowDays: 7,
    });

    const url = deliveryUrlWithParameters("https://mastline.co", link.token, link.customParameters);

    expect(url).toContain("campaign=awards-season");
    expect(url).toContain("channel=email");
    // The whole point of the protected columns.
    expect(url).not.toMatch(/jane/i);
    expect(url).not.toMatch(/smith/i);
    expect(url).not.toMatch(/picture desk/i);
    expect(url).not.toContain("buyer-contact-123");
  });

  it("keeps the stored attribution when the visitor edits the query string", async () => {
    const { submissionId, dispatcher } = await approvedSubmission("TAMPER", 1);

    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      recipientLabel: "New York picture desk",
      customParameters: { campaign: "awards-season" },
      windowDays: 7,
    });

    // A recipient rewriting the query and opening it. The token is a path
    // segment; nothing reads the query at all.
    const anon = anonClient();
    const opened = await anon.rpc("open_delivery", { delivery_token: link.token });
    expect((opened.data ?? []).length).toBe(1);

    const [stored] = await listDeliveries(ORG_A, submissionId, dispatcher);
    expect(stored.customParameters).toEqual({ campaign: "awards-season" });
    expect(stored.recipientLabel).toBe("New York picture desk");
  });
});

describeIf("marking a link as shared", () => {
  it("stamps who and when, moves the submission to sent, and the package to sending", async () => {
    const { submissionId, packageId, shootId, dispatcher } = await approvedSubmission("SHARE", 1);

    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      recipientLabel: "New York picture desk",
      windowDays: 7,
    });

    const result = await markDeliveryShared({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      deliveryId: link.id,
    });
    expect(result.alreadyShared).toBe(false);

    const [stored] = await listDeliveries(ORG_A, submissionId, dispatcher);
    expect(stored.sharedAt).toBeTruthy();
    expect(stored.sharedBy).toBe(DISPATCHER);

    const submission = await submissionRow(submissionId);
    expect(submission.status).toBe("sent");
    expect(submission.sent_at).toBeTruthy();
    // Nothing has been delivered: nobody has opened it.
    expect(submission.delivered_at).toBeNull();
    expect(await packageStatus(packageId)).toBe("sending");

    const { data: shoot } = await serviceClient()
      .from("shoots")
      .select("status")
      .eq("id", shootId)
      .single();
    expect(shoot!.status).toBe("dispatched");
  });

  it("is idempotent and never moves the first share timestamp", async () => {
    const { submissionId, dispatcher } = await approvedSubmission("SHARETWICE", 1);
    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      windowDays: 7,
    });

    const first = await markDeliveryShared({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      deliveryId: link.id,
    });
    const second = await markDeliveryShared({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      deliveryId: link.id,
    });

    expect(second.alreadyShared).toBe(true);
    expect(second.sharedAt).toBe(first.sharedAt);
  });

  it("refuses to let the share fields contradict each other", async () => {
    const { submissionId, dispatcher } = await approvedSubmission("PAIRED", 1);
    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      windowDays: 7,
    });

    // A share time with nobody attached to it is not a share.
    const { error } = await serviceClient()
      .from("submission_deliveries")
      .update({ shared_at: new Date().toISOString() })
      .eq("id", link.id);
    expect(error).toBeTruthy();
  });

  it("lets the photographer fix the attribution until the moment they share it", async () => {
    const { submissionId, dispatcher } = await approvedSubmission("EDITWINDOW", 1);
    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      recipientLabel: "New Yrok picture desk",
      customParameters: { campaign: "awrads-season" },
      windowDays: 7,
    });

    await updateDeliveryAttribution({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      deliveryId: link.id,
      recipientLabel: "New York picture desk",
      contactReference: "buyer-contact-123",
      customParameters: { campaign: "awards-season" },
    });

    const [fixed] = await listDeliveries(ORG_A, submissionId, dispatcher);
    expect(fixed.recipientLabel).toBe("New York picture desk");
    expect(fixed.contactReference).toBe("buyer-contact-123");
    expect(fixed.customParameters).toEqual({ campaign: "awards-season" });

    await markDeliveryShared({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      deliveryId: link.id,
    });

    // ...and the window closes. What the desk was told is now the record.
    await expect(
      updateDeliveryAttribution({
        client: dispatcher,
        organizationId: ORG_A,
        actorId: DISPATCHER,
        submissionId,
        deliveryId: link.id,
        recipientLabel: "Somebody else",
        customParameters: { campaign: "rewritten" },
      }),
    ).rejects.toThrow(/marked as shared/i);
  });

  it("refuses an edit that names a credential or a person", async () => {
    const { submissionId, dispatcher } = await approvedSubmission("EDITGUARD", 1);
    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      windowDays: 7,
    });

    // The database check applies to an update as much as to an insert.
    await expect(
      updateDeliveryAttribution({
        client: dispatcher,
        organizationId: ORG_A,
        actorId: DISPATCHER,
        submissionId,
        deliveryId: link.id,
        customParameters: { token: "forged" },
      }),
    ).rejects.toThrow();
  });

  it("freezes the attribution once the link has been shared", async () => {
    const { submissionId, dispatcher } = await approvedSubmission("FREEZEPARAM", 1);
    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      recipientLabel: "New York picture desk",
      customParameters: { campaign: "awards-season" },
      windowDays: 7,
    });

    const service = serviceClient();

    // Before sharing, an edit is allowed: the operator may still fix a typo.
    const early = await service
      .from("submission_deliveries")
      .update({ custom_parameters: { campaign: "awards-season-2026" } })
      .eq("id", link.id);
    expect(early.error).toBeNull();

    await markDeliveryShared({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      deliveryId: link.id,
    });

    for (const patch of [
      { custom_parameters: { campaign: "rewritten" } },
      { recipient_label: "Somebody else" },
      { contact_reference: "another-contact" },
    ]) {
      const { error } = await service.from("submission_deliveries").update(patch).eq("id", link.id);
      expect(
        error,
        `changing ${Object.keys(patch)[0]} after sharing should be refused`,
      ).toBeTruthy();
    }
  });
});

describeIf("a recipient opening the link", () => {
  it("is what moves the submission to delivered, once", async () => {
    const { submissionId, packageId, dispatcher } = await approvedSubmission("OPEN", 1);
    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      recipientLabel: "New York picture desk",
      windowDays: 7,
    });
    await markDeliveryShared({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      deliveryId: link.id,
    });

    const anon = anonClient();
    await anon.rpc("open_delivery", { delivery_token: link.token });

    const first = await submissionRow(submissionId);
    expect(first.status).toBe("delivered");
    expect(first.delivered_at).toBeTruthy();
    expect(await packageStatus(packageId)).toBe("delivered");

    // A second open is a legitimate event and changes no timestamp.
    await anon.rpc("open_delivery", { delivery_token: link.token });
    const second = await submissionRow(submissionId);
    expect(second.delivered_at).toBe(first.delivered_at);
    expect(second.sent_at).toBe(first.sent_at);

    const engagement = await listDeliveryEngagement(ORG_A, [link.id], dispatcher);
    expect(engagement.get(link.id)!.openCount).toBe(2);
    expect(engagement.get(link.id)!.firstOpenedAt).toBeTruthy();
    expect(engagement.get(link.id)!.lastOpenedAt).not.toBe(engagement.get(link.id)!.firstOpenedAt);
  });

  it("fills in missing send evidence when the operator never marked it shared", async () => {
    const { submissionId, dispatcher } = await approvedSubmission("OPENFIRST", 1);
    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      recipientLabel: "New York picture desk",
      windowDays: 7,
    });

    await anonClient().rpc("open_delivery", { delivery_token: link.token });

    const submission = await submissionRow(submissionId);
    // Somebody plainly has it, so the send evidence holds.
    expect(submission.sent_at).toBeTruthy();
    expect(submission.status).toBe("delivered");

    // ...but the photographer never said they shared it, and Mastline does not
    // say so on their behalf.
    const [stored] = await listDeliveries(ORG_A, submissionId, dispatcher);
    expect(stored.sharedAt).toBeUndefined();
  });

  it("stops opening once withdrawn, and keeps the history", async () => {
    const { submissionId, dispatcher } = await approvedSubmission("WITHDRAW", 1);
    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      windowDays: 7,
    });

    const anon = anonClient();
    await anon.rpc("open_delivery", { delivery_token: link.token });

    await revokeDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      deliveryId: link.id,
    });

    const afterRevoke = await anon.rpc("open_delivery", { delivery_token: link.token });
    expect(afterRevoke.data ?? []).toHaveLength(0);

    // The link row and its access record survive: the offer having existed is
    // history, and a refusal is itself evidence.
    const [stored] = await listDeliveries(ORG_A, submissionId, dispatcher);
    expect(stored.revokedAt).toBeTruthy();

    const { data: events } = await serviceClient()
      .from("delivery_access_events")
      .select("kind")
      .eq("delivery_id", link.id);
    const kinds = (events ?? []).map((event) => event.kind);
    expect(kinds).toContain("opened");
    expect(kinds).toContain("refused");
  });

  it("acknowledges the submission when somebody accepts the terms", async () => {
    const { submissionId, dispatcher } = await approvedSubmission("ACCEPT", 1);
    const link = await createDelivery({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      windowDays: 7,
    });

    const anon = anonClient();
    await anon.rpc("open_delivery", { delivery_token: link.token });
    await anon.rpc("accept_delivery", {
      delivery_token: link.token,
      accepted_by_name: "Dana Whitfield",
    });

    const submission = await submissionRow(submissionId);
    expect(submission.status).toBe("acknowledged");
    expect(submission.acknowledged_at).toBeTruthy();

    // The acceptance is attributable to the link it came through, which is what
    // lets the analytics screen say who identified themselves on which link.
    const { data: acceptance } = await serviceClient()
      .from("delivery_acceptances")
      .select("delivery_id, accepted_by")
      .eq("delivery_id", link.id)
      .single();
    expect(acceptance!.accepted_by).toBe("Dana Whitfield");
  });
});
