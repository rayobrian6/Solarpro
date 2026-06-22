# F-18 SPEC — Unify the Site Survey app identity model (2026-06-22, blake)

**Issue:** F-18 from `AI-AGENT-README.md` A11. MEDIUM. OPEN.
**Description:** "SQLite (auth) + PostgreSQL (surveys) dual storage identity split in app."
**Why next:** Single source-of-truth enforcement per `AI-AGENT-README.md` §13 is only
partially implemented. The mobile SQLite carries denormalized identity columns
(`solarpro_user_id`, `solarpro_email`, `solarpro_project_id`, `solarpro_org_id`) on every
survey row, the app-side `users` table on Render is a SSO-provisioned shadow of Neon,
and `inspector_name` is a free-text field with no FK to the real user. Drift is
silent; deletions and renames in Neon leave orphans in the app. F-18 was already
on the A11 list when F-13 closed; doing it now prevents the next SSO bug from
landing in the same hole.

## Root path
**Two repos are in scope.** The spec lives in the website repo because that's
where the F-13 spec lives and where the cross-repo F-18 audit trail belongs;
the actual code changes touch both repos.

| Repo | Local path | Branch | Notes |
|------|-----------|--------|-------|
| website | `C:\Users\carpe\.minimax-agent\projects\Solarpro\` | `chore/agent-rules` (working branch per R4) | spec + small website-side verification helpers |
| app | `C:\Users\carpe\source\repos\site_survey-app\` | `main` (current head `c81cda36`) | mobile SQLite + app backend changes |

The website repo's `AI-AGENT-README.md` is the canonical contract for the whole
system. The app repo has its own `AGENTS.md` and `docs/` set; cross-repo commits
must be coordinated (see §"Branch strategy" below).

## Mode (STRICT — per AGENT_INDEX.md)
- Operator: **JAMES.** Every `feat:` commit attributed to JAMES (per AGENTS.md R6).
- **No autonomous push.** No autonomous deploy.
- Pattern: implementer writes local commit → reviewer verifies → jarvis surfaces
  diff + 3-check → James says "push" → push with author=JAMES.

## Sub-agent routing
- **Primary:** `solarpro-implementer` — owns cross-repo edits. Local commit only.
- **Verify:** `solarpro-reviewer` — verifies against `AI-AGENT-README.md` A0
  (terminology), A10 (regression rules), and A11 (open issues). PASS/FAIL/
  NEEDS-DISCUSSION verdict.
- **Audit re-baseline (parallel):** `solarpro-auditor` — produces a fresh
  `AUDIT_F18_<YYYYMMDD>.md` covering the identity-link surface (mobile
  SQLite `surveys`, app backend `users` table, `refresh_tokens`, the
  `solarpro_*` columns, and the SSO handoff JWT claims).

## Scope (implementer)

### 1. Discovery (do this first — every claim needs a file:line citation)

The current state, with concrete citations from the app repo at `main` (c81cda36):

**a. Mobile local storage — `mobile/src/database/schema.ts:8–85`**
- 3 tables only: `surveys`, `checklist_items`, `survey_photos`.
- **No auth tables on mobile.** The "SQLite (auth)" part of F-18's wording is
  a misnomer in the current code — local auth tokens live in `AsyncStorage`
  (`mobile/src/context/AuthContext.tsx:12–13`:
  `AUTH_TOKEN_KEY = 'site-survey.auth.token.v2'`,
  `REFRESH_TOKEN_KEY = 'site-survey.auth.refresh-token.v1'`).
- The mobile `surveys` table carries these denormalized SolarPro ownership
  columns (schema.ts:27–31):
  - `solarpro_user_id` (TEXT)
  - `solarpro_project_id` (TEXT)
  - `solarpro_email` (TEXT)
  - `solarpro_org_id` (TEXT)
- Plus the free-text `inspector_name` column (schema.ts:15).

**b. Mobile auth flow — `mobile/src/context/AuthContext.tsx:1–265`**
- No local SQLite; tokens are JWTs in AsyncStorage.
- SSO via `signInWithSolarProToken(token)` → calls `exchangeSolarProSso(token)`
  (`mobile/src/api/client.ts:319–326`) which POSTs to `/api/users/solarpro-sso`
  on the app backend. The backend mints an app JWT + refresh token and returns
  the local `AuthUser` (`mobile/src/api/client.ts:18–25`).

**c. App backend auth — `backend/src/services/sqliteAuthStore.ts:1–542`**
- **File name is legacy.** The store does NOT use SQLite. It connects to the
  **website's Neon PostgreSQL** via `WEBSITE_DATABASE_URL` (line 71–83) and
  reads/writes the `users` table there.
- This implements the AI-AGENT-README §13 contract: "website database is the
  SOURCE OF TRUTH for user credentials."
- Refresh tokens live on the **app's own Postgres** in `refresh_tokens`
  (line 100–130). The schema in `database/schema.sql:221–232` matches.

**d. App backend SSO endpoint — `backend/src/routes/users.ts:730–879`**
- On first SSO, a `users` row is **provisioned on the website's Neon DB**
  via `createUser(ssoEmail, randomPassword, ssoName)` (line 837) with a
  64-char random password (line 836). The provisioned user can never
  sign in with a local password — SSO is the only entry point (per
  `docs/HANDOFF_SOLARPRO_ONLY_AUTH.md`).
- Email is matched case-insensitively via `lower(email::text) = lower($1::text)`
  (line 254). Replay protection via `used_solarpro_sso_tokens.jti` PK.

**e. App backend `users` table on Render — `database/schema.sql:54–63`**
- Table is defined (`id`, `email`, `password_hash`, `full_name`,
  `created_at`, `updated_at`) and migration 001 added the `surveys`
  SolarPro ownership columns (see migration 001).
- After the May 2026 SolarPro-only auth rollout, this table is essentially
  vestigial — every `users` read goes through `WEBSITE_DATABASE_URL` /
  Neon (`sqliteAuthStore.ts:287–300`). Writes via `createUser` also
  go to Neon. The Render-side `users` table may still exist in prod
  from before the rollout but is not authoritative.
- The legacy reconciliation script `backend/src/scripts/reconcileUsers.ts`
  (per `docs/user-credential-reconciliation.md`) was the previous mechanism
  for syncing Neon → Render users. It's superseded by `sqliteAuthStore.ts`
  reading Neon directly, but the script + docs are still in the repo.

**f. Server `surveys` table — `database/schema.sql:69–95` + migration `001_add_solarpro_ownership.sql`**
- Mirrors the mobile SQLite `surveys` columns. `solarpro_user_id`,
  `solarpro_email`, `solarpro_project_id`, `solarpro_org_id` are duplicated
  as TEXT columns on Render's `surveys` (migration 001 lines 5–12).
- These denormalized fields are read by the website's ingest pipeline
  (`lib/survey/ingest/ownerResolver.ts` and the webhook handler at
  `app/api/webhooks/survey-complete/route.ts` per `AI-AGENT-README.md` §7).
- The ingest pipeline expects `solarpro_user_id` in the webhook payload
  (per `services/webhookService.ts:115–121`).

**g. The actual "identity split" today**
1. **User record:** Neon PostgreSQL (`users` table on the website).
2. **Auth token:** AsyncStorage on the mobile device.
3. **Refresh token:** `refresh_tokens` on the app's Render Postgres.
4. **SSO provisioning cache:** None — Neon is read directly every time.
5. **Survey ownership:** `solarpro_*` columns duplicated on BOTH mobile
   SQLite and Render Postgres `surveys` tables.

There is no "SQLite (auth) + PostgreSQL (surveys)" split in the literal
sense — but the **denormalized identity columns** create the same failure
mode: a Neon user can be deleted, renamed, or have their email changed,
and the app-side copies don't update. The webhook payload also depends
on the cached `solarpro_*` columns being current at submission time.

### 2. Proposed model

**Goal:** make `solarpro_user_id` (the Neon UUID) the only authoritative
identity reference on the app side. Drop or down-scope the other
denormalized columns. Document the contract.

**Concrete changes:**

**(a) Document an explicit `IdentityLink` contract**
- New doc `docs/IDENTITY_LINK.md` in the app repo covering:
  - `solarpro_user_id` = the Neon `users.id` UUID. Stable, never null
    for surveys created via SSO handoff.
  - `solarpro_email` and `solarpro_project_id` are SNAPSHOTS taken at
    submission time. They are NOT refreshed; if Neon changes, the
    survey row keeps the old values.
  - `inspector_name` is replaced by a join/lookup from
    `solarpro_user_id` → Neon `users.full_name` (with a local cache
    for offline display — see (b)).
- This doc becomes the reference for any future agent working on the
  app or the website's ingest pipeline.

**(b) Mobile-side: `users_cache` table for offline display**
- Add a 4th table to `mobile/src/database/schema.ts`: `users_cache`
  with columns `(solarpro_user_id PRIMARY KEY, email, full_name,
  role, cached_at, source)`.
- Populated by the app on every successful `/api/users/me` and on
  every SSO exchange.
- Read by the UI to show owner info when offline. TTL: 24h; stale
  entries are re-fetched on the next online action.
- `inspector_name` is removed from the mobile `surveys` table. It
  becomes a derived field in the UI: `inspector_name =
  users_cache.full_name ?? 'Unknown'`.

**(c) App backend: drop `inspector_name` writes; remove
`solarpro_email` and `solarpro_project_id` from Render `surveys`**
- Migration `003_drop_inspector_name_and_snapshot_columns.sql`:
  - `ALTER TABLE surveys DROP COLUMN IF EXISTS inspector_name;`
  - `ALTER TABLE surveys DROP COLUMN IF EXISTS solarpro_email;`
  - `ALTER TABLE surveys DROP COLUMN IF EXISTS solarpro_project_id;`
  - `ALTER TABLE surveys DROP COLUMN IF EXISTS solarpro_org_id;`
- Keep `solarpro_user_id` (FK-by-convention to Neon) and `device_id`
  (operational).
- Update all read/write paths in `backend/src/routes/surveys.ts` (the
  file has 24+ references to `solarpro_email` and friends; see
  §"Migration path" for the systematic replacement).
- The webhook payload (per `AI-AGENT-README.md` §7) currently includes
  `solarpro_email`. After this change, the webhook still includes
  `solarpro_user_id`, and the website ingest pipeline must look up
  email/name on demand from Neon. Coordinate with the website side
  (see (e)).

**(d) Website-side: ingest pipeline looks up owner on demand**
- `lib/survey/ingest/ownerResolver.ts` currently reads from
  `webhook_deliveries` payload. After F-18, it must JOIN against
  Neon `users` by `solarpro_user_id` to resolve email/name.
- Add a small helper `lib/survey/ingest/resolveSurveyOwner.ts` that
  does the Neon lookup with a graceful fallback
  (`SURVEY_INGEST_DEFAULT_USER_ID` per `AI-AGENT-README.md` A10 R11).
- Update `transformLayer.ts` to map `solarpro_user_id → email` and
  `→ full_name` from Neon at ingest time.

**(e) Drop the `inspector_name` text column on the website DB**
- `projects.inspector_name` / `project_physical_data` equivalents
  become joins or snapshot fields populated from Neon at ingest.
- This is a website-side schema change. Add migration
  `db/migrations/<NNN>_f18_drop_inspector_name.sql` (NNN depends on
  current max — verify with `ls db/migrations/*.sql | tail`).

**(f) Auth surface stays on Neon**
- No changes to `WEBSITE_DATABASE_URL` config, the SSO JWT contract,
  or `sqliteAuthStore.ts` reads. AI-AGENT-README §13 contract stands.
- Refresh tokens stay on the app's Render Postgres (they're app-side
  session bookkeeping, not user records).

**(g) Drop the vestigial Render `users` table** (per JAMES sign-off, Q1)

JAMES overrode Quinn's rename proposal — the table gets a hard **drop**
in Step 7, not a rename-to-deprecated. Implementation MUST verify zero
prod writes to `users` from the app's Render Postgres since the May 2026
`HANDOFF_SOLARPRO_ONLY_AUTH.md` rollout before Step 7 executes:

- Search `C:\Users\carpe\source\repos\site_survey-app\` for any
  `INSERT INTO users`, `UPDATE users`, `users (email, password_hash`
  call paths.
- If zero matches: drop proceeds.
- If any match: STOP and surface to JAMES; switch to the rename
  fallback (`ALTER TABLE users RENAME TO _deprecated_app_users;`) or
  block on the matching code path until it's removed.

Migration: `004_drop_app_users_table.sql` —
`DROP TABLE IF EXISTS users;` plus dependent-index cleanup if anything
remains. No rename-to-deprecated step (JAMES rejected the safe default).

### 3. Migration path

Phase it so each step is independently revertible:

**Step 1 — Document only (no code change to prod behavior)**
- Land `docs/IDENTITY_LINK.md` in the app repo.
- Land `AI-AGENT-README.md` §13 update describing the contract
  (single canonical doc edit — per AGENTS.md R6 the JAMES attribution
  rule applies, but this is a `docs:` not `feat:`).
- Three-check + surface to JAMES for sign-off before anything else.

**Step 2 — Mobile-side: add `users_cache` (additive)**
- New SQLite table + read path. No DROP. No behavior change.
- Test: offline survey owner display works after a successful SSO.
- Deploy mobile via `eas update --branch preview`.

**Step 3 — Mobile-side: remove `inspector_name` from local `surveys`
(drop UI denormalization, keep the column on disk for now)**
- Stop writing `inspector_name`; read from `users_cache` instead.
- The column stays in the schema for one release for rollback safety.
- Tag as `feat(mobile): derive inspector_name from users_cache`.

**Step 4 — App backend: snapshot-column drop migration**
- `003_drop_inspector_name_and_snapshot_columns.sql` on Render Postgres.
- Update `backend/src/routes/surveys.ts` to stop selecting/inserting
  the dropped columns. Keep `solarpro_user_id`.
- Update webhook service `backend/src/services/webhookService.ts:115–178`
  to remove dropped fields from the webhook payload. Coordinate with
  Step 5.

**Step 5 — Website-side: ingest pipeline resolves owner from Neon**
- `lib/survey/ingest/resolveSurveyOwner.ts` (new).
- Update `lib/survey/ingest/ownerResolver.ts` to call the new helper.
- Tag as `feat(ingest): resolve survey owner from Neon on demand`.
- Deploy to dev (`solarpro-dev.vercel.app`) first; verify end-to-end
  with the test webhook script from `AI-AGENT-README.md` §12.

**Step 6 — Drop `inspector_name` from website DB**
- `db/migrations/<NNN>_f18_drop_inspector_name.sql`.
- Coordinate with anyone consuming `projects.inspector_name` (search
  the codebase before drafting).

**Step 7 — Drop the vestigial Render `users` table** (per JAMES sign-off, Q1)

Pre-condition verification (MUST be done before the migration runs):
- Search `C:\Users\carpe\source\repos\site_survey-app\` for
  `INSERT INTO users`, `UPDATE users`, `users (email, password_hash`
  call paths. If zero matches: drop proceeds. If any match: STOP and
  surface to JAMES.
- Migration `004_drop_app_users_table.sql`:
  `DROP TABLE IF EXISTS users;` plus dependent-index cleanup.

This is a hard drop (not the safer rename) per JAMES's override of
Quinn's proposed answer. See §2(g) for context.

### 4. Tests

**Required additions** (each lands with the corresponding step):

- `mobile/__tests__/usersCache.test.ts` — add/refresh/TTL semantics.
- `mobile/__tests__/inspectorNameDerivation.test.ts` — offline
  derived-from-cache path; fallback to "Unknown" when stale.
- `backend/src/__tests__/surveySchemaColumns.test.ts` — asserts the
  Render `surveys` table does NOT have `inspector_name`,
  `solarpro_email`, `solarpro_project_id`, or `solarpro_org_id` after
  migration 003.
- `backend/src/__tests__/ssoWebhookPayloadContract.test.ts` — asserts
  the webhook payload includes `solarpro_user_id` and `device_id`
  but NOT the dropped snapshot fields.
- `lib/survey/ingest/__tests__/resolveSurveyOwner.test.ts` — Neon
  lookup happy path, user-not-found path (falls back to
  `SURVEY_INGEST_DEFAULT_USER_ID`), Neon-down path (graceful null).

**Regression coverage (must stay green):**
- `backend/src/__tests__/api.test.ts` — all SSO tests (already exist
  per `HANDOFF_SOLARPRO_ONLY_AUTH.md`).
- Mobile existing tests for `AuthContext` (restore session, refresh
  flow, signOut).
- Website's existing `ingestPipeline` tests.

### 5. Docs

- `app_repo/docs/IDENTITY_LINK.md` — **new** (Step 1).
- `app_repo/README.md` — link the new doc.
- `Solarpro/AI-AGENT-README.md` §13 — extend with the on-demand
  owner resolution (Step 5). Note: the canonical doc; coordinate with
  JAMES per AGENTS.md §9 "Any change to AI-AGENT-README.md (any section)".
- `Solarpro/AI-AGENT-README.md` §11 — mark F-18 as in-progress when
  Step 2 lands; mark CLOSED when Step 7 lands.
- `Solarpro/AGENTS.md` — no change (the model rule already covers it).
- `Solarpro/HANDOFF.md` — append F-18 handoff per the convention in
  AGENTS.md §6.

## Out of scope (route to a different agent / different daily)

- **Anything touching `app/api/auth/authorize`, `app/api/auth/me`,
  `app/api/webhooks/`, or `lib/survey/`** in the website repo —
  per AGENTS.md §3 and §9 these are hard-no-go without explicit
  JAMES sign-off. Step 5 touches `lib/survey/ingest/*` which is
  the survey-side concern; route through solarpro-reviewer with
  extra attention, but it is in scope.
- **Production env var rotation** — separate operation.
- **M365 deliverability / Books Done** — separate workstream.
- **GAP-3 / GAP-4 / GAP-K** — separate dailies.
- **The F-07 / G-04 issues** — unrelated to identity model.
- **Render plan upgrade** — separate ops task.
- **SSO replay-protection table (`used_solarpro_sso_tokens`)** —
  already in place per `HANDOFF_SOLARPRO_ONLY_AUTH.md`; not in scope.

## Verifier checklist (reviewer)

Against `AI-AGENT-README.md`:

- [ ] **Terminology (A0)** — `website` vs `app` correct everywhere;
  no `SOURCE_DATABASE_URL` / `TARGET_DATABASE_URL` in NEW code
  (legacy references in `user-credential-reconciliation.md` are OK
  as historical context).
- [ ] **No A10 regression rule violated.** Specifically:
  - R1 (`SURVEY_WEBHOOK_SECRET`) — Step 5 must not change the
    signature scheme; verify webhook tests still pass.
  - R3 (`PARTNER_API_BEARER_TOKEN` is a JWT, not a static key) —
    not touched by F-18.
  - R5/R8 (v1.0 transformer field names) — Step 5 changes the
    field set the transformer reads; verify
    `transformLayer.ts` keeps the `latitude`/`longitude` and
    `photos[].file_path` names.
  - R10 (webhook idempotency on `event_id`) — not touched.
  - R11 (`resolveIngestOwner` fallback to
    `SURVEY_INGEST_DEFAULT_USER_ID`) — Step 5 must preserve this
    fallback in `resolveSurveyOwner.ts`.
- [ ] **No A11 issue silently regressed.** F-13 stays closed; F-18
  itself transitions MEDIUM OPEN → in-progress → CLOSED per the
  phase markers in §5.
- [ ] **No new env vars without doc updates** — F-18 doesn't add
  env vars; verify.
- [ ] **Mobile tests cover `users_cache` TTL and fallback**.
- [ ] **Migration `003_*` is additive-then-destructive-safe** —
  i.e., a single `IF EXISTS` column drop, not a cascade.
- [ ] **No hardcoded user IDs / emails** introduced anywhere.
- [ ] **Webhook payload schema change is documented** for the
  website-side consumer (`AI-AGENT-README.md` §7 figure).
- [ ] **Three-check suite green**: `tsc --noEmit`, `next lint`,
  `vitest run` (per AGENTS.md R2) — applies to BOTH repos.
- [ ] **No terminology drift** in commit messages or comments.

## Surface to James (jarvis)

When implementer reports "F-18 step N local commit ready" and reviewer
reports PASS:

1. jarvis surfaces: diff stat, file list, 3-check result, the relevant
   `AI-AGENT-README.md` updates (Step 1, 5), and the migration file
   for Render Postgres (Step 4).
2. JAMES says "push" or equivalent per AGENTS.md §7.
3. jarvis pushes with author=JAMES, committer=JAMES (per R6 — every
   step has at least one `feat:` commit, e.g. Step 2's
   `feat(mobile): add users_cache table`).

If FAIL: surface failure with reviewer citation, hold for direction.
**Do not proceed to the next step on a FAIL.**

## Cadence

- One step per daily, max. Steps 1–7 = up to 7 dailies.
- Step 0 (this spec) is done when this file is committed and JAMES
  signs off on the overall direction.
- Daily heartbeat via `mavis cron self f18-step-N-watch` per step.
- Each step has its own surface-to-JAMES cycle; do not bundle.

## Branch strategy

Locked per JAMES sign-off (2026-06-22 15:49 CT) — see §"JAMES sign-off"
below for the canonical record.

| Repo | Branch | Why |
|------|--------|-----|
| website | `chore/agent-rules` (as-is, no fork) | F-13 + this F-18 spec already live here; all F-18 commits coherent on one branch |
| app | `james-dev` | JAMES's preferred app-repo working branch (override of Quinn's `chore/agent-rules`-everywhere proposal) |

The website repo is currently on `chore/agent-rules` — implementer
continues there. The app repo is currently on `main` (head `c81cda36`);
the implementer creates or checks out `james-dev` for F-18 work.

**Cross-repo disambiguation (per jarvis flag 2026-06-22 15:52 CT):**
the website repo *also* has a `james-dev` branch at commit `31157be8`,
but that branch is an unrelated scaffold (old merged work from before
the agent-team era). F-18 work in the website repo stays on
`chore/agent-rules`. The `james-dev` referenced in the table above is
exclusively the **app repo's** working branch in
`C:\Users\carpe\source\repos\site_survey-app\` — a separate repo with
its own branches. Don't touch the website repo's `james-dev`.

Cross-repo commits must be coordinated — jarvis tracks both repos on
the same CycleReport to prevent one side landing without the other.

## Questions for JAMES (blockers — **RESOLVED 2026-06-22 15:49 CT**)

All six blockers locked by JAMES at 15:49 CT. See §"JAMES sign-off"
below for the canonical table with locked answers, overrides, and
the source-of-truth chain. The original questions are preserved here
as the proposal trail so future agents understand the trade-offs that
were considered.

1. **Render `users` table disposition** — drop, rename to
   `_deprecated_app_users`, or leave (vestigial)?
   - If drop: confirm zero prod writes to `users` from the app's
     Render Postgres since May 2026 (the date of
     `HANDOFF_SOLARPRO_ONLY_AUTH.md`). If any code path still writes
     here, dropping breaks it.
   - If rename: keep one release as a safety net.
   - **Locked: DROP** (JAMES override of Quinn's rename proposal).
     Verification gate stays — see §2(g) and Step 7.
2. **Working branch name** for both repos — keep
   `chore/agent-rules`, fork to `chore/f18-identity-model`, or
   something else?
   - **Locked: website = `chore/agent-rules` (as-is); app = `james-dev`.**
3. **Inspect-or-derive the website's `projects.inspector_name`?**
   - The website likely has `inspector_name` columns on
     `projects` / `project_physical_data` / maybe `users`. Step 6
     removes them. Confirm: do any current reads depend on
     `inspector_name` being denormalized (e.g., proposal PDFs,
     customer emails)?
   - If yes, the snapshot-on-ingest pattern is still needed for
     those surfaces — we just narrow the columns from
     "everywhere" to "wherever a snapshot is intentionally captured".
   - **Locked: defer to Step 6 research.** Implementer searches for
     consumers (proposal PDFs, customer emails) before deciding.
4. **Mobile rollout vehicle** — `eas update --branch preview`
   (over-the-air, no app store review) for Step 2 + 3, then a full
   EAS build for the SQLite migration if any schema change needs
   native rebuild. Confirm that's acceptable.
   - **Locked: yes.** EAS OTA for additive Steps 2 + 3. Full EAS
     build only if native schema change requires it.
5. **Cut-over strategy** — dual-write window for the snapshot
   columns (send both old and new in webhook payloads for one
   release) or hard cut-over at Step 5? Recommend hard cut-over
   because the website-side ingestion is single-tenant controlled.
   - **Locked: hard cut-over at Step 5.** Single-tenant controlled,
     low risk. No dual-write window.
6. **Idempotency for the Neon lookup at ingest time** — if Neon
   is briefly unavailable, what does `resolveSurveyOwner` return?
   Null + `SURVEY_INGEST_DEFAULT_USER_ID` fallback, or fail the
   ingest (which the queue retries)? Recommend null + fallback —
   ingest must not be blocked by a Neon hiccup.
   - **Locked: null + `SURVEY_INGEST_DEFAULT_USER_ID` fallback.**
     A10 R11 compliant. Ingest must not be blocked by a Neon hiccup.

## Reference docs

- `C:\Users\carpe\.minimax-agent\projects\Solarpro\AI-AGENT-README.md`
  — §0 terminology, §4 databases, §5 shared secrets, §7 data flow,
  §8 key file map, §10 regression rules, §11 open issues, §13
  database sync contract.
- `C:\Users\carpe\.minimax-agent\projects\Solarpro\AGENTS.md`
  — R1–R6 rules, §3 hard no-go list, §4 pre-flight, §5 pre-push,
  §7 STRICT mode, §9 escalation triggers.
- `C:\Users\carpe\.minimax-agent\projects\Solarpro\HANDOFF.md`
  — current state (depth / plane extraction / photogrammetry).
  F-18 is orthogonal but the project is in STRICT mode per the
  project root.
- `C:\Users\carpe\.minimax-agent\projects\Solarpro\HANDOFF_F13.md`
  — F-13 close-out (admin override env var). Pattern to mirror
  for F-18 handoff.
- `C:\Users\carpe\.mavis\agents\jarvis\workspace\outbox\solarpro-f13-spec-2026-06-19.md`
  — F-13 spec format reference (this F-18 spec follows the same
  shape).
- `C:\Users\carpe\source\repos\site_survey-app\AGENTS.md`
  — app-side agent rules.
- `C:\Users\carpe\source\repos\site_survey-app\README.md`
  — app-side architecture overview.
- `C:\Users\carpe\source\repos\site_survey-app\database\schema.sql`
  — Render Postgres schema (lines 54–63 users, 69–95 surveys,
  221–232 refresh_tokens).
- `C:\Users\carpe\source\repos\site_survey-app\database\migrations\001_add_solarpro_ownership.sql`
  — adds `solarpro_user_id`, `solarpro_email`, etc.
- `C:\Users\carpe\source\repos\site_survey-app\mobile\src\database\schema.ts`
  — mobile SQLite schema.
- `C:\Users\carpe\source\repos\site_survey-app\mobile\src\context\AuthContext.tsx`
  — mobile auth flow (AsyncStorage only).
- `C:\Users\carpe\source\repos\site_survey-app\mobile\src\api\client.ts:319`
  — `exchangeSolarProSso`.
- `C:\Users\carpe\source\repos\site_survey-app\backend\src\services\sqliteAuthStore.ts`
  — Neon-as-source-of-truth auth implementation.
- `C:\Users\carpe\source\repos\site_survey-app\backend\src\routes\users.ts:730`
  — `/api/users/solarpro-sso` handler.
- `C:\Users\carpe\source\repos\site_survey-app\docs\HANDOFF_SOLARPRO_ONLY_AUTH.md`
  — May 2026 auth-only-via-SolarPro rollout (background).
- `C:\Users\carpe\source\repos\site_survey-app\docs\user-credential-reconciliation.md`
  — legacy Neon↔Render user reconciliation script (superseded
  by `sqliteAuthStore.ts` reads from Neon).

## JAMES sign-off (2026-06-22 15:49 CT)

Sign-off authority: JAMES (per standing delegation 2026-06-22 15:30 CT —
"make decisions that don't require me unless I state otherwise").

| # | Question | Locked answer |
|---|----------|---------------|
| 1 | Render `users` table disposition | **DROP** (JAMES override on Quinn's rename proposal). Implementer MUST verify zero prod writes since May 2026 auth-only-via-SolarPro rollout before Step 7 executes. |
| 2 | Working branch name | Website: keep `chore/agent-rules` (where F-13 + this spec live). App repo: use `james-dev` (JAMES override). |
| 3 | Website `projects.inspector_name` — drop or derive? | Defer to Step 6 research. Implementer searches for current consumers (proposal PDFs, customer emails) before deciding. |
| 4 | Mobile rollout vehicle | `eas update --branch preview` (over-the-air) for Steps 2+3. Full EAS build only if native schema change requires it. |
| 5 | Cut-over strategy | Hard cut-over at Step 5. Single-tenant controlled ingest. No dual-write window. |
| 6 | Idempotency for Neon lookup at ingest | Null + `SURVEY_INGEST_DEFAULT_USER_ID` fallback (A10 R11 compliant). Ingest must not be blocked by Neon hiccup. |

Quinn proposed answers that were locked: Q5, Q6. JAMES overrode: Q1, Q2.
Canonical record: `~/.mavis/agents/jarvis/workspace/inbox/james-f18-answers-2026-06-22.md`.
Review packet: `~/.mavis/agents/quinn/workspace/f18-review-2026-06-22.md`.

---

## What I (blake) will do

- Hand this spec to Quinn for review.
- Do **not** start implementation until JAMES signs off on the
  direction and the §"Questions for JAMES" blockers are answered.
- When implementation starts, write the per-step handoffs
  (`HANDOFF_F18_STEP_N.md`) per AGENTS.md §6.
- Coordinate with solarpro-implementer / solarpro-reviewer /
  solarpro-auditor through Quinn's CycleReports.
- Watch the `f18-spec-watch` cron (set by Quinn on dispatch) for
  async signals.

— blake
