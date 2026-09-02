# Decisions and open questions

## Settled

- Name: **Mastline**
- Category: business operating system / vertical SaaS for paparazzi
- Photographer-owned system of record; do not foreground “two-sided marketplace” language
- Selected wordmark direction: black Mastline mark with blue camera/signal dot
- Core workflow and nine operating screens are established
- Final tiers: Solo, Pro, Studio, Agency
- Annual pricing: Solo $49/month billed annually; Pro $99; Studio $279; Agency custom
- Monthly pricing: Solo $59/month; Pro $119; Studio $339; Agency custom
- Pro is the most popular plan; “Start free” is the CTA for Solo, Pro, and Studio
- Free trial: 30 days, no payment method required, capped at 25 GB of storage,
  running on Pro. At the end the workspace becomes read-only with export still
  available — never locked, because a commercial record is not held hostage.
  The duration is 30 rather than 14 because sale-to-payment averages 24 days,
  so a shorter trial cannot show a payment arriving.
- Conversion: **Stripe**, not a merchant of record. A card attached mid-trial
  lifts the storage cap immediately but does not bring the charge forward — the
  trial runs its full course. A failed renewal keeps the workspace working for
  **14 days**, then read-only.
- **Pro includes 1 person.** Solo and Pro are single-photographer plans; Studio
  (5) is where team begins.
- Choosing Stripe over a merchant of record means Mastline is the **seller of
  record** and owns VAT and sales-tax registration in every jurisdiction it
  sells into. That is a business obligation, not a code change, and it must be
  settled before charging a non-US customer.
- Storage/scale: Solo 250 GB and 1 photographer; Pro 1 TB; Studio up to 5 people and 5 TB shared; Agency flexible/custom
- Optional Mastline Sales Engine split: photographer 70%, Mastline 30%, only on licenses generated inside Mastline
- **Confirmation belongs at the point of consequence.** Creating a shoot is
  private, reversible workspace activity, so it happens on one page with one
  button and no confirmation step: brief, photographs, shared metadata, rights
  facts, and a review that reports rather than gates. The consequential act is
  dispatch, and its two-motion confirmation is untouched. Files chosen before
  the shoot exists are hashed and staged in the workspace's private staging
  area, then registered by the same `registerImport` the shoot workspace uses.
  There was never a separate confirmation ROUTE to retire — the second screen
  was the shoot workspace itself, which is still where the flow lands.
- Human review before outbound or consequential actions
- Warm off-white/light editorial interface is the default product direction; blue is the primary action signal

## Implementation hypotheses — validate, do not treat as product facts

- Next.js + Supabase is the recommended first stack
- Supabase Auth rather than a separate identity vendor
- Three private storage buckets: originals, derivatives, evidence
- The light editorial command-center direction is primary; the dark version may become an optional field/night theme
- News Radar and Rights Matches begin as triage tools, not autonomous agents

## Resolved since first draft

Item numbers below are permanent. Resolved items keep their number so older notes and commit messages stay readable.

- **#1 Free trial — resolved 2026-08-21.** 14 days. No payment method required to start. Eligibility and end-of-trial mechanics (what a lapsed trial workspace can still do, and how trial-uploaded originals are treated) remain open; see the trial-storage note in item 2.
- **#3 Sales Engine split mechanics — partially resolved 2026-08-21.** The *calculation* is settled: Mastline share = round-half-up(fee_base x 0.30), photographer takes the exact remainder, refunds reverse both shares proportionally as a new signed record, and the fee base is a stored input column. *When* the share is earned is still open.
- **#9 Deleting an original — resolved 2026-08-21.** An operator cannot hard-delete an original. Originals are tombstoned only (`asset_status = 'tombstoned'`); bytes are retained.

## Unresolved product decisions

1. ~~Free trial and conversion~~ — fully resolved (see above). Still open only:
   whether trial **eligibility** is one per person or one per workspace.
