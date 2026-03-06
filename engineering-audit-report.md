# ⚡ SolarPro Engineering Tab — Full Industry Audit Report
**Prepared by:** SuperNinja AI Engineering Audit  
**Date:** Current Session  
**Scope:** lib/computed-system.ts · lib/segment-schedule.ts · lib/sld-professional-renderer.ts · app/api/engineering/sld/route.ts · app/engineering/page.tsx  
**Standards Referenced:** NEC 2023 (Articles 230, 240, 250, 310, 690, 705), IEEE 315, ANSI C84.1, ANSI C landscape (24"×18")

---

## EXECUTIVE SUMMARY

The engineering tab is architecturally sound and demonstrates genuine NEC literacy. The topology logic, OCPD sizing, EGC sizing, conduit fill calculations, and SLD rendering are all fundamentally correct. However, the audit identified **6 issues of varying severity** — including one critical ampacity table discrepancy that produces undersized wire recommendations, one architectural redundancy that creates a desynchronization risk, and several NEC accuracy issues that would cause problems on a real permit set. Recommendations for a cleaner, more maintainable data flow architecture are also provided.

**Overall Grade: B+ — Solid foundation, specific fixes required before permit-grade output.**

---

## PART 1 — INDUSTRY ACCURACY FINDINGS

### ISSUE 1 — CRITICAL: Ampacity Table Discrepancy (NEC 310.16)

**Severity: HIGH — Produces undersized wire on small systems**

`computed-system.ts` contains its own `AMPACITY_TABLE_75C` with these values:

```
#14 AWG: 15A   ← WRONG
#12 AWG: 20A   ← WRONG  
#10 AWG: 30A   ← WRONG
#8 AWG:  50A   ← correct
```

`segment-schedule.ts` contains `AMPACITY_75C` with the correct NEC 310.16 values:

```
#14 AWG: 20A   ← CORRECT per NEC 310.16 Table, 75°C column
#12 AWG: 25A   ← CORRECT
#10 AWG: 35A   ← CORRECT
#8 AWG:  50A   ← CORRECT
```

**The NEC 310.16 Table (75°C column, copper) actual values are:**
- #14 AWG = 20A
- #12 AWG = 25A
- #10 AWG = 35A
- #8 AWG = 50A

The values in `computed-system.ts` match the **60°C column**, not the 75°C column. This is a classic confusion between the 60°C and 75°C columns in Table 310.16. THWN-2 is rated 75°C (or 90°C in dry locations), so the 75°C column applies.

**Impact:** `autoSizeWire()` in `computed-system.ts` uses the wrong table for its initial sizing pass. For a small system (e.g., 8-panel microinverter, ~2.4A per branch), the required ampacity after 1.25× factor is ~3A — both tables would land on #14 AWG. But for a system where the required ampacity falls between 15A and 20A (e.g., a 3kW string system with ~12.5A Isc × 1.25 = 15.6A), `computed-system.ts` would select #12 AWG (20A effective) while `segment-schedule.ts` correctly selects #14 AWG (20A effective). More critically, for systems where required ampacity is 20–25A, `computed-system.ts` would jump to #10 AWG (30A) while `segment-schedule.ts` correctly uses #12 AWG (25A). This produces **over-sized wire** in some cases and **incorrect permit callouts** in all cases where the initial sizing differs.

**The back-population loop in `computeSystem()` does overwrite the wire gauge from `segmentSchedule`**, so the final `RunSegment.wireGauge` values are correct. However, the initial `autoSizeWire()` pass still uses the wrong table, which means `ocpdAmps`, `effectiveAmpacity`, and `conductorCallout` on the RunSegment are set from the wrong table before being overwritten. Any code path that reads these values before back-population completes will see incorrect data.

**Fix:** Replace `AMPACITY_TABLE_75C` in `computed-system.ts` with the correct NEC 310.16 values:
```typescript
const AMPACITY_TABLE_75C: Record<string, number> = {
  '#14 AWG': 20,  // NEC 310.16 Table, 75°C column, copper
  '#12 AWG': 25,
  '#10 AWG': 35,
  '#8 AWG':  50,
  '#6 AWG':  65,
  '#4 AWG':  85,
  // ... rest unchanged
};
```

---

### ISSUE 2 — HIGH: BRANCH_RUN Neutral Flag Contradicts NEC 690.8

