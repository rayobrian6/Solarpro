# The homeowner-stage / micro-stage schema is not reachable from the scanned migration set

**Status:** diagnosed and proven. **No migration written, none run.** Ray's decision required.
**Proof:** `tests/stageSchemaReachability.postgres.test.ts` — 28 passing assertions + 1 named
expected failure (`it.fails`) that turns RED the day this is fixed.

---

## 1. How the run set is determined

| Question | Answer | Evidence |
|---|---|---|
| Glob, manifest list, or numeric sort? | `readdirSync` of **one fixed directory**, filtered to `/^\d{3,}_.*\.sql$/`, sorted by **numeric prefix** (duplicate prefixes disambiguated `a`/`b` by alphabetical filename) | `lib/migrations/manifest.ts:70-183` (`discoverMigrationFiles`) |
| Which directory? | `lib/migrations` — a constant, not configurable | `lib/migrations/types.ts:611` `MIGRATIONS_DIR_RELATIVE = 'lib/migrations'` |
| Can it be redirected? | No. The runner binds `productionManifestProvider = () => discoverMigrationFiles()` (no args). Injection exists only through the test-only factory `createMigrationRunnerWithManifest`. | `lib/migrations/runner.ts:132-145`, `166-186` |
| Any other executor? | No. `app/api/migrate/route.ts` POST returns **423 Locked** before `getDbReady()`; `app/api/admin/system-tools/route.ts` `run_migration` returns **423** the same way. Both are hard-coded (`isLegacyInlineEnabled()`/`isLegacySystemToolsRunEnabled()` return literal `false`). | runner.ts:222-238; migrate route ~line 85; system-tools ~line 68 |
| Does anything read the bare `migrations/` directory? | **Nothing in the product.** A repo-wide grep finds it only in test files and in `lib/roadmapRE26.ts` prose. `system-tools` `list_migrations` also lists `lib/migrations` only. | grep over `app/ lib/ scripts/ components/` |
| Operator path | Admin → System Tools → Migrations (`app/admin/system-tools/migrations/page.tsx`) → `POST /api/admin/migrations` | — |

**VERIFIED:** `lib/migrations/manifest.ts` states in its own header that `migrations/` is not scanned,
and behaves that way.

---

## 2. Per-table evidence

| Table / column | Read or written by | Created by | Directory | Scanned? |
|---|---|---|---|---|
| `projects.homeowner_stage` | `lib/microStage.ts:249,269`; `lib/homeownerStageSync.ts:113,137`; `app/api/admin/projects/route.ts:32,51,68`; `app/api/admin/projects/[id]/route.ts:45,170,193,195`; `app/api/portal/dashboard/route.ts:59`; `app/api/portal/bill-upload/route.ts:64,192`; `app/api/projects/[id]/homeowner-stage/route.ts:61,125,145`; `app/api/proposals/[id]/{route,share,sign}.ts`; `app/api/clients/[id]/projects/route.ts:40`; `.../send-portal-invite/route.ts:48` | `migrations/019_homeowner_stage.sql:11` | `migrations/` | **NO** |
| `project_homeowner_stage_history` (`project_id, stage, changed_by, note`) | `lib/microStage.ts:275`; `lib/homeownerStageSync.ts:145`; `app/api/admin/projects/[id]/route.ts:63,207`; `app/api/portal/{dashboard:100,bill-upload:197}`; `app/api/projects/[id]/homeowner-stage/route.ts:154` | `migrations/019_homeowner_stage.sql:23` | `migrations/` | **NO** |
| `project_micro_stages.micro_stage` | `lib/microStage.ts:151,223,238`; `app/api/projects/[id]/homeowner-stage/route.ts:217`; `app/api/proposals/[id]/route.ts:369`, `share:167`, `sign:256`; `app/api/admin/projects/[id]/route.ts:103`; `app/api/portal/dashboard/route.ts:159` | `migrations/021_micro_stages.sql:13` | `migrations/` | **NO** |
| `project_micro_stages.created_by`, `.metadata` | `lib/microStage.ts:237-241` | `migrations/021_micro_stages.sql` | `migrations/` | **NO** |
| `UNIQUE (project_id, micro_stage)` (needed by `ON CONFLICT`) | `app/api/projects/[id]/homeowner-stage/route.ts:219` | `migrations/022_micro_stages_unique.sql` | `migrations/` | **NO** |
| `project_micro_stages` *(the name only)* — `(project_id, user_id, stage, substage, notes)`, **no `micro_stage`** | **no consumer anywhere** | `lib/migrations/027_project_micro_stages.sql` | `lib/migrations/` | yes |

No scanned migration mentions `homeowner_stage` at all — asserted over every file the real
manifest returns, not sampled.

