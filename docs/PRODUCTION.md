# Production release

See [RELEASE_STATUS.md](RELEASE_STATUS.md) for the latest verified results and outstanding release blockers.

The repository now has runtime validation, bounded API dependencies, database readiness, account recovery/deletion, native secure session storage, a container definition and CI checks. These are release infrastructure, not evidence of a deployed production environment.

## Required external setup

1. Use a production Supabase project. Apply every SQL migration in chronological order, ending in `202611130001_production_hardening.sql`. Back up an existing database and inspect/apply migrations in staging first. Verify restoring a backup before launch. Restrict database access and enable the provider's backups appropriate to your service plan.
2. Grant editorial membership using the SQL in the root README. Enable email confirmation and set the Auth minimum password length to 12. Configure production SMTP and test signup, delivery, rate limits and recovery. In the Supabase **Reset Password** email template include `{{ .Token }}` as the recovery code; the app verifies it in-app with `type: recovery`. Configure code expiry and Supabase Auth rate limits. No redirect/deep link is needed for this recovery flow.
3. Deploy the API behind HTTPS. Use Node 24 and a single API replica, or supply a shared rate-limit store before scaling horizontally. Set `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PORT`, and exact HTTPS `CORS_ORIGINS` for any web frontend. An empty CORS list supports native requests only. Set `TRUST_PROXY_HOPS` to the host's exact trusted proxy topology; do not use unrestricted proxy trust. Keep the service role key in the host's secret manager. It is used only for deleting the authenticated account after password verification; sync/editorial requests use the caller's JWT.
4. Publish a privacy policy, support page and account deletion request channel under the actual operator's identity. Use [PRIVACY.md](PRIVACY.md) as implementation notes. Add the URLs to `EXPO_PUBLIC_PRIVACY_URL` and `EXPO_PUBLIC_SUPPORT_URL`; set the public Supabase URL/key and public HTTPS API URL in EAS's production environment. These are embedded in the app and must never contain secrets.
5. Link the Expo project to the correct account (`eas init`), verify the app identifiers, register signing credentials and app store listings. EAS production uses remote build numbers and store distribution. Development-client builds are only for development. This release adds `expo-secure-store`, so rebuild native development clients as well as release binaries.
6. Allexi currently contains Genesis 1 only. Decide whether the first release is an explicitly described preview, or finish editorial publication before advertising a complete Allexi Bible. Other Allexi chapters clearly indicate that text is being prepared.

## Build and deploy

Install each application independently; there is no root package.json:

```sh
cd allexi_backend
npm ci
npm run verify
npm audit --omit=dev
cd ../allexi_mobile
npm ci
npm run typecheck
npm run export:all
npm run check:release
APP_ENV=production npm run export:all
cd ..
docker build -t allexi-api allexi_backend
docker run --rm --env-file /secure/path/allexi-api.env -p 3001:3001 allexi-api
```

Install both apps before running the cross-app integration suite. `npm run check:release` loads the mobile folder's `.env`. EAS builds use its production environment. Shared definitions are bundled separately in both apps; `npm run sync:shared` in mobile updates its copy from the backend source, and CI checks parity.

From `allexi_mobile/`, run `eas build --profile production --platform all`, install through TestFlight/Play internal testing, then use `eas submit --profile production` after release approval. CI does not publish or submit automatically.

## Operational acceptance

- `/live` checks that the process is running. `/ready` and `/health` query the database's migration marker; they return 503 for missing configuration, missing migration or database failure. Monitor readiness, error rates and latency; configure alerts and log retention on the chosen host. Requests have server-generated IDs, and dependency requests time out after 10 seconds.
- Verify on physical iOS and Android devices: cold launch, font loading, reading, airplane-mode notes/highlights/bookmarks, process termination/restart, reconnect sync, a second device and deletions. Test storage-full and interrupted-network failure paths. Browser IndexedDB is a preview persistence option; there is no service worker guarantee for offline web cold starts.
- Verify signup with confirmation, wrong/expired credentials, recovery-code expiry/reuse, sign out, switching users, account deletion with wrong/correct passwords, and rejected API/direct RPC access using a deleted user's old token. Confirm another user's study remains inaccessible.
- Verify editing KJV and Allexi independently, simultaneous-editor conflicts, draft privacy, publishing, public cache invalidation, default edition changes and restoring text from history. Imported text has no invented actor. Deleted editors' published work remains available.
- Run npm audits for both the backend and mobile applications separately. CI blocks high/critical backend advisories; Expo tooling findings must be assessed and fixed before enabling untrusted build inputs. A major Expo SDK upgrade needs its own compatibility and signed-device verification; do not override native React/Expo dependencies blindly.
- Keep rollback images and previous store releases. Database rollbacks require an explicit forward repair or backup restore; do not delete migrations after they have been applied. Rotate credentials if exposed and never bake `.env` files into container images or source control.

The fixture server in `allexi_mobile/scripts/preview-admin.ts` is loopback-only and uses synthetic authentication; never deploy it or use its credentials for production.
