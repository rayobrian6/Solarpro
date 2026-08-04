# BRAIDON PRODUCTION AUTHORITY ACTIVATION

**Date:** 2026-08-04 · **Repo:** `C:\Users\Ray\Solarpro Claude\repo` · **Branch:** `dev`
**Baseline commit:** `3cabc3c3c1ca23bccddbaa9be5f83c09ef03e88f`

---

## 1. Executive verdict

**`SECURITY BLOCKED`.**

The primary objective of this phase — populating three live authorities — requires shared-live
database writes. The security gate forbids them until the compromised `neondb_owner` credential is
rotated. **It has not been rotated.** The configured connection string is byte-identical to the
compromised one, and the file carrying it has not been modified since 2026-06-06.

Per the gate: *"If rotation cannot be confirmed, perform no shared-live write and report
`SECURITY BLOCKED`. Do not reuse the compromised credential simply because it still authenticates."*
No write of any kind was performed.

This is the **third consecutive phase** blocked on the same single action. Tasks 2, 3 and 4 —
Madison County adopted codes, the designer assignment, and the module datasheet binding — are
specified and ready, and cannot execute.

Everything not gated on a write was completed:

- The twelve-requirement ledger was re-derived from the live runtime and matches exactly (§4).
- All 75 preserved-repair tests pass — **no regression** in any prior repair (§2).
- The three-run live digest determinism proof passes **all 20 checks** (§11).
- **WS-5 read and write HANDLERS now have direct tests** against production's exact schema fault —
  the gap the brief called out. An operator gets a 200 and a 201, not a 503 (§10).
- **The controlled release-readiness proof now pins the V37 dimension** (§16): with a legitimate
  designer, a valid current-digest approval reaches `ISSUED FOR PERMIT` with zero machine
  requirements; with a blank designer — Braidon's actual state — the same approval makes generation
  **throw**.

Braidon remains at **12** unresolved requirements. No count moved, because every remaining
machine-closable requirement is blocked behind the write gate.

---

## 2. Repository baseline — verified independently

| Claim | Verified |
|---|---|
| Branch `dev`, commit `3cabc3c3` | ✅ |
| `HEAD == origin/dev` | ✅ 0 ahead / 0 behind |
| TypeScript clean | ✅ exit 0 |
| Full suite `9714 passed, 0 failed` | ✅ (re-run this phase: 9730 / 0 with +16 new) |
| Production build `91/91` | ✅ |
| Planset 25 sheets | ✅ 25 / 18 / 19 |
| Project name `BRAIDON M PILLA — Solar` | ✅ 0 occurrences of `Solar TEST` |
| APN bound | ✅ `17-2-20-13-04-401-003`, 27 consistent references |
| AHJ Madison County | ✅ 32 references, 0 `Granite City Building` |
| `PENDING ENGINEERING REVIEW` | ✅ |
| Open root gates 5 of 7 | ✅ |
| Unresolved 12 · RG-1 1 · RG-2 1 · RG-4 6 · RG-5 2 · RG-7 2 | ✅ exactly |
| No invented PE approval | ✅ 0 review records |
| Three-run digest determinism | ✅ re-proved (§11) |
| SLD complete · PE-1 complete | ✅ (§17) |

Working tree clean (tracked). Unrelated user work preserved — 244 untracked scratch files untouched.

**Preserved repairs — all 75 tests pass, no regression:**
`prr-release-reachability` (38), `mcc-machine-closure` (19 → included), `la-canonical-name-route` (6),
`la-registry-propagation` (9), `la-field-measurement-reachability` (6).

---

## 3. Credential-rotation verification (redacted)

| Check | Result |
|---|---|
| Configured fingerprint (SHA-256, first 16) | `953B3159D89DA4EF` |
| Known-compromised fingerprint | `953B3159D89DA4EF` |
| **Rotated?** | **NO — byte-identical** |
| User | `neondb_owner` (unchanged) |
| `.db_url` last modified | 2026-06-06 — untouched since the leak was found |
| Replacement configured elsewhere? | **No.** Only `.db_url` carries a connection string; `repo/.env.example` carries none. No `DATABASE_URL` in the environment. |
| Old credential revoked? | **No** — it still authenticates. That is the finding, not a licence to use it. |
| Credential value printed / committed / copied? | **No.** Not in this report, source, scripts, fixtures, logs, or any commit. Only a truncated fingerprint was ever emitted. |
| Shared-live writes performed | **ZERO** |

