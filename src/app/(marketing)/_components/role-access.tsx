"use client";

import { useState } from "react";
import type { AppRole } from "@/lib/domain";
import { type Capability, can } from "@/lib/permissions";

/**
 * Role-based access, demonstrated rather than asserted.
 *
 * The Trust page listed "separate owner, editor, dispatcher, finance, and
 * legal or rights-review permissions" as one line of nine, and a reader
 * deciding whether to put a decade of work and a confidential source list into
 * someone else's software has no way to check it.
 *
 * So the answers are computed by `can()` from src/lib/permissions.ts -- the
 * same table the RLS policies mirror and the permission tests pin. A marketing
 * page cannot overstate what a role may do here, because it is not the page
 * deciding. If a policy is tightened, this narrows with it in the same commit.
 *
 * `sensitive_note.read` is the line that matters most and it is deliberately
 * near the top: source protection is a promise on this page, and only the
 * owner and the editor hold it.
 */

const ROLES: readonly { role: AppRole; label: string; note: string }[] = [
  { role: "owner", label: "Owner", note: "The photographer whose business it is" },
  { role: "editor", label: "Editor", note: "Works the shoots and the pictures" },
  { role: "dispatcher", label: "Dispatcher", note: "Runs the desk and sends packages" },
  { role: "finance", label: "Finance", note: "Invoices, payments, statements" },
  { role: "rights_reviewer", label: "Rights review", note: "Evidence and triage only" },
  { role: "viewer", label: "Viewer", note: "Can look, and nothing else" },
];

/** Each capability said the way a photographer would say it. */
const LINES: readonly { capability: Capability; text: string }[] = [
  { capability: "sensitive_note.read", text: "Read a confidential tip, source, or location" },
  { capability: "shoot.write", text: "Create and rewrite a shoot brief" },
  { capability: "asset.write", text: "Change captions, metadata, and selects" },
  { capability: "asset.tombstone", text: "Retire an asset from circulation" },
  { capability: "package.write", text: "Build a dispatch package" },
  { capability: "submission.send", text: "Send a package to a buyer" },
  { capability: "license.write", text: "Issue or amend a license" },
  { capability: "payment.write", text: "Record and reconcile a payment" },
  { capability: "rights.triage", text: "Triage a suspected unlicensed use" },
  { capability: "member.invite", text: "Invite someone else into the workspace" },
  { capability: "workspace.settings", text: "Change workspace settings" },
  { capability: "export.workspace", text: "Export the whole commercial record" },
];

export function RoleAccess() {
  // Editor by default, because it is the most instructive of the six: it holds
  // the source line, and still cannot send a package, touch the money, or
  // export the archive. Owner would be a column of ticks and dispatcher a
  // column of dashes, and neither shows the separation this is here to show.
  const [role, setRole] = useState<AppRole>("editor");

  return (
    <div className="roles">
      <div aria-label="Role" className="roles-tabs" role="group">
        {ROLES.map((entry) => (
          <button
            aria-pressed={entry.role === role}
            className={entry.role === role ? "on" : ""}
            key={entry.role}
            onClick={() => setRole(entry.role)}
            type="button"
          >
            <b>{entry.label}</b>
            <small>{entry.note}</small>
          </button>
        ))}
      </div>

      <ul aria-live="polite" className="roles-grid">
        {LINES.map((line) => {
          const allowed = can(role, line.capability);
          return (
            <li className={allowed ? "yes" : "no"} key={line.capability}>
              <span aria-hidden="true" className="roles-mark">
                {allowed ? (
                  <svg
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.4"
                    viewBox="0 0 24 24"
                  >
                    <path d="M5 12l4 4L19 6" />
                  </svg>
                ) : (
                  <svg
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2.4"
                    viewBox="0 0 24 24"
                  >
                    <path d="M6 12h12" />
                  </svg>
                )}
              </span>
              {/* Said in words too, because the tick and the dash are the only
                  thing separating "may" from "may not" and colour must never
                  carry a meaning on its own. */}
              <span className="roles-state">{allowed ? "May" : "May not"}</span>
              <span className="roles-text">{line.text}</span>
            </li>
          );
        })}
      </ul>

      <p className="roles-note">
        Read live from the same capability table the database policies mirror, so this page cannot
        claim access the software would not actually grant. Every read of a confidential note is
        logged, whoever holds the role.
      </p>
    </div>
  );
}
