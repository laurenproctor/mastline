# Screen specifications

These specifications unify the prior visual concepts and product overview. Exact values shown in the UI are demo fixtures, not customer data.

## Global shell

Primary navigation: Work, News Radar, Shoots, Submissions, Money, Rights, Archive. Settings and identity/workspace controls sit at the bottom.

Global behavior:

- Organization switcher appears when a person belongs to more than one workspace.
- Search may resolve shoots, subjects, assets, submissions, buyers, licenses, payments, and rights matches.
- All mutations create an activity event containing actor, organization, entity, action, time, and safe before/after context.
- Sensitive notes and location/source fields are not exposed through global search to unauthorized roles.

## 1. Work Queue — `/work`

Question answered: **What needs attention now?**

Modules:

- Header with date, action count, and Import a Shoot
- Business pulse: net received, outstanding, median submission time, archive revenue
- Needs Attention queue spanning unfinished metadata, failed deliveries, pending outcomes, statement exceptions, overdue payments, rights matches, and archive opportunities
- On Deck shoot with caption/package progress
- Recently finished work and recent commercial activity

Queue actions: open/continue, assign, review, reconcile, snooze, and complete. Priority should combine deadline, commercial impact, workflow blockage, and confidence; expose why an item is ranked.

## 2. News Radar — `/news`

Question answered: **What is happening right now that this workspace should sell into or go shoot?**

One canonical news signal, evaluated through two independent paths and shown
as two modes of one radar, chosen by a prominent control and addressed in the
URL (`?mode=archive`, `?mode=shoot`):

- **Archive Matches** — can this story reactivate photographs the workspace
  already owns?
- **Shoot Opportunities** — does this story justify creating new photographs
  now?

A story is entered ONCE and appears in both modes; the tabs are two
evaluations of the same underlying signal, not two independently entered
copies. Queue columns: signal, story/source/time (from the canonical signal),
why it matters (stated basis plus confidence labelled as a suggestion), useful
window, status, next action. Watch and dismiss sit on the row for roles that
may decide; dismissing takes a second motion, keeps the optional reason on the
record, and never touches the story's other path.

Detail at `/news/[opportunityId]` reviews ONE path and says which: the
canonical story facts (shared, labelled as such), this path's suggestion kept
visibly apart from them, this path's lifecycle and history, a link to the same
story's other evaluation, and an honestly drawn not-yet-built region — matched
photographs for the archive path (Build Package stays unavailable until
matching exists), a shoot-brief handoff for the shoot path.

**Implemented:** manual entry at `/news/new` — the headline is the only
required fact, there is no archive-or-shoot choice, and one atomic submission
creates the signal and both paths (a repeated source URL is answered with the
existing records); watch and dismiss per path; the two-mode interface; all on
real records with activity events distinguishing the story's entry from each
path's decisions.
**Not yet connected:** live monitoring, archive matching, shoot creation from
a story, pitches, and estimated value. No buyer is contacted automatically and
nothing outbound happens from this screen.

## Commercial Opportunities — `/work/commercial`

Question answered: **Which assets have credible brand-licensing or commerce potential, and what needs human review next?**

The queue is the full review list. It shows the subject, leading detected item and brand, match class, rights state, opportunity score, workflow stage, and age. Selecting a row updates an adjacent preview; opening it leads to `/work/commercial/[opportunityId]`.

The single-opportunity review keeps the source asset beside its suggested product matches. A reviewer can correct each match class, confirm products individually or together, and then choose one of two routes:

- Prepare a brand-licensing pitch for human review. Nothing is sent automatically.
- Generate a disclosed Shop-the-Look draft with tracked-link placeholders.

Editorial clearance does not imply permission for advertising or endorsement. Product recognition remains suggestion-only until a person confirms it, and commercial uses remain use-specific.

## 3. Create Shoot — `/shoots/new`

Question answered: **What are we pursuing, where, when, and for whom?**

