# Deploying Mastline

Hosting is split deliberately: the founder creates the billable resources, and
the application is wired to them afterwards. This file records what is already
done and what is still needed.

## Already done

- Vercel project `mastline` exists in `lauren-proctors-projects`, on Node 24.x,
  serving <https://mastline.co>.
- **`/` is the marketing home.** It used to redirect to `/work`, so a stranger
  arriving at mastline.co was sent to the sign-in screen. `/welcome` now
  permanently redirects to `/`, and sign-in stays at `/sign-in`.
- **The apex is canonical.** `mastline.co` serves the site and
  `www.mastline.co` returns a 308 to it, preserving the path. Vercel had it the
  other way round when the domain was added, which is the default. If it ever
  flips back, the setting is per-domain on the project: clear `redirect` on the
  apex first, then set `redirect` on `www` -- doing it in the other order points
  both at each other.
- DNS lives at Hurricane Electric, not Vercel. `vercel domains inspect` marks
  the nameservers with a red cross for that reason; it is not a fault and there
  is no need to move them. The apex A record and the `www` CNAME are correct.
- The GitHub repository `laurenproctor/mastline` is connected, so a push to
  `main` deploys to production and every branch gets a preview.
- `WEBHOOK_SECRET_DEFAULT` is set for production and preview: a fresh 32-byte
  value, not the local development one. It is stored non-sensitive so it can be
  read back from the dashboard when a delivery provider needs configuring.

## The database

Created and migrated. Project ref `rctvatrdgqnwhldbmgek`, region East US (North
Virginia), API URL `https://rctvatrdgqnwhldbmgek.supabase.co`.

There are 32 migrations in `supabase/migrations`, including the three private
buckets (`originals`, `derivatives`, `evidence`), none public. Production was
never seeded; the first workspace is made through real sign-up.

The count is stated rather than claimed as applied: what is actually on the
remote is whatever `supabase migration list --linked` says, and this file has
been wrong about that before. The last six -- recipient delivery links,
approval-time immutability, delivery view analytics, the open lifecycle, the
News Radar canonical signal, and the approved-frame snapshot
(`20260830130000_immutable_dispatch_snapshots`) -- have been applied and
exercised locally only.

`supabase migration list --linked` is the check that matters here, and it is
worth running before any deploy that touches data: it prints local and remote
side by side, and a local row with no remote opposite is a migration the code
about to ship may already be assuming.

One rule that migration `20260825170000` establishes, because it was learned the
hard way: **service_role holds the same table privileges as authenticated.**
Supabase's image stopped granting DML on new public tables, and service_role had
no explicit grant, so on a fresh database every trusted server path that runs
without a user session -- teammate invitations, the delivery webhook, the
billing webhook -- failed with 42501. Row level security, which service_role
bypasses by design, is what separates the two roles. Grant explicitly in every
migration; never rely on a platform default.

The Supabase Vercel integration had already populated Production with
`POSTGRES_*`, `SUPABASE_*`, and `NEXT_PUBLIC_SUPABASE_*`. Those are managed by
the integration and take precedence over `vercel env add --force`, which fails
silently against them. Preview was not covered by the integration and is set
manually.

Two CLI notes that cost time:

- `vercel env add` ignores piped stdin for non-interactive callers and needs
  `--value`. Without it you get an empty variable rather than an error, which is
  how `vercel link` left five variables blank.
- Vercel stores Production values as sensitive by default, so `vercel env pull`
  reads them back empty. An empty pull is not proof the write failed.

`NEXT_PUBLIC_*` variables are inlined into the client bundle **at build time**.
Changing one requires a redeploy, not just a restart.

### Deploying the approved-frame snapshot

Migration `20260830130000_immutable_dispatch_snapshots.sql` is additive and
must land **before** the application code that depends on it: the code calls
`approve_package()`, `authorize_delivery_download()`, and the new
`delivery_assets()` and `delivery_preview()` shapes, none of which exist on the
previous schema, so a deploy in the other order breaks approval and every
recipient link. The migration replaces `delivery_assets`, `delivery_preview`,
and `record_delivery_download` with new return types (dropped and recreated,
grants restored), so the previous application code stops working the moment
it applies; deploy the two within one maintenance window. Nothing here has
been run against the hosted project.

