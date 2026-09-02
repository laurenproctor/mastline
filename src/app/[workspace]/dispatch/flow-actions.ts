"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPrivateDeliveryLink, markDeliveryShared } from "@/lib/data/delivery-links";
import { getPackage, updatePackage } from "@/lib/data/packages";
import {
  approvePackageAndCreateSubmission,
  getSubmissionForPackage,
  setSubmissionFollowUp,
} from "@/lib/data/submissions";
import { listAssets } from "@/lib/data/assets";
import { listWorkspaceBuyers } from "@/lib/data/workspace";
import { DEFAULT_DELIVERY_WINDOW, isDeliveryWindow } from "@/lib/delivery";
import { reviewDispatch } from "@/lib/dispatch-rules";
import { requireWorkspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";
import type { DispatchState } from "./actions";

/**
 * The recipient stage's facts, split by where they belong.
 *
 * The potential buyer, the terms, and the restrictions are package facts and
 * are saved to the package -- the delivery method is recorded as the private
 * link, because that is the route this flow delivers by. The per-link access
 * options (expiry, note, full-resolution, acceptance gate) describe a link
 * that does not exist yet, so they travel to the review stage in the URL and
 * become columns only when the delivery is created. An internal, authenticated
 * URL: the public delivery link never carries any of this.
 */
export async function saveRecipientStageAction(
  workspaceSlug: string,
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const packageId = String(formData.get("packageId") ?? "");
  const shootId = String(formData.get("shootId") ?? "");
  const buyerId = String(formData.get("buyerId") ?? "") || null;
  const proposedTerms = String(formData.get("proposedTerms") ?? "").trim();
  const restrictions = String(formData.get("restrictions") ?? "").trim();
  const recipientLabel = String(formData.get("recipientLabel") ?? "")
    .trim()
    .slice(0, 120);
  const contactReference = String(formData.get("contactReference") ?? "")
    .trim()
    .slice(0, 200);
  const windowDays = Number(formData.get("windowDays") ?? DEFAULT_DELIVERY_WINDOW);
  const deliveryNote = String(formData.get("deliveryNote") ?? "")
    .trim()
    .slice(0, 500);
  const allowFullResolution = formData.get("allowFullResolution") === "on";
  const requireAcceptanceToView = formData.get("requireAcceptanceToView") === "on";

  if (!buyerId) return { error: "Choose a potential buyer for this delivery." };
  if (!proposedTerms) return { error: "Record the terms this package is offered under." };
  if (!isDeliveryWindow(windowDays)) {
    return { error: "Choose how long the link should stay open." };
  }

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "package.write",
  );

  try {
    await updatePackage({
      organizationId,
      actorId,
      packageId,
      patch: {
        buyerId,
        proposedTerms,
        restrictions,
        deliveryMethod: "Private delivery link",
      },
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the recipient." };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.dispatch({ shootId }));
  redirect(
    routes.dispatch(
      { shootId, packageId },
      {
        query: {
          stage: "review",
          to: recipientLabel || undefined,
          contact: contactReference || undefined,
          expires: windowDays,
          fullres: allowFullResolution ? "1" : "0",
          gate: requireAcceptanceToView ? "1" : "0",
          note: deliveryNote || undefined,
        },
      },
    ),
  );
}

/**
 * Create the private delivery: the one confirmed act of the flow.
 *
 * Two existing system facts, kept distinct and performed in order: the
 * package is approved (frozen into an immutable submission) if it was not
 * already, and one tracked recipient link is created. Nothing is shared, and
 * nothing leaves Mastline: sharing stays its own deliberate act.
 *
 * Safe to retry at any point of failure. Approval is transactional in the
 * database and refuses to run twice; a retry that finds the package already
 * approved resumes by locating its submission. The link is addressed
 * deterministically (createPrivateDeliveryLink), so a double-click or a
 * repeat lands on the link already made rather than minting a second one.
 */
export async function createPrivateDeliveryAction(
  workspaceSlug: string,
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const packageId = String(formData.get("packageId") ?? "");
  const shootId = String(formData.get("shootId") ?? "");
  const confirmed = formData.get("confirmed") === "yes";
  const recipientLabel = String(formData.get("recipientLabel") ?? "")
    .trim()
    .slice(0, 120);
  const contactReference = String(formData.get("contactReference") ?? "")
    .trim()
    .slice(0, 200);
  const windowDays = Number(formData.get("windowDays") ?? DEFAULT_DELIVERY_WINDOW);
  const deliveryNote = String(formData.get("deliveryNote") ?? "")
    .trim()
    .slice(0, 500);
  const allowFullResolution = formData.get("allowFullResolution") !== "0";
  const requireAcceptanceToView = formData.get("requireAcceptanceToView") === "1";

  if (!confirmed) {
    return { error: "Creating the delivery needs an explicit confirmation." };
  }
  if (!isDeliveryWindow(windowDays)) {
    return { error: "Choose how long the link should stay open." };
  }

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "submission.send",
  );

  const pkg = await getPackage(organizationId, packageId);
  if (!pkg) return { error: "That package could not be found." };

  let approvedNow = false;
  if (!pkg.approvedAt) {
    // The last gate re-runs the checks; the page that rendered the button may
    // be stale.
    const [assets, buyers] = await Promise.all([
      listAssets(organizationId, { shootId: pkg.shootId }),
      listWorkspaceBuyers(organizationId),
    ]);
    const buyer = buyers.find((candidate) => candidate.id === pkg.buyerId) ?? null;
    const review = reviewDispatch({ pkg, assets, buyer });
    if (!review.isApprovable) {
      return {
        error: `Not ready: ${review.blocking.map((check) => check.title.toLowerCase()).join(", ")}.`,
      };
    }

    try {
      await approvePackageAndCreateSubmission({
        organizationId,
        actorId,
        packageId,
        recipientLabel: recipientLabel || undefined,
      });
      approvedNow = true;
    } catch (error) {
      // A concurrent create may have approved between our read and this call.
      // If the package is approved now, the delivery continues; anything else
      // is a real failure.
      const fresh = await getPackage(organizationId, packageId);
      if (!fresh?.approvedAt) {
        return {
          error: error instanceof Error ? error.message : "Could not approve the package.",
        };
      }
    }
  }

  const submission = await getSubmissionForPackage(organizationId, packageId);
  if (!submission) {
    return { error: "The approval did not record a submission. Try again." };
  }

  let deliveryId: string;
  try {
    const { link } = await createPrivateDeliveryLink({
      organizationId,
      actorId,
      submissionId: submission.id,
      recipientLabel: recipientLabel || undefined,
      contactReference: contactReference || undefined,
      windowDays,
      deliveryNote: deliveryNote || undefined,
      allowFullResolution,
      requireAcceptanceToView,
    });
    deliveryId = link.id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `${approvedNow ? "The package was approved and frozen, but the link failed: " : ""}${error.message}`
          : "Could not create the link.",
    };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.submissions());
  revalidatePath(routes.work());
  revalidatePath(routes.shoot(shootId || pkg.shootId));
  redirect(
    routes.dispatch(
      { shootId: shootId || pkg.shootId, packageId },
      { query: { stage: "review", link: deliveryId } },
    ),
  );
}

/**
 * Mark the flow's link as shared, from the flow.
 *
 * The same idempotent, role-checked database act the submission screen uses;
 * only the destination differs -- back into the flow, at the Shared stage.
 * Copying the link never reaches here.
 */
export async function markFlowSharedAction(
  workspaceSlug: string,
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const shootId = String(formData.get("shootId") ?? "");
  const packageId = String(formData.get("packageId") ?? "");
  const submissionId = String(formData.get("submissionId") ?? "");
  const deliveryId = String(formData.get("deliveryId") ?? "");
  if (!submissionId || !deliveryId) return { error: "Start again from the review." };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "submission.send",
  );

  try {
    await markDeliveryShared({ organizationId, actorId, submissionId, deliveryId });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not record the share." };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.submissions());
  revalidatePath(routes.work());
  redirect(routes.dispatch({ shootId, packageId }, { query: { stage: "shared" } }));
}

/**
 * Set or clear the follow-up reminder from the Shared stage.
 *
 * The reminder is the photographer's own attention, not delivery evidence, so
 * it stays editable after the snapshot froze and lands back on the stage that
 * asked for it.
 */
export async function setFlowFollowUpAction(
  workspaceSlug: string,
  _previous: DispatchState,
  formData: FormData,
): Promise<DispatchState> {
  const shootId = String(formData.get("shootId") ?? "");
  const packageId = String(formData.get("packageId") ?? "");
  const submissionId = String(formData.get("submissionId") ?? "");
  const followUpRaw = String(formData.get("followUpAt") ?? "").trim();
  if (!submissionId) return { error: "Start again from the delivery." };

  let followUpAt: string | null = null;
  if (followUpRaw) {
    const parsed = new Date(followUpRaw);
    if (Number.isNaN(parsed.getTime())) return { error: "That date could not be read." };
    followUpAt = parsed.toISOString();
  }

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "submission.send",
  );

  try {
    await setSubmissionFollowUp({ organizationId, actorId, submissionId, followUpAt });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not set the follow-up." };
  }

  const routes = workspaceRoutes(canonicalSlug);
  revalidatePath(routes.submission(submissionId));
  revalidatePath(routes.work());
  redirect(routes.dispatch({ shootId, packageId }, { query: { stage: "shared" } }));
}
