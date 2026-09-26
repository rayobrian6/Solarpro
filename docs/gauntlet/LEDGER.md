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

## SHIPPED — Phase 4, continued

| Commit | What |
|---|---|
| `769a8e46` | 🚨 The migration destructive-token gate could not refuse a single token — `\b` in a template literal is U+0008. Fifth occurrence in this repo |
| `c26a56ea` | 🚨 The forced dry-run proved nothing (success from both arms, no static refusals) **and** the route never read its verdict. Two layers of ritual before the most dangerous operation the product performs |
| `ca3c05ce` | 🚨 The ops pipeline moved and the customer's view of it did not — `syncHomeownerStage`/`writeMicroStage` were reachable only from a route with ZERO UI callers |

---

## DESIGN LANE — verified on `dev`, 2026-09-26

Ray's items 16 ("Auto Layout preservation") and the panels-below-the-roof report.

| Spec | Result |
|---|---|
| `e2e/panel-above-deck.spec.ts` | **4/4.** Every Auto Layout panel is visibly above the deck Cesium draws — on a gable, on a 2D-tagged face, and after a reload. Reads the real entities, not the placement library's own arithmetic. |
| `e2e/panel-elevation.spec.ts` | **3/3**, including *"a second Auto Layout does not lift the array — placement is idempotent"*. |
| `e2e/building-section-editing.spec.ts` | 23 passed, 1 failed in the suite run; **that one passed in isolation in 25.8 s** after timing out at 90 s. |

🚨 **The flake is evidence about the process, not the product.** The suite ran for
9 minutes against a server the peer session was recompiling throughout — 10 files
dirty at the time. Every layout POST in the log returned **200** and there were
**zero** stale-write refusals, so the save path was not at fault. This is exactly
what the memory warns reads like a product failure, and exactly the condition the
new parallel-worktree law exists to end. **A suite run against a moving tree is not
evidence** and is not counted as one here.

**What these specs still cannot see:** with no Google Maps key there is no
photorealistic tileset, so they measure the panel against the DRAWN DECK. They do
not prove a panel clears Google's photogrammetry mesh, which is not planar.

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

## VERIFIED — the platform audit, 53 findings across nine lanes

Full detail in `PLATFORM-FINDINGS.md`. 216 agents, 292 files, three adversarial
verifiers per finding, 16 killed. **Three fixed** (below); **50 recorded, not
fixed** — they are VERIFIED, not SHIPPED, and the distinction is deliberate.

| Lane | Confirmed | Headline |
|---|---|---|
| CRM / Operations | 7 | The route built to keep the two stage authorities in sync has zero callers |
| Proposal / Customer | 8 | Calculator is healthy; the surfaces around it still show an "ITC: On" badge for a repealed credit |
| Marketplace | 6 | Nothing can legitimately enter the marketplace — the only release writer 500s before writing |
| Homeowner | 8 | Portal bill upload discards the actual bill and files a JSON summary under its name |
| Admin | 6 | "All Systems Operational" hardcodes 4 of 6 service statuses with invented latencies |
| Procurement | 7 | The engineering BOM is never invalidated when equipment changes, and the stale copy is auto-filed |
| Finance | 4 | A §48E banner gated on two frozen `true` literals ships a 30 % federal claim |
| Survey | 3 | The integration dashboard is hardcoded to a type-level `false` and can never go green |
| Enterprise | 4 | **Both P0s fixed** — see SHIPPED |

---

## SHIPPED — the P0s the audit found

| Commit | What |
|---|---|
| `6115a285` | 🚨 **P0.** Four org member mutations ran with NO authorization: with WRITE on and AUTHORITY off, any authenticated user knowing two UUIDs could PATCH `{role:'owner'}` onto a member, or delete them. A viewer could promote themselves |
| `db3180e5` | 🚨 **P0.** Removing a member from one organization cleared their `org_id` even when it pointed at another — and undid the library's own scoped clear and re-sync |

🚨 **One verifier REFUTED the authorization finding**, correctly: the flag-conditional
is documented architecture and the original report misquoted the route header. Both
true, and neither disposed of the hole — the conditional is fine, the empty `else`
was not. The refutation *improved* the fix instead of killing it. That is what the
adversarial pass is for, and it is why refutations are read rather than counted.

---

## VERIFIED — the duplicated-authority sweep, 28 findings across eight families

Full detail in `ENGINEERING-AUTHORITIES.md`. 100 agents, 246 copies mapped, 18
killed. **20 of the 28 are in the UNSAFE direction.** One fixed, one escalated,
**26 recorded and not fixed**.

| Family | Copies | Confirmed | Headline |
|---|---|---|---|
| voltage-drop | 14 | 3 | A DC string's drop is printed as a percentage of 240 V — the AC service voltage |
| ocpd-breaker | 38 | 5 | The `Math.ceil(amps/5)*5` rounding that `stdSizes.ts` explicitly forbids is live in 8 places, 3 of them deciding |
| rooftop-adder | 36 | 5 | Three different adder values (33/30/35) and six contradictory applicability rules |
| grounding | 29 | 3 | Table 250.66 has three copies that disagree **at every rung** |
| battery-pcs | 35 | 5 | The BOM sizes the backfeed breaker from PV alone and 120 %-caps it without the battery |
| module-inverter | 44 | 4 | DC fuse derived as Isc × 1.56 with no cap against the module's own maxSeriesFuse |
| conduit-fill | 21 | 1 | A conduit-area table that is Table 4 for no material, keyed by material not conductor count |
| structural | 29 | 2 | **Both handled** — see below |

### Reported CLEAN, and worth as much

Every circular-mils value in all three copies is correct against Ch. 9 Table 8;
`lib/nec/chapter9.ts`'s 50 Table 4 entries are correct and re-derived from the
published interior diameters; `lib/electrical/stdSizes.ts` matches 240.6(A) on all
30 rows; NEC 705.11's 10-ft tap limit is one constant, one authority, correct; the
design ambient is genuinely single-sourced. **A sweep that only reports defects
cannot tell you what is safe.**

---

## SHIPPED — from the sweep

| Commit | What |
|---|---|
| `f800c971` | 🚨 The Kz table went **FLAT at 40 ft in BOTH copies** — 4–11 % low, all unsafe-direction. Second time in two days two agreeing copies were wrong together. **My own mean-roof-height repair is what made it reachable.** |

---

## ACTIVE

| Lane | Shape |
|---|---|
| Duplicated engineering authorities | voltage drop, conduit fill, OCPD/busbar, rooftop adder, grounding, battery/PCS, structural constants, module/inverter limits — still running |

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