2. Storage overage economics. Today an import is refused once the allowance is
   full and nothing already stored is affected. Whether overage is billable
   instead is open.
3. When the 30% Sales Engine share is earned: checkout completed, funds cleared,
   refund window passed, or payout made. The calculation is settled and tested;
   only the timing is open. Blocks Phase 5 checkout, nothing before it.
4. Direct-license buyer experience and who is merchant of record
5. Rights-recovery fee percentage and operational/legal partner model
6. First agency/delivery integrations
7. Supported RAW/video formats at launch
8. Retention requirements for originals and evidence
9. ~~Whether an operator can delete an original or only archive/tombstone it~~ (resolved above)

## Recorded during implementation

- Sales Engine 30% share: computed as round-half-away-from-zero of the sale
  base, with the photographer taking the exact remainder so the two always
  reconstitute the base. Refunds reverse proportionally as signed records; an
  original is never edited. Still open: *when* the share is earned (item 2).
- Originals are tombstoned, never hard-deleted. A deliberate purge exists for
  account closure and erasure requests, behind a service-role routine.
- ~~Mastline records a dispatch; it does not yet transmit to a buyer's systems.~~
  Closed on 2026-08-23 by delivery links: a signed, expiring, withdrawable page a
  picture desk opens without an account, with every open and download recorded.
  See `docs/DELIVERY_LINKS.md`. Watermarking and an explicit acceptance are still
  missing.
- **Approval is not a dispatch, and a link is not a send.** Approving a package
  used to set the package to `delivered`, the submission to `sent`, stamp
  `sent_at`, write a `submission.sent` event reading "Sent to <buyer>", and move
  the shoot to `dispatched` — all before a delivery link existed and before
  anything had left Mastline. Seven distinct facts were being recorded as one.
  They are now separate and each is written by the thing that evidences it:
  approval freezes the package and opens a `queued` submission; creating a link
  moves nothing; **Mark as shared** is what records a send; the first valid open
  is what records a delivery. Copying a link to the clipboard writes nothing at
  all. Settled 2026-08-28.
- **The recipient reads the approval record, not the live asset.** Approval
  froze the package and the manifest, but every recipient function then walked
  to the *current* asset row for the caption and picked the *currently
  preferred* derivative for previews and downloads -- so a caption edit or a
  new derivative after approval changed what the desk received while the
  manifest sat unchanged, proving nothing. `submission_assets` is now the
  authoritative approved-delivery record (one immutable row per frame with the
  exact version, object, and editorial facts at approval), written inside the
  same transaction as the approval by `approve_package()`, and it is the only
  thing `open_delivery`, `delivery_assets`, `delivery_preview`, and the
  download functions read. The manifest stays as a summary. Downloads are
  authorised, signed, recorded, and only then released, so a signing failure
  never leaves a `downloaded` event behind. Editing an asset after approval is
  still allowed for future packages and the inspector says it reaches no
  approved submission; changing what a recipient receives means withdrawing
  the link and approving a new package. There is no administrator path that
  rewrites approved recipient content. The preview the reviewer was shown is
  frozen alongside the approved file, so a preview derivative made later is
  never shown in its place; where none existed the preview is rendered from
  the approved object or not at all. Submissions from before the record were
  backfilled from their manifests, frame by frame, with metadata as it stood
  at migration time and are marked `legacy_backfill` rather than passed off
  as the original approval; a manifest entry that no longer resolves gets no
  substitute and is named as not deliverable. Settled 2026-08-29.
- **The dispatch screen's lifecycle stage is derived, not fixed.** It read
  "Review & approve" for every package, approved or sold. It now reads
  Build package → Review & approve → Create recipient link → Shared / awaiting
  outcome → Outcome recorded from the package status, the submission, and the
  recipient links, with the existing vocabulary: approval is not sent, a link
  created is not shared (the screen says a link exists and has not been marked
  shared), and an outcome is one that was recorded.
