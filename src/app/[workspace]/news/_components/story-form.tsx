"use client";

import { useActionState } from "react";
import { Field } from "@/components/primitives";
import type { NewsMode } from "@/lib/news-radar";
import { type StoryEntryState, createStoryAction } from "../actions";

const INITIAL: StoryEntryState = {};

/**
 * Manual story entry.
 *
 * The story is entered ONCE. There is no archive-or-shoot choice here,
 * because one submission creates the canonical signal and both evaluation
 * paths together -- whether the story can sell owned work and whether it
 * justifies a new shoot are the radar's two standing questions, asked of
 * every story. Only the headline is required: this writes a private record,
 * and a photographer typing between jobs should not be blocked on facts they
 * do not have yet.
 *
 * The signal, window, basis, and confidence fields seed both paths the same
 * way a machine's suggestion will later arrive: as a labelled claim with a
 * stated basis, never as a fact -- and each path is decided independently
 * afterwards.
 */
export function StoryForm({
  workspaceSlug,
  mode,
}: {
  readonly workspaceSlug: string;
  /** Where the form was opened from; only chooses which path opens after. */
  readonly mode: NewsMode;
}) {
  const [state, formAction, pending] = useActionState(
    createStoryAction.bind(null, workspaceSlug),
    INITIAL,
  );
  const errors = state.errors ?? {};

  return (
    <form action={formAction} className="story-form">
      <input name="mode" type="hidden" value={mode} />

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
          hint="Shown beside the signal and confidence on both paths as their stated basis."
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
        One entry, two evaluations: the story is recorded once and appears in{" "}
        <strong>Archive Matches</strong> (can it sell photographs you already own?) and{" "}
        <strong>Shoot Opportunities</strong> (does it justify a new shoot?), each decided on its
        own. This creates a private record on your radar. It contacts nobody, creates no shoot,
        builds no package, and sends nothing.
      </p>
    </form>
  );
}
