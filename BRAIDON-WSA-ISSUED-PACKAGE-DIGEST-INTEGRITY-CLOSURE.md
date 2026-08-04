# WS-A — ISSUED-PACKAGE GET SELF-HEAL AND DIGEST-INTEGRITY REPAIR

> # WS-A ISSUED-PACKAGE DIGEST INTEGRITY: ACCEPTED

A read of an issued permit package no longer changes it. No database connection
was opened, no Migration 118 work was done, and no credential work was mixed in.

---

## 1. STARTING BRANCH AND ANCESTRY

| | |
|---|---|
| Starting remote HEAD | `026db5a150836a12a691862063a838ff59326b1d` |
| Local HEAD at start | identical — **0 ahead / 0 behind** |
| Working tree at start | clean (tracked) |
| Ending commit | `<recorded at push>` |

Ancestors confirmed on `origin/dev`: `026db5a1` (secret cleanup), `197cc7cf`,
`a4defa15` (118 console reachability), `01d128a2` (PV-4B/PV-4B.1 + timezone),
`6bafde00` / `eafdc688` / `9402824a` (WS-5), `f944906a` (D1), `b108164b` (D2),
`f088e72a` (D3), `97468283` (D4), `1d2d7922` (WS-3), `eb2cde6f` (Next 15 /
React 19 + SOC 2 / ISO 27001). No rewind, reset, rebase or force-push.

---

## 2. GET ROUTE TRACE

`app/api/engineering/permit/route.ts` → `GET` (line 213). Before this pass:

```
checkRateLimit  →  getUserFromRequest  →  SELECT projects  →  SELECT users(role)
  →  SELECT project_files (permit_planset.html, permit_input.json)
  →  IF (!html || storedVersion < PLANSET_ENGINE_VERSION) AND inputJson:
        deskewArrayToTrue
        attachParcelIfMissing            ← network + write
        applyAerialEdgeSnapRegistration
        attachPriorSnapshotDigest
        resolveSnapshotAuthorityInputs   ← 17 resolvers, THREE of them write
        generatePermitHTML               ← re-dates, re-digests, re-IDs
        INSERT … ON CONFLICT DO UPDATE   ← overwrites the issued artifact
  →  generatePdfFromHtml  →  response
```

---

## 3. REACHABLE-WRITE INVENTORY

The brief described "a read-only GET path can currently perform a package
self-heal". The trace found **eight distinct persistent writes across six tables
plus Redis**, and the GET emitted **zero** audit events. Every row below was
adversarially re-verified against source; none was refuted.

| # | Write | Site | Reached via |
|---|---|---|---|
| 1 | upsert `project_files` (`permit_planset.html`) | `route.ts:311` | the visible self-heal |
| 2 | INSERT `equipment_reconciliation_audit` | `lib/reconciliation/reconcile.ts:225` | `resolvers.ts:549` |
| 3 | UPDATE `projects.selected_equipment` | `reconcile.ts:250` | same transaction |
| 4 | UPDATE `projects.engineering_config` ×2 (`jsonb_set`) | `reconcile.ts` | same transaction |
| 5 | INSERT `snapshot_digest_invalidations` | `reconcile.ts` | same transaction |
| 6 | upsert `ahj_registry` — **success** path | `jurisdictionResolvers.ts:401` | `code-authority@v1` |
| 7 | upsert `ahj_registry` + unbounded `enrichment_attempts` append — **failure** path | `jurisdictionResolvers.ts:334` | `code-authority@v1` |
| 8 | INSERT `manufacturer_document_registry` (`climate_hazard_dataset`, `verificationState:'verified'`) | `registry.ts:137` | `environmental-load-authority@v1` |
| 9 | INSERT manufacturer PDFs fetched over live HTTP | `structuralResolvers.ts:230` | `racking-documents@v1` |
| 10 | INSERT `nearmap_ai_cache` | `lib/aerial/nearmapCache.ts:89` | `attachParcelIfMissing` |
| 11 | Upstash Redis counter — **before authentication** | `lib/rateLimiter.ts:430` | `checkRateLimit` |

