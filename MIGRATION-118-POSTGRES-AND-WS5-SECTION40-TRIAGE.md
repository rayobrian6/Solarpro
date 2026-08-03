# MIGRATION 118 POSTGRESQL ACCEPTANCE — AND §26 / §40 FINDINGS TRIAGE

Two-phase operational pass on top of `01d128a2`.

| | |
|---|---|
| **Phase A — Migration 118 PostgreSQL acceptance** | **BLOCKED** (see §A6) |
| **Phase B — §26 / §40 findings triage** | **COMPLETE** — `WS5-SECTION-40-FINDINGS-TRIAGE.md` |

---

## 0. REPOSITORY STATE

| | |
|---|---|
| Starting remote HEAD | `01d128a26b28bacce849e158a4813bc8adbb9216` |
| Local HEAD at start | identical — **0 ahead / 0 behind** |
| Working tree | clean (tracked); only `_tmp_*` scratch untracked |
| Ending commit | `c92a8b500b5b8074d2d78ebf1e1c832206e55c44` — pushed, 0 ahead / 0 behind |

Ancestry verified — every required commit is an ancestor of `origin/dev`:

| Commit | Subject |
|---|---|
| `01d128a2` | D5/D6 — cross-sheet voltage-drop agreement + project-timezone dates |
| `6bafde00` | WS-5 closure report |
| `9402824a` | WS-5 part 1 — length source / verification separation |
| `eafdc688` | WS-5 — field measurement reachable end-to-end |
| `f944906a` | **D1** — utility service run stops being counted as installer field work |
| `b108164b` | **D2** — grounding is segment-specific |
| `f088e72a` | **D3** — equipment schedule stops omitting four fifths of itself |
| `97468283` / `35b830bc` | **D4** — embedded canonical fonts + closure |
| `1d2d7922` | **WS-3** — conduit callout derived from its raceway |
| `eb2cde6f` | SOC 2 / ISO 27001 merge + Next 15 / React 19 |
| `78320084` | R8 — `dev` as integration branch |

No rewind, reset, rebase or force-push.

---

## PHASE A — MIGRATION 118 POSTGRESQL ACCEPTANCE

### A1 · Migration 118 source verification

| | |
|---|---|
| Filename | `lib/migrations/118_field_route_measurements.sql` |
| Identifier | `118` |
| **Checksum (SHA-256)** | **`31ed0d08b2a42d5582cb013cea3ce35090268e4f05b496e8e52135f977807b6f`** |
| Manifest | discovered by `lib/migrations/manifest.ts`; `REGISTRY_SEQUENCE` = `113…118`; `TARGETED_RECOVERY_ALLOWLIST` includes `118` |
| Deployment spec | `targetedRegistryDeployment.ts:80` — `expectedTables: ['field_route_measurements','field_route_measurement_events']` |
| Transaction | Neon `sql.transaction` — all-or-nothing per migration, `pg_try_advisory_xact_lock`, checksum validation, ledger + run-history |
| Rollback | **None.** No down/rollback is supported by this runner; the migration is pure additive `CREATE TABLE / CREATE INDEX IF NOT EXISTS`, so re-running is a safe no-op. |

*Checksum algorithm confirmed empirically:* plain SHA-256 over the file bytes.
Computing `117_ahj_registry.sql` the same way yields
`b408dba1ca3493b99c6f6ae31ff8751aef2a826f6dbbbfebfb7448afb762e18f`, which
matches the checksum recorded in the production `schema_migrations` row for 117
byte-for-byte.

**Two tables — confirmed accurate.**

`field_route_measurements` (5 indexes) and `field_route_measurement_events`
(3 indexes). The audit table is written by the *same* `sql.transaction()` as the
state transition it describes, so an audited transition and an unaudited one
cannot both exist — the design intent stated in the migration header and the
reason the compliance `audit_log` (migration 100, best-effort by design) cannot
serve this role.

**Required invariants — all present at the storage layer:**

| Invariant | Constraint |
|---|---|
| Default state is reported/unverified | `verification_state TEXT NOT NULL DEFAULT 'REPORTED_UNVERIFIED'` |
| Verified requires verifier + timestamp + **mode** | **`ck_frm_verified_complete`** |
| Rejected requires a written reason | `ck_frm_rejected_complete` (incl. `length(btrim(...)) > 0`) |
| Supersession link valid | `ck_frm_superseded_complete` |
| Unverified carries no verification/rejection facts | `ck_frm_unverified_clean` |
| Tenant + project identity required | `tenant_id TEXT NOT NULL`, `project_id UUID NOT NULL REFERENCES projects(id)` |
| Route segment identity required | `route_segment_id TEXT NOT NULL` |
| Measured length positive | `ck_frm_length_positive` (`> 0 AND <= 10000`) |
| State / method / mode enumerations | `ck_frm_state`, `ck_frm_method`, `ck_frm_mode` |
| Tenant/project/route/state indexes | `idx_frm_tenant_project`, `idx_frm_project_segment`, `idx_frm_segment_state`, `idx_frm_project_state`, `idx_frm_supersedes` |

