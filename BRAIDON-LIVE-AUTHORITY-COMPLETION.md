# BRAIDON LIVE AUTHORITY COMPLETION

**Date:** 2026-08-04 · **Repo:** `C:\Users\Ray\Solarpro Claude\repo` · **Branch:** `dev`
**Baseline commit:** `9005884d7e67107ab4b5917494f94f0c5c7a95f1` (verified `== origin/dev`, tracked tree clean)

---

## 1. Executive verdict

**Phase status: `BLOCKED` — on credential rotation.**

Every baseline claim was verified from the repository and live runtime, not taken on report.
Tasks 1–4 are complete. Tasks 5–7 are complete as source work and dry-run specification but their
**write step is security-blocked**: the `neondb_owner` credential is **still unrotated** (§3), and
the brief forbids shared-live writes until it is.

The 12-item ledger surfaced **two defects the brief did not know about**, both of the class it
warned against — "may not remain blocked by … unwired evidence … or registry lifecycle defects":

- **The entire WS-5 field-measurement feature was unreachable in production**, read *and* write.
  `ROUTE-LENGTH-ESTIMATE` was reporting "the field-measurement store could not be read", which reads
  as *nobody measured* but actually meant *this feature cannot be used at all*. Repaired.
- **A latent digest-nondeterminism reintroduction.** The audit reference a clearing resolver writes
  embeds a wall-clock instant, and that string is digested. It had never fired because nothing has
  ever been cleared — the first genuine clearance would have been the first one, silently undoing
  the MCC §0 repair. Repaired before it could fire.

Braidon remains at **12** unresolved requirements. No requirement closed in this phase, because
every remaining machine-closable one is blocked on a database write. That is the honest outcome:
the phase removed two blockers *behind* the requirements without being able to write the data
*in front* of them.

**A release consequence worth stating plainly:** Braidon is **not** "ready for immediate release
once a PE approves". Proved live in §6 — with the designer blank, a valid current-digest approval
does not merely fail to release, it makes generation **throw** (V37, §15d). The designer row is in
`personnel_roles`, which is empty, which needs a write.

---

## 2. Repository baseline — every claim verified

| Claim | Verified |
|---|---|
| Branch `dev`, commit `9005884d` | ✅ |
| Push completed · `HEAD == origin/dev` | ✅ 0 ahead / 0 behind |
| TypeScript clean | ✅ exit 0 |
| Full suite `9693 passed, 0 failed` | ✅ re-run: 9693 / 0 |
| Production build `91/91` | ✅ (needs `NODE_OPTIONS=--max-old-space-size=8192`) |
| Live planset 25 sheets | ✅ 25 / 18 / 19 (full / permit / design-review) |
| Project name `BRAIDON M PILLA — Solar` | ✅ zero `Solar TEST` in the package |
| AHJ Madison County | ✅ 32 references, zero `Granite City Building` |
| APN bound | ✅ `17-2-20-13-04-401-003`, 27 consistent references |
| Unresolved `12`, reduced from `14` | ✅ |
| RG-1 reduced to one requirement | ✅ (RS-1: `1 of 1`) |
| `PENDING ENGINEERING REVIEW`, no invented PE | ✅ |

Working tree clean (tracked); 244 untracked `_tmp_*` scratch files preserved.

---

## 3. Credential status — **NOT ROTATED**, redacted

| Check | Result |
|---|---|
| Rotated? | **NO.** SHA-256 fingerprint of the active connection string is byte-identical to the one recorded when the leak was found. Same user (`neondb_owner`), same host. |
| Value printed anywhere? | **No.** Not in this report, source, tests, fixtures, logs or artifacts. Every harness reads `../.db_url` at runtime; only a truncated fingerprint and the host suffix were ever emitted. |
| Old credential revoked? | **No** — it still authenticates, which is precisely the finding. |
| Writes performed | **ZERO.** Every probe issued `SET default_transaction_read_only = on` immediately after connect. No INSERT/UPDATE/DELETE/DDL was executed by me or by any subagent. |
| Still in history | 4 commits + 3 tags (unchanged from the previous phase). |

