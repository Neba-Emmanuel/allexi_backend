# Connect the reader, web admin and API

The configured frontend API is `https://allexibackend.vercel.app`. Both applications use the same Supabase project. The API accepts the current Expo web origin `https://allexibible--29fxnsizs3.expo.app`; native requests do not require an Origin header.

The live connection check found missing Supabase tables and RPCs, including `app_readiness` and `reader_scripture_snapshot`. Consequently `/ready` and `/v1/content` return HTTP 503. Setting another frontend URL cannot fix this database boundary.

## Install the schema once

1. Open the project's [Supabase SQL Editor](https://supabase.com/dashboard/project/gjvsrwebqhjeetgbhzul/sql/new).
2. Paste **all of `supabase/setup.sql`** into a new query and run it as the database owner (`postgres`). The file is generated from the five checked-in migrations in order and applies them in one transaction. It contains no credentials.
3. The final result should show `schema_version = 202611130001`, `default_edition = allexi` and `published_verses = 31`. It also notifies the REST API to reload its function cache.
4. This is a one-time setup for a new Allexi schema. Its guard refuses an existing installation instead of overwriting scripture or study data. If that guard fires, apply only the missing migrations after reviewing the existing schema.

Regenerate this file after migration changes with `npm run prepare:supabase` inside the backend. Do not put it inside `supabase/migrations/` or apply it after the individual migrations.

## Enable a web administrator

Create or invite the administrator through Supabase **Authentication → Users**. The frontend deliberately has no signup form. Then run this separately in the SQL Editor, replacing the email with the account you created:

```sql
insert into app_private.content_admins(user_id)
select id from auth.users where lower(email) = lower('YOUR_ADMIN_EMAIL')
on conflict do nothing;
```

For the requested support account (`allexhairdrick@icloud.com`), run `supabase/grant-support-admin.sql` instead of editing the generic query. It checks that the Auth user and schema exist, grants the private allowlist membership idempotently, and reports whether the account is an administrator. Its generated password is kept only in the ignored local `.env.admin.local` file; it is not sent by email or committed.

Use that account in the browser app's Settings, then open Admin workspace. Edit an Allexi chapter or verse, mark the verse updated, and publish reviewed verses. Saving drafts alone does not expose them to readers. Mobile readers receive published revisions on startup, reconnect, foreground and the periodic refresh, without logging in. Notes, bookmarks and highlights continue to work locally in the installed app.

## Verify the connection

From the mobile project:

```sh
cd allexi_mobile
npm run check:connection
```

The command loads the ignored local `.env` and verifies API reachability, database readiness, the actual published-content response schema, conditional revision caching, browser CORS/preflight and anonymous admin rejection. It makes only read requests and OPTIONS requests; it does not create accounts, edit or publish scripture. It prints no credentials.

By default it checks the web origin from `EXPO_PUBLIC_SUPPORT_URL`. Override that if the support pages and browser reader use different hosts:

```sh
npm run check:connection -- --origin=https://YOUR_BROWSER_APP_HOST
```

Keep `EXPO_PUBLIC_API_URL` set to the API origin without `/api` or `/v1`. Keep the public Supabase URL/key aligned with the API's Supabase project. Never include the backend's service-role key in the frontend. The same public variables must be present in the EAS environment and GitHub release environment before creating new native builds or web exports; changing a local `.env` does not update previously deployed clients.

When the browser app moves to a new Expo hostname, add its exact origin to Vercel's `CORS_ORIGINS` and redeploy the API. Prefer a stable Expo production alias or custom domain for ongoing releases. Use `/support/` and `/privacy/` with their final slash for the hosted support and privacy pages.
