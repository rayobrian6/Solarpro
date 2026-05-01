# v51.0 UI Overhaul — Remaining Work

## Engineering Page Heroes ✅ DONE
- [x] Restore from v50.0 git (corrupted file fixed)
- [x] Insert Structural hero
- [x] Insert SLD hero
- [x] Insert Permit hero
- [x] Insert Files hero
- [x] Fix TS errors (snowLoad→groundSnowLoad, systemVoltage→mainPanelAmps)
- [x] tsc clean ✅
- [x] vitest 2525/2525 ✅

## Global AppShell + CSS elevation (globals.css, AppShell.tsx) ✅ DONE

## Page-Level UI Elevation (v51.0)
- [x] Projects page: upgrade pipeline bar + page header hero
- [x] Clients page: upgrade header + stats bar + card grid
- [x] Analytics page: upgrade header + KPI section
- [x] Dashboard page: upgrade KPI bar + section headers (already good baseline)
- [x] Settings page: upgrade section headers + card treatments
- [x] Proposals page: upgrade command header

## Version + Ship
- [x] Bump version v50→v51 in lib/version.ts
- [x] Update roadmapRE26.ts
- [x] tsc + vitest final check (63/63, 2525/2525)
- [x] git commit 613fbf0 + push