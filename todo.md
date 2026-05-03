# SolarPro v61.7 — String Pipeline Unification

## Objective
Destroy all non-authoritative string sources.
config.inverters[].strings is the ONLY truth.

## Phase 1 — Audit ALL string sources
- [ ] Search for stringLayout, systemStrings, derivedStrings, aggregateStrings, panelGroups
- [ ] Search for computeSystem string generation logic
- [ ] Search for UI string grid rendering code
- [ ] Search for electrical validation string source
- [ ] Map: File | Function | Used by | Source of truth? | Must delete?

## Phase 2 — Delete aggregated string logic
- [ ] Remove any code combining inverters into fake system strings
- [ ] Remove totalPanels / stringCount derived layouts
- [ ] Remove visual string layout generators separate from config.inverters

## Phase 3 — Fix UI String Grid
- [ ] Render directly from config.inverters per inverter
- [ ] Group strings by inverter (never merge/average)

## Phase 4 — Fix computeSystem()
- [ ] Pass flatten(config.inverters[].strings) only
- [ ] Remove internal string recomputation

## Phase 5 — Fix electrical validation
- [ ] Per-inverter, per-string Voc/Vmp/MPPT checks
- [ ] Never run system-wide string averages

## Phase 6 — Fix SLD / BOM / Permit
- [ ] All downstream systems consume config.inverters[]

## Phase 7 — Tests
- [ ] Multi-inverter system: correct per-inverter layout
- [ ] UI grid matches config exactly
- [ ] computeSystem uses only inverter strings
- [ ] No derived string layouts

## Final
- [ ] npx tsc --noEmit = 0
- [ ] All tests pass
- [ ] git commit + push