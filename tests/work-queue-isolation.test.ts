/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPackageFromSelection } from "../src/lib/data/packages";
import { approvePackageAndCreateSubmission } from "../src/lib/data/submissions";
import { createDelivery } from "../src/lib/data/delivery-links";
import { getWorkQueue, getWorkQueueDashboard } from "../src/lib/data/work-queue";
import { workspaceRoutes } from "../src/lib/workspace-routes";
import {
  ORG_A,
  ORG_B,
  ORG_B_ORIGINAL_KEY,
  ORG_B_PAYMENT,
  ORG_B_SHOOT,
  anonClient,
  clientFor,
  hasLocalSupabase,
  purgeShoot,
  serviceClient,
} from "./helpers/supabase";

/**
 * The dashboard against a real database, with row level security in force.
 *
 * Two properties matter here beyond what the pure ranking tests already pin:
 * a dashboard built for one workspace must contain nothing of another's, and
 * the delivery evidence it renders must never carry the recipient's token.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const EDITOR = "22222222-2222-2222-2222-222222222222";
const DISPATCHER = "33333333-3333-3333-3333-333333333333";
const BACKGRID = "a0000000-0000-0000-0000-0000000000b1";

const shoots: string[] = [];

afterAll(async () => {
  for (const shootId of shoots) await purgeShoot(shootId);
});

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A queued submission with a live delivery link and one recorded open. */
async function linkedSubmission(label: string) {
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

  const { data: asset } = await service
    .from("assets")
    .insert({
      organization_id: ORG_A,
      shoot_id: shootId,
      status: "active",
      canonical_filename: `ML_${label}_0`,
      captured_at: new Date(Date.now() - 1_800_000).toISOString(),
      headline: `${label} frame`,
      caption: `A caption for the ${label} frame, long enough to pass the gate.`,
      credit_line: "Mastline test",
      copyright_notice: "© 2026 Mastline test",
      selected: true,
      created_by: OWNER,
    })
    .select("id")
    .single();

  await service.from("asset_versions").insert({
    organization_id: ORG_A,
    asset_id: asset!.id as string,
    version_kind: "original",
    storage_bucket: "originals",
    object_key: `${ORG_A}/${shootId}/${label}.arw`,
    sha256: await digest(`${label}-${shootId}`),
    bytes: 1000,
    mime_type: "image/x-sony-arw",
    created_by: OWNER,
  });

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

  await createDelivery({
    client: dispatcher,
    organizationId: ORG_A,
    actorId: DISPATCHER,
    submissionId,
    recipientLabel: "Isolation desk",
    windowDays: 7,
  });

  const { data: link } = await service
    .from("submission_deliveries")
    .select("id, token")
    .eq("submission_id", submissionId)
    .single();

  // The open is recorded the way a recipient records it: by opening the link.
  // Access events are written only by the delivery functions; nothing else,
  // the service role included, may insert one.
  const opened = await anonClient().rpc("open_delivery", { delivery_token: link!.token });
  if (opened.error) throw new Error(`Could not open the delivery: ${opened.error.message}`);

  return { shootId, submissionId, token: link!.token as string };
}

describeIf("the dashboard and workspace boundaries", () => {
  it("contains nothing of another workspace, and never a delivery token", async () => {
    const { shootId, submissionId, token } = await linkedSubmission("WQISO");

    const owner = await clientFor("owner");
    const routes = workspaceRoutes("marcus-hale-studio");
    const dashboard = await getWorkQueueDashboard(ORG_A, routes, owner);

    const rendered = JSON.stringify(dashboard);

    // The recorded open is on the board, named for the link's recipient.
    const open = dashboard.recipientActivity.find((row) => row.submissionId === submissionId);
    expect(open).toBeDefined();
    expect(open?.recipient).toBe("Isolation desk");
    expect(open?.description).toContain("opened");
    expect(open?.href).toBe(`/marcus-hale-studio/submissions/${submissionId}`);

    // The token is the recipient's credential. It must not exist anywhere in
    // what the page receives -- not in the activity, not in a link, not in
    // the queue the current page reads either.
    expect(rendered).not.toContain(token);
    expect(JSON.stringify(await getWorkQueue(ORG_A, routes, owner))).not.toContain(token);

    // A linked submission is not asked for a link; the active shoot says so.
    expect(dashboard.queue.find((item) => item.id === `wq_nolink_${submissionId}`)).toBeUndefined();
    const active = dashboard.activeShoots.find((shoot) => shoot.id === shootId);
    expect(active).toBeDefined();
    expect(active?.linkLabel).toBe("Recipient link created");
    expect(active?.totalAssets).toBe(1);
    expect(active?.selectedCount).toBe(1);

    // Nothing of Org B: not its ids, its shoot, its payment, or its files.
    for (const foreign of [ORG_B, ORG_B_SHOOT, ORG_B_PAYMENT, ORG_B_ORIGINAL_KEY, "Northline"]) {
      expect(rendered).not.toContain(foreign);
    }

    // The header figures come from the same records the Money screen reads.
    expect(dashboard.pulse.netReceived.currency).toBe("USD");
    expect(dashboard.pulse.overdueCount).toBeGreaterThanOrEqual(0);
  });

  it("signs derivative previews only when asked, and never an original", async () => {
    const owner = await clientFor("owner");
    const routes = workspaceRoutes("marcus-hale-studio");

    const plain = await getWorkQueueDashboard(ORG_A, routes, owner);
    for (const shoot of plain.activeShoots) expect(shoot.previewUrls).toEqual([]);

    const withPreviews = await getWorkQueueDashboard(ORG_A, routes, owner, {
      previewsPerShoot: 4,
    });
    for (const shoot of withPreviews.activeShoots) {
      expect(shoot.previewUrls.length).toBeLessThanOrEqual(4);
      for (const url of shoot.previewUrls) {
        expect(url).not.toContain("/originals/");
        expect(url).toContain("/derivatives/");
      }
    }
    expect(JSON.stringify(withPreviews)).not.toMatch(/\.arw/i);
  });

  it("built for the other workspace, shows none of this one", async () => {
    const other = await clientFor("otherOrgOwner");
    const dashboard = await getWorkQueueDashboard(ORG_B, workspaceRoutes("northline-desk"), other);

    const rendered = JSON.stringify(dashboard);
    for (const local of ["Hotel Chelsea", "Isolation desk", ORG_A, "BG-0819-441"]) {
      expect(rendered).not.toContain(local);
    }
    for (const item of dashboard.queue) {
      expect(item.href.startsWith("/northline-desk/"), item.id).toBe(true);
    }
  });
});