Three things make this worse than the count suggests:

1. **The writes were disguised as reads.** Items 6–9 were passed to a helper
   named **`safeDbRead`** — an upsert closure handed to something called "read".
   This is precisely the "read-side mutation hidden in an `ensure` helper" the
   brief names as a failure mode.
2. **The artifact was written under the OWNER's `user_id`, not the requester's**
   (`route.ts:311`, `${projectRow.user_id}`). The admin branch at `:244-249`
   grants access without changing the write target, so **an admin previewing
   another user's project silently rewrote that user's issued artifact.**
3. **A GET mutated canonical engineering state.**
   `projects.selected_equipment` and `projects.engineering_config` are the
   canonical stores — so two consecutive downloads could read different state,
   with the actor recorded as `system-resolver`, never the requesting user.

Confirmed read-only and left alone: `attachPriorSnapshotDigest`,
`applyAerialEdgeSnapRegistration`, `deskewArrayToTrue`, the personnel and
engineering-review resolvers, and `generatePermitHTML` itself (synchronous; it
mutates only the in-memory input).

---

## 4. SELF-HEAL ROOT CAUSE

The trigger is one comparison — `savedVerNum < PLANSET_ENGINE_VERSION`. Every
engine bump therefore re-dated **every** stored package on its next read.

The damage chain, measured end to end on the real path:

```
GET on a later day
  → generatePermitHTML(savedInput, …)
  → generatePermit.ts:161   project.date = _issue.issueDateLocal   ← UNCONDITIONAL
  → build.ts:1488           _capturedIso = generatedAtIso ?? proj.date
  → build.ts:2282           meta.generatedAtIso = … ?? proj.date   ← DIGESTED
  → digest.ts:28            computeSnapshotDigest hashes it
  → digest.ts:36            snapshotId = PDS-<digest[0..12]>
  → certPages.ts:254        SP-PERMIT-<name>-<project.date without slashes>
```

Measured, same stored input, 2026-08-03 → 2026-09-15:

| | Before | After |
|---|---|---|
| Issue date | `8/2/2026` | `9/15/2026` |
| Digest | `5a88fd0f…` | `55df7dc7…` |
| Snapshot id | `PDS-5A88FD0FC1D6` | `PDS-55DF7DC7ED12` |
| CERT Document ID | `SP-PERMIT-BRAIDONORIGI-822026` | `SP-PERMIT-BRAIDONORIGI-9152026` |

---

## 5–8. ISSUE-DATE, DIGEST, CERT AND REVIEW TRACES

**Issue date.** `generatePermit.ts:161` is a bare statement — the only `if` above
it guards a `console.warn`. A stored input's `project.date` is discarded on every
render. The highest-precedence override (`project.issueDate` /
`input.documentIssueDate`, read at `:150-151`) still has **no writer anywhere**
in `lib/`, `app/`, `components/` or `scripts/`, and no `issue_date` column
exists — so `issueDateSource` is always `generation-timestamp` on a live render.

**Digest.** `computeSnapshotDigest` deletes exactly two fields — `meta.digest`
and `meta.snapshotId` — and hashes everything else, key-sorted. There is no
clock exclusion. Seven digested fields fan out from the single expression
`_capturedIso` (`build.ts:1488`), so injecting `generatedAtIso` pins all seven.

**But two clock sources are NOT pinned by that injection**, and they are the
reason deterministic replay is impossible through the API today:
`runResolutionLifecycle` takes its own `nowIso` (`lifecycle.ts:222`), which lands
in the digested `permitReadiness.registry[].payload.lastResolutionAttempt` and
`.resolutionEvidence[].atIso`, plus
`resolutionAuthority.structuralDocumentRetrieval.startedAtIso` and
`.framingRetrieval.attemptedAtIso`. Measured with `generatedAtIso` pinned,
**28 digested paths still moved** between two renders (16× `atIso`, 10×
`lastResolutionAttempt`, 2× retrieval stamps).

