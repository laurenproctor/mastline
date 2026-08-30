# Work Queue Stage 5A — behaviour checklist

Stage 5A extracts the valuable behaviour of PR #13 ("Make the work queue answer
which action moves work forward", `worktree-work-queue-redesign@646e824`) onto
current `main` as a **data foundation only**. The rendered Work Queue keeps its
present layout, components, and stylesheet; what changes is the order and
wording of the rows it lists, which now come from a deterministic ranking, and
the loader behind them. Stage 5B rebuilds the visible screen on the Stage 4A
surfaces on top of this.

Every behaviour PR #13 introduced is listed below with where it lived there,
where it lives now, and what was done with it. "Retained" means reapplied
against current contracts by reading the old implementation, not cherry-picked.

## Ranking and queue

| Behaviour | PR #13 | Stage 5A | Disposition |
| --- | --- | --- | --- |
| Nine deterministic ranking classes (failure → overdue payment → passed follow-up → metadata blockers → package review → missing recipient link → awaiting outcome → unallocated money → other unfinished work) | `src/lib/data/work-queue.ts` `buildWorkQueue`, `WorkQueuePriority` | same names in **`src/lib/data/work-queue-ranking.ts`** (pure, no database imports), re-exported by `work-queue.ts` | **Retained.** Class numbers, membership, and titles as in #13. |
| Class 8 covers every received payment with an unallocated balance | class 8 | same | **Retained.** `main`'s queue listed only `source = "statement"` payments here; the header's "Unmatched" figure keeps that narrower definition, the queue row does not. |
| Ranking precedence | `buildWorkQueue` sort | `buildWorkQueue` sort | **Retained.** Priority class first. |
| Deterministic tie-breaking | class → most recent activity → id | same | **Retained**, and pinned by a new test that shuffles the input collections and asserts the identical queue. |
| `rankingBasis` on every item | `WorkQueueItem.rankingBasis` | same | **Retained.** The current page already renders it. |
| `urgent` only for a recorded failure, an overdue payment, or a passed explicit follow-up | `WorkQueueItem.urgent` | same | **Retained**, pinned by a new test. `main`'s queue also flagged metadata items on `priority = "urgent"` shoots; that flag now stays off, as #13 decided. |
| Metadata blockers judged by the shared `metadata-rules`, including an unreviewed drafted caption | narrow asset select incl. `caption_*` columns | same columns | **Retained.** `main`'s loader did not select the caption-review columns, so a drafted caption was not a blocker on the queue although it is at dispatch; it is now. |
| A queued submission with no delivery link says "Create link", never "Send" | class 6, `actionLabel: "Create link"` | same | **Retained.** |
| Awaiting outcome and unallocated money stay distinct classes (7 and 8) and distinct categories | classes 7 / 8 | same | **Retained.** |
| Workspace-scoped `href` on every item | `routes.*` builders | same | **Retained** (already on `main`). |
| No scores, forecasts, predictions, or per-photo views anywhere in the queue | test assertion | same test | **Retained.** |

## Filter contract

| Behaviour | PR #13 | Stage 5A | Disposition |
| --- | --- | --- | --- |
| `?queue=all\|in-preparation\|ready-to-send\|awaiting-outcome\|money` | `WORK_QUEUE_FILTERS`, `isWorkQueueFilter` in the data module; filtering inside `AttentionQueue` component | `WORK_QUEUE_FILTERS`, `isWorkQueueFilter`, **new pure `filterWorkQueue`** in the data module | **Retained and moved out of the UI.** The current page does not read the parameter yet (no filter control exists on it); Stage 5B wires it. |
| Filter counts | `workQueueCounts` | same | **Retained**; a new test proves each count equals the filtered length. |

## Dashboard contract

