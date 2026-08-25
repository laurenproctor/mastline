"use client";

import { useId, useState, useTransition } from "react";
import { createBuyerAction } from "@/app/buyer-actions";

/**
 * Choose a buyer, or record one that does not exist yet.
 *
 * Every screen that asks for a buyer used to assume the counterparty had
 * already been entered in settings. In practice a desk is named for the first
 * time at the moment of the work -- while briefing a shoot, building a package,
 * or logging a payment -- and sending the operator away to create it meant the
 * record was attributed to nobody, or not made at all.
 *
 * Adding a buyer here creates the record and selects it. It never contacts
 * anyone: a counterparty row is a fact about the workspace, not a message.
 */

export interface BuyerChoice {
  readonly id: string;
  readonly name: string;
}

const BUYER_TYPES: readonly { value: string; label: string }[] = [
  { value: "agency", label: "Agency" },
  { value: "publisher", label: "Publisher" },
  { value: "picture_desk", label: "Picture desk" },
  { value: "direct_licensee", label: "Direct licensee" },
  { value: "other", label: "Other" },
];

/** The sentinel option value. Never a real id, which is always a uuid. */
const ADD_NEW = "__add_new__";

/**
 * The inline creation form, shared by the dropdown and the checkbox list.
 *
 * It is deliberately not a `<form>`: every caller has one already, and a nested
 * form is invalid HTML that submits the wrong thing.
 */