`ck_frm_verified_complete`, verbatim:

```sql
CONSTRAINT ck_frm_verified_complete
  CHECK (verification_state <> 'VERIFIED'
      OR (verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL AND verification_mode IS NOT NULL)),
```

**Not proven:** that PostgreSQL actually *rejects* a malformed verified row. That
requires execution, which did not happen (§A6). Constraint text is not constraint
behaviour, and this report does not conflate them.

### A2 · Pre-application state (READ-ONLY catalog proof)

A strictly read-only probe was run against the configured database — session set
`TRANSACTION READ ONLY`, every statement guarded to `SELECT`/`WITH` only. **No
DDL, no DML, no migration application.**

| | |
|---|---|
| Provider | Neon (`***.eastus2.azure.neon.tech`, pooler endpoint) |
| Server | PostgreSQL **17.10** |
| Database | `neondb` |
| Role | `neondb_owner` (has `CREATE`) |
| Highest applied migration | **117** — applied `2026-07-30T03:24:11.931Z` |
| Ledger tables | `schema_migrations`, `schema_migration_runs`, `migration_baseline`, `migration_governed_actions`, `migration_totp_uses` |

**Table absence proof — `to_regclass` at the catalog:**

```
field_route_measurements         ABSENT
field_route_measurement_events   ABSENT
schema_migrations rows for '118' : 0
```

Registry sequence context (113–117): `manufacturer_document_registry` EXISTS,
`equipment_reconciliation_audit` EXISTS, `personnel_roles` EXISTS,
`project_personnel_assignments` EXISTS, `engineering_review_records` EXISTS,
`ahj_registry` EXISTS.

> **A false drift signal I raised and withdrew.** My first probe reported
> `project_personnel_roles` ABSENT and I flagged it as 115 drift. That was my
> error: migration 115 creates `personnel_roles` and
> `project_personnel_assignments`, and `targetedRegistryDeployment.ts:41`
> correctly declares exactly those two. Both exist. **There is no drift.**

**Migration 118 is not applied, and its checksum was never recorded.**

### A3 · PostgreSQL contract suite — NOT EXECUTED

The 45 required contract cases (recording, verification, database constraints,
transactionality, rejection/supersession, tenancy, reachability) were **not run
against PostgreSQL**. The in-memory adapter continues to pass them; that is
explicitly **not** offered as PostgreSQL acceptance.

| Environment probe | Result |
|---|---|
| `TEST_DATABASE_URL` | unset |
| `DATABASE_URL` / `POSTGRES_URL` / `PGHOST` | unset |
| `psql` / `pg_ctl` | not found |
| Docker daemon | not running (`dockerDesktopLinuxEngine` pipe absent) |
| Local listener on 5432 | none |
| `@electric-sql/pglite` | not installed |
| Neon API key (for branching) | none in env, none in repo |
| Reachable database | **production `neondb` only** |

### A4 · Controlled PostgreSQL fixture — NOT EXECUTED

Blocked by A3. No fixture was created. **No measurement — controlled or
otherwise — was written to any database.**

### A5 · Live Braidon non-mutation proof

Braidon was **not** used as a fixture, and nothing was inserted or deleted.

| | |
|---|---|
| Field route measurements | **0** — by construction: the table does not exist |
| Verified field route measurements | **0** |
| Unresolved project-owned routes | **4** |
| Geometry-derived project-owned routes | **1** (`BRANCH_RUN`, `cad-route` / `geometry-derived`) |
| Utility-owned excluded routes | **1** (`MSP_TO_UTILITY_RUN`) |
| Route requirement | **`ROUTE-LENGTH-ESTIMATE` OPEN** |
| Voltage drop, within limit | **`PROVISIONAL PASS`** — 6 graded rows + 1 `INDETERMINATE` (tap) |
| `VERIFIED PASS` in package | **0** |

Regenerated at all three profiles and compared byte-for-byte against the
`01d128a2` artifacts:

