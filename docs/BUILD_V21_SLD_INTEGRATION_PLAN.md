# Engineering Documentation System — SLD Integration Plan
## Battery, Generator, ATS & Backup Panel Data Consistency
### BUILD v21 → v22 Implementation Roadmap

**Document Version:** 1.0  
**Prepared For:** SolarPro Design Platform  
**Tech Stack (confirmed from codebase):**
- `lib/segment-model.ts` — Canonical segment type enum + interfaces (single source of truth)
- `lib/segment-schedule.ts` — Wire/conduit auto-sizer (produces `SegmentScheduleRow[]`)
- `lib/segment-builder.ts` — Segment orchestrator (produces `Segment[]` for SLD/BOM)
- `lib/computed-system.ts` — NEC engine (`computeSystem()` → `ComputedSystem`)
- `lib/equipment-db.ts` — Equipment specs database (all manufacturer data)
- `lib/sld-renderer.ts` — SVG SLD renderer (`renderSLD(SLDBuildInput)`)
- `lib/sld-types.ts` — SLD type contracts (`SLDBuildInput`, `SLDDocument`)
- `app/engineering/page.tsx` — Engineering UI (React, passes config to all engines)

---

## EXECUTIVE SUMMARY

The current system has a **three-layer gap** between the battery/generator/ATS data and the SLD:

| Layer | Current State | Gap |
|---|---|---|
| **equipment-db.ts** | ✅ Full specs: backfeedBreakerA, continuousPowerKw, outputBreakerA, outputWireGaugeMin | Complete |
| **computed-system.ts** | ✅ Battery NEC 705.12(B) bus check wired; equipment schedule rows added | Complete |
| **segment-model.ts** | ❌ No BATTERY_TO_MSP, GENERATOR_FEEDER, ATS_TO_MSP, BACKUP_PANEL segment types | **Missing** |
| **segment-schedule.ts** | ❌ No wire/conduit sizing for battery, generator, ATS, backup panel runs | **Missing** |
| **sld-renderer.ts** | ⚠️ Visual symbols exist (symBattery, symGenerator, symATS) but no conductor callout labels, no segment-driven wiring | **Partial** |
| **SLDBuildInput** | ⚠️ Fields exist (batteryBackfeedA, generatorKw, atsAmpRating) but no wire gauge, conduit size, run length for these segments | **Partial** |

The fix requires extending the canonical segment model, wiring new segment types through the auto-sizer, and connecting the output to the SLD renderer.

---

## DELIVERABLE 1: INTEGRATION PROCESS (Step-by-Step)

### PHASE A — Extend the Canonical Segment Model
**File:** `lib/segment-model.ts`  
**Principle:** Every new electrical run must be a named `SegmentType`. The SLD, BOM, and conductor schedule all derive from this enum — never from ad-hoc strings.

**Step A1 — Add new SegmentType entries:**
```typescript
export enum SegmentType {
  // ... existing entries ...

  // ── Battery Storage Segments (NEC 706 / 705.12B) ──────────────────────────
  BATTERY_TO_MSP          = 'BATTERY_TO_MSP',          // AC-coupled: battery inverter → MSP backfed breaker
  BATTERY_TO_BACKUP_PANEL = 'BATTERY_TO_BACKUP_PANEL', // Battery → critical load / backup subpanel
  BATTERY_DC_BUS          = 'BATTERY_DC_BUS',          // DC-coupled: battery DC bus → hybrid inverter

  // ── Generator Segments (NEC 702) ──────────────────────────────────────────
  GENERATOR_OUTPUT        = 'GENERATOR_OUTPUT',         // Generator terminals → ATS input
  GENERATOR_TO_ATS        = 'GENERATOR_TO_ATS',         // Generator → ATS (same as above, explicit)

  // ── ATS Segments (NEC 702.5 / 250.30) ────────────────────────────────────
  ATS_TO_MSP              = 'ATS_TO_MSP',               // ATS output → MSP (or service entrance)
  ATS_TO_BACKUP_PANEL     = 'ATS_TO_BACKUP_PANEL',      // ATS output → critical load subpanel

  // ── Backup / Critical Load Panel Segments ────────────────────────────────
  BACKUP_PANEL_FEEDER     = 'BACKUP_PANEL_FEEDER',      // MSP → backup subpanel (partial home backup)
  BACKUP_PANEL_OUTPUT     = 'BACKUP_PANEL_OUTPUT',      // Backup panel → critical loads
}
```

