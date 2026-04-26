# Stage 8.1 + 8.2 — v47.432 Execution Checklist

## Stage 8.1 — BOM Dead-Code Deletion
- [ ] Delete `lib/bom-engine.ts` (630 lines, zero imports)
- [ ] Delete `lib/bom-v2-engine.ts` (597 lines, only consumed by dead route)
- [ ] Delete `lib/bom-unified.ts` (684 lines)
- [ ] Delete `lib/bom-merge.ts` (317 lines)
- [ ] Delete `lib/bom-merge.test.ts` (454 lines, tests dead code)
- [ ] Delete `lib/bom-unified.test.ts` (571 lines, tests dead code)
- [ ] Delete `app/api/engineering/bom-v2/route.ts` (dead route)
- [ ] Rewrite ~10 comment pointers in `lib/bom-system-profiles.ts` (replace "bom-unified.ts deriveXBOM()" refs with "v47.432: bom-unified.ts deleted — logic now lives here")
- [ ] Update 2 comment pointers in `app/engineering/page.tsx` (lines 1378, 1410)

## Stage 8.2 — Drift-Guard CI Tests
- [ ] Create `lib/system/rackingDatabaseDriftGuard.test.ts` — 14 overlapping IDs must match on manufacturer + model between racking-database.ts and mounting-hardware-db.ts
- [ ] Create `lib/system/brandProfileDriftGuard.test.ts` — every BrandInverterModelRef field must match STRING_INVERTERS, with `overridesEquipmentDb?: true` opt-out

## Shipping
- [ ] Run tsc --noEmit clean
- [ ] Run full test suite (should pass + new drift-guard tests)
- [ ] Run npm run build
- [ ] Bump lib/version.ts to v47.432
- [ ] Update docs/UPGRADE_ROADMAP_v47.399.md (mark Stage 8.1+8.2 done)
- [ ] Update lib/roadmapRE26.ts (add v47.432 entry)
- [ ] Commit and push