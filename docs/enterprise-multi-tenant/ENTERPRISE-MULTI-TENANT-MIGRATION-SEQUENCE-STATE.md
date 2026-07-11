# Enterprise Multi-Tenant Migration Sequence State

**Date:** 2026-07-11
**Branch:** `dev`
**Commit:** `ef51acff` (pre-correction Phase 0.5 documentation commit)
**Status:** Complete — migration directory analysis and next-identifier determination
**Classification:** Phase 0.5A Integrity Reconciliation deliverable

> **Date classification:** All git commit dates in this repository are 2026-07-11. The date "2025-07-11" that appeared in earlier Phase 0.5 documents was incorrect and has been corrected to 2026-07-11 throughout the Phase 0.5 documentation set. The date 2026-07-11 is classified as a FACTUAL git commit date (verified via `git log --format=%ci`).

> **Branch reference classification:** The commit `ef51acff` is the pre-correction Phase 0.5 documentation commit on the `dev` branch. The earlier reference to `7b344aa1` as the Phase 0.5 baseline was misleading — `7b344aa1` is a CODE commit ("Planset PV-1: fix pluralization") that represents the codebase evidence baseline, not a documentation commit. The documentation commit for Phase 0.5 is `ef51acff`. Both Phase 0 and Phase 0.5 share the same evidence baseline (`7b344aa1`) because no production code was modified during either phase.

---

## 1. Purpose

This document provides an authoritative analysis of the migration directory (`lib/migrations/`) and the migration runner infrastructure in the SolarPro codebase. It exists to resolve a critical question: **what is the next available migration identifier for the Enterprise Multi-Tenant Authority initiative?**

The answer is: **the next identifier cannot be assigned unambiguously at this time.** The migration directory has structural anomalies (a duplicate prefix and gaps in the numbering sequence) that must be reconciled before any new migration file can be created. This document documents the current state, the anomalies, the runner behavior, and the conditions under which the next identifier can be determined.

The placeholder `NEXT_ENTERPRISE_AUTHORITY_MIGRATION` is used throughout the Phase 0.5 documentation set in place of a numeric migration identifier. This document explains why a numeric value cannot be substituted for that placeholder.

---

## 2. Migration Directory State

### 2.1 Location

The migration SQL files are stored in:

```
lib/migrations/
```

### 2.2 File Count

**101 SQL files** are present in the directory.

### 2.3 Naming Convention

Files follow the pattern:

```
{NNN}_{snake_case_description}.sql
```

where `NNN` is a zero-padded 3-digit numeric prefix (e.g., `001`, `074`, `104`). The prefix determines the intended execution order. The description is a snake_case summary of the migration's purpose.

### 2.4 Highest Migration Prefix

The highest migration file prefix is **104**.

The file with the highest prefix is:

```
lib/migrations/104_<description>.sql
```

### 2.5 Prefix Range

Migration files span prefixes **001 through 104**, with the following anomalies.

### 2.6 Gaps in Numbering Sequence

The following prefixes are **missing** (no file exists with these prefixes):

| Missing Prefix | Notes |
|----------------|-------|
| 009 | No file `009_*.sql` exists |
| 012 | No file `012_*.sql` exists |
| 013 | No file `013_*.sql` exists |
| 014 | No file `014_*.sql` exists |

These gaps may represent migrations that were planned but never created, migrations that were renumbered, or migrations that were deleted. The absence of these files does not cause errors in the current migration runner (see Section 4 below), but it creates ambiguity in determining the next available identifier.

### 2.7 Duplicate Migration Prefix

The prefix **074** appears **twice** — two distinct files share the same numeric prefix:

| File | Description |
|------|-------------|
| `lib/migrations/074_photo_vision_jobs_dedup_index.sql` | Deduplication index on photo vision jobs |
| `lib/migrations/074_photo_vision_jobs_render_job_id.sql` | Render job ID on photo vision jobs |

This is a **structural anomaly**. Both files are valid migrations with different purposes, but they share the same numeric prefix. This means the numeric prefix alone is not a unique identifier — the full filename (including the description) is required to distinguish them.

### 2.8 Complete Prefix Listing

The following 101 prefixes are present (sorted numerically):

```
001 002 003 004 005 006 007 008 010 011 015 016 017 018 019 020
021 022 023 024 025 026 027 028 029 030 031 032 033 034 035 036
037 038 039 040 041 042 043 044 045 046 047 048 049 050 051 052
053 054 055 056 057 058 059 060 061 062 063 064 065 066 067 068
069 070 071 072 073 074 074 075 076 077 078 079 080 081 082 083
084 085 086 087 088 089 090 091 092 093 094 095 096 097 098 099
100 101 102 103 104
```

