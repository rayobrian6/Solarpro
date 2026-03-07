# Mounting & Structural UI Audit + Upgrade

## Phase 1: Audit & Analysis [DONE]
- [x] Review both UI screenshots
- [x] Audit Structural page data sources (RACKING_SYSTEMS from equipment-db.ts)
- [x] Audit Mounting Details page data sources (mounting-hardware-db.ts)
- [x] Audit BOM engine (equipment-registry-v4.ts)
- [x] Identify all data flow disconnects

## Phase 2: Fix Data Flow Disconnects
- [ ] Add Roof Tech model variations to mounting-hardware-db
- [ ] Fix Structural page: replace RACKING_SYSTEMS with getAllMountingSystems()
- [ ] Fix rackingIdMap in page.tsx to include all 38 systems
- [ ] Update LEGACY_ID_MAP with all new system IDs
- [ ] Add missing registry entries to equipment-registry-v4.ts for new brands

## Phase 3: UI Upgrades
- [ ] Structural page: upgrade Racking System section
- [ ] Mounting Details page: add search/filter and model variations display
- [ ] Both pages: ensure selected system syncs via config.mountingId

## Phase 4: Build & Deploy
- [ ] Build and verify TypeScript passes
- [ ] Commit and push