"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { BuyerCheckboxes } from "@/components/buyer-select";
import { Field } from "@/components/primitives";
import { formatCoordinates, toDatetimeLocalValue } from "@/lib/geo";
import { type ActionState, createShootAction } from "../actions";

const INITIAL: ActionState = {};

type LocationState = "idle" | "asking" | "filled" | "refused" | "unavailable";

const LOCATION_NOTE: Record<LocationState, string> = {
  idle: "",
  asking: "Reading this device's location…",
  filled: "From this device's location. Overwrite it with the place name.",
  refused: "Location permission was declined. Type the place instead.",
  unavailable: "This device could not report a location. Type the place instead.",
};

export function CreateShootForm({
  workspaceSlug,
  buyers,
  canSeeSourceNote,
}: {
  workspaceSlug: string;
  buyers: readonly { id: string; name: string }[];
  canSeeSourceNote: boolean;
}) {
  const [state, formAction, pending] = useActionState(createShootAction.bind(null, workspaceSlug), INITIAL);

  // Both defaults are written into the controls after mount rather than
  // rendered. The server has no idea what time it is where the operator is
  // standing, or where that is, so rendering a guess would mismatch on
  // hydration. They stay uncontrolled: a default is a starting point, and the
  // field belongs to whoever is typing in it.
  const startsAtRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const [locationState, setLocationState] = useState<LocationState>("idle");
  const [locationTouched, setLocationTouched] = useState(false);

  useEffect(() => {
    const control = startsAtRef.current;
    if (control && control.value === "") {
      control.value = toDatetimeLocalValue(new Date());
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Geolocation is an external platform API, and the whole exchange lives in
    // its callbacks. Nothing here overwrites a field the operator has typed in.
    const ask = async () => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        if (!cancelled) setLocationState("unavailable");
        return;
      }

      setLocationState("asking");

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled) return;
          const value = formatCoordinates(position.coords.latitude, position.coords.longitude);
          const control = locationRef.current;
          if (!value || !control) {
            setLocationState("unavailable");
            return;
          }
          // A fix that arrives after the operator started typing is discarded.
          if (control.value !== "") {
            setLocationState("idle");
            return;
          }
          control.value = value;
          setLocationState("filled");
        },
        () => {
          if (!cancelled) setLocationState("refused");
        },
        { enableHighAccuracy: false, maximumAge: 120_000, timeout: 10_000 },
      );
    };

    void ask();

    return () => {
      cancelled = true;
    };
  }, []);

  const locationHint = locationTouched ? undefined : LOCATION_NOTE[locationState] || undefined;

  return (
    <form action={formAction}>
      <p className="section-note">
        Only a subject or event is required. A shoot can exist before there are any files, and
        before the time and place are settled.
      </p>
      <p className="required-legend">
        <span aria-hidden="true" className="required-mark">
          *
        </span>{" "}
        marks a required field.
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
          hint="Defaults to now. Change it if the shoot was earlier."
          label="Date and time"
          name="startsAt"
          ref={startsAtRef}
          type="datetime-local"
        />
        <Field control="select" defaultValue="standard" label="Priority" name="priority">
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="standard">Standard</option>
          <option value="watch">Watch</option>
        </Field>
        <Field
          full
          hint={locationHint}
          label="Location"
          name="locationName"
          onChange={() => setLocationTouched(true)}
          placeholder="Where the shoot happened"
          ref={locationRef}
        />
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

        <BuyerCheckboxes
          workspaceSlug={workspaceSlug}
          buyers={buyers}
          hint="Used to pre-fill the dispatch package later."
          legend="Target buyers"
        />

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