**Step A2 — Extend `SegmentBuilderInput` with backup system parameters:**
```typescript
export interface SegmentBuilderInput {
  // ... existing fields ...

  // Battery system (optional)
  batteryId?: string;                  // equipment-db ID → auto-pulls specs
  batteryCount?: number;               // number of units
  batterySubcategory?: 'ac_coupled' | 'dc_coupled';
  batteryBackfeedBreakerA?: number;    // from equipment-db: backfeedBreakerA
  batteryContinuousPowerKw?: number;   // from equipment-db: continuousPowerKw
  batteryToMspRunLengthFt?: number;    // field measurement
  batteryToBackupPanelRunLengthFt?: number;

  // Generator system (optional)
  generatorId?: string;                // equipment-db ID → auto-pulls specs
  generatorOutputBreakerA?: number;    // from equipment-db: outputBreakerA
  generatorOutputKw?: number;          // from equipment-db: ratedOutputKw
  generatorToAtsRunLengthFt?: number;  // field measurement

  // ATS (optional)
  atsId?: string;                      // equipment-db ID → auto-pulls specs
  atsAmpRating?: number;               // from equipment-db: ampRating
  atsNeutralSwitched?: boolean;        // from equipment-db: neutralSwitched
  atsToMspRunLengthFt?: number;        // field measurement

  // Backup / critical load panel (optional)
  hasBackupPanel?: boolean;
  backupPanelAmps?: number;            // e.g., 100A subpanel
  backupPanelBrand?: string;
  mspToBackupPanelRunLengthFt?: number;
}
```

**Step A3 — Add `runLengths` extensions to the existing `runLengths` block:**
```typescript
runLengths: {
  // ... existing fields ...
  batteryToMsp: number;           // default: 10 ft
  generatorToAts: number;         // default: 15 ft
  atsToMsp: number;               // default: 5 ft
  mspToBackupPanel: number;       // default: 10 ft
};
```

---

### PHASE B — Wire New Segments Through the Auto-Sizer
**File:** `lib/segment-schedule.ts`  
**Principle:** Every segment run must call `autoSizeGauge()` with the actual continuous current derived from manufacturer specs — never hardcoded values.

**Step B1 — Battery-to-MSP segment (AC-coupled):**

The continuous current for this run comes directly from `equipment-db.ts`:
```typescript
// SOURCE: BatterySystem.maxContinuousOutputA (from equipment-db.ts)
// NEC 705.12(B): AC-coupled battery has its own backfeed breaker
// Wire sizing: NEC 690.8(A) — 125% of continuous current
if (input.batteryId && input.batterySubcategory === 'ac_coupled') {
  const bat = getBatteryById(input.batteryId);
  if (bat) {
    const continuousA = bat.maxContinuousOutputA;          // MANUFACTURER SPEC — not estimated
    const requiredAmpacity = continuousA * 1.25;           // NEC 690.8(A)
    const ocpdA = bat.backfeedBreakerA ?? next240VBreakerSize(requiredAmpacity);
    const sizing = autoSizeGauge(continuousA, ambientC, 2, false, '#10 AWG');

    segments.push(buildSegmentRow({
      segmentType: SegmentType.BATTERY_TO_MSP,
      fromNode: `BATT-1 (${bat.manufacturer} ${bat.model})`,
      toNode: 'MSP-1',
      continuousCurrentA: continuousA,
      ocpdAmps: ocpdA,
      runLengthFt: input.runLengths.batteryToMsp,
      conductorBundle: sizing.bundle,
      conduitType: input.conduitType,
      necRefs: ['NEC 705.12(B) — backfed breaker', 'NEC 706.20 — ESS wiring', 'NEC 690.8(A) — 125% continuous'],
      specSource: `${bat.manufacturer} ${bat.model} datasheet — maxContinuousOutputA: ${continuousA}A`,
    }));
  }
}
```

**Step B2 — Generator-to-ATS segment:**
```typescript
// SOURCE: GeneratorSystem.outputBreakerA, ratedOutputKw (from equipment-db.ts)
// NEC 702.5: generator output must be protected by OCPD at generator terminals
if (input.generatorId) {
  const gen = getGeneratorById(input.generatorId);
  if (gen) {
    // Continuous current = ratedOutputKw × 1000 / voltageV
    // e.g., 22kW / 240V = 91.7A → use outputBreakerA (100A) from spec
    const continuousA = (gen.ratedOutputKw * 1000) / gen.voltageOutputV;
    const ocpdA = gen.outputBreakerA;                      // MANUFACTURER SPEC
    const minGauge = gen.outputWireGaugeMin;               // MANUFACTURER SPEC
    const sizing = autoSizeGauge(continuousA, ambientC, 2, false, minGauge);

    segments.push(buildSegmentRow({
      segmentType: SegmentType.GENERATOR_TO_ATS,
      fromNode: `GEN-1 (${gen.manufacturer} ${gen.model})`,
      toNode: 'ATS-1',
      continuousCurrentA: continuousA,
      ocpdAmps: ocpdA,
      runLengthFt: input.runLengths.generatorToAts,
      conductorBundle: sizing.bundle,
      conduitType: input.conduitType,
      necRefs: ['NEC 702.5 — transfer equipment', 'NEC 250.30 — neutral bonding', 'NEC 702.4 — OCPD at generator'],
      specSource: `${gen.manufacturer} ${gen.model} spec — outputBreakerA: ${ocpdA}A, outputWireGaugeMin: ${minGauge}`,
    }));
  }
}
```