- The package snapshot freezes at **approval**, not at `sent_at`. Keying
  immutability on a send that now happens later would have left the record
  editable for the whole window between approving and sharing — exactly the
  window in which somebody might be tempted to adjust it.
- **"Retry delivery" is gone.** It inserted a row with status `sending` and
  reported "Attempt 2 recorded and queued." Nothing was queued: there is no
  sender, no worker, and no code path that would ever have moved that attempt
  off `sending`. A database insert is not a transmission. Provider-reported
  attempts arriving through the delivery webhook remain visible as read-only
  evidence, and the control returns when there is something behind it.
- **Delivery analytics are first-party, consent-gated, and bounded by the
  server.** Opens, acceptances, and downloads are commercial evidence and are
  recorded whatever a visitor chooses. Viewing time is engagement measurement
  and is not: where a choice is required and has not been made, the delivery
  page renders no tracker. Every duration is a claim from a browser, bounded by
  a per-beat ceiling, the wall clock, and a monotonic sequence, so a replayed or
  inflated beat cannot move the number. The visitor identifier is random,
  first-party, and hashed against the delivery so one browser on two links is
  two unrelated visitors; there is no fingerprinting and the IP address is never
  the identifier. Missing measurement is reported as unavailable, never as zero
  engagement. Retention of the detailed session rows is configurable and the
  durable rollups survive it. **Open:** the retention period itself, and whether
  dwell time on a delivery page is caught by any particular privacy regime, are
  for legal review rather than settled here.
- Recipient names, email addresses, phone numbers, and contact references are
  stored in protected columns and never rendered into a delivery URL — a query
  string ends up in browser history, referrer headers, and every proxy log in
  between. Attribution parameters, which carry none of that, do go in the URL
  and are never read to decide access.
- No route-level `loading.tsx`. It wraps its subtree in an implicit Suspense
  boundary, and with one present a Server Action that revalidated the route it
  was invoked from left its promise unresolved on the client: the write landed,
  the server re-rendered in under 100ms, and the form sat on "Saving..." for
  ever. Measured at 15 hangs in 60 saves with the file and 0 in 60 without. It
  also stopped `router.refresh()` reliably taking effect, which the contact
  sheet depends on after a selection or rating. Both failures are silent.
  Navigation feedback, if wanted again, needs something that does not wrap a
  route in Suspense. Guarded by `tests/route-loading-boundary.test.ts`.

- Onboarding profile columns use `text[]` with `<@` check constraints for
  `specialties` and `onboarding_goals`, against the surrounding convention of
  jsonb arrays (`keywords`, `subjects`, `target_buyers`). Those are open
  vocabularies where a photographer types anything; these two are closed sets
  drawn from a fixed menu, and `text[]` lets the database refuse a value that is
  not in the set. jsonb cannot do that without a trigger. `work_style` is
  checked text rather than an enum, matching `buyer_type` and shoot `priority`,
  because an onboarding answer should widen with one migration rather than a
  type change. If the inconsistency proves more expensive than the integrity is
  worth, moving to jsonb is a mechanical migration.
- Sales Engine consent is recorded three ways: the boolean, the timestamp, and
  the terms version that was on screen — enforced together by a check
  constraint, so the flag cannot exist without saying what was agreed to. The
  opt-in is *also* written to `activity_events`, which is append-only. A column
  can be edited later; for something governing the 70/30 split, the audit trail
  should not be editable. Both timestamps are the database's, so a client cannot
  backdate consent. Default is off — a pre-ticked box is not consent.
- Onboarding collects seven steps' worth of answers but persists only the
  workspace profile. The sample shoot stays a labelled demonstration and writes
  no shoot, asset, or rights record, because inventing commercial history from
  fictional pictures would corrupt the record the product exists to keep. The
  flow ends at `/shoots/new?source=onboarding` — the real intake screen with an
  introduction — rather than at a simulation of it.
