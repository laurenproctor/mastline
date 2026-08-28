"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/primitives";
import { MODE_DESCRIPTIONS, MODE_FOR_KIND } from "@/lib/news-radar";
import type { OpportunityKind } from "@/lib/domain";
import { type StoryEntryState, createStoryAction } from "../actions";

const INITIAL: StoryEntryState = {};

/**
 * Manual story entry.
 *
 * Only the headline and the opportunity type are required: this writes a
 * private workspace record, and a photographer typing between jobs should not
 * be blocked on facts they do not have yet. The same story may be entered once
 * as each type -- connecting it to owned work and covering it fresh are
 * different jobs.
 *
 * The signal, window, basis, and confidence fields exist so the operator's own
 * judgement is recorded the same way a machine's will be later: as a labelled
 * suggestion with a stated basis, never as a fact about the story.
 */
export function StoryForm({
  workspaceSlug,
  initialKind,
}: {
  readonly workspaceSlug: string;
  readonly initialKind: OpportunityKind;
}) {
  const [state, formAction, pending] = useActionState(
    createStoryAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const [kind, setKind] = useState<OpportunityKind>(initialKind);
  const errors = state.errors ?? {};

  return (
    <form action={formAction} className="story-form">
      <fieldset className="kind-choice">
        <legend>What kind of opportunity is this?</legend>
        {(
          [
            ["archive_match", "Archive match"],
            ["shoot_opportunity", "Shoot opportunity"],
          ] as const
        ).map(([value, label]) => (
          <label className={kind === value ? "kind-option selected" : "kind-option"} key={value}>
            <input
              checked={kind === value}
              name="kind"
              onChange={() => setKind(value)}
              type="radio"
              value={value}
            />
            <span>
              <strong>{label}</strong>
              <small>{MODE_DESCRIPTIONS[MODE_FOR_KIND[value]]}</small>
            </span>
          </label>
        ))}
        {errors.kind && (
          <small className="field-error" role="alert">
            {errors.kind}
          </small>
        )}
      </fieldset>

      <div className="form-grid">
        <Field
          error={errors.title}
          full
          label="Story headline"
          maxLength={200}
          name="title"
          placeholder="What is happening?"
          required
        />
        <Field
          error={errors.sourceName}
          label="Source name"
          maxLength={120}
          name="sourceName"
          placeholder="Outlet, wire, tip…"
        />
        <Field
          error={errors.sourceUrl}
          inputMode="url"
          label="Source URL"
          name="sourceUrl"
          placeholder="https://…"
        />
        <Field
          error={errors.sourcePublishedAt}
          label="Published"
          name="sourcePublishedAt"
          type="datetime-local"
        />
        <Field
          error={errors.windowClosesAt}
          hint="When this story stops being worth working. Leave empty if open-ended."
          label="Useful until"
          name="windowClosesAt"
          type="datetime-local"
        />
        <Field
          control="textarea"
          error={errors.summary}
          full
          label="Summary"
          name="summary"
          placeholder="What the story says, in your own words."
        />
      </div>

      <div className="form-grid">
        <Field control="select" error={errors.signal} label="Signal" name="signal">
          <option value="watch">Watch — worth keeping an eye on</option>
          <option value="steady">Steady — moving at a normal pace</option>
          <option value="rising">Rising — picking up attention</option>
          <option value="high">High — urgent right now</option>
        </Field>
        <Field
          error={errors.confidence}
          hint="Optional, 0–100. Needs a basis below."
          inputMode="numeric"
          label="Confidence (%)"
          max={100}
          min={0}
          name="confidence"
          type="number"
        />
        <Field
          control="textarea"
          error={errors.suggestionBasis}
          full
          hint="Shown beside the signal and confidence as their stated basis."
          label="Why this matters"
          name="suggestionBasis"
          placeholder="Why does this story matter to this workspace?"
        />
      </div>

      {errors._form && (
        <p className="auth-error" role="alert">
          {errors._form}
        </p>
      )}

      <div className="actions">
        <button className="button blue" disabled={pending} type="submit">
          {pending ? "Adding…" : "Add story"}
        </button>
      </div>
      <p className="section-note">
        This creates a private record on your radar. It contacts nobody, creates no shoot, builds no
        package, and sends nothing.
      </p>
    </form>
  );
}
