# v43.1 — Permit Plan Set UX Enhancement

## Phase 1 — handleGeneratePlanSet: handle binary blob download
- [x] API already returns binary when no projectId (confirmed)
- [ ] Update handleGeneratePlanSet to detect binary response and trigger browser download

## Phase 2 — permitReadiness computed object
- [ ] Add permitReadiness derived object from live engineering state
- [ ] Covers: projectLoaded, systemSize, panelCount, panelModel, inverterModel, roofPitch, rafterSize, address, ahjName

## Phase 3 — Full Plan Set Card UI overhaul
- [ ] Permit Readiness checklist (auto-populated, ✓/⚠ per field)
- [ ] Missing field instructions with tab navigation links
- [ ] Sheet preview cards (clickable → open preview modal)
- [ ] Locked generate button until permit-ready
- [ ] Preview modal component

## Phase 4 — TypeScript check + commit + push v43.1
- [ ] npx tsc --noEmit
- [ ] Fix any errors
- [ ] git commit + push