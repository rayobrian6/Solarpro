# Generator/Battery Data Flow Fix

## Problem Summary
When generators or batteries are added on the SLD:
1. ✅ ComputedSystem engine gets the data (BATTERY_TO_BUI_RUN, GENERATOR_TO_ATS_RUN segments computed)
2. ❌ NEC Calculations (electrical-calc.ts) - NO battery/generator awareness
3. ❌ Electrical BoM - missing generatorId, atsId, backupInterfaceId in BOM call
4. ❌ Equipment Schedule (computed-system.ts) - missing generator, ATS, backup interface entries
5. ❌ NEC Calc Steps display - doesn't show battery/generator NEC sections

## Tasks

### 1. Fix Equipment Schedule in computed-system.ts
- [ ] Add generator to equipment schedule (GENERATOR tag)
- [ ] Add ATS to equipment schedule (ATS tag)  
- [ ] Add backup interface/BUI to equipment schedule (BUI tag)
- [ ] Add battery count support (multiple batteries)

### 2. Fix BOM call in engineering/page.tsx
- [ ] Pass generatorId, atsId, backupInterfaceId to BOM API
- [ ] Pass batteryCount to BOM engine

### 3. Fix BOM engine (bom-engine-v4.ts)
- [ ] Add generatorId, atsId, backupInterfaceId to BOMGenerationInputV4 interface
- [ ] Add generator, ATS, backup interface line items to BOM output

### 4. Fix NEC Calculations (electrical-calc.ts + calculate/route.ts)
- [ ] Add battery/generator NEC sections to ElectricalCalcInput
- [ ] Add battery NEC 705.12(B) bus impact to busbar calculation
- [ ] Add generator NEC 702 transfer equipment note
- [ ] Pass battery/generator data from calculate/route.ts

### 5. Fix NEC Calc Steps display in engineering/page.tsx
- [ ] Show battery NEC 705.12(B) section when battery present
- [ ] Show generator NEC 702 section when generator present
- [ ] Show ATS/BUI section when present

### 6. Test and verify
- [ ] Build and verify no TypeScript errors
- [ ] Verify data flows correctly end-to-end