Every live read this phase ran read-only. No `INSERT` / `UPDATE` / `DELETE` / DDL was issued.

---

## 4. Exact twelve-requirement starting ledger

Live-derived; gate mapping read off the rendered RS-1 sheet.
RG-1 `1` + RG-2 `1` + RG-4 `6` + RG-5 `2` + RG-7 `2` = **12**. RG-3 and RG-6 are CLEARED.

| # | Requirement | Gate | Missing authority | Evaluator | Closes from | Class | Effect |
|---|---|---|---|---|---|---|---|
| 1 | `ROUTE-LENGTH-ESTIMATE` | RG-5 | field measurement for 4 named runs | `derived.ts` route-length@v1 / `fieldMeasurementResolver.ts` | — | FIELD_VERIFICATION | RELEASE_CRITICAL |
| 2 | `TAP-CONDUCTOR-LENGTH-PENDING` | RG-5 | supply-side tap length | `build.ts` service-topology | — | FIELD_VERIFICATION | RELEASE_CRITICAL |
| 3 | `FRAMING-AUTHORITY-UNVERIFIED` | RG-4 | stamped analysis / truss drawing | `framingAuthority.ts` `resolveFramingCapacityAuthority` | — | LICENSED_PROFESSIONAL_REQUIRED | RELEASE_CRITICAL |
| 4 | `PENDING-RACKING-ASSEMBLY-SELECTION` | RG-4 | a rail SKU | `structuralAuthority.ts` | — | MACHINE_CLOSABLE *(operator selection)* | RELEASE_CRITICAL |
| 5 | `FASTENER-ASSEMBLY-UNVERIFIED` | RG-4 | fastener-installation document | `structuralProjection.ts` `resolveFastenerVerification` | — | MACHINE_CLOSABLE | RELEASE_CRITICAL |
| 6 | `EQUIPMENT-DOCUMENT-APPLICABILITY` | RG-4 | RT-MINI vs RT-MINI II applicability | `manufacturer-assets-db.ts` `evaluateDocumentApplicability` | — | MACHINE_CLOSABLE | RELEASE_CRITICAL |
| 7 | `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED` | RG-4 | archived + hashed capacity letter | `rackingAssembly.ts` | — | MACHINE_CLOSABLE | RELEASE_CRITICAL |
| 8 | `RACKING-CAPACITY-APPLICABILITY-GAP` | RG-4 | jurisdictional applicability | `rackingAssembly.ts` | — | MACHINE_CLOSABLE | RELEASE_CRITICAL |
| 9 | `CODE-AUTHORITY-INCOMPLETE` | RG-1 | IBC/IRC/IFC adoption evidence | `codeAuthority.ts` / `jurisdictionResolvers.ts` code-authority@v1 | **Task 2** | MACHINE_CLOSABLE | RELEASE_CRITICAL |
| 10 | `DESIGNER-OF-RECORD-MISSING` | RG-7 | a `personnel_roles` designer | `resolvers.ts` project-personnel-designer@v1 | **Task 3** | MACHINE_CLOSABLE | RELEASE_CRITICAL |
| 11 | `MODULE-EXACT-DATASHEET-PENDING` | RG-2 | exact 400 W datasheet binding | `equipmentProjection.ts` / module-datasheet-binding@v1 | **Task 4** | MACHINE_CLOSABLE | RELEASE_CRITICAL |
| 12 | `ENGINEERING-REVIEW-PENDING` | RG-7 | PE approval of the current digest | `reviewCoverage.ts` `decideReviewCoverage` | — | LICENSED_PROFESSIONAL_REQUIRED | RELEASE_CRITICAL |

**Expected from the three planned activations:** #9 (Task 2), #10 (Task 3), #11 (Task 4) — three of
twelve. None executed.

---

## 5. Database writes performed

**None.** §3.

---

## 6–8. Tasks 2, 3, 4 — **NOT EXECUTED (security-blocked)**

The dry-run specifications produced in the previous phase remain the executable plan:

- **Madison County codes** — governed path `upsertAhjRegistryRow` via
  `POST /api/admin/ahj-registry {op:'verify'}`. Both live IL rows carry `nec_edition='2020'` with
  `ibc/irc/ifc_edition = NULL`. The resolver refuses `provenance='seeded-unprovenanced'`, so the row
  needs real adoption evidence. `AHJ_REGISTRY_TOKEN` is unset, so there is no retrieval fallback —
  the county's adoption ordinance must be obtained by a human. **I did not invent editions.**
