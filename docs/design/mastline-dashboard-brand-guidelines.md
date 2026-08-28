# Mastline Dashboard Brand & Interface Guidelines

Version 1.0 — August 2026

## The governing idea

Mastline is an editorial command center for working photographers. The dashboard should feel closer to a serious newsroom, contact sheet, and rights ledger than a generic SaaS product.

The interface must answer three questions quickly:

1. What deserves attention now?
2. What is the current state of the work?
3. What action moves it closer to publication, protection, or payment?

The design should feel precise, calm, credible, and commercially aware. Visual restraint is not decoration; it protects the photographer's attention and gives the photographs themselves authority.

## Core principles

### 1. Editorial in hierarchy, operational in use

Use the serif typeface to establish editorial importance: page titles, shoot titles, package headlines, story names, and major financial values. Use the sans-serif typeface for navigation, controls, statuses, metadata, forms, filters, tables, and explanatory copy.

Do not render the entire interface in serif. It weakens scanning and makes operational screens feel antiquated rather than editorial.

### 2. Quiet surfaces, decisive actions

Most of the product lives in warm neutrals. Black marks the primary action. The green highlight marks Mastline-specific intelligence or a meaningful current state. Red, amber, green, and blue communicate status—not decoration.

### 3. Structure through rules, not floating cards

Prefer thin borders, aligned rows, section rules, and shared baselines. Cards should be nearly square and used to group genuine objects or decisions. Avoid excessive rounding, soft shadows, nested cards, and detached “widget” layouts.

### 4. Photography remains the visual protagonist

Photographs use strong, consistent aspect ratios and clean crops. UI color must never compete with the imagery. Image cards may contain controls and metadata, but decorative gradients, heavy overlays, and ornamental frames should be avoided.

### 5. Urgency must be earned

Reserve red for overdue, failed, blocked, disputed, or destructive states. Reserve amber for approaching deadlines or incomplete decisions. Do not use these colors merely to attract attention.

## Brand personality

| Attribute | Mastline expression | Avoid |
| --- | --- | --- |
| Editorial | Serif display type, strong headlines, disciplined rules | Magazine pastiche or ornamental typography |
| Precise | Aligned metadata, tabular numbers, clear states | Decorative ambiguity or dense prose |
| Urgent | One obvious next action and honest deadlines | Multiple competing primary buttons |
| Premium | Space, restraint, excellent image treatment | Glossy gradients, oversized radii, excessive shadows |
| Commercial | Revenue, rights, buyer, and outcome information is visible | Treating monetization as a hidden secondary concern |
| Trustworthy | Explicit statuses, timestamps, provenance, and confirmation | Vague automation or unexplained state changes |

## Design tokens

The canonical tokens live in `mastline-dashboard-design-system.css`. Components should consume these variables rather than hard-coded values.

### Color

| Token | Value | Use |
| --- | --- | --- |
| `--ml-ink` | `#171715` | Primary text, primary buttons, selected controls |
| `--ml-canvas` | `#f4f2ed` | Main workspace background |
| `--ml-canvas-deep` | `#eeebe4` | Sidebar and recessed surfaces |
| `--ml-surface` | `#fffefa` | Panels, cards, list surfaces |
| `--ml-border` | `#d9d5cc` | Default dividers and borders |
| `--ml-text-muted` | `#6f6b63` | Supporting copy and metadata |
| `--ml-highlight` | `#c8ef39` | Mastline intelligence, current progress, special confirmation |
| `--ml-danger` | `#c72e23` | Overdue, blocked, failed, destructive |
| `--ml-warning` | `#8a6415` | Approaching deadline, incomplete decision |
| `--ml-success` | `#2f6b45` | Paid, licensed, complete, verified |
| `--ml-info` | `#4657a7` | Informational or in-progress states |

Never place semantic color on a component without a text label or accessible name. Color reinforces state; it does not define state by itself.

### Typography

