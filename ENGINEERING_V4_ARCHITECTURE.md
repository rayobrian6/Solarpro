# SolarPro Engineering V4 — Architecture & Developer Guide

> **Version:** 4.0 · **Status:** Production  
> **Build:** `npm run build` → 0 errors, 0 warnings  
> **TypeScript:** `npx tsc --noEmit` → 0 errors

---

## Table of Contents

1. [Overview](#overview)
2. [Core Principles](#core-principles)
3. [Architecture Diagram](#architecture-diagram)
4. [Equipment Registry](#equipment-registry)
5. [Topology Manager](#topology-manager)
6. [Structural Rules Engine](#structural-rules-engine)
7. [BOM Intelligence Engine](#bom-intelligence-engine)
8. [Professional SLD Renderer](#professional-sld-renderer)
9. [Unified Engineering Intelligence Panel](#unified-engineering-intelligence-panel)
10. [API Routes](#api-routes)
11. [How to Add a New Brand](#how-to-add-a-new-brand)
12. [Schema Reference](#schema-reference)
13. [NEC References](#nec-references)

---

## Overview

Engineering V4 is a **fully brand-agnostic, rules-driven** solar PV engineering platform. Every equipment decision, accessory requirement, BOM line item, and SLD stage is derived from structured JSON registry entries — never from hardcoded brand conditionals.

**Key capabilities:**
- Registry-driven equipment lookup (no `if (brand === 'SolarEdge')` anywhere)
- Topology-based accessory resolution (STRING_INVERTER → DC disconnect, RSD, etc.)
- ASCE 7-22 structural calculations with spacing as a computed parameter
- Professional IEEE 315 / ANSI Y32.9 SLD on ANSI C (24×18") sheet
- 7-stage BOM auto-derived from registry + topology + mount + conduit + jurisdiction
- Unified Engineering Intelligence Panel with 7 action buttons

---

## Core Principles

### 1. No Brand Conditionals
```typescript
// ❌ NEVER do this
if (inverter.manufacturer === 'SolarEdge') {
  requireOptimizer = true;
}

// ✅ ALWAYS do this
const entry = getRegistryEntryV4(inverterId);
const topology = getTopologyForEquipmentV4(inverterId);
// topology === 'STRING_WITH_OPTIMIZER' if the registry says so
```

### 2. Registry as Single Source of Truth
Every equipment item has a structured `EquipmentRegistryEntry` with:
- `topologyType` — canonical topology this equipment belongs to
- `requiredAccessories` — accessory rules with quantity formulas
- `electricalSpecs` — voltage, current, power limits
- `structuralSpecs` — weight, dimensions, attachment requirements
- `compatibilityRules` — what it works with / requires

### 3. Topology Drives Everything
The `TopologyType` enum is the canonical key for:
- Which accessory classes are required
- Which SLD stages to render
- Which BOM stages to populate
- Which compliance checks to run

### 4. Safety Factor Fail-Only Rule
Structural calculations **only fail** when `safetyFactor < 2.0`. Spacing is a **computed output**, not a hardcoded input.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Engineering Page (UI)                         │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │   Main Tab Content       │  │  Intelligence Panel (V4)     │ │
│  │  Config / Compliance /   │  │  Auto-Fill  Auto-Fix         │ │
│  │  SLD / BOM / Structural  │  │  Explain Logic  Decision Log │ │
│  │  Mounting / Permit       │  │  Generate BOM  Generate SLD  │ │
│  └──────────────────────────┘  │  Generate Full Permit Pkg    │ │
│                                └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API Routes (V4)                           │
│  POST /api/engineering/topology    → topology-manager.ts        │
│  POST /api/engineering/bom         → bom-engine-v4.ts           │
│  POST /api/engineering/sld         → sld-professional-renderer  │
│  POST /api/engineering/structural  → structural-calc.ts         │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Core Libraries (lib/)                         │
│  equipment-registry-v4.ts   ← JSON registry, lookup functions   │
│  topology-manager.ts        ← TOPOLOGY_RULES map, resolver      │
│  bom-engine-v4.ts           ← 7-stage BOM generator             │
│  sld-professional-renderer  ← IEEE 315 SVG renderer             │
│  structural-calc.ts         ← ASCE 7-22 calculations            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Equipment Registry

**File:** `lib/equipment-registry-v4.ts`

### TopologyType Enum

```typescript
export type TopologyType =
  | 'STRING_INVERTER'
  | 'STRING_WITH_OPTIMIZER'
  | 'MICROINVERTER'
  | 'HYBRID_INVERTER'
  | 'DC_COUPLED_BATTERY'
  | 'AC_COUPLED_BATTERY'
  | 'GROUND_MOUNT_FIXED_TILT'
  | 'GROUND_MOUNT_DRIVEN_PILE'
  | 'ROOF_RAIL_BASED'
  | 'ROOF_RAIL_LESS'
  | 'ROOF_STANDING_SEAM';
```

### EquipmentRegistryEntry Structure

```typescript
interface EquipmentRegistryEntry {
  id: string;                          // Unique slug, e.g. 'ironridge-xr100'
  manufacturer: string;                // e.g. 'IronRidge'
  model: string;                       // e.g. 'XR100 Rail System'
  category: EquipmentCategory;         // 'racking' | 'inverter' | 'panel' | ...
  topologyType: TopologyType;          // Canonical topology
  electricalSpecs: ElectricalSpecs;    // Voltage, current, power limits
  structuralSpecs: StructuralSpecs;    // Weight, dimensions, attachment
  requiredAccessories: AccessoryRule[];// Accessories with quantity formulas
  compatibilityRules: CompatibilityRule[];
  wireSizingConstraints: WireSizingConstraint[];
  certifications: string[];            // e.g. ['ICC-ES ESR-4575', 'UL 2703']
  notes: string[];                     // Engineering notes
  necReferences: string[];             // e.g. ['NEC 690.12', 'NEC 705.12']
}
```

### AccessoryQuantityRule Types

| Type | Description | Example |
|------|-------------|---------|
| `perModule` | One per solar module | Microinverter: 1 per module |
| `perString` | One per DC string | Fuse: 1 per string |
| `perInverter` | One per inverter | AC disconnect: 1 per inverter |
| `perSystem` | One per system | Gateway: 1 per system |
| `perBranch` | One per trunk cable branch | Terminator: 1 per branch |
| `perRailSection` | One per rail section | End cap: 2 per rail section |
| `perAttachment` | One per roof attachment | Flashing: 1 per attachment |
| `perKw` | Per kW of system capacity | Grounding lug: 1 per kW |
| `formula` | Custom formula string | `Math.ceil(moduleCount / 4)` |

### Lookup Functions

```typescript
// Get a registry entry by ID
getRegistryEntryV4(id: string): EquipmentRegistryEntry | undefined

// Get the topology type for any equipment
getTopologyForEquipmentV4(id: string): TopologyType | undefined

// Get required accessories for an equipment item
getRequiredAccessoriesV4(id: string): AccessoryRule[]

// Get all entries in a category
getEntriesByCategoryV4(category: EquipmentCategory): EquipmentRegistryEntry[]

// Get all entries for a topology type
getEntriesByTopologyV4(topology: TopologyType): EquipmentRegistryEntry[]

// Check compatibility between two equipment items
checkCompatibilityV4(id1: string, id2: string): { compatible: boolean; reason?: string }

// Evaluate a quantity formula
evaluateQuantityFormulaV4(formula: string, ctx: FormulaContext): number
```

---

## Topology Manager

**File:** `lib/topology-manager.ts`

The Topology Manager is the **single source of truth** for all topology → accessory class mappings. It uses a `TOPOLOGY_RULES` map — never brand conditionals.

### TOPOLOGY_RULES Map

```typescript
const TOPOLOGY_RULES: Record<TopologyType, TopologyRuleSet> = {
  STRING_INVERTER: {
    label: 'String Inverter',
    description: 'Standard string inverter topology...',
    requiredAccessoryClasses: [
      'dc_disconnect',
      'rapid_shutdown_device',
      'ac_disconnect',
      'grounding_system',
      'production_meter',
      'warning_labels',
    ],
    optionalAccessoryClasses: ['dc_combiner', 'battery_storage'],
    sldStages: ['array', 'dc_combiner', 'inverter', 'ac_disconnect', 'utility'],
    bomStages: ['array', 'dc', 'inverter', 'ac', 'structural', 'monitoring', 'labels'],
    complianceChecks: ['NEC 690.7', 'NEC 690.8', 'NEC 690.12', 'NEC 705.12'],
  },
  MICROINVERTER: {
    label: 'Microinverter',
    requiredAccessoryClasses: [
      'trunk_cable',
      'trunk_cable_terminator',
      'sealing_cap',
      'gateway_combiner',
      'ac_disconnect',
      'grounding_system',
      'warning_labels',
    ],
    // ...
  },
  // ... all other topologies
};
```

### resolveTopology Function

```typescript
function resolveTopology(ctx: TopologyManagerContext): TopologyResolutionResult

interface TopologyManagerContext {
  inverterId?: string;
  optimizerId?: string;
  rackingId?: string;
  batteryId?: string;
  moduleCount?: number;
  stringCount?: number;
  inverterCount?: number;
  roofType?: string;
  systemType?: string;
}

interface TopologyResolutionResult {
  topology: TopologyType;
  mountTopology: TopologyType;
  label: string;
  confidence: number;
  reason: string;
  resolvedAccessories: ResolvedAccessory[];
  missingRequiredCategories: string[];
  sldStages: string[];
  bomStages: string[];
  complianceFlags: Record<string, boolean>;
  ruleSet: TopologyRuleSet;
}
```

### Topology Override Logic

```
optimizer + string inverter  → STRING_WITH_OPTIMIZER
battery + hybrid inverter    → DC_COUPLED_BATTERY
battery + microinverter      → AC_COUPLED_BATTERY
driven pile racking          → GROUND_MOUNT_DRIVEN_PILE
standing seam racking        → ROOF_STANDING_SEAM
rail-less racking            → ROOF_RAIL_LESS
```

---

## Structural Rules Engine

**File:** `lib/structural-calc.ts`  
**API:** `POST /api/engineering/structural`

### Key Design Decisions

1. **Spacing is a computed parameter** — not hardcoded to 48" or 72"
2. **Fail ONLY when SF < 2.0** — warnings for SF 2.0–2.5
3. **Recalculates on every input change** via debounced auto-calc

### Safety Factor Formula

```
safetyFactor = lagBoltCapacity / upliftPerAttachment

where:
  upliftPerAttachment = (windUplift + snowLoad - deadLoad) × tributaryArea / attachmentCount
  lagBoltCapacity     = species-specific withdrawal resistance × embedment depth
```

### API Response

```typescript
{
  success: true,
  status: 'PASS' | 'WARNING' | 'FAIL',
  summary: {
    safetyFactor: number,      // e.g. 2.84
    marginPct: number,         // e.g. 42.0 (% above minimum)
    spacingCompliant: boolean,
  },
  detail: {
    windLoad: { pressure: number, uplift: number, ... },
    snowLoad: { groundLoad: number, roofLoad: number, ... },
    deadLoad: { panelWeight: number, rackingWeight: number, ... },
    rafter:   { allowableSpan: number, actualSpan: number, ... },
    attachment: { capacity: number, demand: number, safetyFactor: number },
  },
  complianceTable: [
    { check: 'Wind Uplift (ASCE 7-22)', status: 'PASS', value: '...', limit: '...' },
    { check: 'Snow Load (ASCE 7-22)',   status: 'PASS', value: '...', limit: '...' },
    // ...
  ],
}
```

---

## BOM Intelligence Engine

**File:** `lib/bom-engine-v4.ts`  
**API:** `POST /api/engineering/bom`

### 7-Stage BOM Structure

| Stage | ID | Contents |
|-------|----|----------|
| 1 | `array` | Solar panels, microinverters/optimizers |
| 2 | `dc` | DC wire, conduit, trunk cable (micro), terminators |
| 3 | `inverter` | String/hybrid inverter, battery, combiner |
| 4 | `ac` | AC wire, conduit, AC disconnect, backfeed breaker, production meter |
| 5 | `structural` | Racking system, all accessories from registry (conditional on roofType) |
| 6 | `monitoring` | Gateway, monitoring device |
| 7 | `labels` | NEC warning labels (690.31, 690.54, 690.56, 705.12, 690.13) |

### Quantity Resolution

Quantities are resolved by evaluating `AccessoryQuantityRule` formulas:

```typescript
// perModule: qty = moduleCount
// perString: qty = stringCount
// formula:   qty = eval(formula, { moduleCount, stringCount, inverterCount, systemKw, ... })

// Example formula: "Math.ceil(moduleCount / 4) * 2"
// → For 20 modules: Math.ceil(20/4) * 2 = 10
```

### Conditional Accessories

```typescript
// Flashing only for shingle/tile roofs
if (roofType === 'shingle' || roofType === 'tile') {
  addAccessory('flashing_kit');
}

// Ballast only for flat roofs
if (roofType.startsWith('flat_')) {
  addAccessory('ballast_tray');
}
```

### NEC 705.12 120% Rule

The BOM engine auto-generates a compliance note:
```
Backfeed breaker = ceil(systemAcAmps × 1.25 / 5) × 5 A
Max allowed = mainPanelAmps × 0.20
Status: PASS if backfeedBreaker ≤ mainPanelAmps × 0.20
```

---

## Professional SLD Renderer

**File:** `lib/sld-professional-renderer.ts`  
**API:** `POST /api/engineering/sld`

### Output Specifications

- **Format:** SVG (inline, embeddable)
- **Sheet size:** ANSI C — 2304 × 1728 px (24" × 18" at 96 DPI)
- **Orientation:** Landscape
- **Color palette:**
  - DC conductors: `#ef4444` (red)
  - AC conductors: `#3b82f6` (blue)
  - Grounding: `#22c55e` (green)
  - Data/comms: `#a855f7` (purple)

### IEEE 315 Symbol Library

| Symbol | Function |
|--------|----------|
| `symPVModule` | Solar panel (rectangle with diagonal) |
| `symPVString` | String of panels |
| `symInverter` | String inverter (circle with sine wave) |
| `symMicroinverter` | Microinverter (small inverter symbol) |
| `symDisconnect` | Disconnect switch (ANSI) |
| `symOCPD` | Fuse or breaker (configurable) |
| `symMeter` | Revenue-grade meter (circle with M) |
| `symUtilityGrid` | Utility grid (3-phase symbol) |
| `symMainPanel` | Main service panel |
| `symGateway` | Communications gateway |
| `symRSD` | Rapid shutdown device |
| `symOptimizer` | Power optimizer |
| `symCombiner` | DC combiner box |
| `symGround` | Earth ground |

### Topology-Specific Renderers

```typescript
// Routes to the correct renderer based on topologyType
renderProfessionalSLD(input) → SVG string

// Internal renderers:
renderStringInverterSLD(input, w, h)    // STRING_INVERTER
renderOptimizerSLD(input, w, h)         // STRING_WITH_OPTIMIZER
renderMicroinverterSLD(input, w, h)     // MICROINVERTER
renderGroundMountSLD(input, w, h)       // GROUND_MOUNT_*
```

### Title Block

The ANSI C title block includes:
- Project name, client, address
- Designer, drawing number, revision, date
- System specs (kW DC/AC, modules, topology)
- NEC version and jurisdiction
- Key NEC references (690.7, 690.8, 690.12, 705.12, etc.)
- 120% busbar rule pass/fail box

---

## Unified Engineering Intelligence Panel

**Location:** Right sidebar in `app/engineering/page.tsx`  
**State:** Collapsible (default: open, 320px wide)

### 7 Action Buttons

| Button | API Called | Description |
|--------|-----------|-------------|
| **Auto-Fill Fields** | `/api/engineering/topology` | Resolves topology, fills smart defaults, populates ecosystem accessories |
| **Auto-Fix All Issues** | `/api/engineering/structural` | Calls structural V4 API, reduces attachment spacing if SF < 2.0, upgrades wire if V-drop > 3% |
| **Explain Logic** | `/api/engineering/topology` | Returns full topology resolution explanation: label, confidence, required accessories, SLD stages, compliance flags |
| **Show Decision Log** | (local state) | Toggles inline decision log showing all auto/manual/info actions with timestamps |
| **Generate BOM** | `/api/engineering/bom` | Calls V4 BOM engine, flattens 7-stage result, displays in BOM tab |
| **Generate SLD** | `/api/engineering/sld` | Calls V4 professional SLD renderer, displays IEEE 315 SVG in Diagram tab |
| **Generate Full Permit Package** | All 3 above in parallel | Runs SLD + BOM + compliance check simultaneously, navigates to Permit tab |

### Decision Log

Every auto action is logged with:
```typescript
{ ts: string; action: string; detail: string; type: 'auto' | 'manual' | 'info' }
```

Types:
- `auto` — system-initiated fix (green)
- `manual` — engineer override (amber)
- `info` — informational (blue)

---

## API Routes

### POST /api/engineering/topology

**Input:**
```json
{
  "inverterId": "fronius-primo-8.2",
  "optimizerId": "solaredge-p401",
  "rackingId": "ironridge-xr100",
  "batteryId": "enphase-iq-battery-5p",
  "moduleCount": 20,
  "stringCount": 2,
  "inverterCount": 1,
  "roofType": "shingle",
  "systemType": "roof"
}
```

**Output:**
```json
{
  "success": true,
  "topology": "STRING_WITH_OPTIMIZER",
  "topologyLabel": "String + Optimizer",
  "confidence": 0.95,
  "reason": "Optimizer detected in registry",
  "resolvedAccessories": [...],
  "missingRequiredCategories": [],
  "sldStages": ["array", "optimizer", "dc_combiner", "inverter", "ac_disconnect", "utility"],
  "bomStages": ["array", "dc", "inverter", "ac", "structural", "monitoring", "labels"],
  "complianceFlags": { "requiresRSD": true, "requiresDCDisconnect": true },
  "ruleSet": { "label": "...", "description": "...", "requiredAccessoryClasses": [...] },
  "topologyLabels": { "STRING_INVERTER": "String Inverter", ... }
}
```

### POST /api/engineering/bom

**Input:**
```json
{
  "inverterId": "fronius-primo-8.2",
  "rackingId": "ironridge-xr100",
  "panelId": "qcells-peak-duo-400",
  "moduleCount": 20,
  "stringCount": 2,
  "inverterCount": 1,
  "systemKw": 8.0,
  "dcWireGauge": "#10 AWG",
  "acWireGauge": "#8 AWG",
  "conduitType": "EMT",
  "roofType": "shingle",
  "mainPanelAmps": 200,
  "topologyType": "STRING_INVERTER",
  "format": "json"
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "stages": [
      {
        "stageId": "array",
        "label": "Stage 1 — Array",
        "items": [
          { "id": "...", "manufacturer": "Q CELLS", "model": "Q.PEAK DUO BLK ML-G10+", "quantity": 20, "unit": "ea", "partNumber": "...", "derivedFrom": "moduleCount" }
        ]
      }
    ],
    "totalItems": 42,
    "complianceNotes": ["NEC 705.12: 120% rule — backfeed breaker 20A ≤ 40A max. PASS."]
  }
}
```

### POST /api/engineering/sld

**Input:**
```json
{
  "projectName": "Smith Residence",
  "topologyType": "STRING_INVERTER",
  "totalModules": 20,
  "panelModel": "Q CELLS Q.PEAK DUO 400W",
  "inverterModel": "Fronius Primo 8.2",
  "inverterKw": 8.2,
  "mainPanelAmps": 200,
  "necVersion": "NEC 2023",
  "format": "svg"
}
```

**Output:** SVG string (Content-Type: image/svg+xml) or JSON with `{ svg: "..." }`

### POST /api/engineering/structural

**Input:**
```json
{
  "windSpeed": 115,
  "windExposure": "C",
  "groundSnowLoad": 20,
  "roofType": "shingle",
  "roofPitch": 20,
  "rafterSpacing": 24,
  "rafterSpan": 14,
  "rafterSize": "2x6",
  "rafterSpecies": "Douglas Fir-Larch",
  "panelCount": 20,
  "attachmentSpacing": 48
}
```

**Output:**
```json
{
  "success": true,
  "status": "PASS",
  "summary": { "safetyFactor": 2.84, "marginPct": 42.0, "spacingCompliant": true },
  "detail": { "windLoad": {...}, "snowLoad": {...}, "deadLoad": {...}, "rafter": {...}, "attachment": {...} },
  "complianceTable": [...]
}
```

---

## How to Add a New Brand

Adding a new brand requires **only one file change**: add an entry to `EQUIPMENT_REGISTRY_V4` in `lib/equipment-registry-v4.ts`.

### Step 1: Choose the correct TopologyType

```typescript
// For a new rail-based racking system:
topologyType: 'ROOF_RAIL_BASED'

// For a new microinverter:
topologyType: 'MICROINVERTER'

// For a new string inverter:
topologyType: 'STRING_INVERTER'
```

### Step 2: Create the registry entry

```typescript
// Example: Adding "SunRail Pro XR200" racking system
{
  id: 'sunrail-pro-xr200',                    // Unique slug
  manufacturer: 'SunRail',
  model: 'Pro XR200 Rail System',
  category: 'racking',
  topologyType: 'ROOF_RAIL_BASED',
  
  electricalSpecs: {
    maxSystemVoltage: 1000,
    groundingMethod: 'integrated_bonding',
  },
  
  structuralSpecs: {
    maxSpanInches: 72,
    maxCantileverInches: 24,
    allowableUpliftLbsPerFt: 45,
    allowableDownloadLbsPerFt: 60,
    attachmentMethod: 'lag_bolt',
    minEmbedmentInches: 2.5,
  },
  
  requiredAccessories: [
    {
      accessoryClass: 'end_cap',
      description: 'XR200 End Cap',
      quantityRule: { type: 'perRailSection', multiplier: 2 },
      partNumber: 'XR200-EC',
    },
    {
      accessoryClass: 'mid_clamp',
      description: 'XR200 Mid Clamp',
      quantityRule: { type: 'perModule', multiplier: 2 },
      partNumber: 'XR200-MC',
    },
    {
      accessoryClass: 'end_clamp',
      description: 'XR200 End Clamp',
      quantityRule: { type: 'perRailSection', multiplier: 2 },
      partNumber: 'XR200-EC2',
    },
    {
      accessoryClass: 'l_foot',
      description: 'XR200 L-Foot',
      quantityRule: { type: 'formula', formula: 'Math.ceil(moduleCount / 2) + 2' },
      partNumber: 'XR200-LF',
      // Conditional: only for shingle/tile roofs
      condition: 'roofType === "shingle" || roofType === "tile"',
    },
    {
      accessoryClass: 'flashing',
      description: 'EPDM Flashing Kit',
      quantityRule: { type: 'perAttachment' },
      partNumber: 'XR200-FL',
      condition: 'roofType === "shingle"',
    },
  ],
  
  compatibilityRules: [
    { type: 'requires', targetCategory: 'panel', reason: 'Requires solar panels' },
    { type: 'incompatible', targetId: 'unirac-rm-ballast', reason: 'Ballast system for flat roofs only' },
  ],
  
  wireSizingConstraints: [],
  
  certifications: ['UL 2703', 'ICC-ES ESR-XXXX'],
  notes: [
    'Max span 72" between attachments',
    'Min 2.5" lag bolt embedment into rafter',
    'Integrated grounding bonding — no additional bonding jumpers required',
  ],
  necReferences: ['NEC 690.43', 'NEC 250.52'],
},
```

### Step 3: Verify

```bash
# TypeScript check
npx tsc --noEmit

# Test the topology API
curl -X POST http://localhost:3000/api/engineering/topology \
  -H "Content-Type: application/json" \
  -d '{"rackingId": "sunrail-pro-xr200", "moduleCount": 20}'

# Test the BOM API
curl -X POST http://localhost:3000/api/engineering/bom \
  -H "Content-Type: application/json" \
  -d '{"rackingId": "sunrail-pro-xr200", "moduleCount": 20, "roofType": "shingle"}'
```

### Step 4: No other changes needed

The Topology Manager, BOM Engine, and SLD Renderer will automatically:
- Resolve the correct accessory classes from the registry
- Include the new equipment in BOM Stage 5 (Structural)
- Apply conditional accessories based on `roofType`
- Evaluate quantity formulas dynamically

---

## Schema Reference

### EquipmentCategory Values

```typescript
type EquipmentCategory =
  | 'panel'           // Solar modules
  | 'inverter'        // String/hybrid inverters
  | 'microinverter'   // Module-level inverters
  | 'optimizer'       // Power optimizers
  | 'racking'         // Rail-based racking
  | 'rail_less_mount' // Rail-less attachments (RoofTech RT-MINI)
  | 'ground_mount'    // Ground mount systems
  | 'driven_pile'     // Driven pile foundations (PLP POWER PEAK)
  | 'standing_seam'   // Standing seam clamps (S-5!)
  | 'flat_roof'       // Flat roof ballast systems
  | 'battery'         // Battery storage
  | 'gateway'         // Monitoring gateways
  | 'disconnect'      // AC/DC disconnects
  | 'meter'           // Production meters
  | 'conduit'         // Conduit and fittings
  | 'wire'            // Conductors
  | 'label'           // NEC warning labels
  | 'grounding';      // Grounding equipment
```

### AccessoryRule Structure

```typescript
interface AccessoryRule {
  accessoryClass: string;         // e.g. 'end_cap', 'flashing', 'trunk_cable'
  description: string;            // Human-readable description
  manufacturer?: string;          // Optional specific manufacturer
  partNumber?: string;            // Optional part number
  quantityRule: AccessoryQuantityRule;
  condition?: string;             // Optional JS expression, e.g. 'roofType === "shingle"'
  necReference?: string;          // e.g. 'NEC 690.43'
  notes?: string;
}

interface AccessoryQuantityRule {
  type: 'perModule' | 'perString' | 'perInverter' | 'perSystem' |
        'perBranch' | 'perRailSection' | 'perAttachment' | 'perKw' | 'formula';
  multiplier?: number;            // For perModule, perString, etc.
  formula?: string;               // For type === 'formula'
  roundUp?: boolean;              // Default: true
}
```

---

## NEC References

| Code | Section | Description |
|------|---------|-------------|
| NEC 690.7 | Maximum Voltage | String voltage calculation with temperature correction |
| NEC 690.8 | OCPD Sizing | 125% of Isc for string fuses/breakers |
| NEC 690.11 | Arc-Fault Protection | AFCI required for DC circuits > 80V |
| NEC 690.12 | Rapid Shutdown | Module-level shutdown within 30s for rooftop arrays |
| NEC 690.14 | AC Disconnect | Required at point of utility interconnection |
| NEC 690.15 | DC Disconnect | Required for each inverter |
| NEC 690.31 | Wiring Methods | PV source/output circuit wiring requirements |
| NEC 690.43 | Equipment Grounding | Grounding of PV equipment |
| NEC 690.54 | Interactive System Disconnecting Means | Label requirements |
| NEC 690.56 | Identification of Power Sources | Warning label at utility meter |
| NEC 705.12 | 120% Busbar Rule | Backfeed breaker ≤ 20% of main panel rating |
| NEC 300.5 | Underground Installations | Burial depth requirements |
| NEC 250.52 | Grounding Electrode System | Ground rod requirements |
| NEC 706 | Energy Storage Systems | Battery storage requirements |

---

## Registered Equipment (V4)

### Solar Panels
- Q CELLS Q.PEAK DUO BLK ML-G10+ 400W
- REC Alpha Pure-R 405W
- Silfab Elite SIL-380-BK

### String Inverters
- Fronius Primo 8.2-1
- SMA Sunny Boy 7.7-US
- Sungrow SG8K-D

### Hybrid Inverters
- SolarEdge SE7600H / SE10000H (with optimizer support)

### Microinverters
- Enphase IQ8+ / IQ8M

### Power Optimizers
- SolarEdge P401 / P505
- Tigo TS4-A-O

### Racking Systems
- **IronRidge XR100 / XR1000** — Rail-based, shingle/tile/metal
- **SnapNrack Series 100 / Ultra-Light** — Rail-based
- **Unirac SunFrame / RM Ballast** — Rail-based / flat roof
- **RoofTech RT-MINI** — Rail-less, ICC-ES ESR-4575
- **QuickMount PV Classic / Tile** — Tile hook system
- **EcoFasten Rock-It** — Rail-less, shingle
- **S-5! PVKIT 2.0 / Corrugated** — Standing seam / corrugated metal
- **PLP POWER PEAK** — Driven pile, ICC-ES ESR-3895

### Battery Storage
- Enphase IQ Battery 5P (13.0 kWh)
- Tesla Powerwall 3 (13.5 kWh)
- SolarEdge Energy Hub (9.7 kWh)

---

*SolarPro Engineering V4 — Brand-agnostic, rules-driven, permit-grade.*  
*Last updated: 2025 · NEC 2023 · ASCE 7-22 · IBC 2021*