**Consequence:** Tasks 5–7 are delivered as source work + dry-run specifications. The database
application step is reported as **security-blocked**.

---

## 4. The complete twelve-item ledger

Gate mapping read directly off the rendered RS-1 sheet (RG-3 and RG-6 are CLEARED):
RG-1 `1` + RG-2 `1` + RG-4 `6` + RG-5 `2` + RG-7 `2` = **12**.

| # | Requirement | Gate | Live reason (verbatim, abridged) | Resolver | Consumed? | Class | Effect | Closure action |
|---|---|---|---|---|---|---|---|---|
| 1 | `ROUTE-LENGTH-ESTIMATE` | RG-5 | *"the field-measurement store could not be read"* — 42P01 `organization_members` | `route-length@v1` + `field-route-measurement@v1`, both implemented | ✅ (BOM, VD, procurement) | **MACHINE_CLOSABLE → now FIELD_VERIFICATION** | RELEASE_CRITICAL | §5 repaired the reachability; 4 named runs now genuinely need measuring |
| 2 | `TAP-CONDUCTOR-LENGTH-PENDING` | RG-5 | supply-side tap length unmeasured; NEC 705.11(C) ≤10 ft unevaluable | none | ✅ | FIELD_VERIFICATION | RELEASE_CRITICAL | measure the tap run (inside existing service equipment) |
| 3 | `FRAMING-AUTHORITY-UNVERIFIED` | RG-4 | *"every retrievable framing-capacity class is building-specific and unpublished"* | `framing-capacity-document@v1` | ✅ | LICENSED_PROFESSIONAL_REQUIRED | RELEASE_CRITICAL | stamped analysis, or an archived truss drawing |
| 4 | `PENDING-RACKING-ASSEMBLY-SELECTION` | RG-4 | RT-MINI carries no rail; project, design and equipment stores all probed | `racking-assembly-selection@v1` | ✅ | MACHINE_CLOSABLE *(operator selection)* | RELEASE_CRITICAL | record a rail SKU from the span-screened shortlist |
| 5 | `FASTENER-ASSEMBLY-UNVERIFIED` | RG-4 | cited source is a flashing/water-resistance ESR, not fastener authority | `racking-documents@v1` | ✅ | MACHINE_CLOSABLE | RELEASE_CRITICAL | bind a fastener-installation document for the exact mount |
| 6 | `EQUIPMENT-DOCUMENT-APPLICABILITY` | RG-4 | document covers **RT-MINI II**, selected mount is **RT-MINI** | `racking-documents@v1` | ✅ | MACHINE_CLOSABLE | RELEASE_CRITICAL | confirm applicability through the registry, or select RT-MINI II |
| 7 | `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED` | RG-4 | 600 lb allowable cites a PE letter not archived (`documentHash` null) | `racking-documents@v1` | ✅ | MACHINE_CLOSABLE | RELEASE_CRITICAL | archive + hash-bind the capacity letter |
| 8 | `RACKING-CAPACITY-APPLICABILITY-GAP` | RG-4 | source is ASCE 7-10 / KY; jurisdiction not confirmed for this AHJ | `racking-documents@v1` | ✅ | MACHINE_CLOSABLE | RELEASE_CRITICAL | confirm jurisdictional applicability |
| 9 | `CODE-AUTHORITY-INCOMPLETE` | RG-1 | *"row exists but carries no adoption evidence (provenance=seeded-unprovenanced)"* | `code-authority@v1` | ✅ | **MACHINE_CLOSABLE** | RELEASE_CRITICAL | **DB WRITE** — §8 |
| 10 | `DESIGNER-OF-RECORD-MISSING` | RG-7 | *"no designer is configured for this organisation / user"* | `project-personnel-designer@v1` | ✅ | **MACHINE_CLOSABLE** | RELEASE_CRITICAL | **DB WRITE** — §9 |
| 11 | `MODULE-EXACT-DATASHEET-PENDING` | RG-2 | series doc covers 385–405 W; *"no registry binding names"* the exact 400 W page/column | `module-datasheet-binding@v1` | ⚠️ now consumed (MCC §1) but no row exists | **MACHINE_CLOSABLE** | RELEASE_CRITICAL | **DB WRITE** — §10 |
| 12 | `ENGINEERING-REVIEW-PENDING` | RG-7 | no approved record covering the current design digest | none (professional) | ✅ | LICENSED_PROFESSIONAL_REQUIRED | RELEASE_CRITICAL | a PE approves the current digest |

