/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { connectLicense, getRequest } from "@/lib/data/requests";
import { RequestError } from "@/lib/requests";
import {
  ORG_A,
  ORG_A_LICENSE_MASTLINE,
  ORG_A_SUBMISSION,
  ORG_B,
  clientFor,
  hasLocalSupabase,
  serviceClient,
} from "./helpers/supabase";

/*
 * The won connection: which license closed which request.
 *
 * Three layers are under test and each is exercised where it is enforced:
 *
 *   The COMPOSITE FOREIGN KEY refuses a cross-workspace connection for
 *   anybody, service_role included -- a policy can be written wrongly, a
 *   foreign key cannot be talked round.
 *
 *   The EVIDENCE GATE refuses `won` on any request without a qualifying
 *   connected license, whatever wrote the update. Since this migration the
 *   connection is the ONLY evidence: a license hanging off a linked
 *   submission -- the pre-connection derivation -- no longer unlocks a win on
 *   its own, and that change is asserted here on purpose.
 *
 *   The PROTECT TRIGGER keeps a closed request's connection as part of its
 *   record: no unlink, no edit, only the audited purge path. Deleting the
 *   whole request still cascades, because by the time the cascade reaches the
 *   link the request is gone -- which is the purge doing what a purge does.
 */

const describeIfLocal = hasLocalSupabase() ? describe : describe.skip;

const UID = {
  owner: "11111111-1111-1111-1111-111111111111",
  otherOrgOwner: "99999999-9999-9999-9999-999999999999",
} as const;

