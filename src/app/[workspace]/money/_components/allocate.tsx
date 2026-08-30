"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { Field } from "@/components/field";
import { type MoneyActionState, allocatePaymentAction } from "../actions";

const INITIAL: MoneyActionState = {};

/** Attribute an unallocated remainder to the license or submission that earned it. */
export function AllocateForm({
  workspaceSlug,
  paymentId,
  reference,
  remainingMajor,
  licenses,
  submissions,
}: {
  workspaceSlug: string;
  paymentId: string;
  reference: string;
  remainingMajor: number;
  licenses: readonly { id: string; label: string }[];
  submissions: readonly { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    allocatePaymentAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm" variant="secondary">
        Match
      </Button>
    );
  }

  return (
    <form action={formAction} className="allocate-form ml-stack">
      <input name="paymentId" type="hidden" value={paymentId} />
      <p className="ml-caption">
        {reference} · ${remainingMajor.toFixed(2)} unattributed
      </p>

      <Field control="select" idSuffix={paymentId} label="Attribute to a license" name="licenseId">
        <option value="">Not a license</option>
        {licenses.map((license) => (
          <option key={license.id} value={license.id}>
            {license.label}
          </option>
        ))}
      </Field>
      <Field control="select" idSuffix={paymentId} label="Or a submission" name="submissionId">
        <option value="">Not a submission</option>
        {submissions.map((submission) => (
          <option key={submission.id} value={submission.id}>
            {submission.label}
          </option>
        ))}
      </Field>
      <Field
        defaultValue={remainingMajor.toFixed(2)}
        idSuffix={paymentId}
        inputMode="decimal"
        label="Amount"
        name="amount"
        required
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

      <div className="ml-cluster">
        <Button disabled={pending} size="sm" type="submit">
          {pending ? "Attributing…" : "Attribute"}
        </Button>
        <Button onClick={() => setOpen(false)} size="sm" variant="secondary">
          Cancel
        </Button>
      </div>
    </form>
  );
}