- `visibleBrands` in onboarding remains a suggestion and is not stored. When
  brand matching is built it needs a basis, a confidence, and a human
  confirmation before anything reaches `assets.keywords`, per
  `suggest → explain → confirm`. `createdByUser` likewise: store the raw answer,
  route uncertainty to review, never derive a copyright conclusion from a radio
  button.

- `public.profiles` has RLS enabled but **not forced**, alone among the tables
  here. The sign-up trigger must write a row before the account it describes can
  authenticate, and a forced policy blocks its own `security definer`. The
  client surface is narrower than elsewhere in exchange: no insert policy and no
  delete policy exist at all, so a signed-in caller can only read profiles they
  share a workspace with and update exactly one row. `avatar_path` carries a
  check constraint tying it to the owner's own storage prefix, so the column
  cannot be pointed at a colleague's object to borrow their face.
- Avatars live in their own private bucket keyed by user id, not by
  organization. The existing storage policies require the first path segment to
  be an organization id, and a person who works in two workspaces has one face.
  Read is granted to anyone who shares a workspace with the owner — the same
  rule as the table — so a face is never visible to someone who cannot already
  see the name. Kept private rather than public because a photographer's own
  face at a guessable address is exactly what source protection argues against.

### Workspace routing

- **Every authenticated destination is built by `workspaceRoutes(canonicalSlug)`
  in `src/lib/workspace-routes.ts`.** Paths are asked for by name — `routes.money()`,
  `routes.shoot(id)` — rather than written as strings. The alternative, writing
  `/money` and letting the middleware put a workspace in front of it, is what
  produced the two-tab bug: the middleware resolves an unscoped path from the
  active-workspace cookie, a cookie is one value for the whole browser, so a page
  showing workspace A could link into workspace B whenever a second tab had
  switched. A link that cannot be written without an address cannot forget one.
- **The dispatch review is addressed by shoot, and the package rides in the
  query.** `routes.dispatch({ shootId, packageId })` takes named arguments for
  exactly this reason: the route is `/[workspace]/dispatch/[shootId]`, and a
  positional pair is how a package id ended up in the shoot's segment — which
  compiles, reads correctly, and 404s.
- **Links are built from `canonicalSlug`, never from the slug in the request.**
  A request may arrive on an address the workspace used to hold. Echoing that
  back sends the next click through the rename redirect again; echoing an
  unresolved slug would put a browser-supplied value into a destination. Every
  workspace page therefore destructures its param as `requestedWorkspace` and
  works from the resolved address.
- **Work-queue records carry fully scoped destinations, not relative ones.**
  `getWorkQueue` is handed the route builder and returns complete hrefs. The
  alternative — workspace-independent destinations scoped where they are drawn —
  was rejected because a relative value is indistinguishable from a real path,
  so forgetting to scope one is silent, and a queue item is a record that may be
  read somewhere other than the page that built it. Navigation *constants* (the
  sidebar and phone tab bar) stay relative in the sense that they name a route
  rather than a string, but they too are resolved through the builder, so there
  is one way to produce a path and no way to produce an unscoped one.
- **Legacy paths keep working and nothing in the application depends on them.**
  `/work`, `/shoots/<id>` and friends are still redirected by the middleware for
  bookmarks and links already shared. Three places may still name one, and each
  is documented in the allowlist in `tests/link-scoping.test.ts`: the middleware
  itself, the post-sign-in default (there is no workspace to name yet, and an
  account may have several), and the fallback in the error and not-found screens
  when `usePathname()` gives them nothing to read.
- The cookie is a preference, never a tenancy or authorization input. It answers
  "where was I?" for a legacy path or a bare sign-in and is checked against live
  membership before it is used.

## News Radar foundation

