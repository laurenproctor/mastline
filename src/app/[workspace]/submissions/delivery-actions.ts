"use server";

import { redirect } from "next/navigation";
import { DEFAULT_DELIVERY_WINDOW, isDeliveryWindow } from "@/lib/delivery";
import { createDelivery, revokeDelivery } from "@/lib/data/delivery-links";
import { requireWorkspaceContext } from "@/lib/session-context";

export interface DeliveryState {
  readonly error?: string;
}

/**
 * Create a link for a submission.
 *
 * Nothing is sent. The operator gets a link and passes it on themselves, which
 * keeps buyer communication among the things a person decides to do rather than
 * something the product does on their behalf.
 */
export async function createDeliveryAction(
  workspaceSlug: string,
  _previous: DeliveryState,
  formData: FormData,
): Promise<DeliveryState> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const recipientLabel = String(formData.get("recipientLabel") ?? "").trim();
  const windowDays = Number(formData.get("windowDays") ?? DEFAULT_DELIVERY_WINDOW);

  if (!submissionId) return { error: "Start again from the submission." };
  if (!isDeliveryWindow(windowDays)) return { error: "Choose how long the link should stay open." };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "submission.send");

  try {
    await createDelivery({
      organizationId,
      actorId,
      submissionId,
      recipientLabel: recipientLabel || undefined,
      windowDays,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not create the link." };
  }

  redirect(`/${canonicalSlug}/submissions/${submissionId}?saved=link`);
}

export async function revokeDeliveryAction(
  workspaceSlug: string,
  _previous: DeliveryState,
  formData: FormData,
): Promise<DeliveryState> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const deliveryId = String(formData.get("deliveryId") ?? "");
  if (!submissionId || !deliveryId) return { error: "Start again from the submission." };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(workspaceSlug, "submission.send");

  try {
    await revokeDelivery({ organizationId, actorId, submissionId, deliveryId });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not withdraw the link." };
  }

  redirect(`/${canonicalSlug}/submissions/${submissionId}?saved=link-withdrawn`);
}
