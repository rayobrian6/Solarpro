# ECOFLOW + SOLFENCE INTEGRATION — TODO

## Phase 1 — Topology Extension
- [ ] Extend `InverterType` / `InverterTopology` to include `'ecoflow'`
- [ ] Extend BOM engine topology type
- [ ] Extend equipment registry topology

## Phase 2 — Default Behavior (SolFence)
- [ ] When systemType=fence AND no user inverter → default to ecoflow
- [ ] Preserve non-destructive rule (user selection wins)

## Phase 3 — EcoFlow System Profile
- [ ] Add EcoFlowSystem entry to systemEquipmentResolver
- [ ] Register 5kW / 10kW / 20kW hybrid inverters in equipment-db + registry-v4
- [ ] Register 5kWh battery module
- [ ] Register base/stack hardware, combiner, smart meter

## Phase 4 — Inverter Auto-Sizing
- [ ] `sizeEcoFlowInverter(totalDcKw)` → 5 / 10 / 20 kW

## Phase 5 — String Logic
- [ ] MPPT distribution for EcoFlow
- [ ] `panelsPerMPPT = ceil(moduleCount / mpptCount)`

## Phase 6 — Battery Auto-Sizing
- [ ] `sizeEcoFlowBattery(targetKwh)` → modules=ceil(target/5)
- [ ] Default target: 10kWh
- [ ] Max stack: 45kWh std, 80kWh pro

## Phase 7 — BOM Integration
- [ ] Inject EcoFlow components when topology=ecoflow
- [ ] Hybrid inverter, battery modules, base/stack, combiner, smart meter
- [ ] AC/DC disconnects, wiring, conduit, grounding

## Phase 8 — Remove Micro Components
- [ ] When topology=ecoflow: strip microinverter, trunk cable, Q-term from BOM

## Phase 9 — SolFence + EcoFlow Link
- [ ] Wire default behavior end-to-end
- [ ] Structural BOM (SolFence) + electrical BOM (EcoFlow) coexist

## Phase 10 — UI Exposure
- [ ] Expose EcoFlow as selectable inverter type
- [ ] Expose battery size input
- [ ] Auto-sizing toggle

## Phase 11 — Validation Layer
- [ ] Warn if micro + ecoflow both present
- [ ] Verify inverter sized from systemDefinition
- [ ] Verify battery count is derived

## Phase 12 — Tests
- [ ] Golden test: fence → defaults to EcoFlow
- [ ] Golden test: EcoFlow sizes correctly
- [ ] Golden test: battery sizes correctly
- [ ] Golden test: no micro items in EcoFlow BOM
- [ ] Golden test: user override preserved