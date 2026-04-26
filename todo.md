# SolarPro UI + Engineering Audit

## Phase 1: UI — Eliminate dead space in System Config tab [center col]
- [x] Compact Battery disabled state → single slim inline row (no padded box icon)
- [x] Compact Generator disabled state → single slim inline row (already close but tighten)

## Phase 2: Engineering Logic Audit
- [x] Audit systemType options — FIXED: dropdown was using wrong values (residential/commercial/ground_mount/carport) → changed to correct engine values (roof/ground/fence)
- [x] Audit utilityMeter options — FIXED: default was 'Bidirectional Net Meter' but not in dropdown options → added to dropdown
- [x] Audit batteryEnabled BOM payload — FIXED: batteryEnabled flag was ignoring the UI toggle → now respects toggle state
- [x] Check DC/AC ratio display and threshold logic — OK (1.0-1.6 range, green 1.15-1.35)
- [x] Check string count / MPPT validation warnings in UI — OK (sizingEngine.warnings → validationEngine → UI)
- [x] Check interconnection method auto-suggest logic — OK (busbar 120% rule detection works)
- [x] Check battery/generator BOM integration consistency — OK (BOM self-check warnings displayed)

## Phase 3: Deploy
- [ ] Bump version to v59.0
- [ ] Git commit and push
- [ ] Verify deploy live