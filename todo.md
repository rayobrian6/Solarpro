# Engineering Automation System — Full Implementation

## Phase 0: Auto Fill Fix (v34.4 — COMPLETED)
- [x] Pass fireSetbacks prop from DesignStudio to SolarEngine3D
- [x] PRIMARY PATH: Fix 0-panel regression (filter against original boundary, not shrunk polygon)
- [x] Build, commit, push — v34.4 live on Vercel

## Phase 1: Audit Existing Data Pipeline
- [ ] 1. Map how Client/Project/Design/Proposal modules communicate
- [ ] 2. Identify where panel_count, system_kw, panel_model, inverter_model, roof_segments, tilt, azimuth, mount_type, utility, ahj are stored
- [ ] 3. Identify design engine data flow (SolarEngine3D → onPanelsChange → store)
- [ ] 4. Document findings in ENGINEERING_AUDIT.md

## Phase 2: Engineering Module Architecture
- [ ] 5. Create /lib/engineering/ core module
- [ ] 6. Implement generateEngineeringReport()
- [ ] 7. Implement generateSingleLineDiagram() integration
- [ ] 8. Implement generateEquipmentSchedule()
- [ ] 9. Implement generateStructuralSummary()
- [ ] 10. Implement generatePanelLayout()
- [ ] 11. Implement generatePermitPackage()

## Phase 3: Database Schema
- [ ] 12. Create engineering_reports table migration
- [ ] 13. Create design_versions table for change tracking
- [ ] 14. Add design_id foreign key to engineering_reports

## Phase 4: API Routes
- [ ] 15. POST /api/engineering/generate — trigger generation
- [ ] 16. GET /api/engineering/[projectId] — fetch latest report
- [ ] 17. GET /api/engineering/[projectId]/download — download packet
- [ ] 18. POST /api/engineering/regenerate — force regeneration

## Phase 5: Event Triggers
- [ ] 19. Wire design_updated event → engineering regeneration
- [ ] 20. Wire panel_layout_changed → engineering regeneration
- [ ] 21. Wire proposal_generated → engineering regeneration

## Phase 6: Engineering UI Tab
- [ ] 22. Add Engineering tab to project dashboard
- [ ] 23. Engineering report viewer (summary, SLD, equipment schedule, structural)
- [ ] 24. Download engineering packet button
- [ ] 25. Auto-regeneration indicator (shows when design changed)

## Phase 7: Build & Deploy
- [ ] 26. Build, test, commit, push
- [ ] 27. Verify on live site