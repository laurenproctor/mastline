"use client";

import { useActionState, useState } from "react";
import { Badge, Field } from "@/components/primitives";
import { type DispatchState, recordOutcomeAction } from "@/app/[workspace]/dispatch/actions";
import { type MoneyActionState, recordSaleAction } from "@/app/[workspace]/money/actions";

const OUTCOME_INITIAL: DispatchState = {};
const SALE_INITIAL: MoneyActionState = {};

/**
 * Record what happened after a dispatch.
 *
 * Both forms write forward-only: an outcome and a sale are new facts attached
 * to the submission, never edits to what was sent. The database enforces that
 * independently.
 */
export function OutcomePanel({
  workspaceSlug,
  submissionId,
  currentStatus,
  buyerName,
  canRecordOutcome,
  canRecordSale,
}: {
  workspaceSlug: string;
  submissionId: string;
  currentStatus: string;
  buyerName: string | null;
  canRecordOutcome: boolean;
  canRecordSale: boolean;
}) {
  const [outcomeState, outcomeAction, outcomePending] = useActionState(
    recordOutcomeAction.bind(null, workspaceSlug),
    OUTCOME_INITIAL,
  );
  const [saleState, saleAction, salePending] = useActionState(
    recordSaleAction.bind(null, workspaceSlug),
    SALE_INITIAL,
  );
  const [origin, setOrigin] = useState<"external" | "mastline_sales_engine">("external");
  const [base, setBase] = useState("");

  const baseValue = Number(base.replace(/[$,\s]/g, ""));
  const showsSplit =
    origin === "mastline_sales_engine" && Number.isFinite(baseValue) && baseValue > 0;
  const platformShare = showsSplit ? Math.round(baseValue * 100 * 0.3) / 100 : 0;
  const photographerShare = showsSplit ? baseValue - platformShare : baseValue;

  return (
    <>
      {canRecordOutcome && (
        <form action={outcomeAction} className="side-card">
          <input name="submissionId" type="hidden" value={submissionId} />
          <h3>Record an outcome</h3>
          <p>Currently {currentStatus.replace(/_/g, " ")}.</p>

          <Field control="select" defaultValue={currentStatus} label="Outcome" name="status">
            <option value="delivered">Delivered</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="sold">Sold</option>
            <option value="no_sale">No sale</option>
            <option value="recalled">Recalled</option>
            <option value="failed">Delivery failed</option>
          </Field>
          <div className="spacer" />
          <Field control="textarea" label="Note" name="outcomeNote" />

          {outcomeState.error && (
            <p className="auth-error" role="alert">
              {outcomeState.error}
            </p>
          )}
          {outcomeState.ok && (
            <p className="inspector-saved" role="status">
              {outcomeState.message}
            </p>
          )}

          <div className="spacer" />
          <button className="button" disabled={outcomePending} type="submit">
            {outcomePending ? "Recording…" : "Record outcome"}
          </button>
          <p className="section-note">
            This adds a fact. It never changes what was sent or under which terms.
          </p>
        </form>
      )}

      {canRecordSale && (
        <form action={saleAction} className="side-card">
          <input name="submissionId" type="hidden" value={submissionId} />
          <h3>Record a sale</h3>

          <Field defaultValue={buyerName ?? ""} label="Licensee" name="licenseeName" required />
          <div className="spacer" />
          <Field
            control="select"
            label="Where did this license come from?"
            name="origin"
            onChange={(event) =>
              setOrigin(event.target.value as "external" | "mastline_sales_engine")
            }
            value={origin}
          >
            <option value="external">My own agency or buyer relationship</option>
            <option value="mastline_sales_engine">Generated inside Mastline</option>
          </Field>
          <div className="spacer" />
          <Field
            hint="The contractual sale amount, before any deduction."
            inputMode="decimal"
            label="Sale amount"
            name="saleBase"
            onChange={(event) => setBase(event.target.value)}
            placeholder="640"
            required
            value={base}
          />
          <div className="spacer" />
          <Field label="Media" name="media" placeholder="US editorial, web and print" />
          <div className="spacer" />
          <Field label="Territory" name="territory" placeholder="United States" />

          <div className="split-preview">
            {origin === "mastline_sales_engine" ? (
              <>
                <Badge tone="blue">Sales Engine applies</Badge>
                <dl className="confirm-list">
                  <div>
                    <dt>Photographer (70%)</dt>
                    <dd>{showsSplit ? `$${photographerShare.toFixed(2)}` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Mastline (30%)</dt>
                    <dd>{showsSplit ? `$${platformShare.toFixed(2)}` : "—"}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <>
                <Badge tone="neutral">No Mastline share</Badge>
                <p className="section-note">
                  Mastline takes 30% only on licenses it generated. This one goes to the
                  photographer in full.
                </p>
              </>
            )}
          </div>

          {saleState.error && (
            <p className="auth-error" role="alert">
              {saleState.error}
            </p>
          )}
          {saleState.ok && (
            <p className="inspector-saved" role="status">
              {saleState.message}
            </p>
          )}

          <div className="spacer" />
          <button className="button blue" disabled={salePending} type="submit">
            {salePending ? "Recording…" : "Record sale"}
          </button>
          <p className="section-note">
            The exact split is recalculated on the server from the amount and origin.
          </p>
        </form>
      )}
    </>
  );
}
