# BRAIDON MACHINE-CLOSURE COMPLETION

**Date:** 2026-08-04 · **Repo:** `C:\Users\Ray\Solarpro Claude\repo` · **Branch:** `dev`
**Baseline commit:** `3a649ae7928b298b91173e0e4265b1caf3fec037` (verified `== origin/dev`, tracked tree clean)

---

## 1. Executive verdict

**Phase status: `BLOCKED`.**

Braidon went from **14 → 12** unresolved requirements. Four code defects were closed, one of which
the previous phase had never identified and which silently defeated the entire digest-bound
professional-review authority it had just repaired.

**Two of the five briefed defects were mis-stated, and I am not repeating them.** Verified against
source and live read-only probes:

- **#12 (migration 115 drift) does not exist.** Migration 115 creates `personnel_roles` and
  `project_personnel_assignments`. It never creates `project_personnel_roles` — that string is the
  migration's **filename**. Both real tables are live in production. My own prior-phase report
  asserted schema drift because it queried a table name inferred from a filename. There is no
  drift, and no repair migration is warranted; writing one would have been fabricated work.
- **#10 (`project-authority@v1` returns nothing) was wrong in its stated mechanism.** The resolver
  runs, performs a live Census retrieval, and populates the socket. The requirement stayed open
  because exactly one of five fields — the APN — was graded `unverified-derived`.

**Three of the five cannot be closed in code at all.** `CODE-AUTHORITY-INCOMPLETE`,
`DESIGNER-OF-RECORD-MISSING` and `MODULE-EXACT-DATASHEET-PENDING` are each blocked on **absent rows
in the production database**, confirmed by read-only query. Closing them requires a shared-live
write, which the stop-the-line prerequisite forbids while the credential is unrotated. **The
credential is unrotated** (§3). Per the brief, the database application step is reported as
security-blocked rather than performed with a known-leaked credential.

Braidon remains `PENDING ENGINEERING REVIEW` with no invented PE approval.

---

## 2. Baseline

| | value |
|---|---|
| Repository | `C:/Users/Ray/Solarpro Claude/repo` |
| Branch / HEAD | `dev` / `3a649ae7928b298b91173e0e4265b1caf3fec037` |
| `origin/dev` | `3a649ae7…` — **HEAD == origin/dev confirmed**, 0 ahead / 0 behind |
| Working tree | tracked: clean · untracked: 244 `_tmp_*` scratch files |
| Regression check | tsc exit 0 · full suite **9674 passed / 0 failed** / 490 skipped — prior phase holds |
| Braidon project id | `4030b664-bebe-433b-a11c-cda05ead2f7d` |
| Stored input snapshot | `PDS-D0A19DCAD6F1` (`d0a19dcad6f13cd0…`) |
| Review records | **0** |
| Migration ledger | 108–118 all `applied`; 118 applied 2026-08-03T20:58:19Z by a human actor |

Before artifact (full profile): `PDS-53CDD8EE720F` · `53cdd8ee720f53ae…` · 25 sheets ·
5 open gates · 14 unresolved · `PENDING ENGINEERING REVIEW` ·
`_tmp_pr_mc_before_{design-review,permit,full}.html`.

