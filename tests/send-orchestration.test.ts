/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPackageFromSelection } from "../src/lib/data/packages";
import {
  approvePackageAndCreateSubmission,
  recordSubmissionOutcome,
} from "../src/lib/data/submissions";
import { allocatePayment, recordLicense, recordPayment } from "../src/lib/data/money";
import { money } from "../src/lib/money";
import { ORG_A, clientFor, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The real approval path, not a re-implementation of it.
 *
 * approvePackageAndCreateSubmission is the point of no return in the whole
 * product, so it is exercised through the same function a Server Action calls,
 * with row level security in force.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const DISPATCHER = "33333333-3333-3333-3333-333333333333";
const FINANCE = "44444444-4444-4444-4444-444444444444";
const BACKGRID = "a0000000-0000-0000-0000-0000000000b1";

const shoots: string[] = [];
const payments: string[] = [];
const licenses: string[] = [];

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A shoot with `count` complete, selected assets. */
async function readyShoot(label: string, count = 2) {
  const service = serviceClient();
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
  for (let index = 0; index < count; index += 1) {
    const { data: asset } = await service
      .from("assets")
      .insert({
        organization_id: ORG_A,
        shoot_id: shootId,
        status: "active",
        canonical_filename: `MH_${label}_${index}`,
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
    assetIds.push(assetId);

    await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: assetId,
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${ORG_A}/${shootId}/${label}_${index}.arw`,
      sha256: await digest(`${label}-${index}-${Date.now()}`),
      bytes: 1000,
      mime_type: "image/x-sony-arw",
      created_by: OWNER,
    });
  }
  return { shootId, assetIds };
}

afterAll(async () => {
  const service = serviceClient();
  for (const id of payments) await service.from("payments").delete().eq("id", id);
  for (const id of licenses) await service.from("licenses").delete().eq("id", id);
  for (const shootId of shoots) await purgeShoot(shootId);
});

describeIf("createPackageFromSelection", () => {
  it("packages every selected asset and names a specific version", async () => {
    const editor = await clientFor("editor");
    const { shootId } = await readyShoot("PKG", 3);

    const { id, assetCount } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: "22222222-2222-2222-2222-222222222222",
      shootId,
      buyerId: BACKGRID,
      name: "Test package",
      deliveryMethod: "SFTP",
      proposedTerms: "Non-exclusive agency distribution.",
      restrictions: "Editorial use only.",
    });

    expect(assetCount).toBe(3);
    const { data: members } = await serviceClient()
      .from("package_assets")
      .select("asset_version_id, position")
      .eq("package_id", id)
      .order("position");
    expect(members).toHaveLength(3);
    for (const member of members ?? []) {
      expect(member.asset_version_id).toBeTruthy();
    }
    expect((members ?? []).map((m) => m.position)).toEqual([0, 1, 2]);
  });

  it("refuses to build a package from nothing", async () => {
    const editor = await clientFor("editor");
    const { shootId } = await readyShoot("EMPTY", 0);

    await expect(
      createPackageFromSelection({
        client: editor,
        organizationId: ORG_A,
        actorId: "22222222-2222-2222-2222-222222222222",
        shootId,
        buyerId: BACKGRID,
        name: "Empty",
      }),
    ).rejects.toThrow(/Select at least one asset/i);
  });
});

describeIf("approvePackageAndCreateSubmission", () => {
  it("freezes the manifest and stamps approval without claiming a send", async () => {
    const dispatcher = await clientFor("dispatcher");
    const editor = await clientFor("editor");
    const { shootId, assetIds } = await readyShoot("SEND", 2);

    const { id: packageId } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: "22222222-2222-2222-2222-222222222222",
      shootId,
      buyerId: BACKGRID,
      name: "Send package",
      deliveryMethod: "SFTP",
      proposedTerms: "Non-exclusive agency distribution.",
      restrictions: "Editorial use only.",
    });

    const { submissionId, reference } = await approvePackageAndCreateSubmission({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      packageId,
      recipientLabel: "New York picture desk",
    });

    expect(reference).toMatch(/^[A-Z]{1,3}-\d{4}-\d{4}$/);

    const service = serviceClient();
    const { data: submission } = await service
      .from("submissions")
      .select(
        "status, sent_at, terms_snapshot, restrictions_snapshot, delivery_manifest, recipient_snapshot",
      )
      .eq("id", submissionId)
      .single();

    /*
     * The heart of this sprint. Approval freezes a package; it does not send
     * one. A submission that says "sent" with a send timestamp, before a link
     * exists and before anything has left Mastline, is the product asserting
     * something it cannot support.
     */
    expect(submission!.status).toBe("queued");
    expect(submission!.sent_at).toBeNull();
    expect(submission!.terms_snapshot).toBe("Non-exclusive agency distribution.");
    expect(submission!.restrictions_snapshot).toBe("Editorial use only.");
    expect((submission!.recipient_snapshot as Record<string, string>).desk).toBe(
      "New York picture desk",
    );

    const manifest = (submission!.delivery_manifest as { assets: { assetId: string }[] }).assets;
    expect(manifest).toHaveLength(2);
    expect(manifest.map((entry) => entry.assetId).sort()).toEqual([...assetIds].sort());

    const { data: pkg } = await service
      .from("packages")
      .select("status, approved_by, approved_at")
      .eq("id", packageId)
      .single();
    expect(pkg!.status).toBe("approved");
    expect(pkg!.approved_by).toBe(DISPATCHER);
    expect(pkg!.approved_at).toBeTruthy();

    // The shoot has not been dispatched, because nothing has been dispatched.
    const { data: shoot } = await service
      .from("shoots")
      .select("status")
      .eq("id", shootId)
      .single();
    expect(shoot!.status).not.toBe("dispatched");

    // The approval is in the operational record. A send is not, because there
    // was none.
    const { data: events } = await service
      .from("activity_events")
      .select("action")
      .in("entity_id", [packageId, submissionId]);
    const actions = (events ?? []).map((event) => event.action);
    expect(actions).toContain("package.approved");
    expect(actions).not.toContain("submission.sent");
  });

  it("freezes the approved package against later edits", async () => {
    const dispatcher = await clientFor("dispatcher");
    const editor = await clientFor("editor");
    const { shootId, assetIds } = await readyShoot("FROZEN", 1);

    const { id: packageId } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: "22222222-2222-2222-2222-222222222222",
      shootId,
      buyerId: BACKGRID,
      name: "Frozen package",
      deliveryMethod: "SFTP",
      proposedTerms: "Original terms.",
      restrictions: "Original restrictions.",
    });

    await approvePackageAndCreateSubmission({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      packageId,
    });

    // The service role bypasses row level security, so what refuses these is
    // the database itself rather than a policy.
    const service = serviceClient();

    for (const patch of [
      { buyer_id: "a0000000-0000-0000-0000-0000000000b2" },
      { proposed_terms: "Rewritten terms." },
      { restrictions: "Rewritten restrictions." },
      { exclusivity: "worldwide exclusive" },
      { delivery_method: "Email" },
      { embargo_until: new Date().toISOString() },
    ]) {
      const { error } = await service.from("packages").update(patch).eq("id", packageId);
      expect(error, `changing ${Object.keys(patch)[0]} should be refused`).toBeTruthy();
    }

    // ...and its membership, which the manifest depends on.
    const removal = await service
      .from("package_assets")
      .delete()
      .eq("package_id", packageId)
      .eq("asset_id", assetIds[0]);
    expect(removal.error).toBeTruthy();
  });

  it("refuses to approve the same package twice", async () => {
    const dispatcher = await clientFor("dispatcher");
    const editor = await clientFor("editor");
    const { shootId } = await readyShoot("TWICE", 1);

    const { id: packageId } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: "22222222-2222-2222-2222-222222222222",
      shootId,
      buyerId: BACKGRID,
      name: "Twice",
      deliveryMethod: "SFTP",
      proposedTerms: "Terms.",
    });

    await approvePackageAndCreateSubmission({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      packageId,
    });

    await expect(
      approvePackageAndCreateSubmission({
        client: dispatcher,
        organizationId: ORG_A,
        actorId: DISPATCHER,
        packageId,
      }),
    ).rejects.toThrow(/already been approved/i);
  });

  it.each([
    ["buyer", { buyerId: null }, /Set a buyer/i],
    ["delivery method", { deliveryMethod: undefined }, /delivery method/i],
    ["terms", { proposedTerms: undefined }, /proposed terms/i],
  ])("refuses to approve without a %s", async (_label, overrides, expected) => {
    const dispatcher = await clientFor("dispatcher");
    const editor = await clientFor("editor");
    const { shootId } = await readyShoot(`MISSING${Math.round(performance.now())}`, 1);

    const { id: packageId } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: "22222222-2222-2222-2222-222222222222",
      shootId,
      buyerId: BACKGRID,
      name: "Incomplete",
      deliveryMethod: "SFTP",
      proposedTerms: "Terms.",
      ...overrides,
    });

    await expect(
      approvePackageAndCreateSubmission({
        client: dispatcher,
        organizationId: ORG_A,
        actorId: DISPATCHER,
        packageId,
      }),
    ).rejects.toThrow(expected);
  });

  it("does not let an editor approve", async () => {
    const editor = await clientFor("editor");
    const { shootId } = await readyShoot("EDITORSEND", 1);

    const { id: packageId } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: "22222222-2222-2222-2222-222222222222",
      shootId,
      buyerId: BACKGRID,
      name: "Editor send",
      deliveryMethod: "SFTP",
      proposedTerms: "Terms.",
    });

    await expect(
      approvePackageAndCreateSubmission({
        client: editor,
        organizationId: ORG_A,
        actorId: "22222222-2222-2222-2222-222222222222",
        packageId,
      }),
    ).rejects.toThrow();
  });
});

describeIf("recording a sale and its payment", () => {
  it("takes 30% only on a licence Mastline generated", async () => {
    const finance = await clientFor("finance");

    const mastline = await recordLicense({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      licenseeName: `Mastline sale ${Date.now()}`,
      origin: "mastline_sales_engine",
      saleBase: money(64_000),
      assetIds: [],
    });
    licenses.push(mastline.id);
    expect(mastline.salesEngineShare.minor).toBe(19_200);
    expect(mastline.photographerShare.minor).toBe(44_800);

    const external = await recordLicense({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      licenseeName: `Agency sale ${Date.now()}`,
      origin: "external",
      saleBase: money(64_000),
      assetIds: [],
    });
    licenses.push(external.id);
    expect(external.salesEngineShare.minor).toBe(0);
    expect(external.photographerShare.minor).toBe(64_000);
  });

  it("rounds a half minor unit toward Mastline and keeps the base whole", async () => {
    const finance = await clientFor("finance");
    const { id, salesEngineShare, photographerShare } = await recordLicense({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      licenseeName: `Rounding ${Date.now()}`,
      origin: "mastline_sales_engine",
      saleBase: money(5),
      assetIds: [],
    });
    licenses.push(id);
    expect(salesEngineShare.minor).toBe(2);
    expect(photographerShare.minor).toBe(3);
  });

  it("refuses to allocate more than the net that arrived", async () => {
    const finance = await clientFor("finance");
    const { id } = await recordPayment({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      status: "received",
      source: "statement",
      reference: `OVER-${Date.now()}`,
      gross: money(100_000),
      deductions: money(40_000),
      net: money(60_000),
      receivedAt: new Date().toISOString(),
    });
    payments.push(id);

    await allocatePayment({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      paymentId: id,
      licenseId: licenses[0],
      amount: money(50_000),
    });

    await expect(
      allocatePayment({
        client: finance,
        organizationId: ORG_A,
        actorId: FINANCE,
        paymentId: id,
        licenseId: licenses[0],
        amount: money(20_000),
      }),
    ).rejects.toThrow(/exceed the net/i);
  });

  it("refuses allocations that exceed net at creation time too", async () => {
    const finance = await clientFor("finance");
    await expect(
      recordPayment({
        client: finance,
        organizationId: ORG_A,
        actorId: FINANCE,
        status: "received",
        source: "manual",
        reference: `BADALLOC-${Date.now()}`,
        gross: money(10_000),
        net: money(10_000),
        allocations: [{ licenseId: licenses[0], amount: money(20_000) }],
      }),
    ).rejects.toThrow(/cannot exceed the net/i);
  });

  it("does not let an editor record money", async () => {
    const editor = await clientFor("editor");
    await expect(
      recordPayment({
        client: editor,
        organizationId: ORG_A,
        actorId: "22222222-2222-2222-2222-222222222222",
        status: "received",
        source: "manual",
        reference: `EDITORMONEY-${Date.now()}`,
        gross: money(1000),
        net: money(1000),
      }),
    ).rejects.toThrow();
  });
});

describeIf("recording an outcome", () => {
  it("changes the status without touching what was sent", async () => {
    const dispatcher = await clientFor("dispatcher");
    const editor = await clientFor("editor");
    const { shootId } = await readyShoot("OUTCOME", 1);

    const { id: packageId } = await createPackageFromSelection({
      client: editor,
      organizationId: ORG_A,
      actorId: "22222222-2222-2222-2222-222222222222",
      shootId,
      buyerId: BACKGRID,
      name: "Outcome package",
      deliveryMethod: "SFTP",
      proposedTerms: "Original terms.",
    });

    const { submissionId } = await approvePackageAndCreateSubmission({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      packageId,
    });

    await recordSubmissionOutcome({
      client: dispatcher,
      organizationId: ORG_A,
      actorId: DISPATCHER,
      submissionId,
      status: "sold",
      outcomeNote: "Sold to two outlets.",
    });

    const { data } = await serviceClient()
      .from("submissions")
      .select("status, outcome_note, terms_snapshot")
      .eq("id", submissionId)
      .single();

    expect(data!.status).toBe("sold");
    expect(data!.outcome_note).toBe("Sold to two outlets.");
    expect(data!.terms_snapshot).toBe("Original terms.");
  });
});
