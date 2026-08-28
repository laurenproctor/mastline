/**
 * The attribution a photographer hangs on a delivery link.
 *
 * `campaign=awards-season`, `channel=email`, `desk=new-york`. It exists so that
 * when four links go out and one of them gets opened, the photographer can see
 * which route worked -- not so that anything in Mastline behaves differently.
 * That distinction is the whole design:
 *
 *   * Nothing reads these to decide whether a request is allowed. The token is
 *     the only credential, and it is a path segment, not a query parameter.
 *   * Nothing reads them back off the visitor's URL. What the photographer sees
 *     is the snapshot stored beside the link when it was made, so a recipient
 *     editing the query string changes what is in their address bar and nothing
 *     in the record.
 *   * They never carry a name, an email address, or a contact id. Those live in
 *     protected columns on the delivery row, because a query string ends up in
 *     browser history, in a referrer header, and in every proxy log between
 *     Mastline and the desk.
 *
 * The rules below are duplicated in `private.delivery_parameters_ok()`. That is
 * deliberate rather than lazy: this copy gives the operator a usable error while
 * they are typing, and the database copy is the one that is actually load-
 * bearing, because "the application validates it" stops being true the moment
 * something else writes a row.
 */

/** Eight is plenty for attribution and keeps a link short enough to paste. */
export const MAX_DELIVERY_PARAMETERS = 8;
export const MAX_PARAMETER_VALUE_LENGTH = 120;

const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * Keys Mastline refuses to store.
 *
 * Three groups, and the reasoning differs for each.
 *
 * Credentials and lifetimes: a parameter called `token` or `expires` would not
 * actually do anything -- nothing reads it -- but it would read to a person, and
 * to whoever maintains this next, as though it might. The right answer to "can
 * a custom parameter override authorization?" is "there is no parameter by that
 * name", not "the code happens to ignore it".
 *
 * Identity: recipient names and contact ids belong in the database columns that
 * hold them. Refusing the key is how that stays true when somebody reasonably
 * thinks `?email=...` would be a convenient way to label a link.
 *
 * Prototype keys: if any of this is ever spread into a plain object -- building
 * a URL, rendering a table, round-tripping through JSON -- `__proto__` and
 * friends are the difference between a map and a footgun.
 *
 * Kept in sync with the same list in the migration.
 */
export const RESERVED_PARAMETER_KEYS: ReadonlySet<string> = new Set([
  "token",
  "delivery_token",
  "t",
  "key",
  "secret",
  "sig",
  "signature",
  "auth",
  "authorization",
  "access_token",
  "bearer",
  "password",
  "pw",
  "expires",
  "expires_at",
  "exp",
  "ttl",
  "window",
  "window_days",
  "recipient",
  "recipient_label",
  "contact",
  "contact_reference",
  "email",
  "e_mail",
  "mail",
  "phone",
  "tel",
  "name",
  "full_name",
  "user",
  "user_id",
  "person",
  "organization",
  "organization_id",
  "org",
  "submission",
  "submission_id",
  "delivery",
  "delivery_id",
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

export interface ParameterPair {
  readonly key: string;
  readonly value: string;
}

export type ParameterResult =
  | { readonly ok: true; readonly parameters: Record<string, string> }
  | { readonly ok: false; readonly error: string };

/**
 * Turn what the operator typed into what gets stored.
 *
 * Empty rows are dropped rather than rejected, because the form always renders
 * a blank pair for the next one and submitting it should not be an error.
 * Everything else that is wrong is reported, in the operator's words, one
 * problem at a time.
 *
 * The returned object is built with a null prototype and then copied into a
 * plain one, so a key that somehow got past the reserved list still cannot
 * reach `Object.prototype`.
 */
export function normalizeDeliveryParameters(pairs: readonly ParameterPair[]): ParameterResult {
  const collected = Object.create(null) as Record<string, string>;
  let count = 0;

  for (const pair of pairs) {
    const key = (pair.key ?? "").trim().toLowerCase();
    const value = (pair.value ?? "").trim();

    // A row the operator never filled in.
    if (key === "" && value === "") continue;

    if (key === "") {
      return { ok: false, error: "Every parameter needs a name." };
    }
    if (value === "") {
      return { ok: false, error: `Give “${key}” a value, or remove it.` };
    }
    if (!KEY_PATTERN.test(key)) {
      return {
        ok: false,
        error: `“${key}” is not a usable parameter name. Use lowercase letters, numbers, hyphen, and underscore, starting with a letter.`,
      };
    }
    if (RESERVED_PARAMETER_KEYS.has(key)) {
      return {
        ok: false,
        error: `“${key}” is reserved. Attribution parameters cannot name a credential, an expiry, or a person — a recipient's name or contact belongs in the recipient fields, which are never put in the URL.`,
      };
    }
    if (Object.prototype.hasOwnProperty.call(collected, key)) {
      return { ok: false, error: `“${key}” is listed twice. Each parameter can appear once.` };
    }
    if (value.length > MAX_PARAMETER_VALUE_LENGTH) {
      return {
        ok: false,
        error: `The value for “${key}” is too long. Keep it under ${MAX_PARAMETER_VALUE_LENGTH} characters.`,
      };
    }

    collected[key] = value;
    count += 1;

    if (count > MAX_DELIVERY_PARAMETERS) {
      return {
        ok: false,
        error: `A link carries at most ${MAX_DELIVERY_PARAMETERS} parameters.`,
      };
    }
  }

  return { ok: true, parameters: { ...collected } };
}

/** Read the pairs a form submitted, in the order the operator arranged them. */
export function parameterPairsFromForm(formData: {
  getAll(name: string): unknown[];
}): readonly ParameterPair[] {
  const keys = formData.getAll("parameterKey").map((value) => String(value ?? ""));
  const values = formData.getAll("parameterValue").map((value) => String(value ?? ""));
  return keys.map((key, index) => ({ key, value: values[index] ?? "" }));
}

/**
 * The address to hand to the desk.
 *
 * Parameters are sorted so the same set always produces the same URL -- a link
 * copied twice should not look like two links -- and encoded with
 * URLSearchParams so a value with a space or an ampersand in it survives the
 * journey. The token stays a path segment: it is the credential, and it has no
 * business sitting alongside things a recipient is free to edit.
 */
export function deliveryUrlWithParameters(
  origin: string,
  token: string,
  parameters: Readonly<Record<string, string>> = {},
): string {
  const base = `${origin.replace(/\/+$/, "")}/d/${token}`;
  const entries = Object.entries(parameters).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return base;

  const query = new URLSearchParams();
  for (const [key, value] of entries) query.set(key, value);
  return `${base}?${query.toString()}`;
}
