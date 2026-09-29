# HANDOFF — Audit remediation (P0 auth/tenant/signature · P1 save/delivery · dev CI)

**Date:** 2026-09-29
**Branch:** `claude/keen-sagan-i2fl6m` (on `origin/dev` @ `ce4e208d`; branched at `9f4ee8b4`, rebased before push)
**Status:** staged for review. **Not merged into `dev`, and it must not be merged until the
`VISION_SERVICE_TOKEN` rollout below is done.**

---

## Standing Rules

- Nothing here is pushed to `dev` or `master`. Integration into `dev` is Ray's review
  gate; `master` promotion is JAMES's (AGENTS.md R1, R8).
- Merging into `dev` **redeploys the Render services that production uses** (all three
  build from `branch: dev`; see `docs/remediation/DEPLOYMENT_MAPPING.md`). Treat a
  merge into `dev` as a production worker deploy until that is decoupled.
- No deployment branch, env var, secret or database was changed. Nothing was rotated.
- Every fix was proven by restoring the original code and watching its test go red,
  then green with the fix. The counts are in each commit message.
- Terminology per AI-AGENT-README §0: website / app / website database / app database.

## What Was Done

### P0: auth, tenancy, signature

| # | Defect (behaviour on `dev`) | Fix (the existing authority, not a symptom) | Proof |
|---|---|---|---|
| 1 | A share-link holder could PATCH a proposal to `accepted`/`signed`, or write a signature, **without the e-signature workflow**. The owner PATCH/PUT/bulk could do the same. | `lib/proposal/signatureAuthority.ts`: the only way to make a proposal signed is `POST /sign`. Share tokens get one check (`checkShareToken`: shared, constant-time, unexpired). Signing is compare-and-set (`signed_at IS NULL`), so it can't be signed twice. | `tests/proposalSignatureIsTheOnlyWayToSign.test.ts`: 18 red → 27 green |
| 2 | A plain admin could reset the password of the owner (`super_admin`) and **was handed the temporary password**, and could suspend, re-plan or impersonate any account. | `lib/adminRoleHierarchy.ts` `canActOnAccount`: an admin acts only on roles it strictly outranks. An unknown target role is refused. Applied in `admin/users`, `free-pass`, `impersonate` (at issue AND redeem) and `companies`. | `tests/adminCannotActOnEqualOrHigherRole.test.ts`: 23 red → 33 green |
| 3 | Permit / BOM / SLD / preview routes accepted **any** `projectId` and returned or used another tenant's project. | `lib/projectAccess.ts` `authorizeProjectAccess`/`gateProjectAccess`: owner or platform admin, else 403/404. Applied in permit POST/GET/preview, bom, sld, sld/pdf. | `tests/permitAndDrawingsAreTenantScoped.test.ts`: 5 red → 11 green |
| 4 | The SAM2 / MiDaS and OpenCV Render services answered **anyone on the internet**. The OpenCV worker fetched any caller URL, following redirects (SSRF). | Bearer `VISION_SERVICE_TOKEN` middleware; fails closed when unset. `url_guard.py` validates every fetch hop. The website sends the token from one helper, `lib/renderServiceAuth.ts`. | `tests/python/test_vision_service_auth.py`: 15 red → 44 green. `tests/visionServiceCallsCarryAuth.test.ts`: 10 red → 13 green |
| 5 | The MFA page followed `?redirect=https://evil…` (or `javascript:`). The SSO authorize default allowlist admitted bare `exp://`, so a 10-minute SSO JWT could go to any Expo URL. | `lib/safeRedirect.ts` allows same-origin relative only. `lib/ssoRedirectAllowlist.ts` defaults to `sitesurvey://`; bare `exp://` and `u.expo.dev` are ignored even when configured. | `authRedirectsStayOnSite`, `mfaRedirectStaysOnSite`, rewritten `priority-sso-authorize`: 12 red → 57 green |

### P1: data loss

| Defect | Fix | Proof |
|---|---|---|
| One wheel notch set zoom 19.75. `INTEGER map_zoom` refused it **after** the version claim, so every later save was refused ("saved somewhere else"). | `normalizeMapZoom`; a post-claim failure returns the claimed version, and the studio adopts it. | `layoutConcurrency.postgres` + `siteDesignRoute.postgres` (real Postgres via PGlite); **browser e2e** |
| Quick Design could not save ("saving is disabled"). | Quick Design hydrates from "nothing stored" at its own site key; the restore fence still opens only after a hydration. | `quickDesignKeepsItsDesign.component` |
| Promoting a Quick Design hydrated the new project's **empty** row over the design. The reopened project resolved to a different property (the server geocodes, ignoring the coordinates). | The promotion marks the adopted id. The new row is pinned to the design's property (PATCH lat/lng). The location effect leaves an adopted project alone and keeps its solar data. | component test + **browser e2e** |

