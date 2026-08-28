/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashIntakeToken, newIntakeToken } from "@/lib/data/request-intake";
import { isIntakeToken } from "@/lib/request-intake";
import { ORG_A, ORG_B, anonClient, hasLocalSupabase, serviceClient } from "./helpers/supabase";

/*
 * The public intake surface.
 *
 * Two claims are being tested and they are enforced by different things. Row
 * level security keeps a signed-in user inside their workspace. A composite
 * foreign key, and the fact that anon holds no table grant at all, is what
 * keeps a stranger out -- and that half has to hold for callers RLS never
 * consults.
 *
 * Everything a visitor can reach goes through two security-definer functions,
 * so the anon client below is the real subject: it is exactly what the public
 * page holds.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

let counter = 0;
function freshAddress(): string {
  // A distinct address per case, because the limiter is per address and tests
  // that shared one would throttle each other into false failures.
  counter += 1;
  return `198.51.100.${counter % 250}`;
}

async function ownerId(service: SupabaseClient): Promise<string> {
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

interface MadeLink {
  readonly id: string;
  readonly token: string;
}

async function makeLink(options: { expired?: boolean; revoked?: boolean } = {}): Promise<MadeLink> {
  const service = serviceClient();
  const token = newIntakeToken();
  const owner = await ownerId(service);

  const { data, error } = await service
    .from("request_intake_links")
    .insert({
      organization_id: ORG_A,
      buyer_id: await buyerIn(service, ORG_A),
      created_by: owner,
      recipient_label: "Northstar Picture Desk",
      token_hash: `\\x${hashIntakeToken(token).toString("hex")}`,
      expires_at: options.expired
        ? new Date(Date.now() - 86_400_000).toISOString()
        : new Date(Date.now() + 86_400_000).toISOString(),
      created_at: options.expired ? new Date(Date.now() - 8 * 86_400_000).toISOString() : undefined,
      revoked_at: options.revoked ? new Date().toISOString() : null,
      revoked_by: options.revoked ? owner : null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not arrange a link: ${error.message}`);
  return { id: data!.id, token };
}

async function open(token: string, address = freshAddress()) {
  const { data } = await anonClient().rpc("open_request_link", {
    link_token: token,
    caller: address,
  });
  return (data ?? [])[0] as Record<string, unknown> | undefined;
}

async function submit(token: string, payload: Record<string, unknown>, address = freshAddress()) {
  const { data } = await anonClient().rpc("submit_request_link", {
    link_token: token,
    payload,
    caller: address,
    caller_user_agent: "vitest",
  });
  return (data ?? [])[0] as Record<string, unknown> | undefined;
}

describeIf("request intake tokens", () => {
  describe("entropy and hashing", () => {
    it("mints 256 bits of base64url that the database will accept", () => {
      const token = newIntakeToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      // 32 bytes base64url is 43 characters with no padding.
      expect(token).toHaveLength(43);
      expect(isIntakeToken(token)).toBe(true);
    });

    it("never repeats, and is not sequential", () => {
      const seen = new Set(Array.from({ length: 2000 }, () => newIntakeToken()));
      expect(seen.size).toBe(2000);

      // A counter or a timestamp would leave long shared prefixes between
      // tokens minted back to back. Random ones share almost nothing.
      const [a, b] = [newIntakeToken(), newIntakeToken()];
      let shared = 0;
      while (shared < a.length && a[shared] === b[shared]) shared += 1;
      expect(shared).toBeLessThan(6);
    });

    it("hashes the same way the database does", async () => {
      const token = newIntakeToken();
      const { data } = await serviceClient().rpc("open_request_link", {
        link_token: token,
        caller: freshAddress(),
      });
      // Nothing matches, which is the point: our hash and theirs agree that an
      // unminted token is unknown rather than erroring differently.
      expect((data ?? [])[0]?.status).toBe("invalid");
      expect(hashIntakeToken(token).toString("hex")).toBe(
        createHash("sha256").update(token, "utf8").digest("hex"),
      );
    });
  });

  describe("what is persisted", () => {
    it("stores the hash and never the token", async () => {
      const { id, token } = await makeLink();
      const { data } = await serviceClient()
        .from("request_intake_links")
        .select("*")
        .eq("id", id)
        .single();

      const serialised = JSON.stringify(data);
      expect(serialised).not.toContain(token);
      // The stored hash is the sha256 of the token, hex-encoded by PostgREST.
      expect(String(data!.token_hash).toLowerCase()).toContain(
        hashIntakeToken(token).toString("hex"),
      );
    });

    it("keeps a typed name as an assertion with its time and evidence", async () => {
      const { id, token } = await makeLink();
      await submit(token, { title: "Departure", asserted_submitter_name: "Sam on the desk" });

      const { data } = await serviceClient()
        .from("request_intake_links")
        .select("asserted_submitter_name, asserted_at, submitter_ip, submitter_user_agent")
        .eq("id", id)
        .single();

      expect(data!.asserted_submitter_name).toBe("Sam on the desk");
      expect(data!.asserted_at).toBeTruthy();
      expect(data!.submitter_ip).toBeTruthy();
      expect(data!.submitter_user_agent).toBe("vitest");
    });

    it("records the link that was used, never a person", async () => {
      const { id, token } = await makeLink();
      await submit(token, { title: "Departure", asserted_submitter_name: "Sam on the desk" });

      const { data } = await serviceClient()
        .from("activity_events")
        .select("action, event_data")
        .eq("action", "request.submitted_through_link")
        .eq("event_data->>link_id", id)
        .single();

      const event = data!.event_data as Record<string, unknown>;
      expect(event.recipient_label).toBe("Northstar Picture Desk");
      // The typed name is carried separately, so nothing downstream can read
      // the event as "Northstar submitted this".
      expect(event.asserted_submitter_name).toBe("Sam on the desk");
      expect(data!.action).not.toContain("buyer");
    });
  });

  describe("the token lifecycle", () => {
    it("opens a live link and names only what the page renders", async () => {
      const { token } = await makeLink();
      const row = await open(token);
      expect(row?.status).toBe("ok");
      expect(row?.workspace_name).toBe("Marcus Hale Studio");
      expect(row?.recipient_label).toBe("Northstar Picture Desk");
      // No workspace id, buyer id, or anything else to pivot from.
      expect(Object.keys(row!).sort()).toEqual([
        "already_submitted",
        "expires_at",
        "recipient_label",
        "request_reference",
        "status",
        "workspace_name",
      ]);
    });

    it("answers expired, revoked, unknown and malformed identically", async () => {
      const expired = await open((await makeLink({ expired: true })).token);
      const revoked = await open((await makeLink({ revoked: true })).token);
      const unknown = await open(newIntakeToken());
      const malformed = await open("short");

      for (const row of [expired, revoked, unknown, malformed]) {
        expect(row?.status).toBe("invalid");
        expect(row?.workspace_name).toBeNull();
        expect(row?.recipient_label).toBeNull();
        expect(row?.expires_at).toBeNull();
      }
      // Not merely all "invalid" -- indistinguishable field for field.
      expect(JSON.stringify(expired)).toBe(JSON.stringify(unknown));
      expect(JSON.stringify(revoked)).toBe(JSON.stringify(malformed));
    });

    it("creates one request per token however many times it is submitted", async () => {
      const { id, token } = await makeLink();

      const first = await submit(token, { title: "Departure from last night" });
      expect(first?.status).toBe("created");

      const again = await submit(token, { title: "A completely different request" });
      expect(again?.status).toBe("already_submitted");
      expect(again?.request_reference).toBe(first?.request_reference);

      const { data } = await serviceClient()
        .from("buyer_requests")
        .select("id")
        .eq("idempotency_key", `intake-${id}`);
      expect(data).toHaveLength(1);
    });

    it("survives concurrent submissions of the same token", async () => {
      const { id, token } = await makeLink();
      await Promise.all([
        submit(token, { title: "One" }),
        submit(token, { title: "Two" }),
        submit(token, { title: "Three" }),
      ]);

      const { data } = await serviceClient()
        .from("buyer_requests")
        .select("id")
        .eq("idempotency_key", `intake-${id}`);
      expect(data).toHaveLength(1);
    });

    it("refuses a submission through an expired or revoked link", async () => {
      expect(
        (await submit((await makeLink({ expired: true })).token, { title: "x" }))?.status,
      ).toBe("invalid");
      expect(
        (await submit((await makeLink({ revoked: true })).token, { title: "x" }))?.status,
      ).toBe("invalid");
    });
  });

  describe("workspace and buyer binding", () => {
    it("cannot be pointed at another workspace's buyer, even by service_role", async () => {
      const service = serviceClient();
      const { error } = await service.from("request_intake_links").insert({
        organization_id: ORG_A,
        buyer_id: await buyerIn(service, ORG_B),
        created_by: await ownerId(service),
        recipient_label: "Wrong workspace",
        token_hash: `\\x${hashIntakeToken(newIntakeToken()).toString("hex")}`,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(error?.code).toBe("23503");
    });

    it("puts the request in the link's workspace and against the link's buyer", async () => {
      const service = serviceClient();
      const { id, token } = await makeLink();
      await submit(token, { title: "Departure" });

      const { data } = await service
        .from("request_intake_links")
        .select("buyer_id, resulting_request_id, buyer_requests(organization_id, buyer_id, source)")
        .eq("id", id)
        .single();

      const request = data!.buyer_requests as unknown as Record<string, unknown>;
      expect(request.organization_id).toBe(ORG_A);
      expect(request.buyer_id).toBe(data!.buyer_id);
      expect(request.source).toBe("portal");
    });

    it("does not let another workspace read the links", async () => {
      const { id } = await makeLink();
      const { data } = await (
        await import("./helpers/supabase")
      )
        .clientFor("otherOrgOwner")
        .then((client) => client.from("request_intake_links").select("id").eq("id", id));
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe("what a stranger can reach", () => {
    it.each([
      "request_intake_links",
      "request_link_attempts",
      "buyer_requests",
      "buyers",
      "assets",
      "shoots",
      "submissions",
      "licenses",
    ])("cannot read %s", async (table) => {
      const { data, error } = await anonClient().from(table).select("*").limit(1);
      // Either a refusal or nothing at all; never a row.
      expect(error ?? data).toBeTruthy();
      expect(data ?? []).toHaveLength(0);
    });

    it("reaches the two intake functions and nothing else", async () => {
      const anon = anonClient();
      expect(
        (await anon.rpc("open_request_link", { link_token: newIntakeToken() })).error,
      ).toBeNull();

      // A function that exists but is not part of this surface.
      const forbidden = await anon.rpc("apply_billing_state", {});
      expect(forbidden.error).not.toBeNull();
    });
  });

  describe("rate limiting", () => {
    it("bounds attempts per address without affecting anyone else", async () => {
      const { token } = await makeLink();
      const noisy = "198.51.100.251";

      for (let attempt = 0; attempt < 21; attempt += 1) {
        await open(newIntakeToken(), noisy);
      }

      // A real token from the throttled address is refused for being noisy,
      // and told so -- that is not an oracle, since it says nothing about
      // whether any token is real.
      expect((await open(token, noisy))?.status).toBe("rate_limited");
      expect((await submit(token, { title: "x" }, noisy))?.status).toBe("rate_limited");

      // Everyone else is unaffected.
      expect((await open(token, "198.51.100.252"))?.status).toBe("ok");
    });
  });
});