- **One canonical signal, two evaluation paths.** The radar receives one news
  signal and evaluates it through two independent commercial paths:
  `one news signal → archive opportunity path + shoot opportunity path`.
  `news_signals` owns the source facts once; `opportunities` is one path per
  kind, unique on (signal, kind). The first cut put the kind and the facts on
  one row, which meant entering the same article twice to receive both
  evaluations and keeping two editable copies of its facts — corrected before
  the model became permanent. The Archive and Shoot tabs remain first-class
  modes, URL-addressed (`?mode=archive`, `?mode=shoot`), but they are two
  evaluations of the same story, not two entered copies.
- **The superseded migration was replaced, not forwarded.** Its file existed
  only on the unmerged PR branch and was verified unapplied on every shared
  database, so rewriting was safe; the replacement takes a version AFTER the
  in-flight import-queue chain so no database can receive it out of order. The
  legacy source columns on `opportunities` were dropped rather than
  deprecated: the table had never been written by application code, and a
  column that still accepts writes is how two copies drift apart.
- **Organization consistency is a composite foreign key**, (news_signal_id,
  organization_id) referencing the signal's (id, organization_id), so a path
  in workspace A can never reference a signal in workspace B whatever the
  application does. Proven by a test that tries as an authenticated member.
- **Creation is one SECURITY INVOKER function.** `create_news_story` inserts
  the signal, both paths, and the entry's activity event in one transaction —
  a failure leaves nothing behind — with RLS fully in force: authorship is
  `auth.uid()` pinned by the insert policy, execute is revoked from PUBLIC and
  anon and granted to authenticated only, and the search path is empty.
  A repeated organization/source-URL (including the loser of a race, caught as
  unique_violation) is answered with the existing records as a classified
  "duplicate", never a second copy.
- **Grants are stated exhaustively because platform defaults flip.** The local
  image granted full CRUD to authenticated on the new table, which silently
  made a column-scoped update grant decorative — grants are additive. The
  migration revokes everything from authenticated and anon first, then grants
  select, insert, and update on exactly the source-fact columns, so
  `created_by`, `organization_id`, and the timestamps cannot be rewritten by
  any client and a signal cannot be client-deleted at all.
- **Manual entry first, entered once.** The first release runs on stories
  typed by an operator, so the lifecycle is proven with a live operator before
  any feed is connected. Only the headline is required, and there is no
  archive-or-shoot choice on the form: both evaluations always come into
  existence together, and the mode the form was opened from only picks which
  path the redirect lands on.
- **The operator's judgement is recorded the way a machine's will be.** Signal,
  confidence, and basis are one vocabulary whether a person or a matching pass
  wrote them, and a check constraint refuses a confidence without a stated
  basis. When live matching arrives, its output lands in the same labelled
  fields instead of a parallel set of "real" ones.
- **The paths are decided independently, and dismissed and expired are
  terminal per path.** Dismissing the archive path leaves the shoot path
  exactly where it stood, and vice versa; a dismissed or expired path never
  slides back to looking new. Dismissing therefore takes a second motion, with
  the optional reason kept on the record; watching is one motion because
  everything after it is still open. Repeating a decision is answered with the
  record as it stands — no error, no duplicate event. The activity history
  distinguishes the story's entry (a `news_signal` event) from each path's
  decisions (`opportunity` events naming their path).
- **`acted` is unreachable from a browser in this stage.** The Server Actions
  accept only watch and dismiss; `markOpportunityActed` exists in the data
  layer for the shoot/package handoffs of the next stage, where there will be
  an act to record. A form cannot claim one happened.
- **No matched assets yet, anywhere.** An archive match holds no asset list and
  the detail screen draws that region as explicitly not built, with Build
  Package disabled. Asset ids are deliberately kept out of `suggestion_basis`;
  matching will add a relational opportunity-assets table.
- **Deduplication belongs to the canonical signal**, unique per organization
  on the source URL — the only stable identity a hand-entered story has. A
  story without a URL cannot be deduplicated and is not refused for it, and
  different workspaces may of course hold the same story.
