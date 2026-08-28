"use client";

import { useActionState, useState } from "react";
import { Badge, Field } from "@/components/primitives";
import { DELIVERY_WINDOWS_DAYS, DEFAULT_DELIVERY_WINDOW } from "@/lib/delivery";
import { MAX_DELIVERY_PARAMETERS } from "@/lib/delivery-parameters";
import {
  type DeliveryState,
  createDeliveryAction,
  markSharedAction,
  revokeDeliveryAction,
  updateAttributionAction,
} from "../delivery-actions";

const INITIAL: DeliveryState = {};

/**
 * Where a link is in its life.
 *
 * Seven distinct states, and they are deliberately not collapsed into one
 * "delivered". Each is a different claim about a different thing having
 * happened, and the whole point of this screen is that a photographer can tell
 * them apart: a link that exists is not a link that was shared, and a link that
 * was shared is not a link that was opened.
 */
export type LinkStage =
  "created" | "shared" | "opened" | "accepted" | "downloaded" | "withdrawn" | "expired";

export interface DeliveryLinkView {
  readonly id: string;
  readonly recipientLabel?: string;
  readonly contactReference?: string;
  readonly parameters: readonly (readonly [string, string])[];
  readonly url: string;
  readonly stage: LinkStage;
  readonly isLive: boolean;
  readonly createdAt: string;
  readonly sharedAt?: string;
  readonly expiresAt: string;
}

const STAGE_LABEL: Record<LinkStage, string> = {
  created: "Link created",
  shared: "Shared",
  opened: "Opened",
  accepted: "Accepted",
  downloaded: "Downloaded",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

/**
 * Copy the link, and say only that.
 *
 * The clipboard is the one place where it would be very easy to lie. A control
 * that copied a URL and quietly marked the link as shared would be convenient
 * and would make "Shared" mean "somebody looked at the address", which is not
 * what a photographer reads it as. So copying touches no server state at all,
 * and the confirmation says so in as many words.
 *
 * A failed write is shown rather than swallowed. Clipboard access can be
 * refused -- an insecure origin, a browser permission, a page that lost focus --
 * and an operator who believes they have the link when they do not is worse off
 * than one who can see it failed and selects the text by hand.
 */
function CopyLinkButton({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <>
      <button className="button small" onClick={copy} type="button">
        Copy delivery link
      </button>
      {state === "copied" && (
        <p className="section-note" role="status">
          Link copied. Mastline has not marked it as shared.
        </p>
      )}
      {state === "failed" && (
        <p className="auth-error" role="alert">
          Could not copy to the clipboard. Select the address above and copy it by hand.
        </p>
      )}
    </>
  );
}

/**
 * The attribution editor.
 *
 * Deliberately plain key/value rows rather than a fixed set of fields, because
 * the useful labels differ per photographer -- campaign, desk, channel,
 * assignment -- and a fixed set would be a guess. What it will not accept is
 * anything that reads as a credential or as a person; the server and the
 * database both refuse those, and the hint says so before the operator wastes a
 * submission finding out.
 */
function ParameterEditor({
  initial = [],
  scope = "new",
}: {
  initial?: readonly (readonly [string, string])[];
  /** Keeps ids unique when a page renders more than one of these. */
  scope?: string;
}) {
  const [rows, setRows] = useState<{ key: string; value: string }[]>(
    initial.length > 0 ? initial.map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }],
  );

  return (
    <fieldset className="parameter-editor">
      <legend>Attribution (optional)</legend>
      <p className="section-note">
        Added to the end of the link so you can tell your own routes apart, for example{" "}
        <code>campaign=awards-season</code> or <code>desk=new-york</code>. These are visible to the
        recipient and are never used to decide access. Never put a name, an email address, or a
        phone number here — the recipient fields above hold those, and they stay out of the URL.
      </p>
      {rows.map((row, index) => (
        <div className="parameter-row" key={index}>
          <label className="visually-hidden" htmlFor={`parameterKey-${scope}-${index}`}>
            Parameter {index + 1} name
          </label>
          <input
            id={`parameterKey-${scope}-${index}`}
            name="parameterKey"
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...next[index], key: event.target.value };
              setRows(next);
            }}
            placeholder="campaign"
            value={row.key}
          />
          <span aria-hidden="true">=</span>
          <label className="visually-hidden" htmlFor={`parameterValue-${scope}-${index}`}>
            Parameter {index + 1} value
          </label>
          <input
            id={`parameterValue-${scope}-${index}`}
            name="parameterValue"
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...next[index], value: event.target.value };
              setRows(next);
            }}
            placeholder="awards-season"
            value={row.value}
          />
          <button
            aria-label={`Remove parameter ${index + 1}`}
            className="button small"
            onClick={() => setRows(rows.filter((_, position) => position !== index))}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
      {rows.length < MAX_DELIVERY_PARAMETERS && (
        <button
          className="button small"
          onClick={() => setRows([...rows, { key: "", value: "" }])}
          type="button"
        >
          Add a parameter
        </button>
      )}
    </fieldset>
  );
}

/**
 * The links on a submission, and what to do next with each.
 *
 * One panel per recipient, because that is the unit that matters: four links to
 * four desks are four separate records, and the whole reason they exist
 * separately is so an open can be attributed to the right one.
 */
