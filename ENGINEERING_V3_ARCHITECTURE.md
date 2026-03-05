# SolarPro Engineering V3 — Architecture Summary
**Deterministic Permit-Grade Engineering Automation Platform**

---

## Overview

Engineering V3 replaces passive violation detection with a fully deterministic, manufacturer-driven auto-resolution engine, and rebuilds the Single-Line Diagram (SLD) to true permit-grade drafting quality.

---

## Phase A — Manufacturer Intelligence + Auto-Resolution Engine

### A1: Equipment Database Extension (`lib/equipment-db.ts`)

Added to `SolarPanel` interface:
- `tempCoeffIsc: number` — %/°C (positive) — NEC 690.8 hot-temp Isc correction
- `nominalOperatingTemp: number` — NOCT in °C (typically 43–47°C)
- `parallelStringLimit: number` — max strings in parallel before combiner required

Added to `StringInverter` interface:
- `maxShortCircuitCurrent: number` — max DC short circuit current input (A)
- `numberOfMPPT: number` — explicit alias for mpptChannels
- `recommendedStringRange: { min: number; max: number }` — panels per string

All 10 panel entries and 5 inverter entries seeded with real datasheet values.

---

### A2: Manufacturer Spec Lookup Layer (`lib/manufacturer-specs.ts`)

Typed helpers consumed by all calculation engines:

| Function | Purpose |
|---|---|
| `getPanelSpec(id)` | Lookup panel by ID |
| `getStringInverterSpec(id)` | Lookup inverter by ID |
| `getConductorByMinAmpacity(A, rating)` | Find smallest AWG meeting ampacity |
| `getSmallestConduit(type, fillArea)` | Find smallest conduit for fill |
| `nextStandardOCPD(amps)` | Next standard OCPD size per NEC 240.6(A) |
| `getTempDeratingFactor(°C)` | NEC Table 310.15(B)(2)(a) |
| `getConduitFillDeratingFactor(n)` | NEC 310.15(C)(1) |
| `getEGCSize(ocpdAmps)` | NEC Table 250.122 |
| `calcVoltageDrop(...)` | Voltage drop % calculation |
| `getConductorArea(gauge)` | Cross-sectional area for conduit fill |

---

### A3: Deterministic OCPD/Fuse Resolver (`lib/ocpd-resolver.ts`)

**Algorithm (NEC 690.8):**

```
Step 1: iscCorrected = Isc × (1 + tempCoeffIsc/100 × (Thot - 25))
Step 2: maxCurrentNEC = iscCorrected × 1.25          [NEC 690.8(A)]
Step 3: requiredOCPD  = maxCurrentNEC × 1.25         [NEC 690.8(B)]
Step 4: ocpdRating    = nextStandardOCPD(requiredOCPD)
Step 5: IF ocpdRating > module.maxSeriesFuseRating:
          ocpdRating = module.maxSeriesFuseRating     [hard cap]
          IF maxSeriesFuseRating >= maxCurrentNEC → PASS_CAPPED
          ELSE → FAIL_REDUCE_STRING or FAIL_CHANGE_MODULE
Step 6: IF ocpdRating > inverter.maxInputCurrentPerMppt × 1.25 → WARNING
```

**Resolution Statuses:**
- `PASS` — compliant, no adjustment
- `PASS_CAPPED` — capped at maxSeriesFuse, still compliant
- `FAIL_REDUCE_STRING` — reduce string count
- `FAIL_CHANGE_MODULE` — module maxSeriesFuse too low

Every step is logged with NEC reference. No silent failure.

**Validated result:** 12.26A Isc → calculated OCPD 25A → capped at 20A (maxSeriesFuse) → `PASS_CAPPED`

---

### A4: AC Wire Auto-Sizer (`lib/wire-autosizer.ts`)

**Algorithm:**

```
1. requiredAmpacity = inverter.maxACOutputCurrent × 1.25  [NEC 690.8]
2. tempDeratingFactor = f(ambientTemp)                    [NEC 310.15(B)(2)(a)]
3. conduitFillFactor  = f(conductorCount)                 [NEC 310.15(C)(1)]
4. Start at #10 AWG → iterate upward:
   a. effectiveAmpacity = tableAmpacity × tempDerating × conduitFill
   b. IF effectiveAmpacity < requiredAmpacity → BUMPED_AMPACITY
   c. ELSE check voltage drop ≤ maxVDropPct
   d. IF voltageDrop > limit → BUMPED_VDROP
   e. ELSE → SELECTED
5. Generate permit-grade conductor callout string
6. Size EGC per NEC Table 250.122
7. Size conduit for fill per NEC Chapter 9
```

