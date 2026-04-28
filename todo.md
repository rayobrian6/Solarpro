# SLD Topology Template Selection Fix — 7 Phases

## Phase 1 — Trace Topology Source
- [ ] Read Project Config → toSystemState() → route.ts full chain
- [ ] Audit how topologyType is derived in route.ts
- [ ] Audit isMicro / isOptimizer logic in renderer
- [ ] Find where SolarEdge becomes micro / AC-combiner
- [ ] Add [SLD TOPOLOGY TRACE] logs at every stage

## Phase 2 — Define Explicit SLD Topology Enum
- [ ] Create/enforce SLDTopology: microinverter | string_inverter | optimizer_string | ...
- [ ] Define canonical priority: LayoutCandidate > inverter capability > brand profile > fallback
- [ ] Update SLDProfessionalInput to carry canonical sldTopology field

## Phase 3 — Block Wrong Fallback
- [ ] Guard: optimizer_string NEVER renders AC combiner
- [ ] Guard: optimizer_string NEVER renders micro labels
- [ ] Guard: log [SLD TOPOLOGY CONTAMINATION] if micro components in optimizer path
- [ ] Remove stale APsystems/Enphase references from SolarEdge path

## Phase 4 — Optimizer String Template
- [ ] Implement/repair optimizer_string render path
- [ ] Correct node sequence: PV→Optimizer→JBOX→StringInverter→ACDisco→MSP→Meter
- [ ] Correct labels: optimizer callout, SE inverter, raceway JBOX→INV

## Phase 5 — Microinverter Template Isolation
- [ ] Ensure micro path ONLY triggers when topology === 'microinverter'
- [ ] Ensure AC combiner ONLY appears in micro path
- [ ] Audit isMicro guard in renderer

## Phase 6 — Remove Stale Component Contamination
- [ ] Audit why APsystems DS3-S appears in SolarEdge project
- [ ] Find stale source: config.inverters, ecosystemComponents, localStorage, toSystemState
- [ ] Clear incompatible old topology when selectedBrand changes

## Phase 7 — Regression Tests + TSC + Commit
- [ ] Test: SolarEdge SE11400H optimizer_string → no AC combiner, no micro labels
- [ ] Test: APsystems microinverter → AC combiner, no string inverter
- [ ] npx tsc --noEmit → 0 errors
- [ ] git commit + push