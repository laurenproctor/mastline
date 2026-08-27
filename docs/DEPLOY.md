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

All migrations are applied, including the three private buckets
(`originals`, `derivatives`, `evidence`), none public. Production was never
seeded; the first workspace is made through real sign-up.

`supabase migration list --linked` is the check that matters here, and it is
worth running before any deploy that touches data: it prints local and remote
side by side, and a local row with no remote opposite is a migration the code
about to ship may already be assuming.

`20260827120000_photograph_metadata` is applied to production. It adds
`asset_metadata`, `asset_metadata_jobs`, two enums, two service-role RPCs, and
the triggers that stop a generation write from touching rights or a confirmed
record. It is additive -- nothing existing is altered or dropped -- so it was
safe to push ahead of the code that uses it, which is also why the application
tolerates a photograph having no metadata row yet. Its ROLLBACK block is at the
top of the file.

Note what the security advisor does NOT report after that push:
`claim_metadata_jobs_admin` and `complete_metadata_job_admin` appear in neither
the anon nor the authenticated `SECURITY DEFINER` list, because both revoke
`EXECUTE` from `public`, `anon`, and `authenticated` and grant it only to
`service_role`. Their absence from that report is the check that the grants
landed.

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
become `NEXT_PUBLIC_`. It gates the "Generate metadata" control on the
photograph metadata panel. With no key the control is not offered at all rather
than offered and failing, and nothing is queued that could never be drained, so
an unset key is a degradation and not an outage: the whole panel can still be
filled in and confirmed by hand.

The model is `claude-haiku-4-5` by default, overridable with
`MASTLINE_METADATA_MODEL` (`MASTLINE_SUGGESTION_MODEL` is still read as a
fallback name; both are unset in production, so the default applies). Roughly
half a cent a photograph. Two things to know before changing it:

- Not every model accepts `output_config.effort`. Haiku 4.5 rejects it with a
  400 rather than ignoring it. `supportsEffort` in `src/lib/metadata-suggestions.ts`
  is an allow list, so an unrecognised model sends no effort and gets the
  model's own default; add a model there when moving to an effort-capable tier.
- Haiku 4.5's retirement commitment is "not sooner than 15 October 2026", the
  nearest of any current model. Budget for a re-point.

Changing either variable needs a redeploy. The value is read on the server per
request, but Vercel binds a deployment's environment when the deployment is
created.

### The metadata worker

Generation is asynchronous and durable. A Server Action inserts a row into
`asset_metadata_jobs` and returns; `after()` then drains a few jobs on the tail
of the same invocation, once the response has been flushed. Nothing is lost if
that invocation dies -- the row is in Postgres and the lease expires -- but
nothing else picks it up on its own either.

**The sweep is what closes that gap, and it is a deployment step.** `GET` or
`POST` `/api/jobs/metadata` with `Authorization: Bearer <secret>`, where the
secret is `METADATA_WORKER_SECRET` or, failing that, `CRON_SECRET` (the variable
Vercel Cron sends by default). With neither set the endpoint answers 503 to
everything rather than running unbounded model calls for anyone who finds the
URL.

To schedule it on Vercel, add to `vercel.json`:

```json
{ "crons": [{ "path": "/api/jobs/metadata", "schedule": "*/5 * * * *" }] }
```

Without a scheduler the feature still works -- every request that queues
metadata also drains some -- but a card of two hundred frames finishes only as
fast as later requests arrive, and a job whose worker was killed waits for the
next drain rather than for the next sweep. That is the trade-off recorded in
`src/lib/data/metadata-jobs.ts`, and it is the reason no queue service was
added.

Both halves are required for anything to run: `ANTHROPIC_API_KEY` to have
something to ask, and `SUPABASE_SERVICE_ROLE_KEY` to have something to run the
ask. `generationIsAvailable()` checks both, and the interface hides the control
when either is missing.

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