export function AddBuyerInline({
  onCreated,
  onCancel,
}: {
  onCreated: (buyer: BuyerChoice, existed: boolean) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [buyerType, setBuyerType] = useState("agency");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createBuyerAction({ name, buyerType, contactName, contactEmail });
      if (!result.ok || !result.id) {
        setError(result.error ?? "Could not add the buyer.");
        return;
      }
      onCreated({ id: result.id, name: result.name ?? name.trim() }, Boolean(result.existed));
    });
  };

  return (
    <div className="buyer-new">
      <p className="section-note">Recorded in this workspace only. Nothing is sent to them.</p>

      <div className="field">
        <label htmlFor={`${id}-name`}>
          Buyer name
          <span aria-hidden="true" className="required-mark">
            *
          </span>
        </label>
        <input
          autoFocus
          id={`${id}-name`}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            // Enter inside the sub-form adds the buyer. It must not submit the
            // shoot brief or package form wrapped around it.
            if (event.key === "Enter") {
              event.preventDefault();
              if (name.trim() !== "") submit();
            }
          }}
          placeholder="Backgrid, Getty, The Sun picture desk…"
          value={name}
        />
      </div>

      <div className="field">
        <label htmlFor={`${id}-type`}>Kind</label>
        <select
          id={`${id}-type`}
          onChange={(event) => setBuyerType(event.target.value)}
          value={buyerType}
        >
          {BUYER_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${id}-contact`}>Desk or contact</label>
        <input
          id={`${id}-contact`}
          onChange={(event) => setContactName(event.target.value)}
          value={contactName}
        />
      </div>

      <div className="field">
        <label htmlFor={`${id}-email`}>Contact email</label>
        <input
          id={`${id}-email`}
          inputMode="email"
          onChange={(event) => setContactEmail(event.target.value)}
          value={contactEmail}
        />
      </div>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button
          className="button small blue"
          disabled={pending || name.trim() === ""}
          onClick={submit}
          type="button"
        >
          {pending ? "Adding…" : "Add buyer"}
        </button>
        <button className="button small" disabled={pending} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function BuyerSelect({
  name = "buyerId",
  label = "Buyer",
  buyers,
  defaultValue,
  value,
  onChange,
  emptyLabel = "Choose a buyer…",
  hint,
  required = false,
  /** False for a role that may pick a buyer but not create one. */
  canCreate = true,
}: {
  name?: string;
  label?: string;
  buyers: readonly BuyerChoice[];
  defaultValue?: string;
  /** Pass with onChange to drive the value from the parent. */
  value?: string;
  onChange?: (buyerId: string) => void;
  emptyLabel?: string;
  hint?: string;
  required?: boolean;
  canCreate?: boolean;
}) {
  const id = useId();
  const [known, setKnown] = useState<readonly BuyerChoice[]>(buyers);
  const [internal, setInternal] = useState(defaultValue ?? "");
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Controlled when the parent passes a value, uncontrolled otherwise. Both
  // callers exist, and the alternative is two near-identical components.
  const selected = value ?? internal;

  const select = (buyerId: string) => {
    if (value === undefined) setInternal(buyerId);
    onChange?.(buyerId);
  };

  return (
    <div className="field buyer-select">
      {/* The real value always travels under `name`, including while the
          inline form is open, so a parent form never submits the sentinel. */}
      <input name={name} type="hidden" value={selected} />

      <label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="required-mark">
            *
          </span>
        )}
      </label>

      <select
        aria-describedby={hint ? `${id}-hint` : undefined}
        id={id}
        onChange={(event) => {
          const next = event.target.value;
          if (next === ADD_NEW) {
            setAdding(true);
            setNote(null);
            return;
          }
          setAdding(false);
          select(next);
        }}
        value={adding ? ADD_NEW : selected}
      >
        <option value="">{emptyLabel}</option>
        {known.map((buyer) => (
          <option key={buyer.id} value={buyer.id}>
            {buyer.name}
          </option>
        ))}
        {canCreate && <option value={ADD_NEW}>＋ Add a new buyer…</option>}
      </select>

      {hint && (
        <small className="section-note" id={`${id}-hint`}>
          {hint}
        </small>
      )}

      {note && (
        <small className="inspector-saved" role="status">
          {note}
        </small>
      )}

      {adding && (
        <AddBuyerInline
          onCancel={() => setAdding(false)}
          onCreated={(buyer, existed) => {
            setKnown((current) =>
              current.some((candidate) => candidate.id === buyer.id)
                ? current
                : [...current, buyer].sort((a, b) => a.name.localeCompare(b.name)),
            );
            select(buyer.id);
            setAdding(false);
            setNote(
              existed
                ? `${buyer.name} was already in this workspace, and is now selected.`
                : `${buyer.name} added and selected.`,
            );
          }}
        />
      )}
    </div>
  );
}

/**
 * Pick any number of buyers, and record one that does not exist yet.
 *
 * Used for a shoot's target buyers, which pre-fill the dispatch package later.
 */
export function BuyerCheckboxes({
  name = "targetBuyerIds",
  legend,
  hint,
  buyers,
  canCreate = true,
}: {
  name?: string;
  legend: string;
  hint?: string;
  buyers: readonly BuyerChoice[];
  canCreate?: boolean;
}) {
  const [known, setKnown] = useState<readonly BuyerChoice[]>(buyers);
  const [checked, setChecked] = useState<readonly string[]>([]);
  const [adding, setAdding] = useState(false);

  return (
    <fieldset className="field full buyer-picker">
      <legend>{legend}</legend>
      {hint && <p className="section-note">{hint}</p>}

      <div className="checkbox-row">
        {known.map((buyer) => (
          <label className="checkbox" key={buyer.id}>
            <input
              checked={checked.includes(buyer.id)}
              name={name}
              onChange={(event) =>
                setChecked((current) =>
                  event.target.checked
                    ? [...current, buyer.id]
                    : current.filter((id) => id !== buyer.id),
                )
              }
              type="checkbox"
              value={buyer.id}
            />
            <span>{buyer.name}</span>
          </label>
        ))}
        {known.length === 0 && !adding && <span className="muted">No buyers recorded yet.</span>}
        {canCreate && !adding && (
          <button className="button small" onClick={() => setAdding(true)} type="button">
            ＋ Add a buyer
          </button>
        )}
      </div>

      {adding && (
        <AddBuyerInline
          onCancel={() => setAdding(false)}
          onCreated={(buyer) => {
            setKnown((current) =>
              current.some((candidate) => candidate.id === buyer.id)
                ? current
                : [...current, buyer].sort((a, b) => a.name.localeCompare(b.name)),
            );
            // A buyer added here was added because it is a target of this
            // shoot, so it starts ticked.
            setChecked((current) =>
              current.includes(buyer.id) ? current : [...current, buyer.id],
            );
            setAdding(false);
          }}
        />
      )}
    </fieldset>
  );
}