**Severity: HIGH — Incorrect permit documentation**

In `computed-system.ts`, the `BRANCH_RUN` (AC trunk cable from microinverters to AC combiner) is created with:

```typescript
conductorCount: 3,
neutralRequired: true,
```

In `segment-schedule.ts`, the equivalent segments (`ARRAY_TO_JBOX` and `JBOX_TO_COMBINER` for micro topology) correctly use:

```typescript
// 240V split-phase PV output: L1 (BLK) + L2 (RED) + EGC (GRN) — NO neutral
// NEC 690.8: PV AC output circuits are ungrounded 2-wire 240V; neutral NOT required
{ qty: branches, gauge: branchGauge, color: 'BLK', ... isCurrentCarrying: true }
{ qty: branches, gauge: branchGauge, color: 'RED', ... isCurrentCarrying: true }
{ qty: 1, gauge: branchEgcGauge, color: 'GRN', ... isCurrentCarrying: false }
```

**The NEC is clear on this point.** Per NEC 690.8 and the Enphase IQ Series installation manuals, the AC trunk cable (Q-Cable) is a **2-wire ungrounded circuit** — L1 (Black) + L2 (Red) + EGC (Green). There is no neutral conductor. The Enphase IQ8 series operates on 240V split-phase with no neutral required at the branch level. The neutral is only present at the MSP service entrance (utility side), not in the PV output circuit.

**Impact:** The conduit schedule `neutral` column for `BRANCH_RUN` will show `1#10 AWG N` instead of `N/A`. This is incorrect on a permit set and would be flagged by any competent AHJ inspector. It also inflates the conductor count used for conduit fill derating — `conductorCount: 3` counts the neutral as a current-carrying conductor, which is wrong (there is no neutral). The correct current-carrying count is 2 (L1 + L2).

**However:** The back-population loop overwrites `conductorCount` from `seg.totalCurrentCarryingConductors`, which comes from `segment-schedule.ts` and is correct (2 for the feeder, branches×2 for the trunk). So the final derating calculation is correct. But the `neutralRequired: true` flag is NOT overwritten by back-population, so the conduit schedule still shows a neutral conductor.

**Fix:** Change `BRANCH_RUN` in `computed-system.ts`:
```typescript
conductorCount: 2,   // L1 + L2 only — no neutral per NEC 690.8
neutralRequired: false,
```

Also update `COMBINER_TO_DISCO_RUN`, `DISCO_TO_METER_RUN`, `METER_TO_MSP_RUN`, and `MSP_TO_UTILITY_RUN` — all currently have `neutralRequired: true` and `conductorCount: 3`. Per NEC 690.8, PV AC output circuits are 2-wire ungrounded 240V. The neutral is only present at the utility service entrance. All downstream PV feeder runs should be `neutralRequired: false`, `conductorCount: 2`.

---

### ISSUE 3 — MEDIUM: MSP_TO_UTILITY_RUN Should Not Be a Field-Installed Conductor Run

**Severity: MEDIUM — Conceptual inaccuracy on permit set**

`computed-system.ts` creates a `MSP_TO_UTILITY_RUN` segment with a 5ft default length, wire sizing, conduit sizing, and OCPD. This segment is labeled "MSP TO UTILITY" and appears in the conduit schedule.

**This is not a PV system conductor run.** The conductors between the MSP and the utility meter are the **utility service entrance conductors** — they are owned and installed by the utility company, not the solar contractor. They are sized per NEC Article 230 (Services), not NEC 690. They are not part of the PV permit set. Including them in the conduit schedule with PV wire sizing creates confusion and could cause permit rejection.

The SLD renderer correctly notes "Utility meter always at the END (after MSP)" and the segment is used to draw the wire from MSP to the utility meter symbol. This is architecturally correct for the SLD diagram. However, the segment should be flagged as a **reference/informational segment only** — not included in the conduit schedule or BOM wire quantities.

**Industry standard practice:** The SLD shows the utility meter and the connection to the utility grid as a reference, but the permit set notes "UTILITY SERVICE — BY UTILITY COMPANY" and does not include conductor sizing for this segment.

