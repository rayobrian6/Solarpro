# Migration Drift Audit — 2025-06-04

**Scope**: Compare repo migration files vs inline DDL in `/api/migrate`, identify drift, assess runtime risk.
**Rule**: Audit only. No new roadmap work.

---

## 1. Exact Migration Mismatch

### SQL Migration Files (`lib/migrations/`)
Last file: `078_geometry_reconstruction_heartbeat.sql`

**No SQL files exist for 079, 080, 081, or 082.**

### Inline DDL in `app/api/migrate/route.ts`

| Migration | Description | Lines (approx) | SQL File? |
|-----------|------------|-----------------|-----------|
| 079a | `geometry_promotion_records` table | 3467–3505 | **MISSING** |
| 079b | `unified_geometry_artifacts` table (15 cols, NO `obstruction_metadata`) | 3508–3556 | **MISSING** |
| 080 | Backfill unified_geometry_artifacts from Pipeline A + B source tables | 3559–3720 | **MISSING** |
| 081 | `ALTER TABLE unified_geometry_artifacts ADD COLUMN obstruction_metadata JSONB NULL` | 3723–3740 | **MISSING** |
| 082 | Backfill obstruction_data → unified_geometry_artifacts | 3743–3931 | **MISSING** |

### Root Cause
Migrations 079–082 were added as inline DDL in `app/api/migrate/route.ts` during P0.2 (commits e8c2ecb → 32101e4) but no corresponding SQL files were created in `lib/migrations/`. The SQL migration files stopped at 078 because the developer used the imperative migration route directly.

### No Migration Tracking Table
There is **no** `schema_migrations` or similar tracking table. The `/api/migrate` route uses a purely imperative, idempotent-per-object pattern:
- Each migration checks `information_schema.tables` or `information_schema.columns` before creating/altering
- If the object already exists, it skips with a ⏭ message
- There is no record of which migrations have been applied globally

This means: **The only way to know if a migration ran is to check whether the DB object exists.**

---

## 2. Are Migrations 079–082 Applied to the Dev DB?

**Unknown without direct DB access.** However, we can reason:

- If the `/api/migrate` endpoint has been called on the dev DB since these migrations were added to the code (any time after commit `1e9752d` on the `dev` branch), then 079a, 079b, and 080 would have been applied.
- Migration 081 (`obstruction_metadata` column) was added in commit `32101e4` (P0.2 Phase A). It would only be applied if `/api/migrate` was called after that commit.
- Migration 082 (obstruction backfill) was added in the same commit.

**The user reports that the DB migration history only shows through 078.** This most likely means either:
1. The `/api/migrate` endpoint has NOT been called since 079+ was added to the code, OR
2. There IS a migration tracking mechanism the user is checking that the code doesn't actually use — meaning 079+ may have been applied but the tracking system doesn't know about it.

Given the code architecture (no tracking table, purely idempotent DDL), the "migration history through 078" the user sees likely refers to the SQL FILES in `lib/migrations/`, not any DB-resident tracking table.

---

## 3. Code Currently Referencing Schema from Unapplied Migrations

### CRITICAL: `obstruction_metadata` Column (Migration 081)

**Three code paths reference `obstruction_metadata` in SQL queries:**

| File | Line | Operation | Risk |
|------|------|-----------|------|
| `unifiedArtifactStore.ts` | 86 | `SELECT ... obstruction_metadata ...` in `getUnifiedArtifactsForSurvey()` | **HIGH** |
| `unifiedArtifactStore.ts` | 124 | `SELECT ... obstruction_metadata ...` in `getUnifiedArtifactsByIds()` | **HIGH** |
| `unifiedArtifactStore.ts` | 486 | `INSERT ... obstruction_metadata ...` in `writeObstructionArtifact()` | **MEDIUM** |

### Risk Analysis

**If the `unified_geometry_artifacts` table EXISTS (079b applied) but `obstruction_metadata` column does NOT exist (081 not applied):**

