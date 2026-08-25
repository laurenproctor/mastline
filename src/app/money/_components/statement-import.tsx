"use client";

import { useActionState, useState } from "react";
import { Badge, Field } from "@/components/primitives";
import {
  type StatementState,
  confirmStatementLineAction,
  importStatementAction,
} from "../actions-statements";

const INITIAL: StatementState = {};

export function ImportStatement({ buyers }: { buyers: readonly { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(importStatementAction, INITIAL);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="side-card">
        <h3>Import a statement</h3>
        <p>
          Drop in an agency CSV. Mastline reads the common column names and matches each line
          against your submissions, then asks you to confirm.
        </p>
        <button className="button" onClick={() => setOpen(true)} type="button">
          Import statement
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="side-card">
      <h3>Import a statement</h3>

      <Field control="select" label="Buyer" name="buyerId">
        <option value="">Not linked to a buyer</option>
        {buyers.map((buyer) => (
          <option key={buyer.id} value={buyer.id}>
            {buyer.name}
          </option>
        ))}
      </Field>
      <div className="spacer" />
      <Field
        accept=".csv,text/csv"
        hint="Reference, gross, commission, and net are recognized under most common names."
        label="Statement CSV"
        name="statement"
        required
        type="file"
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
      <div className="actions">
        <button className="button blue" disabled={pending} type="submit">
          {pending ? "Reading…" : "Import"}
        </button>
        <button className="button" onClick={() => setOpen(false)} type="button">
          Close
        </button>
      </div>
      <p className="section-note">
        Importing reads the file and proposes matches. No money is recorded until you confirm each
        line.
      </p>
    </form>
  );
}

export function ConfirmLine({ lineId, disabled }: { lineId: string; disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(confirmStatementLineAction, INITIAL);

  if (state.ok) {
    return <Badge tone="good">Reconciled</Badge>;
  }

  return (
    <form action={formAction}>
      <input name="lineId" type="hidden" value={lineId} />
      <button className="button small blue" disabled={pending || disabled} type="submit">
        {pending ? "…" : "Confirm"}
      </button>
      {state.error && (
        <small className="field-error" role="alert">
          {state.error}
        </small>
      )}
    </form>
  );
}
