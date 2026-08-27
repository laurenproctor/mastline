/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { ORG_A, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * The database's half of "a drafted caption is not a caption yet".
 *
 * The dispatch gate in src/lib/metadata-rules.ts refuses an unread draft, and
 * that is tested pure. This file tests the fact the gate depends on: that
 * caption_awaits_review is generated from provenance and cannot be set to
 * something the provenance does not support. If a row could claim to be
 * reviewed while carrying no reviewer, every guarantee above it is decorative.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const created: string[] = [];

async function makeShoot(title: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("shoots")
    .insert({ organization_id: ORG_A, title, status: "draft", created_by: OWNER })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  created.push(data!.id as string);
  return data!.id as string;
}

async function makeAsset(shootId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await serviceClient()
    .from("assets")
    .insert({
      organization_id: ORG_A,
      shoot_id: shootId,
      canonical_filename: `CR_${created.length}_${fields.canonical_filename ?? "0001"}`,
      status: "active",
      created_by: OWNER,
      ...fields,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}

afterAll(async () => {
  for (const shootId of created) await purgeShoot(shootId);
});

describeIf("a caption the model wrote", () => {
  it("awaits review from the moment it is written", async () => {
    const shootId = await makeShoot(`Caption review ${Date.now()}`);
    const assetId = await makeAsset(shootId, {
      caption: "A man in a dark coat leaves a hotel side entrance at night.",
      caption_origin: "model",
      caption_drafted_at: new Date().toISOString(),
      caption_basis: "Read from the image.",
      caption_confidence: 0.7,
      caption_model: "claude-haiku-4-5",
    });

    const { data } = await serviceClient()
      .from("assets")
      .select("caption, caption_awaits_review, caption_confidence")
      .eq("id", assetId)
      .single();

    expect(data?.caption_awaits_review).toBe(true);
    // The caption is real from the start. That is the point of writing it at
    // import rather than parking it in a drafts table.
    expect(data?.caption).toContain("dark coat");
    expect(Number(data?.caption_confidence)).toBeCloseTo(0.7);
  });

  it("stops awaiting review once a person is recorded against it", async () => {
    const shootId = await makeShoot(`Caption reviewed ${Date.now()}`);
    const assetId = await makeAsset(shootId, {
      caption: "Drafted.",
      caption_origin: "model",
    });

    await serviceClient()
      .from("assets")
      .update({
        caption: "Corrected by the photographer.",
        caption_origin: "human",
        caption_reviewed_at: new Date().toISOString(),
        caption_reviewed_by: OWNER,
      })
      .eq("id", assetId);

    const { data } = await serviceClient()
      .from("assets")
      .select("caption_awaits_review")
      .eq("id", assetId)
      .single();

    expect(data?.caption_awaits_review).toBe(false);
  });

  it("cannot be marked reviewed by nobody", async () => {
    const shootId = await makeShoot(`Caption unattributed ${Date.now()}`);
    const assetId = await makeAsset(shootId, { caption: "Drafted.", caption_origin: "model" });

    // A review time with no reviewer is the shape this would take if someone
    // tried to clear the flag without a person behind it.
    const { error } = await serviceClient()
      .from("assets")
      .update({ caption_reviewed_at: new Date().toISOString() })
      .eq("id", assetId);

    expect(error?.message ?? "").toMatch(/assets_caption_review_is_attributable/);
  });

  it("is not what a caption typed by hand looks like", async () => {
    const shootId = await makeShoot(`Caption typed ${Date.now()}`);
    const assetId = await makeAsset(shootId, { caption: "Typed at the kerbside." });

    const { data } = await serviceClient()
      .from("assets")
      .select("caption_origin, caption_awaits_review")
      .eq("id", assetId)
      .single();

    // The default, and therefore what every caption in the archive already is.
    expect(data?.caption_origin).toBe("human");
    expect(data?.caption_awaits_review).toBe(false);
  });
});

describeIf("the workspace switch", () => {
  it("is on unless a workspace turns it off", async () => {
    const { data } = await serviceClient()
      .from("organizations")
      .select("auto_caption_on_import")
      .eq("id", ORG_A)
      .single();

    expect(data?.auto_caption_on_import).toBe(true);
  });
});
