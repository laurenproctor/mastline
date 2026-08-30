# News Radar

One canonical news signal, two independent evaluation paths, and — since
migration `20260831100000` — a deterministic evaluator that answers both
paths' standing questions from recorded facts alone.

```text
news_signal ─┬─ opportunity (archive_match) ─── opportunity_evaluations ─── opportunity_asset_matches ─── assets
             │
             └─ opportunity (shoot_opportunity) ─ opportunity_evaluations ─── opportunity_shoot_briefs

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
- Nothing writes `assets` (not `selected`), and no package, shoot,
  submission, buyer, license or delivery record is created. Tests prove both.

## Migration order

`20260831100000_news_radar_evaluation.sql` was created with
`supabase migration new` and renamed to sort **after** immutable dispatch's
`20260831090000_submission_asset_snapshots.sql` (PR #16), which must merge
first.

## Deferred

- Package handoff from archive matches (Build package stays disabled).
- Shoot handoff carrying confirmed brief facts (Create shoot stays disabled).
- Any ingestion: RSS, provider feeds, scraping, scheduled runs.
- Enrichment from `asset_metadata` (city, venue, event name) once the
  generation job populates it; the scorer reads `assets` columns only today.
- Work Queue integration and the design-system migration of the radar screens.
