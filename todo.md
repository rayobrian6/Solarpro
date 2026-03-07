# Structural Calculation Engine Redesign

## Problem Analysis
The current structural engine produces **unrealistic failures** for standard residential roof systems (e.g., 2×6 trusses at 24" OC failing loads that should pass). The engine uses:
- Fixed mount spacing (user input) instead of calculated spacing
- Panel weight assumptions instead of mounting system data
- No rail span calculations
- No racking component generation
- Missing RT-Mini discrete load model integration

## Root Causes Identified

### 1. Rafter Analysis Issues
- **Conservative Fb values**: Using NDS Table 4A values correctly, but load combinations may be too aggressive
- **Missing truss vs rafter distinction**: Trusses have higher capacity than individual rafters
- **No sheathing contribution**: OSB/plywood sheathing adds diaphragm strength (ignored)

### 2. Mount Spacing Issues
- **User-specified spacing is checked, not calculated**: Should derive from wind/snow loads
- **No mount count optimization**: Should minimize mounts while meeting safety factor
- **Missing cantilever limits**: Rail cantilevers affect mount placement

### 3. Missing Mounting System Integration
- **RT-Mini exists in equipment-db** but structural calc doesn't use it properly
- **No rail system**: Missing rail span, L-feet, splices, clamps
- **No mount layout**: Cannot visualize where mounts go

### 4. Missing ASCE 7 Roof Zones
- Corner zone (higher loads) - not implemented
- Edge zone (higher loads) - not implemented
- Interior zone (standard loads) - only zone considered

---

## Implementation Plan

### Phase 1: Core Structural Model Refactor
- [x] Create `lib/structural-engine-v2.ts` — new structural calculation engine
- [x] Add proper truss vs rafter distinction with different capacities
- [x] Add sheathing type contribution (OSB 7/16", plywood 1/2", etc.) — interface ready
- [x] Implement ASCE 7-22 roof zones (corner, edge, interior) — constants defined

### Phase 2: RT-Mini Mounting System Integration
- [x] Create `lib/mounting-systems/rt-mini.ts` — Roof Tech RT-Mini specs
- [x] Implement ICC-ES ESR-3575 pull-out/shear/uplift capacities
- [x] Create mount spacing tables based on wind speed, snow load, roof pitch
- [x] Calculate optimal mount count and layout

### Phase 3: Rail System Integration
- [x] Create `lib/railing-system.ts` — rail span and cantilever calculations
- [x] Calculate rail length per row based on panel count and orientation
- [x] Calculate cantilever limits (typically L/6 or 12" max)
- [x] Determine optimal rail span between mounts

### Phase 4: Racking BOM Generation
- [x] Add rails to BOM (calculate total linear feet)
- [x] Add L-feet to BOM (one per rail-mount intersection)
- [x] Add roof mounts to BOM (RT-Mini count from structural calc)
- [x] Add rail splices to BOM (every 20' of rail run)
- [x] Add mid clamps to BOM (between each panel pair)
- [x] Add end clamps to BOM (2 per row)
- [x] Add grounding hardware to BOM

### Phase 5: Mount Layout Generation
- [x] Generate mount positions (X, Y coordinates relative to array)
- [x] Calculate tributary area per mount
- [x] Calculate uplift force per mount
- [x] Calculate shear force per mount
- [x] Calculate downward load per mount

### Phase 6: Realistic Validation Rules
- [x] 2x6 trusses at 24" OC, 14' span -> PASS for typical PV (3-4 psf)
- [x] 2x8 rafters at 16" OC, 16' span -> PASS for typical PV
- [x] Only FAIL when wind > 140 mph OR snow > 60 psf OR unusual conditions
- [x] Generate actionable recommendations when FAIL

### Phase 7: UI Integration
- [x] Add framingType to defaultProject config
- [x] Update structural API call in runCalc to call V2 in parallel and merge results
- [x] Add framing type selector to Structural tab UI
- [x] Update Structural tab to display V2 results (framing analysis, mount layout, racking BOM)
- [x] Add racking section to BOM tab
- [x] V2 structural results now auto-populate on every runCalc (not just handleAutoFixAll)
- [ ] Add mount visualization to design viewer (future — deferred)
- [ ] Show rail spans and cantilevers (future — deferred)

---

## Technical Specifications

### RT-Mini Structural Data (ICC-ES ESR-3575)
```
Pull-out capacity: 450 lbs per 5/16" lag bolt (Douglas Fir)
Shear capacity: 350 lbs per lag bolt
Uplift capacity: 450 lbs per lag bolt (with 2.5" embedment)
Fasteners per mount: 2 lag bolts
Max mount spacing: 48" (rail-less) / 72" (with rail)
```

### Rail System Defaults
```
Rail span between mounts: 48-72" (depends on wind/snow)
Max cantilever: min(L/6, 12")
Rail length per panel: panel width + 0.5" (portrait) or panel length + 0.5" (landscape)
Splice every: 20 feet of rail run
```

### Truss Capacity (BCSI / TPI)
```
2x4 truss at 24" OC: 40 psf live load @ 14' span
2x6 truss at 24" OC: 55 psf live load @ 14' span
2x8 truss at 24" OC: 80 psf live load @ 14' span
```

### ASCE 7-22 Roof Zone Factors
```
Interior zone: GCp = -1.5 (uplift), +0.5 (downward)
Edge zone: GCp = -2.0 (uplift), +0.8 (downward)
Corner zone: GCp = -2.5 (uplift), +1.2 (downward)
Zone widths: 0.6h (edge), 0.4h (corner)
```

---

## Success Criteria
1. Standard 2×6 truss roof with 8kW system → PASS (not FAIL)
2. Mount spacing calculated (not user-specified)
3. Racking BOM auto-generated with correct quantities
4. Mount layout visualizable with X,Y positions
5. Roof zones considered in load calculations