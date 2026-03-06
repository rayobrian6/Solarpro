# BUILD v23 — SLD Technical Requirements Document
## Enphase Ecosystem Accuracy, Generator/ATS Rendering, Inverter Icon, Electrical Sizing Data Flow

**Document Version:** 1.0  
**Date:** 2025-03-06  
**Status:** APPROVED FOR DEVELOPMENT  
**Prepared by:** Engineering Documentation System  
**Applies to:** `lib/sld-professional-renderer.ts`, `app/api/engineering/sld/route.ts`, `app/engineering/page.tsx`

---

## EXECUTIVE SUMMARY

The current SLD output has five categories of defects identified from screenshot review and codebase audit. This document provides a prioritized action item list, precise technical requirements per component, visual standards, and a deployment verification checklist. All issues must be resolved before the SLD output is considered permit-ready.

---

## SECTION 1 — PRIORITIZED ACTION ITEM LIST

Items are ordered by severity: P1 = blocking/incorrect, P2 = missing required component, P3 = visual/professional quality.

### P1 — CRITICAL (Incorrect / Code Violation Risk)

| # | Issue | File(s) | Impact |
|---|-------|---------|--------|
| 1.1 | Battery connected directly to MSP bus — incorrect for Enphase AC-coupled systems | `sld-professional-renderer.ts` | NEC 705.12(B) misrepresented |
| 1.2 | Battery/generator/ATS data NOT sent from `page.tsx` to SLD API | `app/engineering/page.tsx` | Components never appear regardless of config |
| 1.3 | Enphase IQ System Controller 3 (BUI/ATS) not rendered on SLD | `sld-professional-renderer.ts` | Missing required Enphase component |
| 1.4 | Generator + generator ATS not appearing on SLD | `sld-professional-renderer.ts` | Missing required component |

### P2 — HIGH (Missing Required Components)

| # | Issue | File(s) | Impact |
|---|-------|---------|--------|
| 2.1 | Enphase backup sub-panel (load center) not shown when `hasBackupPanel=true` | `sld-professional-renderer.ts` | Incomplete system diagram |
| 2.2 | Enphase-specific topology: battery connects to IQ SC3, not directly to MSP | `sld-professional-renderer.ts` | Wrong wiring topology |
| 2.3 | `batteryBackfeedA`, `generatorBrand/Kw`, `atsBrand/AmpRating` missing from SLD POST body | `app/engineering/page.tsx` | Data never reaches renderer |
| 2.4 | Electrical sizing page not receiving battery/generator/ATS data points | `app/engineering/page.tsx` | Sizing calculations incomplete |

### P3 — MEDIUM (Visual / Professional Quality)

| # | Issue | File(s) | Impact |
|---|-------|---------|--------|
| 3.1 | Inverter icon is a generic sine-wave circle — not manufacturer-specific | `sld-professional-renderer.ts` | Unprofessional appearance |
| 3.2 | Battery symbol uses IEC cell stack — not clearly labeled as Enphase-specific | `sld-professional-renderer.ts` | Ambiguous on permit drawings |
| 3.3 | Legend does not dynamically reflect all active components | `sld-professional-renderer.ts` | Incomplete legend |

---

## SECTION 2 — TECHNICAL REQUIREMENTS PER COMPONENT

---

### 2.1 ENPHASE BATTERY SYSTEM — CORRECT TOPOLOGY

#### Current (WRONG)
```
MSP Bus ←──── Battery (dashed blue line directly to MSP bus)
```

#### Required (CORRECT — Enphase AC-Coupled)
```
Utility Meter → MSP → IQ System Controller 3 (BUI/ATS) → IQ Battery 5P/10T/3T
                                    ↓
                          Backup Sub-Panel (critical loads)
```

#### Technical Specification

**Component:** Enphase IQ System Controller 3 (IQ SC3)  
**Role:** Battery Backup Interface Unit (BUI) + Automatic Transfer Switch  
**NEC References:**
- NEC 706 — Energy Storage Systems
- NEC 705.12(B) — Load-side interconnection (backfeed breaker at MSP)
- NEC 230.82 — Service entrance rated (IQ SC3 is SE-rated)
- NEC 250.30 — Neutral switching: IQ SC3 opens neutral during island mode

