# Mastline photographer onboarding — design QA

## Evidence

- Source visual truth:
  - Welcome: `/workspace/scratch/22787a5372c4/generated_images/exec-79bb42d7-7c0b-4bae-80f7-0437ffbce4ce.png`
  - First shoot: `/workspace/scratch/22787a5372c4/generated_images/exec-a1b5e1bd-af95-4d07-ad85-94d9658409e0.png`
  - Review: `/workspace/scratch/22787a5372c4/generated_images/exec-2f6a7885-6ba9-494b-a6f6-dc462392ab3b.png`
- Browser-rendered implementation screenshots:
  - `/workspace/scratch/22787a5372c4/mastline-qa-artifacts/welcome.jpg`
  - `/workspace/scratch/22787a5372c4/mastline-qa-artifacts/profile.jpg`
  - `/workspace/scratch/22787a5372c4/mastline-qa-artifacts/priorities.jpg`
  - `/workspace/scratch/22787a5372c4/mastline-qa-artifacts/first-shoot.jpg`
  - `/workspace/scratch/22787a5372c4/mastline-qa-artifacts/review.jpg`
  - `/workspace/scratch/22787a5372c4/mastline-qa-artifacts/rights.jpg`
  - `/workspace/scratch/22787a5372c4/mastline-qa-artifacts/ready.jpg`
- Side-by-side comparison evidence:
  - `/workspace/scratch/22787a5372c4/mastline-qa-artifacts/compare-welcome.jpg`
  - `/workspace/scratch/22787a5372c4/mastline-qa-artifacts/compare-first-shoot.jpg`
  - `/workspace/scratch/22787a5372c4/mastline-qa-artifacts/compare-review.jpg`

## Capture normalization

- Browser CSS viewport: `1363 × 936` at device scale factor 1.
- Source images: `1487 × 1058` pixels. Each was resized with cover semantics and center-cropped to `1363 × 936` before comparison.
- Implementation captures: welcome `1363 × 936`; first-shoot and review `1348 × 926` visible-page captures after the browser reserved scrollbar/UI pixels. The comparison preserves their native aspect ratio; the small browser-reserved inset does not change the layout judgment.
- States compared: welcome/default, sample first-shoot selected, and review/default first frame. The profile, priorities, rights, and ready states were also rendered and inspected independently.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation uses Mastline's actual Newsreader display face and Inter UI face. Headline scale, optical weight, tight serif leading, uppercase metadata labels, and compact UI text preserve the visual hierarchy of the source directions.
- Spacing and layout rhythm: the asymmetric editorial grids, ruled progress track, dense metadata rows, fixed action rail, and image-to-form proportions remain consistent across all seven steps. Long profile and priority screens retain bottom clearance for the fixed action rail.
- Colors and visual tokens: warm paper and surface colors, black ink, electric-blue primary actions, and acid-green operational selection states map directly to the repository brand tokens. The source concepts' exploratory neon CTAs were intentionally replaced by blue to follow the Mastline brand rule that acid green is reserved for selection and operational state.
- Image quality and asset fidelity: the production Mastline wordmark is used rather than the exploratory generated mark. Four purpose-generated photographic assets are sharp, consistently art-directed, correctly cropped with `next/image`, and contain no CSS drawings, inline SVG stand-ins, emoji, or placeholder art.
- Copy and content: every step uses photographer-specific language and explains why information is requested. Rights copy avoids legal conclusions, keeps consequential actions under human confirmation, and accurately states the optional 70/30 Mastline-generated-sale split and 100% direct-sale ownership.
- Interaction and accessibility: semantic buttons, fieldsets, labels, radio/checkbox controls, pressed states, focus-visible treatments, required workspace-name gating, descriptive alt text, and a visible seven-step progress state are present. Responsive CSS collapses grids at 1050px and 680px without removing the core journey.

The full-view comparisons were sufficient for the primary fidelity judgment because the actual Mastline logo, typography, controls, metadata rows, active-state borders, copy, and image crops remain legible at original capture resolution. Focused-region crops were not needed.

## Primary interactions tested

- Progressed through all seven onboarding stages.
- Verified Back and Continue state changes.
- Verified workspace-name validation disables Continue when blank.
- Selected work model, specialties, and onboarding priorities.
- Switched first-shoot modes and verified file/sample messaging.
- Switched review thumbnails and verified selected-frame state.
- Verified ownership, restriction, and optional Sales Engine controls.
- Verified final workspace form carries the workspace name and timezone into the existing server action.

Automated interaction coverage is in `src/app/onboarding/onboarding-flow.test.tsx`. The full suite passed: 487 tests passed; database-dependent tests remained skipped by their existing environment gates.

## Console and build checks

- Browser console: no application-origin errors. The connected cloud browser reported only its own extension metadata warning, which is outside the implementation.
- ESLint: passed.
- TypeScript: passed with `tsc --noEmit`.
- Production build: passed with Next.js 16.2.4.
- Existing repository warning: the pre-existing `middleware` convention is deprecated in Next.js 16; this onboarding change does not introduce or modify that warning.

## Comparison history

- Pass 1: welcome, first-shoot, and review source/implementation composites were inspected together. No P0/P1/P2 mismatch was found, so no visual remediation iteration was required.
- Intentional deviations accepted: the repository's real wordmark replaces the exploratory generated marks; blue replaces exploratory neon for primary CTAs; the implementation expands the concept into a truthful seven-step product flow.

## Implementation checklist

- [x] All seven screens render with real Mastline branding.
- [x] Core selection, validation, review, rights, and finalization states are covered.
- [x] Authenticated route and existing workspace-creation server action remain intact.
- [x] Browser visuals, console, lint, types, tests, and production build are verified.

final result: passed

---

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