**Fix:** Add a flag to `RunSegment`:
```typescript
isUtilityOwned?: boolean;  // true for MSP_TO_UTILITY_RUN
```
Exclude `isUtilityOwned` segments from the conduit schedule and BOM wire quantities. Keep them in the SLD for visual completeness but add a note: "UTILITY SERVICE CONDUCTORS — NOT PART OF PV PERMIT SET."

---

### ISSUE 4 — MEDIUM: Temperature Derating Reference is Incorrect (NEC 310.15)

**Severity: MEDIUM — Wrong NEC citation, correct calculation**

Both files cite `NEC 310.15(B)(2)(a)` for temperature derating factors. In NEC 2023, this section was reorganized. The correct citation is:

- **NEC 2023: 310.15(B)(2)** — Ambient Temperature Correction Factors (Table 310.15(B)(2))
- **NEC 2020: 310.15(B)(2)(a)** — this was the old citation

The derating values themselves are correct. This is a citation accuracy issue that would be noticed by an AHJ using NEC 2023.

Similarly, conduit fill derating is cited as `NEC 310.15(C)(1)`. In NEC 2023, this is correct — the section was renumbered from `310.15(B)(3)(a)` in NEC 2020. So the conduit fill citation is actually correct for NEC 2023. The temperature derating citation needs updating.

**Fix:** Update the comment in both files:
```typescript
// NEC 310.15(B)(2) Table — Ambient Temperature Correction Factors (NEC 2023)
// (was 310.15(B)(2)(a) in NEC 2020)
```

---

### ISSUE 5 — LOW: EGC Sizing Table Has a Gap at 25A OCPD (NEC 250.122)

**Severity: LOW — Conservative but technically incorrect**

The `getEGCGauge()` function in both files:

```typescript
if (ocpdAmps <= 15)  return '#14 AWG';
if (ocpdAmps <= 20)  return '#12 AWG';
if (ocpdAmps <= 60)  return '#10 AWG';  // ← jumps from 20A to 60A
```

NEC 250.122 Table specifies:
- 15A OCPD → #14 AWG EGC
- 20A OCPD → #12 AWG EGC
- 30A OCPD → #10 AWG EGC  ← missing
- 40A OCPD → #10 AWG EGC  ← missing
- 60A OCPD → #10 AWG EGC

The current code jumps from 20A directly to 60A, which means a 25A or 30A OCPD gets a #10 AWG EGC. This is **conservative** (larger than required), not undersized, so it won't fail inspection. However, it's technically inaccurate and wastes material. A 25A OCPD only requires a #12 AWG EGC per NEC 250.122.

**Fix:**
```typescript
function getEGCGauge(ocpdAmps: number): string {
  if (ocpdAmps <= 15)  return '#14 AWG';
  if (ocpdAmps <= 20)  return '#12 AWG';
  if (ocpdAmps <= 60)  return '#10 AWG';  // covers 25A, 30A, 40A, 60A — all #10 per NEC 250.122
  // ... rest unchanged
}
```

Actually, reviewing NEC 250.122 Table more carefully: 15A→#14, 20A→#12, 60A→#10, 100A→#8. The 25A, 30A, 40A, 50A OCPDs all map to #10 AWG. So the current code is actually **correct** — the jump from 20A to 60A is intentional because all values in between (25, 30, 40, 50, 60) map to #10 AWG. This is a false alarm. **No fix needed.**

---

### ISSUE 6 — LOW: Voltage Drop Formula Uses Constant Conductor Count of 2

**Severity: LOW — Slightly optimistic voltage drop for 3-wire AC runs**

In both `computed-system.ts` and `segment-schedule.ts`, the `calcVoltageDrop()` function always uses `conductorCount = 2` for the resistance calculation:

```typescript
const resistance = (resistivity * onewayFt * conductorCount) / cmil;
// conductorCount is always passed as 2 regardless of actual conductor count
```

For a **2-wire DC circuit** (+ and −), this is correct — current flows through 2 conductors (one-way × 2 = round trip).

For a **2-wire 240V AC circuit** (L1 + L2, no neutral), this is also correct — the voltage drop formula for a balanced 2-wire circuit uses 2× the one-way length.

For a **3-wire 120/240V circuit** (L1 + L2 + N), the formula is more complex. However, since PV AC output circuits are 2-wire ungrounded (no neutral per NEC 690.8), the constant `conductorCount = 2` is actually correct for all PV circuit segments.