**Step B3 — ATS-to-MSP segment:**
```typescript
// SOURCE: ATSUnit.ampRating (from equipment-db.ts)
// NEC 702.5: ATS output conductor sized for ATS amp rating
if (input.atsId) {
  const ats = getATSById(input.atsId);
  if (ats) {
    const continuousA = ats.ampRating;                     // MANUFACTURER SPEC
    const sizing = autoSizeGauge(continuousA, ambientC, 2, false, '#4 AWG');

    segments.push(buildSegmentRow({
      segmentType: SegmentType.ATS_TO_MSP,
      fromNode: 'ATS-1',
      toNode: 'MSP-1',
      continuousCurrentA: continuousA,
      ocpdAmps: ats.mainBreakerA ?? continuousA,
      runLengthFt: input.runLengths.atsToMsp,
      conductorBundle: sizing.bundle,
      conduitType: input.conduitType,
      necRefs: ['NEC 702.5 — transfer equipment', 'NEC 250.30 — neutral switching: ' + (ats.neutralSwitched ? 'YES' : 'NO — verify bonding')],
      specSource: `${ats.manufacturer} ${ats.model} spec — ampRating: ${ats.ampRating}A, neutralSwitched: ${ats.neutralSwitched}`,
    }));
  }
}
```

**Step B4 — Backup panel feeder (partial home backup):**
```typescript
// SOURCE: backupPanelAmps (user-configured, typically 60A or 100A subpanel)
// NEC 215.2: feeder sized at 125% of continuous load
if (input.hasBackupPanel && input.backupPanelAmps) {
  const continuousA = input.backupPanelAmps;
  const sizing = autoSizeGauge(continuousA, ambientC, 2, false, '#6 AWG');

  segments.push(buildSegmentRow({
    segmentType: SegmentType.BACKUP_PANEL_FEEDER,
    fromNode: 'MSP-1',
    toNode: 'BACKUP-PANEL-1',
    continuousCurrentA: continuousA,
    ocpdAmps: next240VBreakerSize(continuousA * 1.25),
    runLengthFt: input.runLengths.mspToBackupPanel,
    conductorBundle: sizing.bundle,
    conduitType: input.conduitType,
    necRefs: ['NEC 215.2 — feeder sizing', 'NEC 240.21 — feeder OCPD location'],
    specSource: `User-configured backup panel: ${continuousA}A`,
  }));
}
```

---

### PHASE C — Connect Segment Output to SLD Renderer
**Files:** `lib/sld-types.ts`, `lib/sld-renderer.ts`

**Step C1 — Extend `SLDBuildInput` with segment-driven wire data:**
```typescript
// lib/sld-types.ts — add to SLDBuildInput
batterySegment?: {
  wireGauge: string;          // from segment-schedule output
  conduitSize: string;        // from segment-schedule output
  conduitType: string;
  ocpdAmps: number;
  continuousA: number;
  runLengthFt: number;
  conductorCallout: string;   // permit-grade: "2×#8 BLK+WHI + 1×#10 GRN IN 3/4" EMT"
  voltageDropPct: number;
  specSource: string;         // traceability: "Tesla Powerwall 3 — maxContinuousOutputA: 48A"
};
generatorSegment?: {
  wireGauge: string;
  conduitSize: string;
  conduitType: string;
  ocpdAmps: number;
  continuousA: number;
  runLengthFt: number;
  conductorCallout: string;
  voltageDropPct: number;
  specSource: string;
};
atsSegment?: {
  wireGauge: string;
  conduitSize: string;
  conduitType: string;
  ocpdAmps: number;
  continuousA: number;
  runLengthFt: number;
  conductorCallout: string;
  voltageDropPct: number;
  neutralSwitched: boolean;
  specSource: string;
};
backupPanelSegment?: {
  wireGauge: string;
  conduitSize: string;
  conduitType: string;
  ocpdAmps: number;
  continuousA: number;
  runLengthFt: number;
  conductorCallout: string;
  voltageDropPct: number;
};
```

