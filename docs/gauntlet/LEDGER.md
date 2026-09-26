# Gauntlet ledger — the seven statuses, never blurred

Ray's accounting law, Phase 4. Every item sits in exactly one status. The
statuses mean different things and a reader must never have to guess which one
applies.

| Status | Means |
|---|---|
| **ACTIVE** | currently being investigated. No conclusion yet. |
| **VERIFIED** | independently confirmed — the defect is real and reproduced, but nothing has shipped. |
| **SHIPPED** | integrated, tested and on `dev`. |
| **LIVE ACCEPTED** | Ray reproduced it himself. This is the only status a test cannot grant. |
| **NEEDS RAY** | a real product decision or action only Ray can take. Blocks its own slice and nothing else. |
| **BACKLOG** | valid, understood, and deliberately not worth the present risk. |
| **REJECTED** | researched and intentionally not adopted. Recorded so it is not re-proposed. |

Last updated: 2026-09-26.

---

## LIVE ACCEPTED

| Item | When |
|---|---|
| Tree drag-to-size | Ray, 2026-09-25 |
| Tree visible shadow | Ray, 2026-09-25 |

Everything else below is at most SHIPPED. **Nothing promotes itself to LIVE
ACCEPTED**; only Ray does.

---

## SHIPPED — Phase 4

| Commit | What |
|---|---|
| `d24d3044` | A tab was refusing its OWN layout writes — the autosave and `/api/production` in flight together stated the same version, so the server granted one and refused the other as "saved somewhere else" with nothing else open |
| `a1963540` | 🚨 The permit's wind analysis was hardcoded to a 15 ft building — every multi-storey building analysed 10–22 % low, in the unsafe direction, on a sealed sheet |
| `5c11c143` | The operator's own Structural-tab mean roof height reaches the permit |
| `b3a0918d` | The cover's STORIES row had no writer; the building model knew the answer |
| `216e546f` | 🚨 Two NEC 310.16 tables disagreed at #1 AWG — and the WRONG one selected the conductor while the right one printed the derivation |
| `15de246a` | 🚨 FOUR copies of NEC 310.15(B)(1), wrong in two opposite directions — and the two that AGREED were both missing the top of the table, applying 0.58 where the code requires 0.41 at 76–80 °C |
| `28e9db47` | 🚨 An EGC rule that was `size * 15` — every OCPD up to 210 A got a #14 AWG ground, published as "NEC 250.122" |
| `3f882c94` | A sixth NEC table copy, wrong at #3/0 AWG — conduit fill computed low |
| `b9281e5c` | Fence and ground sheets asserted "confirmed adequate" with no gate — the same sheet could say that AND "analysis data incomplete" |
| `1889fd24` | A log said "keeping pass-1 pagination" while assigning the pass-2 BOM |
| `df75ea85` | The engineer's own ENGINEERING NOTES reached no sheet |
| `b81527f7` | PV-4B's home-run row printed the OPEN-AIR branch's conductor gauge |
| `6be0e08c` | A golden passed because a flat derating tail hid a stale ambient — and the repo's own roof fixture sits at 76 °C, the band the bug was in |
| `5a543180` | 🚨 **R9** — "PE approved" could describe a calculation nobody approved. Two defects: the store never asked whether a prior approval existed, and the surfacing guard could not fire for the case it was written for |
| `769a8e46` | 🚨 The migration destructive-token gate could not refuse a single token — `\b` inside a template literal is U+0008. Fifth occurrence in this repo |
| `f15aa257` | 🚨 **R8** — the batch runner stepped over an INTERRUPTED migration and applied later files on top of an indeterminate schema; and the halt is at **003**, not 027 |

---

## VERIFIED — real, reproduced, not yet fixed

| Item | Evidence | Why not shipped |
|---|---|---|
| `lib/migrations/003` blocks every batch run | Executed: exactly two files apply; `ADD CONSTRAINT IF NOT EXISTS` is valid in no PostgreSQL version, and 003's own header claims it is | Editing an applied migration changes its checksum and `CHECKSUM_CONFLICT` then halts the batch for environments where it is recorded applied. A ledger decision → **NEEDS RAY (R8)** |
| `lib/migrations/027` can never apply | All four database states executed | Same reason → **NEEDS RAY (R8)** |
| Nothing can clear a `running` migration row | No API action, no startup sweep; only `markMigrationRunning`/`recordMigrationResult` write that column | A new governed action is a governance act → **NEEDS RAY (R8)** |
| `042_utility_unique_site_aliases.sql` carries the same invalid `ADD CONSTRAINT IF NOT EXISTS` | Same construct as 003 | Same ledger decision |

---

## NEEDS RAY

Full detail in `NEEDS-RAY.md`. One line each; each blocks **only its own slice**.

| # | Decision |
|---|---|
| **R8** | Disposition of **003 first**, then 027; and a supported way to reconcile a `running` row |
| **R9** | The fix RAISES loads — PE approvals already granted were granted on the lower number |
| **R10** | Three engineering-page fields with no readers, incl. a five-state Permit Status dropdown while the real state is `projectAuthority.issueStatus` |
| **R1** | A committed Google API key needs rotating |
| **R2** | How approximate should an UNCLAIMED lead's map pin be |
| **R3** | Two engineering repairs that would move the permit digest |
| **R4** | Four milestone checkboxes POSTed and silently discarded |
| **R5** | Three things to try in Dev — live acceptance overrides tests |
| **R6** | A geocoder overwrites a coordinate a human set — 2.79 km and 28 m, measured |
| **R7** | The roof has no building-elevation sheet |

---

## ACTIVE

| Lane | Shape |
|---|---|
| Platform gauntlet | CRM, proposal, marketplace, survey, homeowner, admin, procurement, finance, enterprise — read-only, adversarially verified |
| Duplicated engineering authorities | voltage drop, conduit fill, OCPD/busbar, rooftop adder, grounding, battery/PCS, structural constants, module/inverter limits |
| R10 status-authority trace | mapping every status notion to decide what replaces the dead fields |

---

## BACKLOG

| Item | Why not now |
|---|---|
| `groundArea` persistence | needs a migration, and the migration path itself is the open R8 question |
| Seven unadopted `components/design/*` components | chipped as its own task; no correctness consequence |
| `project_versions` retention policy | Ray's, and nothing is failing today |

---

## REJECTED — researched, deliberately not adopted

| Item | Why |
|---|---|
| "Make 027 runnable" | Executed: against TEXT keys it applies and creates `stage`/`substage`, which **no shipped query reads**. It would produce a table the product cannot use. |
| Warming the e2e server to fix a flaky spec | The spec was telling the truth. The warm-up did not fix it; the concurrency defect did. A red silenced by a warm-up teaches you to disbelieve red. |
| An `'unknown'` enum member for the deletion ledger | Refuted as worse than the bug it would paper over |
| Raising Playwright workers above 1 | Rebooted Ray's machine twice |

---

## The rule this ledger exists to enforce

A green test is not evidence. Every guard here was challenged by restoring the
original defect — **by restoring its bytes, not by retyping it** — and the guard
had to go red. Where only a source guard can discriminate, the file says so in
its own words. Guards that could not be made to fail are not counted.
