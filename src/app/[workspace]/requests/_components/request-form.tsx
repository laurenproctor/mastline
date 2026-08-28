"use client";

import { useActionState, useEffect, useRef } from "react";
import { BuyerSelect } from "@/components/buyer-select";
import { Field } from "@/components/primitives";
import type { BuyerRequest, RequestSensitiveNote } from "@/lib/domain";
import { toDatetimeLocalValue } from "@/lib/geo";
import {
  type RequestActionState,
  createRequestAction,
  updateRequestAction,
} from "../actions";

const INITIAL: RequestActionState = {};

/**
 * The order the page reads in, and the order the errors are reported in.
 *
 * These are sections of one document, not steps of a wizard: every field is
 * mounted the whole time, so moving between them is a scroll. A picture desk
 * gives you four facts and a deadline, and the form has to take those four in
 * ten seconds without asking for the other twenty first -- so the two things
 * that always exist, the title and the deadline, are at the top, and everything
 * a desk may or may not have mentioned is below them.
 */
const ERROR_ORDER = [
  "title",
  "responseDeadline",
  "buyerId",
  "requestType",
  "receivedVia",
  "eventAt",
  "expiresAt",
  "approximateQuantity",
  "orientation",
  "budgetMinMinor",
  "budgetMaxMinor",
  "currency",
  "embargoUntil",
  "brief",
  "_form",
] as const;

const REQUEST_TYPE_OPTIONS = [
  { value: "archive", label: "Archive — do you already have this?" },
  { value: "coverage", label: "Coverage — can you go and shoot it?" },
  { value: "commission", label: "Commission — a paid brief" },
  { value: "exclusive", label: "Exclusive — they want it first, or only" },
  { value: "other", label: "Something else" },
] as const;

const CHANNEL_OPTIONS = [
  { value: "phone", label: "Phone call" },
  { value: "text_message", label: "Text message" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "in_person", label: "In person" },
  { value: "buyer_relationship", label: "Standing arrangement with this buyer" },
  { value: "other", label: "Other" },
] as const;

const ORIENTATION_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "landscape", label: "Landscape" },
  { value: "portrait", label: "Portrait" },
  { value: "square", label: "Square" },
] as const;

/**
 * Where unsent typing is kept while the form is open.
 *
 * This is a crash net, not the draft feature. The real one is the **Save as
 * draft** button, which writes a request with status `draft` -- durable, on the
 * server, visible in the inbox, and readable by a colleague. What this covers is
 * narrower and still worth covering: a phone that reloads the tab while
 * somebody is standing on a kerb typing what a desk just told them.
 *
 * Scoped by workspace so two studios open in two tabs cannot pour one draft
 * into the other's form.
 */
function draftKey(workspaceSlug: string): string {
  return `mastline:request-draft:${workspaceSlug}`;
}

function readDraft(workspaceSlug: string): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(workspaceSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : null;
  } catch {
    // A quota error, a private window, or somebody else's JSON under our key.
    // None of those is worth failing the form over.
    return null;
  }
}

function writeDraft(workspaceSlug: string, form: HTMLFormElement): void {
  try {
    const values: Record<string, string> = {};
    for (const [name, value] of new FormData(form).entries()) {
      // Never the idempotency key: a restored draft that reused it would land
      // on the request the previous attempt already made.
      if (name === "clientToken" || typeof value !== "string") continue;
      if (value !== "") values[name] = value;
    }
    window.localStorage.setItem(draftKey(workspaceSlug), JSON.stringify(values));
  } catch {
    // Storage being unavailable costs the net, not the form.
  }
}

function clearDraft(workspaceSlug: string): void {
  try {
    window.localStorage.removeItem(draftKey(workspaceSlug));
  } catch {
    // Nothing to do, and nothing that depends on it.
  }
}

export interface RequestFormProps {
  readonly workspaceSlug: string;
  readonly buyers: readonly { id: string; name: string }[];
  /** False for a role that may record a request but not create a counterparty. */
  readonly canCreateBuyer: boolean;
  /** Whether this person's role can read and write confidential source notes. */
  readonly canSeeSourceNote: boolean;
  /** Present when editing. Absent when recording a new request. */
  readonly request?: BuyerRequest;
  readonly sensitiveNote?: RequestSensitiveNote | null;
}

