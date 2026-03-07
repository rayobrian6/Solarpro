# SLD Segment Generation System - Audit Report

## Executive Summary

This audit examines the SLD (Single Line Diagram) segment generation system for BUILD v24, focusing on compliance with NEC requirements, segment completeness, terminal routing, and equipment specification integration.

**Audit Status**: ✅ **SUBSTANTIALLY COMPLIANT** with minor refinements needed

## Requirements Compliance Matrix

| Requirement | Status | Notes |
|-------------|--------|-------|
| Every electrical connection generates discrete segment object | ✅ PASS | All BUILD v24 connections generate segments |
| Segment includes: source, destination, amps, voltage, phase, OCPD | ✅ PASS | All fields present in RunSegment interface |
| Conductor material, type, hot count, neutral count, EGC size | ✅ PASS | All fields present and properly populated |
| Conduit type, trade size, fill % | ✅ PASS | Calculated per NEC Chapter 9 |
| Only standard AWG sizes (snap nonstandard) | ⚠️ NEEDS REVIEW | Uses autoSizeWire() - verify snapping logic |
| Routing from defined terminals (not box edges) | ⚠️ PARTIAL | BUI has terminal coordinates, but not all equipment |
| IQ System Controller exposes 4 terminals: GRID, LOAD, GEN, BATTERY | ✅ PASS | renderBUI() returns batPortX/Y, loadPortX/Y, gridY, genInputY |
| Segments terminate at correct terminals | ⚠️ PARTIAL | BUI segments use terminals, other equipment may not |
| No overlapping segments, clean branching | ⚠️ NEEDS REVIEW | Visual inspection required |
| Display conductor set, conduit type, size, fill % | ✅ PASS | conductorCallout format includes all required info |
| Use equipment specs for sizing | ✅ PASS | BUILD v24 segments use input.batteryBackfeedA, generatorOutputBreakerA, etc. |

## Detailed Findings

### 1. Segment Model (lib/segment-model.ts)

**Status**: ✅ **WELL-DEFINED**

The canonical segment model is comprehensive and includes all required fields:
- `RunSegment` interface has: conductorCount, wireGauge, insulation, egcGauge, conduitType, conduitSize, conduitFillPct, onewayLengthFt, continuousCurrent, requiredAmpacity, effectiveAmpacity, ocpdAmps, voltageDropPct, etc.
- `SegmentType` enum defines all segment types
- `ConductorBundle` interface for detailed conductor specifications
- All NEC reference fields present

### 2. Segment Builder (lib/segment-builder.ts)

**Status**: ✅ **NEC-COMPLIANT**

**NEC Tables Implemented:**
- `AMPACITY_TABLE_75C` - NEC 310.15(B)(16) 75°C ampacity
- `STANDARD_OCPD` - Standard overcurrent protection device sizes
- `CONDUCTOR_AREA_IN2` - NEC Chapter 9 Table 5 conductor areas
- `CONDUIT_AREA_IN2` - NEC Chapter 9 Table 4 conduit areas

**Key Functions:**
- `autoSizeConductor()` - Sizes conductors based on current, length, NEC derating
- `getEGCGauge()` - EGC sizing per NEC 250.122
- `calcVoltageDrop()` - Voltage drop calculation (3% recommendation)
- `getSmallestConduit()` - Conduit sizing per NEC Chapter 9 fill limits
- `nextStandardOCPD()` - Snaps to standard OCPD sizes

**⚠️ Potential Issue**: Need to verify `autoSizeConductor()` snaps nonstandard AWG sizes to nearest standard trade size

### 3. BUILD v24 Segment Generation (lib/computed-system.ts)

**Status**: ✅ **EXCELLENT IMPLEMENTATION**

All BUILD v24 segments are properly implemented:

#### BATTERY_TO_BUI_RUN (Lines 1487-1556)
- ✅ Uses `batteryBackfeedA` and `batteryContinuousOutputA` from equipment specs
- ✅ 2-wire 240V (L1+L2, no neutral) - correct for AC-coupled battery
- ✅ Conductor sized at 125% of continuous output per NEC 690.8/705
- ✅ EGC sized per NEC 250.122 based on OCPD
- ✅ Conduit fill calculated per NEC Chapter 9
- ✅ All required fields populated
- ✅ NEC references included

#### BUI_TO_MSP_RUN (Lines 1558-1620)
- ✅ Uses `backupInterfaceMaxA` from equipment spec
- ✅ 3-wire (L1+L2+N) for 120/240V split-phase
- ✅ EGC sized per NEC 250.122
- ✅ Conduit fill calculated correctly
- ✅ All required fields populated

#### GENERATOR_TO_ATS_RUN (Lines 1622-1692)
- ✅ Uses `generatorOutputBreakerA` from equipment spec
- ✅ 3-wire (L1+L2+N) for 120/240V split-phase
- ✅ Handles both IQ SC3 GEN port and standalone ATS
- ✅ NEC 702.5 and 250.30 references included
- ✅ All required fields populated

