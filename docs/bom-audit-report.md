# BOM System Audit Report — Full Pipeline Verification
**Date:** April 2025  
**Scope:** Solar Fence (priority), Ground Mount, Roof Mount  
**Status:** 🔴 Critical gaps identified

---

## 1. EXECUTIVE SUMMARY

The current BOM system has a **fundamental architectural gap**: the active BOM engine (V4, `bom-engine-v4.ts`) has **zero system-type awareness**. It generates the same electrical/wiring BOM regardless of whether the project is a roof mount, ground mount, or solar fence. There is no fence-specific or ground-specific material generation.

### Key Findings

| Issue | Severity | System | Status |
|-------|----------|--------|--------|
| V4 engine has no `systemType` field | 🔴 Critical | All | Open |
| No fence mounting materials in BOM | 🔴 Critical | Fence | Open |
| No ground mount structural materials in BOM | 🔴 Critical | Ground | Open |
| No fence-specific equipment registry entries | 🔴 Critical | Fence | Open |
| Panel shows "TBD" — not resolving fence panel model | 🟡 Medium | Fence | Open |
| BOM Self-Check expects string inverter for micro system | 🟡 Medium | All | Open |
| "0 Inverters" shown for micro topology | 🟡 Medium | Fence | Open |
| Racking materials UI section fixed (roof-only) | ✅ Fixed | Fence/Ground | `414a90b` |
| API route `\|\|` operator overriding fence `0` values | ✅ Fixed | Fence | `e13f10a` |
| Frontend sending roof racking for fence | ✅ Fixed | Fence | `5b42543` |

---

## 2. PIPELINE ARCHITECTURE MAP