Note: `074` appears twice in the listing above, confirming the duplicate.

---

## 3. Next Migration Identifier

### 3.1 Placeholder

The next migration identifier for the Enterprise Multi-Tenant Authority initiative is represented by the placeholder:

```
NEXT_ENTERPRISE_AUTHORITY_MIGRATION
```

### 3.2 Why a Numeric Value Cannot Be Assigned

The next numeric migration identifier **cannot be assigned unambiguously** at this time due to the following structural anomalies:

1. **Duplicate prefix (074):** Two files share the prefix `074`. If the next migration were assigned `105` (highest prefix + 1), this would be correct only if the numbering convention is "highest prefix + 1." However, the duplicate at `074` raises the question of whether the numbering convention is being followed reliably. If duplicates are acceptable, then `105` is the next identifier. If duplicates are an error that should be corrected, then the numbering convention is violated and a reconciliation process is needed.

2. **Gaps (009, 012, 013, 014):** Four prefixes are missing from the sequence. If the convention is "fill gaps before incrementing," then `009` would be the next identifier. If the convention is "highest prefix + 1," then `105` would be the next identifier. The convention is ambiguous because the gaps and the duplicate coexist — the directory does not consistently follow either convention.

3. **Runner does not enforce filename numbering:** The primary migration runner (`app/api/migrate/route.ts`) does not read the `lib/migrations/` files at all (see Section 4.1). It contains inline SQL statements that are executed directly. The filename numbering is therefore advisory, not enforced — the runner does not care what number a file has, because it does not read files by number. This means the numbering convention is a human convention, not a machine-enforced one, and its interpretation depends on team practice.

### 3.3 Candidate Identifiers

Given the anomalies, the candidate identifiers for the next migration are:

| Candidate | Rationale | Risk |
|-----------|-----------|------|
| `105` | Highest prefix (104) + 1 | Assumes "highest + 1" convention; ignores gaps and duplicate |
| `009` | First gap in sequence | Assumes "fill gaps first" convention; may conflict if 009 was intentionally skipped |
| `012` | Second gap in sequence | Same as above |

**None of these candidates can be selected without a reconciliation decision.** The selection depends on the team's intended convention, which is not documented in the codebase.

### 3.4 Determination Process

Before any new migration file is created, the following reconciliation process must be completed:

1. **Confirm the numbering convention:** Is the convention "highest prefix + 1" or "fill gaps first"? This must be decided by the team (Raymond or a designated technical lead).
2. **Resolve the duplicate at 074:** Either (a) accept the duplicate as intentional (both files are valid, the prefix is not a unique key), or (b) renumber one of the two `074_` files to a new prefix. If renumbering, the file content must be preserved and the runner must be updated if it references the file by name.
3. **Resolve the gaps at 009, 012, 013, 014:** Either (a) confirm the gaps are intentional (migrations were never created for these numbers), or (b) determine whether files were deleted and should be restored.
4. **Assign the next identifier** based on the confirmed convention.

**Until this process is complete, `NEXT_ENTERPRISE_AUTHORITY_MIGRATION` remains a placeholder.** No numeric value should be substituted in any Phase 0.5 or Phase 1 document.

---

## 4. Migration Runner Infrastructure

### 4.1 Primary Migration Runner (`app/api/migrate/route.ts`)

**Location:** `app/api/migrate/route.ts`
**Size:** 4,223 lines
**Type:** Monolithic inline SQL runner

This is the primary migration runner. It is a single API route (`POST /api/migrate`) that contains inline SQL statements executed directly against the database. Key characteristics:

