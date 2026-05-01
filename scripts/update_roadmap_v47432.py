#!/usr/bin/env python3
"""v47.432 roadmap update — mark Stage 8.1 + 8.2 shipped."""
from pathlib import Path

p = Path('docs/UPGRADE_ROADMAP_v47.399.md')
txt = p.read_text(encoding='utf-8')

# 1) Update the stage checklist line for Stage 8
old_stage8 = '- [ ] Stage 8 \u2014 Consolidation execution (conditional \u2014 awaiting user decision on recommended 8.1 + 8.2 scope)'
new_stage8 = (
    '- [~] Stage 8 \u2014 Consolidation execution: '
    '**8.1 shipped v47.432** (BOM dead-code deletion: 7 files / -3,278 lines, 0 API changes), '
    '**8.2 shipped v47.432** (drift-fence CI tests: rackingDatabaseDriftGuard +45 tests, '
    'brandProfileDriftGuard +228 tests with overridesEquipmentDb opt-out; 2 pre-existing racking '
    'divergences + 5 pre-existing brand-profile drift points documented in-code). '
    '**8.3 deferred** (racking unification). **8.4 deferred** (brand-profile centralization + '
    'reconcile 3 documented stale profile drifts: sma-sb-7.7 mpptCount, goodwe-gw10k-ms full spec, '
    'generic-string::se-7600h/se-10000h mpptCount).'
)
assert old_stage8 in txt, 'Stage 8 checklist line not found'
txt = txt.replace(old_stage8, new_stage8, 1)

# 2) Update the "Next action" pointer at the bottom of the Stage 7 exit section
old_next = '**Next:** User decision on Stage 8.1 + 8.2 execution.\n'
new_next = (
    '**Stage 8.1 + 8.2 shipped in v47.432** per user directive: pure deletion + additive tests only.\n'
    'Stage 8.3 (racking unification) and Stage 8.4 (brand-profile centralization) remain deferred.\n'
    '\n'
    '---\n'
    '\n'
    '### \U0001f527 Stage 8.1 + 8.2 \u2014 BOM Dead-Code Deletion + Drift-Fence CI Tests (shipped v47.432)\n'
    '\n'
    '**Scope:** low-risk execution of the two RECOMMENDED items from the Stage 7 assessment. No '
    'racking unification, no brand-profile refactor. Per user directive: "Keep this release low-risk: '
    'pure deletion + additive tests only."\n'
    '\n'
    '**Deliverables:**\n'
    '\n'
    '1. **Stage 8.1 \u2014 BOM dead-code deletion** (7 files, -3,278 lines total):\n'
    '   - `lib/bom-engine.ts` (630 lines, v1 legacy engine, zero production imports)\n'
    '   - `lib/bom-v2-engine.ts` (597 lines, only consumed by the dead bom-v2 route)\n'
    '   - `lib/bom-unified.ts` (684 lines, only imported by the also-dead bom-merge.ts + 2 test files)\n'
    '   - `lib/bom-merge.ts` (317 lines, only imported by its own test file)\n'
    '   - `app/api/engineering/bom-v2/route.ts` (orphan API route with no client callers)\n'
    '   - `lib/bom-merge.test.ts` (454 lines, tested only dead code)\n'
    '   - `lib/bom-unified.test.ts` (571 lines, tested only dead code)\n'
    '\n'
    '   The one live engine remaining is `lib/bom-engine-v4.ts`, consumed by `bom-system-profiles.ts`, '
    '`ecoflow-bom.ts`, `app/api/engineering/bom/route.ts`, and `app/api/engineering/preliminary/route.ts` '
    '\u2014 unchanged. 16 dangling comment references in `bom-system-profiles.ts` + 4 in '
    '`app/engineering/page.tsx` + 1 in `bom-engine-v4.ts` were rewritten as v47.432-tagged historical '
    'attribution so grep still finds the legacy-pattern lineage.\n'
    '\n'
    '2. **Stage 8.2 \u2014 Drift-fence CI tests** (+273 tests, 2 new files):\n'
    '\n'
    '   **`lib/system/rackingDatabaseDriftGuard.test.ts` (45 tests)** \u2014 for all 14 IDs '
    'overlapping between `racking-database.ts` and `mounting-hardware-db.ts`, enforces '
    'manufacturer match, systemType coarse-bucket consistency via an explicit taxonomy bridge '
    '(mh-db finer vocab \u2192 racking-db coarse 4-value vocab), and compatibleRoofTypes shared-overlap '
    'after roof-type vocabulary normalization. `EXPECTED_DIVERGENCES` allowlist documents 2 pre-existing '
    'divergences: `ecofasten-rockit` (racking says rail_based with full rail spec, mh-db says rail_less '
    '\u2014 product-model disagreement) and `esdec-flatfix` (coarse `ballasted` vs fine `ballasted_flat` '
    '\u2014 already bridged through the coarse-bucket map).\n'
    '\n'
    '   **`lib/system/brandProfileDriftGuard.test.ts` (228 tests across ~57 brand/SKU pairs)** \u2014 '
    'for every `BrandInverterModelRef` in `BRAND_PROFILES`, asserts `acKw === acOutputKw`, '
    '`dcKwMax === dcInputKwMax`, `mpptCount === mpptChannels`, and `maxParallelStringsPerMppt` matches '
    'when both sides declare a value. New `overridesEquipmentDb: true` opt-out flag added to '
    '`BrandInverterModelRef` type. Test emits self-documenting CI audit log listing every '
    'overridden SKU. 5 SKUs tagged on first run with in-code justification:\n'
    '\n'
    '   - `sungrow-sg15rs` (maxParallel 1 vs 2) \u2014 INTENTIONAL design-rule override\n'
    '   - `sma-sb-10.0` (maxParallel 1 vs 6) \u2014 INTENTIONAL (no external combiner for residential)\n'
    '   - `sma-sb-7.7` (mpptCount 2 vs 3) \u2014 STALE, TODO(Stage 8.4)\n'
    '   - `goodwe-gw10k-ms` (acKw 10 vs 9.6, dcKwMax 15 vs 14.4, mpptCount 2 vs 3) \u2014 STALE, TODO(Stage 8.4)\n'
    '   - `generic-string :: se-7600h` / `se-10000h` (mpptCount 2 vs 1) \u2014 STALE, TODO(Stage 8.4)\n'
    '\n'
    '**Test arithmetic:** v47.431 = 1808 tests across 47 files. Deleted 2 dead test files (-67 tests, '
    '-2 files). Added 2 drift-guard files (+273 tests, +2 files). Net v47.432 = **2075 tests across '
    '47 files** (+267 drift-fence coverage). TC=0, `npm run build` clean (46/46 pages).\n'
    '\n'
    '**Stage 8.3 / 8.4 backlog (deferred):**\n'
    '\n'
    '- **Stage 8.3** \u2014 Racking DB unification (reconcile the 2 divergences in EXPECTED_DIVERGENCES, '
    'retire `structural-engine-v3` via adapter, delete `racking-database.ts`)\n'
    '- **Stage 8.4** \u2014 Brand-profile spec centralization (reconcile the 3 stale profile drifts '
    'flagged by the drift-guard: sma-sb-7.7, goodwe-gw10k-ms, and the 2 SolarEdge catch-alls in '
    'generic-string; optionally remove the duplicated fields from `BrandInverterModelRef` so profiles '
    'read from `equipment-db` directly)\n'
)

assert old_next in txt, 'Next action pointer not found'
txt = txt.replace(old_next, new_next, 1)

p.write_text(txt, encoding='utf-8')
print('docs/UPGRADE_ROADMAP_v47.399.md updated for v47.432')