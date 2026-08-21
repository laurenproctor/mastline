import type { SupabaseClient } from "@supabase/supabase-js";
import type { Id } from "../domain";
import { type Money, money } from "../money";
import {
  type MatchCandidate,
  type ParsedStatement,
  matchLines,
  parseStatement,
} from "../statement-import";
import { createClient } from "../supabase/server";
import { recordEventWith } from "./activity";

/**
 * Importing and reconciling an agency statement.
 *
 * The import is the file. Its lines are what the agency claims. Confirming a
 * line produces a payment and an allocation; the line keeps the original claim
 * so a disagreement stays visible rather than being edited away.
 */

export interface StatementLine {
  readonly id: Id;
  readonly lineNumber: number;
  readonly externalReference?: string;
  readonly description?: string;
  readonly gross: Money;
  readonly deductions: Money;
  readonly net: Money;
  readonly matchStatus: "unmatched" | "suggested" | "matched" | "ignored" | "disputed";
  readonly matchBasis?: string;
  readonly matchedSubmissionId?: Id;
  readonly matchedLicenseId?: Id;
  readonly paymentId?: Id;
  readonly raw: Record<string, string>;
}

export interface StatementImport {
  readonly id: Id;
  readonly filename: string;
  readonly buyerId?: Id;
  readonly rowCount: number;
  readonly createdAt: string;
  readonly lines: readonly StatementLine[];
}

async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Submissions and licences a statement line could plausibly refer to. */
export async function loadMatchCandidates(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<readonly MatchCandidate[]> {
  const supabase = client ?? (await createClient());

  const [{ data: submissions }, { data: licenses }] = await Promise.all([
    supabase
      .from("submissions")
      .select("id, external_reference, buyers(name)")
      .eq("organization_id", organizationId)
      .not("external_reference", "is", null),
    supabase
      .from("licenses")
      .select("id, licensee_name, sale_base_minor, currency, submission_id")
      .eq("organization_id", organizationId),
  ]);

  const candidates: MatchCandidate[] = [];

  for (const row of submissions ?? []) {
    const buyer = row.buyers as unknown as { name: string } | null;
    candidates.push({
      submissionId: row.id as string,
      reference: row.external_reference as string,
      label: `${row.external_reference}${buyer ? ` · ${buyer.name}` : ""}`,
    });
  }

  for (const row of licenses ?? []) {
    candidates.push({
      licenseId: row.id as string,
      submissionId: (row.submission_id as string | null) ?? undefined,
      reference: row.licensee_name as string,
      expected: money(Number(row.sale_base_minor), (row.currency as "USD") ?? "USD"),
      label: row.licensee_name as string,
    });
  }

  return candidates;
}

export interface ImportResult {
  readonly importId: Id;
  readonly rowCount: number;
  readonly matched: number;
  readonly suggested: number;
  readonly unmatched: number;
  readonly unreadable: number;
  readonly duplicate: boolean;
  readonly parsed: ParsedStatement;
}

/**
 * Import a statement file.
 *
 * Re-importing the same bytes is refused by the unique constraint on the
 * content digest and reported as a duplicate rather than an error: the operator
 * dragged the same file in twice, which is a mistake worth naming, not a
 * failure worth stopping for.
 *
 * Nothing is turned into money here. Matching produces suggestions; a person
 * confirms each one.
 */
export async function importStatement(input: {
  organizationId: Id;
  actorId: Id;
  buyerId?: Id;
  filename: string;
  csv: string;
  client?: SupabaseClient;
}): Promise<ImportResult> {
  const { organizationId, actorId, buyerId, filename, csv } = input;
  const supabase = input.client ?? (await createClient());

  const parsed = parseStatement(csv);
  if (parsed.lines.length === 0) {
    throw new Error("That file had no readable rows.");
  }

  const digest = await sha256Hex(csv);

  const { data: existing } = await supabase
    .from("statement_imports")
    .select("id, row_count")
    .eq("organization_id", organizationId)
    .eq("content_sha256", digest)
    .maybeSingle();

  if (existing) {
    return {
      importId: existing.id as string,
      rowCount: existing.row_count as number,
      matched: 0,
      suggested: 0,
      unmatched: 0,
      unreadable: parsed.unreadableCount,
      duplicate: true,
      parsed,
    };
  }

  const candidates = await loadMatchCandidates(organizationId, supabase);
  const matches = matchLines(parsed.lines, candidates);
  const matchByLine = new Map(matches.map((match) => [match.lineNumber, match]));

  const { data: created, error } = await supabase
    .from("statement_imports")
    .insert({
      organization_id: organizationId,
      buyer_id: buyerId ?? null,
      filename,
      content_sha256: digest,
      row_count: parsed.lines.length,
      currency: parsed.totalGross.currency,
      imported_by: actorId,
    })
    .select("id")
    .single();

  if (error || !created) throw new Error(`Could not record the import: ${error?.message}`);
  const importId = created.id as string;

  const rows = parsed.lines.map((line) => {
    const match = matchByLine.get(line.lineNumber);
    return {
      organization_id: organizationId,
      statement_import_id: importId,
      line_number: line.lineNumber,
      raw: line.raw,
      external_reference: line.externalReference ?? null,
      description: line.description ?? null,
      gross_minor: line.gross.minor,
      deductions_minor: line.deductions.minor,
      net_minor: line.net.minor,
      currency: line.gross.currency,
      // Even an exact reference match is only "suggested" here. Turning a
      // statement line into money is a human decision.
      match_status: match?.status === "unmatched" ? "unmatched" : "suggested",
      match_basis: [match?.basis, ...line.problems].filter(Boolean).join(" "),
      matched_submission_id: match?.candidate?.submissionId ?? null,
      matched_license_id: match?.candidate?.licenseId ?? null,
    };
  });

  const { error: lineError } = await supabase.from("statement_lines").insert(rows);
  if (lineError) {
    await supabase.from("statement_imports").delete().eq("id", importId);
    throw new Error(`Could not record the statement lines: ${lineError.message}`);
  }

  const counts = {
    matched: matches.filter((match) => match.status === "matched").length,
    suggested: matches.filter((match) => match.status === "suggested").length,
    unmatched: matches.filter((match) => match.status === "unmatched").length,
  };

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "statement_import",
    entityId: importId,
    action: "statement.imported",
    data: {
      summary: `Imported ${filename}: ${parsed.lines.length} lines, ${counts.unmatched} unmatched`,
      ...counts,
      row_count: parsed.lines.length,
    },
  });

  return {
    importId,
    rowCount: parsed.lines.length,
    ...counts,
    unreadable: parsed.unreadableCount,
    duplicate: false,
    parsed,
  };
}