- `getUnifiedArtifactsForSurvey()` will **FAIL at runtime** with a PostgreSQL error: `column "obstruction_metadata" does not exist`
- `getUnifiedArtifactsByIds()` will **FAIL at runtime** with the same error
- The graceful degradation check at line 76 (`SELECT 1 FROM information_schema.tables WHERE table_name = 'unified_geometry_artifacts'`) only checks if the TABLE exists, NOT if the column exists
- The `catch` block at line 98 will log the error and return `[]` — so the route won't crash the server, but it will **silently return zero artifacts**, making the unified geometry API endpoints return empty data

**If the `unified_geometry_artifacts` table does NOT exist (079b not applied):**
- `getUnifiedArtifactsForSurvey()` gracefully returns `[]` (table check at line 76)
- No runtime error, but no data either
- All three API routes (`/bundle`, `/canonical-model`, `/promote`) will return empty artifact lists

**If both 079b and 081 are applied:**
- Everything works correctly
- `obstruction_metadata` column is nullable, so existing rows without the column value return `null`

### Routes at Risk

| Route | Method | Calls | Will Break? |
|-------|--------|-------|-------------|
| `/api/site-surveys/[surveyId]/unified-geometry/bundle` | GET | `getUnifiedArtifactsForSurvey()` | YES if table exists without column |
| `/api/site-surveys/[surveyId]/unified-geometry/canonical-model` | GET | `getUnifiedArtifactsForSurvey()` | YES if table exists without column |
| `/api/site-surveys/[surveyId]/unified-geometry/promote` | POST | `getUnifiedArtifactsForSurvey()` | YES if table exists without column |
| `/api/migrate` | POST | Inline DDL | N/A (this IS the migration) |

### Safe Code Paths

| File | Path | Why Safe |
|------|------|----------|
| `promote/route.ts` | Direct INSERT into `unified_geometry_artifacts` | Does NOT include `obstruction_metadata` column — column is nullable so INSERT succeeds |
| `roofObstructionRegistration.ts` | `writeObstructionArtifact()` via `OBSTRUCTION_UNIFIED_WRITE_ENABLED` | Feature flag defaults to OFF — code path is unreachable unless explicitly enabled |
| `roofObstructionRegistration.ts` | Dual-write Step 5 | Guarded by `OBSTRUCTION_UNIFIED_WRITE_ENABLED` — default OFF |

---

## 4. Specific Check Items

### 4a. `unified_geometry_artifacts.obstruction_metadata`
- **Type in code**: `JSONB NULL` (Migration 081 DDL)
- **Type in TypeScript**: `ObstructionMetadata | null` on `UnifiedGeometryArtifact`, `unknown` on `UnifiedArtifactRow`
- **SQL references**: 3 SELECT statements, 1 INSERT statement
- **Status**: Column only exists if Migration 081 has been applied via `/api/migrate`

### 4b. SELECT/INSERT using `obstruction_metadata`
- **SELECT** (2 locations): `getUnifiedArtifactsForSurvey()` and `getUnifiedArtifactsByIds()` — both in `unifiedArtifactStore.ts`
- **INSERT** (1 location): `writeObstructionArtifact()` in `unifiedArtifactStore.ts`
- **All three are vulnerable** if the column doesn't exist in the DB

### 4c. `writeObstructionArtifact()`
- Defined at line 377 of `unifiedArtifactStore.ts`
- Creates a full `unified_geometry_artifacts` row with `obstruction_metadata` JSONB
- Uses `ON CONFLICT (id) DO NOTHING`
- Only called from `registerObstructionsForSurvey()` when `OBSTRUCTION_UNIFIED_WRITE_ENABLED` is true
- **Currently safe** because the feature flag is OFF by default

### 4d. `rowToArtifact()`
- Defined at line 192 of `unifiedArtifactStore.ts`
- Two paths:
  - **geometry_data path** (line 244): `obstructionMetadata: (stored.obstructionMetadata as ObstructionMetadata | null) ?? (row.obstruction_metadata as ObstructionMetadata | null) ?? null`
  - **Fallback path** (line 291): `obstructionMetadata: (row.obstruction_metadata as ObstructionMetadata | null) ?? null`