| Behaviour | PR #13 | Stage 5A | Disposition |
| --- | --- | --- | --- |
| Recipient-activity rows from recorded access events: opens, acceptances, refusals individual; downloads grouped per delivery with the latest time; neutral recipient fallback; never a per-photo "viewed" | `buildRecipientActivity` | same | **Retained.** |
| Money-to-reconcile summary: expected net/count, unallocated net/count, awaiting-outcome count | `buildMoneySummary` | same | **Retained.** Statuses now read from the exported `OUTSTANDING` set in `data/money.ts` rather than a second literal. |
| Active-shoot summary (two most recent open shoots): totals, selection, metadata percent, blockers, package label, link label, next action | inside `getWorkQueueDashboard` with two extra queries | same fields, computed from the queue's own asset rows | **Retained, made cheaper** (see budget). |
| Signed preview URLs per active shoot | always, via `asset_versions` + storage signing | **opt-in** `previewsPerShoot` option, off by default | **Retained behind an option.** Costs +1 collection query and +1 storage call; the screen that would show them is not built. |
| Header pulse (net received, outstanding, unmatched, overdue count, median dispatch minutes) | not in #13 (the page kept calling `getWorkPulse`, 7 more queries) | **new `buildWorkPulse`** from the loaded facts; `WorkQueueDashboard.pulse` | **Added.** Same definitions as `getMoneySummary` / `getMedianDispatchMinutes`, proven by a pure test; lets Stage 5B drop the seven duplicate calls. |
| Delivery-token non-exposure | delivery select of `id, submission_id, recipient_label` | same | **Retained.** Tested at the data layer (dashboard and queue JSON never contain the token) and in the browser (no `/d/` link, no token-shaped text). |
| Organization isolation under RLS | `tests/work-queue-isolation.test.ts` | same file, reworked | **Retained.** The recorded open is now produced by `open_delivery`, the function recipients actually hit — `main` no longer lets any role, service included, insert an access event directly. |
| Fixed-query behaviour | 11 REST calls (+1 storage) | **8** REST calls, 0 storage (queue alone: 7) | **Improved.** See the budget below. |
| `getWorkQueue` compatibility wrapper | same fetch and ranking as the dashboard | same | **Retained.** The current page keeps calling it unchanged. |
| `getWorkPulse` / `getMedianDispatchMinutes` | unchanged from `main` | `getMedianDispatchMinutes` now delegates to the pure `medianDispatchMinutes` and reads two shoot columns instead of `listShoots`; `getWorkPulse` unchanged | **Refactored without behaviour change**; the page's figures are identical. |

## Query budget

`main` held `getWorkQueue` to ≤ 8 PostgREST calls and measured **7** on the
seeded workspace (`shoot_sensitive_notes`, `shoots`, `submissions`, `payments`,
`packages`, `package_assets`, `assets`). PR #13's dashboard measured **11**
(+ `submission_deliveries`, `delivery_access_events`, a second `assets` query
for active-shoot totals, `asset_versions` for previews) plus one storage call.

Stage 5A, measured on the same seeded workspace by
`tests/work-queue-performance.test.ts`:

| Loader | REST calls | Storage calls | Grows with shoots? |
| --- | --- | --- | --- |
| `getWorkQueue` (page today) | **7** | 0 | no (7 → 7 with five more shoots) |
| `getWorkQueueDashboard` | **8** | 0 | no (8 → 8) |
| `getWorkQueueDashboard({ previewsPerShoot: 4 })` | 9 | ≤ 1 | no (9 → 9) |

How the richer contract fits the budget:

- **Removed a lookup the ranking never reads.** `listShoots` also fetches
  `shoot_sensitive_notes` to set `hasSensitiveNote`; the queue selects the
  seven shoot columns it uses directly. −1.
- **Reused the asset rows.** The asset query is scoped to the open shoots —
  the only ones the ranking ever considers — and no longer filtered to
  `selected = true`, so the active-shoot totals (`totalAssets`,
  `selectedCount`) come from the same rows. −1, and the query no longer scans
  selected assets across the whole archive. It waits for the shoot ids, so it
  is one round trip later, not one more; when no shoot is open it is skipped.
- **Computed the header pulse from records already loaded.** −7 for the page
  once Stage 5B reads `dashboard.pulse` instead of calling `getWorkPulse`.
- **Made previews explicit.** The only thing that costs more than the budget
  is the preview strip, and it is an option whose price is stated at the call
  site.

The eighth call is `delivery_access_events` (newest 40, one query). It cannot
be folded into another collection without embedding events under every
delivery, which would scale the delivery query with history rather than with
open work.

