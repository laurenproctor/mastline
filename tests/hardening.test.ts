/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import * as deliveryModule from "../src/lib/data/delivery";
import { listDeliveryAttempts, recordDeliveryAttempt } from "../src/lib/data/delivery";
import { createPackageFromSelection } from "../src/lib/data/packages";
import { approvePackageAndCreateSubmission } from "../src/lib/data/submissions";
import {
  confirmStatementLine,
  importStatement,
  listStatementImports,
  updateStatementLine,
} from "../src/lib/data/statements";
import { collectExport } from "../src/lib/data/export";
import { parseCsv } from "../src/lib/statement-import";
import { ORG_A, clientFor, hasLocalSupabase, purgeShoot, serviceClient } from "./helpers/supabase";

/**
 * Operational hardening: the things that have to hold when a live shoot goes
 * wrong rather than right.
 */
const describeIf = hasLocalSupabase() ? describe : describe.skip;

const OWNER = "11111111-1111-1111-1111-111111111111";
const EDITOR = "22222222-2222-2222-2222-222222222222";
const DISPATCHER = "33333333-3333-3333-3333-333333333333";
const FINANCE = "44444444-4444-4444-4444-444444444444";
const BACKGRID = "a0000000-0000-0000-0000-0000000000b1";

const shoots: string[] = [];
const imports: string[] = [];
const payments: string[] = [];