- Both paths access `row.obstruction_metadata`, which is populated from the SQL SELECT
- If the SELECT fails (column doesn't exist), `rowToArtifact` is never reached — the error is caught at the query level

### 4e. `registerObstructionsForSurvey()`
- Located in `lib/assistedEvidenceSources/roofObstructionRegistration.ts`
- Step 5 (dual-write) is guarded by `OBSTRUCTION_UNIFIED_WRITE_ENABLED`
- **Currently safe** — feature flag defaults to OFF

### 4f. `OBSTRUCTION_UNIFIED_WRITE_ENABLED` Default
- Defined at line 301: `process.env.OBSTRUCTION_UNIFIED_WRITE_ENABLED === '1'`
- **Default: OFF** (requires explicit `'1'` value)
- Only affects the dual-write step in `registerObstructionsForSurvey()`
- Safe by default

---

## 5. Diagnosis: Dev DB Needs Migrations Applied or Repo Corrected?

**Both, but the priority is different:**

### Immediate Need: Create SQL Migration Files
The `lib/migrations/` directory is the source of truth for migration history. The inline DDL in `/api/migrate/route.ts` is a runtime convenience, but the SQL files serve as:
1. Documentation of what each migration does
2. A reference for manual DB setup
3. A record of migration numbering and ordering

**Missing SQL files should be created** to close the documentation gap.

### Dev DB Needs Migrations Applied
If the dev DB has never had `/api/migrate` called since 079+ was added, then:
- The `geometry_promotion_records` table doesn't exist
- The `unified_geometry_artifacts` table doesn't exist
- This is actually the SAFER state — the graceful degradation in `getUnifiedArtifactsForSurvey()` checks for the table and returns `[]`

If `/api/migrate` was called after 079b was added but before 081 was added, then:
- The `unified_geometry_artifacts` table EXISTS
- The `obstruction_metadata` column does NOT exist
- **This is the DANGEROUS state** — SELECT queries will fail

### Recommendation
1. **First**: Apply `/api/migrate` on the dev DB to bring it fully current (including 081 and 082)
2. **Then**: Create the missing SQL migration files 079–082 to close the documentation gap

---

## 6. Minimal Stabilization Fix

The code has a latent bug: `getUnifiedArtifactsForSurvey()` and `getUnifiedArtifactsByIds()` SELECT `obstruction_metadata` without first checking if the column exists. The table-existence check is insufficient.

### Option A: Column Existence Check (Minimal, Defensive)
Add a column existence check after the table existence check, similar to how Migration 081 checks for the column before adding it. If the column doesn't exist, use a SELECT without `obstruction_metadata`.

### Option B: SQL Migration Files + Migrate Route (Complete)
Create SQL files 079–082 and ensure `/api/migrate` is called. This fixes both the documentation gap and the runtime risk.

### Option C: Dynamic Column Selection (Robust)
Query `information_schema.columns` to determine which columns exist and dynamically build the SELECT. This is the most defensive but adds complexity.

### Recommended: Option A (Minimal Stabilization)
This is the smallest change that eliminates the runtime breakage risk. It adds a column existence check to both query functions, falling back to a SELECT without `obstruction_metadata` if the column doesn't exist yet.

---

## 7. Test/Build Results

- **TypeScript**: `npx tsc --noEmit` — **CLEAN** (0 errors)
- **Tests**: Not run as part of this audit (5337 tests, 2 pre-existing failures in `metadataRuntimeAdapter.test.ts` and `ocrRuntimeAdapter.test.ts` — unrelated to pipeline work)

---

## Summary

| Finding | Severity | Status |
|---------|----------|--------|
| No SQL files for migrations 079–082 | MEDIUM | Documentation gap — inline DDL exists and is idempotent |
| `obstruction_metadata` column in SELECT queries without column existence check | **HIGH** | Runtime breakage if table exists without column |
| `writeObstructionArtifact()` references `obstruction_metadata` | LOW | Guarded by OFF-by-default feature flag |
| No migration tracking table | LOW | Design choice — idempotent migrations are functional |
| `OBSTRUCTION_UNIFIED_WRITE_ENABLED` defaults OFF | SAFE | No action needed |
| `promote/route.ts` INSERT omits `obstruction_metadata` | SAFE | Column is nullable |

**Bottom line**: The migration drift is real but contained. The critical risk is a specific scenario: `unified_geometry_artifacts` table exists but `obstruction_metadata` column does not. In that scenario, three API routes silently fail. The minimal stabilization fix is to add column existence checks to the two SELECT query functions.
