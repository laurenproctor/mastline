"use client";

import { useActionState } from "react";
import { Field } from "@/components/primitives";
import {
  CONTEXT_LIST_MAX,
  CONTEXT_NOTE_MAX,
  type ContextSuggestion,
  SUGGESTION_KIND_LABELS,
} from "@/lib/news-radar-context";
import {
  type ContextState,
  type SuggestionState,
  acceptSuggestionAction,
  saveContextAction,
} from "../actions";
import styles from "../evaluation.module.css";

const INITIAL_CONTEXT: ContextState = {};
const INITIAL_SUGGESTION: SuggestionState = {};

/** What the editor shows when it opens: the recorded context, as text. */
export interface ContextEditorValues {
  readonly people: string;
  readonly organizations: string;
  readonly topics: string;
  readonly keywords: string;
  readonly locationName: string;
  readonly eventStartsAt: string;
  readonly eventEndsAt: string;
  readonly windowNote: string;
}

/**
 * The context editor: what a person knows about the story, typed once.
 *
 * Everything typed here is recorded with provenance `manual`. An entry that
 * was accepted from a suggestion keeps that provenance when it is left in
 * place, and is removed when it is deleted from the list. Saving does not
 * evaluate anything; the evaluator runs only when asked.
 */
export function ContextEditor({
  workspaceSlug,
  opportunityId,
  values,
}: {
  readonly workspaceSlug: string;
  readonly opportunityId: string;
  readonly values: ContextEditorValues;
}) {
  const [state, action, pending] = useActionState(
    saveContextAction.bind(null, workspaceSlug, opportunityId),
    INITIAL_CONTEXT,
  );
  const errors = state.errors ?? {};
  const listHint = `One per line or comma-separated, up to ${CONTEXT_LIST_MAX}.`;

  return (
    <form action={action} aria-label="Story context" className={styles.editorGrid}>
      {errors._form && (
        <p className={`auth-error ${styles.full}`} role="alert">
          {errors._form}
        </p>
      )}
      <Field
        control="textarea"
        defaultValue={values.people}
        error={errors.people}
        hint={listHint}
        label="People"
        name="people"
        placeholder="Who the story is about"
      />
      <Field
        control="textarea"
        defaultValue={values.organizations}
        error={errors.organizations}
        hint={listHint}
        label="Organizations"
        name="organizations"
        placeholder="Venues, companies, teams, institutions"
      />
      <Field
        control="textarea"
        defaultValue={values.topics}
        error={errors.topics}
        hint={listHint}
        label="Topics"
        name="topics"
        placeholder="What kind of story this is"
      />
      <Field
        control="textarea"
        defaultValue={values.keywords}
        error={errors.keywords}
        hint={listHint}
        label="Keywords"
        name="keywords"
        placeholder="Words your archive keywords might use"
      />
      <Field
        defaultValue={values.locationName}
        error={errors.locationName}
        label="Location"
        maxLength={200}
        name="locationName"
        placeholder="Venue, street, city"
      />
      <Field
        defaultValue={values.windowNote}
        error={errors.windowNote}
        label="Window notes"
        maxLength={CONTEXT_NOTE_MAX}
        name="windowNote"
        placeholder="Doors, access, what may slip"
      />
      <Field
        defaultValue={values.eventStartsAt}
        error={errors.eventStartsAt}
        label="Event starts"
        name="eventStartsAt"
        type="datetime-local"
      />
      <Field
        defaultValue={values.eventEndsAt}
        error={errors.eventEndsAt}
        label="Event ends"
        name="eventEndsAt"
        type="datetime-local"
      />
      <div className={`actions ${styles.full}`}>
        <button className="button small" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save context"}
        </button>
        <span className="section-note">
          Saving records facts. It does not evaluate, contact anyone, or create anything.
        </span>
      </div>
    </form>
  );
}

/**
 * One suggestion, and the one motion that turns it into a recorded fact.
 * The form names the suggestion; the server re-derives it and stores the
 * rule's basis and confidence, never the browser's.
 */
export function SuggestionAccept({
  workspaceSlug,
  opportunityId,
  suggestion,
}: {
  readonly workspaceSlug: string;
  readonly opportunityId: string;
  readonly suggestion: ContextSuggestion;
}) {
  const [state, action, pending] = useActionState(
    acceptSuggestionAction.bind(null, workspaceSlug, opportunityId),
    INITIAL_SUGGESTION,
  );

  return (
    <form action={action}>
      <input name="kind" type="hidden" value={suggestion.kind} />
      <input name="value" type="hidden" value={suggestion.value} />
      {state.error && (
        <p className="auth-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button small" disabled={pending} type="submit">
        {pending ? "Adding…" : `Add as ${SUGGESTION_KIND_LABELS[suggestion.kind]}`}
      </button>
    </form>
  );
}