Each classification was independently adversarially verified. Two verdicts were `refuted` on
*mechanism wording* (#4, #8) while the outcome stood; #1's `MACHINE_CLOSABLE` was upheld and drove
the §5 repair.

---

## 5. Field-measurement reachability — **the feature was dead, read and write**

`organization_members` is created by `lib/migrations/105_organization_authority_foundation.sql:67`.
**It does not exist in production** (verified read-only across all schemas). Migration 118 — the
feature's *own* table — is applied and correct.

`lib/fieldMeasurement/permitAccess.ts` queried it **unconditionally**, and the legacy `users.org_id`
fallback ran only when that query **returned no rows** — so a **throw** skipped the fallback
entirely. The 42P01 propagated to `safeDbRead`, the authority resolved to `unavailable` rather than
`empty`, and the requirement reported *"could not be read"*.

The same preemption sat in `lib/fieldMeasurement/capabilities.ts` `getOrgMembership`, through which
**every** WS-5 write endpoint resolves its actor — so the record/verify workflow 503'd before
reaching its own table. `getSelfVerificationPolicy` then read `organizations.settings`, a column the
same unapplied migration adds (42703). **No amount of field work could have closed this
requirement.**

The fallback already had what it needed: Braidon's owner carries a real `users.org_id`.

**Repaired.** A missing *optional* membership table now degrades to the legacy pointer exactly as an
empty result does. Only `42P01` (absence) degrades — any other fault still throws and is still
reported as evidence. The settings read fails closed to "self-verification not permitted", which is
what that function already documents.

**Live effect:** the authority now resolves *readable, holding no measurement*, and the requirement
states the honest residual — 4 named runs need measuring, `BRANCH_RUN` is geometry-derived and not
blocked, `MSP_TO_UTILITY_RUN` is correctly excluded as utility-owned.

**Also found:** the operator was misdirected. `registry.ts` appends a hardcoded
*"[table absent — migration 113/114 not run]"* to **any** 42P01 (113 and 114 are applied), and the
resolver's operator action says *"run migration 118"* (applied) — while the actually-missing
migration 105 has no console button at all. Recorded, not repaired: it is a message defect, and the
console-catalog change belongs with the migration-105 application.

---

## 6. Digest determinism — three-run live proof

Run via `_tmp_la_determinism.ts` against production, read-only, with real wall-clock separation and
three independent resolver-lifecycle runs. **All 20 checks pass.**

```
A digest: cb9f353b4deac7d2319222dee3b1afd3be42e8d679b3dcc6dace39b0401fcf0e
B digest: cb9f353b4deac7d2319222dee3b1afd3be42e8d679b3dcc6dace39b0401fcf0e
C digest: cb9f353b4deac7d2319222dee3b1afd3be42e8d679b3dcc6dace39b0401fcf0e
```

- **A = B = C**, snapshot id `PDS-CB9F353B4DEA` stable.
- **The timestamps genuinely still move** — 31 run-instant values present in the stored snapshot,
  and they **differ** between A and C. The digest is stable by *exclusion*, not by freezing.
- **Nothing but run-instants differs** — 28 A→C leaf diffs, every one a run-instant. No authority
  was silently discarded to stabilise the digest.
- **Material authority still present**: `projectLegalAuthority.verified = true`, APN `verified` via
  `Madison County IL CCAO`, registry intact, unresolved count stable.
- **A real design change moves the digest**; **reverting restores it exactly**.
- **Approval survives no-op regeneration** and **goes stale on a design change**, with certification
  failing closed.
- **Assigning a designer moves the digest** — correct: the designer is project authority.

**§6b — the latent reintroduction, found and killed before it fired.**
`buildResolutionAuditRef` returns `…@<iso>`, and that string lands on the **digested**
`resolutionAuditRef`. `RUN_INSTANT_KEYS` matched by key name only and contained neither
`resolutionAuditRef` nor `auditRef`. It had never fired because **zero** requirements are cleared on
live — the module-datasheet binding would have been the first, and would have silently reinstated
the exact regenerate-and-the-approval-goes-stale defect MCC §0 removed.

Repaired by normalising **only the trailing instant** inside the reference. The resolver id and the
`document:` / `sha256:` references stay in the digest, so binding a *different* document still
changes it — proven by test.

---

## 7. Registry-resolution propagation audit

`tests/planset/la-registry-propagation.test.ts` — 9 tests, through the **real** construction path
(`generatePermitHTML` → `buildPermitDesignSnapshot` → `projectReleaseGates`), deliberately **not**
hand-built literals, because a hand-built literal is exactly how the original defect hid
(`aac-ws2` asserted closure against an object it constructed itself and passed while the artifact
shipped OPEN).

Proven: a successful lifecycle produces `resolved: true` and clears the gate's
`unresolvedRequirementCodes`; an unsuccessful one stays `false` and RG-2 stays OPEN;
`deriveRequirementStatus` consumes the real state; the result survives JSON round-trip **and**
regeneration; no vacuous clearance (3 blank-ref forms refused); an audit ref without `cleared` is
refused; the frozen snapshot prevents downstream overwrite; clearance does not leak to neighbours;
and **a clearance can never stand in for the licensed review**.

---

## 8. Madison County code authority — **specified, write-blocked**

Governed path: `ahj_registry` (migration 117), written **only** through `upsertAhjRegistryRow`,
reachable from the governed admin API `POST /api/admin/ahj-registry {op:'verify'}` and the resolver.
**No ad-hoc SQL** — a governed service exists.

Live state (read-only): both IL rows carry `nec_edition='2020'` and
`ibc_edition = irc_edition = ifc_edition = NULL`, `raw_editions = NULL`. `AHJ_REGISTRY_TOKEN` is
unset, so there is no external retrieval fallback.

The resolver refuses `provenance='seeded-unprovenanced'` rows — a row must carry real adoption
evidence (ordinance identity, effective date, source, retrieval date, fingerprint) to establish an
edition. **I did not invent editions.** Determining Madison County's adopted IBC/IRC/IFC requires
retrieving the county's adoption ordinance from an authoritative source, which is the operator step
that must accompany the write.

---

## 9. Personnel-role authority — **specified, write-blocked**

Migration 115 creates `personnel_roles` and `project_personnel_assignments` (both live, **0 rows**).
`project_personnel_roles` is the migration's *filename* — the previous phase's correction stands.

`project-personnel-designer@v1` fails with *"no designer is configured for this organisation / user,
and none is assigned to this project"*. It requires a default `designer` row scoped to the owning
org/user.

**I did not fabricate a person.** The required human information is: the real designer's name and
the org/user scope. Braidon has no stored designer identity to bind — `engineering_config.designer`
is empty and no assignment exists. **The exact human action required:** Ray assigns a real designer
of record to the Braidon project (or configures an org default) through the governed personnel path.

Confirmed by test and by the release-authority repair: **a personnel assignment can never satisfy
the PE review gate** — that is decided solely by `decideReviewCoverage`.

---

## 10. Module datasheet authority — **specified, write-blocked**

Zero `module_datasheet` rows exist. The live binding reports `state=RANGE-COVERED`,
`boundDoc=null`: the on-file series document covers 385–405 W and the selected 400 W falls inside
that range, but no registry binding names the exact 400 W page/column.

Governed path: `POST /api/admin/document-registry` then operator `verify`. Note the console has
**no generic create form** — only an RT-MINI structural ingest form — so step 1 currently needs an
authenticated API call rather than a console action. Recorded as a gap.

**Three things must be established by a human before any write, and none may be invented:** which of
two conflicting Qcells datasheet URLs is authoritative, the SHA-256 of those exact archived bytes,
and the actual page/column carrying the 400 W STC values with its revision and publication date.

**A code change must land with the data** (or before it): §6b, already repaired here — without it,
this binding would be the first cleared-with-audit-ref requirement and would destabilise the digest.

---

## 11. Database writes performed

**None.** All read-only, `SET default_transaction_read_only = on`.

---

## 12. Before / after

| | Before (`9005884d`) | After |
|---|---|---|
| Unresolved requirements | 12 | **12** |
| Open gates | 5 | 5 |
| Sheets | 25 / 18 / 19 | 25 / 18 / 19 |
| Release state | `PENDING ENGINEERING REVIEW` | unchanged |
| Field-measurement feature | **unreachable (read + write, 42P01)** | **reachable; residual is genuine field work** |
| `ROUTE-LENGTH-ESTIMATE` reason | *"store could not be read"* | *"4 of 5 runs have no routed geometry… require a field-measured route"* |
| Audit-ref digest hazard | latent, unguarded | **repaired + tested** |
| Canonical-name route coverage | none | **6 route-level tests** |
| Registry propagation coverage | helper-level only | **9 end-to-end tests** |
| Live 3-run determinism | unproven on the live path | **proven, 20 checks** |

No requirement changed state: every remaining machine-closable one is blocked on a write.

---

## 13–15. Remaining requirements

**Machine, DB-write-blocked (3):** `CODE-AUTHORITY-INCOMPLETE`, `DESIGNER-OF-RECORD-MISSING`,
`MODULE-EXACT-DATASHEET-PENDING`.

**Machine, operator decision (5):** `PENDING-RACKING-ASSEMBLY-SELECTION`,
`FASTENER-ASSEMBLY-UNVERIFIED`, `EQUIPMENT-DOCUMENT-APPLICABILITY`,
`RACKING-CAPACITY-SOURCE-NOT-ARCHIVED`, `RACKING-CAPACITY-APPLICABILITY-GAP` — one bounded
RT-MINI-vs-RT-MINI-II applicability confirmation plus a rail SKU.

**Field (2):** `ROUTE-LENGTH-ESTIMATE` (4 named runs — *now actually recordable*),
`TAP-CONDUCTOR-LENGTH-PENDING`.

**Licensed professional (2):** `FRAMING-AUTHORITY-UNVERIFIED`, `ENGINEERING-REVIEW-PENDING`.

---

## 16. Visual audit — all 25 sheets

Rendered under print media at 17×11 in; `_tmp_la_shots/braidon_final.pdf` + 25 PNGs. Every sheet
audited individually (automated invariants over each `.page` container, plus direct inspection of
PV-0, RS-1, E-1, PE-1, CERT).

| Check | Result |
|---|---|
| Sheets present | ✅ 25/25 |
| Stale test suffix | ✅ **0** occurrences of `Solar TEST` |
| APN present + consistent | ✅ 27 references, all identical |
| AHJ Madison County | ✅ 32 references; **0** `Granite City Building` |
| Adopted codes consistent | ⚠️ `IBC/IRC/IFC PENDING` on every sheet — truthful (§8) |
| SLD complete, unclipped | ✅ E-1 full chain + EGC bus + 3 data tables |
| PE-1 complete | ✅ |
| Snapshot identity | ✅ 1 distinct snapshot id across all sheets |
| False `ISSUED FOR PERMIT` | ✅ absent |
| Text clipping | ✅ none detected |
| Designer identity truthful | ✅ blank, because none is assigned |
| EOR state truthful | ✅ pending, no invented professional |
| Regeneration stability | ✅ §6 |

---

## 17–19. Verification

| Check | Result |
|---|---|
| Canonical-name route test | ✅ 6/6 |
| Digest-determinism (live, 3-run) | ✅ 20/20 checks |
| Digest-determinism (unit + audit-ref) | ✅ included below |
| Registry-resolution integration | ✅ 9/9 |
| Field-measurement reachability | ✅ 6/6 |
| Full suite | see §20 |
| TypeScript | ✅ exit 0 |
| Production build | see §20 |

---

## 20–23. Suite / build / commit / push

- **Full suite:** `npx vitest run --maxWorkers 3` → **9714 passed · 0 failed · 490 skipped (10204)**
  (baseline 9693; +21 new).
- **TypeScript:** `npx tsc --noEmit` → exit 0.
- **Production build:** `npm run build` → `Compiled successfully` · `Generating static pages (91/91)`
  · exit 0 (with `NODE_OPTIONS=--max-old-space-size=8192`).
- **Commit:** `c8f0604aed005e8693f870022cccbd66ef07a824` (7 files, +868 / −25).
- **Push:** `9005884d..c8f0604a  dev -> dev`.
- **`HEAD == origin/dev`:** ✅ both `c8f0604aed005e8693f870022cccbd66ef07a824` after `git fetch --prune`.
- **Final artifact:** `_tmp_la_shots/braidon_final.pdf` (25 sheets) +
  `_tmp_la_shots/braidon_final_shots/*.png`; snapshots `_tmp_pr_la_after_*.{html,snapshot.json}`;
  determinism evidence `_tmp_la_determinism.json`.

### Reproduce

```bash
npx tsx _tmp_la_determinism.ts                    # three-run live determinism proof (read-only)
npx vitest run tests/planset/la-canonical-name-route.test.ts
npx vitest run tests/planset/la-registry-propagation.test.ts
npx vitest run tests/planset/la-field-measurement-reachability.test.ts
npx vitest run --maxWorkers 3
node scripts/ws5-pdf-and-shots.mjs _tmp_pr_la_after_full.html _tmp_la_shots/braidon_final
NODE_OPTIONS=--max-old-space-size=8192 npm run build
```

---

## Acceptance

| Condition | Status |
|---|---|
| Replacement credential active, leaked one revoked | ❌ **NOT ROTATED** |
| All twelve requirements individually accounted for | ✅ §4 |
| Every machine-closable requirement closed | ❌ 3 DB-write-blocked, 5 operator-decision |
| Digest determinism proven by repeated live regeneration | ✅ §6 |
| Resolver lifecycle results can close requirements | ✅ §7 |
| Canonical-name POST route has direct regression coverage | ✅ §17 |
| Madison County code authority populated and consumed | ❌ write-blocked |
| Personnel roles populated and consumed | ❌ write-blocked |
| Exact module datasheet populated and consumed | ❌ write-blocked (consumption path repaired) |
| No professional identity or approval fabricated | ✅ |
| Braidon pending only for proven human/field authority | ❌ — 3 requirements still await data, not judgement |
| 25 sheets visually inspected | ✅ |
| Full suite / TypeScript / build | ✅ §20 |
| Committed, pushed, `HEAD == origin/dev` | ✅ §20 |

**Next executable action:** rotate `neondb_owner` and purge it from the 4 commits and 3 tags. That
one action unblocks all three DB-backed requirements, and with them the designer row that V37
currently requires before any PE approval can release the package.