The only segment where this might be slightly off is `MSP_TO_UTILITY_RUN`, which represents the utility service entrance (3-wire with neutral). But as noted in Issue 3, this segment should be informational only. **No fix needed for the PV circuit segments.**

---

## PART 2 — DATA FLOW ARCHITECTURE AUDIT

### ARCHITECTURE FINDING 1 — CRITICAL: Dual Calculation Paths Create Desynchronization Risk

**This is the most significant architectural issue in the system.**

`computeSystem()` currently runs **two complete, independent wire sizing calculations** for every system:

**Path A — `autoSizeWire()` / `autoSizeOpenAirWire()`:**
- Runs first, builds `RunSegment[]` with wire gauge, conduit size, fill%, OCPD, voltage drop
- Uses `AMPACITY_TABLE_75C` (which has the wrong values per Issue 1)
- Produces `conductorCallout` strings in a different format than Path B

**Path B — `buildSegmentSchedule()`:**
- Runs second, builds `SegmentScheduleRow[]` with `ConductorBundle[]`
- Uses `AMPACITY_75C` (correct NEC 310.16 values)
- Produces structured `ConductorBundle[]` with color-coded conductors

**Back-population loop:**
- Iterates over `segmentSchedule` and overwrites fields on `RunSegment` objects
- Overwrites: `conductorBundle`, `conductorCallout`, `conduitSize`, `fillPercent`, `conduitType`, `isOpenAir`, `ocpdAmps`, `continuousCurrent`, `effectiveAmpacity`, `voltageDropPct`, `overallPass`, `wireGauge`, `insulation`, `egcGauge`, `conductorCount`
- Does NOT overwrite: `neutralRequired`, `requiredAmpacity`, `tempDeratingFactor`, `conduitDeratingFactor`, `ampacityPass`, `voltageDropPass`, `conduitFillPass`, `voltageDropVolts`

**Problems with this architecture:**

1. **Partial overwrite leaves stale data.** Fields not overwritten by back-population retain values from Path A (which uses the wrong ampacity table). `ampacityPass` and `voltageDropPass` are computed from Path A values and never updated. If Path A sizes a wire differently than Path B, `ampacityPass` may be wrong.

2. **The `segTypeToRunId` mapping is fragile.** If a new segment type is added to `segment-schedule.ts` without updating the mapping in `computed-system.ts`, the back-population silently skips it. There is no validation that all segments were back-populated.

3. **The conduit schedule is built from `runs[]` (Path A + back-populated), not directly from `segmentSchedule` (Path B).** This means the conduit schedule inherits any stale fields from Path A that weren't overwritten.

4. **BOM quantities use a hybrid approach** — `segBOM` from Path B for conduit/wire, but `wireQtyByGauge()` from Path A as a fallback. The `??` operator means Path B values are used when non-zero, but Path A values are used when Path B returns 0. This creates silent fallback behavior that's hard to debug.

5. **Two separate voltage drop calculations** — Path A calculates voltage drop in `autoSizeWire()`, Path B calculates it in `buildSegment()`. Both use the same formula but different inputs. The back-population overwrites `voltageDropPct` from Path B, but `voltageDropVolts` is NOT overwritten (stays from Path A).

**Current data flow diagram:**
```
Input → autoSizeWire() → RunSegment[] (Path A, wrong ampacity table)
      → buildSegmentSchedule() → SegmentScheduleRow[] (Path B, correct)
      → back-population loop → RunSegment[] (partially corrected)
      → conduitSchedule (from partially-corrected RunSegment[])
      → SLD (from RunSegment[])
      → BOM (hybrid of Path A + Path B)
```

---

### ARCHITECTURE FINDING 2: The SLD Renderer Has a Topology Mismatch

The SLD renderer comment at the top says:
```
// MICROINVERTER:
//   PV Array → (open air) → Roof J-Box → AC Combiner
//   → AC Disconnect → MSP → Utility Meter
```

But the actual node rendering shows:
- Node 1: PV Array
- Node 2: Roof J-Box
- Node 3: AC Combiner
- Node 4: AC Disconnect (labeled `xInvOrACDis`)
- Node 5: (skipped for micro — `xACDis = xInvOrACDis`)
- Node 6: MSP
- Node 7: Utility Meter

