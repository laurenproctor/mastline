"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/server";

export interface BuyerState {
  readonly ok?: boolean;
  readonly message?: string;
  readonly error?: string;
}

/**
 * Record a buyer's delivery requirements once.
 *
 * These become the defaults on every package built for that buyer, so the
 * operator confirms rather than retypes. Nothing here relaxes the baseline
 * metadata rules: a buyer profile is additive.
 */
export async function saveBuyerTemplateAction(
  _previous: BuyerState,
  formData: FormData,
): Promise<BuyerState> {
  const buyerId = String(formData.get("buyerId") ?? "");
  const termsDaysRaw = String(formData.get("paymentTermsDays") ?? "").trim();
  const termsDays = termsDaysRaw === "" ? null : Number(termsDaysRaw);

  if (termsDays !== null && (!Number.isInteger(termsDays) || termsDays < 0)) {
    return { error: "Payment terms must be a whole number of days." };
  }

  const { organizationId } = await requireContext("workspace.settings");
  const supabase = await createClient();

  const { error } = await supabase
    .from("buyers")
    .update({
      default_delivery_method: String(formData.get("defaultDeliveryMethod") ?? "") || null,
      default_terms: String(formData.get("defaultTerms") ?? "") || null,
      default_restrictions: String(formData.get("defaultRestrictions") ?? "") || null,
      contact_name: String(formData.get("contactName") ?? "") || null,
      payment_terms_days: termsDays,
    })
    .eq("organization_id", organizationId)
    .eq("id", buyerId);

  if (error) return { error: `Could not save the buyer: ${error.message}` };

  revalidatePath("/settings");
  return { ok: true, message: "Buyer template saved." };
}