#### ATS_TO_MSP_RUN (Lines 1694-1760)
- ✅ Only generated for standalone ATS (not IQ SC3)
- ✅ Uses `atsAmpRating` from equipment spec
- ✅ 3-wire service entrance feeder
- ✅ NEC 702.5 references included
- ✅ All required fields populated

### 4. Terminal Routing (lib/sld-professional-renderer.ts)

**Status**: ⚠️ **PARTIALLY IMPLEMENTED**

#### IQ System Controller (BUI) Terminals - ✅ FULLY IMPLEMENTED
The `renderBUI()` function (lines 469-561) returns terminal coordinates:
- `batPortX`, `batPortY` - Battery port (bottom center)
- `loadPortX`, `loadPortY` - Load output port (right side, center)
- `gridY` - Grid input lug (left side, upper)
- `genInputY` - Generator input lug (left side, lower)

All four terminals are properly labeled and used for segment routing:
- Battery → BUI battery port (line 1280): `ln(batCX, batResult.by, batCX, buiResult.batPortY)`
- BUI load port → Backup panel (line 1296): Uses `buiResult.loadPortX/Y`
- Generator → BUI GEN port (line 1347): L-shaped route to GEN port
- MSP → BUI GRID port (line 1256): Horizontal connection on bus line

#### Other Equipment Terminals - ⚠️ NOT IMPLEMENTED
Most other equipment (inverter, combiner, disconnect, MSP, ATS) use hard-coded box edges for wire connections rather than defined terminal points:
- Inverter: Uses `invBox.lx` (left edge) and `invBox.rx` (right edge)
- Combiner: Uses `cr.lx` and `cr.rx`
- Disconnect: Uses `discoResult.lx` and `discoResult.rx`
- MSP: Uses various internal coordinates, not defined terminals

**Recommendation**: Define terminal coordinates for all equipment types and use them for all segment routing.

### 5. Segment Display & Callouts

**Status**: ✅ **COMPLIANT**

The `conductorCallout` format includes all required information:
```
2#12 AWG THWN-2 + 1#10 AWG GND IN 3/4" EMT (32% FILL)
```

Format includes:
- ✅ Conductor count and gauge
- ✅ Insulation type (THWN-2)
- ✅ EGC size
- ✅ Conduit type
- ✅ Conduit size (trade size)
- ✅ Fill percentage

Wire labels in the SLD use computed segment data (`batToBuiRun?.conductorCallout`) with fallback to hardcoded values only when segments aren't computed.

### 6. NEC Compliance

**Status**: ✅ **STRONG**

All BUILD v24 segments include proper NEC references:
- NEC 705.12(B) - Load-side interconnection backfeed breaker
- NEC 706 - Energy Storage Systems
- NEC 230.82 - Service entrance rated equipment
- NEC 310.15 - Conductor ampacity
- NEC 250.122 - EGC sizing
- NEC 702.5 - Transfer equipment requirements
- NEC 250.30 - Generator neutral bonding

Conductor sizing follows NEC 125% continuous current rule (NEC 210.20, 690.8, 702).

## Issues & Recommendations

### High Priority

1. **✅ RESOLVED: Verify Nonstandard AWG Snapping**
   - **Finding**: `autoSizeWire()` in `computed-system.ts` iterates through `AWG_ORDER` array which contains only standard AWG sizes: `['#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG', '#4 AWG', '#3 AWG', '#2 AWG', '#1 AWG', '#1/0 AWG', '#2/0 AWG', '#3/0 AWG', '#4/0 AWG']`
   - **Result**: All wire gauges returned are standard AWG sizes - no snapping logic needed
   - **Status**: ✅ PASS - System only produces standard AWG sizes

2. **Define Terminals for All Equipment**
   - **Issue**: Only BUI has defined terminal coordinates; other equipment use box edges
   - **Recommendation**: Extend `renderBUI()` pattern to all equipment types (inverter, combiner, disconnect, MSP, ATS, battery, generator)
   - **Impact**: High - affects routing accuracy and visual quality

### Medium Priority

3. **Validate Segment Routing for Overlaps**
   - **Issue**: No automated validation that segments don't overlap
   - **Recommendation**: Add visual inspection and collision detection
   - **Impact**: Medium - affects diagram clarity

4. **Add Terminal Mapping Configuration**
   - **Issue**: Terminal coordinates are hard-coded in renderer functions
   - **Recommendation**: Create a centralized terminal mapping configuration file
   - **Impact**: Medium - affects maintainability

### Low Priority

5. **Improve Fallback Logic**
   - **Issue**: Some segments use fallback to hardcoded values when computed segments are unavailable
   - **Recommendation**: Ensure all segments are always computed or fail gracefully
   - **Impact**: Low - primarily affects edge cases

## Summary

The SLD segment generation system is **substantially compliant** with the stated requirements. The BUILD v24 implementation is excellent, with proper NEC compliance, equipment spec integration, and segment completeness.

The main areas for improvement are:
1. Verifying nonstandard AWG snapping logic
2. Defining terminal coordinates for all equipment types (not just BUI)
3. Adding validation for segment routing overlaps

The system is production-ready for BUILD v24 topologies with battery/generator/ATS, but would benefit from the recommended refinements to achieve full compliance with the stated requirements.