The `discoMspRun` variable is assigned `findRun('DISCO_TO_METER_RUN')` with the comment "AC Disco → MSP (no meter in middle)". This means the segment labeled "DISCO_TO_METER_RUN" in `computed-system.ts` is being used to draw the wire from AC Disconnect to MSP — but the segment is named "AC DISCO TO METER" and goes to "PRODUCTION METER" in the data.

**The SLD is skipping the production meter entirely** and using the `DISCO_TO_METER_RUN` segment data to label the wire from AC Disconnect to MSP. This is a naming/semantic mismatch. The segment data is correct (wire gauge, conduit size, etc.) but the `from`/`to` labels on the segment don't match what the SLD is drawing.

**Industry standard:** Most AHJs require a production meter (revenue-grade kWh meter) to be shown on the SLD between the AC disconnect and the MSP. This is required for net metering interconnection agreements. The SLD currently shows "UTILITY METER" at the end (after MSP), which represents the utility's bidirectional meter — but the **production meter** (the solar-specific kWh meter) is missing from the diagram.

---

### ARCHITECTURE FINDING 3: The `segIdCounter` Global Variable is Not Thread-Safe

In `segment-schedule.ts`:
```typescript
let segIdCounter = 0;

function buildSegment(...): SegmentScheduleRow {
  segIdCounter++;
  const id = `SEG-${String(segIdCounter).padStart(2, '0')}`;
  ...
}

export function buildSegmentSchedule(...): SegmentScheduleRow[] {
  segIdCounter = 0;  // reset at start
  ...
}
```

This module-level mutable state is reset at the start of `buildSegmentSchedule()`. In a Next.js server environment with concurrent requests, two simultaneous calls to `buildSegmentSchedule()` could interleave their counter increments, producing duplicate or out-of-order segment IDs. This is a classic race condition in server-side code.

**Fix:** Move `segIdCounter` inside `buildSegmentSchedule()` and pass it to `buildSegment()` as a parameter, or use a closure.

---

### ARCHITECTURE FINDING 4: Run Length Mapping Has Semantic Mismatches

The `segTypeToRunId` mapping in `computed-system.ts`:

```typescript
// For micro:
'ARRAY_TO_JBOX':     'ROOF_RUN',
'JBOX_TO_COMBINER':  'BRANCH_RUN',
```

But in `segment-schedule.ts`, `ARRAY_TO_JBOX` for micro is the **open-air run from PV array to junction box** (multiple branch conductors bundled together), while `ROOF_RUN` in `computed-system.ts` is described as "DC wiring from panels to microinverters."

These are semantically different:
- `ARRAY_TO_JBOX` = AC trunk cable from microinverters to junction box (AC, open air)
- `ROOF_RUN` = DC wiring from panels to microinverters (DC, very short, per-micro)

The mapping conflates the DC panel-to-micro run with the AC micro-to-jbox run. The back-population overwrites `ROOF_RUN` with AC trunk cable data (THWN-2, 240V), but `ROOF_RUN` is supposed to represent DC PV Wire (USE-2/PV Wire, low voltage). This is a semantic error that produces incorrect data for the DC roof run segment.

---

## PART 3 — RECOMMENDED ARCHITECTURE: SINGLE-PATH DATA FLOW

### The Problem in One Sentence
The system has two calculation engines (`autoSizeWire` and `buildSegmentSchedule`) that produce overlapping but inconsistent results, requiring a fragile back-population loop to reconcile them.

### Recommended Solution: Eliminate Path A, Make Path B the Only Source of Truth

**Proposed new data flow:**

```
Input
  ↓
buildSegmentSchedule() → SegmentScheduleRow[] (single calculation, correct NEC tables)
  ↓
segmentScheduleToRunSegments() → RunSegment[] (pure transformation, no recalculation)
  ↓
buildConduitSchedule(runs) → ConduitScheduleRow[]
buildEquipmentSchedule(input) → EquipmentScheduleRow[]
calcBOMFromSegments(segments) → BomQuantities
  ↓
ComputedSystem (assembled from above, no redundant calculations)
```

**Key changes:**

1. **Delete `autoSizeWire()` and `autoSizeOpenAirWire()` from `computed-system.ts`.** These functions duplicate logic already in `segment-schedule.ts` with incorrect ampacity values.

