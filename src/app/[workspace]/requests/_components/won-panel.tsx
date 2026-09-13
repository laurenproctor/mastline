"use client";

import { useActionState, useState } from "react";
import type { BuyerRequest } from "@/lib/domain";
import { type RequestActionState, connectLicenseAction } from "../actions";

const INITIAL: RequestActionState = {};

/** One license the operator may connect, described the way they would say it. */
export interface ConnectableLicense {
  readonly id: string;
  /** Licensee, amount, and status in one line, composed on the server. */
  readonly label: string;
}

/**
 * Record the win.
 *
 * Winning a request is not a status somebody selects: it is a person
 * connecting the license that closed it, so the win always points at money.
 * The choice is entirely manual -- there is no matching and no suggestion,
 * only the workspace's recorded licenses -- and the act is confirmed the way
 * every other closing decision is, because a won request cannot be reopened.
 *
 * The basis is on screen before the confirm: which license, for whom, for how
 * much. What the connection does and does not do is said in as many words.
 */
export function WonPanel({
  workspaceSlug,
  request,
  licenses,
  moneyHref,
}: {
  workspaceSlug: string;
  request: BuyerRequest;
  licenses: readonly ConnectableLicense[];
  moneyHref: string;
}) {
  const [state, formAction, pending] = useActionState(
    connectLicenseAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [chosen, setChosen] = useState("");

  if (licenses.length === 0) {
    return (
      <div className="panel-body">
        <p className="section-note">
          Recording a win means connecting the license that closed this request, and this workspace
          has no license to connect yet. Record the sale on{" "}
          <a className="text-link" href={moneyHref}>
            Money
          </a>{" "}
          first, then come back and connect it.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="panel-body">
      <input name="requestId" type="hidden" value={request.id} />
      <input name="expectedUpdatedAt" type="hidden" value={request.updatedAt} />

      <p className="section-note">
        A win is recorded by connecting the license that closed this request, so it always points at
        the money. Connecting performs the move to <strong>Won</strong> in the same act.
      </p>

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor="won-license">License that closed it</label>
        <select
          id="won-license"
          name="licenseId"
          onChange={(event) => setChosen(event.target.value)}
          value={chosen}
        >
          <option value="">Choose a license…</option>
          {licenses.map((license) => (
            <option key={license.id} value={license.id}>
              {license.label}
            </option>
          ))}
        </select>
        <small className="section-note">
          Only licenses already recorded in this workspace appear here. Nothing is suggested or
          matched for you: you were in the negotiation, so you pick.
        </small>
      </div>

      {chosen !== "" && (
        <label className="checkbox">
          <input name="confirmed" type="checkbox" value="yes" />
          <span>
            I understand this records the request as won, closes it permanently, and connects it to
            this license.
          </span>
        </label>
      )}

      <div className="actions">
        <button className="button primary" disabled={pending || chosen === ""} type="submit">
          {pending ? "Recording…" : "Connect license and record the win"}
        </button>
      </div>

      <p className="section-note">
        This changes the workspace&rsquo;s record and nothing else. The license itself is not
        touched, no invoice is raised, and the buyer is not told.
      </p>
    </form>
  );
}
