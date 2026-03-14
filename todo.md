# SolarPro — Layout Pipeline Debug

## Phase 1 — Instrument the Save Path
- [ ] Add logging to saveLayoutToDB in DesignStudio.tsx
- [ ] Add logging to POST /api/projects/[id]/layout route handler
- [ ] Verify upsertLayout in lib/db-neon.ts writes roof_planes

## Phase 2 — Instrument the Retrieve Path  
- [ ] Add logging to GET /api/projects/[id]/layout route handler
- [ ] Add logging to engineering page.tsx layout load
- [ ] Verify projectLayout state is populated before permit button

## Phase 3 — Instrument the Permit Generator Input
- [ ] Add logging to permit route.ts for panelPositions + roofPlanes received
- [ ] Verify panels/roofPlanes reach generatePermitHTML()

## Phase 4 — Verify DB Schema
- [ ] Check layouts table schema has panels + roof_planes columns
- [ ] Verify upsertLayout SQL includes roof_planes in INSERT/UPDATE

## Phase 5 — Test + Deploy
- [ ] tsc --noEmit: 0 errors
- [ ] npm run build: passes
- [ ] Commit + push debug instrumentation