- **Capabilities split read / write / review** (`opportunity.*`), all mapped to
  the existing owner-and-editor `opportunities_write` policy. The split exists
  so the interface can say which thing a role cannot do; the database policy
  needed no change, and the parity tests now probe both write and review.

## Captions drafted at import

- **The caption writer runs on every frame as it is imported, not only when
  somebody asks for it.** A photographer who has just dumped a card is not
  sitting in the inspector, and the frames a desk wants are wanted within the
  hour. Waiting for a click meant the feature was never used at the one moment
  it was worth anything.
- **The draft is written into `assets.caption`, not parked in a drafts table.**
  A caption that is not in the field is not searchable, not exportable, and not
  visible in the archive, so a drafts table would have delivered the promise in
  name only.
- **A drafted caption carries its origin and does not satisfy the dispatch
  gate.** `caption_origin`, `caption_reviewed_at` and the generated
  `caption_awaits_review` sit beside the text. `BASELINE_RULES` requires a
  caption that a person has read and saved, so an unread machine sentence
  cannot reach a buyer, an invoice, or a newspaper. Automation buys the typing;
  the judgement is still required, and still the photographer's.
- **Reading is the confirm step, and only the inspector counts as reading.**
  Saving in the inspector marks the caption reviewed and makes it theirs, even
  if they changed nothing — accepting a sentence is authoring it. A bulk
  metadata apply deliberately does not, because setting a credit line across two
  hundred frames is not reading two hundred captions.
- **On by default, with a workspace switch.** The opposite of the two-factor
  policy next to it, and for the opposite reason: the worst this can do is put a
  sentence in a field somebody overwrites, at roughly half a cent a frame.
- **People are still never suggested.** Unchanged, and the reason it is safe to
  run this unattended: naming a face is a factual claim with legal consequences,
  and the People field is left for the photographer, who was there.
- Open: whether a low-confidence draft should be written at all, or left empty
  with the reason recorded. Nothing is known yet about where a working
  photographer would put that line.

## The five-stage delivery flow

Approved 2026-08-31, from the eight reference screens, with the scope cuts
recorded here so the interface cannot quietly outrun the system.

- **Dispatch is walked as five stages: Photos → Details → Recipient →
  Review & share → Shared.** One package, one recipient, one persistent
  progression at `/dispatch/[shootId]`. This amends the earlier reading of
  "document, not a wizard" **for dispatch only**: dispatch is a multi-session
  piece of work whose stages are real states of the record, not sections of
  one form. Create Shoot remains a single document with no wizard, and the
  two-motion confirmation remains exactly where it was — at the point of
  consequence, now labelled **Create private delivery**.
- **The stages are a reading of the record, never a replacement for it.** The
  seven delivery facts (approved, link created, shared, opened, viewed,
  accepted, downloaded — `docs/DELIVERY_LINKS.md`) stay separate system facts
  with separate evidence. The stage in the URL is clamped server-side against
  those facts, and the working stages close at approval.
- **Draft packages are reachable.** "Save draft" is real persistence: the
  selection lives on a `draft` package and reconciles on every change.
  Without a schema slot for an idempotency key, draft creation converges
  deterministically — the earliest unapproved draft this operator holds on
  this shoot is *the* draft, and a race deletes its own memberless loser.
- **The dashboard's acid-green highlight is the flow's action signal**, per
  the landed design system (`--ml-highlight`), amending the blue-primary
  posture for migrated dashboard screens. Blue remains in unmigrated screens
  until each moves; the marketing surface is unaffected.
- **Still no email.** "Send by Mastline email" from the reference screens is
  deferred with its provider dependency and `delivery_emails` table. The
  per-delivery note is a plain-text note **on the delivery page**, stored on
  the link, frozen at share — never represented as a sent message.
- **Watermarks stay unconditional.** No "None" option; the photographer UI
  states `Recipient watermark: On` as a fact. Unmarked previews would weaken
  a control this workstream is not allowed to touch.
