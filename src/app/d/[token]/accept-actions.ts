"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isDeliveryToken } from "@/lib/delivery";
import { acceptDelivery } from "@/lib/data/delivery-links";

export interface AcceptState {
  readonly error?: string;
}

/**
 * A picture desk agreeing to the terms.
 *
 * The only write on this surface a recipient can perform, and it is the one
 * that matters: it records who said yes, when, from where, and to exactly which
 * words, and it releases the full-resolution files.
 */
export async function acceptDeliveryAction(
  _previous: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("acceptedBy") ?? "").trim();

  if (!isDeliveryToken(token)) return { error: "This link is not open." };
  if (name.length < 2) return { error: "Enter a name, so the record says who accepted." };

  const acceptedAt = await acceptDelivery(token, name, await headers());
  if (!acceptedAt) return { error: "This link is not open." };

  redirect(`/d/${token}`);
}
