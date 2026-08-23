# Two-factor authentication

`/security` tells people two-factor authentication is available to every account
and required for owners and finance. The first half is now true. The second is
true of any workspace that has switched it on.

## What was built

- **Enrolment** in Settings → Two-factor authentication. Supabase generates the
  secret; nothing about it is stored here. The key is shown as text as well,
  because someone reading this on the phone that holds their authenticator
  cannot scan their own screen.
- **A challenge at sign-in.** A password alone leaves the session at `aal1` when
  a factor is enrolled, so sign-in lands on `/login/verify` instead of the
  workspace.
- **Enforcement.** Middleware sends any `aal1` session that owes a code back to
  the challenge, so it cannot be skipped by typing an address. `requireSession`
  is the second gate, in case a route is ever missed by the matcher.
- **A workspace policy**, `organizations.require_mfa`, owner-only. When on, an
  owner or finance member without a factor lands on `/secure-your-account` and
  goes no further until they enrol.
- **Removal**, guarded by a current code, so a borrowed session cannot strip the
  protection off an account on its way to the contents.

## Decisions worth knowing

**The roles are owner and finance** (`ROLES_REQUIRING_MFA` in `src/lib/mfa.ts`) —
the two that can export the entire commercial record.

**The policy defaults to off, for new workspaces as well as existing ones.**
Switching it on locks out any owner who has not enrolled; their only way back in
is to enrol. That is a decision a workspace should make deliberately rather than
inherit. If you would rather every new workspace start with it on — which would
make the `/security` sentence unconditionally true — that is a one-line change to
the column default, and it puts an enrolment step in front of every new sign-up.

**Nobody can remove anyone else's factor through the product.** An owner who
could would be a way around the feature rather than an administrator. Recovery
for a genuinely lost device is a support path that does not exist yet, and needs
one before this is required of real customers.

## Still missing

- **Recovery codes.** Supabase does not issue them, and a lost phone currently
  means an administrator with service-role access. This should exist before the
  policy is required of anyone.
- **More than one factor per account**, so a second device can be a backup.
- **WebAuthn**, which is stronger than TOTP and already supported by the
  platform.

## Testing it

The browser tests use real TOTP, generated in `e2e/helpers.ts` from `node:crypto`
— fifteen lines of RFC 6238, checked against the published test vectors, rather
than a dependency to keep patched.

Two of them enrol against the shared seeded owner, so both reset the account
before and after through the service role. Without that, one interrupted run
would leave the workspace demanding a code whose secret nothing knows, and every
later test locked out for good. That is not hypothetical; it happened once while
this was being written.
