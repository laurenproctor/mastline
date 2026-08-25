/**
 * @vitest-environment node
 */
import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, clientFor, hasLocalSupabase, serviceClient } from "./helpers/supabase";

/**
 * Profiles and avatars.
 *
 * A profile is the one record here that is deliberately readable by someone
 * other than its owner, so the interesting question is where that stops. It
 * stops at the workspace: colleagues yes, another organization no, signed out
 * never.
 *
 * Every subject is a real authenticated user going through PostgREST, so what
 * is being tested is the policy rather than a filter in application code.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

let ownerId = "";
let editorId = "";
let otherOrgOwnerId = "";

describeIf("profiles", () => {
  beforeAll(async () => {
    const service = serviceClient();
    const { data } = await service.auth.admin.listUsers();
    const byEmail = (email: string) => data?.users.find((user) => user.email === email)?.id ?? "";
    ownerId = byEmail("marcus@mastline.test");
    editorId = byEmail("jordan@mastline.test");
    otherOrgOwnerId = byEmail("nadia@northline.test");
  });

  // Read as a member rather than as the service role: this project does not
  // grant service_role DML on public tables -- `shoots` and `memberships` carry
  // the same REFERENCES/TRIGGER/TRUNCATE only -- so a service select returns an
  // empty set and would assert nothing.
  it("gives every seeded account a row, carrying the address", async () => {
    const owner = await clientFor("owner");
    const { data } = await owner.from("profiles").select("id, email");
    // The six seeded members of this workspace, and nobody from the other one.
    expect((data ?? []).length).toBeGreaterThanOrEqual(6);
    expect(data?.find((row) => row.id === ownerId)?.email).toBe("marcus@mastline.test");
    expect(data?.find((row) => row.id === otherOrgOwnerId)).toBeUndefined();
  });

  it("lets a colleague read the profile of someone in the same workspace", async () => {
    const editor = await clientFor("editor");
    const { data } = await editor.from("profiles").select("id, email").eq("id", ownerId);
    expect(data ?? []).toHaveLength(1);
  });

  it("does not let another organization read it", async () => {
    const outsider = await clientFor("otherOrgOwner");
    const { data } = await outsider.from("profiles").select("id").eq("id", ownerId);
    expect(data ?? []).toHaveLength(0);
  });

  it("does not let the workspace read someone outside it", async () => {
    const owner = await clientFor("owner");
    const { data } = await owner.from("profiles").select("id").eq("id", otherOrgOwnerId);
    expect(data ?? []).toHaveLength(0);
  });

  it("shows nothing at all to a signed-out caller", async () => {
    const { data } = await anonClient().from("profiles").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("lets a person set their own avatar path", async () => {
    const owner = await clientFor("owner");
    const key = `${ownerId}/test-avatar.jpg`;
    const { error } = await owner.from("profiles").update({ avatar_path: key }).eq("id", ownerId);
    expect(error).toBeNull();

    const { data } = await owner.from("profiles").select("avatar_path").eq("id", ownerId).single();
    expect(data?.avatar_path).toBe(key);

    await owner.from("profiles").update({ avatar_path: null }).eq("id", ownerId);
  });

  it("refuses a path that points outside the owner's own prefix", async () => {
    const owner = await clientFor("owner");
    // Borrowing a colleague's face by aiming the column at their object.
    const { error } = await owner
      .from("profiles")
      .update({ avatar_path: `${editorId}/stolen.jpg` })
      .eq("id", ownerId);
    expect(error).not.toBeNull();
  });

  it("does not let one person edit another's profile", async () => {
    const editor = await clientFor("editor");
    const { data } = await editor
      .from("profiles")
      .update({ first_name: "Renamed" })
      .eq("id", ownerId)
      .select();
    // The policy makes the row invisible to the update rather than erroring.
    expect(data ?? []).toHaveLength(0);

    // Confirmed by the owner, who can actually see their own row. Reading this
    // back as the service role would pass whether or not the write landed.
    const owner = await clientFor("owner");
    const { data: after } = await owner
      .from("profiles")
      .select("first_name")
      .eq("id", ownerId)
      .single();
    expect(after?.first_name).not.toBe("Renamed");
  });

  it("has no insert path from a client at all", async () => {
    const owner = await clientFor("owner");
    const { error } = await owner
      .from("profiles")
      .insert({ id: "00000000-0000-0000-0000-0000000000ff" });
    expect(error).not.toBeNull();
  });
});

describeIf("the avatars bucket", () => {
  const objectFor = (userId: string) => `${userId}/policy-test.jpg`;
  const oneByOne = () =>
    new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });

  it("is not public", async () => {
    const { data } = await serviceClient().storage.getBucket("avatars");
    expect(data?.public).toBe(false);
  });

  it("lets a person write under their own prefix", async () => {
    const owner = await clientFor("owner");
    const { error } = await owner.storage
      .from("avatars")
      .upload(objectFor(ownerId), oneByOne(), { contentType: "image/jpeg", upsert: true });
    expect(error).toBeNull();
  });

  it("refuses a write under somebody else's prefix", async () => {
    const editor = await clientFor("editor");
    const { error } = await editor.storage
      .from("avatars")
      .upload(objectFor(ownerId), oneByOne(), { contentType: "image/jpeg", upsert: true });
    expect(error).not.toBeNull();
  });

  it("lets a colleague sign a URL for it", async () => {
    const editor = await clientFor("editor");
    const { data, error } = await editor.storage
      .from("avatars")
      .createSignedUrl(objectFor(ownerId), 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
  });

  it("does not let another organization sign a URL for it", async () => {
    const outsider = await clientFor("otherOrgOwner");
    const { data } = await outsider.storage.from("avatars").createSignedUrl(objectFor(ownerId), 60);
    expect(data?.signedUrl).toBeFalsy();
  });

  it("does not let a signed-out caller sign a URL for it", async () => {
    const { data } = await anonClient()
      .storage.from("avatars")
      .createSignedUrl(objectFor(ownerId), 60);
    expect(data?.signedUrl).toBeFalsy();
  });

  it("does not let a colleague delete it", async () => {
    const editor = await clientFor("editor");
    await editor.storage.from("avatars").remove([objectFor(ownerId)]);

    // Still there: remove() reports success for rows the policy hid from it.
    const { data } = await serviceClient()
      .storage.from("avatars")
      .list(ownerId, { search: "policy-test.jpg" });
    expect(data ?? []).toHaveLength(1);
  });

  it("lets the owner delete their own", async () => {
    const owner = await clientFor("owner");
    const { error } = await owner.storage.from("avatars").remove([objectFor(ownerId)]);
    expect(error).toBeNull();

    const { data } = await serviceClient()
      .storage.from("avatars")
      .list(ownerId, { search: "policy-test.jpg" });
    expect(data ?? []).toHaveLength(0);
  });
});
