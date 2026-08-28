"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/primitives";
import { WORKSPACE_TIMEZONES, formatTimezone } from "@/lib/timezones";
import { type WorkspaceState, updateWorkspaceAction } from "../actions";

const INITIAL: WorkspaceState = {};

/**
 * Edit the workspace name and timezone.
 *
 * Collapsed until asked for, like the invite form, so the panel stays a
 * summary rather than turning into a settings screen inside a settings screen.
 *
 * A successful save redirects, so this only ever renders a refusal. The action
 * explains why it redirects rather than revalidating.
 */
export function EditWorkspace({
  workspaceSlug,
  name,
  timezone,
}: {
  workspaceSlug: string;
  name: string;
  timezone: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateWorkspaceAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <>
        <button className="button small" onClick={() => setOpen(true)} type="button">
          Edit workspace
        </button>
      </>
    );
  }

  return (
    <form action={formAction}>
      <Field
        defaultValue={name}
        hint="Shown across the workspace and on the export file."
        label="Workspace name"
        maxLength={120}
        name="name"
        required
      />
      <div className="spacer" />
      <Field
        control="select"
        defaultValue={timezone}
        hint="Times are stored in UTC and shown in this zone. Changing it re-renders history; it never rewrites it."
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
      <div className="actions">
        <button className="button blue small" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save workspace"}
        </button>
        <button className="button small" onClick={() => setOpen(false)} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}