The five requirement IDs the brief targeted: `PROJECT-NAME-NONPRODUCTION` (#11),
`DESIGNER-OF-RECORD-MISSING` (#12), `CODE-AUTHORITY-INCOMPLETE` (#9),
`PROJECT-AUTHORITY-UNVERIFIED` (#10), `MODULE-EXACT-DATASHEET-PENDING` (#13).

---

## 3. Security / credential status — **NOT ROTATED**

| Check | Result |
|---|---|
| Rotated? | **NO.** SHA-256 of `.db_url` is byte-identical to the fingerprint recorded when the leak was found (`953B3159…`). Same user (`neondb_owner`), same host. |
| Old credential still authenticates? | Yes — every read-only probe in this phase used it. That is exactly why it must be rotated. |
| Printed / committed / copied? | **No.** No credential appears in this report, in any test fixture, in any script, or in any file added by this phase. Every harness reads `../.db_url` at runtime. |
| In HEAD tree? | **Clean** — not present in any tracked file at HEAD. |
| In git history? | **Yes — 4 commits** (`026db5a1`, `9ff569fd`, `2e005fba`, `b583829a`) and **3 tags** (`authority-overhaul-baseline`, `production-stable-v47.25`, `stable-v47.25`). History rewrite or credential rotation is still required. |

**Consequence, applied:** all source inspection, implementation, local tests and read-only live
diagnostics proceeded. **No shared-live database write was performed.** Every probe additionally
issued `SET default_transaction_read_only = on`.

---

## 4. Canonical-name repair (#11) — **CLOSED**

**Root cause.** `projects.name` is the project record; `engineering_config.projectName` is a mirror
written by the Engineering page's React state, and it does not round-trip — renaming a project does
not rewrite the saved config. The permit POST body carries the mirror. `app/api/engineering/permit/route.ts`
reads `projects.name` **only in the GET ownership check**; the POST path never reads it, so the
package took its whole identity from an unreconciled value: cover, title blocks, release summary,
certification, document-control id and the `Content-Disposition` filename.

Live: `projects.name` = `BRAIDON M PILLA — Solar`; `engineering_config.projectName` =
`BRAIDON M PILLA — Solar TEST`.

**Repair.** A canonical-identity correction in the permit POST path, deliberately modelled on the
`system_type` correction that already sits 40 lines above it and does the same thing against the
same table: where the authoritative project row and the posted mirror disagree, the record wins.

**Not a string fix.** Nothing removes the substring `TEST`. A project genuinely named `…TEST` keeps
its name and still fails `projectIdentityValid`. Only *which field is authoritative* changed. A
blank `projects.name` is not authority — the posted value stands and the requirement stays open.

---

## 5. Migration-115 "drift" (#12) — **NOT A DEFECT**

`lib/migrations/115_project_personnel_roles.sql` creates, in idempotent plain DDL:

- `:40` `CREATE TABLE IF NOT EXISTS personnel_roles` (+ 2 indexes)
- `:89` `CREATE TABLE IF NOT EXISTS project_personnel_assignments` (+ 3 indexes)

`project_personnel_roles` appears nowhere in the DDL. Live read-only query confirms both real
tables exist. The ledger and the schema agree; the runner is not at fault; no forward-only repair
migration is required, and I did not invent one.

**The real residual** is that `personnel_roles` has **0 rows**. `project-personnel-designer@v1` runs
and fails with the precise reason *"no designer is configured for this organisation / user, and none
is assigned to this project"*. That is an operator/data task requiring a **database write** —
security-blocked. `DESIGNER-OF-RECORD-MISSING` therefore stays open, correctly.

---

## 6. Forward-only schema repair — **NOT APPLICABLE**

No schema repair is warranted (§5). Writing a migration to create a table the system never
references would have been fabricated work presented as closure.

---

## 7. Madison County code authority (#9) — code defect fixed, requirement **DATA-BLOCKED**

**The stale note was half right.** The AHJ *binding* is correct (`il-madison-county`), but a real
"City of Granite City" defect was live in the legal-authority record.

**Root cause found and fixed.** In `buildProjectLegalAuthority`, the AHJ **name** came from
`posted.ahjName` while every consistency guard read `ahjType` from the **bound registry record**.
On an unincorporated parcel whose registry match is the COUNTY, the city-vs-unincorporated guard
cannot fire (bound type is `county`, not `city`), so a mailing-derived city name fell through to the
`else` branch and was stamped **`verified`** — under a basis sentence that simultaneously asserted
the parcel is unincorporated and the county is the authority of record.

Live before: `fields.ahjName.value` = `"City of Granite City Building & Zoning"`, state `verified`,
while `codeAuthority.ahjName` on the **same build** said `"Madison County Building & Zoning"`. One
package, two authorities, and the wrong one carried the verification stamp.

**Repair.** Where the boundary determination resolved and bound a record, that record names the AHJ.
The posted string is retained as `postedValue` and the supersession is stated in the basis, so it is
visible rather than silent. With no bound record, or an unresolved boundary, the posted value still
stands — nothing is inferred. The city-on-unincorporated conflict still raises
`confirmationRequired` rather than flipping silently.

After: `projectAuthority.ahjName` and `codeAuthority.ahjName` **both** read
`Madison County Building & Zoning`.

**Why the requirement stays open.** Read-only query of `ahj_registry`: **both** IL rows
(`il-madison-granite-city`, `il-madison-county`) carry `nec_edition = '2020'` and
`ibc_edition = irc_edition = ifc_edition = NULL`, `raw_editions = NULL`. `code-authority@v1` fails
`NON_RETRYABLE` with *"row exists but carries no adoption evidence (provenance=seeded-unprovenanced)
— a seeded/unprovenanced row may never establish an adopted edition"*. `AHJ_REGISTRY_TOKEN` is
unset, so there is no external fallback. Closing this requires **writing adoption evidence into the
registry** — a shared-live write, security-blocked.

---

## 8. `project-authority@v1` (#10) — **CLOSED**

**The briefed mechanism was wrong.** The resolver runs, retrieves live from the US Census Geocoder
(`providerUsed=census_geocoder`, `proof=live-retrieval`, `boundaryLayersResolved=true`,
`unincorporated=true`, `countySubdivision="Nameoki township"`), builds a full record, and patches it
onto the bundle. The socket was **not** null.

**Actual root cause — a provenance discard at the route seam.** `lib/aerial/parcelBoundary.ts`
registers Madison County, IL (CCAO `Parcel_Owners` ArcGIS layer) — Braidon's own county — and the
permit route calls it. The route keeps the whole parcel object, *including* `source`, on
`aerialData.parcel`, but copies **only the bare `apn` string** onto `project.apn`. The resolver
never reads `aerialData`, and its `id.parcelId` is fed solely by the ATTOM→Census→Nominatim chain,
of which only ATTOM publishes an APN (`ATTOM_API_KEY` unset). So an APN retrieved live from the
assessor of record arrived at the grader **indistinguishable from a keystroke** and was graded
`unverified-derived` under the basis *"the posted APN was not confirmed against a parcel source
(no ATTOM key / no parcel record)"* — a sentence that was false for this parcel, printed as the
blocking reason, alongside an operator action telling Ray to buy a metered ATTOM credential to
re-retrieve a fact the repo already obtains for free.

**Repair.** The county-GIS parcel retrieval is threaded into the resolver as a first-class parcel
source carrying its own `source` attribution. **No grading rule was changed and no veto was
narrowed.** The existing `verified` branch now fires on real evidence. The APN is attributed to
`Madison County IL CCAO`, never to `census_geocoder`.

**A latent hole closed with it:** the record stamped a retrieved parcel id `verified` without ever
comparing it to the posted one. A retrieval that *contradicts* the project record now raises
`confirmationRequired` — the same treatment the county mismatch already gets.

After: all five fields `verified`, `record.verified = true`, `PROJECT-AUTHORITY-UNVERIFIED` closed.

---

## 9. Module-datasheet consumption (#13) — systemic defect fixed, requirement **DATA-BLOCKED**

**Root cause — and it was far larger than the module datasheet.** The registry `push` helper in
`buildPermitDesignSnapshot` terminated **every** record with the literals `resolved: false` and
`resolutionAuditRef: null`. The lifecycle's resolution state — which carries `.cleared` and
`.resolutionAuditRef`, and whose type comment literally names the `deriveRequirementStatus`
contract — is in scope **18 lines above** and was consumed *only* to decorate the rendered payload
with prose.

`deriveRequirementStatus` returns `OPEN` whenever `!r.resolved`. So **no resolver clearance in the
entire system could ever close a requirement.** `module-datasheet-binding@v1` reads `allBound` — the
only production read of it — returns `RESOLVED` with an audit reference, the lifecycle marks the
requirement `cleared`… and the artifact still shipped it OPEN. This is the same defect class as the
review-coverage circularity: an authority is computed and discarded at the consumer.

The existing WS-2 test concealed it by asserting closure against a **hand-built object literal**
(`deriveRequirementStatus({ resolved: true, … })`) instead of the real
`snap.permitReadiness.registry`.

**Repair.** The record now carries the lifecycle's verdict, fail-closed on the *same two-part*
predicate the gate applies — a `cleared` flag with no audit reference is not a clearance — so the
registry can never claim a resolution the gate would reject. Verified by test that a clearance
cannot release `ENGINEERING-REVIEW-PENDING`: professional approval remains decided solely by
`decideReviewCoverage`.

**Why the requirement stays open.** Read-only query of `manufacturer_document_registry`: it holds
`climate_hazard_dataset` ×1, `racking_installation_manual` ×1, `structural_pe_letter` ×2 — and
**zero `module_datasheet` rows**. The live binding reports `state=RANGE-COVERED`,
`boundDoc=null`: the on-file series document covers 385–405 W and the selected 400 W falls inside
that range, but *no registry binding names the exact 400 W page/column*. Closing this requires
**writing a document row** — security-blocked. The wiring is now correct and will close it the
moment the binding exists.

---

## 10. §0 — the defect nobody had found: **the digest moved every time**

Not in the brief. Found by testing the previous phase's own guarantee.

Two consecutive live regenerations of the **unchanged** Braidon design produced **different
digests**. A structured diff over the two snapshots: **30 leaf differences, every one a wall-clock
timestamp of the resolution attempt** — `resolutionEvidence[].atIso` ×15,
`lastResolutionAttempt` ×10, `retrievedAtIso` ×2, `startedAtIso`, `attemptedAtIso`,
`projectLegalAuthority.retrievedAtIso`. No geometry, no equipment, no authority values.

This **defeated the entire digest-bound professional-review authority repaired in the previous
phase**: a PE approves digest `D`, the operator regenerates twenty seconds later, the digest is
`D′`, and the approval is dropped as "stale" by the very mechanism built to protect it. The prior
phase's determinism guarantee was proven only on a fixture, where no resolver lifecycle runs.

**Repair.** `computeSnapshotDigest` now normalises run-instant provenance to a constant before
hashing — the same principle as the existing `meta.digest`/`meta.snapshotId` exclusions. The values
stay in the stored snapshot; only the *identity* computation ignores them. The key set is **exactly**
the five measured to vary — `capturedAtIso` is deliberately excluded because it did **not** vary, and
excluding a stable field would move every existing digest for no reason.

The durable guarantee is the test, not the list: `mcc-machine-closure.test.ts §0` builds the same
design twice and compares, so any future run-instant field fails the suite.

**Verified after:** two consecutive live regenerations → **identical digest**.

---

## 11. Files changed

| File | Change |
|---|---|
| `lib/permit/snapshot/digest.ts` | §0 — run-instant provenance excluded from the design digest |
| `lib/permit/snapshot/build.ts` | §1 — registry records carry the lifecycle clearance, fail-closed on the gate's own predicate |
| `app/api/engineering/permit/route.ts` | §2 — canonical `projects.name` corrects the stale config mirror |
| `lib/permit/snapshot/resolution/jurisdictionAuthority.ts` | §3 — AHJ name from the bound record; §4 — county-GIS parcel accepted as a parcel source, with contradiction handling |
| `lib/permit/snapshot/resolution/jurisdictionResolvers.ts` | §4 — threads `aerialData.parcel` into the resolver with its `source` |
| `tests/planset/mcc-machine-closure.test.ts` | **NEW** — 19 tests |

---

## 12. Migrations applied

**None.** §5 establishes that no migration was warranted. Live application of any migration remains
security-blocked pending credential rotation (§3).

---

## 13. Tests added — 19, all passing

- **§0 determinism (4):** identical digest across differing run instants; a real design change still
  moves it; `null` is not collapsed into the sentinel; **live end-to-end determinism**.
- **§1 clearance (5):** no lifecycle ⇒ unresolved; cleared + audit ref ⇒ resolved and blocker
  dropped; cleared without a ref ⇒ **not** a clearance (3 blank forms); ref without cleared ⇒ not a
  clearance; **a clearance cannot release the professional review requirement**.
- **§3 AHJ (4):** bound county record supersedes posted mailing city; a city record on an
  unincorporated parcel still raises the conflict; unresolved boundary ⇒ posted stands unverified;
  no bound record ⇒ nothing invented.
- **§4 APN (6):** no retrieval ⇒ unchanged; agreeing county-GIS retrieval verifies **and is
  attributed to that layer**; contradiction ⇒ conflict, not a flip; unnamed source cannot verify;
  ATTOM still wins with its own attribution; retrieval verifies an APN the record lacks.

---

## 14. Full test results

`npx vitest run --maxWorkers 3` → **9693 passed · 0 failed · 490 skipped (10183)**, 419 files.
(Baseline was 9674; +19 new.) TypeScript `npx tsc --noEmit` → exit 0.

---

## 15. Build result

`npm run build` → see §19. Requires `NODE_OPTIONS=--max-old-space-size=8192` on this machine;
at the default heap the Next.js build worker dies `0xC0000409` during static generation
(environmental, pre-existing, unaffected by this change).

---

## 16. Live Braidon before / after

| | BEFORE | AFTER |
|---|---|---|
| Commit | `3a649ae7` | this phase |
| Snapshot (full) | `PDS-53CDD8EE720F` | `PDS-0456B0F2F32F` |
| Digest (full) | `53cdd8ee720f53ae…` | `0456b0f2f32f1cdb…` |
| **Regeneration determinism** | **different digest every run** | **identical across runs** |
| Project name | `BRAIDON M PILLA — Solar TEST` | **`BRAIDON M PILLA — Solar`** |
| AHJ (legal authority record) | `City of Granite City Building & Zoning` *(stamped verified)* | **`Madison County Building & Zoning`** |
| AHJ (code authority) | `Madison County Building & Zoning` | `Madison County Building & Zoning` *(now agree)* |
| Adopted codes | NEC 2020; IBC/IRC/IFC PENDING | unchanged — registry rows carry no editions |
| `project-authority@v1` | socket populated, `verified=false` (APN) | **`verified=true`, all 5 fields verified** |
| APN | `unverified-derived` | **`verified`, source `Madison County IL CCAO`** |
| Module identity | Q CELLS Q.PEAK DUO BLK ML-G10+ 400 W | unchanged |
| Datasheet evidence | `RANGE-COVERED`, `boundDoc=null` | unchanged — zero `module_datasheet` rows |
| Personnel schema | `personnel_roles` + `project_personnel_assignments` **exist**, 0 rows | unchanged |
| Designer | — (blank) | — (blank) |
| Engineer of Record | none; PE-1 pending template | unchanged — **no PE approval invented** |
| Release profile | design-review / permit / full | unchanged |
| Sheets | 25 / 18 / 19 | 25 / 18 / 19 |
| Open gates | 5 | 5 |
| **Unresolved requirements** | **14** | **12** |
| Release state | `PENDING ENGINEERING REVIEW` | `PENDING ENGINEERING REVIEW` |
| Artifact | `_tmp_pr_mc_before_*.html` | `_tmp_pr_mc_c_*.html`, `_tmp_mc_shots/braidon_after.pdf` |

**Every count change by requirement ID:**

- **−1 `PROJECT-NAME-NONPRODUCTION`** — closed by §4 (canonical project identity).
- **−1 `PROJECT-AUTHORITY-UNVERIFIED`** — closed by §8 (APN provenance threaded; all five legal
  fields verified).
- No other count changed. RG-1 PROJECT & AHJ AUTHORITY dropped from 3 requirements to 1; the
  remaining gate count is 5 because each of the other four gates still holds ≥1 requirement.

---

## 17. Remaining requirements (12)

**Machine-closable but DATA-blocked — require a shared-live DB write (security-blocked, §3):**

| ID | What must be written |
|---|---|
| `CODE-AUTHORITY-INCOMPLETE` | IBC/IRC/IFC adoption evidence for `il-madison-county` in `ahj_registry` (all edition columns are NULL; `AHJ_REGISTRY_TOKEN` unset so no external fallback) |
| `DESIGNER-OF-RECORD-MISSING` | a `personnel_roles` row for role `designer` in this scope (table exists, 0 rows) |
| `MODULE-EXACT-DATASHEET-PENDING` | a `module_datasheet` registry row naming the exact 400 W page/column (0 such rows exist) |

**Operator / procurement decisions (bounded, not research):**

| ID | Residual |
|---|---|
| `PENDING-RACKING-ASSEMBLY-SELECTION` | RT-MINI carries no rail; all three stores probed. Candidates are span-screened and listed; choosing between compatible manufacturers is a design + procurement decision |
| `FASTENER-ASSEMBLY-UNVERIFIED`, `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED`, `RACKING-CAPACITY-APPLICABILITY-GAP`, `EQUIPMENT-DOCUMENT-APPLICABILITY` | one bounded confirmation: the published stamped letter covers **RT-MINI II**, the selected mount is **RT-MINI**. Either confirm through the registry that it governs the hardware installed, or select RT-MINI II |

**Genuinely physical (field):** `ROUTE-LENGTH-ESTIMATE` (4 named runs with no routed CAD geometry;
1 run is geometry-derived and not blocked; the utility-owned run is correctly excluded),
`TAP-CONDUCTOR-LENGTH-PENDING` (supply-side tap inside existing service equipment).

**Licensed professional:** `FRAMING-AUTHORITY-UNVERIFIED` (every retrievable framing-capacity class
is building-specific and unpublished), `ENGINEERING-REVIEW-PENDING` (the PE approval — now
recordable, effective, **and no longer destroyed by regeneration**, §10).

---

## 18. Visual audit

Rendered under print media at 17×11 in via `scripts/ws5-pdf-and-shots.mjs` (Chromium):
`_tmp_mc_shots/braidon_after.pdf` + 25 per-sheet PNGs.

| Check | Result |
|---|---|
| All sheets present | ✅ 25/25 |
| **SLD complete, unclipped** | ✅ E-1 renders the full chain PV array → roof J-box → AC combiner → AC disconnect → MSP → utility meter with EGC bus, 6 callouts, legend and 3 data tables |
| **PE-1 complete** | ✅ project info, PV parameters, roof construction, ASCE 7-22 analysis, certification statement, PE-of-record block (blank — correct, unapproved) |
| Cover sheet | ✅ release banner now reads **12** unresolved; RG-1 shows **(1 REQ)** |
| Project name on sheets | ✅ **`BRAIDON M PILLA — Solar`** — the `TEST` identity is gone from cover, title blocks and document control |
| APN on sheets | ✅ `17-2-20-13-04-401-003` |
| AHJ on sheets | ✅ `Madison County Building & Zoning`, consistent across cover, title blocks and PE-1 |
| Designer | ❌ blank — `DESIGNER-OF-RECORD-MISSING` (data-blocked) |
| Governing codes | ⚠️ `IBC PENDING · IRC PENDING · IFC PENDING` — truthful; `CODE-AUTHORITY-INCOMPLETE` (data-blocked) |
| Falsely claims approval | ✅ no — still `PENDING ENGINEERING REVIEW`, `NOT FOR PERMIT SUBMISSION` |
| Text/geometry clipping | ✅ none observed |

---

## 19–20. Final artifact / commit / push

*(recorded below on completion)*

---

## Acceptance against the brief

| Target | Status |
|---|---|
| Canonical project identity used throughout | ✅ |
| `Solar TEST` gone because source authority corrected (not string-manipulated) | ✅ |
| Migration drift repaired with a forward-only migration | **N/A — no drift exists (§5)** |
| `project_personnel_roles` exists and is exercised | **N/A — never a table; the real tables exist (§5)** |
| Madison County code editions supported by authoritative evidence | ❌ **DATA-BLOCKED** — registry rows carry no editions; write forbidden while credential unrotated |
| `project-authority@v1` resolves and persists applicable authority | ✅ |
| Exact module datasheet binding consumed by release authority | ✅ **wiring closed**; ❌ requirement DATA-BLOCKED — zero `module_datasheet` rows |
| Every machine-closable Braidon requirement closed | ❌ **3 remain, all DB-write-blocked** |
| No invented PE approval | ✅ |
| Full planset visually inspected · SLD complete · PE-1 complete · no missing sheets | ✅ |
| TypeScript · focused tests · full suite · production build | ✅ / ✅ / ✅ (9693/0) / see §19 |
| Committed and pushed to `origin/dev` · `HEAD == origin/dev` | see §19 |

**Next executable step:** rotate the `neondb_owner` credential (and purge it from the 4 commits and
3 tags in §3). That single action unblocks all three remaining machine-closable requirements.