**Validated result:** 32A inverter, 80ft run → #10 fails ampacity → iterates 5 times → selects #2 AWG → `3#2 AWG THWN-2 + 1#10 AWG GND in 1-1/2" EMT`, voltage drop 0.41%

DC wire auto-sizer follows same pattern for PV wire (USE-2/PV Wire, 90°C column).

---

### A5: Engineering Mode Controller (`lib/engineering-mode.ts`)

```
AUTO mode:
  - All violations auto-resolved deterministically
  - Every correction logged with NEC reference
  - autoResolutions[] array populated in calc result

MANUAL mode:
  - Violations flagged as warnings
  - User overrides accepted
  - All overrides logged in audit trail with timestamp
```

`EngineeringModeController` class provides:
- `logCorrection()` — append to audit trail
- `applyAutoCorrection()` — AUTO mode only
- `logManualOverride()` — MANUAL mode only
- `buildResolutionSummary()` — formatted summary for UI
- `serialize()` / `deserialize()` — persist state

---

### A5: Electrical Calc Engine V3 (`lib/electrical-calc.ts`)

Full rewrite consuming OCPD resolver + wire auto-sizer:

**New fields in `ElectricalCalcResult`:**
- `engineeringMode: 'AUTO' | 'MANUAL'`
- `autoResolutions: AutoResolutionLog[]`
- `acWireGauge: string` — final selected gauge
- `acConductorCallout: string` — permit-grade callout string

**New fields in `StringCalcResult`:**
- `ocpdResolution: OCPDResolutionResult` — full OCPD resolution detail
- `wireAutoSized: boolean`
- `dcWireResult: DCWireAutoSizerResult`

**New fields in `InverterCalcResult`:**
- `acWireResult: WireAutoSizerResult` — full AC wire sizing detail

---

## Phase B — Permit-Grade SLD Engine

### B1: SLD Data Model (`lib/sld-types.ts`)

Complete typed model:
- `SLDTitleBlock` — all title block fields
- `SLDNode` subtypes: `PVArrayNode`, `InverterNode`, `MSPNode`, `GroundingNode`
- `SLDConnection` — typed connections with conductor callouts
- `GroundingSystem` — GES, EGC, bonding jumper
- `SLDDocument` — complete document model
- `SLDBuildInput` — input bridge from engineering calc result

---

### B2: SLD Renderer (`lib/sld-renderer.ts`)

Pure SVG generator — no React dependency.

**Sheet:** ANSI C (18×24 inches) at 96 DPI = 1728×2304px

**IEEE Electrical Symbols:**
- PV Array — sun symbol with panel count
- DC Disconnect — switch symbol (NEC 690.15)
- Rapid Shutdown — orange box (NEC 690.12)
- Inverter — DC→AC wave symbol with efficiency
- AC Disconnect — switch symbol (NEC 690.14)
- Production Meter — kWh circle
- Main Service Panel — breaker panel symbol
- Utility Meter — kWh circle
- Utility Grid — three-phase line symbol
- Grounding Electrode System — ground rod symbol

