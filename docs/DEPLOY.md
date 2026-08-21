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

## Still needed: the database

The Supabase organisation `Mastline` exists but holds no project.

1. Create a project in the **Mastline** organisation, region **East US (North
   Virginia)**. Save the database password in a password manager; Supabase will
   not show it again.
2. Send over, or set directly in Vercel, the three values from
   *Project Settings → API*:

   | Variable | Where it comes from | Notes |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Public. Inlined at build time. |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` key | Public by design; RLS is the boundary. |
   | `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key | **Secret.** Bypasses RLS entirely. Mark sensitive. |

Setting them non-interactively:

```sh
vercel env add NEXT_PUBLIC_SUPABASE_URL production --value "https://<ref>.supabase.co" --force --yes
```

`--value` is required. Piping to stdin is silently ignored when the CLI detects
a non-interactive caller, which produces an empty variable rather than an error.

> `NEXT_PUBLIC_*` variables are inlined into the client bundle **at build time**.
> Changing one requires a redeploy, not just a restart.

## Applying the schema

```sh
supabase link --project-ref <ref>
supabase db push          # all 7 migrations, in order
```

The three private storage buckets are created inside the first migration, so
there is nothing to provision by hand. Do **not** run `supabase/seed.sql`
against production: it creates test accounts with a known password. Production
starts empty and the first workspace is made through the real sign-up flow,
which doubles as a smoke test of onboarding.

Afterwards, confirm the security checks still pass against the hosted database:

```sh
psql "$DATABASE_URL" -f supabase/checks/advisors.sql
```

## Supabase auth settings

Under *Authentication → URL Configuration*, set:

- **Site URL**: `https://mastline.vercel.app` (or the custom domain once chosen)
- **Redirect URLs**: add the same origin

Without this, password-reset and confirmation emails link back to `localhost`
and silently fail for a real user.

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