**SLD Placement Rules:**
1. IQ SC3 symbol must appear on the **right side** of the MSP, between MSP and utility meter
2. Battery symbol connects to the **IQ SC3**, NOT to the MSP bus directly
3. A dedicated backfeed breaker (20A for IQ Battery 5P, 40A for IQ Battery 10T, 15A for IQ Battery 3T) must be shown at the MSP connecting to the IQ SC3
4. The IQ SC3 has three connection points:
   - **GRID** input (from MSP load side or supply side)
   - **BATTERY** port (to IQ Battery units)
   - **LOAD** output (to backup sub-panel / critical loads)

**Wiring Topology (Enphase-specific):**
```
MSP Load Bus
    │
    ├── [Backfeed Breaker: 20A/40A/15A] ──→ IQ SC3 GRID port
    │                                              │
    │                                    ┌─────────┴──────────┐
    │                                    │   IQ SC3 (BUI/ATS)  │
    │                                    │   UL 1741/1741-SA   │
    │                                    │   NEC 230.82 SE-RTD │
    │                                    └─────────┬──────────┘
    │                                              │
    │                              ┌───────────────┴───────────────┐
    │                              │                               │
    │                         BATTERY port                    LOAD port
    │                              │                               │
    │                    IQ Battery 5P/10T/3T            Backup Sub-Panel
    │                    (LFP, 240V AC, IP55)            (Critical Loads)
    │
    └── [Solar PV backfeed breaker] ← from AC Disconnect
```