/**
 * Record what a buyer asked for.
 *
 * Nothing on this form contacts anybody. Saving writes one row in this
 * workspace and one line in its activity log; there is no path from here to a
 * dispatch, a delivery link, or a message to the buyer, and the note above the
 * buttons says so rather than leaving it to be assumed.
 *
 * Every commercial field is optional and stays empty when it is not filled in.
 * That is load-bearing: a desk that said nothing about territory has not asked
 * for worldwide, and the request detail renders the difference as "Not
 * provided" rather than inventing a term nobody negotiated.
 */
export function RequestForm({
  workspaceSlug,
  buyers,
  canCreateBuyer,
  canSeeSourceNote,
  request,
  sensitiveNote,
}: RequestFormProps) {
  const editing = request !== undefined;
  const [state, formAction, pending] = useActionState(
    editing
      ? updateRequestAction.bind(null, workspaceSlug)
      : createRequestAction.bind(null, workspaceSlug),
    INITIAL,
  );

  const formRef = useRef<HTMLFormElement>(null);
  const clientTokenRef = useRef<HTMLInputElement>(null);
  const errors = state.errors ?? {};

  /*
   * One idempotency key for the life of this form.
   *
   * Written into the control after mount rather than rendered, because a value
   * minted on the server is not the value the browser then holds and the two
   * would disagree at hydration. A DOM write is not React state, so it cannot
   * cause a re-render either.
   */
  useEffect(() => {
    if (editing) return;
    const control = clientTokenRef.current;
    if (control && control.value === "") control.value = crypto.randomUUID();
  }, [editing]);

  // Restore unsent typing. Only when recording a new request: an edit form is
  // already populated from the record, and pouring a stale local draft over it
  // would silently rewrite somebody's request.
  useEffect(() => {
    if (editing) return;
    const form = formRef.current;
    const draft = readDraft(workspaceSlug);
    if (!form || !draft) return;

    for (const [name, value] of Object.entries(draft)) {
      const control = form.elements.namedItem(name);
      if (control instanceof HTMLInputElement) {
        if (control.type === "checkbox") control.checked = value === "on";
        else if (control.type !== "hidden") control.value = value;
      } else if (
        control instanceof HTMLTextAreaElement ||
        control instanceof HTMLSelectElement
      ) {
        control.value = value;
      }
    }
  }, [editing, workspaceSlug]);

  /*
   * A returned state means the action came back, and an action that succeeded
   * redirects instead of returning -- so this only ever runs after a refusal.
   * The typing is put straight back into storage, because the submit handler
   * cleared it a moment ago and a reload now would otherwise lose the lot.
   */
  useEffect(() => {
    if (editing) return;
    const form = formRef.current;
    if (form && (state.error || state.errors)) writeDraft(workspaceSlug, form);
  }, [editing, state, workspaceSlug]);

  const firstError = ERROR_ORDER.map((field) => errors[field]).find(Boolean) ?? state.error;

  return (
    <form
      action={formAction}
      className="request-form"
      onInput={() => {
        const form = formRef.current;
        if (form && !editing) writeDraft(workspaceSlug, form);
      }}
      onSubmit={() => {
        if (!editing) clearDraft(workspaceSlug);
      }}
      ref={formRef}
    >
      {!editing && <input name="clientToken" ref={clientTokenRef} type="hidden" />}
      {editing && (
        <>
          <input name="requestId" type="hidden" value={request.id} />
          {/*
            The version this form was rendered from. The update is conditional
            on it, so two people editing one request cannot silently overwrite
            each other: the second save matches no row and is told what happened.
          */}
          <input name="expectedUpdatedAt" type="hidden" value={request.updatedAt} />
        </>
      )}

      {firstError && (
        <p className="auth-error" role="alert">
          {firstError}
        </p>
      )}

      <section aria-labelledby="request-what">
        <h2 id="request-what">What they asked for</h2>

        <div className="field-grid">
          <Field
            autoFocus={!editing}
            defaultValue={request?.title}
            error={errors.title}
            full
            hint="One line you would recognise it by in a list."
            label="Title"
            maxLength={200}
            name="title"
            placeholder="Anything from the Chelsea departure last night?"
            required
          />

          <Field
            control="textarea"
            defaultValue={request?.brief}
            error={errors.brief}
            full
            hint="What they actually said. Paste the text or the email if that is faster."
            label="Brief"
            name="brief"
          />

          <BuyerSelect
            buyers={buyers}
            canCreate={canCreateBuyer}
            defaultValue={request?.buyerId}
            emptyLabel="Not identified yet"
            hint="Leave this unset if you do not yet know which desk it came from."
            label="Buyer"
            workspaceSlug={workspaceSlug}
          />

          <Field
            control="select"
            defaultValue={request?.requestType ?? "other"}
            error={errors.requestType}
            label="Kind of request"
            name="requestType"
          >
            {REQUEST_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Field>

          <Field
            control="select"
            defaultValue={request?.receivedVia ?? ""}
            error={errors.receivedVia}
            label="How it arrived"
            name="receivedVia"
          >
            <option value="">Not recorded</option>
            {CHANNEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Field>

          <Field
            defaultValue={request?.subjectOrEvent}
            full
            hint="The story, as a picture editor would say it."
            label="Subject or event"
            maxLength={300}
            name="subjectOrEvent"
          />

          <Field
            defaultValue={request?.subjectNames.join(", ")}
            hint="Comma separated."
            label="People named"
            name="subjectNames"
          />

          <Field
            defaultValue={request?.topics.join(", ")}
            hint="Comma separated."
            label="Topics"
            name="topics"
          />
        </div>
      </section>

      <section aria-labelledby="request-when">
        <h2 id="request-when">When and where</h2>

        <div className="field-grid">
          <Field
            defaultValue={request?.responseDeadline && toDatetimeLocalValue(new Date(request.responseDeadline))}
            error={errors.responseDeadline}
            hint="When they need an answer. Nothing happens automatically when it passes — the inbox marks it Past deadline and leaves the decision to you."
            label="Response deadline"
            name="responseDeadline"
            type="datetime-local"
          />

          <Field
            defaultValue={request?.expiresAt && toDatetimeLocalValue(new Date(request.expiresAt))}
            error={errors.expiresAt}
            hint="When the request stops being worth answering, if they said."
            label="Expires"
            name="expiresAt"
            type="datetime-local"
          />

          <Field
            defaultValue={request?.eventAt && toDatetimeLocalValue(new Date(request.eventAt))}
            error={errors.eventAt}
            label="Event date and time"
            name="eventAt"
            type="datetime-local"
          />

          <Field
            defaultValue={request?.locationName}
            label="Location"
            maxLength={300}
            name="locationName"
          />
        </div>
      </section>

      <section aria-labelledby="request-deliverables">
        <h2 id="request-deliverables">Deliverables</h2>

        <div className="field-grid">
          <Field
            control="textarea"
            defaultValue={request?.deliverables}
            full
            hint="What they want delivered, in their words."
            label="What they want"
            name="deliverables"
          />

          <Field
            defaultValue={request?.requestedFormats.join(", ")}
            hint="Comma separated, e.g. JPEG, RAW, vertical video."
            label="Formats"
            name="requestedFormats"
          />

          <Field
            control="select"
            defaultValue={request?.orientation ?? ""}
            error={errors.orientation}
            label="Orientation"
            name="orientation"
          >
            <option value="">Not specified</option>
            {ORIENTATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Field>

          <Field
            defaultValue={request?.approximateQuantity?.toString()}
            error={errors.approximateQuantity}
            hint="Roughly how many frames. Leave blank if they did not say — blank is not zero."
            inputMode="numeric"
            label="Approximate quantity"
            min={1}
            name="approximateQuantity"
            type="number"
          />
        </div>
      </section>

      <section aria-labelledby="request-terms">
        <h2 id="request-terms">Commercial terms</h2>
        <p className="section-note">
          Record only what they actually said. A term left blank stays blank: it is shown as
          &ldquo;Not provided&rdquo;, never as worldwide, perpetual, or unrestricted.
        </p>

        <div className="field-grid">
          <Field
            defaultValue={request?.usageMedia}
            hint="Print, online, social, broadcast…"
            label="Usage and media"
            maxLength={500}
            name="usageMedia"
          />
          <Field
            defaultValue={request?.territory}
            label="Territory"
            maxLength={500}
            name="territory"
          />
          <Field
            defaultValue={request?.usageDuration}
            hint="How long they want to use it for."
            label="Duration"
            maxLength={500}
            name="usageDuration"
          />
          <Field
            defaultValue={request?.exclusivity}
            label="Exclusivity"
            maxLength={500}
            name="exclusivity"
          />
        </div>

        <fieldset className="field full">
          <legend>Budget</legend>
          <p className="section-note">
            Tick this only if money came up. An unticked budget records that they did not say,
            which is a different fact from a budget of nothing.
          </p>

          <label className="checkbox">
            <input
              defaultChecked={request?.budgetDisclosed}
              name="budgetDisclosed"
              type="checkbox"
            />
            <span>They stated a budget</span>
          </label>

          <div className="field-grid">
            <Field
              defaultValue={
                request?.budgetMin ? (request.budgetMin.minor / 100).toString() : undefined
              }
              error={errors.budgetMinMinor}
              inputMode="decimal"
              label="Minimum"
              name="budgetMin"
              placeholder="0.00"
            />
            <Field
              defaultValue={
                request?.budgetMax ? (request.budgetMax.minor / 100).toString() : undefined
              }
              error={errors.budgetMaxMinor}
              inputMode="decimal"
              label="Maximum"
              name="budgetMax"
              placeholder="0.00"
            />
            <Field
              control="select"
              defaultValue={request?.currency ?? "USD"}
              error={errors.currency}
              label="Currency"
              name="currency"
            >
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="EUR">EUR</option>
            </Field>
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="request-delivery">
        <h2 id="request-delivery">Delivery and restrictions</h2>

        <div className="field-grid">
          <Field
            defaultValue={request?.embargoUntil && toDatetimeLocalValue(new Date(request.embargoUntil))}
            error={errors.embargoUntil}
            label="Embargo until"
            name="embargoUntil"
            type="datetime-local"
          />
          <Field
            control="textarea"
            defaultValue={request?.deliveryRequirements}
            full
            hint="FTP, a named delivery profile, file naming, captions in a particular style."
            label="Delivery requirements"
            name="deliveryRequirements"
          />
          <Field
            control="textarea"
            defaultValue={request?.usageRestrictions}
            full
            label="Usage restrictions"
            name="usageRestrictions"
          />
        </div>
      </section>

      {canSeeSourceNote && (
        <section aria-labelledby="request-confidential">
          <h2 id="request-confidential">Confidential</h2>
          <p className="section-note">
            Held in a separate record that only owners and editors can read. It is never copied
            into the request, the activity log, or a workspace export run by another role.
          </p>

          <div className="field-grid">
            <Field
              control="textarea"
              defaultValue={sensitiveNote?.sourceNote}
              full
              label="Source note"
              name="sourceNote"
            />
            <Field
              defaultValue={sensitiveNote?.confidentialLocation}
              label="Confidential location"
              maxLength={500}
              name="confidentialLocation"
            />
            <Field
              defaultValue={sensitiveNote?.confidentialIdentity}
              label="Confidential identity"
              maxLength={500}
              name="confidentialIdentity"
            />
          </div>
        </section>
      )}

      <div className="form-foot">
        <p className="section-note">
          Saving records this in your workspace and nothing else. No message, file, or notification
          reaches the buyer, and nothing here creates a dispatch.
        </p>

        <div className="actions">
          <button className="button primary" disabled={pending} name="intent" type="submit" value="post">
            {pending ? "Saving…" : editing ? "Save changes" : "Record request"}
          </button>

          {!editing && (
            <button className="button" disabled={pending} name="intent" type="submit" value="draft">
              Save as draft
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
