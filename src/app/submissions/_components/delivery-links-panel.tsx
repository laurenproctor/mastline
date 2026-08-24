"use client";

import { useActionState, useState } from "react";
import { Badge, Field } from "@/components/primitives";
import { DELIVERY_WINDOWS_DAYS, DEFAULT_DELIVERY_WINDOW, deliveryStanding } from "@/lib/delivery";
import type { AccessEvent, DeliveryLink } from "@/lib/data/delivery-links";
import {
  type DeliveryState,
  createDeliveryAction,
  revokeDeliveryAction,
} from "../delivery-actions";

const INITIAL: DeliveryState = {};

/**
 * The link, and what was done with it.
 *
 * The address is shown because the security page promises it and because it is
 * the difference between "they opened it" and "they opened it four times from
 * the same desk". It is evidence for the photographer, not analytics.
 */
export function DeliveryLinks({
  submissionId,
  origin,
  links,
  events,
  canSend,
}: {
  submissionId: string;
  origin: string;
  links: readonly DeliveryLink[];
  events: readonly AccessEvent[];
  canSend: boolean;
}) {
  const [createState, createAction, creating] = useActionState(createDeliveryAction, INITIAL);
  const [revokeState, revokeAction] = useActionState(revokeDeliveryAction, INITIAL);
  const [open, setOpen] = useState(false);
  const now = new Date();

  return (
    <div className="panel-body">
      {links.length === 0 && (
        <p className="section-note">
          No link yet. A picture desk does not need an account: send them one and every open and
          download is recorded here.
        </p>
      )}

      {links.map((link) => {
        const standing = deliveryStanding({
          expiresAt: link.expiresAt,
          revokedAt: link.revokedAt,
          now,
        });
        const url = `${origin}/d/${link.token}`;
        return (
          <div className="delivery-link" key={link.id}>
            <div className="delivery-link-head">
              <Badge tone={standing === "live" ? "good" : "neutral"}>
                {standing === "live" ? "Open" : standing === "withdrawn" ? "Withdrawn" : "Expired"}
              </Badge>
              <span className="muted">{link.recipientLabel ?? "No recipient noted"}</span>
            </div>
            <p className="delivery-link-url">
              <code>{url}</code>
            </p>
            {standing === "live" && canSend && (
              <form action={revokeAction}>
                <input name="submissionId" type="hidden" value={submissionId} />
                <input name="deliveryId" type="hidden" value={link.id} />
                <button className="button small" type="submit">
                  Withdraw this link
                </button>
              </form>
            )}
          </div>
        );
      })}

      {revokeState.error && (
        <p className="auth-error" role="alert">
          {revokeState.error}
        </p>
      )}

      {events.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">What the recipient did</caption>
            <thead>
              <tr>
                <th scope="col">What</th>
                <th scope="col">When</th>
                <th scope="col">From</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, index) => (
                <tr key={`${event.occurredAt}-${index}`}>
                  <td>
                    {event.kind === "opened" && "Opened"}
                    {event.kind === "downloaded" && "Downloaded a frame"}
                    {event.kind === "refused" && `Refused — ${event.detail ?? "closed link"}`}
                  </td>
                  <td>{new Date(event.occurredAt).toLocaleString()}</td>
                  <td>{event.ipAddress ?? "unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canSend &&
        (!open ? (
          <button className="button small blue" onClick={() => setOpen(true)} type="button">
            Create a delivery link
          </button>
        ) : (
          <form action={createAction}>
            <input name="submissionId" type="hidden" value={submissionId} />
            <Field
              hint="A desk or a person. Recorded with the link so you know which one this was."
              label="Recipient"
              name="recipientLabel"
            />
            <div className="spacer" />
            <Field
              control="select"
              defaultValue={String(DEFAULT_DELIVERY_WINDOW)}
              hint="After this the link stops opening. You can withdraw it sooner."
              label="Stays open for"
              name="windowDays"
            >
              {DELIVERY_WINDOWS_DAYS.map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </Field>
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
              Nothing is sent. You get a link and pass it on yourself.
            </p>
          </form>
        ))}
    </div>
  );
}