**Step C2 — Update `symBattery()` to render conductor callout label:**
```typescript
// lib/sld-renderer.ts — update battery rendering block
if (input.batteryBrand && (input.batteryCount ?? 0) > 0) {
  const batX = cx + 220;
  const totalKwh = (input.batteryCount ?? 0) * (input.batteryKwh ?? 0);
  parts.push(symBattery(batX, yMSP - 80, input.batteryBrand, totalKwh, input.batteryBackfeedA));

  // Conductor callout label (segment-driven — from auto-sizer output)
  if (input.batterySegment?.conductorCallout) {
    parts.push(conductorCalloutLabel(
      batX - 80, yMSP - 110,
      input.batterySegment.conductorCallout,
      input.batterySegment.voltageDropPct,
      '#6A1B9A'
    ));
  }

  // Dashed AC line from battery to MSP bus
  parts.push(line(batX - 45, yMSP - 80, cx + 80, yMSP - 80, { stroke: C.ac, strokeW: 2, dash: '8,4' }));
  parts.push(line(cx + 80, yMSP - 80, cx + 80, yMSP, { stroke: C.ac, strokeW: 2, dash: '8,4' }));

  // Battery backfeed breaker (segment-driven OCPD)
  const bfA = input.batterySegment?.ocpdAmps ?? input.batteryBackfeedA ?? 0;
  if (bfA > 0) {
    parts.push(symBreaker(batX - 80, yMSP - 80, bfA, 'BATT\nBREAKER', '#6A1B9A'));
  }
}
```

**Step C3 — Update generator/ATS rendering to show conductor callouts:**
```typescript
// lib/sld-renderer.ts — update generator/ATS rendering block
if (input.generatorBrand && input.generatorKw) {
  const genX = cx - 240;
  const genY = yMSP + 60;
  parts.push(symGenerator(genX, genY, input.generatorBrand, input.generatorKw));

  // Generator conductor callout (segment-driven)
  if (input.generatorSegment?.conductorCallout) {
    parts.push(conductorCalloutLabel(
      genX, genY - 50,
      input.generatorSegment.conductorCallout,
      input.generatorSegment.voltageDropPct,
      '#2E7D32'
    ));
  }

  if (input.atsBrand && input.atsAmpRating) {
    parts.push(symATS(genX, yMSP - 20, input.atsBrand, input.atsAmpRating, true));

    // ATS conductor callout (segment-driven)
    if (input.atsSegment?.conductorCallout) {
      parts.push(conductorCalloutLabel(
        genX + 60, yMSP - 40,
        input.atsSegment.conductorCallout,
        input.atsSegment.voltageDropPct,
        '#E65100'
      ));
    }
  }
}
```

**Step C4 — Add backup panel symbol and feeder callout:**
```typescript
// lib/sld-renderer.ts — new symBackupPanel() function
function symBackupPanel(cx: number, cy: number, brand: string, amps: number): string {
  const parts: string[] = [];
  const bw = 90; const bh = 56;
  // Backup panel — teal tones (critical load)
  parts.push(rect(cx - bw/2, cy - bh/2, bw, bh, { fill: '#E0F2F1', stroke: '#00695C', strokeW: 2, rx: 4 }));
  parts.push(text(cx, cy - 6, 'BACKUP PANEL', { size: F.tiny, weight: 'bold', fill: '#00695C' }));
  parts.push(text(cx, cy + 8, `${amps}A / 120/240V`, { size: F.tiny, fill: '#00695C' }));
  parts.push(text(cx, cy + bh/2 + 14, brand, { size: F.small, weight: 'bold', fill: '#00695C' }));
  parts.push(text(cx, cy + bh/2 + 28, 'NEC 215.2 · Critical Loads', { size: F.tiny, fill: C.textLight }));
  return parts.join('\n');
}

// In renderSLD() — add backup panel rendering
if (input.backupPanelSegment) {
  const bpX = cx + 220;
  const bpY = yMSP + 80;
  parts.push(symBackupPanel(bpX, bpY, 'Critical Load Panel', input.backupPanelSegment.ocpdAmps));
  parts.push(line(cx + 80, yMSP + 60, bpX, bpY - 28, { stroke: '#00695C', strokeW: 2 }));
  if (input.backupPanelSegment.conductorCallout) {
    parts.push(conductorCalloutLabel(bpX - 60, bpY - 50, input.backupPanelSegment.conductorCallout, input.backupPanelSegment.voltageDropPct, '#00695C'));
  }
}
```

---

### PHASE D — Wire Segment Output Through computed-system.ts
**File:** `lib/computed-system.ts`

