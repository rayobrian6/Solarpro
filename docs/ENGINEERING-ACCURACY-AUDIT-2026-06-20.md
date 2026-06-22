# SolarPro Engineering-Pipeline ACCURACY Audit — Synthesis Report

**Date:** 2026-06-20  ·  **Run:** wf_59bd4606-edd (49 agents, 10 stage-auditors + adversarial verification + synthesis)
**Scope:** sys-config → sizing → electrical → SLD → structural → equipment-schedule → mounting → BOM, plus the equipment-DB sources that feed them. (Permit-planset PDF generation explicitly excluded.)
**Findings:** 92 total across 11 stages. **9 CRITICAL, 31 HIGH.** 37 findings re-run through adversarial confirmation; this report leads with those.

---

## 1. Executive Summary

Two systemic failure modes recur in nearly every stage:

1. **Fabricated defaults presented as engineered fact.** When an equipment lookup misses, almost every stage substitutes a hardcoded magic number (panel Voc 49.6 *or* 41.6, Isc 12.26, inverter 7.6 kW, 5 kWh/battery, 30 psf roof capacity, Douglas-Fir lag withdrawal for every species, 240 V divisor for every system). These render as NEC/ASCE/NDS results with PASS stamps but are unfounded — and **inconsistent across stages**, so the *same* project produces different numbers on different tabs.

2. **No single source of truth.** The same physical quantity is computed by 2–5 independent code paths that disagree: **three** NEC engines (client `computeSystem`, `calculate` route, `sld` route), **three** structural engines (V1/V3/V4), **three** racking databases, **three** conductor-area tables, and **two** 120%-rule implementations. Renderer/report layers frequently recompute values the engine already computed correctly and throw the engine's answer away.

**Highest-liability items:** (a) the SLD 120% interconnection rule uses the main breaker as the busbar rating and drops battery backfeed — a stamped drawing can show "120% PASS" on an over-backfed or down-rated bus; (b) structural roof wind zone is pinned to `interior`, so edge/corner uplift — the values that govern fastener sizing — is **never computed**, and the tab can show PASS on a field-failing design; (c) the **battery-units bug is confirmed end-to-end** — the engineering BOM route never passes `batteryCount`, `computeSystem` collapses multi-unit inverters/batteries to one, and the Equipment Schedule double-counts the other way.

---

## 2. Cross-Cutting ROOT CAUSES

- **RC-1 — Fabricated-defaults-as-fact (9 stages):** `x ?? <magic>` fallbacks flow into NEC/ASCE/NDS math without surfacing that equipment was unresolved, and disagree between stages (panel Voc 49.6 in five page.tsx paths vs 41.6 in engine/SLD route — 19% gap that changes 690.7 string length; Isc 12.26 vs 10.18; inverter AC kW 7.6 vs 8.2; maxInputCurrentPerMppt 13.5 vs 15). **Fix:** hard "unresolved equipment" error/banner; one default table if any.
- **RC-2 — Single-source-of-truth violations:** renderer/report layers recompute & discard the engine's correct result (SLD 120%, Equipment Schedule reads legacy `selectedInverter`, SLD route overrides committed `cs.runs`/AC kW/strings/topology). **Fix:** the engine is the only producer; views consume `systemModel.*`.
- **RC-3 — Per-brand/per-topology gaps:** logic written for split-phase string inverters is silently wrong for micro/optimizer/integrated-bonding/3-phase (drift-guard skips micros; AC OCPD sums all micros into one breaker; optimizers get no line item; ground lug ignores Tesla Ground Lockit; everything ÷240 V). **Fix:** branch on topology + phase everywhere.
- **RC-4 — Power vs energy / unit overloading:** `maxContinuousOutputA` means AC@240 for AC-coupled but DC-terminal current for DC-coupled (only a `backfeedBreakerA:0` sentinel prevents 200 A AC wire sizing); battery BOM prints kW where kWh implied. **Fix:** split field by coupling; print energy for storage.
- **RC-5 — Copy-paste datasheet values / synthetic specs:** 5 different-brand panels share dims/weight; Maxeon 6/7 share Isc/Imp; EcoFlow 11.5/24 kW share DC max; Tesla `dcKwMax = acKw×1.7` is derived not datasheet; Tesla `maxInputCurrentPerMppt` = Isc not Imp. **Fix:** web-verify queue (§5).
- **RC-6 — Silent error swallowing:** V4 structural wraps any crash into `{status:'WARNING'}` and downstream reads `?? 'PASS'`. **Fix:** crashes FAIL closed.

