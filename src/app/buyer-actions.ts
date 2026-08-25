"use server";

import { revalidatePath } from "next/cache";
import { parseNewBuyer } from "@/lib/buyer";
import { createBuyer } from "@/lib/data/buyers";
import { requireContext } from "@/lib/session-context";

/**
 * Create a buyer from wherever the operator happens to be.
 *
 * Every screen that asks for a buyer can now record one, so a shoot brief, a
 * package, or a payment is never blocked by a counterparty that has not been
 * entered into settings yet. This is a record creation, not a communication:
 * nothing here contacts the buyer.
 *
 * The action returns the new id rather than redirecting, because the caller is
 * a picker sitting inside a larger form that must not be thrown away.
 */

export interface CreateBuyerResult {
  readonly ok: boolean;
  readonly id?: string;
  readonly name?: string;
  /** True when the name already existed and the existing buyer was returned. */
  readonly existed?: boolean;
  readonly error?: string;
}

export async function createBuyerAction(input: {
  name: string;
  buyerType: string;
  contactName?: string;
  contactEmail?: string;
}): Promise<CreateBuyerResult> {
  const parsed = parseNewBuyer(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { organizationId, actorId } = await requireContext("buyer.write");

  try {
    const buyer = await createBuyer({ organizationId, actorId, buyer: parsed.value });

    // The buyer appears in pickers on every one of these screens, and in the
    // settings list of buyer templates.
    for (const path of ["/shoots/new", "/dispatch", "/money", "/settings", "/submissions"]) {
      revalidatePath(path);
    }

    return { ok: true, id: buyer.id, name: buyer.name, existed: buyer.existed };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not add the buyer.",
    };
  }
}