**Its version is `20260830130000`, deliberately later than the News Radar
migration's `20260830120000`.** `supabase migration new` stamps the current
time, and the migrations already on `main` carry hand-chosen versions later
than that, so a CLI-stamped file would sort before the last applied version
and the CLI would refuse a plain `migration up` / `db push` until told
`--include-all`. The file was renamed so that ordinary ordering holds: a
31-migration database takes it with plain `supabase migration up --local`,
and `supabase db push --dry-run` lists it as the one pending migration. The
same rule applies to every migration that follows -- a new version must sort
after `20260830130000`, whatever the clock says.

1. **Verify parity.** `supabase migration list --linked` must show 31 applied
   on both sides and only `20260830130000` pending. Do not trust the history
   table alone: probe a column the last migration added, e.g.
   `curl "$URL/rest/v1/news_signals?select=id&limit=1"` with the service key,
   and confirm it is not `42703`.
2. **Apply the migration.** `supabase db push`. The migration prints
   `submission_assets backfill: N submissions seen, F frames written, U
   manifest entries unresolved`.
3. **Verify the backfill.** With the service key:
   `select * from public.submission_snapshot_gaps_admin()` lists one row per
   unresolved manifest entry and must match U from step 2 (expected: none),
   and `select * from public.submission_snapshot_drift_admin()` must be empty.
   Probe the table: `curl "$URL/rest/v1/submission_assets?select=id&limit=1"`.
   Every backfilled row carries `snapshot_origin = 'legacy_backfill'`; the
   submission screen says so, and says which frames could not be frozen.
4. **Deploy the application** (push to `main`; Vercel builds it).
5. **Exercise the loop with noncommercial test records.** In a test
   workspace: build a package from two test frames that have delivery JPEGs,
   approve it, confirm the submission screen lists two approved frames with
   origin "approval", create a recipient link, edit one test frame's caption,
   open the link signed out and confirm the approved caption is shown, accept,
   download, and confirm the access record shows the download and the
   redirect named the approved object. Withdraw the link and confirm it no
   longer opens.
6. **Run the advisors.** `supabase db advisors --type security --linked` and
   `supabase/checks/advisors.sql`. Expect no new findings: the new table has
   RLS forced, every new function sets an empty search path, and `anon` holds
   no table grant.
7. **Remove the test records** only through supported behaviour: withdraw the
   link from the submission screen; leave the test submission in place (it is
   an approved record) or purge the test workspace with
   `purge_organization_admin`, which is the audited route.

**Rollback.** The migration cannot be reverted by the CLI. If the application
must be rolled back, roll back the code only and re-apply the previous
versions of `delivery_assets`, `delivery_preview`, `open_delivery`, and
`record_delivery_download` from `20260824101000`, `20260824111000`, and
`20260828093000` by hand; the `submission_assets` table and `approve_package`
can stay, unused. Do not drop the table: the rows are part of the commercial
record from the moment they exist.

### Re-running the schema checks

The database password is not needed; the CLI provisions a temporary role.

```sh
supabase link --project-ref rctvatrdgqnwhldbmgek
supabase db push
supabase db advisors --type security --linked
```

All 12 project checks in `supabase/checks/advisors.sql` pass against production.

Supabase's own linter reports three WARNs. Two are `create_workspace` and
`rls_auto_enable` being executable by signed-in users; `create_workspace` is
deliberate, since creating a workspace is exactly what a new signed-in user must
do. The third is `rls_auto_enable` being callable by `anon`. That is a Supabase
platform event trigger present in every project, not ours, and it is not
reachable: calling it through PostgREST returns `cannot display a value of type
event_trigger`. Verified directly, along with `anon` being denied on `shoots`
and `organizations` at the GRANT level, before RLS is consulted.

## Supabase auth settings

Set, via the management API. Site URL is `https://mastline.co`; the
allow list keeps the integration's preview wildcards so auth works on preview
deployments, plus localhost for development:

```
https://mastline.co/**
https://www.mastline.co/**
https://mastline.vercel.app/**
https://mastline-lauren-proctors-projects.vercel.app/**
https://mastline-*-lauren-proctors-projects.vercel.app/**
http://localhost:3000/**
```

Without this, password-reset and confirmation emails link back to `localhost`
and silently fail for a real user. Site URL must track the canonical host: it
is what Supabase puts in reset and confirmation emails.

## Metadata suggestions

`ANTHROPIC_API_KEY` is set for production. It is server-only and must never
become `NEXT_PUBLIC_`. With no key the inspector's "Suggest from the image"
control is not offered at all rather than offered and failing, so an unset key
is a degradation and not an outage.