---

## 3. PGlite verdict — a database built from ONLY the scanned set

Applied by name in the manifest's own order (88 of 120 files apply; the rest belong to
subsystems the fixture does not build, and none of them touches these tables).

| Shipped query | Result |
|---|---|
| `resolveHomeownerStage()` | **throws** — `relation "project_micro_stages" does not exist` |
| `writeMicroStage()` | **silently records nothing.** It catches, retries once, logs `[writeMicroStage] ERROR: Failed after 2 attempts` and resolves `void`. No exception, no 500, no row. |
| `syncHomeownerStage()` | same — swallowed; no history row |
| `SELECT p.homeowner_stage` (admin project list, `app/api/admin/projects/route.ts:32`) | **throws** — `column "homeowner_stage" does not exist`. Its only handler is the route's outer `catch → handleRouteDbError` (line 114), so the WHOLE admin project list fails with a DB error rather than degrading — unlike the micro-stage read at `[id]/route.ts:103`, which has its own inner failsafe returning `[]`. |
| `PATCH /api/projects/[id]/homeowner-stage` | **503 `DB_STARTING`**, body "Service temporarily unavailable. Please try again in a moment." A permanent schema defect presented to the installer as a transient one. |

Positive control (same production functions, scanned set minus 027 plus `migrations/019+021+022`):
every one of the above succeeds, `writeMicroStage` writes the row, advances `homeowner_stage`
and logs history.

---

## 4. 🚨 REFUTATION: 027 never wins the race — it cannot execute at all

The brief's mechanism ("`CREATE TABLE IF NOT EXISTS` is a no-op, whichever runs first wins")
is real, but it never applies to 027, because 027 cannot be applied to anything:

* **Against the canonical base schema:** `foreign key constraint
  "project_micro_stages_project_id_fkey" cannot be implemented` — 027 declares
  `project_id TEXT` / `user_id TEXT`, while `projects.id` (001) and `users.id` (006) are `UUID`.
  The whole file rolls back; **the table is not created at all**.
* **Against a database that already has the correct table:** it fails with
  `column "stage" does not exist` — the `CREATE TABLE IF NOT EXISTS` silently no-ops (that is
  the mechanism, measured) and execution reaches its `CREATE UNIQUE INDEX … (project_id, stage,
  substage)`, whose columns do not exist. The correct shape survives untouched.

So 027 is **not** a landmine that could claim the table name on a fresh deployment. It is worse
in a different way: it is a **permanently unrunnable file inside the run set**, and
`runPendingMigrations` does `if (failed > 0) break;` (`lib/migrations/runner.ts:1677`) — so any
batch run stops dead at 027 and migrations 028-123 are unreachable by that path. That is
consistent with why 107 and 113-123 each have their own hand-built targeted action.

**Which shape is authoritative:** `migrations/021` + `022` + `019`. Every consumer in the product
names `micro_stage`, `created_by`, `metadata` and `UNIQUE (project_id, micro_stage)`. Nothing,
anywhere, reads or writes `stage`, `substage` or `notes` on this table. 027 is a dead alternative
design that was never finished and never could run.

**What production probably has:** the correct shape, from the inline runner
`app/api/migrate/route.ts:1770-1806` ("Migration 027"/"028"), which creates the `UUID`/`micro_stage`
table and adds `uq_project_micro_stage` — and which is now dead code behind the 423. That is a
hypothesis, not a fact; §6 says how to settle it read-only.

---

## 5. If a migration is the fix — the exact specification (NOT WRITTEN, NOT RUN)

The static gate in `lib/migrations/targetedRegistryDeployment.ts` admits three mutually
exclusive shapes, so this **must be two files**: a CREATE-TABLE one and an ADD-COLUMN one.
(`FORBIDDEN_TOKENS` bans `ALTER` outright in the create-table shape; the add-column shape bans
`CREATE TABLE`, and bans `CHECK`/`DEFAULT`/`NOT NULL`/`UNIQUE`/`REFERENCES` inside the column's
type clause — so `migrations/019`'s `CHECK (...)` **cannot** be carried over. The app already
validates against `HOMEOWNER_STAGES` in `lib/homeownerStageSync.ts`.)

### `lib/migrations/124_homeowner_stage_tables.sql` — create-table shape