- Display family: use the existing Mastline serif font variable through `--ml-font-display`.
- UI family: use the existing Mastline sans-serif variable through `--ml-font-ui`.
- Monospace: identifiers, file references, and machine-oriented values only.
- Page title: display serif, 36–62px responsive, medium weight, tight tracking.
- Object title: display serif, 20–28px.
- Operational section title: UI sans, 13–16px, bold.
- Body: UI sans, 14px with generous line height.
- Metadata: UI sans, 11–12px. Do not go below 10px.
- Labels and eyebrows: uppercase only when short; use increased tracking.

Sentence case is the default. Avoid title case in buttons, filters, navigation, and form labels.

### Spacing

Use the four-pixel system in the CSS tokens. The most common values are:

| Context | Default |
| --- | --- |
| Icon-to-label gap | 8px |
| Compact control gap | 8px |
| Field label-to-input | 8px |
| Card padding | 20px |
| Panel header horizontal padding | 20px |
| Major section gap | 28–32px |
| Page horizontal padding | 40px desktop, 16px mobile |
| Page bottom breathing room | 64px desktop |

Spacing should reveal hierarchy. Do not use the same gap between every element.

### Geometry and depth

- Controls and panels use 2–4px radii.
- Pills are reserved for status badges and compact filter chips.
- Avatars are circular.
- Shadows are reserved for raised priority cards, menus, drawers, dialogs, and temporary overlays.
- Never stack a shadowed card inside another shadowed card.
- Use one-pixel borders for persistent structure.

## Page anatomy

All dashboard screens should use the same skeleton:

1. Persistent workspace sidebar.
2. Contained page canvas using `.ml-page`.
3. Page header with an eyebrow, one display title, optional explanation, and one primary action.
4. Optional tabs for changing views of the same object or workflow.
5. One dominant work surface, with an optional 320–360px contextual rail.
6. Feedback and state changes near the action that caused them.

Use `.ml-page--wide` for media-heavy screens such as Shoot Workspace and package assembly. Use `.ml-page--narrow` for forms, settings, and focused confirmation flows.

## Component rules

### Sidebar

- Keep navigation order stable across every workspace.
- The active item uses a white surface, dark text, and a two-pixel leading rule.
- Use badges only for actionable counts, not total database counts.
- On mobile, the sidebar becomes a horizontally scrollable bottom navigation.
- Iconography should come from the application's existing icon library. Use one icon family and a consistent 16–18px optical size.

### Page headers

- One page title only.
- The eyebrow may contain date, workflow stage, or parent object—not marketing copy.
- Allow one dark primary action. Secondary actions are outlined or quiet.
- Do not place filters in the title row; place them below it.

### Buttons

| Style | Use |
| --- | --- |
| Primary | The single action that advances the current workflow |
| Secondary | Necessary alternative or supporting action |
| Quiet | Low-risk utility, dismiss, back, or tertiary action |
| Highlight | Mastline-specific confirmation or intelligence action, used sparingly |
| Danger | Delete, revoke, cancel dispatch, or another destructive action |

Button labels begin with verbs: `Import shoot`, `Send package`, `Record outcome`, `Review match`, `Allocate payment`.

### Panels and cards

- A panel contains a collection, table, list, form section, or work area.
- A card represents an individual object such as a shoot, asset, buyer, opportunity, or financial metric.
- Do not wrap every region in a card. The page itself is already a surface.
- Use interactive lift only when the entire card is clickable.

### Tabs and filters

- Tabs change the view of the same object or destination.
- Filter chips narrow a collection without navigation.
- Selected state must use `aria-selected` or `aria-pressed` as appropriate.
- Show counts only when the count helps the user decide where work exists.
- Do not show zero-count filters unless the empty state teaches something useful.

### Status badges

Badges use short nouns or past-tense states: `Draft`, `Uploading`, `Ready`, `Sent`, `Awaiting`, `Licensed`, `Paid`, `Overdue`, `Failed`.

