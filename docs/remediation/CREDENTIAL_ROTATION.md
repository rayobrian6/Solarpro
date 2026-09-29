# Credential rotation list (no values — names and locations only)

Status: **nothing has been rotated.** This is the list for the owner to act on.
Plaintext occurrences below were already in the tree at the shallow-clone
cut-off, so assume they are in the full GitHub history (and in any fork/clone):
removing them from the tree does **not** un-leak them — they must be rotated.

No consumer in the website supports two keys at once, so every rotation is a
**hard cut-over**: set the new value on every consumer in one window.

---

## A. Private secrets — committed in plaintext → ROTATE

Ordered by blast radius.

| # | Secret | Protects | Where it is committed | Website consumers | Other consumers | Rotation order / outage risk |
|---|---|---|---|---|---|---|
| 1 | **Render API key** (`rnd_…`-shaped string) | Full control of every Render service: env vars, deploys, shell | `HANDOFF.md` (3×), `HANDOFF_PASS3C.md` (4×), `HANDOFF_PASS3D_ROGUE_LINES.md` (2×), `P1_HANDOFF.md` (1×) | none (operator tool) | Render dashboard / API | **First.** Revoke in Render → Account → API keys, issue a new one, store it outside git. No runtime outage (nothing in the product uses it). Liveness unknown — treat as live. |
| 2 | **Super-admin account password** | The owner's super_admin login | `app/api/migrate/route.ts:~2166` (dead code — the route returns 423 before it) and the default `ADMIN_PASSWORD` in `scripts/smoke-test-{authorize,battery,hijack,ownership-audit,ownership-edge}.sh` (the scripts log in to `solarpro-dev.vercel.app`) | login | — | Reset the password of the account those scripts target (and of any account that shares it); enrol MFA on it. No outage. Then delete the literal from the scripts and the dead migrate code. |
| 3 | **neondb_owner database credential** | Owner role on the **website database** | Not in the current tree; `lib/security/secretScan.ts:52` and root reports record it as **leaked and not rotated**; it survives in history and tags `stable-v47.25` / `production-stable-v47.25` | `DATABASE_URL` on `solarpro-v31` and `solarpro-dev` | `DATABASE_URL` on Render `solarpro` + `geometry-reconstruction-worker`; `WEBSITE_DATABASE_URL` on the app backend; operators' local `.db_url` | **Do not just reset the password** (everything breaks until each consumer is updated). Create a new role (least privilege per consumer if possible) → move each consumer over → verify → then drop/reset the old role. |
| 4 | **`SOLARPRO_HANDOFF_SECRET`** (HS256 key for SSO, handoff and `/api/mobile/*` bearer JWTs) | Anyone holding it can mint a JWT with an `email` claim and act as **any website user** on `/api/mobile/*` (`lib/mobile/auth.ts:228-245`) | `AI-AGENT-README.md` §5, §6, §7, §12 (5×); `PARTNER_HANDOFF_MOBILE.md:49,65`; `scripts/smoke-test-authorize.sh:25`; `scripts/smoke-test-jwt-boundary.sh:11,16` | signs: `app/api/auth/authorize` · verifies: `lib/survey/tokenMinter.ts` (via `lib/mobile/auth.ts`, survey submit/readiness/upload-photo) | **App backend (Render) — verifies SSO/handoff, mints proxy JWTs** | Set new value on **both Vercel projects + the app backend in one window**, then redeploy both sides. In the gap: SSO, `/api/mobile/*` and survey submit fail; in-flight 10-min SSO tokens die. **Use a value different from #5** (today they are the same literal). |
| 5 | **`SURVEY_WEBHOOK_SECRET`** (HMAC on survey-complete webhooks) | Integrity of survey ingestion | Same places as #4 (same literal) | verifies: `app/api/webhooks/survey-complete` · signs: `app/api/survey/submit` (website → itself) | **App backend — signs webhooks** | Same window as #4. Webhooks sent in the gap get 401; with this branch's idempotency fix a correctly signed **retry** is now processed (previously the 401 row consumed the event). Whether the app re-signs on retry is in the app repo. |
| 6 | **`CRON_SECRET`** | Vercel cron endpoints | `AI-AGENT-README.md` §6 (64-hex value) | `app/api/cron/stale-job-cleanup:39`, `app/api/cron/proposal-expiry:43`, `prospects/pipeline/tick:26` (plain `===`) | Vercel Cron | Per Vercel project; low risk (a cron run may 401 during the change). |
| 7 | **`MIGRATE_SECRET`** | Second factor for legacy admin DB tools | `AI-AGENT-README.md` §6 | `app/api/migrate` (now always 423), `admin/set-roles` (blocked in prod), `admin/system-tools:939` | operator | Vercel only; low risk. |
| 8 | **`INTERNAL_WORKER_AUTH_TOKEN`** — former default literal | `/geometry-reconstruction/execute` | a former default value in `P1_HANDOFF.md:118`, `TASK4_DELIVERABLES.md:141` (the code no longer falls back to it) | `execute/route.ts:59,93` | — | Check the Vercel value is **not** that literal; rotate if it is. |