describeIfLocal("the won connection", () => {
  const createdRequests: string[] = [];
  const createdLicenses: string[] = [];
  const service = () => serviceClient();
  let counter = 0;

  async function makeRequest(
    suffix: string,
    // negotiating is deliberately not evidence-gated -- a negotiation is a
    // conversation, not a record of work -- so a request can be arranged
    // there directly, which every won test needs.
    status: "new" | "negotiating" = "new",
  ): Promise<string> {
    counter += 1;
    const { data, error } = await service()
      .from("buyer_requests")
      .insert({
        organization_id: ORG_A,
        created_by: UID.owner,
        idempotency_key: `won-test-${suffix}-${counter}-${Date.now()}`,
        reference: `REQ-WON-${suffix.toUpperCase().slice(0, 8)}${counter}`,
        title: `Won-link test: ${suffix}`,
        status,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not arrange a request: ${error.message}`);
    createdRequests.push(data!.id);
    return data!.id;
  }

  /** An external license arranged out of band. Shares must reconstitute the base. */
  async function makeLicense(input: {
    organizationId?: string;
    status?: string;
    baseMinor?: number;
    name?: string;
  }): Promise<string> {
    const base = input.baseMinor ?? 25000;
    const { data, error } = await service()
      .from("licenses")
      .insert({
        organization_id: input.organizationId ?? ORG_A,
        status: input.status ?? "active",
        licensee_name: input.name ?? "Won-link test desk",
        origin: "external",
        sale_base_minor: base,
        sales_engine_share_minor: 0,
        photographer_share_minor: base,
        created_by: input.organizationId === ORG_B ? UID.otherOrgOwner : UID.owner,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not arrange a license: ${error.message}`);
    createdLicenses.push(data!.id);
    return data!.id;
  }

  function link(requestId: string, licenseId: string, organizationId = ORG_A) {
    return service().from("request_licenses").insert({
      organization_id: organizationId,
      request_id: requestId,
      license_id: licenseId,
      linked_by: UID.owner,
    });
  }

  function moveTo(requestId: string, status: string) {
    return service().from("buyer_requests").update({ status }).eq("id", requestId);
  }

  afterAll(async () => {
    // Requests first: deleting one cascades its connections, which is what
    // frees the licenses to go. The order is the test of the purge path.
    for (const id of createdRequests) {
      await service().from("buyer_requests").delete().eq("id", id);
    }
    for (const id of createdLicenses) {
      await service().from("licenses").delete().eq("id", id);
    }
  });

  describe("cross-workspace denial", () => {
    it("refuses another workspace's license even for service_role", async () => {
      const request = await makeRequest("xlicense");
      const foreign = await makeLicense({ organizationId: ORG_B });

      const { error } = await link(request, foreign);
      // 23503 is foreign_key_violation: no policy is in play for service_role.
      expect(error).not.toBeNull();
      expect(error!.code).toBe("23503");
    });

    it("refuses a link that relabels itself with the other workspace's id", async () => {
      const request = await makeRequest("xclaim");
      const { error } = await link(request, ORG_A_LICENSE_MASTLINE, ORG_B);

      // Relabelling does not help: the request end fails instead.
      expect(error).not.toBeNull();
      expect(error!.code).toBe("23503");
    });

    it("does not let another workspace's owner read the connection", async () => {
      const request = await makeRequest("xread", "negotiating");
      await link(request, ORG_A_LICENSE_MASTLINE);

      const nadia = await clientFor("otherOrgOwner");
      const { data } = await nadia.from("request_licenses").select("id").eq("request_id", request);
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe("idempotency", () => {
    it("keeps one row per (request, license) pair", async () => {
      const request = await makeRequest("idem", "negotiating");
      const first = await link(request, ORG_A_LICENSE_MASTLINE);
      expect(first.error).toBeNull();

      const second = await link(request, ORG_A_LICENSE_MASTLINE);
      expect(second.error).not.toBeNull();
      expect(second.error!.code).toBe("23505");

      const { data } = await service()
        .from("request_licenses")
        .select("id")
        .eq("request_id", request);
      expect(data).toHaveLength(1);
    });
  });

  describe("won follows the connection", () => {
    it("refuses won with nothing connected, then allows it once a license is", async () => {
      const request = await makeRequest("gate", "negotiating");

      const refused = await moveTo(request, "won");
      expect(refused.error).not.toBeNull();
      expect(refused.error!.message).toMatch(/connect/i);

      await link(request, ORG_A_LICENSE_MASTLINE);
      const allowed = await moveTo(request, "won");
      expect(allowed.error).toBeNull();
    });

    it("no longer accepts the derived submission path as the evidence", async () => {
      /*
       * The seeded external license hangs off ORG_A_SUBMISSION, which was
       * enough for `won` before this migration. It is not any more: the win
       * must name its license through request_licenses, entered once by the
       * person who knows which sale it was.
       */
      const request = await makeRequest("derived", "negotiating");
      await service().from("request_submissions").insert({
        organization_id: ORG_A,
        request_id: request,
        submission_id: ORG_A_SUBMISSION,
        linked_by: UID.owner,
      });

      const { error } = await moveTo(request, "won");
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/connect/i);
    });

    it("does not count a proposed license with no figure -- an offer is not a win", async () => {
      const request = await makeRequest("proposal", "negotiating");
      const proposal = await makeLicense({ status: "proposed", baseMinor: 0 });
      await link(request, proposal);

      const { error } = await moveTo(request, "won");
      expect(error).not.toBeNull();
    });

    it("counts an active license even at zero -- rights-for-credit is a real outcome", async () => {
      const request = await makeRequest("credit", "negotiating");
      const credit = await makeLicense({ status: "active", baseMinor: 0 });
      await link(request, credit);

      const { error } = await moveTo(request, "won");
      expect(error).toBeNull();
    });
  });

  describe("a won request keeps its record", () => {
    async function wonRequest(suffix: string): Promise<string> {
      const request = await makeRequest(suffix, "negotiating");
      await link(request, ORG_A_LICENSE_MASTLINE);
      const { error } = await moveTo(request, "won");
      if (error) throw new Error(`Could not arrange a won request: ${error.message}`);
      return request;
    }

    it("cannot move once won, even for service_role", async () => {
      const request = await wonRequest("closed");
      const { error } = await moveTo(request, "lost");
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/closed request/i);
    });

    it("refuses to unlink the connection of a won request", async () => {
      const request = await wonRequest("keep");
      const { error } = await service().from("request_licenses").delete().eq("request_id", request);
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/closed request/i);

      const { data } = await service()
        .from("request_licenses")
        .select("id")
        .eq("request_id", request);
      expect(data).toHaveLength(1);
    });

    it("refuses to edit a connection at all -- removed and remade, never edited", async () => {
      const request = await makeRequest("noedit", "negotiating");
      await link(request, ORG_A_LICENSE_MASTLINE);

      const { error } = await service()
        .from("request_licenses")
        .update({ linked_by: UID.otherOrgOwner })
        .eq("request_id", request);
      expect(error).not.toBeNull();
    });

    it("still lets an open request's connection be removed", async () => {
      // The wrong license connected before anything was recorded as won is a
      // mistake, not history. Nothing has claimed a win yet.
      const request = await makeRequest("undo", "negotiating");
      await link(request, ORG_A_LICENSE_MASTLINE);

      const { error } = await service().from("request_licenses").delete().eq("request_id", request);
      expect(error).toBeNull();
    });

    it("deletes the connection with the request, cascade intact", async () => {
      // The audited purge deletes the request; its record goes with it. The
      // protect trigger must not block the cascade -- by the time it fires the
      // request row is gone, which is the distinction it is built on.
      const request = await wonRequest("purge");
      const { error } = await service().from("buyer_requests").delete().eq("id", request);
      expect(error).toBeNull();

      const { data } = await service()
        .from("request_licenses")
        .select("id")
        .eq("request_id", request);
      expect(data ?? []).toHaveLength(0);
    });

    it("refuses to delete a license while a connection points at it", async () => {
      const request = await makeRequest("restrict", "negotiating");
      const license = await makeLicense({ name: "Restrict test desk" });
      await link(request, license);

      const refused = await service().from("licenses").delete().eq("id", license);
      expect(refused.error).not.toBeNull();
      expect(refused.error!.code).toBe("23503");

      // Unlink first, deliberately, and the license can go.
      await service().from("request_licenses").delete().eq("request_id", request);
      const allowed = await service().from("licenses").delete().eq("id", license);
      expect(allowed.error).toBeNull();
    });
  });

  describe("connecting through the data layer", () => {
    async function reasonOf(work: () => Promise<unknown>): Promise<string> {
      try {
        await work();
        return "ok";
      } catch (error) {
        if (error instanceof RequestError) return error.reason;
        throw error;
      }
    }

    it("connects, transitions, and writes both events in one human act", async () => {
      const request = await makeRequest("act", "negotiating");
      const dispatcher = await clientFor("dispatcher");
      const current = await getRequest(ORG_A, request, dispatcher);

      const saved = await connectLicense({
        organizationId: ORG_A,
        actorId: "33333333-3333-3333-3333-333333333333",
        requestId: request,
        licenseId: ORG_A_LICENSE_MASTLINE,
        expectedUpdatedAt: current!.updatedAt,
        client: dispatcher,
      });

      expect(saved.status).toBe("won");

      const { data: events } = await service()
        .from("activity_events")
        .select("action, event_data")
        .eq("entity_id", request);
      const actions = (events ?? []).map((event) => event.action);
      expect(actions).toContain("request.license_connected");
      expect(actions).toContain("request.won");

      const won = (events ?? []).find((event) => event.action === "request.won");
      expect(won?.event_data).toMatchObject({ licenseId: ORG_A_LICENSE_MASTLINE });
    });

    it("refuses a viewer", async () => {
      const request = await makeRequest("viewer", "negotiating");
      const viewer = await clientFor("viewer");
      const current = await getRequest(ORG_A, request, viewer);

      expect(
        await reasonOf(() =>
          connectLicense({
            organizationId: ORG_A,
            actorId: "66666666-6666-6666-6666-666666666666",
            requestId: request,
            licenseId: ORG_A_LICENSE_MASTLINE,
            expectedUpdatedAt: current!.updatedAt,
            client: viewer,
          }),
        ),
      ).toBe("denied");
    });

    it("answers a license from another workspace with not found", async () => {
      const request = await makeRequest("othersale", "negotiating");
      const foreign = await makeLicense({ organizationId: ORG_B });
      const owner = await clientFor("owner");
      const current = await getRequest(ORG_A, request, owner);

      expect(
        await reasonOf(() =>
          connectLicense({
            organizationId: ORG_A,
            actorId: UID.owner,
            requestId: request,
            licenseId: foreign,
            expectedUpdatedAt: current!.updatedAt,
            client: owner,
          }),
        ),
      ).toBe("not_found");
    });

    it("refuses from a state the transition table does not allow, before writing", async () => {
      const request = await makeRequest("tooearly", "new");
      const owner = await clientFor("owner");
      const current = await getRequest(ORG_A, request, owner);

      expect(
        await reasonOf(() =>
          connectLicense({
            organizationId: ORG_A,
            actorId: UID.owner,
            requestId: request,
            licenseId: ORG_A_LICENSE_MASTLINE,
            expectedUpdatedAt: current!.updatedAt,
            client: owner,
          }),
        ),
      ).toBe("invalid_transition");

      // The refusal came before anything was written.
      const { data } = await service()
        .from("request_licenses")
        .select("id")
        .eq("request_id", request);
      expect(data ?? []).toHaveLength(0);
    });

    it("names an ineligible license as the problem, not the request", async () => {
      const request = await makeRequest("offer", "negotiating");
      const proposal = await makeLicense({ status: "proposed", baseMinor: 0 });
      const owner = await clientFor("owner");
      const current = await getRequest(ORG_A, request, owner);

      expect(
        await reasonOf(() =>
          connectLicense({
            organizationId: ORG_A,
            actorId: UID.owner,
            requestId: request,
            licenseId: proposal,
            expectedUpdatedAt: current!.updatedAt,
            client: owner,
          }),
        ),
      ).toBe("license_ineligible");
    });
  });
});
