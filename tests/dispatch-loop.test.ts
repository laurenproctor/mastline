/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { ORG_A, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The commercial loop, exercised against the database: package, approve,
 * submission, sale, payment, allocation, and the connected history that ties
 * them together.
 *
 * These replace the fixture-consistency tests that covered the mock layer.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const BACKGRID = "a0000000-0000-0000-0000-0000000000b1";
const created: { shoots: string[]; payments: string[]; licenses: string[] } = {
  shoots: [],
  payments: [],
  licenses: [],
};

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A shoot with one fully described, selected asset ready to package. */
async function readyShoot(label: string) {
  const service = serviceClient();
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
  created.shoots.push(shootId);

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
      version_kind: "original",
      storage_bucket: "originals",
      object_key: `${ORG_A}/${shootId}/${label}.arw`,
      sha256: await digest(`${label}-${Date.now()}`),
      bytes: 1000,
      mime_type: "image/x-sony-arw",
      created_by: OWNER,
    })
    .select("id")
    .single();

  return { shootId, assetId, versionId: version!.id as string };
}

async function buildPackage(
  shootId: string,
  assetId: string,
  versionId: string,
  overrides: Record<string, unknown> = {},
) {
  const service = serviceClient();
  const { data: pkg } = await service
    .from("packages")
    .insert({
      organization_id: ORG_A,
      shoot_id: shootId,
      buyer_id: BACKGRID,
      name: "Test package",
      status: "needs_review",
      delivery_method: "SFTP",
      proposed_terms: "Non-exclusive agency distribution.",
      restrictions: "Editorial use only.",
      created_by: OWNER,
      ...overrides,
    })
    .select("id")
    .single();
  const packageId = pkg!.id as string;

  await service.from("package_assets").insert({
    package_id: packageId,
    organization_id: ORG_A,
    asset_id: assetId,
    asset_version_id: versionId,
    position: 0,
  });

  return packageId;
}

afterAll(async () => {
  const service = serviceClient();
  for (const id of created.payments) await service.from("payments").delete().eq("id", id);
  for (const id of created.licenses) await service.from("licenses").delete().eq("id", id);
  for (const shootId of created.shoots) await purgeShoot(shootId);
});

describeIf("a sent submission freezes what was sent", () => {
  it("records the manifest, terms, and restrictions at the moment of dispatch", async () => {
    const { shootId, assetId, versionId } = await readyShoot("FREEZE");
    const packageId = await buildPackage(shootId, assetId, versionId);
    const service = serviceClient();

    const sentAt = new Date().toISOString();
    await service
      .from("packages")
      .update({ status: "delivered", approved_by: OWNER, approved_at: sentAt })
      .eq("id", packageId);

    const { data: submission, error } = await service
      .from("submissions")
      .insert({
        organization_id: ORG_A,
        package_id: packageId,
        buyer_id: BACKGRID,
        status: "sent",
        terms_snapshot: "Non-exclusive agency distribution.",
        restrictions_snapshot: "Editorial use only.",
        delivery_manifest: {
          assets: [{ assetId, assetVersionId: versionId, position: 0 }],
          asset_count: 1,
        },
        delivery_method: "SFTP",
        external_reference: `BG-TEST-${Date.now()}`,
        sent_at: sentAt,
        created_by: OWNER,
      })
      .select("id, delivery_manifest")
      .single();

    expect(error).toBeNull();
    const manifest = (submission!.delivery_manifest as { assets: { assetVersionId: string }[] })
      .assets;
    expect(manifest[0].assetVersionId).toBe(versionId);

    // Changing what was sent is refused.
    const rewrite = await service
      .from("submissions")
      .update({ delivery_manifest: { assets: [] } })
      .eq("id", submission!.id);
    expect(rewrite.error).not.toBeNull();

    const terms = await service
      .from("submissions")
      .update({ terms_snapshot: "Different terms" })
      .eq("id", submission!.id);
    expect(terms.error).not.toBeNull();
  });

  it("keeps the frozen version even after a new derivative is added", async () => {
    const { shootId, assetId, versionId } = await readyShoot("VERSIONDRIFT");
    const packageId = await buildPackage(shootId, assetId, versionId);
    const service = serviceClient();

    const sentAt = new Date().toISOString();
    await service
      .from("packages")
      .update({ status: "delivered", approved_by: OWNER, approved_at: sentAt })
      .eq("id", packageId);
    const { data: submission } = await service
      .from("submissions")
      .insert({
        organization_id: ORG_A,
        package_id: packageId,
        status: "sent",
        delivery_manifest: { assets: [{ assetId, assetVersionId: versionId, position: 0 }] },
        external_reference: `BG-DRIFT-${Date.now()}`,
        sent_at: sentAt,
        created_by: OWNER,
      })
      .select("id")
      .single();

    // A new delivery derivative appears afterwards.
    await service.from("asset_versions").insert({
      organization_id: ORG_A,
      asset_id: assetId,
      version_kind: "delivery",
      storage_bucket: "derivatives",
      object_key: `${ORG_A}/derivatives/${assetId}/later.jpg`,
      sha256: await digest(`later-${Date.now()}`),
      bytes: 500,
      mime_type: "image/jpeg",
      created_by: OWNER,
    });

    const { data: after } = await service
      .from("submissions")
      .select("delivery_manifest")
      .eq("id", submission!.id)
      .single();
    const manifest = (after!.delivery_manifest as { assets: { assetVersionId: string }[] }).assets;
    expect(manifest[0].assetVersionId).toBe(versionId);
  });
});