**Step D1 — Pass battery/generator/ATS IDs into SegmentBuilderInput:**
```typescript
// In computeSystem() — extend the segmentBuilderInput construction
const segmentBuilderInput: SegmentBuilderInput = {
  // ... existing fields ...

  // Battery
  batteryId: input.batteryIds?.[0],
  batteryCount: input.batteryCount ?? 1,
  batterySubcategory: getBatteryById(input.batteryIds?.[0] ?? '')?.subcategory,
  batteryBackfeedBreakerA: computeBatteryBusImpact(input.batteryIds?.[0] ?? ''),
  batteryContinuousPowerKw: getBatteryById(input.batteryIds?.[0] ?? '')?.continuousPowerKw,
  batteryToMspRunLengthFt: input.batteryToMspRunLengthFt ?? 10,

  // Generator
  generatorId: input.generatorId,
  generatorOutputBreakerA: getGeneratorById(input.generatorId ?? '')?.outputBreakerA,
  generatorOutputKw: getGeneratorById(input.generatorId ?? '')?.ratedOutputKw,
  generatorToAtsRunLengthFt: input.generatorToAtsRunLengthFt ?? 15,

  // ATS
  atsId: input.atsId,
  atsAmpRating: getATSById(input.atsId ?? '')?.ampRating,
  atsNeutralSwitched: getATSById(input.atsId ?? '')?.neutralSwitched,
  atsToMspRunLengthFt: input.atsToMspRunLengthFt ?? 5,

  // Backup panel
  hasBackupPanel: input.hasBackupPanel,
  backupPanelAmps: input.backupPanelAmps ?? 100,
  mspToBackupPanelRunLengthFt: input.mspToBackupPanelRunLengthFt ?? 10,
};
```

**Step D2 — Extract segment outputs and map to SLD fields:**
```typescript
// After segment builder runs, extract battery/gen/ATS segments
const batterySegRow = sbSegments?.find(s => s.type === SegmentType.BATTERY_TO_MSP);
const generatorSegRow = sbSegments?.find(s => s.type === SegmentType.GENERATOR_TO_ATS);
const atsSegRow = sbSegments?.find(s => s.type === SegmentType.ATS_TO_MSP);
const backupPanelSegRow = sbSegments?.find(s => s.type === SegmentType.BACKUP_PANEL_FEEDER);

// These flow into the returned ComputedSystem and then into SLDBuildInput
```

---

### PHASE E — Add Run Length Inputs to Engineering UI
**File:** `app/engineering/page.tsx`

**Step E1 — Add run length fields to `EngineeringConfig`:**
```typescript
interface EngineeringConfig {
  // ... existing fields ...
  batteryToMspRunLengthFt: number;      // default: 10
  generatorToAtsRunLengthFt: number;    // default: 15
  atsToMspRunLengthFt: number;          // default: 5
  mspToBackupPanelRunLengthFt: number;  // default: 10
  hasBackupPanel: boolean;
  backupPanelAmps: number;              // default: 100
  backupPanelBrand: string;
}
```

**Step E2 — Add UI inputs in the Battery/Generator section:**
```tsx
{/* Run Length Inputs — Battery */}
{config.batteryId && (
  <div>
    <label className="text-xs text-slate-400 mb-1 block">
      Battery → MSP Run Length (ft)
    </label>
    <input type="number" min={1} max={200} value={config.batteryToMspRunLengthFt}
      onChange={e => updateConfig({ batteryToMspRunLengthFt: +e.target.value })}
      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
  </div>
)}

{/* Run Length Inputs — Generator */}
{config.generatorId && (
  <div>
    <label className="text-xs text-slate-400 mb-1 block">
      Generator → ATS Run Length (ft)
    </label>
    <input type="number" min={1} max={200} value={config.generatorToAtsRunLengthFt}
      onChange={e => updateConfig({ generatorToAtsRunLengthFt: +e.target.value })}
      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
  </div>
)}

{/* Backup Panel Toggle */}
<div className="flex items-center gap-3 mt-2">
  <input type="checkbox" checked={config.hasBackupPanel}
    onChange={e => updateConfig({ hasBackupPanel: e.target.checked })} />
  <label className="text-xs text-slate-300">Add Critical Load / Backup Panel</label>
</div>
```

---

## DELIVERABLE 2: VERIFICATION CHECKLIST

### ✅ Manufacturer Spec Verification (Per Segment)

**Battery-to-MSP Segment:**
- [ ] `continuousA` sourced from `BatterySystem.maxContinuousOutputA` in equipment-db.ts — NOT hardcoded
- [ ] `ocpdAmps` sourced from `BatterySystem.backfeedBreakerA` — NOT calculated from generic formula
- [ ] `specSource` field populated: `"${manufacturer} ${model} — maxContinuousOutputA: ${A}A"`
- [ ] AC-coupled vs DC-coupled check: DC-coupled batteries skip this segment (inverter handles it)
- [ ] Wire gauge passes NEC 690.8(A) 125% rule: `effectiveAmpacity ≥ continuousA × 1.25`
- [ ] Voltage drop ≤ 2% for feeders (NEC recommendation)
- [ ] Conduit fill ≤ 40% (NEC Chapter 9, Table 1)