- **One recipient at a time.** No multi-recipient staging in the wizard;
  after sharing, **Share with another recipient** creates another distinct
  tracked delivery, preserving one-link-per-recipient.
- **Deferred with the email:** rich-text composition and the download-all ZIP
  route.

## Strategic pushback

Do not launch with a promise to discover every unauthorized use or predict every valuable news moment. Those promises depend on a trusted asset/license record that does not yet exist. The sequence is philosophical as well as practical: Mastline should first help a photographer remember their own work before claiming it can interpret the world around that work.

## Buyer requests — the status vocabulary

Recorded 2026-08-28, when Phase 1 of Buyer Requests landed. The brief proposed a
vocabulary; three points of it were changed, and one was kept against the
obvious instinct. All four are settled and should not be re-litigated without a
migration.

**`cancelled`, not `canceled`.** The brief spelled it with one L. Two existing
Postgres enums — `shoot_status` and `license_status` — already spell it with
two, and their TypeScript unions with them. One schema carrying two spellings of
one word is a bug waiting for whoever types the other one, and the cost of
picking the majority spelling is a single word in a brief.

**`won` exists in the enum and cannot be reached.** Winning a request means
connecting it to a license, and Mastline has no link between the two records
yet. The transition table in `src/lib/requests.ts` refuses it and the interface
names the absence rather than leaving a gap. It is in the enum so that Phase 2
adds a foreign key rather than a migration that rewrites an enum every row,
policy and index depends on.

**Nothing moves to `expired` on its own.** There is no scheduler in this system,
and a status that becomes true while nobody is watching is one nobody can trust
— the same reasoning that keeps `sent_at` and `delivered_at` write-once and
evidenced. A deadline that has gone by is derived at read time and rendered as
"Past deadline"; `expired` stays a transition somebody performs. If a scheduler
is ever built, it may write the status, and it must write an activity event
naming itself as the actor.

**A closed request cannot move at all**, not merely "cannot return to an active
state". Recording a request as lost and then rewriting it as cancelled changes
what happened. Correcting a mistake goes through the same audited purge path as
every other closed record in this system.

**Cancelled and declined stay separate**, because they are opposite facts about
the same ending: cancelled is the buyer withdrawing, declined is the
photographer saying no. Collapsing them would make "how often do we turn work
down" unanswerable, and that is one of the few numbers an independent operator
can actually act on.

### Deferred to Phase 2

The connection between a request and the work that answers it: no shoot,
package, submission or license links to a `buyer_request` yet. Also deferred:
any inbound ingestion (the `source` enum holds `email`, `portal` and `api`, and
only `manual` is written), automated archive matching, outbound messaging of any
kind, and a public buyer portal.

## Requests on the Work Queue (2026-08-31)

Phase 2 predates the deterministic ranking, so merging it forced four calls,
reviewed and ratified on 2026-08-31.

**Requests are the ninth round trip, not a screen of their own.** Inbound
demand joins the same fixed-cost load as everything else: one collection query
for the open statuses, whatever the workspace holds, and the query budget rose
from eight to nine to say so out loud. A query per request would have been the
old 3 + 4N shape sneaking back in.

**Only a passed response deadline is urgent.** It is a recorded, explicit date,
so it ranks class 3 beside a passed follow-up date and is drawn red with the
action "Answer". Phase 2 also drew "due within a day" in red; the redesign's
urgent contract — a recorded failure, an overdue payment, or a passed explicit
date — is narrower, and it won: due-soon is a prediction, not a recorded fact.
A due-soon request ranks class 9 with its reason spelled out in normal ink, and
promotes itself to red the moment the deadline actually passes.

**Request rows carry the "In preparation" chip.** Answering a desk is
preparing a response. A fifth "Requests" category was considered and declined
for now: it changes the filter contract, the counts, and the chip row for one
kind of item, and the reason string on each row already says why it is there.
Revisit if request volume makes the shared chip misleading.