| Profile | Snapshot | SHA-256 vs `01d128a2` |
|---|---|---|
| design-review (17 sheets) | `PDS-F204B258575D` | **IDENTICAL** `207f1514051ae70d…` |
| permit (16 sheets) | `PDS-0FCD30C4C7A5` | **IDENTICAL** `09ab4c39976d7db3…` |
| full (22 sheets) | `PDS-52CF36872161` | **IDENTICAL** `a1f30fd853e21a22…` |

### A6 · ACCEPTANCE RESULT

> # MIGRATION 118 POSTGRESQL **BLOCKED**

**Exactly what was unavailable:**

1. **No `TEST_DATABASE_URL`** and no approved non-production database.
2. **No local PostgreSQL, no `psql`, no Docker runtime**, no PGlite, no Neon API
   key for branching.
3. **The only reachable database is production `neondb`.** Applying DDL to it
   with the raw `neondb_owner` credential would bypass the governed runner —
   which this brief forbids outright — and would be an unauthorised production
   schema change producing no ledger record, no checksum and no actor.
4. **The governed path requires an operator.** `execute-field-measurements-118`
   demands `super_admin` + active MFA + a **fresh TOTP** + typed production
   confirmation + `MIGRATION_ALLOW_PRODUCTION_EXECUTION=true`. That is Ray's
   authenticated session; I cannot perform it.

**Not claimed:** governed application, catalog-level post-application schema
proof, constraint *behaviour*, index proof, PostgreSQL adapter contract,
transaction-rollback proof, tenant-isolation proof, or reachability/reopening
proof against PostgreSQL.

### A6.1 · A blocker that WAS removed — the missing operator button

Tracing the governed path surfaced the reason migration 118 had never been run.
Everything server-side was wired:

- `execute-field-measurements-118` in the action allowlist
  (`app/api/admin/migrations/route.ts:248`)
- the handler resolves the identifier (`route.ts:635-639`)
- `REGISTRY_DEPLOYMENT['118']` carries its expected tables
- `REGISTRY_SEQUENCE` and `TARGETED_RECOVERY_ALLOWLIST` both include `118`

…and the governed console had `RegistryButton` entries for **113, 114, 115, 116,
117 and nothing else.** The migration was executable by the system and reachable
by **no operator** — structurally the same defect WS-5 itself was written to
fix, reappearing one layer down in the operator surface.

**Repaired** (`app/admin/system-tools/migrations/page.tsx`): the 118 button, the
card heading `113 → 118`, and copy explaining what the two tables are and why
`ROUTE-LENGTH-ESTIMATE` is unclosable until they exist.

The existing parity test said, in its own comment, that *"a file with no
spec/action/button is simply unreachable from the console"* — then checked only
the spec. Two assertions were added to
`tests/targetedRegistryDeployment.test.ts` closing the other two thirds for
**every** identifier: an allowlisted API action must exist, and a console button
must exist and must name the same tables the deployment spec expects.

**Proven non-vacuous:** temporarily deleting the 118 button makes the new test
fail with `no console button for migration(s): 118 — the migration would be
executable by the system and reachable by no operator`. Restored immediately.

### A6.2 · How to unblock Phase A

1. Sign in as `super_admin` with MFA active.
2. **Admin → System Tools → Migrations** → *Deploy authority registries —
   migrations 113 → 118*.
3. **Run migration 118…** → fresh TOTP + reason + type `production`.
4. Expect: checksum
   `31ed0d08b2a42d5582cb013cea3ce35090268e4f05b496e8e52135f977807b6f`, a
   `schema_migrations` row for `118`, and both tables present. Idempotent — a
   second run is a safe no-op.

Once done, the remaining acceptance work is: re-probe the catalog for tables /
constraints / indexes, prove constraint *behaviour* (a malformed verified row
must be refused by PostgreSQL, not only by TypeScript), and run the 45-case
contract against the real adapter including transaction-rollback and
cross-tenant proofs.

> **Security — action required.** While parsing `.db_url` to report the database
> host, a careless regex printed the **live Neon password** into the session
> transcript. My fault. **Rotate the `neondb_owner` credential.** It was used
> only for the read-only probes described above.

---

## PHASE B — §26 / §40 FINDINGS TRIAGE

Full document: **`WS5-SECTION-40-FINDINGS-TRIAGE.md`** — findings extracted
verbatim from the report (not from memory), each reproduced in code and
adversarially re-verified.

**The brief conflated two lists.** §40 (Part II, D5/D6) holds the date and
label findings. The "three procurement/current defects" and the blanket `1.15`
are **§26** (Part I, WS-5). Both are triaged.