**Generator-to-ATS Segment:**
- [ ] `continuousA` = `ratedOutputKw × 1000 / voltageOutputV` — derived from manufacturer spec
- [ ] `ocpdAmps` sourced from `GeneratorSystem.outputBreakerA` — NOT estimated
- [ ] Minimum wire gauge respects `GeneratorSystem.outputWireGaugeMin` — NOT overridden to smaller
- [ ] `specSource` field: `"${manufacturer} ${model} — outputBreakerA: ${A}A, outputWireGaugeMin: ${gauge}"`
- [ ] NEC 702.4 OCPD at generator terminals verified
- [ ] NEC 250.30 neutral bonding noted in segment `necReferences[]`

**ATS-to-MSP Segment:**
- [ ] `continuousA` sourced from `ATSUnit.ampRating` — NOT from generator output
- [ ] `neutralSwitched` flag from `ATSUnit.neutralSwitched` — drives NEC 250.30 note on SLD
- [ ] Service entrance rated flag checked: `ATSUnit.serviceEntranceRated`
- [ ] `specSource` field: `"${manufacturer} ${model} — ampRating: ${A}A, neutralSwitched: ${bool}"`

**Backup Panel Feeder:**
- [ ] `continuousA` = user-configured `backupPanelAmps` (clearly labeled as user input, not manufacturer spec)
- [ ] NEC 215.2 feeder sizing: `requiredAmpacity = continuousA × 1.25`
- [ ] OCPD at MSP sized per NEC 240.21

### ✅ SLD Visual Verification
- [ ] Battery symbol appears on SLD when `batteryBrand` + `batteryCount > 0`
- [ ] Battery conductor callout label appears on SLD wire (not just in equipment schedule)
- [ ] Battery backfeed breaker shown at MSP bus connection point
- [ ] Generator symbol appears when `generatorBrand` + `generatorKw` set
- [ ] ATS symbol appears between generator and MSP
- [ ] Generator conductor callout appears on generator-to-ATS wire
- [ ] ATS conductor callout appears on ATS-to-MSP wire
- [ ] Backup panel symbol appears when `hasBackupPanel = true`
- [ ] Backup panel feeder callout appears on MSP-to-backup-panel wire
- [ ] All new symbols appear in the SLD legend
- [ ] NEC references appear on each new symbol

### ✅ Electrical Sizing UI Verification
- [ ] Battery segment wire gauge appears in Conductor Schedule table
- [ ] Battery segment conduit size appears in Conduit Schedule table
- [ ] Generator segment wire gauge appears in Conductor Schedule table
- [ ] ATS segment wire gauge appears in Conductor Schedule table
- [ ] Backup panel feeder appears in Conductor Schedule table
- [ ] All new segments appear in Equipment Schedule with correct NEC references
- [ ] BOM quantities updated to include new wire/conduit lengths
- [ ] Voltage drop percentages shown for all new segments

### ✅ NEC Compliance Verification
- [ ] NEC 705.12(B): Battery backfeed breaker amps included in 120% bus loading check
- [ ] NEC 706.20: Battery wiring uses correct insulation type (THWN-2 minimum)
- [ ] NEC 702.5: Transfer equipment (ATS) present when generator is configured
- [ ] NEC 250.30: Neutral switching noted when `ATSUnit.neutralSwitched = true`
- [ ] NEC 702.4: OCPD at generator terminals verified
- [ ] NEC 215.2: Backup panel feeder sized at 125% of continuous load

### ✅ Data Traceability Sign-Off Criteria
- [ ] Every segment has a non-empty `specSource` string
- [ ] No segment uses a hardcoded current value — all derive from equipment-db.ts lookups
- [ ] `getAllNewEquipment()` helper returns all `isNew: true` entries (sanity check)
- [ ] TypeScript compiler: 0 errors (`./node_modules/.bin/tsc --noEmit`)
- [ ] Git commit message includes spec sources for any manually verified values

---

## DELIVERABLE 3: DATA SYNCHRONIZATION METHOD

### Architecture: Single Source of Truth Flow

