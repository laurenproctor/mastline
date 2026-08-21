"use client";

import { useActionState } from "react";
import { Field } from "@/components/primitives";
import { type ActionState, createShootAction } from "../actions";

const INITIAL: ActionState = {};

export function CreateShootForm({
  buyers,
  canSeeSourceNote,
}: {
  buyers: readonly { id: string; name: string }[];
  canSeeSourceNote: boolean;
}) {
  const [state, formAction, pending] = useActionState(createShootAction, INITIAL);

  return (
    <form action={formAction}>
      <p className="section-note">
        Only a subject or event is required. A shoot can exist before there are any files, and
        before the time and place are settled.
      </p>
      <div className="spacer" />

      <div className="form-grid">
        <Field
          error={state.errors?.title}
          full
          label="Subject or event"
          name="title"
          placeholder="Hotel Chelsea departure"
          required
        />
        <Field
          error={state.errors?.startsAt}
          label="Date and time"
          name="startsAt"
          type="datetime-local"
        />
        <Field control="select" defaultValue="standard" label="Priority" name="priority">
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="standard">Standard</option>
          <option value="watch">Watch</option>
        </Field>
        <Field full label="Location" name="locationName" />
        <Field
          label="Assignment / agency"
          name="assignmentLabel"
          placeholder="Direct, Backgrid, Getty…"
        />
        <Field control="select" label="Exclusivity" name="exclusivity">
          <option value="">None</option>
          <option>Agency exclusive</option>
          <option>Buyer exclusive</option>
        </Field>
        <Field control="textarea" full label="Story angle" name="storyAngle" />

        <fieldset className="field full buyer-picker">
          <legend>Target buyers</legend>
          <p className="section-note">Used to pre-fill the dispatch package later.</p>
          <div className="checkbox-row">
            {buyers.map((buyer) => (
              <label className="checkbox" key={buyer.id}>
                <input name="targetBuyerIds" type="checkbox" value={buyer.id} />
                <span>{buyer.name}</span>
              </label>
            ))}
            {buyers.length === 0 && <span className="muted">No buyers recorded yet.</span>}
          </div>
        </fieldset>

        <Field
          error={state.errors?.embargoUntil}
          label="Embargo until"
          name="embargoUntil"
          type="datetime-local"
        />

        <div className="field">
          <label className="checkbox">
            <input name="sensitiveContent" type="checkbox" />
            <span>Sensitive content</span>
          </label>
        </div>

        <Field control="textarea" full label="Notes" name="notes" />

        {canSeeSourceNote && (
          <Field
            control="textarea"
            full
            hint="Stored separately from the shoot and readable only by owners and editors. Never exposed through search."
            label="Confidential source note"
            name="sourceNote"
          />
        )}
      </div>

      {state.errors?._form && (
        <p className="auth-error" role="alert">
          {state.errors._form}
        </p>
      )}

      <div className="spacer" />
      <div className="actions">
        <button className="button primary" disabled={pending} type="submit">
          {pending ? "Creating…" : "Create shoot and review"}
        </button>
      </div>
    </form>
  );
}
