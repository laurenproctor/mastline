import { NextResponse } from "next/server";
import { collectExport } from "@/lib/data/export";
import { csvCell } from "@/lib/export";
import { PermissionError } from "@/lib/permissions";
import { requireContext } from "@/lib/session-context";

/**
 * Download the workspace as CSV.
 *
 * Streamed as one multi-part text file rather than a zip, so it needs no
 * archiving dependency and stays readable in a terminal. Each embedded file is
 * introduced by a `=== filename ===` line.
 *
 * Gated on export.workspace rather than payment.read. An editor can read a
 * payment screen; taking the entire commercial record away in one file is a
 * different act, and docs/DATA_MODEL.md puts exports with finance.
 */
export async function GET() {
  let session;
  let organizationId: string;

  try {
    ({ session, organizationId } = await requireContext("export.workspace"));
  } catch (error) {
    // A refusal is a 403 with an explanation, not a stack trace and a 500.
    if (error instanceof PermissionError) {
      return NextResponse.json(
        { error: "Your role cannot export the workspace. Ask an owner or finance." },
        { status: 403 },
      );
    }
    throw error;
  }

  const files = await collectExport(organizationId, session.activeWorkspace.name);

  const body = files.map((file) => `=== ${file.name} ===\n${file.body}`).join("\n");

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `mastline-${csvCell(session.activeWorkspace.slug)}-${stamp}.txt`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