Do not put instructions inside badges. “Needs you to record an outcome” belongs in row copy, not in the badge.

### Operational lists and tables

- Lists are preferred when each item has one obvious next action and a descriptive subtitle.
- Tables are preferred when users compare the same values across many records.
- Align numeric values right and use tabular numerals.
- Keep the primary object name leftmost.
- Keep status near the name, not at the far edge.
- Keep age or timestamp immediately before the row action.
- Make row hover subtle; do not rely on hover to reveal essential information.

### Forms

- Labels always remain visible; placeholders are examples, not labels.
- Group fields by the decision the user is making, not the database table storing them.
- Explain consequences before destructive or external actions.
- Validation appears beside the relevant field and in an accessible summary when submission fails.
- Large forms should use sections or a stepper, not one uninterrupted column.

### Images and asset cards

- Contact sheets use a consistent grid and crop ratio.
- Package review may use larger editorial previews, but metadata remains aligned beneath each image.
- Show Headline, Caption, and People as the first editorial metadata fields when reviewing assets for dispatch.
- Selection state requires more than a border: include a checkbox or selected marker with an accessible label.
- Preserve full-resolution access through an intentional review action; do not overload the grid with every technical field.

### Empty states

An empty state should explain:

1. What belongs here.
2. Why it is empty.
3. The next useful action, if one exists.

Do not celebrate emptiness with decorative illustrations when the state represents missing work, failed ingestion, or lost revenue.

### Dialogs and drawers

- Dialogs are for confirmations and short focused decisions.
- Drawers are for contextual inspection that should not destroy the user's place in a list.
- Full pages are for creation, complex editing, and workflows with meaningful URLs.
- External actions such as dispatching, licensing, and payment changes need explicit confirmation and a durable success state.

## Screen-specific guidance

### Work Queue

Purpose: decide what deserves attention now.

- Show one honest `Next up` task, not a rotating promotional card.
- Organize the queue around workflow state and commercial urgency.
- Each row needs object, status, explanation, age, and one next action.
- Red marks actual urgency; do not mark the first row red simply because it is first.

### News Radar

Purpose: convert current events into actionable shooting and archive opportunities.

- Distinguish `Shoot now` from `Search archive` using labels and workflow grouping, not merely color.
- Show why a story matters, freshness, location relevance, named people, and opportunity window.
- The primary action should create or connect work: `Create shoot`, `Search archive`, or `Build pitch`.
- News imagery supports the signal; it should not turn the surface into a consumer news feed.

### Shoots and Shoot Workspace

Purpose: ingest, organize, caption, and prepare a coherent body of work.

- Use a wide canvas for media.
- Keep ingestion and processing status persistent but quiet.
- Separate editorial metadata from technical file metadata.
- The dominant next action changes by stage: import, review, caption, select, or create package.

### Submissions and Package Review

Purpose: understand what was sent, to whom, under what terms, and what happened next.

- Model one package with multiple recipients when appropriate.
- Keep Potential Buyers distinct from confirmed recipients.
- Show Headline, Caption, and People beneath selected photographs.
- Make recipient status legible without duplicating the package for every buyer.
- Before sending, summarize assets, recipients, terms, embargo, rights notes, and missing information.

### Commercial Opportunities

Purpose: identify and deliberately approve brand, licensing, and affiliate opportunities.

- The queue shows the evidence and value hypothesis.
- The single review view shows the photograph, detected brand/item, confidence, rights posture, proposed action, and confirmation gate.
- Algorithmic confidence is informational; it never substitutes for photographer approval.
- Affiliate and licensing actions must remain visibly distinct.

### Money

Purpose: explain earned, expected, received, allocated, and paid amounts.

- Use tabular numerals and right alignment.
- Never use color alone to distinguish positive and negative movement.
- Separate gross sale, fees, Mastline share, photographer net, payment state, and allocation.
- Show the source shoot, package, buyer, or license whenever money is attributable.

