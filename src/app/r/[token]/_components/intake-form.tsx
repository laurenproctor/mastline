"use client";

import { useActionState, useState } from "react";
import { INTAKE_LIMITS } from "@/lib/request-intake";
import { type IntakeState, submitIntakeAction } from "../actions";

const INITIAL: IntakeState = {};

/**
 * What a picture desk fills in.
 *
 * Grouped the way a desk thinks about a job -- what, when, what you need, on
 * what terms -- rather than the way the table is ordered. Only the title is
 * required, because a desk ringing at 6am has a story and a deadline and often
 * nothing else, and a form that refuses that has failed at the one moment it
 * matters.
 *
 * The rule underneath every optional field: LEAVING ONE BLANK ASKS FOR NOTHING.
 * A desk that does not name a territory has not asked for worldwide; one that
 * says nothing about money has not offered zero. Empty stays empty all the way
 * into the column, and the workspace sees "not provided" rather than a right
 * nobody negotiated. That is why there is no "all media" default anywhere here.
 */
export function IntakeForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(submitIntakeAction, INITIAL);
  const [budgetDisclosed, setBudgetDisclosed] = useState(false);

  const invalid = (field: string) => (state.field === field ? true : undefined);

  return (
    <form action={formAction} className="intake-form">
      <input name="token" type="hidden" value={token} />

      <fieldset>
        <legend>The story</legend>

        <label htmlFor="title">
          Title <span className="required-mark">(required)</span>
          <input
            aria-describedby={state.field === "title" ? "intake-error" : undefined}
            aria-invalid={invalid("title")}
            autoComplete="off"
            id="title"
            maxLength={INTAKE_LIMITS.title}
            name="title"
            placeholder="Departure from last night"
            required
          />
        </label>

        <label htmlFor="brief">
          What you need
          <textarea
            id="brief"
            maxLength={INTAKE_LIMITS.brief}
            name="brief"
            placeholder="Anything from the side door, wide and tight."
            rows={4}
          />
        </label>

        <label htmlFor="subjectOrEvent">
          Subject or event
          <input
            id="subjectOrEvent"
            maxLength={INTAKE_LIMITS.subjectOrEvent}
            name="subjectOrEvent"
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>When and where</legend>

        <label htmlFor="eventAt">
          Event date and time
          <input id="eventAt" name="eventAt" type="datetime-local" />
        </label>

        <label htmlFor="locationName">
          Location
          <input id="locationName" maxLength={INTAKE_LIMITS.locationName} name="locationName" />
        </label>

        <label htmlFor="responseDeadline">
          Your deadline
          <input id="responseDeadline" name="responseDeadline" type="datetime-local" />
        </label>
      </fieldset>

      <fieldset>
        <legend>Deliverables</legend>

        <label htmlFor="deliverables">
          What you would like
          <textarea
            id="deliverables"
            maxLength={INTAKE_LIMITS.deliverables}
            name="deliverables"
            rows={3}
          />
        </label>

        <fieldset className="intake-formats">
          <legend>Formats</legend>
          {["JPEG", "TIFF", "RAW", "Video"].map((format) => (
            <label className="intake-check" htmlFor={`format-${format}`} key={format}>
              <input
                id={`format-${format}`}
                name="requestedFormats"
                type="checkbox"
                value={format}
              />
              {format}
            </label>
          ))}
        </fieldset>
      </fieldset>

      <fieldset>
        <legend>Terms you are asking for</legend>
        <p className="section-note">
          Anything you leave blank is recorded as not provided. Nothing here is assumed.
        </p>

        <label htmlFor="usageMedia">
          Usage or media
          <input id="usageMedia" maxLength={INTAKE_LIMITS.usageMedia} name="usageMedia" />
        </label>

        <label htmlFor="territory">
          Territory
          <input id="territory" maxLength={INTAKE_LIMITS.territory} name="territory" />
        </label>

        <label htmlFor="usageDuration">
          Duration
          <input id="usageDuration" maxLength={INTAKE_LIMITS.usageDuration} name="usageDuration" />
        </label>

        <label htmlFor="exclusivity">
          Exclusivity
          <input id="exclusivity" maxLength={INTAKE_LIMITS.exclusivity} name="exclusivity" />
        </label>

        <label htmlFor="embargoUntil">
          Embargo until
          <input id="embargoUntil" name="embargoUntil" type="datetime-local" />
        </label>

        <label htmlFor="usageRestrictions">
          Restrictions
          <textarea
            id="usageRestrictions"
            maxLength={INTAKE_LIMITS.usageRestrictions}
            name="usageRestrictions"
            rows={2}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Budget</legend>

        <label className="intake-check" htmlFor="budgetDisclosed">
          <input
            checked={budgetDisclosed}
            id="budgetDisclosed"
            name="budgetDisclosed"
            onChange={(event) => setBudgetDisclosed(event.target.checked)}
            type="checkbox"
          />
          I can give a figure
        </label>

        {budgetDisclosed ? (
          <div className="intake-budget">
            <label htmlFor="budgetMin">
              From
              <input id="budgetMin" inputMode="decimal" min="0" name="budgetMin" type="number" />
            </label>
            <label htmlFor="budgetMax">
              To
              <input id="budgetMax" inputMode="decimal" min="0" name="budgetMax" type="number" />
            </label>
            <label htmlFor="currency">
              Currency
              <input defaultValue="USD" id="currency" maxLength={3} name="currency" size={4} />
            </label>
          </div>
        ) : (
          <p className="section-note">
            Recorded as <strong>not provided</strong>. That is different from zero, and the
            photographer sees it that way.
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>Who is sending this</legend>
        <label htmlFor="submitterName">
          Your name (optional)
          <input
            aria-invalid={invalid("submitterName")}
            autoComplete="name"
            id="submitterName"
            maxLength={INTAKE_LIMITS.submitterName}
            name="submitterName"
          />
        </label>
        <p className="section-note">
          Stored as a name you typed, with the time you typed it. It is not checked against
          anything, and the photographer sees it as your claim rather than as proof of who you are.
        </p>
      </fieldset>

      {state.error && (
        <p className="auth-error" id="intake-error" role="alert">
          {state.error}
        </p>
      )}

      <button className="button blue" disabled={pending} type="submit">
        {pending ? "Sending…" : "Send this request"}
      </button>

      <p className="section-note">
        Sending this creates a request in the photographer&rsquo;s workspace. It is not an
        assignment: it does not commit them to covering it, accepting it, or delivering anything.
      </p>
    </form>
  );
}
