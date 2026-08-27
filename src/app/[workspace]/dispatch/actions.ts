"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPackageFromSelection, updatePackage } from "@/lib/data/packages";
import { approveAndSend, recordSubmissionOutcome } from "@/lib/data/submissions";
import { getPackage } from "@/lib/data/packages";
import { listAssets } from "@/lib/data/assets";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { reviewDispatch } from "@/lib/dispatch-rules";
import { retryDelivery } from "@/lib/data/delivery";
import { requireWorkspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import type { SubmissionStatus } from "@/lib/domain";

export interface DispatchState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly error?: string;
}

export async function buildPackageAction(
  workspaceSlug: string,
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const shootId = String(formData.get("shootId") ?? "");
  const buyerId = String(formData.get("buyerId") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim();

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "package.write");

  let packageId: string;
  let createdOnShoot: string;
  try {
    const created = await createPackageFromSelection({
      organizationId,
      actorId,
      shootId,
      buyerId,
      name: name || "Package",
      deliveryMethod: String(formData.get("deliveryMethod") ?? "") || undefined,
      proposedTerms: String(formData.get("proposedTerms") ?? "") || undefined,
      restrictions: String(formData.get("restrictions") ?? "") || undefined,
      packageNote: String(formData.get("packageNote") ?? "") || undefined,
    });
    packageId = created.id;
    // The shoot the row actually landed on, not the one the form said. The
    // browser supplies shootId, and the dispatch review is addressed BY shoot,
    // so the destination is built from what the database stored.
    createdOnShoot = created.shootId;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not build the package." };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.shoot(createdOnShoot));

  /*
   * The route is /<workspace>/dispatch/<shootId>, and the package is chosen by
   * query. This redirected to /<workspace>/dispatch/<packageId>, which reads a
   * package id as a shoot id, finds no such shoot, and 404s -- so building a
   * package, the whole point of the screen before it, ended on the not-found
   * page. The package id belongs in `?package=`, which is what the review
   * screen already reads.
   */
  redirect(routes.dispatch({ shootId: createdOnShoot, packageId }));
}

export async function updatePackageAction(
  workspaceSlug: string,
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const packageId = String(formData.get("packageId") ?? "");
  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "package.write");

  try {
    await updatePackage({
      organizationId,
      actorId,
      packageId,
      patch: {
        buyerId: String(formData.get("buyerId") ?? "") || null,
        deliveryMethod: String(formData.get("deliveryMethod") ?? ""),
        proposedTerms: String(formData.get("proposedTerms") ?? ""),
        restrictions: String(formData.get("restrictions") ?? ""),
        packageNote: String(formData.get("packageNote") ?? ""),
      },
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the package." };
  }

  /*
   * Same confusion as the redirect above, with a quieter symptom: this
   * revalidated /<workspace>/dispatch/<packageId>, a path no route serves, so
   * the screen the operator was looking at was never actually revalidated. The
   * shoot is read back from the package rather than taken from the form.
   */
  const saved = await getPackage(organizationId, packageId);
  if (saved) {
    revalidatePath(workspaceRoutes(canonicalSlug).dispatch({ shootId: saved.shootId }));
  }
  return { ok: true, message: "Package saved." };
}

/**
 * Approve the package and record the dispatch.
 *
 * The form must carry an explicit confirmation, which the UI collects in a
 * separate step showing exactly what is about to leave. The dispatch review is
 * re-run here rather than trusted from the page that rendered the button: the
 * page may be stale, and this is the last gate.
 */
export async function approveAndSendAction(
  workspaceSlug: string,
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const packageId = String(formData.get("packageId") ?? "");
  const confirmed = formData.get("confirmed") === "yes";

  if (!confirmed) {
    return { error: "Dispatch needs an explicit confirmation before anything is recorded." };
  }

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "submission.send");

  const pkg = await getPackage(organizationId, packageId);
  if (!pkg) return { error: "That package could not be found." };

  const [assets, buyers] = await Promise.all([
    listAssets(organizationId, { shootId: pkg.shootId }),
    listWorkspaceBuyers(organizationId),
  ]);
  const buyer = buyers.find((candidate) => candidate.id === pkg.buyerId) ?? null;

  const review = reviewDispatch({ pkg, assets, buyer });
  if (!review.isApprovable) {
    return {
      error: `Dispatch is blocked: ${review.blocking.map((check) => check.title.toLowerCase()).join(", ")}.`,
    };
  }

  let submissionId: string;
  try {
    const sent = await approveAndSend({
      organizationId,
      actorId,
      packageId,
      recipientLabel: String(formData.get("recipientLabel") ?? "") || undefined,
      followUpAt: String(formData.get("followUpAt") ?? "") || undefined,
    });
    submissionId = sent.submissionId;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not record the dispatch." };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.submissions());
  revalidatePath(routes.work());
  revalidatePath(routes.shoot(pkg.shootId));
  revalidatePath(routes.dispatch({ shootId: pkg.shootId }));
  redirect(routes.submission(submissionId));
}

export async function recordOutcomeAction(
  workspaceSlug: string,
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const status = String(formData.get("status") ?? "") as SubmissionStatus;
  const outcomeNote = String(formData.get("outcomeNote") ?? "") || undefined;

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "submission.send");

  try {
    await recordSubmissionOutcome({
      organizationId,
      actorId,
      submissionId,
      status,
      outcomeNote,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not record the outcome." };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.submission(submissionId));
  revalidatePath(routes.submissions());
  return { ok: true, message: "Outcome recorded. What was sent is unchanged." };
}

/**
 * Retry a failed delivery.
 *
 * The submission snapshot is untouched: what goes out again is exactly what
 * went out before. Only a failed delivery can be retried, so this cannot
 * resend something that already arrived.
 */
export async function retryDeliveryAction(
  workspaceSlug: string,
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "submission.send");

  try {
    const { attemptNumber } = await retryDelivery({ organizationId, actorId, submissionId });
    const routes = workspaceRoutes(canonicalSlug);
    revalidatePath(routes.submission(submissionId));
    revalidatePath(routes.work());
    return { ok: true, message: `Attempt ${attemptNumber} recorded and queued.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not retry the delivery." };
  }
}
