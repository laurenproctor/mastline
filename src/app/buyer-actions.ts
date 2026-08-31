"use server";

import { revalidatePath } from "next/cache";
import { parseNewBuyer } from "@/lib/buyer";
import { createBuyer } from "@/lib/data/buyers";
import { requireWorkspaceContext } from "@/lib/session-context";
import { workspaceRoutes } from "@/lib/workspace-routes";

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

export async function createBuyerAction(
  workspaceSlug: string,
  input: {
    name: string;
    buyerType: string;
    contactName?: string;
    contactEmail?: string;
  },
): Promise<CreateBuyerResult> {
  const parsed = parseNewBuyer(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { organizationId, actorId, canonicalSlug } = await requireWorkspaceContext(
    workspaceSlug,
    "buyer.write",
  );

  try {
    const buyer = await createBuyer({ organizationId, actorId, buyer: parsed.value });

    /*
     * The buyer appears in pickers on every one of these screens, and in the
     * settings list of buyer templates.
     *
     * These were unscoped -- "/money", "/settings" -- which are not paths any
     * route serves any more, so the revalidation landed nowhere and the new
     * buyer did not appear until the next full load. They are scoped to the
     * workspace the buyer was actually created in.
     */
    const routes = workspaceRoutes(canonicalSlug);
    for (const path of [
      routes.newShoot(),
      routes.money(),
      routes.settings(),
      routes.submissions(),
    ]) {
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
