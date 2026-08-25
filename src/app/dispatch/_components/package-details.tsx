"use client";

import { useActionState } from "react";
import { Field } from "@/components/primitives";
import { type DispatchState, updatePackageAction } from "../actions";

const INITIAL: DispatchState = {};

export function PackageDetails({
  packageId,
  buyers,
  buyerId,
  deliveryMethod,
  proposedTerms,
  restrictions,
  packageNote,
  editable,
}: {
  packageId: string;
  buyers: readonly { id: string; name: string; deliveryProfile?: string }[];
  buyerId?: string;
  deliveryMethod?: string;
  proposedTerms?: string;
  restrictions?: string;
  packageNote?: string;
  editable: boolean;
}) {
  const [state, formAction, pending] = useActionState(updatePackageAction, INITIAL);

  if (!editable) {
    return (
      <div className="panel-body">
        <p className="section-note">
          This package has been dispatched. Its terms are part of the commercial record and can no
          longer be edited.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="panel-body">
      <input name="packageId" type="hidden" value={packageId} />

      <Field control="select" defaultValue={buyerId ?? ""} label="Buyer" name="buyerId">
        <option value="">Choose a buyer…</option>
        {buyers.map((buyer) => (
          <option key={buyer.id} value={buyer.id}>
            {buyer.name}
          </option>
        ))}
      </Field>
      <div className="spacer" />
      <Field
        defaultValue={deliveryMethod ?? ""}
        hint="How this package reaches the buyer today, e.g. SFTP or their portal."
        label="Delivery route"
        name="deliveryMethod"
      />
      <div className="spacer" />
      <Field
        control="textarea"
        defaultValue={proposedTerms ?? ""}
        hint="Frozen onto the submission at dispatch."
        label="Proposed terms"
        name="proposedTerms"
      />
      <div className="spacer" />
      <Field
        control="textarea"
        defaultValue={restrictions ?? ""}
        label="Usage restrictions"
        name="restrictions"
      />
      <div className="spacer" />
      <Field
        control="textarea"
        defaultValue={packageNote ?? ""}
        label="Package note"
        name="packageNote"
      />

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="inspector-saved" role="status">
          {state.message}
        </p>
      )}

      <div className="spacer" />
      <button className="button" disabled={pending} type="submit">
        {pending ? "Saving…" : "Save package"}
      </button>
    </form>
  );
}
