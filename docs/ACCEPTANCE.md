# Acceptance criteria and test matrix

## Repository and UI

- `npm run typecheck` and `npm run build` pass.
- All routes in README render without an uncaught error.
- App navigation is keyboard-accessible and shows a visible focus state.
- Desktop works at 1440×900; tablet at 1024×768; mobile work queue and shoot inspector work at 390×844.
- Status is never indicated by color alone.
- Pricing shows Solo $49 annual/$59 monthly, Pro $99/$119, Studio $279/$339, and Agency custom.
- Annual is selected by default; the toggle changes every non-custom plan without changing its features.
- The page marks Pro most popular, keeps “Start free” on paid self-serve plans, and does not invent a trial duration.
- Annual totals are $588, $1,188, and $3,348; the savings claim does not exceed the actual 17.7% maximum (rounded to 18%).

## Tenancy and security

- Anonymous users cannot query business records or private storage.
- Org A owner cannot read, mutate, list, or sign a URL for Org B records/files.
- Org A viewer cannot mutate records.
- Finance access does not imply access to confidential source notes.
- Rights reviewer can see evidence but cannot send a demand without an approved workflow.
- Service/secret keys never appear in browser bundles, logs, or client environment variables.
- Update policies include both visibility and write checks.

## Workflow

- A draft shoot can exist without files.
- An imported file records hash, size, MIME type, object key, and import time.
- The original version cannot be overwritten by a derivative.
- Dispatch cannot be approved when required metadata is missing.
- A sent submission preserves exact asset-version membership and terms.
- Repeating an external delivery webhook does not create a duplicate submission/event.
- A failed delivery creates one actionable queue item and can be safely retried.
- A sale/payment can be linked after submission without rewriting submission history.

## Money

- All monetary values use integer minor units and explicit currency.
- Partial and multi-license payments reconcile through allocations.
- Gross, deductions, platform fee, photographer share, expenses, splits, and net remain separately inspectable.
- The optional Sales Engine 70/30 calculation is covered by tests including refunds and rounding before checkout launches, and applies only to licenses generated inside Mastline.

## Rights and automation

- A visual match stores evidence and confidence separately from human status.
- “No linked license found” does not become “unlicensed infringement” automatically.
- Suggested captions, buyers, values, matches, and follow-ups expose basis/confidence and are editable.
- Dispatch, follow-up, invoice, escalation, and takedown actions require explicit confirmation.

## First-pilot success gate

With one real photographer, complete five live shoots through recorded commercial outcome. Measure capture-to-first-dispatch time, metadata pass rate, manual re-entry, submission follow-up visibility, and sale-to-payment visibility. Do not prioritize News Radar sophistication until this gate is met.
