# Two-factor authentication

`/security` tells people two-factor authentication is available to every account
and required for owners and finance. The first half is now true. The second is
true of any workspace that has switched it on.

## What was built

- **Enrolment** in Settings → Two-factor authentication. Supabase generates the
  secret; nothing about it is stored here. It is shown as a QR code to scan and
  as text to type, because someone reading this on the phone that holds their
  authenticator cannot scan their own screen. The QR is encoded on the server by
  `src/lib/qr.server.ts` and sent to the screen as an SVG path — the secret is
  never handed to an image service to be drawn.
- **A challenge at sign-in.** A password alone leaves the session at `aal1` when
  a factor is enrolled, so sign-in lands on `/sign-in/verify` instead of the
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

**An owner cannot switch the requirement on before enrolling themselves.** The
lockout is meant as a consequence other members are warned about, not one the
person pressing the button walks into mid-click. `setMfaPolicyAction` refuses
and asks them to set up their own authenticator first.

**`/secure-your-account` does not bounce you away once you are protected**, even
though that is the obvious thing for it to do. Confirming a factor is a Server
Action, and an action re-renders the route it was called from. A guard that
redirected on the way through that re-render navigated away from the panel
holding the ten recovery codes, which exist in that render and nowhere else —
only their hashes are stored. The enrolment worked, the workspace opened, and
the only way back from a lost phone was silently thrown away. The page now stays
where it is and offers the way out as a link. `e2e/acceptance.spec.ts` covers it
under "the locked-out page can actually let you out".

**The enrolment actions do not go through `requireSession`.** They use
`requireSessionForEnrollment`, which checks the session and the workspace but
not the factor. `requireSession` is what redirects to `/secure-your-account`, so
an enrolment action calling it would redirect back to the page it was called
from, and the screen would be a dead end instead of the way out of one. This was
a real lockout, not a theoretical one: the browser tests both enrol from
Settings with the policy off, where the gate is open, so the required path — the
only one that reaches `/secure-your-account` — went unexercised.

**Nobody can remove anyone else's factor through the product.** An owner who
could would be a way around the feature rather than an administrator. Recovery
for a genuinely lost device is a support path that does not exist yet, and needs
one before this is required of real customers.

## Recovery codes

Ten are issued the moment a factor is confirmed, because that is the moment a
way back from losing the device is needed. They are shown once and never again;
only a scrypt hash with a per-code salt is stored.

**A code cannot raise a session to `aal2`** — only a real TOTP verification does
that. So a code does the honest thing instead: it proves who is asking, the
factor comes off, and they are back in and asked to enrol again on the new
device. The screen says so before the code is used rather than after.

Each code works once, and is spent whether or not the rest succeeds — a code
that could be retried is not single use. Issuing a new set invalidates the old
one, because a code written down two years ago is a credential nobody is
tracking.

The alphabet is Crockford base32 without I, L, O, or U, so nothing can be
misread when copied off a screen by hand; the reader folds those confusions back
in anyway, and accepts lower case, spaces, and the hyphen it is shown with.

Removing the factor needs more than the session has at that point, so it runs
through the admin API. The session is then refreshed: assurance is baked into
the token, and deleting a factor server-side does not reach back into a session
already issued — without the refresh the next request is bounced straight to the
challenge that was just recovered from.

## Still missing

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