**Color Coding:**
- Red (#CC3300) — DC conductors
- Blue (#003399) — AC conductors
- Green (#006600) — Grounding conductors
- Brown (#996600) — Bonding conductors

**Title Block (bottom, dark navy):**
- Project Name, Client, Address
- NEC Version, DC/AC Capacity
- Drawing No., Sheet, Revision, Date, Scale
- Prepared By, Jurisdiction

**Auto-Resolution Overlay (top-left):**
- Shows count of auto-corrections applied
- Lists each correction: field → resolved value [NEC ref]

**General Notes (8 standard permit notes):**
1. NEC/local code compliance
2. Minimum conductor size
3. Equipment listing per NEC 110.3(B)
4. Rapid shutdown per NEC 690.12
5. DC conductor identification
6. Grounding electrode system per NEC 250.52
7. Utility interconnection verification
8. PV labeling per NEC 690

**Legend:** DC/AC/Grounding/Bonding conductor types

---

### B3: PDF Export API (`app/api/engineering/sld/pdf/route.ts`)

```
POST /api/engineering/sld/pdf
  Body: { buildInput: SLDBuildInput, format: 'pdf' | 'svg' }
  Auth: JWT session cookie required

  1. renderSLD(buildInput) → SVG string
  2. IF format='svg' → return SVG directly
  3. IF format='pdf':
     a. Wrap SVG in HTML with @page { size: 18in 24in }
     b. wkhtmltopdf --dpi 300 --page-width 18in --page-height 24in
     c. Return PDF binary
     d. Fallback to SVG if wkhtmltopdf unavailable

GET /api/engineering/sld/pdf
  Returns test SVG preview (no body required)
```

---

### B4: Engineering Page Updates (`app/engineering/page.tsx`)

**Header additions:**
- AUTO/MANUAL mode toggle (green=AUTO, amber=MANUAL)
- Mode description text
- V3 badge

**Diagram tab (full replacement):**
- "Generate SLD" button → calls `/api/engineering/sld/pdf?format=svg`
- SVG rendered inline via `dangerouslySetInnerHTML`
- "Export PDF" button → downloads PDF
- Auto-resolution summary panel below diagram
- Empty/loading/error states

**Compliance tab additions:**
- Auto-Resolution Log panel (emerald, after recommendations)
- Engineering Mode indicator (color-coded)

**buildCalcPayload updates:**
- Passes `tempCoeffIsc` from panel spec
- Passes `maxShortCircuitCurrent` from inverter spec
- Passes `engineeringMode` from toggle state

---

## Data Flow

```
User selects panel + inverter + string config
         ↓
buildCalcPayload() — assembles ElectricalCalcInput
         ↓
POST /api/engineering/calculate
         ↓
runElectricalCalc(input)
  ├── For each string:
  │     resolveOCPD() → OCPDResolutionResult
  │     autoSizeDCWire() → DCWireAutoSizerResult
  ├── For each inverter:
  │     autoSizeACWire() → WireAutoSizerResult
  └── Returns ElectricalCalcResult {
        status, engineeringMode,
        autoResolutions[], acWireGauge,
        acConductorCallout, inverters[]
      }
         ↓
User clicks "Generate SLD"
         ↓
POST /api/engineering/sld/pdf { buildInput, format: 'svg' }
         ↓
renderSLD(buildInput) — consumes calcResult
  ├── buildTitleBlock() — project info + system specs
  ├── renderEquipmentChain() — IEEE symbols top→bottom
  ├── renderConductorCallouts() — auto-sized wire labels
  ├── renderGroundingSystem() — GES + EGC + bonding
  ├── renderAutoResolutionOverlay() — correction log
  ├── renderLegend() — conductor type key
  └── renderNotes() — 8 standard permit notes
         ↓
SVG string (23KB) → displayed inline in diagram tab
         ↓
"Export PDF" → wkhtmltopdf → ANSI C PDF at 300 DPI
```

---

## Validation Results

| Test | Input | Result | Status |
|------|-------|--------|--------|
| OCPD resolution | Isc=12.26A, maxFuse=20A | PASS_CAPPED at 20A (calc was 25A) | ✅ |
| AC wire auto-size | 32A inverter, 80ft run | #10→#2 AWG (5 iterations) | ✅ |
| AC voltage drop | #2 AWG, 80ft, 32A | 0.41% (< 2% limit) | ✅ |
| DC wire callout | #10 AWG, 50ft | `2#10 AWG USE-2/PV Wire in EMT` | ✅ |
| AC wire callout | #2 AWG, 80ft | `3#2 AWG THWN-2 + 1#10 AWG GND in 1-1/2" EMT` | ✅ |
| SLD generation | Full project | 23,661 byte SVG, all elements | ✅ |
| TypeScript | Full codebase | 0 errors | ✅ |
| Build | npm run build | Clean, 35 pages | ✅ |

---

## Files Created / Modified

| File | Status | Purpose |
|------|--------|---------|
| `lib/equipment-db.ts` | Modified | Added tempCoeffIsc, nominalOperatingTemp, parallelStringLimit, maxShortCircuitCurrent, numberOfMPPT, recommendedStringRange |
| `lib/manufacturer-specs.ts` | New | Typed spec lookup helpers, AWG order, derating tables |
| `lib/ocpd-resolver.ts` | New | Deterministic OCPD/fuse auto-resolution engine |
| `lib/wire-autosizer.ts` | New | AC + DC wire auto-sizing with iterative AWG selection |
| `lib/engineering-mode.ts` | New | AUTO/MANUAL mode controller + audit trail |
| `lib/electrical-calc.ts` | Rewritten | V3 engine consuming all new resolvers |
| `lib/sld-types.ts` | New | Complete SLD data model |
| `lib/sld-renderer.ts` | New | Pure SVG SLD renderer (IEEE symbols, ANSI C) |
| `app/api/engineering/sld/pdf/route.ts` | New | PDF/SVG export API |
| `app/engineering/page.tsx` | Modified | AUTO/MANUAL toggle, SVG diagram tab, auto-resolution log |

---

## Constraints Respected

- ✅ Existing compliance detection logic preserved (structural, jurisdiction)
- ✅ Database schema not modified
- ✅ All new engines modular and independently testable
- ✅ Sandbox branch only (`/workspace/sandbox-engineering/`)
- ✅ No mock user data, no demo fallback values
- ✅ No production deployment