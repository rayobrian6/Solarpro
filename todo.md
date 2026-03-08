# SolarPro v31.0 — Design Studio Interaction Audit & Repair

## Phase 1: Diagnostic Audit (READ ONLY — no code changes)
- [ ] 1.1 Audit active tool state management in DesignStudio.tsx
- [ ] 1.2 Audit panel placement logic (what triggers placement)
- [ ] 1.3 Audit object selection system (handleCanvasClick select branch)
- [ ] 1.4 Audit event handling — mouse click flow end-to-end
- [ ] 1.5 Audit roof selection vs roof creation logic
- [ ] 1.6 Audit panel deletion functionality
- [ ] 1.7 Write DIAGNOSTIC_REPORT.md with all findings

## Phase 2: Tool State Fix
- [ ] 2.1 Implement clear single-active-tool state (no dual-mode conflicts)
- [ ] 2.2 Ensure Select tool deactivates all placement tools
- [ ] 2.3 Ensure placement tools auto-deactivate on switch to Select

## Phase 3: Object Selection Priority
- [ ] 3.1 Fix panel click detection to take priority over terrain/roof meshes
- [ ] 3.2 Ensure panels show selection outlines when selected

## Phase 4: Panel Deletion
- [ ] 4.1 Ensure Delete/Backspace keys delete selected panels
- [ ] 4.2 Ensure deletion updates panel counts + system size
- [ ] 4.3 Verify proposal pipeline not broken by deletion

## Phase 5: Roof Tool Clarification
- [ ] 5.1 Separate Roof Geometry Tool (create polygon) from Roof Select (select segment)
- [ ] 5.2 Clicking roof in Select mode selects roof, not places panel

## Phase 6: Panel Placement Safety Check
- [ ] 6.1 Panels only placed when placement tool is active (never in Select mode)

## Phase 7: UI Feedback
- [ ] 7.1 Add visible active tool indicator to canvas overlay

## Phase 8: Build + Validate
- [ ] 8.1 TypeScript compile — zero errors
- [ ] 8.2 Full build — clean
- [ ] 8.3 Bump version, ZIP, git push