## B. Secrets **not** committed (listed for completeness — rotate only on policy)

| Secret | Note |
|---|---|
| `JWT_SECRET` (website) | Rotating logs out every user (30-day sessions, 7-day portal). `P1_HANDOFF.md:118` says it is the same across Vercel environments — if dev and prod also share a DB, a session minted on dev is valid on prod **[dashboard]**. |
| `PARTNER_API_BEARER_TOKEN` | 10-year admin JWT signed with the **app's** `JWT_SECRET`; revocable only by rotating that secret (logs out every app user). |
| `MFA_ENCRYPTION_KEY` | **Never rotate by changing the value alone** — every MFA user is locked out. Needs a re-encryption migration or dual-key code first. |
| `MOBILE_SERVICE_API_KEY` (app side: `SOLARPRO_API_KEY`) | Single accepted value; the **first 8 characters of the key and of the presented bearer are logged** on every call (`lib/mobile/auth.ts:86-89`) — fix the logging before relying on it. Change together with Render. |
| `ADMIN_SECRET` | Break-glass routes; Vercel only. |
| **New on this branch:** `VISION_SERVICE_TOKEN` | Must be set on the three Render vision services and both Vercel projects **before** this branch reaches `dev` (see `DEPLOYMENT_MAPPING.md` §5). |

## C. Browser-visible keys — **not** compromised by being in the browser

A Maps/Static-Maps/3D-Tiles key or a Cesium Ion token is *meant* to reach the
browser; what protects it is its **restrictions**, not secrecy.

| Key | Where | Assessment | Action |
|---|---|---|---|
| **Google API key (hard-coded literal, one key)** | client: `app/proposals/page.tsx:1943`, `app/proposals/view/[id]/page.tsx:859` (Static Maps `<img>`), `components/3d/CesiumViewer.tsx:50`, `components/3d/Google3DViewer.tsx:19` (fallbacks when `NEXT_PUBLIC_GOOGLE_MAPS_KEY` — note the different name — is unset); **server**: `lib/permit/satelliteService.ts:17` (Geocoding + Static Maps); docs: `docs/BUG-AUDIT-2026-06-16.md:54` | The browser exposure is by design. The problem is that **the same key is used server-side**: either it is HTTP-referrer-restricted (then the server calls fail) or it is unrestricted (then the exposed key works for every API enabled on it — Geocoding, Solar, Tiles — at SolarPro's cost). **[GCP console]** | Split into a browser key (referrer-restricted, only Maps JS / Static / Tiles) and a server key (IP/none, only the server APIs); move both to env vars; then revoke the hard-coded key. |
| Server Google keys falling back to the browser key | `app/api/solar`, `solar-rgb`, `solar-tile`, `dsm`, `tile`, `elevation`, `maps-session`, `lib/siteSurveys/googleSolarApi/client.ts`, `lib/permit/sections/sitePlan.ts:841` all do `GOOGLE_SOLAR_API_KEY ?? GOOGLE_MAPS_API_KEY ?? NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | If the server vars are unset on Vercel, the Solar API runs on the browser-visible key **[dashboard]** | Set the server vars; remove the `NEXT_PUBLIC_` fallback so a missing server key fails loudly. |
| Cesium Ion access token (hard-coded JWT, no expiry) | `components/3d/CesiumViewer.tsx:181` (the live engine uses `NEXT_PUBLIC_CESIUM_ION_TOKEN`) | Browser-visible by design; check its **scopes** and allowed URLs in the Cesium Ion dashboard | Restrict to `assets:read` + the site's origins; regenerate if broader. |

## D. Suggested order

1. Render API key (#1) and super-admin password (#2) — no outage, highest control.
2. neondb_owner (#3) — staged: new role → move consumers → retire old.
3. Handoff + webhook secrets (#4, #5) — **one coordinated window** with the app
   team (Vercel ×2 + Render app backend), two **different** new values.
4. `CRON_SECRET`, `MIGRATE_SECRET`, check `INTERNAL_WORKER_AUTH_TOKEN` (#6–#8).
5. Google key split + Cesium scope check (§C).
6. Then scrub the values from `AI-AGENT-README.md` and the handoff docs
   (after rotation — scrubbing first only hides that they need rotating).