One page, one action. Sections in order: shoot details, photographs, metadata shared by the photographs, rights and usage, final review. Every section is mounted at once — this is a document, not a wizard — so moving between them loses nothing.

Upload/intake methods: drag/drop, folder, mobile/camera upload, watched folder. Accept a brief without files and files without a finished brief. Files chosen here are hashed and staged; they become assets when the shoot is created.

Fields:

- Subject/event and story angle
- Date/time window, place, and logistics
- Source/tip, priority, photographer, collaborators
- Assignment/agency and target buyers
- Expected expenses
- Exclusivity, embargo, sensitive content, confidentiality
- Notes and reusable template

On ingest, extract capture time, camera/lens, IPTC, copyright, sequence/bursts, hashes, and possible duplicates. Preserve the original and create delivery derivatives separately.

Primary action: **Create shoot**. It writes a private draft in `draft` status and redirects to the shoot workspace, where the confirmation appears on the record. It sends, publishes, submits, and bills nothing.

The final review reports rather than gates. Only two things stop a draft being written: no subject or event, and a file still uploading. Missing captions, credit, and copyright are named because the dispatch review will require them, and creating the draft is not blocked on them.

Rights fields here — exclusivity, embargo, sensitive content, usage restrictions — are editable metadata, not a binding attestation. The representations a photographer makes about what may be sent live at the dispatch gate, which is the point of consequence.

## 4. Shoot Workspace — `/shoots/[shootId]`

Question answered: **What is happening on this job, and what comes next?**

Top state: shoot name, status, import/processing, total files, selected count, caption completeness, package status, and Dispatch action.

Center contact sheet:

- Thumbnails, burst groups, ratings/color labels
- selected/rejected states and quality/metadata warnings
- compare, bulk select/reject, apply metadata, add to package, send to editor

Inspector:

- Headline, caption, subjects, location, keywords
- credit, copyright, usage restrictions
- capture and technical metadata
- caption history, provenance, derivatives, and any AI suggestion evidence

Supporting workspace information: brief, timeline, map/logistics, contacts, notes, team messages, costs, and the explicit next action. Optimize key field actions for mobile and keyboard use.

## 5. Delivery Flow — `/dispatch/[shootId]`

Question answered: **How does this package reach one recipient, honestly?**

One persistent five-stage progression, per package, per recipient:

1. **Photos** — choose the frames. The selection lives on a draft package and
   saves as it changes; a refresh renders exactly what is stored.
2. **Details** — Headline, Caption, and People per frame, with readiness from
   the same metadata rules the contact sheet and the approval gate use. A
   drafted caption still needs a person to read and save it.
3. **Recipient** — the Potential Buyer, the terms, and the per-link access:
   expiry, an optional plain-text recipient note, whether full-resolution
   files are offered, and whether viewing waits for the terms. Previews are
   always watermarked per recipient; that is a fact on the screen, not a
   setting.
4. **Review & share** — every check, then the one confirmed act: **Create
   private delivery**, which freezes the package into an immutable Submission
   Record and creates one tracked recipient link. Nothing is shared yet, and
   the screen says so. Copying the link writes nothing; **Mark as shared** is
   the separate, deliberate statement that the link went out.
5. **Shared** — the evidence timeline: shared, opened, terms accepted,
   downloaded — each shown only once it is recorded. From here: follow-up
   reminder, the submission record, and **Share with another recipient**,
   which creates another distinct tracked link.

The stage in the URL is clamped against the record: an address naming a stage
the facts do not support lands on the work that is actually next, and the
working stages close permanently at approval.

Statuses underneath are unchanged: draft, needs_review, ready, approved,
sending, delivered, failed, recalled — the seven delivery facts of
`docs/DELIVERY_LINKS.md` remain the record; the stages are a reading of them.
A failed delivery creates a high-priority Work Queue item.

