"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPackageFromSelection, updatePackage } from "@/lib/data/packages";
import { approveAndSend, recordSubmissionOutcome } from "@/lib/data/submissions";
import { getPackage } from "@/lib/data/packages";
import { listAssets } from "@/lib/data/assets";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { reviewDispatch } from "@/lib/dispatch-rules";
import { requireContext } from "@/lib/session-context";
import type { SubmissionStatus } from "@/lib/domain";

export interface DispatchState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly error?: string;
}

export async function buildPackageAction(
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const shootId = String(formData.get("shootId") ?? "");
  const buyerId = String(formData.get("buyerId") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim();

  const { organizationId, actorId } = await requireContext("package.write");

  let packageId: string;
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
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not build the package." };
  }

  revalidatePath(`/shoots/${shootId}`);
  redirect(`/dispatch/${packageId}`);
}

export async function updatePackageAction(
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const packageId = String(formData.get("packageId") ?? "");
  const { organizationId, actorId } = await requireContext("package.write");

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

  revalidatePath(`/dispatch/${packageId}`);
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
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const packageId = String(formData.get("packageId") ?? "");
  const confirmed = formData.get("confirmed") === "yes";

  if (!confirmed) {
    return { error: "Dispatch needs an explicit confirmation before anything is recorded." };
  }

  const { organizationId, actorId } = await requireContext("submission.send");

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

  revalidatePath("/submissions");
  revalidatePath("/work");
  revalidatePath(`/shoots/${pkg.shootId}`);
  redirect(`/submissions/${submissionId}`);
}

export async function recordOutcomeAction(
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const status = String(formData.get("status") ?? "") as SubmissionStatus;
  const outcomeNote = String(formData.get("outcomeNote") ?? "") || undefined;

  const { organizationId, actorId } = await requireContext("submission.send");

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

  revalidatePath(`/submissions/${submissionId}`);
  revalidatePath("/submissions");
  return { ok: true, message: "Outcome recorded. What was sent is unchanged." };
}