**Conductor Requirements (Enphase IQ SC3):**
- Grid port to MSP: `#6 AWG THWN-2` in `3/4" EMT` (for IQ Battery 5P, 20A circuit)
- Grid port to MSP: `#8 AWG THWN-2` in `3/4" EMT` (for IQ Battery 10T, 40A circuit — use #8 min per NEC 310.15)
- Battery port: Internal to IQ SC3 enclosure (no external conductor callout required)
- Load port to backup sub-panel: `#6 AWG THWN-2` in `3/4" EMT`

**Symbol Requirements:**
```
┌─────────────────────────────┐
│    IQ SYSTEM CONTROLLER 3   │  ← Header, orange border (#E65100)
│    (BACKUP INTERFACE UNIT)  │
├─────────────────────────────┤
│  GRID ──[ATS blade]── LOAD  │  ← Transfer switch blades
│  GEN  ──[ATS blade]──       │  ← Generator input (if gen configured)
│         BATTERY ↓           │  ← Battery port
└─────────────────────────────┘
  Enphase IQ SC3 · 200A · SE-RTD
  NEC 706 / NEC 230.82 / UL 1741-SA
```

---

### 2.2 GENERATOR + GENERATOR ATS — CORRECT TOPOLOGY

#### Required Topology
```
Utility Service → [Generator ATS] → MSP
Generator ──────→ [Generator ATS]
```

**Note:** The generator ATS is a SEPARATE device from the Enphase IQ SC3 BUI. When both battery and generator are configured:
- Enphase IQ SC3 handles battery backup switching
- A separate generator ATS (e.g., Generac RXSW100A3, Kohler RXT-100) handles generator transfer

**SLD Placement Rules:**
1. Generator ATS must appear **between the utility meter and the MSP** (service entrance position)
2. Generator symbol connects to the **generator input** of the ATS
3. Utility feed connects to the **normal input** of the ATS
4. ATS **output** connects to the MSP main breaker
5. Generator must show: brand, model, rated kW, output amps

**Symbol Requirements — Generator:**
```
    ┌──────────────────┐
    │  STANDBY GEN     │  ← Green border (#2E7D32)
    │    ┌───┐         │
    │    │ G │~        │  ← IEEE 315 circle-G with sine wave
    │    └───┘         │
    │  Brand Model     │
    │  XX kW / XXA     │
    └──────────────────┘
  NEC 702.5 — Transfer Equip. Req.
```

**Symbol Requirements — Generator ATS:**
```
┌──────────────────────────────┐
│   AUTO TRANSFER SWITCH       │  ← Orange border (#E65100)
├──────────────────────────────┤
│  NORM ──[blade-closed]──┐    │
│  GEN  ──[blade-open]────┤    │
│                         └──→ LOAD
└──────────────────────────────┘
  Brand Model · XXA Rated
  NEC 702.5 / UL 1008
```

**Conductor Requirements:**
- Generator to ATS: `#6 AWG THWN-2` in `3/4" EMT` (size per generator output amps)
- ATS to MSP: `#4 AWG THWN-2` in `1" EMT` (size per ATS amp rating)
- Utility to ATS: Existing service entrance conductors (no new callout needed)

---

### 2.3 INVERTER ICON — PROFESSIONAL STANDARD

#### Current Issue
The current inverter symbol is a generic IEEE 315 circle with a sine wave (`~`). While technically correct, it lacks manufacturer identification and appears unprofessional on permit drawings.

#### Required Standard

**For String Inverters (Fronius, SolarEdge, SMA, Enphase IQ8 in string mode):**
```
    ┌─────────────────────────────┐
    │   STRING INVERTER           │  ← Bold header
    │   ┌──────────────────────┐  │
    │   │  DC ──[≈]──→ AC      │  ← DC/AC conversion symbol
    │   │  ~~~~~~~~~~~~~~~~~~~  │  ← Sine wave output
    │   └──────────────────────┘  │
    │   Manufacturer · Model      │  ← e.g., "Fronius · Primo 8.2-1"
    │   X.X kW / XXA              │
    └─────────────────────────────┘
```

**For Microinverters (Enphase IQ8+, IQ8M, IQ8H, IQ8A):**
- Each microinverter is represented at the PV array node (not as a separate box)
- Label: `N × Enphase IQ8+` below the PV array symbol
- The AC combiner box replaces the separate inverter box in the signal path

**For String + Optimizer (SolarEdge with P-series optimizers):**
```
    ┌─────────────────────────────┐
    │   STRING INVERTER           │
    │   + DC OPTIMIZER            │  ← Additional optimizer label
    │   ┌──────────────────────┐  │
    │   │  DC ──[≈]──→ AC      │  │
    │   └──────────────────────┘  │
    │   SolarEdge · SE7600H-US    │
    │   7.6 kW / 32A              │
    └─────────────────────────────┘
```

**Visual Standards for Inverter Symbol:**
- Box dimensions: minimum 96×80px at SLD scale
- Border: `SW_MED` (1.5px), black
- Header separator line: `SW_THIN` (1.0px)
- Manufacturer name: `F.sub` (7px), italic
- Model number: `F.label` (7.5px), bold
- Output specs: `F.tiny` (6.5px)
- DC/AC arrow: left-to-right, with `DC` label on left, `AC` label on right
- Sine wave path: SVG `<path>` with 2 full cycles, `SW_MED` stroke

---

### 2.4 DATA FLOW — PAGE.TSX TO SLD API

#### Current Gap
`app/engineering/page.tsx` sends `batteryModel` and `batteryKwh` to the SLD API but does NOT send:
- `batteryBackfeedA` (from `getBatteryById(config.batteryId)?.backfeedBreakerA`)
- `generatorBrand`, `generatorModel`, `generatorKw`
- `atsBrand`, `atsModel`, `atsAmpRating`
- `backupInterfaceId`, `backupInterfaceBrand`, `backupInterfaceModel`
- `hasBackupPanel`, `backupPanelAmps`, `backupPanelBrand`

#### Required Addition to SLD POST Body (in `page.tsx`)

```typescript
// Battery fields
batteryBackfeedA:     config.batteryId
  ? (getBatteryById(config.batteryId)?.backfeedBreakerA ?? 0)
  : undefined,

// Generator fields
generatorBrand:       config.generatorId
  ? (getGeneratorById(config.generatorId)?.manufacturer ?? undefined)
  : undefined,
generatorModel:       config.generatorId
  ? (getGeneratorById(config.generatorId)?.model ?? undefined)
  : undefined,
generatorKw:          config.generatorId
  ? (getGeneratorById(config.generatorId)?.ratedOutputKw ?? undefined)
  : undefined,

// ATS fields
atsBrand:             config.atsId
  ? (getATSById(config.atsId)?.manufacturer ?? undefined)
  : undefined,
atsModel:             config.atsId
  ? (getATSById(config.atsId)?.model ?? undefined)
  : undefined,
atsAmpRating:         config.atsId
  ? (getATSById(config.atsId)?.ampRating ?? undefined)
  : undefined,

// Backup interface (Enphase IQ SC3 / Tesla Gateway / etc.)
backupInterfaceId:    config.backupInterfaceId ?? undefined,
backupInterfaceBrand: config.backupInterfaceId
  ? (getBackupInterfaceById(config.backupInterfaceId)?.manufacturer ?? undefined)
  : undefined,
backupInterfaceModel: config.backupInterfaceId
  ? (getBackupInterfaceById(config.backupInterfaceId)?.model ?? undefined)
  : undefined,
backupInterfaceIsATS: config.backupInterfaceId
  ? (getBackupInterfaceById(config.backupInterfaceId)?.islandingCapable ?? false)
  : false,

// Backup panel
hasBackupPanel:       !!(config.backupInterfaceId || config.hasBackupPanel),
backupPanelAmps:      config.backupPanelAmps ?? 100,
backupPanelBrand:     config.backupPanelBrand ?? undefined,
```

---

### 2.5 ELECTRICAL SIZING PAGE — DATA FLOW REQUIREMENTS

The electrical sizing page must receive and display the following additional data points when battery/generator/ATS are configured:

#### Battery Sizing Data Points
| Field | Source | Display Label |
|-------|--------|---------------|
| `batteryBackfeedA` | `BatterySystem.backfeedBreakerA` | Battery Backfeed Breaker |
| `batteryKwh × batteryCount` | config | Total Storage Capacity |
| `120% Rule Check` | `mainPanelAmps × 1.2 ≥ mainPanelAmps + pvBreakerAmps + batteryBackfeedA` | NEC 705.12(B) Check |
| `batteryDedicatedBreakerA` | `BatterySystem.minDedicatedBreakerA` | Min. Dedicated Breaker |
| `batteryChemistry` | `BatterySystem.chemistry` | Battery Chemistry |
| `batteryULListing` | `BatterySystem.ulListing` | UL Listing |

#### Generator Sizing Data Points
| Field | Source | Display Label |
|-------|--------|---------------|
| `generatorOutputA` | `ratedOutputKw × 1000 / 240` | Generator Output Amps |
| `generatorOCPD` | `Math.ceil(outputA × 1.25 / 5) × 5` | Generator OCPD (125%) |
| `generatorWireGauge` | NEC 310.15 lookup by amps | Generator Feeder Wire |
| `atsAmpRating` | `ATSUnit.ampRating` | ATS Rating |
| `atsNeutralSwitched` | `ATSUnit.neutralSwitched` | Neutral Switching |
| `NEC 702.5 compliance` | `atsId !== null` | Transfer Equipment ✓ |

#### Updated 120% Rule Calculation (NEC 705.12(B))
When battery is AC-coupled (Enphase, Tesla, Franklin):
```
Total Backfeed = PV Backfeed Breaker + Battery Backfeed Breaker
120% Rule:     Main Panel Rating × 1.2 ≥ Main Panel Rating + Total Backfeed
Simplified:    Total Backfeed ≤ Main Panel Rating × 0.2
```

---

## SECTION 3 — VISUAL STANDARDS

### 3.1 Color Coding Standard

All SLD components must follow this color scheme consistently:

| Component | Color | Hex | Usage |
|-----------|-------|-----|-------|
| Solar PV / DC conductors | Black | `#000000` | DC strings, DC disconnect |
| AC conductors (grid-tied) | Black | `#000000` | Inverter output, MSP feed |
| Open air conductors | Green | `#005500` | Roof runs, NEC 690.31 |
| Equipment grounding | Green | `#005500` | EGC rail, ground symbols |
| Battery system | Blue | `#1565C0` | Battery, BUI, AC-coupled wires |
| Generator | Green (dark) | `#2E7D32` | Generator symbol, output wire |
| Generator ATS | Orange | `#E65100` | ATS symbol, transfer wires |
| Backup panel | Purple | `#6A1B9A` | Sub-panel, critical load wires |
| Enphase BUI/IQ SC3 | Blue (dark) | `#0D47A1` | BUI enclosure, battery wires |

### 3.2 Line Weight Standard

| Line Type | Weight | Usage |
|-----------|--------|-------|
| Border | 2.5px | Drawing border |
| Heavy | 2.0px | Equipment enclosures |
| Medium | 1.5px | Conductors, symbols |
| Thin | 1.0px | Internal component lines |
| Hair | 0.5px | Grid lines, fill patterns |
| Bus | 3.5px | Main bus bars |

### 3.3 Label Standard

| Label Type | Font Size | Style | Usage |
|-----------|-----------|-------|-------|
| Drawing title | 12px | Bold | "SINGLE LINE DIAGRAM" |
| Section header | 8.5px | Bold | "PV ARRAY", "MSP" |
| Component label | 7.5px | Normal | Equipment names |
| Sub-label | 7px | Normal | Specs, ratings |
| Segment label | 6.5px | Normal | Wire callouts |
| Tiny | 6.5px | Normal | NEC refs, notes |

### 3.4 Symbol Placement Rules

1. **Horizontal flow:** All primary components flow left-to-right: PV → Inverter → Disconnect → MSP → Meter → Grid
2. **Battery:** Always above the main bus line, connected to BUI/IQ SC3 (not directly to MSP)
3. **Generator + ATS:** Always below the main bus line, between utility meter and MSP
4. **Backup panel:** To the right of the BUI/IQ SC3, below the main bus
5. **Grounding rail:** Horizontal green line below all equipment, with drops from each component
6. **Callout numbers:** Sequential, starting at 1 (PV Array), incrementing left-to-right, then battery/gen/ATS

### 3.5 Enphase-Specific Layout

For Enphase microinverter systems with IQ Battery:

```
LEFT ←─────────────────────────────────────────────────────────────→ RIGHT

[PV Array] → [J-Box] → [AC Combiner] → [AC Disco] → [MSP] → [IQ SC3] → [Meter] → [Grid]
                                                        │         │
                                                   [PV Breaker]  [Battery Port]
                                                                  │
                                                           [IQ Battery 5P/10T]
                                                                  
                                                        [IQ SC3 Load Port]
                                                                  │
                                                        [Backup Sub-Panel]
                                                        (Critical Loads)
```

---

## SECTION 4 — TESTING CHECKLIST

### 4.1 Pre-Deployment Verification

#### TypeScript Compilation
- [ ] `npx tsc --noEmit` returns 0 errors
- [ ] No implicit `any` types introduced
- [ ] All new interface fields have proper optional (`?`) or required typing

#### Unit Tests — SLD Renderer
- [ ] Solar-only system (no battery, no generator): SLD renders without battery/gen/ATS symbols
- [ ] Battery-only (Enphase IQ Battery 5P): IQ SC3 appears, battery connects to IQ SC3, NOT to MSP bus
- [ ] Battery-only (Tesla Powerwall 3): Tesla Gateway appears, battery connects to gateway
- [ ] Generator-only (no battery): Generator + ATS appear below bus, no battery symbol
- [ ] Battery + Generator (Enphase + Generac): Both IQ SC3 and generator ATS appear, correctly separated
- [ ] Backup panel enabled: Backup sub-panel appears connected to IQ SC3 load port
- [ ] Microinverter topology: All symbols render correctly with micro-specific callout numbers
- [ ] String topology: All symbols render correctly with string-specific callout numbers

#### Data Flow Tests
- [ ] `batteryBackfeedA` from `page.tsx` reaches `renderSLDProfessional()` and appears in wire label
- [ ] `generatorKw` from `page.tsx` reaches generator symbol and shows correct kW/A values
- [ ] `atsAmpRating` from `page.tsx` reaches ATS symbol and shows correct amp rating
- [ ] `backupInterfaceId` from `page.tsx` triggers correct BUI symbol (Enphase vs Tesla vs Generac)
- [ ] 120% rule calculation includes battery backfeed amps when AC-coupled battery is configured

#### NEC Compliance Verification
- [ ] NEC 705.12(B): Battery backfeed breaker amps shown at MSP, 120% rule calculated
- [ ] NEC 706: Battery system labeled with UL 9540 listing
- [ ] NEC 702.5: Generator ATS labeled with transfer equipment note
- [ ] NEC 250.30: Neutral switching noted when ATS has `neutralSwitched: true`
- [ ] NEC 230.82: IQ SC3 labeled as service entrance rated when `serviceEntranceRated: true`
- [ ] NEC 690.12: Rapid shutdown note present when `rapidShutdownIntegrated: true`

#### Visual Quality Checks
- [ ] All component colors match the color coding standard (Section 3.1)
- [ ] All line weights match the standard (Section 3.2)
- [ ] Legend dynamically shows only active conductor types
- [ ] Equipment schedule includes battery capacity, backfeed amps, generator, ATS rows
- [ ] Conduit schedule includes battery and generator feeder runs
- [ ] No overlapping symbols or labels
- [ ] All callout numbers are sequential and non-repeating
- [ ] Title block shows correct system summary (topology, DC size, AC output, battery, generator)

#### Electrical Sizing Page
- [ ] Battery backfeed breaker size shown in AC calculations panel
- [ ] Updated 120% rule check accounts for battery backfeed amps
- [ ] Generator output amps and OCPD shown in equipment schedule
- [ ] ATS amp rating shown in equipment schedule
- [ ] NEC 702.5 compliance note shown when generator is configured

### 4.2 Manufacturer-Specific Test Cases

#### Enphase IQ8 + IQ Battery 5P + IQ SC3
- [ ] Topology: MICROINVERTER
- [ ] IQ SC3 appears between MSP and utility meter
- [ ] IQ Battery 5P connects to IQ SC3 battery port
- [ ] 20A backfeed breaker shown at MSP for battery
- [ ] `#6 AWG THWN-2` conductor callout on battery circuit
- [ ] IQ SC3 labeled: "Enphase IQ System Controller 3 · 200A · SE-RTD"
- [ ] NEC 230.82 reference shown on IQ SC3 symbol

#### Enphase IQ8 + IQ Battery 10T + IQ SC3
- [ ] 40A backfeed breaker shown at MSP (not 20A)
- [ ] `#8 AWG THWN-2` conductor callout (NEC 310.15 for 40A circuit)

#### Fronius Primo + No Battery + Generac RXSW100A3 + Generac 22kW
- [ ] Topology: STRING_INVERTER
- [ ] Generator symbol shows "Generac · 22 kW / 92A"
- [ ] ATS symbol shows "Generac RXSW100A3 · 100A"
- [ ] Generator ATS positioned between utility meter and MSP
- [ ] NEC 702.5 note present

#### SolarEdge SE7600H + SolarEdge Home Battery 10kWh
- [ ] Topology: STRING_WITH_OPTIMIZER (DC-coupled battery)
- [ ] Battery connects to SolarEdge Home Hub (hybrid inverter), NOT to MSP bus
- [ ] No separate backfeed breaker shown (DC-coupled — inverter handles combined output)
- [ ] Combined PV+battery backfeed breaker shown at MSP

### 4.3 Regression Tests

- [ ] Existing solar-only SLD output unchanged (no new symbols appear)
- [ ] String topology callout numbers unchanged (1-7 for standard path)
- [ ] Micro topology callout numbers unchanged (1-6 for standard path)
- [ ] Conduit schedule still populates from `computeSystem()` runs
- [ ] Title block data unchanged
- [ ] PDF export still works at ANSI C (2304×1728) dimensions

---

## SECTION 5 — IMPLEMENTATION SEQUENCE

Recommended development order to minimize merge conflicts and enable incremental testing:

### Phase 1 — Data Flow Fix (1-2 hours)
1. Add missing fields to SLD POST body in `app/engineering/page.tsx`
2. Add `backupInterfaceId/Brand/Model/IsATS` to `SLDProfessionalInput` interface
3. Wire new fields through `app/api/engineering/sld/route.ts`
4. Verify: `tsc --noEmit` passes

### Phase 2 — Enphase BUI/IQ SC3 Symbol (2-3 hours)
1. Add `renderBUI()` function to `lib/sld-professional-renderer.ts`
2. Implement manufacturer-aware BUI routing:
   - Enphase → IQ SC3 symbol (right of MSP)
   - Tesla → Backup Gateway 2 symbol
   - Generic → standard ATS symbol
3. Move battery connection from MSP bus to BUI output port
4. Add backfeed breaker at MSP for battery circuit
5. Verify: Enphase battery test case passes

### Phase 3 — Generator + Generator ATS (1-2 hours)
1. Implement generator symbol below bus (already partially done in BUILD v22)
2. Implement generator ATS symbol between utility and MSP
3. Add conductor callouts for generator feeder and ATS output
4. Verify: Generator test case passes

### Phase 4 — Inverter Icon Upgrade (1 hour)
1. Replace generic `inverterSymbol()` with `renderInverterBox()` function
2. Add manufacturer name, model, DC/AC arrow, output specs
3. Verify: All topology types render correctly

### Phase 5 — Electrical Sizing Data Flow (1-2 hours)
1. Add battery/generator/ATS data points to electrical sizing calculations
2. Update 120% rule to include battery backfeed amps
3. Add generator OCPD calculation
4. Verify: All data points appear on electrical sizing page

### Phase 6 — Final QA (1 hour)
1. Run full test checklist (Section 4)
2. `tsc --noEmit` — 0 errors
3. Commit as BUILD v23
4. Push and package ZIP

---

## APPENDIX A — ENPHASE SYSTEM ARCHITECTURE REFERENCE

### Enphase IQ System Controller 3 (IQ SC3) — Key Facts
- **Part Number:** ENV-IQ-AM3-3P
- **UL Listing:** UL 1741 / UL 1741-SA / UL 1008
- **Service Entrance Rated:** Yes (200A)
- **Transfer Type:** Automatic (grid-forming)
- **Neutral Switching:** Yes (NEC 250.30 compliant)
- **Max Backup Output:** 15.36 kW (64A continuous)
- **Compatible Batteries:** IQ Battery 3T, 5P, 10T
- **Generator Compatible:** Yes (via generator port)
- **NEC References:** 706, 705.12(B), 230.82, 250.30

### Enphase Battery Backfeed Breaker Sizes (NEC 705.12(B))
| Battery Model | Backfeed Breaker | Min. Dedicated Breaker |
|---------------|-----------------|----------------------|
| IQ Battery 3T | 15A | 15A |
| IQ Battery 5P | 20A | 20A |
| IQ Battery 10T | 40A | 40A |
| 2× IQ Battery 5P | 40A (combined) | 40A |
| 3× IQ Battery 5P | 60A (combined) | 60A |

### Enphase vs. Generic Battery Topology Comparison
| Aspect | Enphase (AC-coupled) | Generic DC-coupled |
|--------|---------------------|-------------------|
| Battery connects to | IQ SC3 BUI | Hybrid inverter DC bus |
| Backfeed breaker at MSP | Yes (battery-specific) | No (inverter handles combined) |
| Transfer switch | IQ SC3 (integrated) | Separate ATS required |
| Backup panel | Via IQ SC3 load port | Via inverter output |
| NEC reference | 705.12(B) + 706 | 705.12(B) (combined) |

---

## APPENDIX B — CURRENT CODEBASE STATE

### Files Modified in BUILD v22
- `lib/sld-professional-renderer.ts` — Added `renderBattery()`, `renderGenerator()`, `renderATS()`, `renderBackupPanel()` (but battery still connects to MSP bus — incorrect for Enphase)
- `app/api/engineering/sld/route.ts` — Added `batteryBackfeedA`, `generatorBrand/Kw`, `atsBrand/AmpRating` fields

### Files NOT Yet Modified (Required for BUILD v23)
- `app/engineering/page.tsx` — Does NOT send `batteryBackfeedA`, `generatorBrand`, `generatorKw`, `atsBrand`, `atsAmpRating`, `backupInterfaceId` to SLD API
- `lib/sld-professional-renderer.ts` — Battery still connects directly to MSP bus (wrong for Enphase); needs `renderBUI()` function and manufacturer-aware routing

### Equipment Database — Enphase Ecosystem (Complete in BUILD v21)
- `enphase-iq-battery-3t` — 3.36 kWh, 15A backfeed breaker
- `enphase-iq-battery-5p` — 5.0 kWh, 20A backfeed breaker  
- `enphase-iq-battery-10t` — 10.08 kWh, 40A backfeed breaker
- `enphase-iq-system-controller-3` — BUI/ATS, 200A SE-rated, UL 1741-SA
- `enphase-iq-sc3-ats` — Same device listed in ATS category
- `enphase-iq-combiner-5` — Load center / backup interface

---

*Document prepared for BUILD v23 development sprint.*  
*All NEC references are to NEC 2023 unless otherwise noted.*  
*Enphase specifications sourced from Enphase IQ System Controller 3 Installation Guide (2024).*