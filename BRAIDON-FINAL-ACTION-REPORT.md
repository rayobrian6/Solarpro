# BRAIDON — FINAL ACTION REPORT

**Engagement:** four phases, 2026-08-04 · **Branch:** `dev`
**Start:** `c9862ab9` → **End:** `81127831` · `HEAD == origin/dev` · tracked tree clean
**Net:** 26 files changed, +4153 / −123

---

## 1. Verdict in one paragraph

The Braidon plan set could not be released, and the reason was never the plan set. `ISSUED FOR
PERMIT` was **structurally unreachable for every project in the system** — not hard to reach,
*impossible*, by five stacked defects on one code path. That is now fixed and proven: a controlled
project with complete authority and a licensed digest-bound approval reaches `ISSUED FOR PERMIT`
with zero open requirements. Braidon itself went from **14 → 12** unresolved requirements. The
remaining twelve are individually accounted for, and **three of them are blocked on a single action
only you can take: rotating the leaked database credential.** Nothing else in this engagement is
waiting on anything.

**Status: `BLOCKED` — on credential rotation.**

---

## 2. What was actually wrong

Every defect found was the same shape, and it is worth naming because it will recur: **an authority
was computed correctly and then discarded by its consumer**, or **a fact about the act of building
leaked into the identity of the thing built.**

| # | Defect | Effect |
|---|---|---|
| 1 | `engineerReviewCoversCurrentDigest: false` hardcoded | gate precondition never satisfiable |
| 2 | `signatureSealSatisfied: false` hardcoded | second precondition never satisfiable |
| 3 | `currentDigest: ''` passed to project authority | every real approval read as a digest **mismatch** ⇒ issue state `REVISED` — supplying a valid PE approval made the package look *worse* |
| 4 | **the digest covered its own approval** | approving digest `D` produced `D′ ≠ D`, so `reviewedDigest === meta.digest` — the test *five* consumers apply — was unsatisfiable for any approval that could ever exist |
| 5 | invalidation ledger was a permanent one-way latch | project-scoped, `digest: null`, and `superseded_at` written **nowhere** in the codebase — 22 rows on Braidon latched review coverage false forever |
| 6 | V13 demanded "PENDING ENGINEERING REVIEW" on every CERT sheet unconditionally | an approved package **threw a blocking violation** — the engine refused to emit the artifact the approval exists to release |
| 7 | PE signature block printed blank rules in every state | the reported "blank Engineer-of-Record" |
| 8 | **the design digest moved on every regeneration** | 30 leaf diffs, all resolution-attempt timestamps. A PE approves, the operator regenerates 20s later, the approval is dropped as "stale" *by the mechanism built to protect it* |
| 9 | `resolved: false` hardcoded on **every** registry record | no resolver clearance anywhere in the system could ever close a requirement |
| 10 | permit path read the stale `engineering_config` name mirror | the package took its whole identity from an unreconciled value (`…Solar TEST`) |
| 11 | AHJ **name** came from a different source than the AHJ **type** | a mailing-city AHJ was stamped `verified` on an unincorporated county parcel — one package, two AHJs, wrong one certified |
| 12 | a machine-retrieved APN was graded as a keystroke | the county assessor's own APN was refused under "no parcel record" — a false statement printed as the blocking reason |
| 13 | **the entire WS-5 field-measurement feature was dead, read *and* write** | an absent *optional* table threw, and the fallback only handled "no rows"; the requirement said "could not be read", which reads as *nobody measured* |
| 14 | the clearing audit ref carried a wall-clock instant into the digest | latent; the first genuine clearance would have silently undone #8 |

**Two briefed "defects" were false and I did not repair them.** Migration 115 creates
`personnel_roles` and `project_personnel_assignments` — `project_personnel_roles` is the *filename*;
both real tables exist. And `project-authority@v1` was never returning nothing; it retrieved live
and one field (the APN) held it false. Writing a repair migration for a table the system never
references would have been fabricated work.

---

## 3. Phases and commits

