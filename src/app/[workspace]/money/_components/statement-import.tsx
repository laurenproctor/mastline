"use client";

import { useActionState, useState } from "react";
import { BuyerSelect } from "@/components/buyer-select";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { Field } from "@/components/field";
import {
  type StatementState,
  confirmStatementLineAction,
  importStatementAction,
} from "../actions-statements";

const INITIAL: StatementState = {};

export function ImportStatement({
  workspaceSlug,
  buyers,
}: {
  workspaceSlug: string;
  buyers: readonly { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    importStatementAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="ml-card ml-stack">
        <h3 className="ml-subtitle">Import a statement</h3>
        <p className="ml-body">
          Drop in an agency CSV. Mastline reads the common column names and matches each line
          against open submissions, then waits for a confirmation.
        </p>
        <p>
          <Button onClick={() => setOpen(true)} variant="secondary">
            Import statement
          </Button>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="ml-card ml-stack">
      <h3 className="ml-subtitle">Import a statement</h3>

      <BuyerSelect
        workspaceSlug={workspaceSlug}
        buyers={buyers}
        emptyLabel="Not linked to a buyer"
      />
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

      <div className="ml-cluster">
        <Button disabled={pending} type="submit">
          {pending ? "Reading…" : "Import"}
        </Button>
        <Button onClick={() => setOpen(false)} variant="secondary">
          Close
        </Button>
      </div>
      <p className="ml-caption">
        Importing reads the file and proposes matches. No money is recorded until a person confirms
        each line.
      </p>
    </form>
  );
}

export function ConfirmLine({
  workspaceSlug,
  lineId,
  disabled,
}: {
  workspaceSlug: string;
  lineId: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    confirmStatementLineAction.bind(null, workspaceSlug),
    INITIAL,
  );

  if (state.ok) {
    return <Badge tone="good">Reconciled</Badge>;
  }

  return (
    <form action={formAction}>
      <input name="lineId" type="hidden" value={lineId} />
      <Button disabled={pending || disabled} size="sm" type="submit">
        {pending ? "…" : "Confirm"}
      </Button>
      {state.error && (
        <small className="ml-error" role="alert">
          {state.error}
        </small>
      )}
    </form>
  );
}
