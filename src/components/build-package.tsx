"use client";

import { useActionState, useState } from "react";
import { BuyerSelect } from "@/components/buyer-select";
import { Field } from "@/components/primitives";
import { type DispatchState, buildPackageAction } from "@/app/dispatch/actions";

const INITIAL: DispatchState = {};

/**
 * Build a package from the frames currently selected on a shoot.
 *
 * Defaults come from the shoot brief and the buyer's recorded terms, so the
 * operator confirms rather than retypes.
 */
export function BuildPackage({
  shootId,
  shootTitle,
  buyers,
  suggestedBuyerId,
  readyCount,
  blockedCount,
}: {
  shootId: string;
  shootTitle: string;
  buyers: readonly {
    id: string;
    name: string;
    defaultTerms?: string;
    deliveryProfile?: string;
    defaultRestrictions?: string;
  }[];
  suggestedBuyerId?: string;
  readyCount: number;
  blockedCount: number;
}) {
  const [state, formAction, pending] = useActionState(buildPackageAction, INITIAL);
  const [open, setOpen] = useState(false);
  const [buyerId, setBuyerId] = useState(suggestedBuyerId ?? buyers[0]?.id ?? "");

  const buyer = buyers.find((candidate) => candidate.id === buyerId);
  const total = readyCount + blockedCount;

  if (!open) {
    return (
      <div className="side-card">
        <h3>{total === 0 ? "Nothing selected yet" : "Build a package"}</h3>
        <p>
          {total === 0
            ? "Select the frames worth sending first."
            : `${total} selected${blockedCount > 0 ? `, ${blockedCount} still missing required metadata` : ", all complete"}.`}
        </p>
        <button
          className="button blue"
          disabled={total === 0}
          onClick={() => setOpen(true)}
          type="button"
        >
          Build package
        </button>
        {blockedCount > 0 && (
          <p className="section-note">
            A package can be built now, but it cannot be dispatched until the missing metadata is
            filled in.
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="side-card">
      <input name="shootId" type="hidden" value={shootId} />

      <h3>Build a package</h3>
      <Field defaultValue={`${shootTitle} — Package`} label="Package name" name="name" required />
      <div className="spacer" />
      <BuyerSelect buyers={buyers} onChange={setBuyerId} required value={buyerId} />
      <div className="spacer" />
      <Field
        defaultValue={buyer?.deliveryProfile ?? ""}
        key={`delivery-${buyerId}`}
        label="Delivery route"
        name="deliveryMethod"
        placeholder="SFTP, portal upload, email…"
      />
      <div className="spacer" />
      <Field
        control="textarea"
        defaultValue={buyer?.defaultTerms ?? ""}
        key={`terms-${buyerId}`}
        label="Proposed terms"
        name="proposedTerms"
      />
      <div className="spacer" />
      <Field
        control="textarea"
        defaultValue={buyer?.defaultRestrictions ?? "Editorial use only. No commercial use."}
        key={`restrictions-${buyerId}`}
        label="Usage restrictions"
        name="restrictions"
      />
      <div className="spacer" />
      <Field control="textarea" label="Package note" name="packageNote" />

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="spacer" />
      <div className="actions">
        <button className="button blue" disabled={pending} type="submit">
          {pending ? "Building…" : "Build and review"}
        </button>
        <button className="button" disabled={pending} onClick={() => setOpen(false)} type="button">
          Cancel
        </button>
      </div>
      <p className="section-note">Nothing is sent yet. The next screen is the dispatch review.</p>
    </form>
  );
}
