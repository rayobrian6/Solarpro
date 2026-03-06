# Engineering Pipeline Overhaul — BUILD v16

## Phase 1: Analysis
- [x] Audit current topology-engine.ts — understand existing segment model
- [x] Audit computed-system.ts — understand current calculation flow
- [x] Audit sld-professional-renderer.ts — identify interconnection rendering issues
- [ ] Audit bom-engine-v4.ts — identify BOM drift from segments
- [x] Document all segment types needed

**FINDINGS:**
- Interconnection type is detected but NOT used to change SLD rendering (backfed breaker always shown)
- No 120% rule enforcement for backfed breaker selection
- topology-engine.ts has PRODUCTION_METER in graph (wrong per user's industry standard)
- segment-schedule.ts has correct conductor bundle logic but is not the single source of truth
- SLD renderer has its own interconnection labels but doesn't render tap graphics

## Phase 2: Segment Model Design
- [x] Define canonical SegmentType enum with all required types
- [x] Define Segment interface with all required fields
- [x] Create segment-builder.ts as single source of truth
- [x] Implement branch vs feeder current calculation logic
- [x] Implement interconnection-specific segment generation
- [x] Run validation tests and fix rooftop temp adder

**COMPLETED:**
- Created lib/segment-model.ts with SegmentType enum, Segment interface
- Created lib/segment-builder.ts with buildSegments() function
- Implemented NEC 705.12(B) 120% rule validation
- Implemented LOAD_SIDE_TAP_SEGMENT, BACKFED_BREAKER_SEGMENT, SUPPLY_SIDE_TAP_SEGMENT
- Created lib/sld-segment-renderer.ts that renders from segments only
- Created scripts/test-segment-builder.ts with comprehensive validation
- All 31 tests passing ✓

## Phase 3: Interconnection Fix
- [x] Add NEC 705.12 120% rule validation
- [x] Implement load-side tap segment generation
- [x] Implement backfed breaker segment generation with validation
- [x] Implement supply-side tap segment generation
- [x] Update existing SLD renderer to respect interconnection type (quick fix)

## Phase 4: Microinverter Topology Fix
- [x] Fix device order: Modules+Micros → J-Box → AC Combiner → AC Disco → Interconnect
- [x] Remove erroneous second microinverter block
- [x] Size branch circuits by branch current (not feeder current)
- [x] Size feeder after combiner by total AC output

## Phase 5: Conductor/Conduit Logic
- [x] Implement per-segment conductor bundle calculation
- [x] Branch segments: size by branch current
- [x] Feeder segments: size by total AC output current
- [x] Implement conduit fill calculation per segment
- [x] Generate inline segment labels

## Phase 6: SLD Renderer Overhaul
- [x] Render from segment data only (no independent calculations) - created lib/sld-segment-renderer.ts
- [x] Place labels inline on segments - implemented in sld-segment-renderer.ts
- [x] Respect interconnection type in rendering - implemented with proper segment types
- [x] Show correct equipment topology - correct order maintained
- [x] Fix backfed breaker display in existing renderer (quick fix) - applied to sld-professional-renderer.ts
- [ ] Integrate segment builder with computed-system.ts (requires adding interconnectionType to input)
- [ ] Update sld-professional-renderer.ts to use segments (full migration)

## Phase 6b: computed-system.ts Integration
- [x] Add interconnectionType to ComputedSystemInput
- [x] Call buildSegments() inside computeSystem()
- [x] Add segments[] to ComputedSystem output
- [x] Map segment builder output to existing RunSegment[] for backward compat

## Phase 7: BOM Integration
- [x] Audit bom-engine-v4.ts for drift
- [x] Add interconnectionMethod to BOM engine input
- [x] Only include backfed breaker in BOM when interconnection is backfed
- [x] NEC 705.12(B) 120% rule enforced in BOM breaker sizing
- [x] Pass interconnectionMethod from engineering page to BOM API

## Phase 8: SLD Interconnection Fix
- [x] Pass interconnection method from engineering page to SLD API
- [x] Map LOAD_SIDE/SUPPLY_SIDE_TAP/etc to renderer-friendly strings
- [x] Fix PDF route to also map interconnection method
- [x] SLD renderer correctly shows load-side tap vs backfed breaker

## Phase 9: Final Validation & Deploy
- [x] Run mandatory test case (34 modules, IQ8, 3 branches, load-side tap)
- [x] Verify no backfed breaker shown
- [x] Verify load-side tap rendered
- [x] Verify correct conductor sizing
- [x] Build passes (npm run build) — no TypeScript errors
- [ ] Deploy to Vercel
- [ ] Create zip archive