---

## 3. Prioritized Findings (confirmed first)

### CRITICAL — CONFIRMED
| # | Stage | Title | File:Line | Fix direction |
|---|-------|-------|-----------|---------------|
| C1 | sld | 120% rule uses main-breaker amps as busbar rating; can't fail for down-rated bus | `lib/sld-professional-renderer.ts:2401-2402,2422` | Read `systemModel.mainPanelBusAmps`/`interconnectionPass`; add busbar field |
| C2 | structural | Roof wind zone hardcoded `'interior'` — edge/corner uplift never computed | `lib/structural-engine-v4.ts:970` (V3 same) | Derive zone from array position; report governing (corner) uplift |
| C3 | structural | Three live structural engines (V1/V3/V4) give different PASS/FAIL | `structural-calc.ts:185`; `structural-engine-v3.ts:203`; `structural-engine-v4.ts:243` | One engine of record; delete/redirect others |
| C4 | equip-schedule | Null inverter emits fabricated `TBD/TBD` qty-1 row | `lib/engineering/reportGenerator.ts:428-436` | Source from `config.inverters[]`; error if unresolved |
| C5 | equip-schedule | DC/AC disconnect & RSD makes/models hardcoded regardless of brand | `lib/engineering/reportGenerator.ts:449-498` | Brand/topology-aware selection |
| C6 | bom | **Battery qty dropped by route → every battery line forced qty 1** | `app/api/engineering/bom/route.ts:169-292`; `lib/bom-engine-v4.ts:436` | Pass `batteryCount` into V4 input |
| C7 | cross-stage | `computeSystem` collapses multi-unit inverters to one | `lib/computed-system.ts:1156-1158,2098,2218`; `page.tsx:2455` | Sum all `config.inverters[]` units |
| C8 | cross-stage | Three independent NEC engines compute the same quantities divergently | `page.tsx:2640`; `calculate/route.ts:283`; `sld/route.ts:492` | One NEC engine; views consume output |

### CRITICAL — UNCONFIRMED (verify before acting)
| # | Stage | Title | File:Line |
|---|-------|-------|-----------|
| C9 | sld | Battery backfeed datasheet amps dropped before renderer → 120% sum ignores battery | `sld/route.ts:574` vs `400,476`; `renderer:2399-2402` |
| C10 | equip-schedule | Schedule reads legacy `project.selectedInverter`, not `config.inverters[]` | `lib/engineering/designSnapshot.ts:72-76` |

### HIGH — CONFIRMED (selected)
| # | Stage | Title | File:Line |
|---|-------|-------|-----------|
| H1 | equip-db-inv | Enphase IQ8A profile acKw/dcKwMax diverge from db; micros unguarded | `brandProfiles/enphase.ts:25` vs `equipment-db.ts:1908-1916` |
| H2 | equip-db-inv | Drift-guard skips all micro brands | `brandProfileDriftGuard.test.ts:46-56` |
| H4 | equip-db-pan | Q CELLS 400W efficiency 22.4% impossible for area | `equipment-db.ts:434-444` |
| H5 | equip-db-pan | Enphase IQ Battery 10T continuousPowerKw 7.68/32A likely 2× real | `equipment-db.ts:2415-2421` |
| H9 | electrical | Hardcoded equipment-spec fallbacks substitute invented current | `page.tsx:2459,2461,2445,2455`; `route.ts:98-129` |
| H11 | sld | AC output amps hardcodes /240 — wrong for 208V/3-phase | `sld/route.ts:80`; `sldAdapter.ts:31` |
| H12 | structural | Hem-Fir E = 1.5M in V4 vs 1.3M (NDS) | `structural-engine-v4.ts:260` |
| H13 | structural | Lag withdrawal hardcoded DF (246 lb/in) for every species | `structural-calc.ts:572` |
| H14 | structural | V4 silently converts engine crash to WARNING+PASS | `calculate/route.ts:318,329` |
| H17 | equip-schedule | DC conductor double-applies 1.25 (Isc×1.56×1.25) | `reportGenerator.ts:238-239` |
| H19 | mounting | Ground-lug qty `ceil(panels/2)` ignores Tesla Ground Lockit & integrated bonding | `structural-engine-v3.ts:642` |
| H20 | bom | Prices = ~40-SKU static catalog + flat fallbacks ($4,200 any battery) | `bom/distributorPricing.ts:84-445` |
| H23 | cross-stage | SLD route discards committed `cs.runs`; overrides AC kW/strings/topology | `sld/route.ts:191-234` |

