# Mounting & Structural UI Audit + Upgrade

## Phase 1: Audit & Analysis [DONE]
- [x] Review both UI screenshots
- [x] Audit Structural page data sources (RACKING_SYSTEMS from equipment-db.ts)
- [x] Audit Mounting Details page data sources (mounting-hardware-db.ts)
- [x] Audit BOM engine (equipment-registry-v4.ts)
- [x] Identify all data flow disconnects

## Phase 2: Fix Data Flow Disconnects [DONE]
- [x] Add Roof Tech model variations to mounting-hardware-db (5 variants: RT-MINI, RT-MINI-S, RT-MINI-T, RT-HOOK, RT-MINI-M)
- [x] Fix Structural page: replace RACKING_SYSTEMS with ALL_MOUNTING_SYSTEMS (42 systems, 24 brands)
- [x] Fix rackingIdMap in page.tsx to include all 42 systems + legacy aliases
- [x] Structural calc mountSpecs uses correct MountingSystemSpec field names
- [x] BUILD_SUCCESS v25.7 — pushed to GitHub

## Phase 3: UI Upgrades
- [ ] Structural page: upgrade Racking System section
- [ ] Mounting Details page: add search/filter and model variations display
- [ ] Both pages: ensure selected system syncs via config.mountingId

## Phase 4: Build & Deploy
- [ ] Build and verify TypeScript passes
- [ ] Commit and push