| Phase | Code commit | Final commit | Outcome |
|---|---|---|---|
| **PRR** — permit-release reachability | `61a16d33` | `3a649ae7` | defects 1–7. `ISSUED FOR PERMIT` reachable |
| **MCC** — machine closure | `b9436ddb` | `9005884d` | defects 8–11. Braidon **14 → 12** |
| **LA** — live authority | `c8f0604a` | `3cabc3c3` | defects 12–14 |
| **PA** — production activation | `d6ae79fb` | `81127831` | WS-5 handler coverage; V37 prerequisite pinned. **Writes blocked** |

---

## 4. Files changed

**New (3 source/test, 4 reports):**
`lib/permit/snapshot/reviewCoverage.ts` — the single pure review-coverage decision.
`tests/planset/{prr-release-reachability, mcc-machine-closure, la-canonical-name-route, la-registry-propagation, la-field-measurement-reachability, pa-ws5-handlers}.test.ts`.

**Modified (12):**
`app/api/engineering/permit/route.ts` · `lib/permit/generatePermit.ts` ·
`lib/permit/sections/certPages.ts` · `lib/permit/snapshot/{build,digest}.ts` ·
`lib/permit/snapshot/resolution/{jurisdictionAuthority,jurisdictionResolvers,lifecycle,resolvers,types}.ts` ·
`lib/fieldMeasurement/{capabilities,permitAccess}.ts`

---

## 5. Braidon: before and after

| | Start (`c9862ab9`) | Now (`81127831`) |
|---|---|---|
| Unresolved requirements | **14** | **12** |
| Open root gates | 5 of 7 | 5 of 7 |
| Sheets | 25 / 18 / 19 | 25 / 18 / 19 |
| Project name | `BRAIDON M PILLA — Solar TEST` | **`BRAIDON M PILLA — Solar`** |
| APN | `unverified-derived` | **`verified`** via Madison County IL CCAO |
| AHJ (legal record) | `City of Granite City` *(stamped verified)* | **`Madison County`** — now agrees with code authority |
| Regeneration | **different digest every run** | **identical** |
| Review blocker reason | *"invalidated by a ledger entry"* (unclearable) | *"no approved review covering the current digest"* |
| WS-5 field measurement | **unreachable, read + write** | **reachable** |
| Release state | `PENDING ENGINEERING REVIEW` | unchanged — correctly |

**Closed:** `PROJECT-NAME-NONPRODUCTION`, `PROJECT-AUTHORITY-UNVERIFIED`.

---

## 6. The twelve remaining, individually

**Blocked on the credential — 3.** These are the phase's primary objective and are specified,
ready, and unexecutable:

| Requirement | Gate | What must be written |
|---|---|---|
| `CODE-AUTHORITY-INCOMPLETE` | RG-1 | IBC/IRC/IFC adoption evidence for `il-madison-county`. Both IL rows carry `nec_edition='2020'` and NULL for the rest; the resolver refuses unprovenanced rows; `AHJ_REGISTRY_TOKEN` unset |
| `DESIGNER-OF-RECORD-MISSING` | RG-7 | a `personnel_roles` designer row. Table exists, **0 rows**. Braidon has no stored designer identity to bind |
| `MODULE-EXACT-DATASHEET-PENDING` | RG-2 | a `module_datasheet` row naming the exact 400 W page/column. **0 such rows** |

**Operator decisions — 5.** One bounded confirmation plus a part number, no research:
`PENDING-RACKING-ASSEMBLY-SELECTION` (a rail SKU from the span-screened shortlist),
`FASTENER-ASSEMBLY-UNVERIFIED`, `EQUIPMENT-DOCUMENT-APPLICABILITY`,
`RACKING-CAPACITY-SOURCE-NOT-ARCHIVED`, `RACKING-CAPACITY-APPLICABILITY-GAP` — the published stamped
letter covers **RT-MINI II**, the selected mount is **RT-MINI**. Confirm it governs the hardware
installed, or select RT-MINI II.

