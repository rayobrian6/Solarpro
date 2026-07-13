# Hybrid Planset Audit — backlog (golden 3-brand hybrid: roof micro + ground string + fence optimizer)

Rendered all 25 sheets, read each PNG, confirmed each root in source. 2026-07-13.

## Two systemic roots (highest leverage — corrupt many sheets)
1. **Whole system treated as one microinverter fleet.** Consumers read `isMicro`/topology
   from the FIRST (roof) inverter and multiply by the PROJECT panel count (91). → BOM lists
   91 Enphase micros; PV-6 "MICROINVERTERS (×91)" + "MAX DC V N/A"; SCHED "10 AC branches".
2. **Per-sub DC kW prorated by panel fraction**, not computed per sub. `subSystemSheets.ts:142-145`
   does `projectDcKw × subPanels/projectPanels` → roof 20.23 kW on cover/PV-1/PV-1B/PV-4A/PE-1
   vs SCHED true 20.64 (48×430). Every per-sub kW on the cover is individually wrong.

## P0 — blockers
- **SCHED BOM = 91 Enphase IQ8M micros** (whole hybrid). `bomForPermit.ts:378-383` (isMicro from
  firstInv; deviceCount=totalPanels) → `bom-engine-v4.ts:458`. Fix: per-sub BOM loop.
- **PV-6 "MICROINVERTERS (×91)" + "MAX DC V N/A"**. `compliancePages.ts:263,271-272,300`. Fix:
  per-sub rows; DC V = max across string/optimizer subs.
- **Interconnection self-contradiction**: cover "EXCEEDS 120% — SUPPLY-SIDE REQ'D" + PV-4A red
  "BUSBAR RULE ✗ FAIL / pending", yet E-1/PV-4A/PV-6 draw a LOAD-SIDE breaker. Resolve once
  (supply-side if 120% fails) and drive all sheets; never ship FAIL/pending on an issued set.

## P1 — major
- **Roof count 48 vs 40**: PV-1 header/callout=48 but its table/drawing=40 (`roof.ts:147` vs
  `:1236-1248`, regPanels that landed on the plane); PV-1B=48. Reconcile + guard when regPanels≠total.
- **Per-sub kW proration** (`subSystemSheets.ts:142-145`) — see root #2.
- **PV-1B branch-legend Wp=421W for a 430W module** (`arrayPages.ts:298-302`, kW÷count on prorated kW).
- **E-1 empty CONDUIT & CONDUCTOR SCHEDULE** (full-height blank, ~30% of sheet).
  `sld-professional-renderer.ts:3404-3475` (schedRuns empty). Populate lane runs from
  conductorAuthority OR collapse to note height when empty.
- **SCHED "10 AC branches exceed IQ Combiner 6C"** — design has 5 roof branches; planner runs over
  all 91. `integratedEquipment.ts:32,36-38`. Scope branch planning to the roof (micro) sub.
- **PE-1 "TRUSS SPAN 73.0 ft"** = roof-polygon min bbox, not a rafter span. `structuralInput.ts:52-60`
  → `certPages.ts:457,535`. Derive real span or clamp+flag.
- **PV-4C lag SF**: note says "min 2.0" but reports SF 1.01 as passing "min 1.0" — contradictory.
- **PV-4B EGC "#12 bare Cu" for 155A feeder** (250.122 wants ~#6); row also lists "1#8 GND". Single-source.
- **PV-4A vs PV-4B vs PV-6 AC feeder disagree**: 125.1/156.4/175A vs 110.4/155A. Single-source feeder A+OCPD.
- **PV-0 30.03 kW AC vs PV-4A 27.64 kW** — roof micro AC nameplate differs. Single AC-kW source.
- **PV-0 DESIGN CRITERIA "SYSTEM TYPE: SOLAR FENCE"** + fence-only params on a hybrid cover.
  `coverSheet.ts` keyed on canonical.systemType(→fence). Render hybrid-aware criteria.

## P2 — polish
- "NEC NEC 2023" doubled (`electricalPages.ts:61,111,234,237` prepend + `roofProject.ts:121` value).
- IFC 2021 (cover/PV-1B) vs IFC 2024 (title-block footer). Single code-cycle constant.
- Access pathway 18" (PV-1) vs 36" (PV-1B). One source.
- V-DROP column always "—" (PV-4A/4B/SCHED). Compute or drop.
- PV-5 L-18 GEC placard renders empty body (`compliancePages.ts` labels array).
- PV-1 site plan: ground+fence subs float as orphan glyphs vs roof scale (`hybridOverlay.ts:126-210`).
- Fence length 3 forms (52.2 LF / 52'-2" / 52' LF). One formatter.
- PV-1 SYSTEM DATA module/inverter = "SEE EQUIPMENT SCHEDULE" while title block names them.
- PV-0 vicinity map = empty gray placeholder.

## Already landed this session (verify against current dev, audit rendered pre-commit)
- Fence elevation ✓ (vertical panels, driven pile, no concrete).
- Ground array + RT-MINI/IRONRIDGE leak + gps-array id leak ✓ (`af3d3fed`).
- Per-sub SLD equipment + fail-loud marker ✓ (`1fe02b05`).
- Fence/ground top-down + recursive thumbnails + fence length ✓ (`1fe02b05`).

## Top systemic fixes (next waves)
1. Hybrid-aware BOM + PV-6 + combiner-branch scoping (kills 91-micros / MICROINVERTERS×91 / 10-branches).
2. Per-sub kW from panels×watts (kills the 20.23-vs-20.64 divergence across 5 sheets).
3. Resolve interconnection once + single-source AC feeder A/OCPD/EGC.
4. Reconcile roof count + branch Wp; populate/collapse E-1 conduit schedule; code-cycle strings.
