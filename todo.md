# Engineering Automation System — Full Implementation

## Phase 0: Auto Fill Fix (v34.4 — COMPLETED)
- [x] Pass fireSetbacks prop from DesignStudio to SolarEngine3D
- [x] PRIMARY PATH: Fix 0-panel regression (filter against original boundary, not shrunk polygon)
- [x] Build, commit, push — v34.4 live on Vercel

## Phase 1: Audit Existing Data Pipeline
- [x] Map how Client/Project/Design/Proposal modules communicate
- [x] Identify where panel_count, system_kw, panel_model, inverter_model, roof_segments, tilt, azimuth, mount_type, utility, ahj are stored
- [x] Identify design engine data flow (SolarEngine3D → onPanelsChange → store)
- [x] Document findings in ENGINEERING_AUDIT.md

## Phase 2: Engineering Module Architecture
- [x] Create /lib/engineering/ core module (types, designSnapshot, reportGenerator, db-engineering, index)
- [x] Implement generateEngineeringReport()
- [x] Implement generateEquipmentSchedule()
- [x] Implement generateStructuralSummary()
- [x] Implement generatePermitPackage()
- [x] Implement generateSingleLineDiagram() (integrated into report)
- [x] Implement generatePanelLayout() (integrated into report)

## Phase 3: Database Schema
- [x] Create engineering_reports table (ensureEngineeringTable — idempotent)
- [x] Design version ID via SHA-256 hash of layout for change detection
- [x] upsertEngineeringReport / getEngineeringReport / isEngineeringReportStale

## Phase 4: API Routes
- [x] POST /api/engineering/generate — trigger generation
- [x] GET /api/engineering/report?projectId=xxx — fetch latest report (auto-generates if stale)

## Phase 5: Event Triggers
- [x] Wire layout save → async engineering auto-generation (non-blocking, in /api/projects/[id]/layout)
- [x] Stale detection: only regenerates when design version ID changes

## Phase 6: Engineering UI Tab
- [x] Add Engineering tab to project dashboard (/projects/[id])
- [x] EngineeringTab component: System Summary, Electrical, Structural, Equipment Schedule, Permit Package
- [x] Regenerate button, stale indicator, download button
- [x] Installer workflow footer

## Phase 7: Build & Deploy
- [x] Fix JSX structure in project detail page
- [x] Fix unused import (DEFAULT_SOLAR_PANELS) in designSnapshot.ts
- [x] Build passes cleanly (npm run build ✓)
- [x] Commit v35.1 and push to GitHub → Vercel deployment triggered
- [x] Verify Engineering tab live on Vercel — BUILD v35.1 confirmed ✓