**Genuine field work — 2.** `ROUTE-LENGTH-ESTIMATE` (4 named runs; `BRANCH_RUN` is geometry-derived
and not blocked; `MSP_TO_UTILITY_RUN` correctly excluded as utility-owned) and
`TAP-CONDUCTOR-LENGTH-PENDING` (the supply-side tap inside existing service equipment).
**Now actually recordable** — the WS-5 path was dead before.

**Licensed professional — 2.** `FRAMING-AUTHORITY-UNVERIFIED` and `ENGINEERING-REVIEW-PENDING`.

---

## 7. ★ The finding that matters most commercially

**Braidon cannot be released today even if a PE approves it.**

Proved live, not asserted: with the designer blank — Braidon's actual state, because
`personnel_roles` is empty — a valid current-digest approval does not merely fail to release. **V37
(§15d) throws and generation fails.** Pinned by test in `prr-release-reachability.test.ts` PA §6a/§6b
and reproduced by the live determinism harness.

So "ready the moment a PE approves" is not true, and the missing piece is one of the three blocked
writes. Related: **assigning a designer moves the design digest** (it is project authority) — so the
PE must approve the *post-designer* digest, never the one before it.

---

## 8. Verification

| | Result |
|---|---|
| TypeScript | ✅ exit 0 |
| Full suite | ✅ **9730 passed · 0 failed · 490 skipped** (from 9422 at start; **+308**) |
| Production build | ✅ `Compiled successfully` · 91/91 (needs `NODE_OPTIONS=--max-old-space-size=8192`) |
| Live three-run digest determinism | ✅ 20/20 checks |
| Visual audit | ✅ 25/25 sheets — SLD complete and unclipped, PE-1 complete, 0 `Solar TEST`, 0 wrong-AHJ, 1 consistent snapshot id, no false `ISSUED FOR PERMIT` |
| Preserved repairs | ✅ 75/75, no regression |
| `HEAD == origin/dev` | ✅ `81127831fae33e184aa6b930012c2c34eec948bc` |

**Tests added: ~103** across six files — release reachability, machine closure, canonical-name route,
registry propagation, field-measurement reachability, WS-5 handlers.

---

## 9. What was NOT done, and why

- **No PE approval was invented.** Braidon has zero review records and correctly reads
  `PENDING ENGINEERING REVIEW`.
- **No person, credential, document, code edition, or field measurement was fabricated.**
- **No shared-live database write was performed** in any phase. Every live read ran with
  `SET default_transaction_read_only = on`.
- **No migration was written for migration 115**, because there is no drift (§2).
- **The operator-misdirection defect was recorded, not repaired**: the resolver appends a hardcoded
  *"migration 113/114 not run"* to any 42P01 (both applied) and says *"run migration 118"* (applied),
  while the genuinely-missing migration 105 has no console button. It is a message defect and
  belongs with applying 105.

---

## 10. The one action that unblocks everything

The `neondb_owner` credential is **still not rotated** — fingerprint byte-identical to the
compromised one, `.db_url` unmodified since 2026-06-06, still present in **4 commits and 3 tags**.
Three consecutive phases have stopped here.

1. Rotate `neondb_owner` in Neon. Write the new connection string to `.db_url` or set
   `DATABASE_URL`. **Do not paste it into chat.**
2. Revoke the old credential and confirm it no longer authenticates.
3. Purge it from the 4 commits and 3 tags.

Then, in one pass: write the three authorities, regenerate, and Braidon drops to the two field
requirements and the two professional ones — at which point a PE approval will actually release the
package, because the designer will exist and V37 will pass.

---

## 11. Artifacts

`_tmp_pa_shots/braidon_final.pdf` (25 sheets) + per-sheet PNGs ·
`_tmp_la_determinism.json` (three-run proof) ·
phase reports `BRAIDON-{PERMIT-RELEASE-REACHABILITY, MACHINE-CLOSURE-COMPLETION, LIVE-AUTHORITY-COMPLETION, PRODUCTION-AUTHORITY-ACTIVATION}.md`