```
equipment-db.ts (manufacturer specs)
        │
        ▼
computeSystem() in computed-system.ts
        │  ← batteryIds[], generatorId, atsId, run lengths
        │
        ├─► segment-schedule.ts (wire/conduit auto-sizer)
        │         │
        │         ▼
        │   SegmentScheduleRow[] (canonical)
        │         │
        ├─► segment-builder.ts (Segment[] with full callouts)
        │         │
        │         ▼
        │   Segment[] (battery, gen, ATS, backup panel segments)
        │
        ▼
   ComputedSystem (returned object)
        │
        ├─► equipmentSchedule[]  ──► Electrical Sizing UI table
        ├─► segmentSchedule[]    ──► Conductor Schedule UI table
        ├─► bomQuantities        ──► BOM UI table
        ├─► complianceIssues[]   ──► Compliance panel
        │
        ▼
   SLDBuildInput (constructed in engineering/page.tsx)
        │  ← batterySegment, generatorSegment, atsSegment, backupPanelSegment
        │
        ▼
   renderSLD() → SVG string → SLD display
```

### Step-by-Step Synchronization

**Step 1 — Single computation call:**
The engineering UI calls `computeSystem(config)` exactly once. All downstream outputs (SLD, conductor schedule, equipment schedule, BOM) derive from this single call. No separate computation paths for the SLD.

**Step 2 — Segment extraction in page.tsx:**
```typescript
// After computeSystem() returns cs:
const batterySegment = cs.segments?.find(s => s.type === 'BATTERY_TO_MSP');
const generatorSegment = cs.segments?.find(s => s.type === 'GENERATOR_TO_ATS');
const atsSegment = cs.segments?.find(s => s.type === 'ATS_TO_MSP');
const backupPanelSegment = cs.segments?.find(s => s.type === 'BACKUP_PANEL_FEEDER');

// Pass into SLDBuildInput:
const sldInput: SLDBuildInput = {
  ...existingFields,
  batterySegment: batterySegment ? {
    wireGauge: batterySegment.conductorBundle.conductors[0].gauge,
    conduitSize: batterySegment.conduitSize,
    conduitType: batterySegment.conduitType,
    ocpdAmps: batterySegment.ocpdAmps,
    continuousA: batterySegment.continuousCurrent,
    runLengthFt: batterySegment.onewayLengthFt,
    conductorCallout: batterySegment.conductorCallout,
    voltageDropPct: batterySegment.voltageDropPct,
    specSource: batterySegment.necReferences.join('; '),
  } : undefined,
  // ... same pattern for generatorSegment, atsSegment, backupPanelSegment
};
```

**Step 3 — Validation confirmation:**
After `computeSystem()` runs, verify synchronization with this check:
```typescript
// Synchronization validation — run in development mode
function validateSLDSync(cs: ComputedSystem, sldInput: SLDBuildInput): string[] {
  const issues: string[] = [];

  // Check: if battery configured, battery segment must exist
  if (cs.batteryIds?.length && !sldInput.batterySegment) {
    issues.push('SYNC_ERROR: Battery configured but batterySegment missing from SLDBuildInput');
  }

  // Check: battery backfeed amps must match between NEC engine and SLD
  if (sldInput.batterySegment && sldInput.batteryBackfeedA !== sldInput.batterySegment.ocpdAmps) {
    issues.push(`SYNC_WARN: batteryBackfeedA (${sldInput.batteryBackfeedA}A) ≠ batterySegment.ocpdAmps (${sldInput.batterySegment.ocpdAmps}A)`);
  }

  // Check: generator configured → ATS must also be configured (NEC 702.5)
  if (sldInput.generatorBrand && !sldInput.atsBrand) {
    issues.push('NEC_702.5: Generator configured without ATS — transfer equipment required');
  }

  return issues;
}
```

**Step 4 — Rollback procedure:**
If synchronization fails (TypeScript errors, runtime exceptions, or validation issues):

1. The segment builder is wrapped in a try/catch in `computed-system.ts` (already implemented — see line 1887: "Non-fatal: segment builder failure does not break existing functionality")
2. If `sbSegments` is undefined, the SLD falls back to the existing visual-only rendering (battery/gen/ATS symbols without conductor callouts)
3. The fallback is transparent to the user — the SLD still renders, just without the new callout labels
4. Git revert to BUILD v21 commit `a3a7b47c` restores the last known-good state

---

## DELIVERABLE 4: RISK ASSESSMENT

### Risk Matrix

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Segment builder breaks existing solar segments | Medium | High | Wrap new segments in separate `if` blocks; existing solar path unchanged |
| DC-coupled battery incorrectly gets BATTERY_TO_MSP segment | Medium | High | Guard: `if (bat.subcategory === 'ac_coupled')` before generating segment |
| Generator without ATS passes NEC 702.5 check | Low | High | Add validation: generator configured → ATS required warning |
| Run length defaults produce incorrect wire sizing | Low | Medium | Use conservative defaults (10-15 ft); UI inputs allow override |
| Neutral bonding issue (NEC 250.30) not caught | Low | High | `atsNeutralSwitched` flag drives explicit SLD note; AHJ review required |
| SLD canvas overflow with all components | Medium | Low | Extend `SHEET_H` constant; generator placed left, battery placed right |
| TypeScript errors from new interface fields | Low | Medium | Run `tsc --noEmit` before every commit |
| BOM quantities double-counting new wire runs | Low | Medium | New segments use separate `segBOM` keys; verify `calcBOMFromSegments()` |

