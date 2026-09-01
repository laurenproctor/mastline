import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ORG_A,
  ORG_A_ASSET,
  ORG_A_PACKAGE_DELIVERED,
  ORG_A_SHOOT,
  ORG_B_ASSET,
  ORG_B_SHOOT,
  clientFor,
  hasLocalSupabase,
  serviceClient,
} from "./helpers/supabase";

/*
 * What connects a buyer request to the work that answered it.
 *
 * Two claims are worth separating, because they are enforced by different
 * things and only one of them survives a trusted server path:
 *
 *   Row level security stops a signed-in user reaching another workspace.
 *   A COMPOSITE FOREIGN KEY stops ANYBODY writing the link at all -- including
 *   service_role, which bypasses RLS by design and is what the webhook, the
 *   invitation path and every background job run as.
 *
 * The service-role cases below are the ones that matter. A policy can be
 * written wrongly; a foreign key cannot be talked round.
 */

const describeIfLocal = hasLocalSupabase() ? describe : describe.skip;

describeIfLocal("request relationships", () => {
  const created: string[] = [];
  const service = () => serviceClient();

  /** A fresh draft request, arranged out of band. */
  async function makeRequest(suffix: string): Promise<string> {
    const { data: member } = await service()
      .from("memberships")
      .select("user_id")
      .eq("organization_id", ORG_A)
      .eq("role", "owner")
      .limit(1)
      .single();

    const { data, error } = await service()
      .from("buyer_requests")
      .insert({
        organization_id: ORG_A,
        created_by: member!.user_id,
        idempotency_key: `rel-test-${suffix}-${Date.now()}`,
        reference: `REQ-REL-${suffix.toUpperCase()}`,
        title: "Departure from last night",
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not arrange a request: ${error.message}`);
    created.push(data!.id);
    return data!.id;
  }

  async function ownerId(): Promise<string> {
    const { data } = await service()
      .from("memberships")
      .select("user_id")
      .eq("organization_id", ORG_A)
      .eq("role", "owner")
      .limit(1)
      .single();
    return data!.user_id;
  }

  beforeAll(() => {
    if (!hasLocalSupabase()) return;
  });

  afterAll(async () => {
    for (const id of created) {
      await service().from("buyer_requests").delete().eq("id", id);
    }
  });

  describe("cross-workspace denial", () => {
    it("refuses another workspace's shoot even for service_role", async () => {
      const request = await makeRequest("xshoot");
      const { error } = await service()
        .from("request_shoots")
        .insert({
          organization_id: ORG_A,
          request_id: request,
          shoot_id: ORG_B_SHOOT,
          linked_by: await ownerId(),
        });

      // 23503 is foreign_key_violation. Not a policy refusal -- there is no
      // policy in play here at all.
      expect(error).not.toBeNull();
      expect(error!.code).toBe("23503");
    });

    it("refuses another workspace's asset even for service_role", async () => {
      const request = await makeRequest("xasset");
      const { error } = await service()
        .from("request_assets")
        .insert({
          organization_id: ORG_A,
          request_id: request,
          asset_id: ORG_B_ASSET,
          matched_by: await ownerId(),
        });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("23503");
    });

    it("refuses a link that claims the other workspace's id", async () => {
      const request = await makeRequest("xclaim");
      const { error } = await service()
        .from("request_shoots")
        .insert({
          organization_id: "bbbbbbbb-0000-0000-0000-000000000002",
          request_id: request,
          shoot_id: ORG_B_SHOOT,
          linked_by: await ownerId(),
        });

      // Relabelling the row does not help: the request end fails instead.
      expect(error).not.toBeNull();
      expect(error!.code).toBe("23503");
    });

    it("does not let another workspace's owner read the links", async () => {
      const request = await makeRequest("xread");
      await service()
        .from("request_shoots")
        .insert({
          organization_id: ORG_A,
          request_id: request,
          shoot_id: ORG_A_SHOOT,
          linked_by: await ownerId(),
        });

      const nadia = await clientFor("otherOrgOwner");
      const { data } = await nadia.from("request_shoots").select("id").eq("request_id", request);
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe("idempotency", () => {
    it("links the same shoot three times and keeps one row", async () => {
      const request = await makeRequest("idem");
      const row = {
        organization_id: ORG_A,
        request_id: request,
        shoot_id: ORG_A_SHOOT,
        linked_by: await ownerId(),
      };

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await service().from("request_shoots").upsert(row, { onConflict: "request_id,shoot_id" });
      }

      const { data } = await service()
        .from("request_shoots")
        .select("id")
        .eq("request_id", request);
      expect(data).toHaveLength(1);
    });

    it("survives three concurrent links of the same pair", async () => {
      const request = await makeRequest("race");
      const row = {
        organization_id: ORG_A,
        request_id: request,
        shoot_id: ORG_A_SHOOT,
        linked_by: await ownerId(),
      };

      await Promise.all(
        Array.from({ length: 3 }, () =>
          service().from("request_shoots").upsert(row, { onConflict: "request_id,shoot_id" }),
        ),
      );

      const { data } = await service()
        .from("request_shoots")
        .select("id")
        .eq("request_id", request);
      expect(data).toHaveLength(1);
    });
  });

  describe("matching provenance", () => {
    it("refuses a system match in this phase", async () => {
      const request = await makeRequest("sysmatch");
      const { error } = await service()
        .from("request_assets")
        .insert({
          organization_id: ORG_A,
          request_id: request,
          asset_id: ORG_A_ASSET,
          matched_by: await ownerId(),
          match_origin: "system",
        });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("23514"); // check_violation
    });

    it("refuses a human match with no actor", async () => {
      const request = await makeRequest("noactor");
      const { error } = await service().from("request_assets").insert({
        organization_id: ORG_A,
        request_id: request,
        asset_id: ORG_A_ASSET,
        matched_by: null,
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("23514");
    });

    it("refuses a selection with no decider", async () => {
      const request = await makeRequest("nodecider");
      const { error } = await service()
        .from("request_assets")
        .insert({
          organization_id: ORG_A,
          request_id: request,
          asset_id: ORG_A_ASSET,
          matched_by: await ownerId(),
          state: "selected",
        });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("23514");
    });

    it("leaves the asset alone when a match is removed", async () => {
      const request = await makeRequest("unmatch");
      await service()
        .from("request_assets")
        .insert({
          organization_id: ORG_A,
          request_id: request,
          asset_id: ORG_A_ASSET,
          matched_by: await ownerId(),
        });
      await service()
        .from("request_assets")
        .delete()
        .eq("request_id", request)
        .eq("asset_id", ORG_A_ASSET);

      const { data } = await service().from("assets").select("id").eq("id", ORG_A_ASSET).single();
      expect(data!.id).toBe(ORG_A_ASSET);
    });
  });

  describe("status follows evidence", () => {
    it("refuses coverage_planned until a shoot is linked, then allows it", async () => {
      const request = await makeRequest("coverage");

      const refused = await service()
        .from("buyer_requests")
        .update({ status: "coverage_planned" })
        .eq("id", request);
      expect(refused.error).not.toBeNull();

      await service()
        .from("request_shoots")
        .insert({
          organization_id: ORG_A,
          request_id: request,
          shoot_id: ORG_A_SHOOT,
          linked_by: await ownerId(),
        });

      const allowed = await service()
        .from("buyer_requests")
        .update({ status: "coverage_planned" })
        .eq("id", request);
      expect(allowed.error).toBeNull();
    });

    it("refuses preparing_response until a package is linked", async () => {
      const request = await makeRequest("preparing");

      const refused = await service()
        .from("buyer_requests")
        .update({ status: "preparing_response" })
        .eq("id", request);
      expect(refused.error).not.toBeNull();

      await service()
        .from("request_packages")
        .insert({
          organization_id: ORG_A,
          request_id: request,
          package_id: ORG_A_PACKAGE_DELIVERED,
          linked_by: await ownerId(),
        });

      const allowed = await service()
        .from("buyer_requests")
        .update({ status: "preparing_response" })
        .eq("id", request);
      expect(allowed.error).toBeNull();
    });

    it("refuses won with no connected licence", async () => {
      const request = await makeRequest("nowin");
      const { error } = await service()
        .from("buyer_requests")
        .update({ status: "won" })
        .eq("id", request);

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/licen[cs]e|sale/i);
    });
  });

  describe("who may write a link", () => {
    it("lets a dispatcher link, and refuses a viewer", async () => {
      const request = await makeRequest("roles");

      const dispatcher = await clientFor("dispatcher");
      const allowed = await dispatcher.from("request_shoots").insert({
        organization_id: ORG_A,
        request_id: request,
        shoot_id: ORG_A_SHOOT,
        linked_by: await ownerId(),
      });
      expect(allowed.error).toBeNull();

      const viewer = await clientFor("viewer");
      const refused = await viewer.from("request_assets").insert({
        organization_id: ORG_A,
        request_id: request,
        asset_id: ORG_A_ASSET,
        matched_by: await ownerId(),
      });
      expect(refused.error).not.toBeNull();
    });
  });
});
