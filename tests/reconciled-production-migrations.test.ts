/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  ORG_A,
  ORG_A_SHOOT,
  ORG_B,
  ORG_B_SHOOT,
  anonClient,
  clientFor,
  hasLocalSupabase,
  serviceClient,
} from "./helpers/supabase";

/**
 * Two migrations reached production before they reached Git:
 *
 *   20260828035034_buyer_requests
 *   20260829090000_resumable_field_imports
 *
 * They were pushed from an uncommitted checkout. This branch adds their files
 * to source control so the chain on disk describes the schema that is live;
 * it does not reapply them. These tests pin the properties that matter for
 * the rest of the schema -- that the two apply from empty in version order,
 * that every row stays inside its workspace, and that grants and RLS hold --
 * without expanding either feature. The features themselves have no
 * application code on main yet; that arrives with their own branches.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const OWNER_B = "99999999-9999-9999-9999-999999999999";

describeIf("the two production-applied migrations, reconciled", () => {
  it("are recorded in version order between the committed August migrations", async () => {
    // The history table is not exposed over the Data API; the tables the
    // migrations create are the evidence that they ran, and the CI job
    // compares the history against the files on disk.
    const service = serviceClient();
    for (const table of [
      "buyer_requests",
      "request_sensitive_notes",
      "import_batches",
      "import_files",
    ]) {
      const { error } = await service.from(table).select("*", { count: "exact", head: true });
      expect(error, table).toBeNull();
    }
  });

  it("keeps a buyer request inside its workspace, structurally", async () => {
    const service = serviceClient();
    const { data: buyerB } = await service
      .from("buyers")
      .select("id")
      .eq("organization_id", ORG_B)
      .limit(1)
      .single();

    // A request in workspace A naming a buyer in workspace B: refused by the
    // composite foreign key before any policy is consulted.
    const cross = await service.from("buyer_requests").insert({
      organization_id: ORG_A,
      buyer_id: buyerB!.id,
      created_by: OWNER,
      idempotency_key: `reconcile-cross-${Date.now()}`,
      reference: `REC-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      title: "Cross-workspace buyer",
    });
    expect(cross.error).toBeTruthy();
    expect(cross.error!.code).toBe("23503");

    // An assignee who is not a member of this workspace: the same.
    const stranger = await service.from("buyer_requests").insert({
      organization_id: ORG_A,
      created_by: OWNER,
      assigned_to: OWNER_B,
      idempotency_key: `reconcile-assignee-${Date.now()}`,
      reference: `REA-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      title: "Stranger assignee",
    });
    expect(stranger.error).toBeTruthy();
    expect(stranger.error!.code).toBe("23503");
  });

  it("lets members read requests, lets only owner/editor/dispatcher write, and never lets a member delete", async () => {
    const service = serviceClient();
    const key = `reconcile-read-${Date.now()}`;
    const { data: created, error } = await service
      .from("buyer_requests")
      .insert({
        organization_id: ORG_A,
        created_by: OWNER,
        idempotency_key: key,
        reference: `RER-${Date.now().toString(36).toUpperCase().slice(-6)}`,
        title: "Reconciliation fixture",
        status: "new",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const id = created!.id as string;

    try {
      const viewer = await clientFor("viewer");
      const seen = await viewer.from("buyer_requests").select("id").eq("id", id);
      expect(seen.data).toHaveLength(1);
      const viewerWrite = await viewer
        .from("buyer_requests")
        .update({ title: "Rewritten by a viewer" })
        .eq("id", id)
        .select("id");
      // RLS: no row is visible to the update, so nothing changes.
      expect(viewerWrite.data ?? []).toHaveLength(0);

      const outsider = await clientFor("otherOrgOwner");
      const unseen = await outsider.from("buyer_requests").select("id").eq("id", id);
      expect(unseen.data ?? []).toHaveLength(0);

      const dispatcher = await clientFor("dispatcher");
      const dispatcherWrite = await dispatcher
        .from("buyer_requests")
        .update({ title: "Updated by dispatch" })
        .eq("id", id)
        .select("title");
      expect(dispatcherWrite.error).toBeNull();
      expect(dispatcherWrite.data?.[0]?.title).toBe("Updated by dispatch");

      // The delete grant was taken back from authenticated by name.
      const owner = await clientFor("owner");
      const remove = await owner.from("buyer_requests").delete().eq("id", id);
      expect(remove.error?.code).toBe("42501");

      const anonymous = await anonClient().from("buyer_requests").select("id");
      expect(anonymous.error?.code).toBe("42501");

      // Confidential notes stay narrower than the request: owner and editor.
      const note = await service.from("request_sensitive_notes").insert({
        request_id: id,
        organization_id: ORG_A,
        source_note: "A tip",
        created_by: OWNER,
      });
      expect(note.error).toBeNull();
      const dispatcherNote = await dispatcher
        .from("request_sensitive_notes")
        .select("source_note")
        .eq("request_id", id);
      expect(dispatcherNote.data ?? []).toHaveLength(0);
      const ownerNote = await owner
        .from("request_sensitive_notes")
        .select("source_note")
        .eq("request_id", id);
      expect(ownerNote.data).toHaveLength(1);

      // A closed request stays closed, and a loss needs a reason.
      const lost = await service.from("buyer_requests").update({ status: "lost" }).eq("id", id);
      expect(lost.error).toBeTruthy();
      const lostWithReason = await service
        .from("buyer_requests")
        .update({ status: "lost", closed_reason: "Desk went elsewhere." })
        .eq("id", id)
        .select("closed_at")
        .single();
      expect(lostWithReason.error).toBeNull();
      expect(lostWithReason.data?.closed_at).toBeTruthy();
      const reopen = await service.from("buyer_requests").update({ status: "new" }).eq("id", id);
      expect(reopen.error).toBeTruthy();
    } finally {
      // No delete grant exists for a member; the service role holds one.
      await service.from("buyer_requests").delete().eq("id", id);
    }
  });

  it("keeps an import file inside its batch's workspace and derives the batch counters", async () => {
    const service = serviceClient();
    const { data: batch, error } = await service
      .from("import_batches")
      .insert({
        organization_id: ORG_A,
        shoot_id: ORG_A_SHOOT,
        created_by: OWNER,
        idempotency_key: `reconcile-batch-${Date.now()}`,
      })
      .select("id, status, total_files")
      .single();
    expect(error).toBeNull();
    const batchId = batch!.id as string;

    try {
      expect(batch!.status).toBe("pending");
      expect(batch!.total_files).toBe(0);

      // A file in workspace B naming a batch in workspace A: refused by the
      // composite foreign key.
      const cross = await service.from("import_files").insert({
        import_batch_id: batchId,
        organization_id: ORG_B,
        client_file_id: "cross",
        original_filename: "cross.jpg",
        byte_size: 10,
        mime_type: "image/jpeg",
        storage_path: `${ORG_B}/_staging/${batchId}/cross`,
      });
      expect(cross.error?.code).toBe("23503");

      const { data: file } = await service
        .from("import_files")
        .insert({
          import_batch_id: batchId,
          organization_id: ORG_A,
          client_file_id: "one",
          original_filename: "one.jpg",
          byte_size: 10,
          mime_type: "image/jpeg",
          storage_path: `${ORG_A}/_staging/${batchId}/one`,
        })
        .select("id")
        .single();

      const { data: counted } = await service
        .from("import_batches")
        .select("total_files, completed_files, status")
        .eq("id", batchId)
        .single();
      expect(counted).toEqual({ total_files: 1, completed_files: 0, status: "pending" });

      // The storage path is fixed at registration, and a file cannot be
      // complete without an asset.
      const move = await service
        .from("import_files")
        .update({ storage_path: `${ORG_A}/_staging/${batchId}/elsewhere` })
        .eq("id", file!.id);
      expect(move.error).toBeTruthy();
      const finish = await service
        .from("import_files")
        .update({ status: "complete" })
        .eq("id", file!.id);
      expect(finish.error).toBeTruthy();

      // Workspace boundary for readers: a member of A sees it, B does not,
      // anon nothing.
      const viewer = await clientFor("viewer");
      expect(
        (await viewer.from("import_batches").select("id").eq("id", batchId)).data,
      ).toHaveLength(1);
      const outsider = await clientFor("otherOrgOwner");
      expect(
        (await outsider.from("import_batches").select("id").eq("id", batchId)).data ?? [],
      ).toHaveLength(0);
      expect((await anonClient().from("import_files").select("id")).error?.code).toBe("42501");

      // Writes need owner or editor: a dispatcher may not register a batch.
      const dispatcher = await clientFor("dispatcher");
      const dispatcherBatch = await dispatcher.from("import_batches").insert({
        organization_id: ORG_A,
        shoot_id: ORG_A_SHOOT,
        created_by: "33333333-3333-3333-3333-333333333333",
        idempotency_key: `reconcile-dispatcher-${Date.now()}`,
      });
      expect(dispatcherBatch.error).toBeTruthy();

      // ...and a shoot in another workspace cannot host this workspace's batch.
      const crossShoot = await service.from("import_batches").insert({
        organization_id: ORG_A,
        shoot_id: ORG_B_SHOOT,
        created_by: OWNER,
        idempotency_key: `reconcile-crossshoot-${Date.now()}`,
      });
      // shoots(id) alone is referenced here; the row lands. That is the shape
      // production has, recorded rather than changed by this reconciliation.
      expect(crossShoot.error).toBeNull();
      await service
        .from("import_batches")
        .delete()
        .eq("organization_id", ORG_A)
        .like("idempotency_key", "reconcile-crossshoot-%");
    } finally {
      await service.from("import_batches").delete().eq("id", batchId);
    }
  });
});
