"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/primitives";
import { type InviteState, inviteMemberAction } from "../actions";

const INITIAL: InviteState = {};

const ROLES = [
  ["editor", "Editor — shoots, assets, captions, dispatch preparation"],
  ["dispatcher", "Dispatcher — package delivery and status"],
  ["finance", "Finance — revenue, payments, statements, exports"],
  ["rights_reviewer", "Rights reviewer — evidence and license checks"],
  ["viewer", "Viewer — read only, no sensitive access"],
] as const;

export function InviteMember({ seatsLeft }: { seatsLeft: number | null }) {
  const [state, formAction, pending] = useActionState(inviteMemberAction, INITIAL);
  const [open, setOpen] = useState(false);

  const full = seatsLeft !== null && seatsLeft <= 0;

  if (!open) {
    return (
      <>
        <button
          className="button small"
          disabled={full}
          onClick={() => setOpen(true)}
          type="button"
        >
          Invite person
        </button>
        {full && (
          <p className="section-note">
            Every seat on this plan is taken. Move up a plan to add someone.
          </p>
        )}
      </>
    );
  }

  return (
    <form action={formAction}>
      <Field autoComplete="email" label="Email" name="email" required type="email" />
      <div className="spacer" />
      <Field control="select" defaultValue="editor" label="Role" name="role">
        {ROLES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Field>

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="spacer" />
      <div className="actions">
        <button className="button blue small" disabled={pending} type="submit">
          {pending ? "Inviting…" : "Send invitation"}
        </button>
        <button className="button small" onClick={() => setOpen(false)} type="button">
          Cancel
        </button>
      </div>
      <p className="section-note">
        An owner cannot be invited. Ownership is transferred, not granted.
        {seatsLeft !== null && ` ${seatsLeft} ${seatsLeft === 1 ? "seat" : "seats"} left.`}
      </p>
    </form>
  );
}