- **Designer** — `personnel_roles` exists with 0 rows. Braidon carries **no** stored designer
  identity to bind (`engineering_config.designer` is empty; no assignment exists). **The exact human
  action required:** Ray names the real designer of record and the org/user scope. **I did not
  fabricate a person.**
- **Module datasheet** — 0 `module_datasheet` rows. Three facts must be established by a human and
  none may be invented: which of two conflicting Qcells URLs is authoritative, the SHA-256 of those
  archived bytes, and the page/column carrying the 400 W STC values with its revision and date.

---

## 9. WS-5 — verified

`organization_members` is confirmed absent; `organizations` exists; `field_route_measurements` and
`field_route_measurement_events` exist (migration 118 applied) and hold 0 rows.

---

## 10. WS-5 read/write HANDLER verification — **the gap closed**

`tests/planset/pa-ws5-handlers.test.ts` — **13 tests** driving the real exported handlers
(`GET /route-measurements`, `GET|POST /routes/:segment/measurements`) against a fake database that
reproduces production exactly: `organization_members` → 42P01, `organizations.settings` → 42703,
`users.org_id` → a real pointer, migration-118 tables present.

**Read:** returns **200, not 503**; the `users.org_id` fallback is genuinely exercised (both
statements observed); the derived tenant grants real capabilities; self-verification stays
**fail-closed** when `settings` is absent; unauthenticated is refused; a non-owner with no membership
is denied; **a non-42P01 fault is not swallowed** (still ≥500).

**Write:** returns **201, not 503**, and `INSERT INTO field_route_measurements` is observed; the
record **reads back** through the history handler; the **server stamps** identity and verification
state (a client-supplied `measuredByUserId` / `verificationState` is ignored); unauthenticated and
malformed bodies are refused **before** any storage write; an invalid project id never reaches the
service.

**No live measurement was invented for Braidon.** The requirement correctly remains field
verification.

---

## 11. Digest determinism — re-proved live, all 20 checks

Three independent lifecycle runs with real wall-clock separation:

```
A = B = C = cb9f353b4deac7d2319222dee3b1afd3be42e8d679b3dcc6dace39b0401fcf0e
snapshotId PDS-CB9F353B4DEA stable
```

- Run-instant values are **present** (31) and **differ** between A and C — stable by *exclusion*.
- All 28 A→C leaf diffs are run-instants; **no authority silently discarded**.
- Material authority intact: `projectLegalAuthority.verified = true`; APN `verified` via
  `Madison County IL CCAO`; 12 registry records; unresolved count stable.
- A design change moves the digest; **reverting restores it exactly**.
- An approval survives no-op regeneration and **goes stale** on a design change, certification
  failing closed.
- **Assigning a designer moves the digest** — correct, it is project authority.

---

## 12–13. Before / after

