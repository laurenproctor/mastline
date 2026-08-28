/** @vitest-environment node */
import { afterAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ORG_A,
  ORG_A_PACKAGE_DELIVERED,
  ORG_B,
  anonClient,
  clientFor,
  hasLocalSupabase,
  serviceClient,
} from "./helpers/supabase";

const describeIf = hasLocalSupabase() ? describe : describe.skip;

let seq = 0;
const made: { requests: string[]; briefs: string[]; payments: string[] } = {
  requests: [],
  briefs: [],
  payments: [],
};

async function owner(service: SupabaseClient): Promise<string> {
  const { data } = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", ORG_A)
    .eq("role", "owner")
    .limit(1)
    .single();
  return data!.user_id;
}

async function buyerIn(service: SupabaseClient, org: string): Promise<string> {
  const { data } = await service
    .from("buyers")
    .select("id")
    .eq("organization_id", org)
    .limit(1)
    .single();
  return data!.id;
}

async function makeRequest(label: string): Promise<string> {
  const service = serviceClient();
  seq += 1;
  const { data, error } = await service
    .from("buyer_requests")
    .insert({
      organization_id: ORG_A,
      buyer_id: await buyerIn(service, ORG_A),
      created_by: await owner(service),
      idempotency_key: `intel-${label}-${seq}-${Date.now()}`,
      reference: `INT-${String(1000 + seq).slice(-4)}-${seq}`,
      title: `Intelligence ${label}`,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  made.requests.push(data!.id);
  return data!.id;
}

describeIf("request intelligence", () => {
  afterAll(async () => {
    const service = serviceClient();
    for (const id of made.payments) await service.from("payments").delete().eq("id", id);
    for (const id of made.briefs) await service.from("standing_briefs").delete().eq("id", id);
    for (const id of made.requests) await service.from("buyer_requests").delete().eq("id", id);
  });

  describe("standing briefs", () => {
    async function makeBrief(over: Record<string, unknown> = {}): Promise<string> {
      const service = serviceClient();
      seq += 1;
      const { data, error } = await service
        .from("standing_briefs")
        .insert({
          organization_id: ORG_A,
          buyer_id: await buyerIn(service, ORG_A),
          created_by: await owner(service),
          title: `Standing brief ${seq}`,
          subjects: ["Julian Cross"],
          topics: ["departure"],
          locations: ["Soho, London"],
          ...over,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      made.briefs.push(data!.id);
      return data!.id;
    }

    it("starts active and moves through paused to ended", async () => {
      const service = serviceClient();
      const id = await makeBrief();
      const { data: fresh } = await service
        .from("standing_briefs")
        .select("status")
        .eq("id", id)
        .single();
      expect(fresh!.status).toBe("active");

      for (const status of ["paused", "active", "ended"]) {
        const { error } = await service
          .from("standing_briefs")
          .update({ status, ended_reason: status === "ended" ? "Desk closed the strand." : null })
          .eq("id", id);
        expect(error, status).toBeNull();
      }
    });

    /*
     * The distinction the whole table exists to protect. A brief is what a desk
     * generally wants. Saying it produced a request is a claim about today, and
     * only an occurrence makes it true.
     */
    it("does not, by existing, mean the buyer asked for anything", async () => {
      const service = serviceClient();
      const id = await makeBrief();
      const { data } = await service
        .from("standing_brief_occurrences")
        .select("id")
        .eq("brief_id", id);
      expect(data ?? []).toHaveLength(0);
    });

    it("refuses guidance figures nobody disclosed, and a disclosure with no figure", async () => {
      const service = serviceClient();
      const bare = await service.from("standing_briefs").insert({
        organization_id: ORG_A,
        buyer_id: await buyerIn(service, ORG_A),
        created_by: await owner(service),
        title: "Undisclosed but priced",
        budget_guidance_min_minor: 50000,
      });
      expect(bare.error?.code).toBe("23514");

      const empty = await service.from("standing_briefs").insert({
        organization_id: ORG_A,
        buyer_id: await buyerIn(service, ORG_A),
        created_by: await owner(service),
        title: "Disclosed but empty",
        budget_guidance_disclosed: true,
      });
      expect(empty.error?.code).toBe("23514");
    });

    it("cannot be attached to another workspace's buyer", async () => {
      const service = serviceClient();
      const { error } = await service.from("standing_briefs").insert({
        organization_id: ORG_A,
        buyer_id: await buyerIn(service, ORG_B),
        created_by: await owner(service),
        title: "Wrong workspace",
      });
      expect(error?.code).toBe("23503");
    });

    it("generates an occurrence once per period, however many times it is asked", async () => {
      const service = serviceClient();
      const brief = await makeBrief();
      const request = await makeRequest("occurrence");
      const row = {
        organization_id: ORG_A,
        brief_id: brief,
        request_id: request,
        generated_by: await owner(service),
        period_key: "2026-08",
        basis: "Monthly pull for the standing London departures brief.",
      };

      const first = await service.from("standing_brief_occurrences").insert(row);
      expect(first.error).toBeNull();

      // The same period again is refused by the unique key, not by a read that
      // happened to come back non-empty first.
      const again = await service.from("standing_brief_occurrences").insert(row);
      expect(again.error?.code).toBe("23505");

      const { data } = await service
        .from("standing_brief_occurrences")
        .select("id")
        .eq("brief_id", brief);
      expect(data).toHaveLength(1);
    });

    it("records who generated it, because nothing here runs unattended", async () => {
      const service = serviceClient();
      const brief = await makeBrief();
      const request = await makeRequest("attributed");
      const { error } = await service.from("standing_brief_occurrences").insert({
        organization_id: ORG_A,
        brief_id: brief,
        request_id: request,
        generated_by: null,
        period_key: "2026-09",
        basis: "Nobody pressed anything.",
      });
      expect(error?.code).toBe("23502"); // not null violation
    });
  });

  describe("suggestions", () => {
    async function suggest(request: string, asset: string, over: Record<string, unknown> = {}) {
      const service = serviceClient();
      return service.from("request_asset_suggestions").insert({
        organization_id: ORG_A,
        request_id: request,
        asset_id: asset,
        basis: "Matched on subject recorded as Julian Cross.",
        basis_signals: { subjects: ["Julian Cross"] },
        confidence: 0.82,
        clearance: "unknown",
        ...over,
      });
    }

    async function anAsset(org = ORG_A): Promise<string> {
      const { data } = await serviceClient()
        .from("assets")
        .select("id")
        .eq("organization_id", org)
        .limit(1)
        .single();
      return data!.id;
    }

    it("carries all six pieces of provenance", async () => {
      const service = serviceClient();
      const request = await makeRequest("provenance");
      await suggest(request, await anAsset());
      const { data } = await service
        .from("request_asset_suggestions")
        .select("request_id, asset_id, basis, confidence, origin, created_at")
        .eq("request_id", request)
        .single();

      for (const key of ["request_id", "asset_id", "basis", "confidence", "origin", "created_at"]) {
        expect(data![key as keyof typeof data], key).toBeTruthy();
      }
      expect(data!.origin).toBe("deterministic");
    });

    it("refuses a model-origin suggestion in this phase", async () => {
      const request = await makeRequest("model");
      const { error } = await suggest(request, await anAsset(), { origin: "model" });
      expect(error?.code).toBe("23514");
    });

    it("refuses a confidence outside nought to one", async () => {
      const request = await makeRequest("confidence");
      expect((await suggest(request, await anAsset(), { confidence: 1.4 })).error?.code).toBe(
        "23514",
      );
      expect((await suggest(request, await anAsset(), { confidence: -0.1 })).error?.code).toBe(
        "23514",
      );
    });

    it("makes a second run update rather than duplicate", async () => {
      const service = serviceClient();
      const request = await makeRequest("dedupe");
      const asset = await anAsset();
      await suggest(request, asset);
      const again = await suggest(request, asset);
      expect(again.error?.code).toBe("23505");

      const { data } = await service
        .from("request_asset_suggestions")
        .select("id")
        .eq("request_id", request);
      expect(data).toHaveLength(1);
    });

    it("will not record a decision without a decider, or a live one with", async () => {
      const service = serviceClient();
      const request = await makeRequest("decision");
      const asset = await anAsset();
      await suggest(request, asset);

      const anonymous = await service
        .from("request_asset_suggestions")
        .update({ state: "accepted" })
        .eq("request_id", request);
      expect(anonymous.error?.code).toBe("23514");

      const proper = await service
        .from("request_asset_suggestions")
        .update({
          state: "rejected",
          decided_by: await owner(service),
          decided_at: new Date().toISOString(),
        })
        .eq("request_id", request);
      expect(proper.error).toBeNull();
    });

    it("keeps a rejected suggestion, because the decision is the record", async () => {
      const service = serviceClient();
      const request = await makeRequest("rejected");
      const asset = await anAsset();
      await suggest(request, asset);
      await service
        .from("request_asset_suggestions")
        .update({
          state: "rejected",
          decided_by: await owner(service),
          decided_at: new Date().toISOString(),
          decision_note: "Wrong doorway.",
        })
        .eq("request_id", request);

      const { data } = await service
        .from("request_asset_suggestions")
        .select("state, decision_note")
        .eq("request_id", request)
        .single();
      expect(data!.state).toBe("rejected");
      expect(data!.decision_note).toBe("Wrong doorway.");
    });

    it("cannot suggest another workspace's asset", async () => {
      const request = await makeRequest("crossworkspace");
      const { error } = await suggest(request, await anAsset(ORG_B));
      expect(error?.code).toBe("23503");
    });
  });

  describe("analytics", () => {
    it("shows a workspace only its own figures, and anon none", async () => {
      const marcus = await clientFor("owner");
      const nadia = await clientFor("otherOrgOwner");

      const mine = await marcus.from("request_outcomes").select("organization_id");
      expect(mine.data!.every((row) => row.organization_id === ORG_A)).toBe(true);

      const theirs = await nadia.from("request_facts").select("organization_id");
      expect((theirs.data ?? []).some((row) => row.organization_id === ORG_A)).toBe(false);

      const stranger = await anonClient().from("request_outcomes").select("organization_id");
      expect(stranger.error).not.toBeNull();
    });

    /*
     * The rule the product exists to protect. A link a buyer opened is evidence
     * they looked; it is not a submission and it is certainly not a sale.
     */
    it("does not count a created or opened delivery link as a response", async () => {
      const service = serviceClient();
      const request = await makeRequest("opened");

      const { data: submission } = await service
        .from("submissions")
        .insert({
          organization_id: ORG_A,
          package_id: ORG_A_PACKAGE_DELIVERED,
          status: "queued",
          created_by: await owner(service),
        })
        .select("id")
        .single();
      await service.from("request_submissions").insert({
        organization_id: ORG_A,
        request_id: request,
        submission_id: submission!.id,
        linked_by: await owner(service),
      });

      // A link that exists and has been opened, but never marked shared.
      const { data: link } = await service
        .from("submission_deliveries")
        .insert({
          organization_id: ORG_A,
          submission_id: submission!.id,
          token: "o".repeat(43),
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          created_by: await owner(service),
        })
        .select("id")
        .single();
      await service.from("delivery_access_events").insert({
        organization_id: ORG_A,
        delivery_id: link!.id,
        event_type: "opened",
      });

      const { data } = await service
        .from("request_facts")
        .select("first_sent_at, submission_count")
        .eq("id", request)
        .single();

      expect(data!.submission_count).toBe(1);
      expect(data!.first_sent_at).toBeNull();
      await service.from("submissions").delete().eq("id", submission!.id);
    });

    it("does not attribute a payment nobody allocated", async () => {
      const service = serviceClient();
      const request = await makeRequest("unallocated");
      const { data: payment } = await service
        .from("payments")
        .insert({
          organization_id: ORG_A,
          buyer_id: await buyerIn(service, ORG_A),
          status: "received",
          gross_minor: 500000,
          net_minor: 500000,
          created_by: await owner(service),
          received_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      made.payments.push(payment!.id);

      const { data } = await service
        .from("request_facts")
        .select("paid_minor, licensed_minor")
        .eq("id", request)
        .single();
      expect(data!.paid_minor).toBeNull();
      expect(data!.licensed_minor).toBeNull();
    });

    /*
     * Null and zero are different answers and the difference is the whole
     * point. A request nobody has recorded revenue for has not earned nothing.
     */
    it("reports missing measurement as null, never as zero", async () => {
      const service = serviceClient();
      const request = await makeRequest("missing");
      const { data } = await service
        .from("request_facts")
        .select("first_sent_at, first_paid_at, licensed_minor, paid_minor, qualified_at")
        .eq("id", request)
        .single();

      for (const key of [
        "first_sent_at",
        "first_paid_at",
        "licensed_minor",
        "paid_minor",
        "qualified_at",
      ]) {
        expect(data![key as keyof typeof data], key).toBeNull();
      }
    });

    it("keeps stated budget apart from licensed money", async () => {
      const marcus = await clientFor("owner");
      const { data } = await marcus
        .from("request_outcomes")
        .select(
          "stated_budget_ceiling_minor, licensed_minor_from_won, requests_with_no_stated_budget",
        )
        .eq("organization_id", ORG_A)
        .single();

      // Separate columns, and the count of requests that stated nothing is
      // carried so an average is never taken over a denominator that lied.
      expect(Object.keys(data!)).toEqual(
        expect.arrayContaining([
          "stated_budget_ceiling_minor",
          "licensed_minor_from_won",
          "requests_with_no_stated_budget",
        ]),
      );
    });

    it("answers the whole roll-up quickly enough to put on a screen", async () => {
      const marcus = await clientFor("owner");
      const started = Date.now();
      const [outcomes, byBuyer, reasons] = await Promise.all([
        marcus.from("request_outcomes").select("*"),
        marcus.from("request_revenue_by_buyer").select("*"),
        marcus.from("request_closure_reasons").select("*"),
      ]);
      const elapsed = Date.now() - started;

      expect(outcomes.error).toBeNull();
      expect(byBuyer.error).toBeNull();
      expect(reasons.error).toBeNull();
      // Generous, because this is a laptop running a whole stack in Docker. It
      // is here to catch an accidental cross join, not to police milliseconds.
      expect(elapsed).toBeLessThan(4000);
    });
  });
});