**CERT Document ID.** `certPages.ts:254` depends on exactly two inputs —
`project.projectName` and `project.date` — and nothing else. It is a function of
the calendar day of render, not of the design. It is also **not injective**:
`/\//g` is a global strip with no separator or padding, so `1/22/2026` and
`12/2/2026` both render `1222026`, and `1/11/2026` and `11/1/2026` both render
`1112026`; `.substring(0,12)` collides any two names sharing 12 alphanumerics.

**Review binding.** A licensed review is bound to the digest it approved
(`reviewedDigest === meta.digest`). When the self-heal changed the digest the
review row **survived in the database** but stopped covering the served
document — the package silently became unreviewed. Nothing anywhere copies,
moves or re-binds a review across digests; that half of the design was already
correct.

---

## 9. REPLAY-HOOK INVENTORY

| Hook | Verdict |
|---|---|
| `attachPriorSnapshotDigest` (`route.ts:138`) | read-only; sets `_priorSnapshotDigest`. Removed from GET because GET no longer builds. |
| `attachPriorSnapshotDigestFromStore` (`route.ts:148`) | read-only, fail-soft; POST only. Unchanged. |
| `project.issueDate` / `input.documentIssueDate` | highest-precedence issue-date override, **no writer** — dead in production. Not wired in this pass (see §16). |
| review copy / move / re-bind across digests | **does not exist.** Correctly so. |

**No replay hook was wired into GET.** The one that would enable true replay
(`project.issueDate`) is a persistence change to the issuance path, and belongs
to a mutation workflow, not a read.

---

## 10–11. SERVICE SEPARATION AND THE WRITE BARRIER

**GET no longer builds anything.** The whole self-heal block is gone. The GET
body is now three statements:

```
SELECT id, user_id, name FROM projects …
SELECT role FROM users …
SELECT file_name, file_data FROM project_files …
```

Verified programmatically with comments stripped: no `INSERT INTO`, no `UPDATE`,
no `DELETE FROM`, no `sql.transaction`, no `resolveSnapshotAuthorityInputs(`, no
`attachParcelIfMissing(`, no `applyAerialEdgeSnapRegistration(`, no
`generatePermitHTML(`, no `upload_date`.

**The barrier** — `lib/db/readOnlySql.ts`. The GET's handle is
`readOnlySql(await getDbReady(), 'permit/GET')`, which classifies every statement
before dispatch and throws `ReadOnlyViolationError` on a mutation. It:

- fails **closed** — an unrecognised statement shape is refused, not waved through;
- catches a **data-modifying CTE** (`WITH x AS (INSERT … RETURNING …) SELECT …`),
  a write wearing a read's first keyword;
- **does not forward `transaction`** — the exact door the four-statement
  equipment reconciliation walked through. Touching it throws.
- redacts: a violation names the statement shape and context, never row data.

Deleting the self-heal fixes today. The barrier is what makes the next
convenience helper fail loudly instead of quietly.

A `ReadOnlyViolationError` escaping to the handler returns
`500 READ_PATH_WRITE_ATTEMPT` rather than looking like a database hiccup.

---

## 12. INTEGRITY-ERROR BEHAVIOUR

| Condition | Response |
|---|---|
| Artifact present | `200` + the stored bytes, unchanged |
| Artifact present but stale | `200` + the stored bytes, unchanged, staleness **disclosed** |
| Artifact missing, stored input present | `404 ISSUED_ARTIFACT_UNAVAILABLE`, `repairRequired: true` |
| Artifact and input both missing | `404 PERMIT_NOT_GENERATED` |
| A read path attempts a write | `500 READ_PATH_WRITE_ATTEMPT` |

Every response carries integrity headers: `X-Planset-Issued-Artifact: stored`,
`X-Planset-Stored-Engine-Version`, `X-Planset-Current-Engine-Version`,
`X-Planset-Stale`, and — when stale — `X-Planset-Repair` pointing at the POST.

Staleness is **reported, never repaired**. An older engine version does not make
the issued document wrong; it makes it old, and substituting a different document
is not a fix.

---

## 13–15. REGENERATION, LINEAGE AND REVIEW POLICY