```
┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND (app/engineering/page.tsx)                              │
│                                                                  │
│  config.systemType ───► fetchBOM() builds payload               │
│  config.mountingId ───► rackingId (now gated by isRoofSystem)   │
│                                                                  │
│  ┌─ BOM API Path ──────────────────────────────────────────┐    │
│  │ POST /api/engineering/bom                                │    │
│  │ → route.ts parses body → BOMGenerationInputV4           │    │
│  │ → generateBOMV4(input)                                   │    │
│  │ → returns { stages, items }                              │    │
│  │ → rendered as BOM TABLE (categories + line items)        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─ Structural Path (SEPARATE) ────────────────────────────┐    │
│  │ compliance.structural.rackingBOM                         │    │
│  │ → structural-engine-v4.ts → calcRackingBOM()            │    │
│  │ → rendered as RACKING MATERIALS cards                    │    │
│  │ → NOW hidden for fence/ground (fix 414a90b)             │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─ Unified BOM Engine (NOT WIRED IN) ─────────────────────┐    │
│  │ lib/bom-unified.ts → buildBOM({ sd, cad })              │    │
│  │ → has fence/ground/roof awareness                        │    │
│  │ → derives structural from CAD geometry                   │    │
│  │ → NOT connected to engineering page                      │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. CURRENT V4 BOM OUTPUT — BY STAGE

### Stage 1: ARRAY
| Item | Source | Fence Issue |
|------|--------|-------------|
| Solar Panel | `panelId` from registry or "TBD" | 🟡 Shows "TBD" — fence panel not resolving |
| Microinverter | `inverterId` from registry | ✅ Correct (Enphase IQ8+) |
| Optimizer | Only if topology = optimizer | ✅ N/A for fence micro |

### Stage 2: DC
| Item | Source | Fence Issue |
|------|--------|-------------|
| Trunk Cable (Q Cable) | `ceil(deviceCount/16)` | ✅ Correct for micro |
| Terminators | `ceil(modules/16) × 2` | ✅ Correct for micro |
| DC Wire | Wire gauge × length × conductors × 1.15 | ⚠️ Wire runs may differ for fence layout |
| DC Conduit | Conduit type × length | ⚠️ Same concern |
| DC Disconnect | If `requiresDCDisconnect` | ✅ Topology-dependent |
| Rapid Shutdown | If `requiresRapidShutdown` | ⚠️ May not apply to fence micro |

### Stage 3: INVERTER
| Item | Source | Fence Issue |
|------|--------|-------------|
| String Inverter | Only for string topology | ✅ N/A for micro |
| Battery | If `batteryId` set | ✅ Optional |
| Gateway/Combiner | From inverter accessories | ✅ Correct |

### Stage 4: AC
| Item | Source | Fence Issue |
|------|--------|-------------|
| AC Wire | Wire runs from ComputedSystem | ⚠️ Wire run calculations assume roof layout |
| AC Conduit | From runs | ⚠️ Same concern |
| AC Disconnect | Standard | ✅ Correct |
| Backfeed Breaker | From interconnection method | ✅ Correct |
| Production Meter | If required | ✅ Correct |

### Stage 5: STRUCTURAL
| Item | Source | Fence Issue |
|------|--------|-------------|
| Racking System | Only if `rackingId` provided | ✅ Now `undefined` for fence |
| Racking Accessories | From registry required accessories | ✅ Skipped when no racking |
| Ground Wire | Always added | ✅ Correct |

### Stage 6: MONITORING
| Item | Source | Fence Issue |
|------|--------|-------------|
| CT/Revenue Meter | From inverter monitoring acc | ✅ Correct |

### Stage 7: LABELS
| Item | Source | Fence Issue |
|------|--------|-------------|
| DC Labels | Always | ✅ Correct |
| Warning Labels | Always | ✅ Correct |
| Rapid Shutdown Label | If required | ✅ Correct |
| Backfeed Label | Always | ✅ Correct |

---

## 4. CRITICAL GAPS — SOLAR FENCE

### 4.1 Missing Structural/Mounting Materials
The V4 engine generates **ZERO** fence-specific structural items:

| Missing Component | Per-Panel Basis | Notes |
|-------------------|----------------|-------|
| **Fence Posts** | Varies by segment length | Steel/aluminum posts, typically 8ft spacing |
| **Fence Rails** | 2-3 rails per segment | Horizontal structural members |
| **Panel Mounting Brackets** | 2-4 per panel | Clips/brackets to attach solar panels to rails |
| **Post Caps** | 1 per post | Weather protection |
| **Concrete/Footings** | 1 per post | Post foundations |
| **Post Sleeves** | 1 per post | If applicable |
| **Panel Spacers/Clips** | Per panel junction | Panel-to-panel connections |
| **Gate Hardware** | Per gate | Hinges, latches, if gates present |
| **Vinyl/Privacy Panels** | Per non-solar section | If mixed fence (solar + vinyl) |

### 4.2 Missing Electrical (Fence-Specific)
| Missing Component | Notes |
|-------------------|-------|
| **Panel-level wiring harness** | Fence panels may have different wiring paths than roof |
| **Fence-specific conduit runs** | Underground or along fence line |
| **Junction boxes (fence-mounted)** | Weatherproof boxes at fence intervals |
| **Grounding rod** | Fence-specific grounding per NEC |
| **Ground bus bar** | For fence rail grounding |

### 4.3 Incorrect Items for Fence
| Item Currently Shown | Issue |
|---------------------|-------|
| Panel = "TBD" | Should resolve to actual fence panel (e.g., Nexus 430BF or configured panel) |
| Wire lengths | Calculated from roof-style array geometry, not fence linear layout |

---

## 5. CRITICAL GAPS — GROUND MOUNT

### 5.1 Missing Structural Materials
| Missing Component | Notes |
|-------------------|-------|
| **Steel Posts/Piles** | Driven piles or helical piles |
| **Cross Beams** | Horizontal structural members |
| **Rails/Purlins** | Panel mounting rails |
| **Bracing** | Diagonal wind bracing |
| **Concrete Footings** | If ballasted or poured |
| **Panel Clamps** | Mid and end clamps for ground rack |
| **Ground Screws** | Alternative to piles |

### 5.2 Missing Electrical (Ground-Specific)
| Missing Component | Notes |
|-------------------|-------|
| **Trench conduit** | Underground runs from array to inverter |
| **Pull boxes** | At conduit junctions |
| **Equipment pad** | For inverter/combiner |
| **Grounding grid** | Ground mount grounding system |

---

## 6. ROOF MOUNT — CURRENT STATUS

Roof mount is the most complete system type:
- ✅ Racking system resolves from `mountingId` 
- ✅ All accessories (L-feet, rails, clamps, splices) from registry
- ✅ Structural materials from structural engine (separate path)
- ⚠️ Two separate rendering paths (BOM table vs racking materials cards) can show conflicting data

---

## 7. BOM SELF-CHECK ISSUES

From the screenshot:
1. **"String Inverter Count: 0 (expected 1)"** — This is a micro-inverter system. The self-check logic expects `inverterCount >= 1` but micro systems don't have string inverters. The check should be topology-aware.
2. **"0 Inverters"** metric card — Micro inverters are counted as `deviceCount` (83), not `inverterCount`. The summary card should show "83 Microinverters" instead of "0 Inverters".

---

## 8. DATA FLOW VERIFICATION

### Frontend → API → V4 Engine
```
Frontend sends:                    API receives:                V4 gets:
─────────────────                  ──────────────               ────────────
rackingId: undefined (fence) ──►   rackingId: undefined    ──► rackingEntry = undefined ✅
roofType: 'none' (fence)    ──►   roofType: 'none'        ──► no roof conditionals ✅  
attachmentCount: 0 (fence)  ──►   attachmentCount: 0      ──► 0 (fixed in e13f10a) ✅
railSections: 0 (fence)     ──►   railSections: 0         ──► 0 (fixed in e13f10a) ✅
panelId: (from config)      ──►   panelId: value          ──► panel lookup ⚠️ may be TBD
```

---

## 9. RECOMMENDATIONS

### Immediate (P0) — Required for accurate fence BOM
1. **Add `systemType` to `BOMGenerationInputV4` interface** — Pass it through from frontend
2. **Add fence structural stage to V4 engine** — When `systemType === 'fence'`, generate fence-specific items (posts, rails, brackets, etc.)
3. **Add ground mount structural stage** — When `systemType === 'ground'`, generate ground-specific items
4. **Fix panel resolution for fence** — Ensure `panelId` resolves to configured fence panel, not "TBD"
5. **Fix BOM Self-Check** — Make topology-aware (micro vs string)

### Short-term (P1) — Data accuracy
6. **Wire run calculations for fence** — Derive from fence linear geometry, not roof array
7. **Add fence panel specifications to equipment registry** — Brand/model/part numbers
8. **Per-panel material breakdown** — Calculate exact materials per panel for each system type

### Medium-term (P2) — Architecture
9. **Wire unified BOM engine into pipeline** — Either replace V4 structural stage or merge outputs
10. **Create fence mounting system entries** — Add to `mounting-hardware-db.ts`
11. **Unify BOM rendering** — Single source of truth instead of BOM table + racking cards

---

## 10. SPECIFICATION DATA REQUEST

To complete the per-panel material breakdown and wire the correct quantities into the BOM engine, I need the following specification data:

### Solar Fence — Per Panel:
- Post spacing (inches/feet)
- Number of rails per panel height
- Bracket type and quantity per panel
- Panel dimensions (width × height) for the fence panel model
- Fastener types and quantities per panel
- Conduit/wiring path specifications
- Foundation/footing specifications per post

### Ground Mount — Per Panel:
- Pile/post spacing
- Rail configuration (purlins per row)
- Clamp quantities per panel
- Bracing requirements
- Foundation specifications

### Roof Mount — Per Panel (for verification):
- Attachment spacing
- Rails per row
- Clamps per panel
- Flashing requirements

**Please provide these specifications so I can wire exact quantities into the BOM engine.**