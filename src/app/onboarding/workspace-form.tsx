"use client";

import { useActionState } from "react";
import { Field } from "@/components/primitives";
import { type OnboardingState, createWorkspaceAction } from "./actions";

const INITIAL: OnboardingState = {};

/** A short list of the zones a working photographer is most likely to want. */
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

export function WorkspaceForm({ suggestedName }: { suggestedName: string }) {
  const [state, formAction, pending] = useActionState(createWorkspaceAction, INITIAL);

  return (
    <form action={formAction} className="auth-form">
      <Field
        defaultValue={suggestedName}
        hint="Your studio or business name. You can change it later."
        label="Workspace name"
        name="name"
        required
      />
      <div className="spacer" />
      <Field
        control="select"
        defaultValue="America/New_York"
        hint="Times are stored in UTC and shown in this zone."
        label="Timezone"
        name="timezone"
      >
        {TIMEZONES.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replace(/_/g, " ")}
          </option>
        ))}
      </Field>

      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="spacer" />
      <button className="button primary auth-submit" disabled={pending} type="submit">
        {pending ? "Creating…" : "Create workspace"}
      </button>
    </form>
  );
}