### Dependencies

| Dependency | Owner | Risk |
|---|---|---|
| `autoSizeGauge()` in segment-schedule.ts | Internal | Low — function is well-tested |
| `getBatteryById()`, `getGeneratorById()`, `getATSById()` | equipment-db.ts | Low — implemented in BUILD v21 |
| `buildSegmentRow()` helper | segment-schedule.ts | Medium — must verify interface compatibility |
| `conductorCalloutLabel()` in sld-renderer.ts | Internal | Low — function exists, just needs to be called |
| AHJ-specific wire sizing rules | External | Medium — some AHJs require larger wire than NEC minimum |

### Recommended Mitigation Strategies

1. **Incremental rollout:** Implement one segment type at a time (battery first, then generator/ATS, then backup panel). Each increment is a separate commit with TypeScript validation.

2. **Spec source traceability:** Every `autoSizeGauge()` call for new segments must include a `specSource` comment citing the exact equipment-db field used. This is the audit trail for permit reviewers.

3. **DC-coupled guard:** The most common mistake will be generating a `BATTERY_TO_MSP` segment for a DC-coupled battery (e.g., Generac PWRcell, SolarEdge Home Battery). These batteries share the inverter's backfeed breaker — they must NOT get a separate segment. Guard: `if (bat.subcategory !== 'dc_coupled')`.

4. **NEC 250.30 neutral bonding:** When a generator is configured without a neutral-switching ATS, the SLD must show a warning note. This is a life-safety issue — parallel neutral paths can energize equipment during utility outages. The `atsNeutralSwitched` flag in `ATSUnit` drives this check.

5. **Canvas layout:** With battery (right side), generator+ATS (left side), and backup panel (below MSP), the SLD canvas will be crowded. Recommended: increase `SHEET_H` from current value to accommodate, and use the `hasBattery`/`hasGenerator` flags to conditionally expand canvas height.

---

## IMPLEMENTATION SEQUENCE (Recommended)

```
Week 1: Phase A + B (battery segment only)
  ├── A1: Add BATTERY_TO_MSP to SegmentType enum
  ├── A2: Add battery fields to SegmentBuilderInput
  ├── B1: Wire battery-to-MSP segment through auto-sizer
  └── TypeScript: 0 errors → commit as BUILD v22-alpha-battery

Week 1: Phase C (battery SLD callout)
  ├── C1: Add batterySegment to SLDBuildInput
  ├── C2: Update symBattery() to render conductor callout
  └── TypeScript: 0 errors → commit as BUILD v22-alpha-battery-sld

Week 2: Phase A + B + C (generator + ATS segments)
  ├── A1: Add GENERATOR_TO_ATS, ATS_TO_MSP to SegmentType
  ├── B2/B3: Wire generator and ATS segments through auto-sizer
  ├── C3: Update generator/ATS rendering with callouts
  └── TypeScript: 0 errors → commit as BUILD v22-alpha-gen-ats

Week 2: Phase A + B + C + E (backup panel)
  ├── A1: Add BACKUP_PANEL_FEEDER to SegmentType
  ├── B4: Wire backup panel feeder through auto-sizer
  ├── C4: Add symBackupPanel() + feeder callout
  ├── E1/E2: Add run length inputs to engineering UI
  └── TypeScript: 0 errors → commit as BUILD v22

Week 3: Phase D (full computed-system.ts integration)
  ├── D1: Pass all IDs into SegmentBuilderInput
  ├── D2: Extract segment outputs → SLDBuildInput
  ├── Verification checklist: all items checked
  └── TypeScript: 0 errors → commit as BUILD v22 FINAL
```

---

## ADDITIONAL INFORMATION NEEDED

To complete implementation, the following field measurements are needed from the installer/designer:

1. **Battery-to-MSP run length** — distance from battery installation location to main service panel (default: 10 ft)
2. **Generator-to-ATS run length** — distance from generator pad to ATS location (default: 15 ft)
3. **ATS-to-MSP run length** — distance from ATS to main service panel (default: 5 ft)
4. **MSP-to-backup-panel run length** — if partial home backup, distance from MSP to critical load subpanel (default: 10 ft)
5. **Backup panel amperage** — 60A or 100A subpanel for critical loads (default: 100A)
6. **Conduit type for backup runs** — EMT (indoor/garage) or PVC Sch 40 (outdoor/underground)

These are the only values that cannot be derived from manufacturer specs and must come from the field.