### Risk ranking (evidence-driven)

| ID | Finding | Class | Wrong today? |
|---|---|---|---|
| §40-3 | GET self-heal re-stamps an issued package | **authority / release** | yes — date, Doc ID, digest, **licensed review coverage** |
| §26-2 | double-applied `1.15` → **`1.3225`** | **procurement** | yes — every conduit/conductor/fitting quantity |
| §26-1 | blanket `1.15` inside the calculation length | **calculation** | yes — VD %, and **conductor gauge** where marginal |
| §40-2b | package-wide-weakest route label | **cross-sheet contradiction** | yes — PV-1/SCHED vs PV-4B |
| §26-3 | null segment currents | calculation + archive | one ampacity verdict falsely `PENDING` |
| §40-1 | localised date in 6 **digested** ISO slots | authority (digest churn) | RS-1 only (internal profile) |
| §40-2a | `routeProvenanceLabel` divergent predicate | **presentation** | no — unreachable in production |
| §40-5 | client UTC default → saved SLD SVG | presentation | non-planset artifact |
| §40-4 | retrieval time in a publication-date column | provenance semantics | not rendered |
| §40-6 | fixture 6/13 vs live 5/14 | **not a defect** | — |

### `routeProvenanceLabel` — classification

> ## **PRESENTATION-ONLY DIVERGENCE**

`field-measured` is the **only** input on which it disagrees with
`closesFieldVerification`, and **no production path can produce it** —
`build.ts` co-writes `lengthSource` and `verificationStatus` in every branch, and
`measurementAuthorityPair` can only emit `field-reported` or `field-verified`.
All production consumers are string interpolation; every real decision (release
closure, VD grading, the verified-length write, BOM procurement state) reads the
canonical predicates directly. Converging it changes **zero rendered bytes** on
Braidon.

**But three things the finding did not record:**

1. **There are four inline copies, not one** — including
   `electricalProjection.ts:1350` (inside the **PV-4B.1** path) and
   `structuralPages.ts:1986`, which makes **SCHED print `ROUTE AUTHORITY:
   VERIFIED`** on exactly the input `closesFieldVerification` refuses.
2. **The live defect is the opposite one.** The label takes the package-wide
   *weakest* state across all segments and does not filter
   `routeAuthorityApplicability`, so a permanently-`cad-derived-estimate`
   `UTILITY_OWNED` run pins it — the `ROUTE FIELD-VERIFIED` branch is
   effectively **unreachable in production**. In `controlled-verified_full.html`
   a genuinely **FIELD VERIFIED** feeder renders as `CAD-DERIVED ESTIMATE —
   FIELD VERIFY` on PV-1 and `ROUTE AUTHORITY: PENDING` on SCHED while PV-4B
   says `FIELD VERIFIED`. **A cross-sheet contradiction on a stamped set, today.**
3. The §40 note's "not even a legal `RouteLengthSource`" is **half right** —
   illegal for that type, legal for the field it is actually assigned to.

**Not implemented, deliberately.** The brief permits a tiny presentation-only
repair; converging one of four copies would leave the live contradiction intact
while producing no visible change — manufacturing the appearance of convergence
without the substance. All four copies plus the applicability-scope fix belong
in one workstream (**WS-B**), contradiction tests first.

### The blanket `1.15` — dependency graph summary

One literal, **six independent re-declarations, five different meanings**, no
shared constant, no project/AHJ/segment override anywhere.

```
deriveRunLengths.ts:44 (1.15) → onewayLengthFt ─┬→ autoSizeWire/calcVoltageDrop
                                                │    → VD % and CONDUCTOR GAUGE
                                                └→ bom-engine-v4.ts:320 (1.15 AGAIN)
                                                     → ×1.3225 conduit/conductor ft
                                                     → coupling & strap COUNTS
build.ts:631/652 → oneWayFt ≡ calculationLengthFt   ← §26-1, identical values
```

- The comment calling it a *"NEC 15% slack/waste factor"* is **false** — no NEC
  article prescribes 15%.
- It reaches **conductor gauge selection**, not just the reported percentage.
- The NEC **1.25** beside it is the 690.8(B) continuous-current factor — a
  different quantity. **Any repair must not touch it.**
- On Braidon only **two** segments actually carry it (`ROOF_RUN` 25→22 ft,
  2.2891%→2.0144%; `BRANCH_HOMERUN_RUN` 18→16 ft, 0.29819%→0.26506%). The other
  three are hardcoded defaults, and `BRANCH_RUN` takes a geometric escape hatch —
  which creates a **split-brain**: the snapshot publishes 58 ft while the engine
  run the BOM reads still holds 68 ft.