export function DeliveryLinks({
  workspaceSlug,
  submissionId,
  links,
  canSend,
}: {
  workspaceSlug: string;
  submissionId: string;
  links: readonly DeliveryLinkView[];
  canSend: boolean;
}) {
  const [createState, createAction, creating] = useActionState(
    createDeliveryAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [shareState, shareAction] = useActionState(
    markSharedAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [revokeState, revokeAction] = useActionState(
    revokeDeliveryAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [updateState, updateAction] = useActionState(
    updateAttributionAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="panel-body">
      {links.length === 0 && (
        <p className="section-note">
          No link yet. A picture desk does not need an account: make a link for one recipient, pass
          it on yourself, then mark it as shared. Every open and download comes back here against
          the link it happened on.
        </p>
      )}

      {links.map((link) => (
        <div className="delivery-link" key={link.id}>
          <div className="delivery-link-head">
            <Badge
              tone={
                link.stage === "withdrawn" || link.stage === "expired"
                  ? "neutral"
                  : link.stage === "created"
                    ? "warn"
                    : "good"
              }
            >
              {STAGE_LABEL[link.stage]}
            </Badge>
            <span className="muted">{link.recipientLabel ?? "No recipient noted"}</span>
          </div>

          {link.contactReference && (
            <p className="section-note">
              Contact reference <code>{link.contactReference}</code> — held here, never in the link.
            </p>
          )}

          {link.parameters.length > 0 && (
            <p className="section-note">
              {link.parameters.map(([key, value]) => (
                <code className="parameter-chip" key={key}>
                  {key}={value}
                </code>
              ))}
            </p>
          )}

          <p className="delivery-link-url">
            <code>{link.url}</code>
          </p>

          {link.isLive && canSend && (
            <div className="actions">
              <CopyLinkButton url={link.url} />
              {!link.sharedAt && (
                <form action={shareAction}>
                  <input name="submissionId" type="hidden" value={submissionId} />
                  <input name="deliveryId" type="hidden" value={link.id} />
                  <button className="button small blue" type="submit">
                    Mark as shared
                  </button>
                  <p className="section-note">
                    Press this once you have actually sent the link. It is what records the
                    submission as sent.
                  </p>
                </form>
              )}
              <form action={revokeAction}>
                <input name="submissionId" type="hidden" value={submissionId} />
                <input name="deliveryId" type="hidden" value={link.id} />
                <button className="button small" type="submit">
                  Withdraw this link
                </button>
              </form>
            </div>
          )}

          {link.isLive && canSend && !link.sharedAt && (
            <details className="delivery-link-edit">
              <summary>Edit recipient and attribution</summary>
              <form action={updateAction}>
                <input name="submissionId" type="hidden" value={submissionId} />
                <input name="deliveryId" type="hidden" value={link.id} />
                <Field
                  defaultValue={link.recipientLabel ?? ""}
                  hint="Kept out of the URL, so it can be a person's name."
                  idSuffix={link.id}
                  label="Recipient"
                  name="recipientLabel"
                />
                <div className="spacer" />
                <Field
                  defaultValue={link.contactReference ?? ""}
                  hint="Optional, and also never put in the address."
                  idSuffix={link.id}
                  label="Contact reference"
                  name="contactReference"
                />
                <div className="spacer" />
                <ParameterEditor initial={link.parameters} scope={link.id} />
                <div className="spacer" />
                <button className="button small" type="submit">
                  Save attribution
                </button>
                <p className="section-note">
                  Possible only until this link is marked as shared. After that, what the recipient
                  was told is part of the record.
                </p>
              </form>
            </details>
          )}

          {link.sharedAt && (
            <p className="section-note">
              Marked as shared on {new Date(link.sharedAt).toLocaleString()}. Its recipient and
              attribution are now part of the record and cannot be changed.
            </p>
          )}
        </div>
      ))}

      {shareState.error && (
        <p className="auth-error" role="alert">
          {shareState.error}
        </p>
      )}
      {revokeState.error && (
        <p className="auth-error" role="alert">
          {revokeState.error}
        </p>
      )}
      {updateState.error && (
        <p className="auth-error" role="alert">
          {updateState.error}
        </p>
      )}

      {canSend &&
        (!open ? (
          <button className="button small blue" onClick={() => setOpen(true)} type="button">
            Create a delivery link
          </button>
        ) : (
          <form action={createAction} className="delivery-create-form">
            <input name="submissionId" type="hidden" value={submissionId} />
            <Field
              hint="A desk, an agency, or a person. Recorded with the link and kept out of the URL, so the record shows which recipient this was."
              label="Recipient"
              name="recipientLabel"
            />
            <div className="spacer" />
            <Field
              hint="Optional. Your own contact or buyer-contact id. Stored beside the link and never put in the address."
              label="Contact reference"
              name="contactReference"
            />
            <div className="spacer" />
            <Field
              control="select"
              defaultValue={String(DEFAULT_DELIVERY_WINDOW)}
              hint="After this the link stops opening. It can be withdrawn sooner."
              label="Stays open for"
              name="windowDays"
            >
              {DELIVERY_WINDOWS_DAYS.map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </Field>
            <div className="spacer" />
            <ParameterEditor />
            {createState.error && (
              <p className="auth-error" role="alert">
                {createState.error}
              </p>
            )}
            <div className="spacer" />
            <div className="actions">
              <button className="button small blue" disabled={creating} type="submit">
                {creating ? "Creating…" : "Create the link"}
              </button>
              <button className="button small" onClick={() => setOpen(false)} type="button">
                Cancel
              </button>
            </div>
            <p className="section-note">
              Nothing is sent. Mastline returns a link; passing it on is a separate, deliberate act,
              and so is telling Mastline you have.
            </p>
          </form>
        ))}
    </div>
  );
}
