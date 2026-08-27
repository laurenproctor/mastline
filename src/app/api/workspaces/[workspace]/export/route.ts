import { NextResponse } from "next/server";
import { collectExport } from "@/lib/data/export";
import { csvCell } from "@/lib/export";
import { PermissionError } from "@/lib/permissions";
import { requireWorkspaceContext } from "@/lib/session-context";
import { requireUserSession } from "@/lib/auth";

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
 *
 * The workspace is named in the path. It used to be whatever the active-
 * workspace cookie pointed at, which meant the file you got depended on a
 * browser-wide setting rather than on what you asked for -- and a second tab
 * could change it between clicking and downloading.
 *
 * This is an API, so it answers like one. No HTML sign-in redirect: 401 when
 * there is no session, and 404 -- not 403 -- when the caller is not a member,
 * because whether a workspace exists is not a thing to confirm to somebody
 * outside it. 403 is kept for the one case it fits: a member whose role may
 * not export.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspace: string }> },
) {
  const { workspace } = await params;

  const user = await requireUserSession().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Sign in to export a workspace." }, { status: 401 });
  }
  if (!user.workspaces.some((candidate) => candidate.slug === workspace)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let session;
  let organizationId: string;

  try {
    ({ session, organizationId } = await requireWorkspaceContext(workspace, "export.workspace"));
  } catch (error) {
    // A refusal is a 403 with an explanation, not a stack trace and a 500.
    if (error instanceof PermissionError) {
      return NextResponse.json(
        { error: "This role cannot export the workspace. An owner or finance can." },
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
