# Deploy the Allexi API on Vercel

The root `index.ts` exports the existing Express app for Vercel Functions on Node.js 24. Routes stay at `/v1/*`, `/live`, `/health` and `/ready`; do not append `/api` to the client URL. `src/server.ts` remains the local/container entrypoint. Persistent data remains in Supabase.

## Project settings

Import `Neba-Emmanuel/allexi_backend` into Vercel. For this standalone repository, use its root as Root Directory. If importing the parent checkout instead, set Root Directory to `allexi_backend`.

Select **Express**, Node.js **24.x**, and leave Output Directory unset. The committed `vercel.json` supplies `npm ci --include=dev`, `npm run build` and a 60-second function duration. Development dependencies include TypeScript and type definitions required to compile, even when `NODE_ENV=production`. `dist` contains compiled Node code, not a static website. Choose a Functions region near the existing Supabase database.

Add these variables in Vercel before deployment:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Existing Supabase project's HTTPS URL |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable or legacy anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role key for password-confirmed account deletion; mark Sensitive |
| `CORS_ORIGINS` | Comma-separated exact HTTPS origins for the browser app; no paths, trailing slashes or wildcards |
| `TRUST_PROXY_HOPS` | Omit for Vercel's default of `1`, or explicitly set `1` for the standard Vercel proxy |

Use separate staging Supabase credentials and origins for Preview. Preview and Production both enforce production validation. Do not copy local `NODE_ENV=development`, `PORT` or `TRUST_PROXY_HOPS=0` to Vercel. Existing local `.env` values are unchanged.

The build checks deployment variables before TypeScript compilation, and runtime startup validates them again. To preflight locally, configure equivalent production values in the shell or an ignored local `.env`, then run `npm run check:vercel`. This checks configuration without network calls or printing credentials. `.vercelignore` excludes secrets, dependencies, old build output, tests, migration files and docs from source uploads.

## Supabase and access

Apply every migration in `supabase/migrations/` in chronological order using your Supabase migration process before production traffic. Vercel builds do not run migrations. `/ready` checks the expected migration marker.

For a new Allexi schema, `supabase/setup.sql` combines the migrations into one SQL Editor query. See [CONNECT_FRONTEND.md](CONNECT_FRONTEND.md) for installation, administrator access and the frontend connection check.

Provision administrators through Supabase Auth administration and grant membership in `app_private.content_admins` using the SQL in the parent README. Disable public signup in Supabase Auth as well as omitting the signup UI. Configure email delivery and the recovery-code template described in [PRODUCTION.md](PRODUCTION.md). Login and editorial tools are browser-only; readers fetch published scripture without accounts.

Editorial requests validate the caller's token and administrator membership on the server, and database access policies enforce permissions too. Only account deletion uses the server-only service-role key.

## Public API and rate limits

The production hostname must accept requests from the mobile app without Vercel team login. Keep protection on private previews as appropriate; never embed a protection-bypass secret in the mobile app. A Vercel login page or HTML instead of JSON indicates Deployment Protection is intercepting the request.

The existing Express limits are **per instance**: 180 API requests per minute and five account-deletion attempts per 15 minutes per IP. Vercel can run multiple instances, so these are not global quotas. Before public launch, configure Vercel Firewall rate limits for `/v1/*` and account deletion, or use a shared rate-limit store. Choose the windows and limits available on your plan. Keep Supabase Auth's rate limits enabled.

Vercel overwrites the standard forwarded-IP header at its proxy. The bounded proxy default lets Express distinguish clients. A custom proxy in front of Vercel needs its own topology review; do not use unrestricted proxy trust.

## Verify and connect clients

After deployment, check the stable production hostname:

```sh
curl --fail https://YOUR_API_HOST/live
curl --fail https://YOUR_API_HOST/ready
curl --fail https://YOUR_API_HOST/v1/content
```

`/live` should return `{"status":"ok"}`. `/ready` should return HTTP 200 with `status: "ok"`; HTTP 503 means configuration, migrations or database connectivity need attention. `/v1/content` should return configured published content. `/v1/admin/access` without a token must return HTTP 401, and a valid non-admin token must return HTTP 403.

Set `EXPO_PUBLIC_API_URL=https://YOUR_API_HOST` in the browser app, mobile EAS Production environment and GitHub's mobile Production environment, then rebuild/export the clients. The URL has no `/api` or `/v1` suffix. Add the browser app's actual origin to `CORS_ORIGINS` and redeploy if it changes. Native requests without an Origin header are accepted; CORS does not replace authentication.

Use Vercel's Git integration for previews and production-branch deployments. Run repository checks before merging; use deployment checks to gate production on CI when needed. Migrations remain a separate reviewed step. Monitor readiness and Vercel runtime logs after release. Dependency calls have a 10-second timeout, and logs contain request IDs, paths, status and duration, not credentials or study content.

This preparation does not create a Vercel project, upload variables, apply migrations or deploy the service. The backend has no runtime dependency on the mobile checkout. The existing full integration suite also checks mobile helpers and therefore needs both repositories installed locally.

References: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express), [Forwarded request headers](https://vercel.com/docs/headers/request-headers#x-forwarded-for), [Vercel Firewall rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).