describeIf("a sale links after the fact", () => {
  it("attaches a licence to a submission without touching what was sent", async () => {
    const { shootId, assetId, versionId } = await readyShoot("SALE");
    const packageId = await buildPackage(shootId, assetId, versionId);
    const service = serviceClient();

    const sentAt = new Date().toISOString();
    await service
      .from("packages")
      .update({ status: "delivered", approved_by: OWNER, approved_at: sentAt })
      .eq("id", packageId);
    const { data: submission } = await service
      .from("submissions")
      .insert({
        organization_id: ORG_A,
        package_id: packageId,
        buyer_id: BACKGRID,
        status: "sent",
        terms_snapshot: "Non-exclusive agency distribution.",
        delivery_manifest: { assets: [{ assetId, assetVersionId: versionId, position: 0 }] },
        external_reference: `BG-SALE-${Date.now()}`,
        sent_at: sentAt,
        created_by: OWNER,
      })
      .select("id, terms_snapshot")
      .single();
    const submissionId = submission!.id as string;

    // The sale arrives later.
    const { data: license, error } = await service
      .from("licenses")
      .insert({
        organization_id: ORG_A,
        submission_id: submissionId,
        buyer_id: BACKGRID,
        status: "active",
        licensee_name: "Backgrid syndication",
        origin: "external",
        sale_base_minor: 62_000,
        sales_engine_share_minor: 0,
        photographer_share_minor: 62_000,
        created_by: OWNER,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    created.licenses.push(license!.id as string);

    await service.from("license_assets").insert({
      license_id: license!.id,
      organization_id: ORG_A,
      asset_id: assetId,
    });

    // The outcome is recordable; the snapshot is untouched.
    const outcome = await service
      .from("submissions")
      .update({ status: "sold", outcome_note: "Sold through the agency." })
      .eq("id", submissionId);
    expect(outcome.error).toBeNull();

    const { data: after } = await service
      .from("submissions")
      .select("status, terms_snapshot")
      .eq("id", submissionId)
      .single();
    expect(after!.status).toBe("sold");
    expect(after!.terms_snapshot).toBe(submission!.terms_snapshot);
  });
});

describeIf("payments reconcile through allocations", () => {
  it("splits one payment across two licences", async () => {
    const service = serviceClient();

    const makeLicense = async (name: string, base: number) => {
      const { data } = await service
        .from("licenses")
        .insert({
          organization_id: ORG_A,
          status: "active",
          licensee_name: name,
          origin: "external",
          sale_base_minor: base,
          sales_engine_share_minor: 0,
          photographer_share_minor: base,
          created_by: OWNER,
        })
        .select("id")
        .single();
      created.licenses.push(data!.id as string);
      return data!.id as string;
    };

    const first = await makeLicense(`Multi A ${Date.now()}`, 40_000);
    const second = await makeLicense(`Multi B ${Date.now()}`, 30_000);

    const { data: payment } = await service
      .from("payments")
      .insert({
        organization_id: ORG_A,
        buyer_id: BACKGRID,
        status: "received",
        source: "statement",
        external_reference: `MULTI-${Date.now()}`,
        gross_minor: 100_000,
        deductions_minor: 30_000,
        net_minor: 70_000,
        received_at: new Date().toISOString(),
        created_by: OWNER,
      })
      .select("id")
      .single();
    const paymentId = payment!.id as string;
    created.payments.push(paymentId);

    const { error } = await service.from("payment_allocations").insert([
      {
        organization_id: ORG_A,
        payment_id: paymentId,
        license_id: first,
        allocated_minor: 40_000,
        created_by: OWNER,
      },
      {
        organization_id: ORG_A,
        payment_id: paymentId,
        license_id: second,
        allocated_minor: 30_000,
        created_by: OWNER,
      },
    ]);
    expect(error).toBeNull();

    const { data: allocations } = await service
      .from("payment_allocations")
      .select("allocated_minor")
      .eq("payment_id", paymentId);
    const total = (allocations ?? []).reduce((sum, row) => sum + Number(row.allocated_minor), 0);
    // Allocations divide the NET that arrived, not the gross.
    expect(total).toBe(70_000);
  });

  it("supports a partial allocation leaving a remainder", async () => {
    const service = serviceClient();
    const { data: payment } = await service
      .from("payments")
      .insert({
        organization_id: ORG_A,
        status: "received",
        source: "statement",
        external_reference: `PARTIAL-${Date.now()}`,
        gross_minor: 50_000,
        net_minor: 50_000,
        received_at: new Date().toISOString(),
        created_by: OWNER,
      })
      .select("id")
      .single();
    created.payments.push(payment!.id as string);

    await service.from("payment_allocations").insert({
      organization_id: ORG_A,
      payment_id: payment!.id,
      asset_id: null,
      submission_id: null,
      license_id: created.licenses[0] ?? null,
      allocated_minor: 20_000,
      created_by: OWNER,
    });

    const { data: allocations } = await service
      .from("payment_allocations")
      .select("allocated_minor")
      .eq("payment_id", payment!.id);
    const allocated = (allocations ?? []).reduce(
      (sum, row) => sum + Number(row.allocated_minor),
      0,
    );
    expect(allocated).toBe(20_000);
    expect(50_000 - allocated).toBe(30_000);
  });

  it("keeps gross, deductions, platform fee, tax, and net separately inspectable", async () => {
    const service = serviceClient();
    const reference = `BREAKDOWN-${Date.now()}`;
    const { data: payment } = await service
      .from("payments")
      .insert({
        organization_id: ORG_A,
        status: "received",
        source: "checkout",
        external_reference: reference,
        gross_minor: 64_000,
        deductions_minor: 0,
        platform_fee_minor: 19_200,
        tax_minor: 0,
        net_minor: 44_800,
        received_at: new Date().toISOString(),
        created_by: OWNER,
      })
      .select("id, gross_minor, deductions_minor, platform_fee_minor, tax_minor, net_minor")
      .single();
    created.payments.push(payment!.id as string);

    expect(Number(payment!.gross_minor)).toBe(64_000);
    expect(Number(payment!.platform_fee_minor)).toBe(19_200);
    expect(Number(payment!.net_minor)).toBe(44_800);
    // The breakdown reconstitutes the gross.
    expect(
      Number(payment!.deductions_minor) +
        Number(payment!.platform_fee_minor) +
        Number(payment!.tax_minor) +
        Number(payment!.net_minor),
    ).toBe(Number(payment!.gross_minor));
  });
});

describeIf("earnings derive from allocations", () => {
  it("reports what an asset earned without a stored counter", async () => {
    const { shootId, assetId } = await readyShoot("EARN");
    void shootId;
    const service = serviceClient();

    const before = await service
      .from("asset_lifetime_earnings")
      .select("lifetime_earnings_minor")
      .eq("asset_id", assetId)
      .single();
    expect(Number(before.data!.lifetime_earnings_minor)).toBe(0);

    const { data: payment } = await service
      .from("payments")
      .insert({
        organization_id: ORG_A,
        status: "received",
        source: "statement",
        external_reference: `EARN-${Date.now()}`,
        gross_minor: 30_000,
        net_minor: 30_000,
        received_at: new Date().toISOString(),
        created_by: OWNER,
      })
      .select("id")
      .single();
    created.payments.push(payment!.id as string);

    await service.from("payment_allocations").insert({
      organization_id: ORG_A,
      payment_id: payment!.id,
      asset_id: assetId,
      allocated_minor: 30_000,
      created_by: OWNER,
    });

    const after = await service
      .from("asset_lifetime_earnings")
      .select("lifetime_earnings_minor")
      .eq("asset_id", assetId)
      .single();
    expect(Number(after.data!.lifetime_earnings_minor)).toBe(30_000);
  });
});