async function digest(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A shoot dispatched to Backgrid, returning its submission. */
async function dispatchedSubmission(label: string) {
  const service = serviceClient();
  const editor = await clientFor("editor");
  const dispatcher = await clientFor("dispatcher");

  const { data: shoot } = await service
    .from("shoots")
    .insert({
      organization_id: ORG_A,
      title: `${label} ${Date.now()}`,
      status: "preparing",
      starts_at: new Date(Date.now() - 900_000).toISOString(),
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
      canonical_filename: `MH_${label}`,
      captured_at: new Date(Date.now() - 900_000).toISOString(),
      caption: "A complete caption.",
      credit_line: "Marcus Hale / Mastline",
      copyright_notice: "© 2026 Marcus Hale",
      selected: true,
      created_by: OWNER,
    })
    .select("id")
    .single();

  await service.from("asset_versions").insert({
    organization_id: ORG_A,
    asset_id: asset!.id,
    version_kind: "original",
    storage_bucket: "originals",
    object_key: `${ORG_A}/${shootId}/${label}.arw`,
    sha256: await digest(`${label}-${Date.now()}`),
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
  });

  const approved = await approvePackageAndCreateSubmission({
    client: dispatcher,
    organizationId: ORG_A,
    actorId: DISPATCHER,
    packageId,
  });

  return {
    shootId,
    submissionId: approved.submissionId,
    reference: approved.reference,
  };
}

afterAll(async () => {
  const service = serviceClient();
  for (const id of payments) await service.from("payments").delete().eq("id", id);
  for (const id of imports) await service.from("statement_imports").delete().eq("id", id);
  for (const shootId of shoots) await purgeShoot(shootId);
});

describeIf("a provider-reported delivery failure is visible", () => {
  it("records the failure, its reason, and moves the submission to failed", async () => {
    const dispatcher = await clientFor("dispatcher");
    const { submissionId } = await dispatchedSubmission("FAIL");

    await recordDeliveryAttempt({
      client: dispatcher,
      organizationId: ORG_A,
      submissionId,
      status: "failed",
      actorId: DISPATCHER,
      errorCode: "SFTP_AUTH",
      errorDetail: "Credentials rejected by the host.",
    });

    const { data: submission } = await serviceClient()
      .from("submissions")
      .select("status")
      .eq("id", submissionId)
      .single();
    expect(submission!.status).toBe("failed");

    const attempts = await listDeliveryAttempts(ORG_A, submissionId, dispatcher);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("failed");
    expect(attempts[0].errorCode).toBe("SFTP_AUTH");
    expect(attempts[0].errorDetail).toMatch(/Credentials/);
  });

  /*
   * There used to be two tests here proving that "Retry delivery" worked. They
   * passed, and what they proved was that a database insert happened -- no
   * worker, sender, or client was ever going to act on it. The control and the
   * function behind it are gone, so what is worth asserting now is their
   * absence: nothing in the delivery module offers a way for an operator to
   * manufacture an attempt.
   */
  it("offers no operator path that fakes a delivery attempt", () => {
    expect("retryDelivery" in deliveryModule).toBe(false);
    expect(Object.keys(deliveryModule).sort()).toEqual([
      "listDeliveryAttempts",
      "recordDeliveryAttempt",
    ]);
  });

  it("leaves what was approved untouched when a provider reports a failure", async () => {
    const dispatcher = await clientFor("dispatcher");
    const { submissionId } = await dispatchedSubmission("PROVIDERFAIL");
    const service = serviceClient();

    const { data: before } = await service
      .from("submissions")
      .select("delivery_manifest, terms_snapshot")
      .eq("id", submissionId)
      .single();

    await recordDeliveryAttempt({
      client: dispatcher,
      organizationId: ORG_A,
      submissionId,
      status: "failed",
      actorId: DISPATCHER,
      errorCode: "TIMEOUT",
    });

    const { data: after } = await service
      .from("submissions")
      .select("delivery_manifest, terms_snapshot, status")
      .eq("id", submissionId)
      .single();
    expect(after!.delivery_manifest).toEqual(before!.delivery_manifest);
    expect(after!.terms_snapshot).toBe(before!.terms_snapshot);
    expect(after!.status).toBe("failed");
  });

  it("numbers attempts in order and keeps every one", async () => {
    const dispatcher = await clientFor("dispatcher");
    const { submissionId } = await dispatchedSubmission("ATTEMPTS");

    for (const code of ["TIMEOUT", "SFTP_AUTH", "DISK_FULL"]) {
      await recordDeliveryAttempt({
        client: dispatcher,
        organizationId: ORG_A,
        submissionId,
        status: "failed",
        actorId: DISPATCHER,
        errorCode: code,
      });
    }

    const attempts = await listDeliveryAttempts(ORG_A, submissionId, dispatcher);
    expect(attempts.map((attempt) => attempt.attemptNumber)).toEqual([3, 2, 1]);
    expect(attempts.map((attempt) => attempt.errorCode)).toEqual([
      "DISK_FULL",
      "SFTP_AUTH",
      "TIMEOUT",
    ]);
  });

  it("cannot rewrite an attempt after the fact", async () => {
    const dispatcher = await clientFor("dispatcher");
    const { submissionId } = await dispatchedSubmission("IMMUTABLE");
    await recordDeliveryAttempt({
      client: dispatcher,
      organizationId: ORG_A,
      submissionId,
      status: "failed",
      actorId: DISPATCHER,
      errorCode: "TIMEOUT",
    });

    const { error } = await serviceClient()
      .from("submission_delivery_attempts")
      .update({ error_code: "SOMETHING_ELSE" })
      .eq("submission_id", submissionId);
    expect(error).not.toBeNull();
  });

  it("does not let an editor record a delivery attempt", async () => {
    const editor = await clientFor("editor");
    const { submissionId } = await dispatchedSubmission("EDITORATTEMPT");

    await expect(
      recordDeliveryAttempt({
        client: editor,
        organizationId: ORG_A,
        submissionId,
        status: "failed",
        actorId: EDITOR,
      }),
    ).rejects.toThrow();
  });
});

describeIf("webhook idempotency", () => {
  it("refuses a duplicate provider event id", async () => {
    const service = serviceClient();
    const eventId = `evt_dup_${Date.now()}`;

    const first = await service
      .from("webhook_events")
      .insert({ organization_id: ORG_A, provider: "backgrid", external_event_id: eventId })
      .select("id")
      .single();
    expect(first.error).toBeNull();

    const second = await service
      .from("webhook_events")
      .insert({ organization_id: ORG_A, provider: "backgrid", external_event_id: eventId });
    expect(second.error?.code).toBe("23505");

    await service.from("webhook_events").delete().eq("id", first.data!.id);
  });

  it("treats the same id from different providers as different events", async () => {
    const service = serviceClient();
    const eventId = `evt_shared_${Date.now()}`;

    const a = await service
      .from("webhook_events")
      .insert({ organization_id: ORG_A, provider: "backgrid", external_event_id: eventId })
      .select("id")
      .single();
    const b = await service
      .from("webhook_events")
      .insert({ organization_id: ORG_A, provider: "mega", external_event_id: eventId })
      .select("id")
      .single();

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    await service.from("webhook_events").delete().in("id", [a.data!.id, b.data!.id]);
  });
});

describeIf("statement import", () => {
  const csvFor = (reference: string) =>
    `Reference,Description,Gross,Commission\n${reference},"Hotel Chelsea, departure",840.00,336.00\nUNKNOWN-1,Something else,500.00,200.00\n`;

  it("reads a file, matches what it can, and states a basis for every line", async () => {
    const finance = await clientFor("finance");
    const { reference } = await dispatchedSubmission("STATEMENT");

    const result = await importStatement({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      buyerId: BACKGRID,
      filename: "august.csv",
      csv: csvFor(reference),
    });
    imports.push(result.importId);

    expect(result.rowCount).toBe(2);
    expect(result.duplicate).toBe(false);

    const statements = await listStatementImports(ORG_A, finance);
    const statement = statements.find((entry) => entry.id === result.importId);
    expect(statement?.lines).toHaveLength(2);

    for (const line of statement!.lines) {
      expect(line.matchBasis, `line ${line.lineNumber} has no basis`).toBeTruthy();
    }

    const matched = statement!.lines.find((line) => line.externalReference === reference);
    expect(matched?.matchedSubmissionId).toBeTruthy();
    // Even an exact reference match is only a suggestion until confirmed.
    expect(matched?.matchStatus).toBe("suggested");

    const unmatched = statement!.lines.find((line) => line.externalReference === "UNKNOWN-1");
    expect(unmatched?.matchedSubmissionId).toBeUndefined();
    expect(unmatched?.matchStatus).toBe("unmatched");
  });

  it("preserves the agency's own figures exactly", async () => {
    const finance = await clientFor("finance");
    const { reference } = await dispatchedSubmission("FIGURES");

    const result = await importStatement({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      filename: "figures.csv",
      csv: csvFor(reference),
    });
    imports.push(result.importId);

    const statements = await listStatementImports(ORG_A, finance);
    const line = statements
      .find((entry) => entry.id === result.importId)!
      .lines.find((entry) => entry.externalReference === reference)!;

    expect(line.gross.minor).toBe(84_000);
    expect(line.deductions.minor).toBe(33_600);
    expect(line.net.minor).toBe(50_400);
    expect(line.raw.Description).toBe("Hotel Chelsea, departure");
  });

  it("reports a re-import of the same file rather than duplicating money", async () => {
    const finance = await clientFor("finance");
    const { reference } = await dispatchedSubmission("DUPFILE");
    const csv = csvFor(reference);

    const first = await importStatement({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      filename: "same.csv",
      csv,
    });
    imports.push(first.importId);

    const second = await importStatement({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      filename: "same-renamed.csv",
      csv,
    });

    expect(second.duplicate).toBe(true);
    expect(second.importId).toBe(first.importId);

    const statements = await listStatementImports(ORG_A, finance);
    expect(statements.filter((entry) => entry.id === first.importId)).toHaveLength(1);
  });

  it("refuses to rewrite an imported line", async () => {
    const finance = await clientFor("finance");
    const { reference } = await dispatchedSubmission("NOREWRITE");
    const result = await importStatement({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      filename: "norewrite.csv",
      csv: csvFor(reference),
    });
    imports.push(result.importId);

    const { error } = await serviceClient()
      .from("statement_lines")
      .update({ gross_minor: 1 })
      .eq("statement_import_id", result.importId);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/cannot be rewritten/i);
  });

  it("confirms a line into a payment and an allocation", async () => {
    const finance = await clientFor("finance");
    const { reference, submissionId } = await dispatchedSubmission("CONFIRM");

    const result = await importStatement({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      buyerId: BACKGRID,
      filename: "confirm.csv",
      csv: csvFor(reference),
    });
    imports.push(result.importId);

    const statements = await listStatementImports(ORG_A, finance);
    const line = statements
      .find((entry) => entry.id === result.importId)!
      .lines.find((entry) => entry.externalReference === reference)!;

    const { paymentId } = await confirmStatementLine({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      lineId: line.id,
    });
    payments.push(paymentId);

    const service = serviceClient();
    const { data: payment } = await service
      .from("payments")
      .select("gross_minor, deductions_minor, net_minor, source")
      .eq("id", paymentId)
      .single();
    expect(Number(payment!.gross_minor)).toBe(84_000);
    expect(Number(payment!.deductions_minor)).toBe(33_600);
    expect(Number(payment!.net_minor)).toBe(50_400);
    expect(payment!.source).toBe("statement");

    const { data: allocations } = await service
      .from("payment_allocations")
      .select("submission_id, allocated_minor")
      .eq("payment_id", paymentId);
    expect(allocations).toHaveLength(1);
    expect(allocations![0].submission_id).toBe(submissionId);
    // The allocation divides the NET that arrived, not the gross.
    expect(Number(allocations![0].allocated_minor)).toBe(50_400);
  });

  it("refuses to confirm the same line twice", async () => {
    const finance = await clientFor("finance");
    const { reference } = await dispatchedSubmission("TWICE");
    const result = await importStatement({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      filename: "twice.csv",
      csv: csvFor(reference),
    });
    imports.push(result.importId);

    const statements = await listStatementImports(ORG_A, finance);
    const line = statements
      .find((entry) => entry.id === result.importId)!
      .lines.find((entry) => entry.externalReference === reference)!;

    const { paymentId } = await confirmStatementLine({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      lineId: line.id,
    });
    payments.push(paymentId);

    await expect(
      confirmStatementLine({
        client: finance,
        organizationId: ORG_A,
        actorId: FINANCE,
        lineId: line.id,
      }),
    ).rejects.toThrow(/already been reconciled/i);
  });

  it("refuses to confirm a line that is not attributed to anything", async () => {
    const finance = await clientFor("finance");
    const { reference } = await dispatchedSubmission("UNATTRIBUTED");
    const result = await importStatement({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      filename: "unattributed.csv",
      csv: csvFor(reference),
    });
    imports.push(result.importId);

    const statements = await listStatementImports(ORG_A, finance);
    const line = statements
      .find((entry) => entry.id === result.importId)!
      .lines.find((entry) => entry.externalReference === "UNKNOWN-1")!;

    await expect(
      confirmStatementLine({
        client: finance,
        organizationId: ORG_A,
        actorId: FINANCE,
        lineId: line.id,
      }),
    ).rejects.toThrow(/before confirming/i);
  });

  it("lets a person attribute an unmatched line by hand", async () => {
    const finance = await clientFor("finance");
    const { reference, submissionId } = await dispatchedSubmission("BYHAND");
    const result = await importStatement({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      filename: "byhand.csv",
      csv: csvFor(reference),
    });
    imports.push(result.importId);

    const statements = await listStatementImports(ORG_A, finance);
    const line = statements
      .find((entry) => entry.id === result.importId)!
      .lines.find((entry) => entry.externalReference === "UNKNOWN-1")!;

    await updateStatementLine({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      lineId: line.id,
      matchedSubmissionId: submissionId,
      matchStatus: "suggested",
    });

    const { paymentId } = await confirmStatementLine({
      client: finance,
      organizationId: ORG_A,
      actorId: FINANCE,
      lineId: line.id,
    });
    payments.push(paymentId);

    const { data: allocation } = await serviceClient()
      .from("payment_allocations")
      .select("submission_id")
      .eq("payment_id", paymentId)
      .single();
    expect(allocation!.submission_id).toBe(submissionId);
  });

  it("keeps statements away from roles that cannot see money", async () => {
    const editor = await clientFor("editor");
    const { reference } = await dispatchedSubmission("EDITORSTMT");

    await expect(
      importStatement({
        client: editor,
        organizationId: ORG_A,
        actorId: EDITOR,
        filename: "editor.csv",
        csv: csvFor(reference),
      }),
    ).rejects.toThrow();

    const { data } = await editor.from("statement_lines").select("id");
    expect(data ?? []).toHaveLength(0);
  });
});

