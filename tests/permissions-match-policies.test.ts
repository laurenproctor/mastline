/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { APP_ROLES, type AppRole } from "../src/lib/domain";
import { can } from "../src/lib/permissions";
import {
  ORG_A,
  clientFor,
  hasLocalSupabase,
  serviceClient,
  type SeededUser,
} from "./helpers/supabase";

/**
 * The interface hides actions a role cannot perform. If src/lib/permissions.ts
 * and the RLS policies ever disagree, a person is either shown a button that
 * fails or denied one that would have worked. These tests make the two agree.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const USER_FOR_ROLE: Record<Exclude<AppRole, "owner">, SeededUser> & { owner: SeededUser } = {
  owner: "owner",
  editor: "editor",
  dispatcher: "dispatcher",
  finance: "finance",
  rights_reviewer: "rights",
  viewer: "viewer",
};

const UID: Record<AppRole, string> = {
  owner: "11111111-1111-1111-1111-111111111111",
  editor: "22222222-2222-2222-2222-222222222222",
  dispatcher: "33333333-3333-3333-3333-333333333333",
  finance: "44444444-4444-4444-4444-444444444444",
  rights_reviewer: "55555555-5555-5555-5555-555555555555",
  viewer: "66666666-6666-6666-6666-666666666666",
};

/** Did the database actually let this role do the thing? */
async function databaseAllows(role: AppRole, probe: string): Promise<boolean> {
  const client = await clientFor(USER_FOR_ROLE[role]);
  const service = serviceClient();

  switch (probe) {
    case "shoot.write": {
      const { data } = await client
        .from("shoots")
        .insert({ organization_id: ORG_A, title: `probe-${role}`, created_by: UID[role] })
        .select("id");
      if (data?.[0]?.id) {
        await service.from("shoots").delete().eq("id", data[0].id);
        return true;
      }
      return false;
    }
    case "sensitive_note.read": {
      const { data } = await client.from("shoot_sensitive_notes").select("shoot_id");
      return (data?.length ?? 0) > 0;
    }
    case "payment.write": {
      const { data } = await client
        .from("payments")
        .insert({
          organization_id: ORG_A,
          status: "expected",
          source: "manual",
          external_reference: `probe-${role}-${Date.now()}`,
          gross_minor: 100,
          net_minor: 100,
          created_by: UID[role],
        })
        .select("id");
      if (data?.[0]?.id) {
        await service.from("payments").delete().eq("id", data[0].id);
        return true;
      }
      return false;
    }
    case "license.write": {
      const { data } = await client
        .from("licenses")
        .insert({
          organization_id: ORG_A,
          status: "proposed",
          licensee_name: `probe-${role}`,
          origin: "external",
          sale_base_minor: 0,
          photographer_share_minor: 0,
          created_by: UID[role],
        })
        .select("id");
      if (data?.[0]?.id) {
        await service.from("licenses").delete().eq("id", data[0].id);
        return true;
      }
      return false;
    }
    case "package.write": {
      const { data } = await client
        .from("packages")
        .update({ package_note: `probe-${role}` })
        .eq("id", "a0000000-0000-0000-0000-0000000000f2")
        .select("id");
      return (data?.length ?? 0) > 0;
    }
    case "rights.triage": {
      const { data } = await client
        .from("rights_matches")
        .update({ decision_note: `probe-${role}` })
        .eq("organization_id", ORG_A)
        .select("id");
      if ((data?.length ?? 0) > 0) {
        await service
          .from("rights_matches")
          .update({ decision_note: null })
          .eq("organization_id", ORG_A);
        return true;
      }
      return false;
    }
    case "asset.write": {
      const { data } = await client
        .from("assets")
        .update({ headline: `probe-${role}` })
        .eq("id", "a0000000-0000-0000-0000-0000000000d2")
        .select("id");
      return (data?.length ?? 0) > 0;
    }
    default:
      throw new Error(`No probe defined for ${probe}`);
  }
}

const PROBES = [
  "shoot.write",
  "sensitive_note.read",
  "payment.write",
  "license.write",
  "package.write",
  "rights.triage",
  "asset.write",
] as const;

describeIf("the capability table matches the database policies", () => {
  for (const probe of PROBES) {
    for (const role of APP_ROLES) {
      it(`${role} / ${probe}`, async () => {
        const declared = can(role, probe);
        const actual = await databaseAllows(role, probe);
        expect(
          actual,
          declared
            ? `permissions.ts says ${role} can ${probe}, but the database refused`
            : `permissions.ts says ${role} cannot ${probe}, but the database allowed it`,
        ).toBe(declared);
      });
    }
  }
});
