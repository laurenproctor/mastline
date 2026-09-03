# News Radar

One canonical news signal, two independent evaluation paths, a deterministic
evaluator that answers both paths' standing questions from recorded facts
alone (migration `20260831100000`), and — since `20260831110000` — two
controlled handoffs that turn an evaluation into a draft the photographer
then works through the existing package and shoot workflows.

```text
news_signal ─┬─ opportunity (archive_match) ─── opportunity_evaluations ─── opportunity_asset_matches ─── assets
             │                └── opportunity_handoffs (package_draft) ─── packages ─── package_assets
             │
             └─ opportunity (shoot_opportunity) ─ opportunity_evaluations ─── opportunity_shoot_briefs
                              └── opportunity_handoffs (shoot_draft) ───── shoots

news_signal ─┬─ news_signal_context   (one typed row: location, event time, window)
             └─ news_signal_entities  (people, organizations, topics, keywords)
```

The foundation — the canonical signal, the two paths, manual entry, the
watch/dismiss lifecycle — is described in `docs/DECISIONS.md` ("News Radar
foundation"). This file covers the evaluation phase.

## The two questions

**Archive.** Which real photographs this workspace already owns look relevant
to this story, and why?

**Shoot.** Do the recorded facts support a new shoot, and what must the
photographer still confirm?

Both are answered by `src/lib/news-radar-evaluation.ts`, a pure module with
no server imports, no clock inside the scorer, and a version string
(`EVALUATOR_VERSION`) that is stored beside every result. No model, vector,
feed, or external API is involved. The data layer
(`src/lib/data/news-radar-evaluations.ts`) reads rows, calls the pure
functions, and records the result through one SECURITY INVOKER function.

## Structured context

A headline-only story is still valid. Optionally, a person records more:

| Table                  | Holds                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `news_signal_context`  | One row per signal: `location_name`, `event_starts_at`, `event_ends_at`, `window_note`, per-fact provenance/basis/confidence |
| `news_signal_entities` | One row per person / organization / topic / keyword, with a generated `normalized_value`, provenance, basis, confidence |

Provenance is one of `manual` (typed by a person), `source` (read from the
source record), or `system` (suggested by a rule and then accepted by a
person). A `system` row must carry the basis and confidence that were on
screen when it was accepted; a confidence never appears without a basis
(check constraints repeat both rules).

The detail screen shows four registers, visibly apart: **recorded source
facts**, **entered by a person** (accepted suggestions are labelled
"Suggested, then accepted · ‹basis› · ‹confidence›"), **suggestions — not
recorded**, and **missing**. Suggestions come from a fixed rule over
capitalised phrases in the headline and summary (`suggestContext` in
`src/lib/news-radar-context.ts`); nothing is recorded until a person presses
"Add as …", and the server re-derives the suggestion rather than trusting the
browser's basis.

Normalization is identical on both sides: lower case, trimmed, inner
whitespace collapsed (`private.news_radar_normalize` and `normalizeTerm`).

## Evaluation state

`opportunity_evaluations`, one row per path, two registers on one row:

- **Latest run**: `state` (`not_evaluated`, `evaluating`, `ready`,
  `needs_context`, `failed`), `evaluator_version`, `input_hash`,
  `evaluated_at`, `failure_code`.
- **Latest result**: `score`, `explanation`, `result_state`,
  `result_evaluator_version`, `result_input_hash`, `result_at`.

A failed rerun updates the run register and leaves the result register — and
the match rows or brief that go with it — untouched. The screen then says
"Evaluation failed … the result below is from the last successful run".

`input_hash` is SHA-256 of a canonical string of everything the evaluator
depends on (story facts, context, entities, and — for the archive — the
candidate photographs' matching fields; for the shoot — the path's window and
the workspace's base city, specialties, and timezone). Key order and row order
never change it; the clock is excluded. When the same evaluator has already
produced a result over the same hash, "Re-evaluate" writes nothing, logs
nothing, and says so.

Classified failure codes: `denied`, `not_found`, `invalid_result`,
`asset_not_in_workspace`, `write_failed`, `archive_read_failed`,
`context_read_failed`, `evaluator_error`. No database text reaches the
interface.

## Archive scoring (`EVALUATOR_VERSION = news-radar/1`)

Candidates are every non-tombstoned asset in the workspace. `ingesting` is
excluded (incomplete import); `restricted` is scored but flagged and never
described as ready to use; `archived` is eligible — it is what this exists to
reactivate.

| Component (overlap)     | Rule                                                                 | Points                |
| ----------------------- | -------------------------------------------------------------------- | --------------------- |
| People                  | Exact normalized person = asset subject, or whole name in headline/caption | 40 each, cap 60   |
| Organizations           | Exact keyword, or whole name in headline/caption                     | 15 each, cap 30       |
| Keywords / topics       | Exact normalized keyword overlap                                     | 10 each, cap 30       |
| Location                | Exact / named whole in text → 20; one significant word shared → 10   | 20 or 10              |
| Headline/caption terms  | Shared significant words (≥4 letters, not stopwords)                 | 3 each, cap 15        |

| Component (readiness)   | Rule                                                                 | Points |
| ----------------------- | -------------------------------------------------------------------- | ------ |
| Capture time            | Within 7 / 90 / 365 days of the event, or of publication if no event | 10 / 5 / 2 |
| Metadata complete       | Headline, caption, subjects, keywords all recorded                   | 5      |
| Rights recorded         | Copyright notice **and** credit line recorded                        | 5      |

Rules: an asset with zero overlap is never returned; an overlap below
`ARCHIVE_MATCH_THRESHOLD = 10` is dropped (the threshold is applied to the
overlap components alone, so readiness points can never make a match on their
own); total capped at 100; the top `ARCHIVE_MAX_MATCHES = 50` are stored. Ties
break by newest capture, then filename, then asset id.

Rights are described only as the columns say: *Copyright information
recorded*, *Credit line recorded*, *Usage restriction recorded*, *No
restriction recorded*, *Rights information incomplete*. "Cleared" is never
said.

Outcomes: `ready` (with 0..n matches), or `needs_context` when the story
carries no people, keywords, or location and headline terms alone matched
nothing. An empty archive is reported as such, not as "no matches".

## Shoot brief

`opportunity_shoot_briefs`, one typed row per shoot path.

| Readiness component | Points |
| ------------------- | ------ |
| Event time recorded | 25     |
| Event still ahead   | 10     |
| Location recorded   | 25     |
| People recorded     | 15     |
| Source recorded     | 5      |
| Summary recorded    | 5      |
| Within base city    | 10 (only if the workspace recorded a base city) |
| Specialty overlap   | 5 (only if the workspace recorded specialties)  |

`ready` requires a recorded location **and** event time; otherwise
`needs_context`, with `missing_confirmations` listing exactly what to confirm.
The brief also lists why-now lines (absolute times in the workspace timezone),
what is known, the window state (`open`, `closing`, `closed`, `unknown`;
re-derived live on screen from the stored timestamps), geographic relevance,
specialty relevance (null when no specialties exist), a suggested angle and
suggested shots — built only from recorded people, location, times, and
organizations, and always labelled "Suggested" — and the score breakdown.

Never invented: a person's location, an event time, access, credentials, a
confirmed appearance, buyer demand, expected value.

## Integrity and security

- `opportunities` gains `unique (id, organization_id, opportunity_kind)`;
  evaluations, matches and briefs reference all three columns, and a check
  pins the kind, so a shoot path cannot receive matches and an archive path
  cannot receive a brief — at the database.
- Matches reference `(organization_id, asset_id)` → `assets (organization_id, id)`;
  context and entities reference `(news_signal_id, organization_id)`. No
  cross-workspace relationship can be written by any client.
- RLS enabled and forced on all five tables; members read; owner and editor
  write; authorship pinned to `auth.uid()` on context and entities. One policy
  per command (no `for all`), so no second permissive policy runs on reads.
- Grants revoked from `authenticated` and `anon` first, then stated: column-
  scoped `update` where a client may correct facts; `service_role` holds the
  same table privileges (RLS bypassed by design).
- `record_opportunity_evaluation(uuid, text, text, text, jsonb)`: SECURITY
  INVOKER, empty `search_path`, execute revoked from PUBLIC and anon, granted to
  authenticated. Replaces the matches or upserts the brief and the evaluation
  row in one transaction; a failure inside rolls back and is recorded on the
  run register with a classified code.
- Every foreign key has a covering index in its own column order. The
  Supabase advisor lints (splinter) were run locally against the migrated
  stack: the only findings on the new objects are `unused_index` (fresh
  database) and `pg_graphql_authenticated_table_exposed`, which every
  member-readable table in the schema shares.
- The evaluator writes nothing to `assets` (not `selected`) and creates no
  package, shoot, submission, buyer, license or delivery record. The handoffs
  (below) create exactly one draft package or one draft shoot, and nothing
  else. Tests prove both.

## Migration order

`20260831100000_news_radar_evaluation.sql` was created with
`supabase migration new` and renamed to sort **after** immutable dispatch's
`20260831090000_submission_asset_snapshots.sql` (PR #16), which must merge
first.

## Handoffs: from evaluation to draft

An evaluated path can be acted on once, from its own screen, through one
database function per path (`src/lib/data/news-radar-handoffs.ts`,
`src/lib/news-radar-handoff.ts` for the pure rules). Both create a **draft**
and nothing else, and both leave the evaluation, its matches, and its brief
exactly as they were.

### Archive → draft package

The screen groups the recorded matches by the shoot they sit on and lets the
person tick photographs one by one. Nothing is pre-selected. A photograph that
cannot proceed says why in place and cannot be ticked: *restricted* (approval
would refuse it later), *not on a shoot*, *no stored file*. Incomplete
metadata and a recorded usage restriction are said, not refused. A
confirmation step repeats the count, the story, the shoot, every warning, and
the promises — draft package only, no recipient contacted, no delivery link,
nothing approved or priced, metadata / rights / terms / recipient still to be
reviewed — before the one button that writes.

`handoff_archive_package(opportunity, evaluator, input_hash, asset_ids,
request_key)` then, in one transaction:

1. reads the path as the caller (another workspace's path does not exist);
   refuses a role below owner/editor (`forbidden`), the wrong kind
   (`not_found`), a path already handed off (`existing`), a closed path
   (`path_closed`), a path with no result (`needs_context`), or an evaluation
   identity other than the one on record (`stale_evaluation`);
2. locks the path row, so two simultaneous confirmations serialize and the
   second reads the first's handoff;
3. checks the selection: non-empty, every id a recorded match of this path,
   every frame readable in this workspace, none restricted, all on one shoot
   (`invalid_selection` with `reason` and the offending ids; nothing is
   trimmed on the person's behalf);
4. creates the package exactly as the dispatch builder does — `draft`, one
   `package_assets` row per frame in canonical-filename order naming the
   delivery version where one exists and the original otherwise, then
   `needs_review`; no buyer, no terms, `approved_at` null;
5. writes the provenance row, records `package.created` on the package and
   `opportunity.acted` on the path, and moves the path to `acted`.

**Why one shoot.** A package belongs to a shoot and the package review reads
its frames through that shoot. Widening that is a package-review change, not
a radar change, so a selection across shoots (or a frame on no shoot) is
refused with the reason. The screen locks the other shoots' checkboxes once a
shoot is chosen and says so.

### Shoot → draft shoot

Four registers, visibly apart: **recorded facts** (story, location, event
time, people, organizations, why-now), **needs confirmation** (title;
location, event time and time zone each behind its own checkbox beside a
value; people expected, one checkbox per recorded name; priority),
**suggestions — not facts** (the brief's angle and shots, each behind a
checkbox that copies it into the notes *as a suggestion*), and **will be
added to the draft** (a live summary, with what remains unconfirmed listed).
A confirmation step repeats the summary, what will remain unconfirmed, and
the promises — no package, recipient, submission, delivery link or buyer; no
access, credential, appearance or demand claimed — before the one button.

`handoff_shoot_draft(opportunity, evaluator, input_hash, confirmed,
request_key)` applies the same preamble, validates the confirmed fields
(title 1..200, location ≤200, priority in the vocabulary, times readable and
ordered, time zone present in `pg_timezone_names`), and creates one `draft`
shoot with `opportunity_id` set, `story_angle` null, and notes assembled only
from confirmed people ("People expected (confirmed by the photographer)") and
deliberately copied suggestions ("… (News Radar suggestion, not confirmed)").
An unconfirmed location, time, or time zone is left empty on the draft even
when the brief knows it. The Server Action re-reads the brief and accepts
only names and suggestions the brief offered, so the browser cannot smuggle a
fact in through the confirm step.

### Human-confirmation boundaries

Never copied without a tick: location, event date/time, time zone, people
expected, any suggestion. Never written anywhere: a confirmed appearance,
access, credentials, buyer demand, expected value, rights clearance. Never
done by the handoff: approval, submission, snapshot, recipient, delivery
link, message, price, license, `assets.selected`.

### Provenance and idempotency

`opportunity_handoffs` — append-only — proves organization, path (composite
foreign key including the kind), signal (composite), action type (checked
against the kind: an archive path cannot carry a shoot handoff, a shoot path
cannot carry a package handoff), evaluator version and input hash, exactly
one of `(organization_id, package_id)` / `(organization_id, shoot_id)`
(composite foreign keys; `shoots` gained `unique (organization_id, id)` for
it), the confirmed details, the acting user (`created_by` pinned to
`auth.uid()` by the insert policy), the time, and the request key. RLS is
enabled and forced; members read; owner and editor insert; no update or
delete policy or grant for any client, and a trigger refuses updates from
the service role too. `unique (opportunity_id)` makes a path a one-time
handoff; `unique (organization_id, request_key)` makes a retry a retry. The
row lock makes concurrent duplicates serialize into one result. Every
foreign key has a covering index.

The confirmation form mints one request key per render; a double click, a
retried request, or a re-posted form carries the same key and is answered
`existing` with the original package or shoot. A second confirmation on a
path that already has a handoff is answered the same way: the draft it made
is authoritative from then on.

### Stale evaluation

The form carries the `result_evaluator_version` and `result_input_hash` it
was rendered from. If either differs from the record at confirm time — the
story gained context and was re-evaluated, or a newer evaluator ran — the
function answers `stale_evaluation` and writes nothing; the screen says so
and offers a reload. No database text reaches the interface: every answer is
one of `created`, `existing`, `stale_evaluation`, `invalid_selection`,
`needs_context`, `path_closed`, `forbidden`, `not_found`, `failed`.

### Explicit non-actions

A handoff never approves a package, creates a submission, snapshot, recipient
or delivery link, sends anything, publishes, licenses, prices or submits a
photograph, marks a shoot anything but `draft`, writes an asset, or changes
the evaluation it was made from. Tests in `tests/news-radar-handoff.test.ts`
and `e2e/news-radar-handoff.spec.ts` prove each of these.

## Deferred

- Cross-shoot archive packages, once the package review reads frames through
  `package_assets` rather than through the shoot.
- Any ingestion: RSS, provider feeds, scraping, scheduled runs.
- Enrichment from `asset_metadata` (city, venue, event name) once the
  generation job populates it; the scorer reads `assets` columns only today.
- Work Queue integration and the design-system migration of the radar screens.
