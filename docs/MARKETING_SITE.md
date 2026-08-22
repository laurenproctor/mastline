# The marketing site

Ported from the approved design artifact "Mastline Editorial Direction". This
records what changed on the way in, what still needs a decision from you, and
how to do it again if the design is revised.

## What it is

Eighteen pages under `src/app/(marketing)/`, plus a 404. The artifact was a
single HTML file that showed and hid `div.page` blocks with script; each block
is now a real route, so every page has its own address, renders on the server,
and can be linked to and indexed.

| Route | Route | Route |
| --- | --- | --- |
| `/` | `/teams` | `/privacy` |
| `/product` | `/commercial` | `/terms` |
| `/how-it-works` | `/editors` | `/security` |
| `/pricing` | `/press` | `/accessibility` |
| `/trust` | `/copyright` | `/acceptable-use` |
| `/company` | `/subjects` | `/early-access` → `/signup` |

`/` used to redirect to `/work`, which sent anyone who was not signed in
straight to a sign-in screen. It is now the home page. `/welcome` permanently
redirects to it so old links keep working.

All eighteen are statically prerendered and none of them read the database.
Middleware serves them before it builds a Supabase client, so the public site
stays up even when the environment is misconfigured.

## Three facts the artifact got wrong

These were corrected on the way in, and each is now read from
`src/lib/pricing.ts` — the same module the application bills against — rather
than written into the markup:

| Artifact said | Corrected to | Why |
| --- | --- | --- |
| "Save up to 22%" | **Save up to 18%** | The approved claim. The real spread between annual and twelve monthly payments is 16.8%–17.7%. |
| Studio: "Up to 10 team members" | **Up to 5** | What the plan sells, and what `PLAN_SEATS` enforces. |
| No annual totals | **$588 / $1,188 / $3,348 billed once a year** | What a year actually costs is a material disclosure. |

`src/app/(marketing)/_components/plans.tsx` renders the artifact's plan cards
from `PLANS`, so a price can now only be wrong in one place.
`_components/plans.test.tsx` pins all of it, including the seat count.

## Claims about things that are not built

You chose to keep these and build the features before launch. They are stated
in the present tense on the live pages, and none of them exists in the codebase
today:

- **Two-factor authentication**, "available for every account and required for
  team owners and finance roles" (`/security`)
- **Watermarked previews** for buyers (`/security`, `/editors`)
- **Download logging** with recipient, time and IP address (`/security`)
- **Independent penetration testing** at least annually (`/security`)
- The **News Radar** and **Commercial Opportunities** screenshots show Phase 4
  work that has not been built

`main` deploys to mastline.co automatically, so merging publishes these claims.
That is why this landed on a branch.

## What still needs filling in

Placeholders that shipped as written, with the page they are on:

| Placeholder | Page |
| --- | --- |
| `[QUOTE FROM PHOTOGRAPHER 1..3]`, `[First name]`, `[X] years shooting` | `/` |
| `[Subject]`, `[Franchise]` (the archive demonstration) | `/` |
| `[CLOUD PROVIDER]`, `[REGION]` | `/security` |
| `[PRESS KIT ZIP URL]`, `[LOGO PACK URL]`, `[SCREENSHOT PACK URL]`, `[FOUNDER HEADSHOT URL]` | `/press` |
| `[HELP CENTER URL]`, `[STATUS PAGE URL]` | footer |
| `[SUPPORT HOURS]` | `/trust` |
| `[AGENT PHONE]` | `/copyright` |
| `[PHONE NUMBER]`, `[KNOWN LIMITATION]` | `/accessibility` |

Nine addresses are linked and need to exist as real mailboxes: `hello@`,
`support@`, `press@`, `privacy@`, `legal@`, `security@`, `copyright@`,
`subjects@`, `accessibility@`. One phone number is published: `+1 347 926 3232`.

`/press` also states company facts to confirm: "Mastline, a Storyworlding
company", the Prince Street address, and "Founded 2026". `/pricing` compares
against a "typical agency 40–60%", which is a claim about third parties.

## The way in

Every "Start free" -- in the header, the mobile menu, the plan cards, the
footer, and each page's closing call to action -- goes to `/signup`, which
creates the account and hands over to `/onboarding`. "Sign in" goes to
`/login`. On a phone the header keeps only the primary call to action and sign
in moves into the menu.

`/early-access` permanently redirects to `/signup`. The design captured it as a
form posting to a `mailto:` address, which would have sent a conversion into a
mail client instead of creating a workspace. The qualifying questions it asked
-- market, how you work, what slows you down -- are not captured anywhere yet;
they belong in onboarding, where there is an account to attach them to.

## Things worth a second look

- **`/commercial` names real brands** with prices in a product mockup.
- The three founder quotes on `/company` are attributed to you by name.

## How it was built

Not by hand. `tojsx.py` in the session scratchpad converts the artifact's HTML
to JSX: attribute renaming, void elements, `style` objects, SVG camelCase,
numeric attributes, and internal links to `next/link`. Re-running it against a
revised artifact regenerates the pages; the pricing page and the home page then
need their components re-attached.

Three deviations from the artifact, all deliberate:

- **`.page` show/hide rules removed.** Real routes do not need them, and the
  class already means something else in `globals.css`.
- **`.eyebrow` and `.metrics` renamed** `.mk-eyebrow` and `.mk-metrics`, for the
  same collision reason. They are the only two class names the two stylesheets
  shared.
- **Fonts fixed.** The artifact linked Newsreader but its CSS asked for Source
  Serif 4, so neither ever loaded and every headline fell back to Georgia. Both
  faces are now self-hosted through `next/font`.

`marketing.css` is imported only by the marketing layout, so it never reaches
the signed-in application, which keeps its own design language.

### The parts that move

`_components/behaviors.tsx` holds three. Two are not decoration: the archive
demonstration and the running total both hide content behind a class their
script adds, so without them a panel of the home page is invisible and nothing
says so. A browser test covers exactly that. The split calculator reads its
rates from `src/lib/sales-engine.ts`, so the illustration cannot drift from the
arithmetic a photographer is actually paid by.

## Tests

- `_components/plans.test.tsx` — 15 tests on the plan grid and the approved facts
- `e2e/acceptance.spec.ts` — every page renders to a signed-out visitor, nothing
  scrolls sideways, `/welcome` still lands somewhere, the header marks the
  current page, the demonstration resolves rather than staying blank, and the
  calculator splits 70/30
