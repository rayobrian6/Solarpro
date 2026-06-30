# HANDOFF — F-18 Step 1 (IdentityLink contract — docs only)

**Date:** 2026-06-23
**Step:** F-18 Step 1 of 7 (per `F18-SPEC.md` §3)
**Author of record:** JAMES (per AGENTS.md R6)
**Drafter:** blake
**F-18 spec:** `C:\Users\carpe\.minimax-agent\projects\Solarpro\F18-SPEC.md` @ `64cc6691`
**Step 1 dispatch:** `C:\Users\carpe\.mavis\agents\jarvis\workspace\outbox\f18-step1-dispatch-2026-06-23.md`
**JAMES sign-off record:** `C:\Users\carpe\.mavis\agents\jarvis\workspace\inbox\james-f18-answers-2026-06-22.md` (locked 15:49 CT)

---

## 1. Standing Rules (relevant to this step)

- **R6 — Author/committer.** Per AGENTS.md R6, every `feat:` commit on this
  project is attributed to JAMES. Step 1 is `docs:` work (additive), but
  per the established pattern the same JAMES attribution applies. Git
  config on the website repo (`C:\Users\carpe\.minimax-agent\projects\Solarpro\`)
  is already set: `user.name = JAMES`,
  `user.email = carpenterjames88@gmail.com`. The app repo will need the
  same config applied before the IDENTITY_LINK.md commit lands there.
- **Single canonical doc edit.** Every doc edit goes through the
  `chore/agent-rules` working branch (website) and `james-dev`
  working branch (app), per the F-18 Q2 sign-off. No autonomous push
  (AGENTS.md §7, STRICT mode). Surface to JAMES for "push" word.
- **No-go rule — §10 regression rules.** AGENTS.md §3 lists "Modify any
  rule in `AI-AGENT-README.md` §10" as a hard no-go. Step 1 does NOT
  touch §10 — only §13 (IdentityLink contract) is appended. Verified.
- **AI-AGENT-README.md edits are an escalation trigger** (AGENTS.md §9).
  The §13 append is covered by JAMES's standing delegation to Quinn
  (per the F-18 sign-off packet, 15:30 CT 2026-06-22). The implementer
  should NOT modify AI-AGENT-README.md without re-confirming the
  delegation is in force.
- **No new env vars, no schema migrations, no code changes.** Step 1
  is docs only. The implementer landing the drafts must not introduce
  anything beyond the two files listed in §4.

---

## 2. What Was Done

This step is **additive docs only**. No code change. No schema change.
No env var change.

- **NEW: `C:\Users\carpe\source\repos\site_survey-app\docs\IDENTITY_LINK.md`**
  (app repo) — the canonical IdentityLink contract, v1.0. Defines the
  three rules:
  - Rule 1: `solarpro_user_id` is the **only** authoritative identity
    reference between the website Neon `users.id` and the app side.
  - Rule 2: `solarpro_email` and `solarpro_project_id` are
    **SNAPSHOTS captured at submission time**, not refreshed from
    Neon. Deprecated as of F-18 Step 4.
  - Rule 3: `inspector_name` is a **derived field**
    (`users_cache.full_name ?? "Unknown"`), not a stored column.
  Includes a scope table, cross-references to the F-18 spec, the
  AI-AGENT-README §13 update, the May 2026 SolarPro-only auth handoff,
  the SSO contract, and the relevant backend code
  (`sqliteAuthStore.ts`, `users.ts:730`). Closes with a future-agent
  checklist for the dangerous-touch surfaces and a v1.0 changelog
  entry.
- **EDIT: `C:\Users\carpe\.minimax-agent\projects\Solarpro\AI-AGENT-README.md`**
  §13 (website repo) — appended a new subsection
  **"### IdentityLink contract — surveys (F-18, 2026-06-23)"** just
  before the closing `---` separator at the end of §13. The existing
  "### Sync Logic Location" content stays untouched (additive, no
  replacement). The new subsection summarizes the three rules at the
  canonical-doc level, cross-references the new
  `docs/IDENTITY_LINK.md` in the app repo, and flags the in-flight
  F-18 Step 4-7 column drops as the deprecation path.
- **NEW: `C:\Users\carpe\.minimax-agent\projects\Solarpro\HANDOFF_F18_STEP_1.md`**
  (website repo) — this document. Lands in the same push as the
  IDENTITY_LINK.md commit on the app repo and the §13 update on the
  website repo, per AGENTS.md §6.

**No code change.** No tests added, no migrations, no env vars, no
dependency changes. The three deliverables are documentation only.

---

## 3. Current State (post-Step-1-lands)

- **Branch (website repo):** `chore/agent-rules` (locked per F-18 Q2
  sign-off). F-13 is already pushed here (merge at `5193eb12` per
  Drew earlier in the session — F-13 deploy done). The F-18 spec
  itself is also on this branch at `2457c4cd` (original) +
  `64cc6691` (JAMES sign-off applied). Step 1's §13 update commit
  lands on top of `64cc6691` once JAMES signs off.
- **Branch (app repo):** `james-dev` (locked per F-18 Q2 sign-off,
  override of Quinn's proposed `chore/agent-rules` everywhere). App
  repo is currently on `main` (head `c81cda36`); the implementer
  checks out or creates `james-dev` for the IDENTITY_LINK.md commit.
- **Three-check status:** **N/A** — Step 1 is docs only. No `tsc`,
  no `next lint`, no `vitest` impact. The only verification is that
  the new files parse as valid markdown and the cross-references
  resolve to the listed file:line. Visual review by JAMES / Quinn
  covers this.
- **Push status:** **No push.** Both repos' commits wait for JAMES's
  "push" word. Per AGENTS.md §7, autonomous push is forbidden in
  STRICT mode. The implementer (Drew, per Quinn's review notes)
  lands the files, commits with JAMES as author, and holds for the
  push word.

---

## 4. Files Modified

| Repo | File | Role |
|------|------|------|
| `site_survey-app` (app repo) | `docs/IDENTITY_LINK.md` | **NEW** — IdentityLink contract, v1.0. 153 lines. Three rules, scope table, cross-references, future-agent checklist, changelog. |
| `Solarpro` (website repo) | `AI-AGENT-README.md` §13.1 | **EDIT** — append "### IdentityLink contract — surveys (F-18, 2026-06-23)" subsection before the closing `---`. Existing §13 content preserved (additive, no replacement). |
| `Solarpro` (website repo) | `HANDOFF_F18_STEP_1.md` | **NEW** — this handoff doc. Lands in the same push as the §13 update. |

**No other files touched.** No code, no tests, no migrations, no
env var changes.

---

## 5. Pending Work (Step 2 is next)

Per `F18-SPEC.md` §3, the implementation cadence is **one step per
daily**. Step 2 is the next concrete work:

- **Add mobile `users_cache` SQLite table** in
  `mobile/src/database/schema.ts` — schema:
  `(solarpro_user_id PRIMARY KEY, email, full_name, role,
  cached_at, source)`.
- **Populate from `/api/users/me` and SSO exchanges** — wire a
  cache-write path in the mobile auth flow.
- **Provide offline fallback for `inspector_name`** — UI reads
  `users_cache.full_name ?? "Unknown"` when offline.
- **TTL: 24h**, refreshed on next online action. Stale entries
  re-fetched automatically.
- **Deploy via `eas update --branch preview`** (per F-18 Q4 sign-off)
  — over-the-air, no app store review needed for additive change.
- **No DROP / no behavior change in this step.** Step 2 is purely
  additive so rollback is trivial.

Step 2 lands in the app repo only (mobile SQLite + the cache write
path). No website-side changes for Step 2.

---

## 6. Architecture Notes (for future agents)

- **`solarpro_user_id` is the ONLY authoritative identity reference
  between Neon and the app side** (per `IDENTITY_LINK.md` Rule 1).
  If a Neon user is hard-deleted, app-side `surveys.solarpro_user_id`
  references become orphans (no FK across separate databases). Future
  agents must surface orphan references before any hard Neon delete.
  The contract accepts this failure mode; do NOT introduce a real FK
  constraint across the separate databases.
- **Snapshot columns are deprecated.** `solarpro_email`,
  `solarpro_project_id`, `solarpro_org_id` on `mobile.surveys` and
  `app_db.surveys` are point-in-time values, NOT live references.
  They are scheduled for drop in F-18 Step 4 (app backend migration
  `003_drop_inspector_name_and_snapshot_columns.sql`).
- **`inspector_name` is being replaced by a derivation, not stored.**
  The mobile `users_cache` table (Step 2) is the new source. Free-text
  `inspector_name` columns are dropped in Step 4 (app) and Step 6
  (website, after research).
- **Website ingest resolves owner from Neon at submission time.**
  The website's `lib/survey/ingest/*` pipeline must look up
  `solarpro_user_id → Neon users` at ingest (F-18 Step 5). On Neon
  failure, fall back to `SURVEY_INGEST_DEFAULT_USER_ID` per A10 R11.
  Do NOT rely on the snapshot columns for current display data.
- **🛑 STOP-and-surface rule.** If a future agent adds a NEW
  `solarpro_*` column, **stop and surface to JAMES.** The IdentityLink
  contract forbids more denormalization. The whole point of F-18 is
  to *remove* denormalization, not add to it.
- **🛑 STOP-and-surface rule (mobile).** If a future agent changes
  how `inspector_name` is computed, **stop and verify** the
  `users_cache` mobile table is the new source, not a free-text
  field. The contract is explicit on this.

---

## 7. Next Steps (concrete, ordered)

For the next implementer (per F-18 cadence — one step per daily):

1. **Step 2 — Mobile `users_cache` table.** Blake owns. Add the
   table to `mobile/src/database/schema.ts`, wire the cache-write
   path from `/api/users/me` and SSO exchanges, deploy via
   `eas update --branch preview`. Add
   `mobile/__tests__/usersCache.test.ts` for TTL / refresh / fallback
   semantics.
2. **Step 3 — Derive `inspector_name` from `users_cache`.** Stop
   writing `inspector_name`; read from cache. Keep the column on
   disk for one release (rollback safety). Tag as
   `feat(mobile): derive inspector_name from users_cache`.
3. **Step 4 — Drop snapshot columns from app Postgres.** Migration
   `003_drop_inspector_name_and_snapshot_columns.sql` on Render
   Postgres. Update `backend/src/routes/surveys.ts` to stop
   selecting/inserting the dropped columns. Update
   `backend/src/services/webhookService.ts:115–178` to remove the
   dropped fields from the webhook payload. Coordinate with Step 5.
4. **Step 5 — Website ingest pipeline resolves owner from Neon.**
   New `lib/survey/ingest/resolveSurveyOwner.ts`. Update
   `lib/survey/ingest/ownerResolver.ts`. Tag as
   `feat(ingest): resolve survey owner from Neon on demand`. Deploy
   to `solarpro-dev.vercel.app` first; verify end-to-end with the
   test webhook script from `AI-AGENT-README.md` §12. **A10 R11
   compliance** — fall back to `SURVEY_INGEST_DEFAULT_USER_ID` on
   Neon failure.
5. **Step 6 — Research website `projects.inspector_name` consumers.**
   Search the codebase for proposal PDFs, customer emails, and any
   other consumer of `projects.inspector_name` /
   `project_physical_data.inspector_name` before deciding drop vs.
   snapshot fallback. Per F-18 Q3 sign-off.
6. **Step 7 — Drop vestigial `users` table from app Render Postgres.**
   Per F-18 Q1 sign-off — **hard drop, not rename.** **Pre-condition
   verification (MUST run before the migration):** search
   `C:\Users\carpe\source\repos\site_survey-app\` for
   `INSERT INTO users`, `UPDATE users`, `users (email, password_hash`
   call paths. If zero matches: drop proceeds. If any match: **STOP
   and surface to JAMES**. Migration
   `004_drop_app_users_table.sql` = `DROP TABLE IF EXISTS users;`
   plus dependent-index cleanup. All reads already route through
   `WEBSITE_DATABASE_URL` to Neon (per `sqliteAuthStore.ts`).

For each subsequent step, write a per-step handoff
(`HANDOFF_F18_STEP_N.md`) per AGENTS.md §6, in the same shape as
this document.

---

— blake, 2026-06-23 16:51 CT
Drafted in `C:\Users\carpe\.mavis\agents\blake\workspace\HANDOFF_F18_STEP_1.md`
for Quinn review and JAMES sign-off. No commit, no push, no file
landing in the actual repos — Drew handles the file landing + commit
+ push after JAMES signs off (per Quinn's review notes 2026-06-23).