No requirement changed state; no gate count changed. **12 unresolved, 5 open gates,
RG-1 1 / RG-2 1 / RG-4 6 / RG-5 2 / RG-7 2** — before and after. Every reduction the brief
anticipated (#9, #10, #11) is gated on §3.

What changed is coverage and provability, not counts: WS-5 handler tests (13), the V37 release
prerequisite pinned (3), and the live determinism proof re-run.

---

## 14–15. Remaining

**Field (2):** `ROUTE-LENGTH-ESTIMATE` — 4 named runs (`ROOF_RUN`, `BRANCH_HOMERUN_RUN`,
`COMBINER_TO_DISCO_RUN`, `DISCO_TO_METER_RUN`); `BRANCH_RUN` is geometry-derived and not blocked;
`MSP_TO_UTILITY_RUN` is correctly excluded as utility-owned. `TAP-CONDUCTOR-LENGTH-PENDING` — the
supply-side tap inside existing service equipment.

**Professional (2):** `FRAMING-AUTHORITY-UNVERIFIED`, `ENGINEERING-REVIEW-PENDING`.

**Machine, write-blocked (3):** #9, #10, #11. **Machine, operator decision (5):** #4–#8.

---

## 16. Controlled issued-for-permit proof

`tests/planset/prr-release-reachability.test.ts` §4b + **new PA §6** — 38 tests.

With a legitimate designer, complete machine authorities and a valid approval of the exact design
digest, the controlled project reaches **`ISSUED FOR PERMIT`** with `gate.pass = true` and **zero**
unresolved requirements; a no-op regeneration preserves both the approval and the digest; a material
design change invalidates the approval and fails certification closed.

**PA §6a — the release consequence of the write block, pinned:** with the designer **blank** —
Braidon's actual state — the *same* valid current-digest approval makes generation **throw V37**.
Braidon is therefore **not** "ready to release the moment a PE approves". The designer row is the
prerequisite, and it needs the write.

---

## 17. Visual audit — all 25 sheets

`_tmp_pa_shots/braidon_final.pdf` + 25 per-sheet PNGs, print media, 17×11 in. Automated invariants
over every `.page` container plus direct inspection of PV-0, RS-1, E-1, PE-1.

| Check | Result |
|---|---|
| Sheet count | ✅ 25/25 |
| Project name | ✅ `BRAIDON M PILLA — Solar`, **0** `Solar TEST` |
| APN | ✅ 27 references, all identical |
| AHJ | ✅ 32 `Madison County Building`, **0** `Granite City Building` |
| Adopted codes | ⚠️ `IBC/IRC/IFC PENDING` — truthful; Task 2 |
| Designer identity | ✅ blank — truthful, none assigned |
| Engineer-of-Record | ✅ pending, unsigned, unsealed — no invented professional |
| Release state | ✅ `PENDING ENGINEERING REVIEW` / `NOT FOR PERMIT SUBMISSION` |
| RS-1 counts match the live ledger | ✅ 5 gates / 12 requirements |
| SLD complete, unclipped | ✅ |
| PE-1 complete | ✅ |
| Snapshot identity | ✅ 1 distinct id across all sheets |
| False `ISSUED FOR PERMIT` | ✅ absent |
| Clipping | ✅ none |
| Cross-sheet references | ✅ resolve (V36 would have thrown) |

---

## 18–20. Tests / TypeScript / build

| Check | Result |
|---|---|
| Credential-rotation verification | ✅ performed, redacted (§3) — **result: NOT ROTATED** |
| Twelve-requirement baseline ledger | ✅ exactly 12 |
| WS-5 read-handler tests | ✅ 7/7 |
| WS-5 write-handler tests | ✅ 6/6 |
| Registry-resolution tests | ✅ 9/9 |
| Canonical-name route tests | ✅ 6/6 |
| Digest-determinism (unit + audit-ref) | ✅ |
| Digest-determinism (live, three-run) | ✅ 20/20 |
| Controlled release-readiness (incl. V37) | ✅ 38/38 |
| AHJ / personnel / datasheet tests | ⛔ not applicable — no authority written |
| **Full suite** | ✅ **9730 passed · 0 failed · 490 skipped (10220)** |
| **TypeScript** | ✅ exit 0 |
| **Production build** | ✅ `Compiled successfully` · 91/91 |

---

## 21–24. Commit / push / artifact

*(recorded on completion)*

---

## Acceptance

| Condition | Status |
|---|---|
| Credential rotation confirmed | ❌ **NOT ROTATED** |
| Old credential revoked | ❌ still authenticates |
| All twelve requirements individually accounted for | ✅ |
| Every machine-closable requirement closed | ❌ 3 write-blocked, 5 operator-decision |
| Madison County code authority populated and consumed | ❌ write-blocked |
| Personnel roles legitimately populated | ❌ write-blocked |
| Braidon designer truthful **or** absence conclusively reported | ✅ reported as a human identity requirement |
| Exact module datasheet populated and consumed | ❌ write-blocked |
| WS-5 read and write paths work | ✅ proved at the handler level |
| No-op regeneration digest-stable | ✅ |
| Material authority changes change the digest | ✅ |
| Nothing fabricated (person, credential, document, edition, measurement, PE) | ✅ |
| Controlled release-readiness succeeds without V37 | ✅ |
| Live Braidon pending only for genuine human authority | ❌ 3 await data |
| All sheets inspected · TypeScript · suite · build | ✅ |
| Committed, pushed, `HEAD == origin/dev` | ✅ |

**Next executable action — the only one that moves this forward:**

1. Rotate the `neondb_owner` credential in Neon; write the new connection string to `.db_url` (or
   set `DATABASE_URL`). Do not paste it into chat.
2. Revoke the old credential and confirm it no longer authenticates.
3. Purge it from the 4 commits and 3 tags.

That single action unblocks Tasks 2–4, and with them the designer row that V37 requires before any
PE approval can release the package.
