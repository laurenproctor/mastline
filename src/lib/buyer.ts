/**
 * What a buyer entered inline has to look like.
 *
 * Pure and free of any database import, so the rules can be tested without one
 * and so the same shapes are usable from a client component. The write itself
 * lives in src/lib/data/buyers.ts.
 */

import type { BuyerType, Id } from "./domain";

export const BUYER_TYPES: readonly BuyerType[] = [
  "agency",
  "publisher",
  "picture_desk",
  "direct_licensee",
  "other",
];

export const MAX_BUYER_NAME = 160;

export interface NewBuyer {
  readonly name: string;
  readonly buyerType: BuyerType;
  readonly contactName?: string;
  readonly contactEmail?: string;
}

export interface CreatedBuyer {
  readonly id: Id;
  readonly name: string;
  readonly buyerType: BuyerType;
  /** True when the name already existed and that record was returned instead. */
  readonly existed: boolean;
}

/** Validate a buyer entered inline. Separated so it can be tested without a database. */
export function parseNewBuyer(input: {
  name?: string | null;
  buyerType?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
}): { ok: true; value: NewBuyer } | { ok: false; error: string } {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Give the buyer a name." };
  if (name.length > MAX_BUYER_NAME) {
    return { ok: false, error: `Keep the name under ${MAX_BUYER_NAME} characters.` };
  }

  const typeRaw = (input.buyerType ?? "agency").trim();
  if (!BUYER_TYPES.includes(typeRaw as BuyerType)) {
    return { ok: false, error: "Choose what kind of buyer this is." };
  }

  const contactEmail = (input.contactEmail ?? "").trim();
  // Deliberately permissive: this is a desk address someone typed in a hurry,
  // not a credential. It is checked for shape, never verified by sending.
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { ok: false, error: "That email address could not be read." };
  }

  return {
    ok: true,
    value: {
      name,
      buyerType: typeRaw as BuyerType,
      contactName: (input.contactName ?? "").trim() || undefined,
      contactEmail: contactEmail || undefined,
    },
  };
}
