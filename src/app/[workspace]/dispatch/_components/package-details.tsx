"use client";

import { useActionState } from "react";
import { BuyerSelect } from "@/components/buyer-select";
import { Field } from "@/components/primitives";
import { type DispatchState, updatePackageAction } from "../actions";

const INITIAL: DispatchState = {};

export function PackageDetails({
  workspaceSlug,
  packageId,
  buyers,
  buyerId,
  deliveryMethod,
  proposedTerms,
  restrictions,
  packageNote,
  editable,
}: {
  workspaceSlug: string;
  packageId: string;
  buyers: readonly { id: string; name: string; deliveryProfile?: string }[];
  buyerId?: string;
  deliveryMethod?: string;
  proposedTerms?: string;
  restrictions?: string;
  packageNote?: string;
  editable: boolean;
}) {
  const [state, formAction, pending] = useActionState(updatePackageAction.bind(null, workspaceSlug), INITIAL);

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

      <BuyerSelect workspaceSlug={workspaceSlug} buyers={buyers} defaultValue={buyerId ?? ""} />
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
