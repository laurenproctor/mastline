"use server";

import { revalidatePath } from "next/cache";
import { confirmStatementLine, importStatement, updateStatementLine } from "@/lib/data/statements";
import { requireWorkspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";

export interface StatementState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly error?: string;
  readonly importId?: string;
}

export async function importStatementAction(
  workspaceSlug: string,
  _previous: StatementState,
  formData: FormData,
): Promise<StatementState> {
  const file = formData.get("statement");
  const buyerId = String(formData.get("buyerId") ?? "") || undefined;

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to import." };
  }
  if (file.size > 5_000_000) {
    return { error: "That file is larger than 5 MB. Split it and import in parts." };
  }

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "payment.write",
  );

  try {
    const csv = await file.text();
    const result = await importStatement({
      organizationId,
      actorId,
      buyerId,
      filename: file.name,
      csv,
    });

    revalidatePath(workspaceRoutes(canonicalSlug).money());

    if (result.duplicate) {
      return {
        ok: true,
        importId: result.importId,
        message: "This exact file has already been imported. Nothing was added.",
      };
    }

    const parts = [`${result.rowCount} lines read`];
    if (result.suggested > 0) parts.push(`${result.suggested} matched to a record`);
    if (result.unmatched > 0) parts.push(`${result.unmatched} need attention`);
    if (result.unreadable > 0) parts.push(`${result.unreadable} had no readable amount`);

    return { ok: true, importId: result.importId, message: `${parts.join(", ")}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not read that file." };
  }
}

export async function confirmStatementLineAction(
  workspaceSlug: string,
  _previous: StatementState,
  formData: FormData,
): Promise<StatementState> {
  const lineId = String(formData.get("lineId") ?? "");
  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "payment.write",
  );

  try {
    await confirmStatementLine({ organizationId, actorId, lineId });
    revalidatePath(workspaceRoutes(canonicalSlug).money());
    return { ok: true, message: "Reconciled into a payment." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not reconcile that line." };
  }
}

export async function updateStatementLineAction(
  workspaceSlug: string,
  _previous: StatementState,
  formData: FormData,
): Promise<StatementState> {
  const lineId = String(formData.get("lineId") ?? "");
  const submissionId = String(formData.get("matchedSubmissionId") ?? "") || null;
  const status = String(formData.get("matchStatus") ?? "") || undefined;

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "payment.write",
  );

  try {
    await updateStatementLine({
      organizationId,
      actorId,
      lineId,
      matchedSubmissionId: submissionId,
      matchStatus: status as "suggested" | "ignored" | "disputed" | undefined,
    });
    revalidatePath(workspaceRoutes(canonicalSlug).money());
    return { ok: true, message: "Line updated." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not update that line." };
  }
}
