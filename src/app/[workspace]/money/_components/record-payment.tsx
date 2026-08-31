"use client";

import { useActionState, useState } from "react";
import { BuyerSelect } from "@/components/buyer-select";
import { Button } from "@/components/button";
import { Field } from "@/components/field";
import { type MoneyActionState, recordPaymentAction } from "../actions";

const INITIAL: MoneyActionState = {};

/**
 * Record a payment.
 *
 * Gross, deductions, the Sales Engine share, and tax are entered separately and
 * stay separately inspectable. Net is derived here and shown live, so the
 * operator sees what will actually land before committing.
 */
export function RecordPayment({
  workspaceSlug,
  buyers,
}: {
  workspaceSlug: string;
  buyers: readonly { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    recordPaymentAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState({ gross: "", deductions: "", platformFee: "", tax: "" });

  const num = (value: string) => {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const net =
    num(amounts.gross) - num(amounts.deductions) - num(amounts.platformFee) - num(amounts.tax);

  if (!open) {
    return (
      <div className="ml-card ml-stack">
        <h3 className="ml-subtitle">Record a payment</h3>
        <p className="ml-body">Log what a buyer actually paid, and what they deducted.</p>
        <p>
          <Button onClick={() => setOpen(true)} variant="secondary">
            Record payment
          </Button>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="ml-card ml-stack">
      <h3 className="ml-subtitle">Record a payment</h3>

      <BuyerSelect
        workspaceSlug={workspaceSlug}
        buyers={buyers}
        emptyLabel="Not linked to a buyer"
      />
      <Field label="Reference" name="reference" placeholder="BG-882341" />
      <Field control="select" defaultValue="statement" label="Source" name="source">
        <option value="statement">Agency statement</option>
        <option value="invoice">Invoice</option>
        <option value="checkout">Direct license</option>
        <option value="recovery">Rights recovery</option>
        <option value="manual">Manual entry</option>
      </Field>
      <Field control="select" defaultValue="received" label="Status" name="status">
        <option value="received">Received</option>
        <option value="invoiced">Invoiced</option>
        <option value="expected">Expected</option>
        <option value="reported">Reported on a statement</option>
      </Field>

      <Field
        inputMode="decimal"
        label="Gross"
        name="gross"
        onChange={(event) => setAmounts({ ...amounts, gross: event.target.value })}
        placeholder="3900"
        required
        value={amounts.gross}
      />
      <Field
        hint="Agency commission and anything else withheld."
        inputMode="decimal"
        label="Deductions"
        name="deductions"
        onChange={(event) => setAmounts({ ...amounts, deductions: event.target.value })}
        placeholder="1560"
        value={amounts.deductions}
      />
      <Field
        hint="Only for a license Mastline generated."
        inputMode="decimal"
        label="Sales Engine share"
        name="platformFee"
        onChange={(event) => setAmounts({ ...amounts, platformFee: event.target.value })}
        placeholder="0"
        value={amounts.platformFee}
      />
      <Field
        inputMode="decimal"
        label="Tax withheld"
        name="tax"
        onChange={(event) => setAmounts({ ...amounts, tax: event.target.value })}
        placeholder="0"
        value={amounts.tax}
      />

      <div className="split-preview">
        <dl className="ml-metadata">
          <dt>Net that arrives</dt>
          <dd className={net < 0 ? "danger-text" : undefined}>
            {amounts.gross ? `$${net.toFixed(2)}` : "—"}
          </dd>
        </dl>
        <p className="ml-caption">Allocations divide this net, never the gross.</p>
      </div>

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
        <Button disabled={pending || net < 0} type="submit">
          {pending ? "Recording…" : "Record payment"}
        </Button>
        <Button onClick={() => setOpen(false)} variant="secondary">
          Cancel
        </Button>
      </div>
    </form>
  );
}
