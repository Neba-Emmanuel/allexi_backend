# Release verification — 13 November 2026

Layout update — 25 November 2026: the root workspace was removed. Mobile and backend now install independently with their own package manifests and lockfiles. The 36-test suite, TypeScript checks, API build and all three mobile bundle exports passed after the change. Any workspace commands in the historical audit notes below describe the earlier layout; use PRODUCTION.md for current commands.

Production hardening is implemented and locally verified. **This is not yet a store-launch approval or a deployed production service.**

## Verified

- TypeScript checks and API compilation passed.
- All 36 automated tests passed, including the full migration sequence, authenticated HTTP operations, canonical verse validation, ownership isolation, deleted-user rejection, account deletion, preserved editorial history, and interrupted secure-session writes.
- Web, iOS and Android JavaScript/Hermes bundle exports passed. These are not signed native release binaries.
- Browser acceptance passed for admin sign-in, private drafts, review/publishing, revision history, independent editions, unsaved-change protection, reader default selection, published text/search and phone navigation. Password recovery, wrong-password deletion rejection, account deletion and sign-out passed using synthetic local fixture accounts. Screenshots: `allexi_mobile/artifacts/production-recovery-mobile.png` and `allexi_mobile/artifacts/production-delete-mobile.png`.
- A clean production-only install from the lockfile succeeded in an isolated directory: 84 packages. The compiled API ran without mobile/dev dependencies and passed liveness, expected unconfigured readiness failure, Genesis content loading, unauthenticated sync rejection, production config rejection and graceful shutdown checks.
- `npm audit --omit=dev --workspace @allexi/api --workspace @allexi/shared` reported **zero vulnerabilities**. Body-parser was updated to 2.4.0, and node-forge to 1.4.3. The existing Expo CLI simulator patch still applies.
- Missing mobile production settings are rejected by the release guard; no project credentials were added to the repository or used for these checks.

## Remaining release blockers

1. **Expo dependency chain:** the full production-workspace npm audit still reports 15 advisories (2 high, 12 moderate, 1 low), listed below. The high CLI finding is inherited from its nested Zod dependency. npm proposes a major Expo SDK 58 upgrade for most remaining findings. This task retained the working SDK 55/native stack and did not apply unverified cross-major overrides. Assess/fix these findings with a supported SDK upgrade and repeat native validation before launch.
2. **Live infrastructure:** no real Supabase environment, SMTP provider, API host, signing credentials or app store accounts were connected. Apply all migrations through `202611130001_production_hardening.sql`, configure production secrets and email templates, and test the real account flows. Local fixture tests do not prove production SMTP delivery or cloud configuration.
3. **Native acceptance:** rebuild for `expo-secure-store`, then test keychain behavior, SQLite persistence, offline/reconnect sync, accessibility and account flows on physical iOS/Android devices. Signed builds and store submissions remain external steps.
4. **Public policies and support:** publish operator-specific privacy/support pages and an account deletion request channel. Supply their HTTPS URLs to the release environment. The repository privacy document contains implementation notes, not an already published policy.
5. **Content scope:** only Genesis 1 has supplied Allexi wording. Complete editorial publication or explicitly position the launch as a preview with limited Allexi content.
6. **Container and operations:** Docker is not installed in this workspace, so the image build itself was not executed locally. CI includes its build; the equivalent isolated dependency/runtime smoke passed. Set up host monitoring, backups/restore testing, retention and rollback procedures. The default in-memory rate limiter assumes one API replica.

## Outstanding full-workspace audit findings

| Package | Severity |
| --- | --- |
| `@expo/cli` | high |
| `@expo/config` | moderate |
| `@expo/config-plugins` | moderate |
| `@expo/fingerprint` | moderate |
| `@expo/local-build-cache-provider` | moderate |
| `@expo/metro-config` | moderate |
| `@expo/prebuild-config` | moderate |
| `deepmerge` | low |
| `expo` | moderate |
| `expo-splash-screen` | moderate |
| `glob` | moderate |
| `minimatch` | moderate |
| `uuid` | moderate |
| `xcode` | moderate |
| `zod` | high |

These findings are retained in the release report rather than hidden or excluded from the audit. Re-run the audits before publishing because advisories change.

Use [PRODUCTION.md](PRODUCTION.md) for the concrete deployment and acceptance steps. CI is provided in `.github/workflows/verify.yml`; it has not run remotely because the workspace is not a Git checkout connected to a CI provider.