### Rights

Purpose: help the photographer understand ownership, licenses, detected uses, and enforcement work.

- Lead with evidence and rights state, not legal drama.
- Every match needs source asset, detected use, confidence, domain/publication, date, and next action.
- Use drawers for match inspection and full pages for claims or durable cases.
- Red indicates an actionable conflict, not every unverified match.

### Archive

Purpose: make past work discoverable and commercially reusable.

- Search, people, date, location, event, buyer history, and rights state are first-class filters.
- Prefer a strong contact sheet with expandable metadata.
- Keep archive intelligence and News Radar connections visible but secondary to retrieval.

## Content and voice

Mastline copy is direct, concrete, and respectful of professional judgment.

- Say what happened: `Package sent to 3 recipients`.
- Say what is missing: `No outcome has been recorded`.
- Say what the action does: `Allocate payment`.
- Name automation honestly: `Suggested by Mastline`, not `Guaranteed match`.
- Avoid motivational SaaS language, exclamation points, anthropomorphic AI, and vague praise.
- Use publication and industry language only when it improves precision.

## Motion

- Motion confirms cause and effect; it is never ambient decoration.
- Standard transitions are 120–160ms.
- Drawers and dialogs may take up to 220ms.
- Image zoom on hover is limited to approximately 1.5%.
- Honor `prefers-reduced-motion`.

## Accessibility baseline

- All interactive elements must be keyboard reachable.
- Use visible focus rings; never remove focus without replacement.
- Maintain at least 44px primary touch targets and 32px compact desktop controls.
- Use semantic headings in a logical order.
- Use real buttons for actions and links for navigation.
- Tabs, filters, dialogs, menus, and validation must expose state programmatically.
- Provide alt text based on the workflow purpose of an image; decorative duplicates use empty alt text.
- Do not claim WCAG compliance without testing contrast, keyboard flows, zoom/reflow, screen readers, and error recovery in the implementation.

## CSS implementation contract

1. Import `mastline-dashboard-design-system.css` once in the authenticated application layout.
2. Add `data-mastline-app` to the dashboard root or authenticated `<body>`.
3. Map the existing project font variables to `--ml-font-display` and `--ml-font-ui`; do not add remote font imports if the fonts already exist.
4. Adopt tokens first, then shared primitives, then screen-specific components.
5. Do not rename routes, change data contracts, or rewrite behavior as part of the CSS migration.
6. Preserve existing component APIs where reasonable; add class names and semantic attributes instead of duplicating components.
7. Use `aria-current`, `aria-selected`, `aria-pressed`, `aria-invalid`, `data-tone`, `data-state`, and `data-priority` to style real state.
8. Remove obsolete screen-specific CSS only after the migrated screen passes visual and interaction regression checks.

## Recommended migration order

1. Tokens, global typography, focus, and page canvas.
2. Sidebar and page header.
3. Buttons, links, inputs, badges, tabs, and filter chips.
4. Panels, tables, lists, and empty states.
5. Work Queue as the first reference implementation.
6. Submissions and Package Review.
7. Shoots and Shoot Workspace.
8. News Radar, Commercial, Money, Rights, and Archive.
9. Dialogs, drawers, menus, toasts, skeletons, and remaining edge states.

Do not convert every screen in one unreviewed commit. A design system becomes trustworthy through controlled adoption, not merely through global selectors.

## Definition of done for each migrated screen

- Uses shared tokens rather than new hard-coded colors or spacing.
- Has one clear page title and one primary action.
- Responsive at desktop, tablet, and mobile widths.
- Long names, captions, buyer lists, and amounts do not break layout.
- Empty, loading, error, permission, and success states are present.
- Keyboard focus and tab order are visible and logical.
- Semantic state attributes match the visual state.
- Existing actions, routes, permissions, and analytics remain intact.
- No essential action appears only on hover.
- The screen visually belongs beside the rest of Mastline.
