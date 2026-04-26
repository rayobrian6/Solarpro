# SolarPro BOM Work — Active Session

## v58.6 — Ecosystem Apply Central Inverter Fix ✅ COMPLETE
- [x] Identify root cause: ecosystem picker stores optimizer peripheral ID (se-p505) as inverterId
- [x] Fix: resolve central inverter from brand profile supportedInverterModels on apply
- [x] Add getBrandProfile import to page.tsx
- [x] All 2570 tests pass
- [x] Committed as 30590ea + version bump 1650b1b
- [x] Pushed to master → Vercel auto-deploy in progress

## v58.6 — Secondary Safety Net (API Guard 1 formula) ✅ COMPLETE
- [x] Fix Guard 1 formula in bom/route.ts: now uses physMax = ceil(modules/25) instead of ceil(max(strings,2)/2)
  - Old: ceil(max(36,2)/2) = 18 (wrong) → New: ceil(36/25) = 2 (correct)
  - Committed as 3ed317b, pushed to master

## Remaining Datasheet Audit
- [ ] Sol-Ark inverters: audit datasheets vs equipment-db
- [ ] Growatt inverters: audit datasheets vs equipment-db
- [ ] Solis inverters: audit datasheets vs equipment-db
- [ ] Tesla inverters: audit datasheets vs equipment-db
- [ ] Tigo inverters: audit datasheets vs equipment-db

## EcoFlow/SolFence Integration (Phases 1-12)
- [ ] Phase 1-12 work (deferred — pending user direction)