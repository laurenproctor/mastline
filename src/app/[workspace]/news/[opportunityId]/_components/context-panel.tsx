import type { NewsSignal } from "@/lib/domain";
import type { StoredContext } from "@/lib/data/news-radar-evaluations";
import { formatConfidence, formatDateTime } from "@/lib/format";
import {
  type ContextSuggestion,
  ENTITY_KIND_LABELS,
  PROVENANCE_LABELS,
  SUGGESTION_KIND_LABELS,
} from "@/lib/news-radar-context";
import styles from "../evaluation.module.css";
import { ContextEditor, type ContextEditorValues, SuggestionAccept } from "./context-editor";

/** An ISO instant as a datetime-local value, in the server's clock, matching how it is parsed back. */
function toDateTimeLocal(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function joined(stored: StoredContext, kind: string): string {
  return stored.entities
    .filter((entity) => entity.kind === kind)
    .map((entity) => entity.value)
    .join("\n");
}

/**
 * The story's context in four registers, kept visibly apart: what the
 * source recorded, what a person entered (including suggestions a person
 * accepted, labelled as such), what the system suggests and has NOT
 * recorded, and what is still missing. Below them, the editor.
 */
export function ContextPanel({
  workspaceSlug,
  opportunityId,
  story,
  stored,
  suggestions,
  canEdit,
}: {
  readonly workspaceSlug: string;
  readonly opportunityId: string;
  readonly story: NewsSignal;
  readonly stored: StoredContext;
  readonly suggestions: readonly ContextSuggestion[];
  readonly canEdit: boolean;
}) {
  const { context, entities } = stored;
  const missing: string[] = [];
  if (!entities.some((entity) => entity.kind === "person")) missing.push("People");
  if (!context.locationName) missing.push("Location");
  if (!context.eventStartsAt) missing.push("Event time");
  if (!story.sourceUrl) missing.push("Source link");

  const values: ContextEditorValues = {
    people: joined(stored, "person"),
    organizations: joined(stored, "organization"),
    topics: joined(stored, "topic"),
    keywords: joined(stored, "keyword"),
    locationName: context.locationName ?? "",
    eventStartsAt: toDateTimeLocal(context.eventStartsAt),
    eventEndsAt: toDateTimeLocal(context.eventEndsAt),
    windowNote: context.windowNote ?? "",
  };

  return (
    <div className="side-card">
      <h3>Structured context — what the evaluator reads</h3>
      <div className={styles.registers}>
        <section aria-labelledby={`recorded-${opportunityId}`} className={styles.register}>
          <h4 id={`recorded-${opportunityId}`}>Recorded source facts</h4>
          <ul className={styles.plain}>
            <li>Headline: {story.title}</li>
            <li>Source: {story.sourceName ?? "not recorded"}</li>
            <li>
              Published:{" "}
              {story.sourcePublishedAt ? formatDateTime(story.sourcePublishedAt) : "not recorded"}
            </li>
          </ul>
        </section>

        <section aria-labelledby={`entered-${opportunityId}`} className={styles.register}>
          <h4 id={`entered-${opportunityId}`}>Entered by a person</h4>
          {entities.length === 0 && !context.locationName && !context.eventStartsAt ? (
            <p className={styles.meta}>Nothing recorded yet.</p>
          ) : (
            <ul className={styles.chips}>
              {entities.map((entity) => (
                <li className={styles.chip} key={entity.id}>
                  {entity.value}
                  <small>
                    {ENTITY_KIND_LABELS[entity.kind]} · {PROVENANCE_LABELS[entity.provenance]}
                    {entity.provenance === "system" && entity.basis
                      ? ` · ${entity.basis}${entity.confidence !== undefined ? ` · ${formatConfidence(entity.confidence)}` : ""}`
                      : ""}
                  </small>
                </li>
              ))}
              {context.locationName && (
                <li className={styles.chip}>
                  {context.locationName}
                  <small>
                    Location · {PROVENANCE_LABELS[context.locationProvenance]}
                    {context.locationProvenance === "system" && context.locationBasis
                      ? ` · ${context.locationBasis}${context.locationConfidence !== undefined ? ` · ${formatConfidence(context.locationConfidence)}` : ""}`
                      : ""}
                  </small>
                </li>
              )}
              {context.eventStartsAt && (
                <li className={styles.chip}>
                  {formatDateTime(context.eventStartsAt)}
                  {context.eventEndsAt ? ` → ${formatDateTime(context.eventEndsAt)}` : ""}
                  <small>Event time · {PROVENANCE_LABELS[context.eventTimeProvenance]}</small>
                </li>
              )}
            </ul>
          )}
        </section>

        <section aria-labelledby={`suggested-${opportunityId}`} className={styles.register}>
          <h4 id={`suggested-${opportunityId}`}>Suggestions — not recorded</h4>
          {suggestions.length === 0 ? (
            <p className={styles.meta}>
              Nothing to suggest from the story&rsquo;s own words that is not already recorded.
            </p>
          ) : (
            <div>
              {suggestions.map((suggestion) => (
                <div
                  className={styles.suggestionRow}
                  key={`${suggestion.kind}:${suggestion.value}`}
                >
                  <span>
                    {suggestion.value}
                    <small>
                      Suggested {SUGGESTION_KIND_LABELS[suggestion.kind]} · {suggestion.basis} ·{" "}
                      {formatConfidence(suggestion.confidence)}
                    </small>
                  </span>
                  {canEdit && (
                    <SuggestionAccept
                      opportunityId={opportunityId}
                      suggestion={suggestion}
                      workspaceSlug={workspaceSlug}
                    />
                  )}
                </div>
              ))}
              <p className={styles.meta}>
                A suggestion is a rule over the headline, not a fact. It is recorded only when a
                person adds it, with its basis kept beside it.
              </p>
            </div>
          )}
        </section>
      </div>

      <p className={styles.meta}>
        <strong>Missing:</strong>{" "}
        {missing.length === 0 ? "nothing the evaluator needs." : missing.join(", ")}
        {stored.updatedAt ? ` · Context last saved ${formatDateTime(stored.updatedAt)}` : ""}
      </p>

      {canEdit ? (
        <ContextEditor
          opportunityId={opportunityId}
          values={values}
          workspaceSlug={workspaceSlug}
        />
      ) : (
        <p className="section-note">
          Recording context needs an owner or editor. Everything above is readable to every member.
        </p>
      )}
    </div>
  );
}
