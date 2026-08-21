"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/primitives";
import { type BuyerState, saveBuyerTemplateAction } from "../actions";

const INITIAL: BuyerState = {};

/**
 * A buyer's delivery requirements, recorded once.
 *
 * These become the defaults on every package built for this buyer. A buyer
 * profile is additive: it can ask for more than the baseline metadata rules,
 * never less.
 */
export function BuyerTemplate({
  buyer,
}: {
  buyer: {
    id: string;
    name: string;
    buyerType: string;
    contactName?: string;
    defaultDeliveryMethod?: string;
    defaultTerms?: string;
    defaultRestrictions?: string;
    paymentTermsDays?: number;
  };
}) {
  const [state, formAction, pending] = useActionState(saveBuyerTemplateAction, INITIAL);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="side-card">
        <h3>{buyer.name}</h3>
        <p>
          {buyer.defaultDeliveryMethod ?? "No delivery route recorded"}
          {buyer.paymentTermsDays !== undefined ? ` · pays in ${buyer.paymentTermsDays} days` : ""}
        </p>
        <button className="button small" onClick={() => setOpen(true)} type="button">
          Edit template
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="side-card">
      <input name="buyerId" type="hidden" value={buyer.id} />
      <h3>{buyer.name}</h3>

      <Field defaultValue={buyer.contactName ?? ""} label="Desk or contact" name="contactName" />
      <div className="spacer" />
      <Field
        defaultValue={buyer.defaultDeliveryMethod ?? ""}
        hint="Pre-fills the delivery route on every package for this buyer."
        label="Delivery route"
        name="defaultDeliveryMethod"
        placeholder="SFTP, portal upload, email…"
      />
      <div className="spacer" />
      <Field
        control="textarea"
        defaultValue={buyer.defaultTerms ?? ""}
        label="Default terms"
        name="defaultTerms"
      />
      <div className="spacer" />
      <Field
        control="textarea"
        defaultValue={buyer.defaultRestrictions ?? ""}
        label="Default restrictions"
        name="defaultRestrictions"
      />
      <div className="spacer" />
      <Field
        defaultValue={buyer.paymentTermsDays ?? ""}
        hint="Used to work out when a payment becomes overdue."
        inputMode="numeric"
        label="Pays within (days)"
        name="paymentTermsDays"
      />

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="spacer" />
      <div className="actions">
        <button className="button blue" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save"}
        </button>
        <button className="button" onClick={() => setOpen(false)} type="button">
          Close
        </button>
      </div>
    </form>
  );
}