describeIf("workspace export", () => {
  it("produces every file, with real records in it", async () => {
    const owner = await clientFor("owner");
    const files = await collectExport(ORG_A, "Marcus Hale Studio", owner);

    const names = files.map((file) => file.name);
    expect(names).toContain("assets.csv");
    expect(names).toContain("payments.csv");
    expect(names).toContain("activity.csv");

    const assets = files.find((file) => file.name === "assets.csv")!;
    const rows = parseCsv(assets.body);
    // Header plus at least the seeded assets.
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]).toContain("sha256" in rows[0] ? "sha256" : "asset_id");
  });

  it("carries the file digest so an original can be verified outside Mastline", async () => {
    const owner = await clientFor("owner");
    const files = await collectExport(ORG_A, "Marcus Hale Studio", owner);
    const versions = files.find((file) => file.name === "asset_versions.csv")!;
    const rows = parseCsv(versions.body);
    const shaColumn = rows[0].indexOf("sha256");
    expect(shaColumn).toBeGreaterThan(-1);
    expect(rows[1][shaColumn]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("never contains a confidential source note", async () => {
    const owner = await clientFor("owner");
    const files = await collectExport(ORG_A, "Marcus Hale Studio", owner);
    const everything = files.map((file) => file.body).join("\n");
    expect(everything).not.toMatch(/Tip from hotel staff/i);
    expect(everything).not.toMatch(/Northline confidential/i);
  });

  it("contains nothing from another workspace", async () => {
    const owner = await clientFor("owner");
    const files = await collectExport(ORG_A, "Marcus Hale Studio", owner);
    const everything = files.map((file) => file.body).join("\n");
    expect(everything).not.toMatch(/Northline/i);
    expect(everything).not.toContain("bbbbbbbb-0000-0000-0000-000000000002");
  });
});
