# Engineering Seed Propagation — Implementation Plan

## Phase 1: Database & Types
- [x] Add `engineering_seed` JSONB column to projects table (Migration 009 in migrate/route.ts)
- [x] Add `EngineeringSeed` interface to types/index.ts
- [x] Add `engineering_seed` to Project interface in types/index.ts
- [x] Update `rowToProject()` in db-neon.ts to include engineering_seed
- [x] Update `getProjectWithDetails()` to return engineering_seed

## Phase 2: Preliminary Endpoint (Seed Generator)
- [x] Create `/api/engineering/preliminary/route.ts`
  - Parse bill data (annualKwh, monthlyKwh, rate, utility, state)
  - Calculate system sizing (systemKw, panelCount, panelWatt, productionFactor)
  - Build engineeringSeed object
  - Save seed to project via SQL UPDATE
  - Call upsertLayout() with synthetic layout
  - Call upsertProduction() with synthetic production
  - Return seed + savedFiles summary

## Phase 3: Engineering Page Auto-Population
- [x] Add `useSearchParams` to engineering/page.tsx
- [x] Add `seedLoaded` state + auto-load effect
- [x] When ?projectId= in URL and project has engineering_seed, auto-populate config:
  - systemType, state, address, projectName
  - inverter type (micro/string/optimizer)
  - panel model (by wattage match)
  - panel count per string
  - utility, state code

## Phase 4: Proposals Page Seed Fallback
- [x] Read engineering_seed from project as tertiary fallback
- [x] System size: seed.system_kw if no layout
- [x] Panel count: seed.panel_count if no layout
- [x] Annual production: seed.annual_production_kwh if no production record
- [x] Price range: seed.cost_low / seed.cost_high

## Phase 5: Version Bump & Deploy
- [x] Bump version to v24.7
- [x] Verify TypeScript compiles cleanly (0 errors)
- [x] Git commit and push (5f3f4bc -> master)

## Phase 6: Bill Upload Modal Wiring
- [x] Wire preliminary call into projects/new/page.tsx (auto-runs after project creation)
- [x] Create /api/engineering/parse-bill endpoint (PDF text extraction via pdftotext)
- [x] Add bill upload UI to clients/new/page.tsx Step 2 (auto-fills form fields)
- [x] TypeScript clean (0 errors)
- [x] Git commit and push (49a0fe5 -> master)