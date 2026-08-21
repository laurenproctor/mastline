# Deploying Mastline

Hosting is split deliberately: the founder creates the billable resources, and
the application is wired to them afterwards. This file records what is already
done and what is still needed.

## Already done

- Vercel project `mastline` exists in `lauren-proctors-projects`, on Node 24.x,
  serving <https://mastline.vercel.app>.
- The GitHub repository `laurenproctor/mastline` is connected, so a push to
  `main` deploys to production and every branch gets a preview.
- `WEBHOOK_SECRET_DEFAULT` is set for production and preview: a fresh 32-byte
  value, not the local development one. It is stored non-sensitive so it can be
  read back from the dashboard when a delivery provider needs configuring.

## The database

Created and migrated. Project ref `rctvatrdgqnwhldbmgek`, region East US (North
Virginia), API URL `https://rctvatrdgqnwhldbmgek.supabase.co`.

All 7 migrations are applied: 25 tables, 52 policies, and the three private
buckets (`originals`, `derivatives`, `evidence`), none public. Production was
never seeded; the first workspace is made through real sign-up.

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

Set, via the management API. Site URL is `https://mastline.vercel.app`; the
allow list keeps the integration's preview wildcards so auth works on preview
deployments, plus localhost for development:

```
https://mastline.vercel.app/**
https://mastline-lauren-proctors-projects.vercel.app/**
https://mastline-*-lauren-proctors-projects.vercel.app/**
http://localhost:3000/**
```

Without this, password-reset and confirmation emails link back to `localhost`
and silently fail for a real user. Update Site URL when a custom domain is
chosen, and keep the wildcards.

## Stripe

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are still placeholders. Billing
routes stay inert until real test keys and the six price IDs exist. Nothing
else in the product depends on them.

## What runs without a database

Middleware serves `/welcome` and `/pricing` before it builds a Supabase client,
so the public site stays up even when the environment is unconfigured or the
database is unreachable. Everything behind the sign-in gate correctly fails
without it. `/login` and `/signup` are not in that set because they redirect an
already signed-in visitor, which needs the session.

## Verifying a deploy

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://mastline.vercel.app/welcome   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://mastline.vercel.app/pricing   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://mastline.vercel.app/login     # 200 once configured
```

The browser suite can be pointed at the deployment:

```sh
E2E_BASE_URL=https://mastline.vercel.app npx playwright test --project=desktop
```

Tests that expect the seeded workspace will fail against an empty production
database. That is expected, and the reason seeding is not done there.
