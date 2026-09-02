"use client";

import "@/styles/mastline-dashboard-screens.css";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { ActionLink, Button } from "@/components/button";
import { BuyerSelect } from "@/components/buyer-select";
import { DELIVERY_WINDOWS_DAYS, type DeliveryWindowDays } from "@/lib/delivery";
import type { DispatchState } from "../actions";
import { saveRecipientStageAction } from "../flow-actions";

/**
 * Stage three: who receives this private delivery, and what they can do
 * with it.
 *
 * Two kinds of fact, and the form says which is which. The potential buyer,
 * the terms, and the restrictions are package facts, saved to the package when
 * the form submits. The access options — expiry, note, full-resolution,
 * acceptance gate — describe a link that does not exist yet: they travel to
 * the review stage and become part of the record only when the delivery is
 * created there.
 *
 * On an approved package the stage reopens in a reduced form for "Share with
 * another recipient": the buyer, terms, and restrictions are frozen facts
 * shown as such, only the per-link choices are live, and continuing is pure
 * navigation — nothing on the package can move, so nothing is saved.
 *
 * The watermark is deliberately a statement, not a control: every preview a
 * recipient sees carries their own name, and this flow offers no way to
 * switch that off.
 */

export interface RecipientBuyer {
  readonly id: string;
  readonly name: string;
  readonly contactName?: string;
  readonly defaultTerms?: string;
  readonly defaultRestrictions?: string;
}

const INITIAL: DispatchState = {};
const NOTE_MAX = 500;