export async function listStatementImports(
  organizationId: Id,
  client?: SupabaseClient,
): Promise<readonly StatementImport[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("statement_imports")
    .select(
      "id, filename, buyer_id, row_count, created_at, statement_lines(id, line_number, external_reference, description, gross_minor, deductions_minor, net_minor, currency, match_status, match_basis, matched_submission_id, matched_license_id, payment_id, raw)",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load statement imports: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    filename: row.filename as string,
    buyerId: (row.buyer_id as string | null) ?? undefined,
    rowCount: row.row_count as number,
    createdAt: row.created_at as string,
    lines: ((row.statement_lines ?? []) as Record<string, unknown>[])
      .map((line) => ({
        id: line.id as string,
        lineNumber: line.line_number as number,
        externalReference: (line.external_reference as string | null) ?? undefined,
        description: (line.description as string | null) ?? undefined,
        gross: money(Number(line.gross_minor), (line.currency as "USD") ?? "USD"),
        deductions: money(Number(line.deductions_minor), (line.currency as "USD") ?? "USD"),
        net: money(Number(line.net_minor), (line.currency as "USD") ?? "USD"),
        matchStatus: line.match_status as StatementLine["matchStatus"],
        matchBasis: (line.match_basis as string | null) ?? undefined,
        matchedSubmissionId: (line.matched_submission_id as string | null) ?? undefined,
        matchedLicenseId: (line.matched_license_id as string | null) ?? undefined,
        paymentId: (line.payment_id as string | null) ?? undefined,
        raw: (line.raw as Record<string, string>) ?? {},
      }))
      .sort((a, b) => a.lineNumber - b.lineNumber),
  }));
}