- **Does NOT read `lib/migrations/` files:** The runner contains no `readFileSync`, `readdirSync`, or file-system operations that read `.sql` files from the migrations directory. All SQL is inline in the route file itself.
- **No `schema_migrations` tracking table:** The runner does not maintain a `schema_migrations` or `migration_log` table to track which migrations have been applied. There is no `CREATE TABLE schema_migrations` or equivalent.
- **Idempotency via SQL constructs:** Instead of tracking applied migrations, each inline SQL block uses `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, or existence checks (`SELECT 1 FROM pg_constraint WHERE conname = '...'`) to ensure the migration is idempotent — running it multiple times has the same effect as running it once.
- **Error suppression:** Errors in individual migration blocks are caught and logged but do not necessarily halt the entire migration run. The runner continues to the next block.
- **Security:** Requires a `MIGRATE_SECRET` environment variable, validated with `timingSafeEqual` to prevent timing attacks. Rate-limited via `checkRateLimit`.

**Implication:** The filename numbering in `lib/migrations/` is NOT enforced by this runner. The runner executes inline SQL, not files. The files in `lib/migrations/` are reference artifacts — they document the SQL that was applied, but the runner does not read or execute them.

### 4.2 Secondary Migration Runner (`app/api/admin/system-tools/route.ts`)

**Location:** `app/api/admin/system-tools/route.ts`
**Type:** Admin tool runner with file-based migration support

This is a secondary runner accessible via the admin system tools interface. It includes a `run_migration` tool that CAN read and execute files from `lib/migrations/`. Key characteristics:

- **Reads `lib/migrations/` files:** The `run_migration` tool uses `fs.readFileSync` to read a specified `.sql` file from the migrations directory.
- **SHA-256 checksum verification:** Before executing a migration file, the runner checks for a `.sha256` checksum file alongside the `.sql` file. If a checksum file exists, the runner computes the SHA-256 hash of the `.sql` file and compares it to the expected checksum. If they do not match, the migration is rejected with a "checksum mismatch" error (indicating potential corruption or tampering).
- **File listing:** The runner can list all `.sql` files in the migrations directory via `fs.readdirSync`, sorted alphabetically.
- **Admin audit logging:** Each `run_migration` action is logged via `logAdminAction` with the admin ID and migration file name.
- **Requires admin authentication:** Access is restricted to authenticated admin users.

**Implication:** This runner CAN execute files from `lib/migrations/` and DOES respect the file naming (it reads files by name, not by number). However, it does not have a `schema_migrations` tracking table either — it relies on the SQL constructs within each file for idempotency.

### 4.3 No Schema Migrations Tracking Table

**Confirmed:** Neither runner maintains a `schema_migrations`, `migration_log`, or equivalent tracking table. The codebase relies entirely on SQL-level idempotency (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, existence checks) rather than application-level migration tracking.

This means:
- There is no authoritative record of which migrations have been applied.
- Running migrations is safe to repeat (idempotent), but there is no way to query "which migrations have been applied" without inspecting the database schema directly.
- The order of migration application is not enforced by a tracking table — it depends on the order in which the inline SQL blocks appear in the runner (for the primary runner) or the order in which files are selected (for the secondary runner).

---

## 5. Repository State

### 5.1 Git Branch and Commit

| Property | Value |
|----------|-------|
| Branch | `dev` |
| Pre-correction Phase 0.5 commit | `ef51acff` |
| Codebase evidence baseline | `7b344aa1` (code commit — "Planset PV-1: fix pluralization") |
| Worktree state | 5 Phase 0.5 documentation files modified (uncommitted) |
| Origin/dev alignment | Local HEAD == origin/dev HEAD (both `ef51acff`) |

### 5.2 Commit Date

All git commits in this repository are dated **2026-07-11** (verified via `git log --format=%ci`). The date "2025-07-11" that appeared in earlier Phase 0.5 documents was incorrect and has been corrected to 2026-07-11 throughout the Phase 0.5 documentation set.

---

## 6. Summary of Findings

| Finding | Value |
|---------|-------|
| Migration directory | `lib/migrations/` |
| Total SQL files | 101 |
| Naming convention | `{NNN}_{snake_case_description}.sql` (zero-padded 3-digit prefix) |
| Highest prefix | 104 |
| Lowest prefix | 001 |
| Gaps | 009, 012, 013, 014 (4 missing prefixes) |
| Duplicates | 074 (2 files share this prefix) |
| Primary runner | `app/api/migrate/route.ts` — monolithic inline, does NOT read files |
| Secondary runner | `app/api/admin/system-tools/route.ts` — CAN read files with SHA-256 verification |
| Schema migrations table | None exists |
| Idempotency mechanism | SQL-level (IF NOT EXISTS, ON CONFLICT DO NOTHING, existence checks) |
| Next identifier | `NEXT_ENTERPRISE_AUTHORITY_MIGRATION` (placeholder — cannot be assigned unambiguously) |

---

## 7. Warning

> **WARNING:** The next migration identifier for the Enterprise Multi-Tenant Authority initiative CANNOT be assigned a numeric value until the following reconciliation steps are completed:
>
> 1. The numbering convention is confirmed ("highest + 1" vs "fill gaps first").
> 2. The duplicate at prefix 074 is resolved (accepted as intentional or renumbered).
> 3. The gaps at prefixes 009, 012, 013, 014 are confirmed as intentional or resolved.
>
> Assigning a numeric value without this reconciliation risks creating a migration file with an ambiguous or conflicting identifier. The placeholder `NEXT_ENTERPRISE_AUTHORITY_MIGRATION` MUST be used in all Phase 0.5 and Phase 1 documents until the reconciliation is complete and the identifier is formally assigned.
>
> Furthermore, `NEXT_ENTERPRISE_AUTHORITY_MIGRATION` is PROHIBITED from execution until all 15 Phase 1 entry gates pass and Raymond has explicitly approved in writing. See `ENTERPRISE-MULTI-TENANT-PHASE1-ENTRY-GATES.md` for the full entry gate conditions.

---

## 8. Evidence Commands

The following commands can be run to verify the findings in this document:

### 8.1 Count migration files

```bash
ls lib/migrations/*.sql | wc -l
```

### 8.2 List all prefixes sorted numerically

```bash
ls lib/migrations/ | awk -F_ '{print $1}' | sort -n
```

### 8.3 Find gaps in the sequence

```bash
for i in $(seq -w 1 104); do
  if ! ls lib/migrations/${i}_*.sql 2>/dev/null | head -1 | grep -q .; then
    echo "MISSING: ${i}"
  fi
done
```

### 8.4 Find duplicate prefixes

```bash
ls lib/migrations/ | awk -F_ '{print $1}' | sort | uniq -d
```

### 8.5 Find the highest prefix

```bash
ls lib/migrations/ | awk -F_ '{print $1}' | sort -n | tail -1
```

### 8.6 Verify the primary runner does not read migration files

```bash
grep -n "readFileSync\|readdirSync\|lib/migrations" app/api/migrate/route.ts
# Expected: no output (the runner does not read migration files)
```

### 8.7 Verify no schema_migrations table exists in the runner

```bash
grep -n "schema_migrations\|migration_log" app/api/migrate/route.ts
# Expected: no output (no tracking table)
```

### 8.8 Verify the secondary runner CAN read migration files

```bash
grep -n "readFileSync\|readdirSync\|run_migration\|sha256" app/api/admin/system-tools/route.ts
# Expected: output showing file reading and SHA-256 verification
```

### 8.9 Verify git state

```bash
git branch --show-current          # Expected: dev
git rev-parse HEAD                 # Expected: ef51acff...
git rev-parse origin/dev           # Expected: ef51acff... (aligned)
git log --format=%ci -1            # Expected: 2026-07-11...
```

---

## 9. Confidence Assessment

| Finding | Confidence | Basis |
|---------|------------|-------|
| 101 SQL files in `lib/migrations/` | HIGH | Direct `ls` + `wc -l` verification |
| Highest prefix is 104 | HIGH | Direct `ls` + `sort -n` + `tail -1` verification |
| Gaps at 009, 012, 013, 014 | HIGH | Direct `for` loop verification |
| Duplicate at 074 | HIGH | Direct `uniq -d` verification + `ls` of both files |
| Primary runner does not read files | HIGH | `grep` for `readFileSync`/`readdirSync` returned no matches |
| No schema_migrations table | HIGH | `grep` for `schema_migrations`/`migration_log` returned no matches |
| Secondary runner reads files with SHA-256 | HIGH | `grep` confirmed `readFileSync`, `readdirSync`, `sha256` references |
| Next identifier cannot be assigned unambiguously | HIGH | Structural anomalies (duplicate + gaps) + ambiguous convention |

---

## 10. Cross-References

| Reference | Document |
|-----------|----------|
| Phase 0.5 Decision Register | `ENTERPRISE-MULTI-TENANT-PHASE0.5-DECISION-REGISTER.md` |
| Architecture Decision Records | `ENTERPRISE-MULTI-TENANT-ARCHITECTURE-DECISION-RECORDS.md` |
| Phase 1 Entry Gates | `ENTERPRISE-MULTI-TENANT-PHASE1-ENTRY-GATES.md` |
| Phase 1 Implementation Spec | `ENTERPRISE-MULTI-TENANT-PHASE1-IMPLEMENTATION-SPEC.md` |
| Canonical Authority Model | `ENTERPRISE-MULTI-TENANT-CANONICAL-AUTHORITY-MODEL.md` |
| Raymond Approval Packet | `ENTERPRISE-MULTI-TENANT-RAYMOND-APPROVAL-PACKET.md` |

---

**Document Footer**

**Migration directory:** `lib/migrations/`
**File count:** 101
**Highest prefix:** 104
**Gaps:** 009, 012, 013, 014
**Duplicates:** 074 (2 files)
**Next identifier:** `NEXT_ENTERPRISE_AUTHORITY_MIGRATION` (placeholder — discovery required)
**Confidence:** HIGH (all findings verified via direct inspection)
**Warning:** Do NOT assign a numeric value until reconciliation is complete
