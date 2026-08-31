/**
 * Role capabilities.
 *
 * This mirrors the RLS policies in the initial migration. The database is the
 * authority: nothing here can grant access the policies deny. Its job is to let
 * the interface hide or disable an action the caller could not complete anyway,
 * so a person is not offered a button that will fail.
 *
 * When a policy changes, change this table in the same commit. The permission
 * tests assert the two agree.
 */

import type { AppRole } from "./domain";

export const CAPABILITIES = [
  // News Radar. Write covers entering and editing a story; review covers the
  // lifecycle decisions on one -- watch, dismiss, act. Both map onto the same
  // opportunities_write policy (owner and editor), and they are separate
  // capabilities so the interface can say WHICH thing a role cannot do.
  "opportunity.read",
  "opportunity.write",
  "opportunity.review",
  "shoot.read",
  "shoot.write",
  "shoot.status",
  "sensitive_note.read",
  // Inbound demand. Every role reads it -- a request explains where a later
  // license came from, so finance and rights have a reason to see one -- and
  // the three roles that do the work may write and move it. Assignment is not
  // a separate capability: a dispatcher who can record what a picture desk
  // asked for can also say who is answering it, and splitting the two would
  // put src/lib/permissions.ts out of step with buyer_requests_write, which is
  // the one thing this table exists not to do.
  "request.read",
  "request.write",
  "asset.read",
  "asset.write",
  "asset.tombstone",
  "package.read",
  "package.write",
  // A counterparty record is created from wherever the work is: building a
  // package, recording a payment, briefing a shoot. The roles here mirror
  // buyers_write in the initial migration.
  "buyer.write",
  "submission.read",
  "submission.send",
  "license.read",
  "license.write",
  "payment.read",
  "payment.write",
  "rights.read",
  "rights.triage",
  "expense.write",
  "member.invite",
  "workspace.settings",
  // A bulk download of the whole commercial record is a higher-privilege act
  // than reading any one screen of it, so it has its own capability.
  "export.workspace",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const READ_ONLY: readonly Capability[] = [
  "opportunity.read",
  "shoot.read",
  "request.read",
  "asset.read",
  "package.read",
  "submission.read",
  "license.read",
  "payment.read",
  "rights.read",
];

const ROLE_CAPABILITIES: Record<AppRole, readonly Capability[]> = {
  owner: CAPABILITIES,
  editor: [
    ...READ_ONLY,
    "opportunity.write",
    "opportunity.review",
    "shoot.write",
    "shoot.status",
    "sensitive_note.read",
    "request.write",
    "asset.write",
    "asset.tombstone",
    "package.write",
    "buyer.write",
    "expense.write",
  ],
  // A dispatcher moves packages and submissions, and may advance a shoot's
  // status as part of dispatching. They do not rewrite briefs: shoot.write
  // covers the brief, and a database trigger enforces that boundary.
  // request.write because the dispatcher is the person a picture desk actually
  // rings. A role that can field the call but not write down what was said
  // pushes the record back into the phone this feature exists to get it out of.
  dispatcher: [
    ...READ_ONLY,
    "package.write",
    "buyer.write",
    "submission.send",
    "shoot.status",
    "request.write",
  ],
  // docs/DATA_MODEL.md puts exports under finance alongside revenue and
  // statements.
  finance: [
    ...READ_ONLY,
    "license.write",
    "payment.write",
    "buyer.write",
    "expense.write",
    "export.workspace",
  ],
  // Evidence and triage only. Escalation to a demand is a separate approved
  // workflow, deliberately not a role permission.
  rights_reviewer: [...READ_ONLY, "rights.triage"],
  viewer: READ_ONLY,
};

export function can(role: AppRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function capabilitiesFor(role: AppRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

/** Throw when a caller lacks a capability. For Server Actions. */
export class PermissionError extends Error {
  constructor(role: AppRole, capability: Capability) {
    super(`A ${role} may not ${capability}.`);
    this.name = "PermissionError";
  }
}

export function assertCan(role: AppRole, capability: Capability): void {
  if (!can(role, capability)) throw new PermissionError(role, capability);
}
