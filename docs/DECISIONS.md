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
- No route-level `loading.tsx`. It wraps its subtree in an implicit Suspense
  boundary, and with one present a Server Action that revalidated the route it
  was invoked from left its promise unresolved on the client: the write landed,
  the server re-rendered in under 100ms, and the form sat on "Saving..." for
  ever. Measured at 15 hangs in 60 saves with the file and 0 in 60 without. It
  also stopped `router.refresh()` reliably taking effect, which the contact
  sheet depends on after a selection or rating. Both failures are silent.
  Navigation feedback, if wanted again, needs something that does not wrap a
  route in Suspense. Guarded by `tests/route-loading-boundary.test.ts`.

## Strategic pushback

Do not launch with a promise to discover every unauthorized use or predict every valuable news moment. Those promises depend on a trusted asset/license record that does not yet exist. The sequence is philosophical as well as practical: Mastline should first help a photographer remember their own work before claiming it can interpret the world around that work.