The create act keeps the fresh human confirmation — a second, explicit act
showing the frames, the buyer, the terms, and the restrictions before it
commits. This gate is deliberately the only confirmation step in the shoot
lifecycle; creating a shoot has none. The five stages are navigation through
one continuing piece of work, not a re-confirmation at every step — the
create-shoot page remains a single document, and the anti-wizard stance there
stands.

## 6. Submission Record — `/submissions/[submissionId]`

Question answered: **What was sent, under which terms, and what happened?**

Record:

- Exact package/assets/derivative versions
- Buyer, recipients, method, external reference, and timestamps
- Proposed terms, exclusivity, embargo, and restrictions
- Delivery receipt, status, feedback, follow-up date
- Sale/no-sale/recalled outcome and related license/payment

Essential actions: update status, prepare follow-up, record outcome, link sale/payment. Never overwrite the factual record of what was sent.

## 7. Asset Record — `/assets/[assetId]`

Question answered: **What is this image’s complete commercial history?**

Canonical record:

- Original and derivatives with hashes and creation history
- Capture data, subjects, place, shoot, caption history
- creator, copyright owner, ownership share, restrictions
- submissions, licenses, known usage, rights matches
- reported, received, and lifetime earnings

Primary actions: edit current metadata (without destroying history), add to package, inspect usage, inspect earnings, export.

## 8. Rights Matches — `/rights`

Question answered: **Is this observed use authorized?**

Queue groups detections by asset and publisher. Each match stores source URL, publisher/domain, first/last observed, screenshot/evidence, matching method, confidence, license-check result, and status.

Statuses: new, reviewing, licensed, ignored, monitoring, escalated, resolved. Human routes: verify license, preserve evidence, ignore, monitor, contact, invoice, or counsel-defined review.

The product must say “no linked license found,” not “copyright infringement,” unless a qualified human made and recorded that determination.

## 9. Revenue & Payments — `/money`

Question answered: **What has been earned, paid, delayed, deducted, or lost?**

Top metrics: net received, outstanding, unmatched statement lines, and average time to payment.

Reconciliation queue columns: status, sale/reference, agency/buyer, reported, expected, difference, and action. Store statements, deductions/commission, invoices, due/paid dates, aging, splits, expenses, and estimated net.

Views/filters: buyer, shoot, asset, subject, period, status. Essential actions: import, match/reconcile, record payment, prepare follow-up, export, and analyze.

## 10. Archive — `/archive`

Searchable commercial memory. Filters include subject, date/event/place, shoot, photographer, buyer, submission, sale/license state, rights clearance, revenue, and file type. Results expose commercial state—not only visual similarity.

## Marketing homepage — `/welcome`

Core message: **Every image needs a commercial memory.**

Required sections: product thesis, operating loop, Work Queue preview, archive intelligence/News Radar preview, Sales Engine with explicit 70/30 split, rights/provenance, and larger purpose.

## Pricing — `/pricing`

Final plans:

| Plan | Annual | Monthly | Key limits/capabilities |
| --- | --- | --- | --- |
| Solo | $49/month billed annually | $59/month | 1 photographer, core workflow, 250 GB |
| Pro | $99/month billed annually | $119/month | Solo plus news/archive/rights intelligence, 1 TB |
| Studio | $279/month billed annually | $339/month | Pro plus 5 people, approvals, allocation, 5 TB |
| Agency | Custom | Custom | Team structure, migration, API/integrations, permissions, priority support, flexible storage |

Default to annual billing, mark Pro “Most popular,” and provide a functioning Annual/Monthly toggle. Solo, Pro, and Studio use “Start free”; Agency uses “Talk to us.” Trial length remains unresolved.

The optional Sales Engine appears beneath the plans: the photographer receives 70% and Mastline receives 30% only on licenses generated inside Mastline. The annual rates save up to 17.7% versus twelve monthly payments, so the displayed rounded claim is “Save up to 18%.”