Not changed: the page still issues its own `listShoots`, `listActivity`,
`listAssets` (on-deck) and `getWorkPulse` calls exactly as before — Stage 5A
does not touch the page's data wiring. Stage 5B replaces them with the one
dashboard load.

## Rejected from PR #13

| Item | Why |
| --- | --- |
| `src/app/[workspace]/work/page.tsx` (new composition) | Stage 5B rebuilds the screen on Stage 4A surfaces; the current page stays as it is. |
| `work/_components/{next-up,attention-queue,active-shoots,recipient-activity,money-reconcile}.tsx` | Styled with legacy classes; rebuilt in 5B on `PriorityCard`, `OperationalList`, `FilterChip`, `Metric`, `Card`. |
| 388 lines of `.work-*` rules in `src/app/globals.css` | The design system owns these surfaces; `globals.css` is also owned by open PR #2. |
| `PageHeader` change (`action`/`href`, "Import a shoot") | Superseded by the shared `PageHeader` Stage 2 put on `main`. |
| `formatFullDate` | Only the rebuilt header used it; not required by the data layer. Stage 5B may add it. |
| `e2e/dispatch-delivery-lifecycle.spec.ts`, `e2e/workspace-routing.spec.ts` repairs | Partly already on `main`; the rest asserts #13's own UI. |
| `docs/SCREENS.md` rewrite of the Work Queue section | Describes the 5B screen; written when that screen exists. |
| `e2e/work-queue.spec.ts` (most of it) | Asserts "Next up", filters, active-shoot cards. The viewport-independent expectations — workspace-scoped row actions, no write action for a viewer, no delivery credential on the page — are kept in a new `e2e/work-queue.spec.ts` against the current screen. |

## Tests

- `tests/work-queue-ranking.test.ts` — PR #13's 15 pure tests, plus 6 new: shuffled-input determinism, urgency limited to the three facts, the five filter values, filter counts as proof, pulse definitions, median over positive durations. No database.
- `tests/work-queue-isolation.test.ts` — under RLS: the recorded open is on the board for the link's recipient, the token appears nowhere in the dashboard or the queue, a linked submission is not asked for a link, nothing of the other workspace, previews only when asked and only derivatives, the other workspace shows nothing of this one.
- `tests/work-queue-performance.test.ts` — counts calls for the queue, the dashboard, and the dashboard with previews before and after five more shoots; asserts constancy, the ≤ 8 budget for both loaders, zero storage calls without previews, and exactly +1 with them.
- `e2e/work-queue.spec.ts` — the current page renders without errors, every row action is workspace-scoped, every row states a basis, a viewer sees no "Create shoot", no `/d/` link and no token-shaped text.

## What the current page shows differently

The page's JSX, layout, components, and CSS are untouched. Because it reads
`getWorkQueue`, its rows now follow the deterministic ranking: order by class
rather than urgent-then-time; titles use an em dash ("Delivery failed — REF");
money details are formatted ("$1,200 past its due date" rather than
"1200 outstanding"); follow-up and allocation actions read "Review" and
"Allocate" rather than "Record" and "Match"; four kinds of item appear that
did not before — an open shoot with nothing selected, a draft package, an
approved submission with no recipient link, and a received non-statement
payment with an unallocated balance. The header figures, the on-deck
card, and recent activity are unchanged.

## Stage 5B dependencies

- Read `getWorkQueueDashboard` once and drop `getWorkQueue` + `getWorkPulse` + `listShoots` + `listAssets` from the page.
- Wire `searchParams.queue` through `isWorkQueueFilter` → `filterWorkQueue`, with `workQueueCounts` on the filter controls.
- Decide previews: `previewsPerShoot: 4` costs +1 REST +1 storage.
- `recentActivity` (the activity-events panel) is not in the dashboard; keep `listActivity` or add it as a ninth call — a budget decision for review.
- Rebuild the five panels on Stage 4A surfaces; no `globals.css` rules.

## PR #13 disposition

Once Stage 5A merges, every behaviour in the tables above is on `main` or
consciously rejected. PR #13 can then be closed as superseded, with a comment
pointing at this checklist. Not done here: closing, commenting on, or updating
PR #13 waits for explicit approval.