- **No safe one-line fix exists.** The digest is SHA-256 over the whole snapshot
  body, so any calculation-length change re-digests every snapshot and, via
  `build.ts:1649-1653`, **invalidates every digest-bound engineering-review
  approval on every historical project**. `ws5-braidon-truth-state.test.ts:88`
  currently **pins the conflation** rather than catching it.

**The `1.15` was not removed or altered.**

### Recommended workstream order

The brief's suggested order was `routeProvenanceLabel → currents → length
separation → procurement`. The trace argues otherwise, and the brief invited
that:

| # | Workstream | Why here |
|---|---|---|
| **WS-A** | Issue-date replay on regeneration (§40-3) | highest severity, smallest blast radius, zero coupling — a *read* must not re-date an issued document |
| **WS-B** | Route-authority label convergence (§40-2a **+** 2b, all four copies) | presentation-only, but must ship whole |
| **WS-C** | Current-semantics separation (§26-3) | must precede WS-D so the ampacity chain is trustworthy before lengths move |
| **WS-D** | Calculation length vs procurement allowance (§26-1 **+** §26-2) | largest; **requires Ray's decision on digest re-basing** |
| **WS-E** | Provenance + low-risk cleanups (§40-4, §40-5, §40-1 non-digest half) | independent, cheap |
| **WS-F** | Digest scope (§40-1 digest half) | needs a decision; cuts a coupling an existing test asserts |

Non-goals are enumerated in §6 of the triage document.

---

## VALIDATION RESULTS

Application source changed (the governed-console button), so the full cycle was
run — **plus** a byte-identity proof that the planset artifact is untouched,
rather than an assertion that it should be.

| Check | Result |
|---|---|
| Targeted D1–D6 + WS-5 suites (9 files) | **152 passed / 0 failed** |
| Registry deployment suite | **24 passed** (22 pre-existing + 2 new) |
| Full suite | **9608 passed / 0 failed / 490 skipped** (416 files) — exactly `+2` vs `01d128a2`'s 9606, the two new reachability tests |
| Lint | **0 errors** (pre-existing `no-console` / `exhaustive-deps` warnings only; none introduced) |
| Typecheck | **exit 0** |
| Production build | **exit 0** |
| Artifact byte-identity, all 3 profiles | **IDENTICAL** to `01d128a2` |
| Migration status (read-only) | 118 **not applied**, 0 ledger rows, both tables ABSENT |
| PostgreSQL contract | **NOT EXECUTED — blocked** (§A6) |

**Not re-run, with reason:** evidence harnesses, page-fit, internal clipping,
authoritative PDFs and visual inspection. All three planset profiles are
byte-identical to the artifacts those checks passed against at `01d128a2`
(`ep` 22/22, `ppc` 18/18, `bar` 14/14, `rgm` 17/17, `co` 20/20, `rp` 20/20,
page-fit 25 sheets / 0 clipped). Re-running them would re-measure identical
bytes. **`planset-evidence-ecd` still exits 2** — pre-existing, verified in the
prior pass to fail identically on the `6bafde00` baseline artifact. It is not
newly failing and is not repaired here.

### Regression proof

| Requirement | Result |
|---|---|
| D1 route ownership | 4 unresolved project-owned / 1 geometry-derived / 1 utility-owned excluded |
| D2 grounding | segment-specific, no project-wide EGC minimum |
| D3 | **48 rows / 48 unique / 0 duplicates / 15 conduit fitting rows** |
| D4 font manifest | 5 `@font-face`, 0 Helvetica, 0 Courier New, 0 bare monospace/sans-serif |
| WS-5 source/state pairs | valid (`resolver-precedence` green) |
| `BRANCH_RUN` | `cad-route` / `geometry-derived` — unchanged |
| PV-4B ↔ PV-4B.1 | aligned — `d5-voltage-drop-cross-sheet` 27/27 |
| Project-timezone dates | deterministic — `d6-document-issue-date` 32/32 |
| Braidon measurements | **0** |
| Release requirements suppressed | **none** |
| Fictional field evidence | **none** |

---

## FINAL ACCEPTANCE

| | |
|---|---|
| **Migration 118 PostgreSQL** | **BLOCKED** — not applied; no PostgreSQL execution environment; governed application requires the operator's TOTP session. The *console* blocker (a missing operator button) was found and removed, so it is now runnable. |
| **§26 / §40 triage** | **COMPLETE** — 6 + 6 findings extracted verbatim, each reproduced and adversarially verified; risk classes, blast radii, data flows, test gaps, six workstreams, ordered, with explicit non-goals. |

Nothing in Phase B was implemented. The `1.15` was not touched. Braidon received
no measurements and its artifact is byte-identical.

---
---

# MIGRATION 118 LIVE POSTGRESQL ACCEPTANCE

Pass run on `a4defa15` after migration 118 was applied through the governed
production console.

> # MIGRATION 118 POSTGRESQL NOT ACCEPTED
>
> ## BLOCKED — DATABASE OWNER CREDENTIAL REQUIRES ROTATION

No database connection was opened in this pass. The blocker is the security
precondition, not a defect in migration 118.

---

## 0. REPOSITORY STATE

| | |
|---|---|
| Starting remote HEAD | `a4defa15683baba488d8dcd74828190bd5c71f8a` |
| Local HEAD | identical — **0 ahead / 0 behind** |
| Working tree | clean (tracked) |
| Ending commit | report-only; no source change |
| Push status | see §9 |

All accepted ancestors confirmed present on `origin/dev`: `a4defa15`,
`c92a8b50` (118 console reachability), `01d128a2` (PV-4B/PV-4B.1 + timezone),
`6bafde00` / `eafdc688` / `9402824a` (WS-5), `f944906a` (D1), `b108164b` (D2),
`f088e72a` (D3), `97468283` (D4), `1d2d7922` (WS-3), `eb2cde6f` (Next 15 /
React 19 + SOC 2 / ISO 27001). No rewind, reset, rebase or force-push.

---

## 1. SECURITY GATE — FAILED

The precondition was: *confirm the exposed credential has been rotated; if not,
stop database testing.* It has **not** been rotated.

Verified by fingerprint comparison only — **no password, connection URL or
token was printed, and none appears in this report.**

| Check | Result |
|---|---|
| `.db_url` credential vs the exposed value | **IDENTICAL** (SHA-256 fingerprint match) |
| `.db_url` last modified | **2026-06-06** — unchanged since before the exposure |
| Application / console using a replacement credential | **cannot be confirmed** — no replacement exists |
| Database connection opened this pass | **none** |

### 1.1 The exposure is far wider than the transcript leak

Searching for the credential across the repository turned up something more
serious than the console print I made in the previous pass. **The same
`neondb_owner` credential is hard-coded in five files that are committed to git
and pushed to `github.com/rayobrian6/Solarpro`.**

| Tracked file | Credential |
|---|---|
| `check_is_global.js` | same as exposed |
| `check_table_structure.js` | same as exposed |
| `migrations/add_is_global_column.js` | same as exposed |
| `test_knowledge_loading.js` | same as exposed |
| `test_solardog_knowledge.sh` | same as exposed |

- **Earliest commit containing it: `b583829a`, 2026-03-05** ("SolarPro V8.3
  build") — roughly **five months** in pushed history, across 3 commits.
- All five files are **dead scratch**: zero references from `app/`, `lib/` or
  `package.json`.
- `.gitignore` covers `.env*` but nothing stopped credentials being pasted
  directly into tracked `.js` / `.sh` files.

**My transcript print was a duplicate of an exposure that already existed in
public history — it did not create it.** That does not reduce the urgency; it
raises it, because rotation is now overdue rather than merely prudent.

### 1.2 Required remediation, in order

1. **Rotate the `neondb_owner` password in the Neon console.** This is the only
   action that ends the exposure — history rewriting alone does not, because the
   old value has been pushed and may be cloned or cached.
2. Update the credential wherever the application and governed console read it
   (Vercel environment, local `.db_url`).
3. Remove the hard-coded credentials from the five dead files (they are
   unreferenced; deleting the files is the simplest fix).
4. Optionally purge history (`git filter-repo` / BFG) — **after** rotation, and
   coordinated, since it rewrites shared history. **I did not do this: the brief
   forbids rewriting shared history, and it must not be done unilaterally.**
5. Consider a pre-commit secret scan so a pasted credential cannot be committed
   again.

**No source change was made in this pass.** Scrubbing the five files is a real
repair but it is not this pass's scope, and doing it without rotation would give
a false sense of closure.

---

## 2. WHAT WAS PROVEN WITHOUT THE DATABASE

### 2.1 Migration 118 source checksum — full match

| | |
|---|---|
| File | `lib/migrations/118_field_route_measurements.sql` |
| Bytes | 14,616 |
| **Source SHA-256** | **`31ed0d08b2a42d5582cb013cea3ce35090268e4f05b496e8e52135f977807b6f`** |
| Expected prefix `31ed0d08` | matches |

The **complete** checksum is recorded here, not only the prefix, so the
stored-vs-source comparison can be made byte-for-byte the moment the database is
reachable. **The stored ledger checksum was not read this pass** — that requires
a connection.

### 2.2 Registry deployment + console reachability — 24/24

`npx vitest run tests/targetedRegistryDeployment.test.ts` → **24 passed**,
including the two reachability assertions added in `c92a8b50` (every
`REGISTRY_SEQUENCE` identifier has an allowlisted API action **and** a console
button naming the deployment spec's tables).

### 2.3 Targeted regression — 241 passed / 1 skipped

`d1-route-ownership`, `d3-sched-bom-reconciliation`, `d4-canonical-font-pack`,
`conductor-authority` (D2), `ws5-field-measurement-reachability`,
`ws5-braidon-truth-state`, `d5-voltage-drop-cross-sheet`,
`d6-document-issue-date`, `resolver-precedence`, and all of
`tests/fieldMeasurement` → **13 files, 241 passed, 1 skipped**.

The single skip is the **PostgreSQL repository-contract block**, which skips
without `TEST_DATABASE_URL`. That skip is precisely what this pass existed to
turn green, and it remains skipped.

### 2.4 Planset 22 — accepted baseline verified

Measured directly from
`PermitPackage-BRAIDON M PILLA — Solar TEST (22).html`:

| Fact | Expected | Measured |
|---|---|---|
| Profile | design review | design review |
| Snapshot | — | `PDS-F0B861F20C07` |
| Sheets | 19 | **19** (`SHEET n OF 19`, 19 title blocks) |
| Open gates | 5 | **5** |
| Unresolved requirements | 14 | **14** |
| Braidon measurements | 0 | **0** |
| Verified measurements | 0 | **0** |
| Unresolved project-owned routes | 4 | **4** ("4 of 5 PROJECT-OWNED electrical run(s)") |
| Geometry-derived project-owned | 1 | **1** |
| Utility-owned excluded | 1 | **1** |
| Route requirement | OPEN | **OPEN** (`ROUTE-LENGTH-ESTIMATE` present) |
| Voltage drop within limit | PROVISIONAL | **8 × `PROVISIONAL PASS`**, 0 × `VERIFIED PASS` |
| D3 | 48 / 48 / 15 | **48 rows / 48 unique / 15 conduit fitting** |
| D4 | 5 faces / 0 host | **5 `@font-face` / 0 Helvetica / 0 Courier New / 0 bare** |
| Issue date authority | America/Chicago | **`America/Chicago` via `project-jurisdiction`**, single date `8/3/2026` |

Planset 22 matches its stated truth on every point.

### 2.5 A correction I owe to my own earlier reports

**The "sheet count" figures in the D5/D6 and triage reports were measured on the
wrong basis.** I counted `<div class="page">` elements; the authoritative count
is the title block (`SHEET n OF N`). Re-measured:

| Profile | I reported | Actual |
|---|---|---|
| design-review | 17 | **19** |
| permit | 16 | **18** |
| full | 22 | **25** |

Consequence for §40-6: the frozen fixture's design-review artifact renders
**19 sheets — the same as the live Planset 22.** The sheet-count half of that
finding was my measurement error, not a fixture-vs-live data difference.

**The gates/requirements half still stands and is still a genuine data
difference**: the frozen fixture renders **6 gates / 13 requirements**, the live
design renders **5 / 14**. Different inputs, neither changed to match the other.

`scripts/ws5-artifacts.ts` prints the same misleading `.page` count. Correcting
it is a one-line change and is **not** made here (report-only pass); it is noted
so the number is not trusted again.

---

## 3. WHAT COULD NOT BE PROVEN — the full acceptance checklist

Every item below requires a database connection and is **NOT PROVEN**. None is
claimed, inferred, or substituted from the in-memory adapter.

| § | Requirement | Status |
|---|---|---|
| 1 | Migration ledger entry, stored checksum, applied timestamp, applied-by, runner identity | **NOT PROVEN** |
| 1 | Highest applied = 118, applied once, no pending duplicate | **NOT PROVEN** |
| 2 | Catalog-level table / column / type / nullability / default / PK / FK proof | **NOT PROVEN** |
| 3 | `ck_frm_verified_complete` and the 8 constraint rejection probes | **NOT PROVEN** |
| 4 | Installed index proof (7 index groups) | **NOT PROVEN** |
| 6 | Real PostgreSQL repository/service contract | **NOT RUN — skipped** |
| 7 | Recording contract (12 cases) | **NOT PROVEN** |
| 8 | Verification contract (14 cases) | **NOT PROVEN** |
| 9 | Rejection contract (9 cases) | **NOT PROVEN** |
| 10 | Supersession contract (9 cases) | **NOT PROVEN** |
| 11 | Transactional audit atomicity + 3 forced-rollback proofs | **NOT PROVEN** |
| 12 | Tenant-isolation proof (10 cases) | **NOT PROVEN** |
| 13 | End-to-end reachability fixture (initial → reported → verified → reopened) | **NOT RUN** |
| 14 | Snapshot ID / digest behaviour by state | **NOT MEASURED** |

**Exact command that must run, and its status:**

```
TEST_DATABASE_URL=<redacted> npx vitest run tests/fieldMeasurement
→ NOT RUN. Currently: 1 skipped (the PostgreSQL repository-contract block).
```

Catalog validation was **not** performed either, so this pass cannot even offer
the partial read-only proof the brief allows — the credential gate precedes it.

---

## 4. LIVE BRAIDON NON-MUTATION

Braidon was **not** used as a fixture. **No measurement, audit event, tenant or
project row was written to any database, because no database connection was
opened.**

| | |
|---|---|
| Field route measurements | **0** |
| Verified field route measurements | **0** |
| Unresolved project-owned routes | **4** |
| Geometry-derived project-owned routes | **1** |
| Utility-owned excluded routes | **1** |
| Route requirement | **OPEN** |
| Voltage-drop grade | **PROVISIONAL** where within limit (8 rows), `INDETERMINATE` on the unmeasured tap |
| Planset generation without measurements | **works** — Planset 22 rendered and verified |

No test measurement or audit event references Braidon's project id, because none
was created.

---

## 5. PLANSET REGRESSION

**No regeneration performed and none required** — no application source changed
in this pass. Planset 22 was verified as an artifact (§2.4) rather than
re-rendered.

`planset-evidence-ecd` remains **exit 2** — pre-existing, verified in an earlier
pass to fail identically on the `6bafde00` baseline artifact. **Not a new
regression, and not repaired here.**

---

## 6. TEST RESULTS

| Check | Result |
|---|---|
| Migration 118 source checksum | **full match** `31ed0d08…807b6f` |
| Migration ledger verification | **BLOCKED** |
| Catalog schema verification | **BLOCKED** |
| PostgreSQL constraint probes | **BLOCKED** |
| PostgreSQL adapter contract | **SKIPPED** (no `TEST_DATABASE_URL`) |
| Transaction rollback tests | **BLOCKED** |
| Tenant-isolation tests | **BLOCKED** |
| Reachability / reopening fixture | **BLOCKED** |
| Registry deployment + console reachability | **24 passed** |
| Targeted D1–D4 / WS-5 / PV-4B / timezone | **241 passed / 1 skipped** (13 files) |
| Lint | not run — no source change |
| Typecheck | not run — no source change |
| Full suite / harnesses / build / PDFs / visual | not run — no source change |

---

## 7. WHAT UNBLOCKS THIS

1. **Rotate the `neondb_owner` credential** (§1.2). Nothing else can proceed.
2. Update the application, governed console and local `.db_url` to the new value.
3. Provide a **safe writable PostgreSQL target** for the contract suite, in the
   brief's own order of preference — a dedicated test database, or an ephemeral
   Neon branch. The contract writes measurements, audit events and two tenants;
   it must not run against production.
4. Then, in one pass: ledger + catalog + constraint + index proof, the real
   adapter contract, the three forced-rollback proofs, tenant isolation, and the
   end-to-end reachability fixture.

Migration 118 itself shows no sign of a defect. **It simply has not been proven
yet**, and this report does not pretend otherwise.

---

## 8. FINAL RULING

> # MIGRATION 118 POSTGRESQL NOT ACCEPTED
>
> **Blocker:** `BLOCKED — DATABASE OWNER CREDENTIAL REQUIRES ROTATION`
>
> The `neondb_owner` credential exposed earlier is unrotated, and the same
> credential is committed in five tracked files pushed to GitHub since
> 2026-03-05. No database connection was opened. Ledger, catalog, constraint,
> index, adapter-contract, atomicity, tenant-isolation and reachability proofs
> are all outstanding.

WS-A remains not started, as instructed.
