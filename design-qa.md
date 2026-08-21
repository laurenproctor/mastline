# Commercial opportunities design QA

## References

- Queue mockup: the full list of assets needing commercial review, with a selected preview.
- Review mockup: one asset beside its detected products, confidence, and next decisions.
- Mastline source: existing AppShell, warm-paper tokens, serif display type, dense operational tables, blue action signal, and acid confirmation state.

## Flow acceptance

- PASS — Commercial is a native Mastline sidebar destination at `/commercial`.
- PASS — Selecting a queue row updates the adjacent preview.
- PASS — The primary preview action opens `/commercial/[opportunityId]`.
- PASS — Each detected product can be reclassified and confirmed independently.
- PASS — Pitch and Shop-the-Look drafts require all product matches to be confirmed.
- PASS — Pitch preparation creates a reviewable draft and never sends it.
- PASS — The commerce route includes a visible affiliate and non-endorsement disclosure.
- PASS — Desktop and narrow layouts preserve queue readability and stack the review workspace without horizontal overflow.

## Visual check

- PASS — The queue keeps the first reference's list-and-preview hierarchy while using Mastline's existing sidebar and page header.
- PASS — The review keeps the second reference's photo-led split view, oversized score, product rows, and acid confirmation action.
- PASS — New styles are route-scoped in `src/app/commercial/commercial.css`; the global Mastline stylesheet is unchanged.
- PASS — Generated people and product imagery is optimized to WebP and displayed at stable aspect ratios.

## Verification

- TypeScript: passed.
- ESLint: passed.
- Component tests: 3 passed for confirmation, pitch, and Shop-the-Look gating.
- Full available suite: 407 passed; database-backed tests skip without the local Supabase stack.
- Production build: passed with `/commercial` and `/commercial/[opportunityId]` included.