**Browser proof:** `e2e/design-save-survives-zoom-and-promotion.spec.ts`, 2/2 passing in
Chromium against real routes and real Postgres (`SOLARPRO_LOCAL_PG=1`):
`design → zoom → save → reload` and
`Quick Design → address → design → promote → reopen` keep the same geometry, equipment
and state, and every layout POST is accepted. The promotion case failed before the pin.

### P1: survey delivery

A forged or malformed delivery carrying a real `event_id` was logged first and took the
`(source, event_id)` slot. The partner's **correctly signed retry then got "duplicate" and was
never ingested**, and a failed ingest held the slot forever. Now only a signed, valid
delivery claims an event:

- insert as `verified`, or
- take over a `failed` row, or a `verified` row past the 5-minute in-flight window, by
  compare-and-set.

Rejected deliveries are still logged, as `failed`, and never block. True duplicates after
ingestion still answer 200 duplicate. Admin replay now refuses unsigned deliveries, whose
body came from whoever sent it.
Proof: `tests/surveyWebhookDeliverySemantics.postgres.test.ts` (real HMAC, migrations 011 +
014 in PGlite): 6 red against the old route, and replay red against the old replay route.

### The 15 failing tests on `dev`: triaged, none "fixed" by changing values

| Suite (red) | Verdict | Evidence |
|---|---|---|
| panelCompatibilityGate: MARGINAL (1) | **Stale** | It relied on the old ×1.12 fallback. **×1.25 is the intended authority** (a5e3cb32, locked by `panelGateReadsTheSiteTemperature`). The marginal band is now exercised at −20 °C. |
| panelCompatibilityGate: evervolt × 3 micro brands (3) | **Stale test, REAL product regression in the caller** | The engineering page's main sizing (`page.tsx:3752`) and per-sub recommendations (`:5463`) passed **no site temperature**. So ×1.25 auto-swapped EverVolt (61.3 V vs 60 V), although it is 55.1 V at −25 °C, and strings were sized at −10 °C. Fixed at the callers; a source check goes red on exactly those two lines. |
| proposals-sign "getDbReady once" (1) | **Stale** | The two extra acquisitions are the stage writer (`applyStageChange` + `generateTasksForStage`, added in 3cddb98d). Neon HTTP executors are stateless. The test now isolates the stage writer and asserts the hand-off. |
| mapSources MapSourcePicker (10) | **Stale, intended** | 2e58cb94 unmounted the provider dropdown ("same choice offered twice"). Its extra entries, Bing and Mapbox, are `wired: false`. Google and Nearmap are reachable, visibly, via `ImageryToggle`. **No required control was lost.** |
| lint: 3 errors | Mis-named closure | `useSessionOr` → `fallBackToSessionOr` (not a hook). |

### Deployment, CI, credentials

- `docs/remediation/DEPLOYMENT_MAPPING.md`: service → branch → env → DB → consumer,
  blast radius, dashboard-only unknowns, options A/B/C. **Investigation only.**
- `docs/remediation/CREDENTIAL_ROTATION.md` covers three groups:
  - committed private secrets in rotation order, with consumers and outage risk;
  - uncommitted secrets;
  - browser keys, judged on their restrictions.

  **No values; nothing rotated.**
- `.github/workflows/ci-dev.yml`: typecheck → lint → secret guard → critical suites → Python
  service tests → full vitest at one worker, on push/PR to `dev`. `ci.yml` (master) untouched.

## Current State

- Branch `claude/keen-sagan-i2fl6m`, 16 commits on `origin/dev` @ `ce4e208d` (the one new `dev`
  commit, the electrical service graph, touches no file this branch changes).
- `npx tsc --noEmit --skipLibCheck`: 0 errors.
- `npm run lint`: 0 errors (dev had 3).
- `npx vitest run` (after the rebase): **806 files passed, 15,982 tests passed, 0 failed**
  (1 expected-fail, 492 skipped, none added by this branch). `dev` had 15 red.
- `pytest tests/python`: 44 passed.
- Browser e2e (`design-save-survives-zoom-and-promotion`): 2/2 (local Chromium, PGlite), run
  before the rebase; the rebased-in commit does not touch the studio or the layout path.

## Files Modified