It now gates two paths, not one:

- "Suggest from the image" in the asset inspector, on demand.
- The caption drafted for every frame as it is imported, which runs in an
  `after()` behind `registerPreviewAction` and writes into `assets.caption`
  marked unreviewed. The workspace switch is
  `organizations.auto_caption_on_import`, on by default.

**Two faults had to be fixed before either path had ever worked.** Both were
silent, and both surfaced only as "The suggestion service returned 400."

1. **The key is identity-backed and not scoped to a workspace**, so the API
   refuses to guess which workspace a request bills to:

       400 invalid_request_error: anthropic-workspace-id is required when
       authenticating with an identity-linked API key; send the id of the
       workspace this request acts in.

   `ANTHROPIC_WORKSPACE_ID` is now read in
   `src/lib/data/metadata-suggestions.ts` and sent as the `anthropic-workspace-id`
   default header. Unset, no header is sent — which is correct for a key scoped
   to a single workspace, and is what makes moving to one later a matter of
   clearing a variable rather than editing code. Do not set it speculatively: a
   workspace id that contradicts a scoped key's own workspace is a 404.

   The alternative worth taking eventually is a **service account key scoped to
   one workspace** (Console → Settings → Service accounts, then Settings → API
   keys with **Linked account** set to it). That needs no header at all, and it
   gives the deployment its own identity — the current key acts as a person, so
   all usage attributes to them and the key is archived if they ever leave the
   organization. This is not the legacy "workspace key" type, which belongs to a
   workspace and acts as nobody; scope is a property of an identity-backed key.

2. **`maxItems` is rejected under `strict: true`.** The suggestion tool declared
   `keywords` with `maxItems`, and the API answered
   `tools.0.custom: For 'array' type, property 'maxItems' is not supported` —
   failing every request, with and without the workspace header. The cap is
   stated in the tool description instead; `normaliseSuggestion` was always the
   thing actually enforcing it.

Verified end to end after both fixes: a real upload through the built app draws
a real caption, stored with `caption_origin: model`, `caption_awaits_review:
true`, confidence, basis, and an `asset.caption_drafted` event.

Production runs the same code, but whether its key needs the header could not be
checked from outside — Vercel stores production values as sensitive and reads
them back empty. `ANTHROPIC_WORKSPACE_ID` is set for production on the
assumption that it is the same identity-backed key. If production's key turns
out to be scoped to a *different* workspace, the header will make requests 404
instead; unset the variable in that case. Confirm with one import into a real
workspace.

The model is `claude-haiku-4-5` by default, overridable with
`MASTLINE_SUGGESTION_MODEL` (unset in production, so the default applies).
Roughly half a cent a suggestion. Two things to know before changing it:

- Not every model accepts `output_config.effort`. Haiku 4.5 rejects it with a
  400 rather than ignoring it. `supportsEffort` in `src/lib/metadata-suggestions.ts`
  is an allow list, so an unrecognised model sends no effort and gets the
  model's own default; add a model there when moving to an effort-capable tier.
- Haiku 4.5's retirement commitment is "not sooner than 15 October 2026", the
  nearest of any current model. Budget for a re-point.

Changing either variable needs a redeploy. The value is read on the server per
request, but Vercel binds a deployment's environment when the deployment is
created.

## Stripe

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are still placeholders. Billing
routes stay inert until real test keys and the six price IDs exist. Nothing
else in the product depends on them.

## What runs without a database

Middleware serves `/welcome` and `/pricing` before it builds a Supabase client,
so the public site stays up even when the environment is unconfigured or the
database is unreachable. Everything behind the sign-in gate correctly fails
without it. `/sign-in` and `/sign-up` are not in that set because they redirect an
already signed-in visitor, which needs the session.

## Verifying a deploy

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://mastline.co/                 # 200
curl -s -o /dev/null -w '%{http_code}\n' https://mastline.co/pricing           # 200
curl -s -o /dev/null -w '%{http_code}\n' https://mastline.co/sign-in           # 200
# /welcome is a 308 to the apex home, not a page. A 200 here means the
# redirect recorded above has been lost.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://mastline.co/welcome
# www must redirect to the apex, not serve:
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.mastline.co/pricing
```

The browser suite can be pointed at the deployment:

```sh
E2E_BASE_URL=https://mastline.co npx playwright test --project=desktop
```

Tests that expect the seeded workspace will fail against an empty production
database. That is expected, and the reason seeding is not done there.
