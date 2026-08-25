import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Buyer, BuyerType, Id } from "../domain";
import type { CreatedBuyer, NewBuyer } from "../buyer";
import { createClient } from "../supabase/server";
import { recordEventWith } from "./activity";

/**
 * Creating a counterparty.
 *
 * A buyer is entered wherever the work is: briefing a shoot, building a
 * package, recording a payment. Making the operator break off to visit settings
 * is how a sale ends up recorded against no one, which is precisely the gap
 * commercial memory exists to close.
 *
 * The name is the identity. `buyers` carries a unique constraint on
 * (organization_id, name), so a second attempt at a name already present
 * returns the existing record rather than a duplicate or an error -- the
 * operator meant "this buyer", not "a new row".
 */

export async function createBuyer(input: {
  organizationId: Id;
  actorId: Id;
  buyer: NewBuyer;
  client?: SupabaseClient;
}): Promise<CreatedBuyer> {
  const supabase = input.client ?? (await createClient());
  const { organizationId, actorId, buyer } = input;

  const { data, error } = await supabase
    .from("buyers")
    .insert({
      organization_id: organizationId,
      name: buyer.name,
      buyer_type: buyer.buyerType,
      contact_name: buyer.contactName ?? null,
      contact_email: buyer.contactEmail ?? null,
    })
    .select("id, name, buyer_type")
    .single();

  if (error) {
    // 23505 is the unique constraint on (organization_id, name). Somebody
    // typing a name that already exists means the existing buyer, so hand it
    // back rather than making them go and look for it.
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("buyers")
        .select("id, name, buyer_type")
        .eq("organization_id", organizationId)
        .eq("name", buyer.name)
        .maybeSingle();

      if (existing) {
        return {
          id: existing.id as string,
          name: existing.name as string,
          buyerType: existing.buyer_type as BuyerType,
          existed: true,
        };
      }
    }
    throw new Error(`Could not create the buyer: ${error.message}`);
  }

  const created: CreatedBuyer = {
    id: data.id as string,
    name: data.name as string,
    buyerType: data.buyer_type as BuyerType,
    existed: false,
  };

  await recordEventWith(supabase, {
    organizationId,
    actorId,
    entityType: "buyer",
    entityId: created.id,
    action: "buyer.created",
    data: { summary: `Added ${created.name} as a buyer`, buyer_type: created.buyerType },
  });

  return created;
}

/** The shape every buyer picker needs. Kept here so the pickers agree. */
export interface BuyerOption extends Pick<Buyer, "id" | "name"> {
  readonly deliveryProfile?: string;
  readonly defaultTerms?: string;
  readonly defaultRestrictions?: string;
}
