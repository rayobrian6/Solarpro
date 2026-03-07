# Full Architectural Audit & Redesign — Solar Mounting + Structural Platform

## SECTION 1: Fix Project Status Failure Logic
- [ ] Audit calculate route — old structural-calc.ts causes FAIL with default attachmentSpacing=48
- [ ] Fix calculate route to use V3 engine (not old structural-calc.ts)
- [ ] Fix overallStatus aggregation: use V3 structural result + electrical result
- [ ] Add debug inspector panel to compliance tab (rule source, result, auto-fix, final status)
- [ ] Ensure auto-fixes clear error flags before final status computation

## SECTION 2-3: Global Hardware Database (lib/mounting-hardware-db.ts)
- [ ] Build comprehensive database: 16 manufacturers, all system types
- [ ] Roof systems: rail+L-foot, tile hook, rail-less, standing seam, corrugated, flat roof
- [ ] Commercial: ballasted, mechanically attached, tilt-leg, large-span
- [ ] Ground mount: single/dual-post, driven pile, helical pile, concrete pier
- [ ] Tracker: single-axis, dual-axis
- [ ] Solar fence systems
- [ ] Each system: max span, cantilever, uplift capacity, fastener pull-out, shear, ballast tables
- [ ] Source references for every engineering value

## SECTION 4-6: Structural Engine V4 (lib/structural-engine-v4.ts)
- [ ] Extend V3 with commercial ballasted flat roof support
- [ ] Add ground mount pile spacing + foundation load calculations
- [ ] Add tracker geometry (row spacing, rotation clearance)
- [ ] Improve load path: modules→rails→mounts→fasteners→rafters/structure
- [ ] Auto-resolve: reduce spacing, add mounts, increase rail count, recommend upgrade

## SECTION 7: Commercial System Support
- [ ] Ballasted flat roof: ballast block count, weight distribution, tilt frame spacing
- [ ] Ground mount: pile spacing, foundation loads, frame spans
- [ ] Tracker: actuator geometry, row spacing, rotation clearance

## SECTION 8: BOM Integration
- [ ] All racking quantities from geometry (never static)
- [ ] Commercial: ballast blocks, foundations
- [ ] Ground mount: piles, frames, hardware

## SECTION 9: Mounting Details UI Redesign (app/engineering/page.tsx)
- [ ] Residential/Commercial/Ground toggle
- [ ] Mounting system selector with manufacturer specs panel
- [ ] Real-time mount spacing diagram (SVG)
- [ ] Rail layout visualization
- [ ] Ballast block layout visualization (commercial)
- [ ] Mount load visualization
- [ ] BOM preview panel
- [ ] All elements update in real time

## SECTION 10: Validation Test Cases
- [ ] Test 1: 10 panels, asphalt shingles, 2x6 @ 24" OC, 115mph, 20psf → PASS
- [ ] Test 2: 200 panels, ballasted flat roof, Exposure B → ballast weight + layout
- [ ] Test 3: 50 panels, dual-post ground mount → pile spacing + foundation loads

## Phase Final: Build + Push
- [ ] Run npm run build — must compile clean
- [ ] Commit and push as v25.1