function expiryLabel(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const formatted = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${formatted} · ${days} days`;
}

export function RecipientStage({
  workspaceSlug,
  shootId,
  packageId,
  frameCount,
  buyers,
  editable,
  packageFrozen,
  backHref,
  reviewHrefBase,
  initial,
}: {
  workspaceSlug: string;
  shootId: string;
  packageId: string;
  frameCount: number;
  buyers: readonly RecipientBuyer[];
  editable: boolean;
  /** Approved: buyer, terms, and restrictions are facts, not fields. */
  packageFrozen: boolean;
  backHref: string;
  /** The review stage address without the link-option query. */
  reviewHrefBase: string;
  initial: {
    buyerId?: string;
    buyerName?: string;
    proposedTerms?: string;
    restrictions?: string;
    recipientLabel?: string;
    contactReference?: string;
    windowDays: DeliveryWindowDays;
    deliveryNote?: string;
    allowFullResolution: boolean;
    requireAcceptanceToView: boolean;
  };
}) {
  const [state, formAction, pending] = useActionState(
    saveRecipientStageAction.bind(null, workspaceSlug),
    INITIAL,
  );

  const [buyerId, setBuyerId] = useState(initial.buyerId ?? "");
  const [terms, setTerms] = useState(initial.proposedTerms ?? "");
  const [restrictions, setRestrictions] = useState(
    initial.restrictions ?? "Editorial use only. No commercial use.",
  );
  const [recipientLabel, setRecipientLabel] = useState(initial.recipientLabel ?? "");
  const [contactReference, setContactReference] = useState(initial.contactReference ?? "");
  const [note, setNote] = useState(initial.deliveryNote ?? "");
  const [windowDays, setWindowDays] = useState<DeliveryWindowDays>(initial.windowDays);
  const [allowFullResolution, setAllowFullResolution] = useState(initial.allowFullResolution);
  const [requireAcceptanceToView, setRequireAcceptanceToView] = useState(
    initial.requireAcceptanceToView,
  );

  const buyer = useMemo(
    () => buyers.find((candidate) => candidate.id === buyerId),
    [buyerId, buyers],
  );
  const buyerName = buyer?.name ?? initial.buyerName;

  const applyDeskDefaults = () => {
    if (!buyer) return;
    if (buyer.defaultTerms) setTerms(buyer.defaultTerms);
    if (buyer.defaultRestrictions) setRestrictions(buyer.defaultRestrictions);
    if (buyer.contactName && !recipientLabel) setRecipientLabel(buyer.contactName);
  };

  /*
   * The frozen path saves nothing, so the destination carries the choices.
   * The live path posts, and the action redirects to the same address — one
   * vocabulary for the options either way.
   */
  const reviewHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("stage", "review");
    if (recipientLabel.trim()) params.set("to", recipientLabel.trim().slice(0, 120));
    if (contactReference.trim()) params.set("contact", contactReference.trim().slice(0, 200));
    params.set("expires", String(windowDays));
    params.set("fullres", allowFullResolution ? "1" : "0");
    params.set("gate", requireAcceptanceToView ? "1" : "0");
    if (note.trim()) params.set("note", note.trim().slice(0, 500));
    const joiner = reviewHrefBase.includes("?") ? "&" : "?";
    // The base already carries the package; the stage in it is replaced by ours.
    const base = reviewHrefBase.replace(/([?&])stage=[^&]*(&|$)/, "$1").replace(/[?&]$/, "");
    return `${base}${joiner}${params.toString()}`;
  }, [
    allowFullResolution,
    contactReference,
    note,
    recipientLabel,
    requireAcceptanceToView,
    reviewHrefBase,
    windowDays,
  ]);

  if (!editable && !packageFrozen) {
    return (
      <div className="ml-delivery-recipient">
        <p className="ml-help">
          This role can read the delivery but not choose its recipient. That needs the package-write
          permission.
        </p>
      </div>
    );
  }

  const body = (
    <>
      <div className="ml-delivery-recipient-stage__columns">
        <section aria-labelledby="recipient-heading" className="ml-delivery-recipient-stage__who">
          <h2 className="ml-section-title" id="recipient-heading">
            Potential Buyer
          </h2>

          {packageFrozen ? (
            <p className="ml-delivery-recipient-stage__fact">
              {buyerName ?? "Recorded on the submission"}
              <small>
                Frozen at approval, with the terms and restrictions. A new recipient gets a new link
                to the same frozen package.
              </small>
            </p>
          ) : (
            <BuyerSelect
              workspaceSlug={workspaceSlug}
              buyers={buyers}
              label="Potential Buyer"
              onChange={setBuyerId}
              required
              value={buyerId}
            />
          )}

          <div className="ml-field">
            <label className="ml-label" htmlFor="recipient-desk">
              Recipient desk or contact
            </label>
            <input
              className="ml-input"
              id="recipient-desk"
              name="recipientLabel"
              onChange={(event) => setRecipientLabel(event.target.value)}
              placeholder="New York picture desk"
              value={recipientLabel}
            />
            <p className="ml-help">Named on your delivery record. Never part of the link.</p>
          </div>

          <div className="ml-field">
            <label className="ml-label" htmlFor="recipient-contact">
              Contact email or reference
            </label>
            <input
              className="ml-input"
              id="recipient-contact"
              inputMode="email"
              name="contactReference"
              onChange={(event) => setContactReference(event.target.value)}
              placeholder="desk@example.com"
              value={contactReference}
            />
            <p className="ml-help">
              Stored for your record. Mastline sends nothing, and it never appears in the link.
            </p>
          </div>

          <div className="ml-field">
            <label className="ml-label" htmlFor="recipient-note">
              Recipient note
            </label>
            <textarea
              className="ml-textarea"
              id="recipient-note"
              maxLength={NOTE_MAX}
              name="deliveryNote"
              onChange={(event) => setNote(event.target.value)}
              placeholder="A short note shown at the top of the delivery page."
              rows={5}
              value={note}
            />
            <p aria-hidden="true" className="ml-delivery-details__count">
              {note.length} / {NOTE_MAX}
            </p>
            <p className="ml-help">
              Shown on the delivery page beside the photographs. Mastline sends no email: you pass
              the link on yourself.
            </p>
          </div>

          {!packageFrozen && (
            <>
              <Button onClick={applyDeskDefaults} size="sm" type="button" variant="secondary">
                Use saved desk defaults
              </Button>
              {buyer && (
                <p className="ml-help">
                  Applies {buyer.name}&rsquo;s saved terms and restrictions to this delivery.
                </p>
              )}
            </>
          )}
        </section>

        <section aria-labelledby="access-heading" className="ml-delivery-recipient-stage__access">
          <h2 className="ml-section-title" id="access-heading">
            Private-link access
          </h2>

          <div className="ml-field">
            <label className="ml-label" htmlFor="recipient-expiry">
              Link expires
            </label>
            <select
              className="ml-select"
              id="recipient-expiry"
              name="windowDays"
              onChange={(event) => setWindowDays(Number(event.target.value) as DeliveryWindowDays)}
              value={String(windowDays)}
            >
              {DELIVERY_WINDOWS_DAYS.map((days) => (
                <option key={days} value={days}>
                  {expiryLabel(days)}
                </option>
              ))}
            </select>
            <p className="ml-help">The link will stop working on this date.</p>
          </div>

          {packageFrozen ? (
            <>
              <p className="ml-delivery-recipient-stage__fact">
                Terms: {initial.proposedTerms ?? "Not recorded"}
              </p>
              <p className="ml-delivery-recipient-stage__fact">
                Usage: {initial.restrictions ?? "None recorded"}
              </p>
            </>
          ) : (
            <>
              <div className="ml-field">
                <label className="ml-label" htmlFor="recipient-terms">
                  Terms
                </label>
                <textarea
                  className="ml-textarea"
                  id="recipient-terms"
                  name="proposedTerms"
                  onChange={(event) => setTerms(event.target.value)}
                  placeholder="Non-exclusive, editorial distribution…"
                  required
                  rows={3}
                  value={terms}
                />
                <p className="ml-help">
                  Frozen onto the submission at approval, shown to the recipient, and copied again
                  at the moment they accept.
                </p>
              </div>

              <div className="ml-field">
                <label className="ml-label" htmlFor="recipient-usage">
                  Usage
                </label>
                <textarea
                  className="ml-textarea"
                  id="recipient-usage"
                  name="restrictions"
                  onChange={(event) => setRestrictions(event.target.value)}
                  rows={2}
                  value={restrictions}
                />
                <p className="ml-help">How the photographs may be used.</p>
              </div>
            </>
          )}

          <label className="ml-check-row" htmlFor="recipient-fullres">
            <input
              checked={allowFullResolution}
              id="recipient-fullres"
              name="allowFullResolution"
              onChange={(event) => setAllowFullResolution(event.target.checked)}
              type="checkbox"
            />
            <span>
              Full-resolution download
              <small>Allow the recipient to download full-resolution files after accepting.</small>
            </span>
          </label>

          <label className="ml-check-row" htmlFor="recipient-gate">
            <input
              checked={requireAcceptanceToView}
              id="recipient-gate"
              name="requireAcceptanceToView"
              onChange={(event) => setRequireAcceptanceToView(event.target.checked)}
              type="checkbox"
            />
            <span>
              Require acceptance before viewing
              <small>
                The recipient must enter their name and accept the terms before the photographs are
                shown.
              </small>
            </span>
          </label>

          <p className="ml-delivery-recipient-stage__fact">
            Recipient watermark: <strong>On</strong>
            <small>
              Every preview carries the recipient&rsquo;s own name and the link date. This is how
              deliveries stay attributable, and it is not a setting.
            </small>
          </p>
        </section>
      </div>

      {state.error && (
        <p className="ml-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="ml-delivery-flow__actions">
        <div className="ml-delivery-flow__back">
          <ActionLink href={backHref} variant="quiet">
            {packageFrozen ? "Back to review" : "Back to details"}
          </ActionLink>
        </div>
        <p className="ml-delivery-flow__standing">
          {buyerName
            ? `${recipientLabel.trim() || buyerName} will receive a private, tracked link to ${frameCount} ${
                frameCount === 1 ? "photograph" : "photographs"
              }.`
            : "Choose a potential buyer to continue."}{" "}
          Nothing has been created or sent yet.
        </p>
        <div className="ml-delivery-flow__advance">
          {packageFrozen ? (
            <Link className="ml-button" href={reviewHref}>
              Review delivery
            </Link>
          ) : (
            <Button disabled={pending || !buyerId} type="submit">
              {pending ? "Saving…" : "Review delivery"}
            </Button>
          )}
        </div>
      </div>
    </>
  );

  if (packageFrozen) {
    return <div className="ml-delivery-recipient-stage">{body}</div>;
  }

  return (
    <form action={formAction} className="ml-delivery-recipient-stage">
      <input name="packageId" type="hidden" value={packageId} />
      <input name="shootId" type="hidden" value={shootId} />
      {body}
    </form>
  );
}
