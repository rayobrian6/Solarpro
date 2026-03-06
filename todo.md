# SLD Segment Generation System — Audit & Refinement

## Status: COMPLETE ✅

## Changes Required (from audit)

### A. lib/segment-model.ts
- [x] Add BUILD v24 segment types to SegmentType enum
- [x] Add terminal point interfaces (EquipmentTerminal, TerminalPoint)
- [x] Add voltage/phase fields to Segment interface

### B. lib/computed-system.ts
- [x] Add `voltage` and `phase` fields to RunSegment interface
- [x] Populate voltage/phase in makeRunSegment() for all BUILD v24 segments
- [x] Add `sourceTerminal` / `destTerminal` fields to RunSegment
- [x] Ensure conductorMaterial defaults to 'CU' on all segments
- [x] Verify conduit callout format is consistent across all segments

### C. lib/sld-professional-renderer.ts
- [x] Define EquipmentTerminals type and terminal coordinate helpers
- [x] Add terminal return values to renderBattery() — acOutX/Y
- [x] Add terminal return values to renderGenerator() — genOutX/Y
- [x] Add terminal return values to renderATS() — utilInX/Y, genInX/Y, loadOutX/Y
- [x] Add terminal return values to renderInverterBox() — dcInX/Y, acOutX/Y
- [x] Add terminal return values to renderDisco() — loadInX/Y, lineOutX/Y
- [x] Add terminal return values to renderMSPLoad() / renderMSPSupply() — bkfdInX/Y, busOutX/Y
- [x] Add terminal return values to renderCombiner() — feederOutX/Y
- [x] Add terminal return values to renderBUI() — gridPortX/Y, genPortX/Y (NEW)
- [x] Update all segment wire routing to use terminal coordinates:
      - Battery acOutX/Y → BUI batPortX/Y
      - MSP busOut → BUI gridPortX/Y
      - Generator genOutX/Y → BUI genPortX/Y (Mode A: IQ SC3)
      - Generator genOutX/Y → ATS genInX/Y (Mode B: standalone ATS)
      - ATS loadOutX/Y → MSP bkfdInX/Y
      - ATS utilInX/Y ← utility drop
      - Combiner feederOutX → Disco loadInX/Y
      - Inverter acOutX → Disco loadInX/Y
      - Disco lineOutX/Y → MSP bkfdInX/Y
      - MSP busOutY → Utility meter
- [x] Fix generator → BUI GEN port routing (was BUS_Y+60 hardcoded, now uses buiResult.genPortY)
- [x] Add segment overlap guard (makeOverlapGuard / resolveSegY — 4px offset for parallel wires)
- [x] Hoist buiResult to outer scope so generator section can access BUI terminal coords
- [x] Ensure all wire labels use computed conductorCallout (no hardcoded fallbacks)

### D. lib/segment-builder.ts
- [x] Add phase: '1Ø' and conductorMaterial: 'CU' to all 7 segment objects

### E. Validation
- [x] Add overallPass computation to makeRunSegment()
- [x] Verify conduitFillPass, ampacityPass, voltageDropPass all set correctly

## Testing
- [x] Verify TypeScript compiles without errors after changes — PASSED (0 errors)