| File | Role |
|---|---|
| `lib/proposal/signatureAuthority.ts` (new), `lib/proposalAccess.ts`, `app/api/proposals/[id]/route.ts`, `…/sign/route.ts`, `…/share/route.ts`, `app/api/proposals/bulk/route.ts`, `app/proposals/page.tsx` | P0.1 the single signature authority |
| `lib/adminRoleHierarchy.ts` (new), `app/api/admin/{users,free-pass,impersonate,companies}` | P0.2 role outranking |
| `lib/projectAccess.ts` (new), permit / bom / sld / sld-pdf / preview routes | P0.3 project tenancy |
| `sam2-service/service_auth.py` (new), `external-workers/opencv-photo-vision/app/{service_auth,url_guard}.py` (new), both `main.py`, SAM2 `Dockerfile`, both `render.yaml` (env declarations only), `lib/renderServiceAuth.ts` (new) + 6 clients | P0.4 vision-service auth |
| `lib/safeRedirect.ts` (new), `lib/ssoRedirectAllowlist.ts` (new), `app/auth/mfa/page.tsx`, `app/auth/login/page.tsx`, `app/api/auth/authorize/route.ts` | P0.5 redirects |
| `lib/db/projects.ts`, `lib/db-neon.ts` (re-exports), `app/api/projects/[id]/layout/route.ts`, `components/design/DesignStudio.tsx` | P1 design save / Quick Design / promotion |
| `app/api/webhooks/survey-complete/route.ts`, `app/api/admin/survey-webhook-log/[id]/replay/route.ts` | P1 webhook claim semantics |
| `app/engineering/page.tsx` | site temperature into the two sizing memos |
| `components/3d/SolarEngine3D.tsx` | lint rename only |
| `.env.example` | `VISION_SERVICE_TOKEN`, `AUTHORIZE_ALLOWED_REDIRECTS` guidance |
| `.github/workflows/ci-dev.yml`, `docs/remediation/*` | CI + investigations |
| tests: 9 new suites (8 vitest + 1 pytest) + 1 e2e spec; 16 existing suites updated (harness changes for the new authorities, and the 3 stale-test rewrites) | proofs |

## Pending Work (priority order)

1. **Decide and roll out `VISION_SERVICE_TOKEN` before any merge into `dev`**
   (`DEPLOYMENT_MAPPING.md` §5). Set it on the Render `solarpro`, `sam2-segmentation` and
   `geometry-reconstruction-worker` services **and** on both Vercel projects, then redeploy
   the website. Merging first means every vision call answers 401.
2. **Decide the Render decoupling option** (A/B/C in `DEPLOYMENT_MAPPING.md` §4). The
   dashboard facts in §3 are needed first.
3. **SSO allowlist in production:** if `AUTHORIZE_ALLOWED_REDIRECTS` contains a bare
   `exp://` (Expo Go), that entry is now ignored and logged. Expo Go SSO needs an explicit
   `exp://<host>` entry, or a dev build with the `sitesurvey://` scheme.
4. **Confirm migration 014** (`webhook_delivery_idempotency`) is applied on the website
   database. The claim logic relies on its partial unique index.
5. **Credential rotation**, in the order in `CREDENTIAL_ROTATION.md` §D (owner action).
6. Environment: allow `cesium.com` in this cloud environment's network settings so the e2e
   can load Cesium from the CDN. `E2E_LOCAL_CESIUM=1` is the workaround.

## Architecture Notes

- **Signing:** `POST /api/proposals/:id/sign` is the only writer of `signed`/`accepted` and
  of signature fields. Everything else goes through `checkNonSignatureWrite`. Do not add a
  second signing path.
- **Admin actions:** every admin route that targets an account must call
  `canActOnAccount(actor, target)`; "is an admin" is not enough.
- **Project-scoped engineering routes:** call `gateProjectAccess` before reading anything
  keyed by `projectId`, including stored combiner selections.
- **Vision services:** the token is sent by `withVisionServiceAuth()` only; the census test
  fails if a new client fetches a service without it. `/health` stays public.
- **Webhook:** `(source, event_id)` is claimed only by `signature_valid = true` rows
  (migration 014's partial index). Rejected deliveries are evidence, not claims.
- **Layout save:** the version claim is not rolled back (the `updated_at` trigger), so any
  failure after it must return `currentVersion`. The studio adopts it; otherwise the next
  save is refused.
- **Sizing:** every `sizeSystemFromBrand` call on the engineering page must pass
  `designTempMin` (source check in `panelGateReadsTheSiteTemperature`). The gate's ×1.25
  is for an unknown site only.

## Next Steps

1. Ray reviews `claude/keen-sagan-i2fl6m` commit by commit (each commit is one slice).
2. Answer pending items 1–4 above.
3. Set `VISION_SERVICE_TOKEN` everywhere, then merge into `dev` (Ray's gate). Watch the
   three Render deploys, then check `/health` and one authenticated vision call.
4. With `ci-dev.yml` on `dev`, the next push shows its first green or red run.