/**
 * Confirm a statement line, turning it into a payment and an allocation.
 *
 * Refuses a line that has already produced a payment, so confirming twice
 * cannot double-count the money.
 */
export async function confirmStatementLine(input: {
  organizationId: Id;
  actorId: Id;
  lineId: Id;
  client?: SupabaseClient;
}): Promise<{ paymentId: Id }> {
  const { organizationId, actorId, lineId } = input;
  const supabase = input.client ?? (await createClient());

  const { data: line, error } = await supabase
    .from("statement_lines")
    .select(
      "id, external_reference, description, gross_minor, deductions_minor, net_minor, currency, match_status, matched_submission_id, matched_license_id, payment_id, statement_imports(buyer_id)",
    )
    .eq("organization_id", organizationId)
    .eq("id", lineId)
    .maybeSingle();

  if (error) throw new Error(`Could not read the statement line: ${error.message}`);
  if (!line) throw new Error("That statement line could not be found in this workspace.");
  if (line.payment_id) {
    throw new Error("This line has already been reconciled into a payment.");
  }
  if (!line.matched_submission_id && !line.matched_license_id) {
    throw new Error("Attribute this line to a submission or licence before confirming it.");
  }

  const currency = (line.currency as "USD") ?? "USD";
  const parent = line.statement_imports as unknown as { buyer_id: string | null } | null;

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .insert({
      organization_id: organizationId,
      buyer_id: parent?.buyer_id ?? null,
      status: "received",
      source: "statement",
      external_reference: line.external_reference ?? `LINE-${lineId.slice(0, 8)}`,
      gross_minor: Number(line.gross_minor),
      deductions_minor: Number(line.deductions_minor),
      platform_fee_minor: 0,
      tax_minor: 0,
      net_minor: Number(line.net_minor),
      currency,
      received_at: new Date().toISOString(),
      statement_payload: { statement_line_id: lineId },
      created_by: actorId,
    })
    .select("id")
    .single();

  if (paymentError || !payment) {
    throw new Error(`Could not create the payment: ${paymentError?.message}`);
  }
  const paymentId = payment.id as string;

  const { error: allocationError } = await supabase.from("payment_allocations").insert({
    organization_id: organizationId,
    payment_id: paymentId,
    submission_id: line.matched_submission_id ?? null,
    license_id: line.matched_license_id ?? null,
    allocated_minor: Number(line.net_minor),
    currency,
    created_by: actorId,
  });

  if (allocationError) {
    await supabase.from("payments").delete().eq("id", paymentId);
    throw new Error(`Could not attribute the payment: ${allocationError.message}`);
  }

  const { error: updateError } = await supabase
    .from("statement_lines")
    .update({ match_status: "matched", payment_id: paymentId })
    .eq("organization_id", organizationId)
    .eq("id", lineId);

  if (updateError) throw new Error(`Could not mark the line reconciled: ${updateError.message}`);

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "payment",
    entityId: paymentId,
    action: "statement.line_confirmed",
    data: {
      summary: `Statement line reconciled: ${line.external_reference ?? lineId.slice(0, 8)}`,
      statement_line_id: lineId,
      net_minor: Number(line.net_minor),
    },
  });

  return { paymentId };
}

/** Set a line's attribution, or park it. Never rewrites the agency's figures. */
export async function updateStatementLine(input: {
  organizationId: Id;
  actorId: Id;
  lineId: Id;
  matchedSubmissionId?: Id | null;
  matchedLicenseId?: Id | null;
  matchStatus?: StatementLine["matchStatus"];
  client?: SupabaseClient;
}): Promise<void> {
  const { organizationId, lineId } = input;
  const supabase = input.client ?? (await createClient());

  const { error } = await supabase
    .from("statement_lines")
    .update({
      ...(input.matchedSubmissionId !== undefined
        ? { matched_submission_id: input.matchedSubmissionId }
        : {}),
      ...(input.matchedLicenseId !== undefined
        ? { matched_license_id: input.matchedLicenseId }
        : {}),
      ...(input.matchStatus ? { match_status: input.matchStatus } : {}),
      match_basis: "Set by hand",
    })
    .eq("organization_id", organizationId)
    .eq("id", lineId);

  if (error) throw new Error(`Could not update the statement line: ${error.message}`);
}