```sql
-- Migration 124: the homeowner-stage / micro-stage tables, in the directory the
-- runner actually scans. Same shape as migrations/021 + 022 (UUID keys,
-- micro_stage) and migrations/019's history table. Idempotent, seeds no rows.
CREATE TABLE IF NOT EXISTS project_micro_stages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  micro_stage TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID,
  metadata    JSONB,
  CONSTRAINT uq_project_micro_stage UNIQUE (project_id, micro_stage)
);
CREATE INDEX IF NOT EXISTS idx_pms_project_created ON project_micro_stages(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pms_project_stage   ON project_micro_stages(project_id, micro_stage);
CREATE INDEX IF NOT EXISTS idx_pms_created_by      ON project_micro_stages(created_by) WHERE created_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_homeowner_stage_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage      TEXT NOT NULL,
  changed_by UUID,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_phsh_project_id  ON project_homeowner_stage_history(project_id);
CREATE INDEX IF NOT EXISTS idx_phsh_created_at  ON project_homeowner_stage_history(created_at DESC);
```

### `lib/migrations/125_projects_homeowner_stage.sql` — add-column shape

```sql
-- Migration 125: projects.homeowner_stage. Bare ADD COLUMN IF NOT EXISTS: no
-- default, no NOT NULL, no CHECK (the targeted add-column gate bans all three,
-- and the vocabulary is enforced in lib/homeownerStageSync.ts).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS homeowner_stage TEXT;
```

### The registrations each one needs (all five, or it is discoverable and unrunnable)

1. the `.sql` file in `lib/migrations/`
2. `lib/migrations/targetedRegistryDeployment.ts` → `REGISTRY_DEPLOYMENT`
   * `'124': { expectedTables: ['project_micro_stages', 'project_homeowner_stage_history'] }`
   * `'125': { expectedTables: [], expectedColumns: [{ table: 'projects', column: 'homeowner_stage' }], altersPreexistingTables: ['projects'] }`
3. same file → `REGISTRY_SEQUENCE` (append `'124', '125'`)
4. `lib/migrations/runner.ts` → `TARGETED_RECOVERY_ALLOWLIST` (add `'124'`, `'125'`)
5. `app/api/admin/migrations/route.ts` → `validActions` (`execute-homeowner-stage-tables-124`,
   `execute-projects-homeowner-stage-125`) **and** the matching `is…` branch beside
   `isLayoutSiteArchives123`
6. `app/admin/system-tools/migrations/page.tsx` → a console button per action
7. `tests/phase1a-migration-governance.test.ts` → `GOVERNED_MIGRATION_COUNT` 120 → 122, and the
   "highest prefix is 123" assertion → 125

(`tests/migrationGovernance.test.ts` INVERSE PARITY will fail until 2-6 are all done — that is
the gate that caught 121 sitting unrunnable.)

### And a disposition for 027 — otherwise the run set still holds a file that can never apply

Options, in order of preference:

* **Delete or repair `lib/migrations/027_project_micro_stages.sql`.** It has no consumer and
  cannot execute. Deleting a migration file is a governance act (the manifest count tripwire and
  the checksum ledger both notice) — Ray's call, not an agent's.
* **Baseline it `NOT_APPLICABLE`** via `POST /api/admin/migrations` `action: 'record-baseline-entry'`
  (`BaselineReconciliationStatus` includes `NOT_APPLICABLE`, which is non-blocking for
  `verify-baseline`). ⚠ This records evidence in `migration_baseline` **only**; it does not write
  `schema_migrations`, so 027 stays `pending` and `run-pending` still halts on it.
* **`superseded`** is the correct terminal ledger status (`lib/migrations/types.ts:30`,
  `runner.ts:1327`) — but **no API action can set it**. That is a governance gap worth closing.

---

## 6. Settle what production has — read-only, no writes

`POST /api/admin/migrations` `action: 'generate-baseline-evidence'` introspects the live catalog
and reports `OBJECT_EXISTENCE` per migration, deriving the expected objects from each file's own
SQL. For 027 that means it looks for the table `project_micro_stages` **and** the two index names
027 declares (`uq_project_micro_stage`, `idx_project_micro_stages_project`). A distinctive
signature:

* table present, 027's indexes absent → production carries the **inline runner's correct shape**
  (`idx_pms_*`) → only 125 (`homeowner_stage`) may be needed, and 124's CREATE will no-op.
* table absent → production has neither shape → both 124 and 125 are needed.

Run that first. The disposition depends on the answer, and it is obtainable without writing
anything.

---

## 7. What the guard does

`tests/stageSchemaReachability.postgres.test.ts` §6 holds one `it.fails`:

> `EXPECTED FAILURE — stageSchemaReachability: every table and column the homeowner-stage /
> micro-stage code touches is created by a migration the runner scans`

It reads the same PGlite database the rest of the file measured. It passes while the defect
exists and goes **RED the moment the schema becomes reachable**, forcing whoever fixes this to
promote it to a plain `it`. Proven capable of failing: substituting the corrected migration set
for the scanned one turns it red (along with 9 other assertions).
