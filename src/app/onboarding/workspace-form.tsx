"use client";

import { useActionState } from "react";
import { Field } from "@/components/primitives";
import { DEFAULT_TIMEZONE, WORKSPACE_TIMEZONES, formatTimezone } from "@/lib/timezones";
import { type OnboardingState, createWorkspaceAction } from "./actions";

const INITIAL: OnboardingState = {};


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
        defaultValue={DEFAULT_TIMEZONE}
        hint="Times are stored in UTC and shown in this zone."
        label="Timezone"
        name="timezone"
      >
        {WORKSPACE_TIMEZONES.map((zone) => (
          <option key={zone} value={zone}>
            {formatTimezone(zone)}
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