Regeneration is `POST /api/engineering/permit` — authenticated, ownership-checked,
explicit. It is now the **only** path that resolves authority and builds
(asserted by test: exactly one `resolveSnapshotAuthorityInputs(` call site).

Because a regenerated package gets a new digest, and a review is bound to the
digest it approved, the existing policy already gives the required behaviour
**without any change**: the old review remains in the database bound to the old
digest, it does not cover the new one, and the new package reports
review-required until a reviewer approves that digest. Nothing copies an approval
forward.

**Scope note, stated plainly.** The brief asks that regeneration create a new
package *version* with `parentPackageId` / `SUPERSEDED` lifecycle. **There is no
package model to version.** A "package" is two `project_files` rows
(`permit_planset.html`, `permit_input.json`) keyed by
`(project_id, user_id, file_name)`; there is no packages table, no lifecycle
column and no version lineage anywhere in the schema. Building one is a schema
change, and the brief forbids Migration 119 unless WS-A uncovers a defect that
cannot be repaired in application logic. **The defect WS-A names — a read
mutating an issued package — is fully repairable in application logic, and is
repaired.** Package versioning is recorded as the correct follow-up (§16), not
smuggled in.

---

## 16. WHAT THIS PASS DOES **NOT** CLAIM

1. **Deterministic replay is still impossible through the API.** With
   `generatedAtIso` pinned, 28 digested paths still move because
   `runResolutionLifecycle` takes its own wall clock and the route passes no
   `deps`. This does not affect WS-A — a read no longer regenerates — but a
   *regeneration* of unchanged content still produces a new digest.
2. **No package version lineage exists** (§13–15). Regeneration still overwrites
   the stored artifact from POST. The old artifact is not archived.
3. **`project.issueDate` still has no writer**, so an intentional re-issue cannot
   yet preserve the original issue date by design.
4. **The CERT Document ID is still not injective** and still derives from the
   render-day date rather than the design.
5. **The rate-limit Redis write still precedes authentication.** It is an
   infrastructure counter, not canonical state, and is out of WS-A's scope —
   disclosed, not fixed.
6. **`safeDbRead` is still named "read" while accepting write closures.** No
   longer reachable from GET; still misleading on the POST path.

---

## 17–21. PROOFS

### Sequential, concurrent, timezone and clock

| Proof | Result |
|---|---|
| 100 sequential reads | **1** distinct identity, **0** writes |
| 25 concurrent reads | **1** distinct identity, **0** writes, **0** duplicate packages |
| Clock advanced 30 days | identity unchanged; issue date still `8/2/2026` |
| UTC-boundary instants (`00:30Z` vs `06:30Z` on 8/3) | identical; issue date still `8/2/2026` |
| Served bytes | **byte-identical** to the stored artifact |

### Controlled fixture

A stale issued package (`planset-version 1`, issue date `8/2/2026`, snapshot
`PDS-5A88FD0FC1D6`, digest `5a88fd0fc1d67809`, Document ID
`SP-PERMIT-ACMEPROJECT-822026`) driven through the **real handler** against a
fake database that records every statement. Braidon was **not** used as a
mutable fixture.

| | Before | After repeated GET |
|---|---|---|
| Snapshot id | `PDS-5A88FD0FC1D6` | **unchanged** |
| Digest | `5a88fd0fc1d67809` | **unchanged** |
| CERT Document ID | `SP-PERMIT-ACMEPROJECT-822026` | **unchanged** |
| Issue date / timezone | `8/2/2026` / `America/Chicago` | **unchanged** |
| Stored artifact | as issued | **unchanged** |
| Stored input | as issued | **unchanged** |
| Writes issued | — | **0** |

### The suite is non-vacuous

Removing the barrier and reintroducing a single
`UPDATE project_files SET upload_date = NOW()` into the GET fails **10 of 18**
tests by name. Restored: 18/18.

### Braidon non-mutation

Nothing was written anywhere — no database connection was opened in this pass.
All three profiles regenerate **byte-identical** to the `01d128a2` baseline:

| Profile | SHA-256 |
|---|---|
| design-review | `207f1514051ae70d…` **IDENTICAL** |
| permit | `09ab4c39976d7db3…` **IDENTICAL** |
| full | `a1f30fd853e21a22…` **IDENTICAL** |

Braidon truth: **19 sheets** (`SHEET n OF N`), 0 measurements, **4 of 5**
project-owned routes unresolved, 1 geometry-derived, 1 utility-owned excluded,
`ROUTE-LENGTH-ESTIMATE` **OPEN**, 8 × `PROVISIONAL PASS` / 0 × `VERIFIED PASS`,
D3 **48 / 48 / 15**, D4 **5** font faces. (Gates/requirements read 6/13 — this
is the frozen fixture; the live design reads 5/14. Different inputs, neither
changed to match the other.)

---

## 22–28. VALIDATION

| Check | Result |
|---|---|
| WS-A immutability suite | **18 passed** |
| Targeted D1–D4 / WS-5 / PV-4B / timezone / security (12 files) | **262 passed** |
| Full suite (`--maxWorkers 3`) | **9638 passed / 0 failed / 490 skipped**, 418 files |
| Full suite (default concurrency) | 7 errors — **machine memory exhaustion**, see below |
| Lint | **0 errors** |
| Typecheck | **exit 0** |
| Security tests | **12 passed** (secret guard) |
| Production build | **exit 0** |
| Artifact byte-identity, 3 profiles | **IDENTICAL** |
| Evidence harnesses / page-fit / PDFs / visual | **not run** — no planset or artifact code changed and all three profiles are byte-identical |
| Database connections opened | **none** |

**On the default-concurrency errors.** At full parallelism this machine reports
`VirtualAlloc failed` in the Playwright-backed BAR harness and
`Worker exited unexpectedly`. The same failure was reproduced at the `197cc7cf`
baseline with the previous pass's changes stashed. Running the identical suite at
`--maxWorkers 3` gives **zero failures**, which isolates it to memory pressure
rather than logic. Test arithmetic is consistent: 10,110 → **10,128** total
(+18, exactly the new WS-A tests).

`planset-evidence-ecd` was not run — no planset code changed. It remains
**exit 2**, pre-existing and unchanged.

### Two tests were rewritten, and why

`aac-ws1-resolver-lifecycle` and `aac-ws8-ws9-structural-lifecycle` both pinned
**GET/POST build parity** — that a self-healing GET must resolve authority the
same way POST does, asserted as "exactly 2 `resolveSnapshotAuthorityInputs`
call sites".

That invariant protected against a read producing a *different* package. It is
obsolete because a read now produces *no* package. Both were replaced with the
stronger claim they were standing in for: **exactly ONE path resolves authority
and builds**, no build omits the authority bundle, and the self-heal build is
gone for good. The count went 2 → 1 because a build path was removed, not
because an assertion was loosened.

---

## 29–31. COMMIT

| | |
|---|---|
| Files changed | `app/api/engineering/permit/route.ts`, `lib/db/readOnlySql.ts` (new), `tests/security/issued-package-read-immutability.test.ts` (new), `tests/planset/aac-ws1-resolver-lifecycle.test.ts`, `tests/planset/aac-ws8-ws9-structural-lifecycle.test.ts`, this report |
| Final commit | `<recorded at push>` |
| Push | `origin/dev`, 0 ahead / 0 behind |

> # WS-A ISSUED-PACKAGE DIGEST INTEGRITY: ACCEPTED
>
> Issued-package GET is strictly read-only, proven by a durable write barrier and
> by an 18-test suite driving the real handler against a recording database.
> Identity is stable across 100 sequential reads, 25 concurrent reads, a 30-day
> clock advance and a UTC-boundary instant. Issue date, snapshot digest, artifact
> bytes and CERT Document ID all survive reading. Licensed reviews remain bound
> to the digest they approved. Integrity failures are explicit. Regeneration is a
> separate, authorized mutation. Braidon is unchanged and all three artifact
> profiles are byte-identical. D1–D4 and WS-5 intact.
>
> Package version lineage, digest determinism and the non-injective Document ID
> are named in §16 as follow-ups, not claimed as done.