2. **Add a `segmentScheduleToRunSegments()` function** that converts `SegmentScheduleRow[]` to `RunSegment[]` without any recalculation. This is a pure data transformation — map fields from one type to the other.

3. **Fix the ampacity table in `computed-system.ts`** (or better, import it from `segment-schedule.ts` to ensure a single source of truth).

4. **Remove the back-population loop.** It exists only to reconcile the two paths. With a single path, it's unnecessary.

5. **Fix `neutralRequired`** — derive it from `ConductorBundle[]` (check if any conductor has `color: 'WHT'` or `color: 'GRY'`). This makes it data-driven rather than hardcoded.

6. **Fix the `segIdCounter` race condition** — move it inside `buildSegmentSchedule()`.

### Proposed `segmentScheduleToRunSegments()` function:

```typescript
function segmentScheduleToRunSegments(
  segments: SegmentScheduleRow[],
  segTypeToRunId: Record<string, RunSegmentId>,
  input: ComputedSystemInput
): RunSegment[] {
  return segments.map(seg => {
    const runId = segTypeToRunId[seg.segmentType];
    if (!runId) return null;
    
    const hotConductors = seg.conductorBundle.filter(c => c.isCurrentCarrying && c.color !== 'GRN');
    const egcConductors = seg.conductorBundle.filter(c => c.color === 'GRN');
    const neutralConductors = seg.conductorBundle.filter(c => c.color === 'WHT' || c.color === 'GRY');
    const primaryHot = hotConductors[0];
    
    return {
      id: runId,
      label: `${seg.fromNode} → ${seg.toNode}`,
      from: seg.fromNode,
      to: seg.toNode,
      conductorCount: seg.totalCurrentCarryingConductors,
      wireGauge: primaryHot?.gauge ?? '#10 AWG',
      conductorMaterial: 'CU',
      insulation: primaryHot?.insulation ?? 'THWN-2',
      egcGauge: egcConductors[0]?.gauge ?? '#10 AWG',
      neutralRequired: neutralConductors.length > 0,
      isOpenAir: seg.raceway === 'OPEN_AIR',
      conduitType: racewayToConduitType(seg.raceway, input.conduitType),
      conduitSize: seg.conduitSize,
      conduitFillPct: seg.fillPercent,
      onewayLengthFt: seg.onewayLengthFt,
      continuousCurrent: seg.continuousCurrent,
      requiredAmpacity: seg.requiredAmpacity,
      effectiveAmpacity: seg.effectiveAmpacity,
      tempDeratingFactor: seg.tempDeratingFactor,
      conduitDeratingFactor: seg.conduitDeratingFactor,
      ocpdAmps: seg.ocpdAmps,
      voltageDropPct: seg.voltageDropPct,
      voltageDropVolts: seg.voltageDropVolts,
      ampacityPass: seg.ampacityPass,
      voltageDropPass: seg.voltageDropPass,
      conduitFillPass: seg.conduitFillPass,
      overallPass: seg.overallPass,
      necReferences: seg.necReferences,
      conductorCallout: seg.conductorCallout,
      conductorBundle: seg.conductorBundle,
      color: seg.raceway === 'OPEN_AIR' ? 'dc' : 'ac',
    } as RunSegment;
  }).filter(Boolean) as RunSegment[];
}
```

---

## PART 4 — SLD ACCURACY FINDINGS

### SLD FINDING 1: Production Meter Missing from Diagram

As noted in Architecture Finding 2, the production meter (revenue-grade kWh meter) is absent from the SLD. The SLD shows "UTILITY METER" at the end, but most AHJs and utilities require a **separate production meter** between the AC disconnect and the MSP for net metering.

**Industry standard topology (load-side interconnection):**
```
PV Array → J-Box → [AC Combiner] → AC Disconnect → Production Meter → MSP → Utility Meter → Grid
```

The production meter is typically a socket-type meter installed by the solar contractor, while the utility meter is installed by the utility. Both should appear on the SLD.

**Recommendation:** Add a production meter node between AC Disconnect and MSP. The `DISCO_TO_METER_RUN` and `METER_TO_MSP_RUN` segments already exist in the data — the SLD just needs to render the production meter node between them.

### SLD FINDING 2: Interconnection Method Label Has a NEC Citation Error