*(Full HIGH/MEDIUM/LOW lists in the workflow result; see §5 for the datasheet queue.)*

---

## 4. Data-Flow Integrity Map

```
USER edits System Config → config.inverters[] (model, qty, strings, per-string panelCount), batteryId, batteryCount, panelId
  ├─► [DROP]     Equipment Schedule reads project.selectedInverter/selectedPanel (legacy singular) — config.inverters[] never copied back  [C4,C5,C10]
  ├─► [COLLAPSE] computeSystem uses inverters[0] only → multi-unit AC current/OCPD/backfeed/ratio/qty all for ONE inverter               [C7]
  ├─► [DROP]     BOM route builds V4 input WITHOUT batteryCount → batQty forced to 1 (permit path DOES pass it → divergence)             [C6]
  ├─► [×3 NEC]   client computeSystem | calculate route | sld route key specs independently → OCPD/Voc/Isc/wire differ per TAB           [C8,H22,H23]
  ├─► [DISCARD]  engine computes correct 705.12(B) → SLD renderer recomputes from mainPanelAmps & ignores it; battery backfeed dropped   [C1,C9]
  ├─► [×3 STRUC] tab→V3, /structural→V1, /calculate→V4: different Fb/E/GCp/dead-load/SF; zone pinned interior                            [C2,C3,H12,H13]
  └─► [FABRICATE] lookup-miss → magic default (Voc 49.6/41.6, Isc 12.26/10.18, AC 7.6/8.2, 5kWh, 30psf, DF lag, /240V) rendered as PASS  [RC-1]
```

---

## 5. DATASHEET WEB-VERIFY QUEUE (main-agent online verification — see companion results)

Inverters: Enphase IQ8A/IQ8+/IQ8M (acKw/dcKwMax), APsystems DS3-L, SolarEdge SE7600H short-circuit, Tesla dcKwMax (acKw×1.7?), Tesla maxInputCurrentPerMppt (17A Isc vs 13A Imp), EcoFlow OCEAN Pro 11.5/24 (shared DC + acOutputCurrentMax), Growatt MIN per-MPPT.
Panels: Panasonic EverVolt 410 (Voc 51.9 + HJT), Q CELLS 400 (eff 22.4%), Maxeon 6/7 (shared Isc/Imp), Maxeon 3 (dims), Trina/REC/Silfab (copy-paste dims/weight).
Batteries: Enphase IQ Battery 10T (7.68 kW), Pylontech Force-H2 (continuous), Tesla Powerwall 3 (kW vs kWh).
Mounting: IronRidge XR100 (profile/span/weight), Tesla Comp-Rafter/Tile allowables, Tesla Ground Lockit (≤72).
Code: NEC Ch.9 Table 5 areas, NEC 240.4(D) caps, ASCE 7-22 Fig 29.4-7 GCrn, NDS 2018 Table 4A Hem-Fir E, NDS Table 12.2A lag withdrawal, ASCE 7-22 §7.4 Cs.

---

## Suggested fix sequencing
1. **Battery bug (C6, C7)** — pass `batteryCount`, sum multi-unit inverters.
2. **SLD 120% (C1, C9) + structural zone (C2)** — permit/fire liability.
3. **Equipment Schedule source (C4, C5, C10)** — wire `config.inverters[]` into the snapshot.
4. **Engine unification (C3, C8)** — one NEC + one structural engine of record.
5. **Drift-guard for micros (H2)** then reconcile H1/H3/H7 against datasheets.
6. **Remove fabricated fallbacks → fail-on-unresolved (RC-1, H9, H22).**
