"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEFAULT_DELIVERY_WINDOW, isDeliveryWindow } from "@/lib/delivery";
import { normalizeDeliveryParameters, parameterPairsFromForm } from "@/lib/delivery-parameters";
import {
  createDelivery,
  markDeliveryShared,
  revokeDelivery,
  updateDeliveryAttribution,
} from "@/lib/data/delivery-links";
import { requireWorkspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";

export interface DeliveryState {
  readonly error?: string;
}

/**
 * Create a link for one recipient.
 *
 * Nothing is sent. The operator gets a link and passes it on themselves, which
 * keeps buyer communication among the things a person decides to do rather than
 * something the product does on their behalf.
 *
 * The recipient label and contact reference go into protected columns. They are
 * never rendered into the URL, because a query string ends up in browser
 * history, in a referrer header, and in every proxy log between here and the
 * desk -- which is no place for the name of a person or an internal contact id.
 * The attribution parameters, which carry none of that, do go in the URL.
 */
export async function createDeliveryAction(
  workspaceSlug: string,
  _previous: DeliveryState,
  formData: FormData,
): Promise<DeliveryState> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const recipientLabel = String(formData.get("recipientLabel") ?? "").trim();
  const contactReference = String(formData.get("contactReference") ?? "").trim();
  const windowDays = Number(formData.get("windowDays") ?? DEFAULT_DELIVERY_WINDOW);

  if (!submissionId) return { error: "Start again from the submission." };
  if (!isDeliveryWindow(windowDays)) return { error: "Choose how long the link should stay open." };
  if (contactReference.length > 200) {
    return { error: "That contact reference is too long." };
  }

  const parameters = normalizeDeliveryParameters(parameterPairsFromForm(formData));
  if (!parameters.ok) return { error: parameters.error };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "submission.send",
  );

  try {
    await createDelivery({
      organizationId,
      actorId,
      submissionId,
      recipientLabel: recipientLabel || undefined,
      contactReference: contactReference || undefined,
      customParameters: parameters.parameters,
      windowDays,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not create the link." };
  }

  redirect(workspaceRoutes(canonicalSlug).submission(submissionId, { query: { saved: "link" } }));
}

/**
 * Fix the recipient or attribution on a link that has not gone out yet.
 *
 * Available only while a link is live and unshared. Once the photographer has
 * recorded sharing it, what the desk was told is part of the record and the
 * database refuses to change it; the honest move at that point is to withdraw
 * the link and make another.
 */
export async function updateAttributionAction(
  workspaceSlug: string,
  _previous: DeliveryState,
  formData: FormData,
): Promise<DeliveryState> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const deliveryId = String(formData.get("deliveryId") ?? "");
  const recipientLabel = String(formData.get("recipientLabel") ?? "").trim();
  const contactReference = String(formData.get("contactReference") ?? "").trim();

  if (!submissionId || !deliveryId) return { error: "Start again from the submission." };
  if (contactReference.length > 200) return { error: "That contact reference is too long." };

  const parameters = normalizeDeliveryParameters(parameterPairsFromForm(formData));
  if (!parameters.ok) return { error: parameters.error };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "submission.send",
  );

  try {
    await updateDeliveryAttribution({
      organizationId,
      actorId,
      submissionId,
      deliveryId,
      recipientLabel: recipientLabel || undefined,
      contactReference: contactReference || undefined,
      customParameters: parameters.parameters,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not update the link." };
  }

  redirect(
    workspaceRoutes(canonicalSlug).submission(submissionId, { query: { saved: "link-updated" } }),
  );
}

/**
 * Record that the photographer passed a specific link on.
 *
 * The one deliberate act in this file. Copying a link to the clipboard does not
 * reach here and must not: a copy is the operator looking at a URL, and a share
 * is them telling Mastline it has left. Only the second is allowed to move the
 * submission to `sent`.
 *
 * The workspace is re-resolved from the URL and the link is re-checked against
 * this submission in this organization before anything happens, so a forged
 * delivery id cannot reach a link on somebody else's submission. The database
 * function behind it checks the caller's role in the link's own organization
 * again, and the composite foreign keys make the pairing unforgeable in the
 * first place.
 */
export async function markSharedAction(
  workspaceSlug: string,
  _previous: DeliveryState,
  formData: FormData,
): Promise<DeliveryState> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const deliveryId = String(formData.get("deliveryId") ?? "");
  if (!submissionId || !deliveryId) return { error: "Start again from the submission." };

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
  redirect(routes.submission(submissionId, { query: { saved: "link-shared" } }));
}

export async function revokeDeliveryAction(
  workspaceSlug: string,
  _previous: DeliveryState,
  formData: FormData,
): Promise<DeliveryState> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const deliveryId = String(formData.get("deliveryId") ?? "");
  if (!submissionId || !deliveryId) return { error: "Start again from the submission." };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "submission.send",
  );

  try {
    await revokeDelivery({ organizationId, actorId, submissionId, deliveryId });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not withdraw the link." };
  }

  redirect(
    workspaceRoutes(canonicalSlug).submission(submissionId, {
      query: { saved: "link-withdrawn" },
    }),
  );
}