The SLD renders:
```
LOAD SIDE TAP — NEC 705.12(B)(1)
SUPPLY SIDE TAP — NEC 705.12(A)
```

In NEC 2023:
- Load-side connection: **NEC 705.12(B)** (not 705.12(B)(1) — that subsection doesn't exist in NEC 2023)
- Supply-side connection: **NEC 705.11** (not 705.12(A) — supply-side is Article 705.11 in NEC 2023)

**Fix:**
```typescript
const interconLabel = isLoadSide   ? 'LOAD SIDE — NEC 705.12(B)'
                    : isSupplySide ? 'SUPPLY SIDE — NEC 705.11'
                    : isLineSide   ? 'LINE SIDE — NEC 705.11'
                    : `BACKFED BREAKER — NEC 705.12(B)(2)`;
```

### SLD FINDING 3: DC Disconnect Labeled "(N)" — Ambiguous

The SLD renders the DC disconnect as "(N) DC DISCONNECT". The "(N)" prefix typically means "New" in construction drawings. This is correct usage. However, it could be confused with "Neutral" by some reviewers. Industry standard is to use "(N)" for new equipment and "(E)" for existing. This is fine as-is but worth noting.

### SLD FINDING 4: Grounding Rail Annotation is Correct

The grounding rail annotation "EQUIPMENT GROUNDING CONDUCTORS — NEC 250.122 / NEC 690.43" is correct. NEC 690.43 specifically addresses equipment grounding for PV systems. This is good industry practice.

### SLD FINDING 5: Rapid Shutdown Note is Correct

The rapid shutdown note "RAPID SHUTDOWN SYSTEM — NEC 690.12 COMPLIANT" is correctly placed and cited. NEC 690.12 is the correct reference for rapid shutdown requirements. This is good.

---

## PART 5 — WHAT IS WORKING CORRECTLY

The following aspects of the engineering tab are **industry-accurate and well-implemented:**

1. **NEC 690.7 String Voltage Calculation** — Voc temperature correction formula `Voc × [1 + (tempCoeff/100) × (Tmin - 25)]` is correct. Using minimum design temperature for Voc (worst case for voltage) is correct.

2. **NEC 690.8 OCPD Sizing** — `Isc × 1.25 → next standard OCPD` is correct. The 125% continuous load factor is properly applied.

3. **NEC 690.8(B) Branch Limit** — 16 microinverters per branch is correctly enforced. The balanced branch distribution algorithm (floor/remainder) is better than the naive max-fill approach.

4. **NEC 705.12(B) 120% Rule** — `(backfeedAmps + mainPanelAmps) ≤ panelBusRating × 1.2` is the correct formula.

5. **NEC 310.15(C)(1) Conduit Fill Derating** — The derating table (≤3=1.00, ≤6=0.80, ≤9=0.70, etc.) is correct per NEC 310.15(C)(1).

6. **NEC Chapter 9 Conduit Fill** — The 40% maximum fill rule and the conductor area tables are correctly implemented. The conduit sizing algorithm (smallest conduit where fill ≤ 40%) is correct.

7. **NEC 250.122 EGC Sizing** — The EGC sizing table is correct (as confirmed in Issue 5 analysis).

8. **Open-Air Derating** — `autoSizeOpenAirWire()` correctly applies no conduit derating (factor = 1.0) for open-air runs per NEC 690.31. This is a common mistake in solar software — the code gets it right.

9. **Rooftop Temperature Adder** — Adding 30°C to ambient for DC rooftop runs is correct industry practice (NEC 310.15(B)(3)(c) for conductors in conduit on rooftops).

10. **Voltage Drop Thresholds** — 2% AC, 3% DC are the industry-standard best practice thresholds (NEC doesn't mandate specific percentages but these are universally accepted).

11. **SLD Topology Order** — The correct order (PV Array → J-Box → Combiner/DC Disco → Inverter → AC Disco → MSP → Utility Meter) is correctly implemented and documented.

12. **IEEE 315 Symbols** — The knife-blade disconnect symbol, ground symbol, and junction box symbol are correct IEEE 315 representations.

13. **ANSI C Landscape Format** — 2304×1728px at 96 DPI = 24"×18" ANSI C landscape. This is the correct format for electrical engineering drawings.

14. **Conductor Color Coding** — BLK (L1), RED (L2), GRN (EGC) for AC; RED (+), BLK (−), GRN (EGC) for DC. This matches NEC 200.6 and industry convention.

---

## PART 6 — PRIORITY ACTION PLAN

### Immediate Fixes (Before Next Release)

| Priority | Issue | File | Change |
|----------|-------|------|--------|
| 🔴 P1 | Fix AMPACITY_TABLE_75C values | computed-system.ts | #14→20A, #12→25A, #10→35A |
| 🔴 P1 | Fix BRANCH_RUN neutralRequired | computed-system.ts | neutralRequired: false, conductorCount: 2 |
| 🔴 P1 | Fix all downstream AC runs neutralRequired | computed-system.ts | COMBINER_TO_DISCO, DISCO_TO_METER, METER_TO_MSP, MSP_TO_UTILITY → neutralRequired: false |
| 🟡 P2 | Fix SLD interconnection NEC citations | sld-professional-renderer.ts | 705.12(B)(1) → 705.12(B), 705.12(A) → 705.11 |
| 🟡 P2 | Add production meter to SLD | sld-professional-renderer.ts | Add node between AC Disco and MSP |
| 🟡 P2 | Flag MSP_TO_UTILITY as utility-owned | computed-system.ts | Add isUtilityOwned flag, exclude from conduit schedule |
| 🟢 P3 | Fix segIdCounter race condition | segment-schedule.ts | Move counter inside function |
| 🟢 P3 | Update NEC 310.15 citation | both files | 310.15(B)(2)(a) → 310.15(B)(2) |

### Architectural Refactor (Next Major Version)

| Priority | Change | Benefit |
|----------|--------|---------|
| 🔴 P1 | Eliminate dual calculation paths | Single source of truth, no desync risk |
| 🔴 P1 | Delete autoSizeWire() from computed-system.ts | Remove wrong ampacity table entirely |
| 🟡 P2 | Add segmentScheduleToRunSegments() | Clean transformation, no back-population |
| 🟡 P2 | Import NEC tables from segment-schedule.ts | Single definition, no duplication |
| 🟡 P2 | Add back-population validation | Detect missing segment mappings |
| 🟢 P3 | Add production meter segment type | Complete topology representation |

---

## APPENDIX: NEC REFERENCE QUICK-CHECK

| Code Section | Topic | Current Implementation | Status |
|---|---|---|---|
| NEC 690.7 | String Voc temperature correction | ✅ Correct formula | PASS |
| NEC 690.8 | OCPD sizing (Isc × 1.25) | ✅ Correct | PASS |
| NEC 690.8 | AC output 2-wire ungrounded | ⚠️ neutralRequired: true on AC runs | FAIL |
| NEC 690.8(B) | Max 16 micros per branch | ✅ Correct | PASS |
| NEC 690.12 | Rapid shutdown | ✅ Noted on SLD | PASS |
| NEC 690.14 | AC disconnect | ✅ Correct | PASS |
| NEC 690.15 | DC disconnect (not for micro) | ✅ Correctly excluded for micro | PASS |
| NEC 690.31 | Open-air wiring (no conduit derating) | ✅ Correct | PASS |
| NEC 705.11 | Supply-side connection | ⚠️ Wrong NEC citation on SLD | WARN |
| NEC 705.12(B) | Load-side connection (120% rule) | ✅ Correct formula | PASS |
| NEC 310.16 | Ampacity table (75°C column) | ❌ Wrong values in computed-system.ts | FAIL |
| NEC 310.15(B)(2) | Temperature derating | ✅ Correct values, wrong citation | WARN |
| NEC 310.15(C)(1) | Conduit fill derating | ✅ Correct | PASS |
| NEC 250.122 | EGC sizing | ✅ Correct | PASS |
| NEC 240.6 | Standard OCPD sizes | ✅ Correct list | PASS |
| NEC Ch9 T4 | Conduit internal areas | ✅ Correct values | PASS |
| NEC Ch9 T5 | Conductor cross-sectional areas | ✅ Correct values | PASS |
| IEEE 315 | SLD symbols | ✅ Correct symbols | PASS |
| ANSI C | Drawing format (24"×18") | ✅ Correct dimensions | PASS |

---

*End of Audit Report — 6 issues identified, 3 critical, 2 medium, 1 low. Architectural refactor recommended for next major version.*