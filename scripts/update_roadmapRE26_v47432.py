#!/usr/bin/env python3
"""v47.432 roadmapRE26 update — add Stage 8.1 + 8.2 entry."""
from pathlib import Path

p = Path('lib/roadmapRE26.ts')
txt = p.read_text(encoding='utf-8')

# Insert new v47.432 entry immediately after the v47.431 block (before the IN PROGRESS marker).
anchor = '''    shippedIn: 'v47.431',
    notes: 'Pure read-only audit. Full test suite unchanged (1808/1808 pass). Exit criteria: user chooses Stage 8 scope from the three documented options.',
    createdAt: '2026-04-22',
    updatedAt: '2026-04-22',
  },

  // \u2500\u2500\u2500 IN PROGRESS'''

new_entry = '''    shippedIn: 'v47.431',
    notes: 'Pure read-only audit. Full test suite unchanged (1808/1808 pass). Exit criteria: user chooses Stage 8 scope from the three documented options.',
    createdAt: '2026-04-22',
    updatedAt: '2026-04-22',
  },

  {
    id: 'v47.432-stage8-bom-deletion-drift-guards',
    title: 'v47.432 \u2014 Stage 8.1 + 8.2: BOM Dead-Code Deletion + Drift-Fence CI Tests',
    summary: 'Executes the Stage 7 recommended scope per user directive (low-risk: pure deletion + additive tests only). STAGE 8.1: deletes 7 orphan BOM files totalling -3,278 lines (lib/bom-engine.ts / bom-v2-engine.ts / bom-unified.ts / bom-merge.ts + app/api/engineering/bom-v2/route.ts + 2 dead test files bom-merge.test.ts + bom-unified.test.ts). The one live engine that remains is bom-engine-v4.ts. 21 dangling comment pointers across bom-system-profiles.ts (16), app/engineering/page.tsx (4), bom-engine-v4.ts (1) rewritten as v47.432-tagged historical attribution. STAGE 8.2: +273 CI tests across 2 new drift-guard files. rackingDatabaseDriftGuard.test.ts (45 tests) enforces manufacturer + systemType coarse-bucket + compatibleRoofTypes overlap for the 14 IDs shared by racking-database.ts and mounting-hardware-db.ts; 2 pre-existing divergences documented in EXPECTED_DIVERGENCES allowlist (ecofasten-rockit, esdec-flatfix). brandProfileDriftGuard.test.ts (228 tests) enforces acKw/dcKwMax/mpptCount/maxParallelStringsPerMppt equality between every BrandInverterModelRef and its canonical STRING_INVERTERS row, with new overridesEquipmentDb opt-out flag added to the BrandInverterModelRef type. 5 SKUs tagged with the opt-out (sungrow-sg15rs, sma-sb-10.0 intentional; sma-sb-7.7, goodwe-gw10k-ms, generic-string::se-7600h/se-10000h stale \u2014 TODO Stage 8.4). Test suite grows 1808 \u2192 2075 net (+267 after -67 dead + 273 new). TC=0, npm run build clean (46/46 pages). Zero API changes, zero value changes to existing data.',
    track: 'infrastructure',
    priority: 'p1',
    status: 'done',
    effort: 'm',
    files: [
      // Stage 8.1 deletions
      'lib/bom-engine.ts',
      'lib/bom-v2-engine.ts',
      'lib/bom-unified.ts',
      'lib/bom-merge.ts',
      'lib/bom-merge.test.ts',
      'lib/bom-unified.test.ts',
      'app/api/engineering/bom-v2/route.ts',
      // Stage 8.1 comment rewrites
      'lib/bom-system-profiles.ts',
      'lib/bom-engine-v4.ts',
      'app/engineering/page.tsx',
      // Stage 8.2 new drift-guards
      'lib/system/rackingDatabaseDriftGuard.test.ts',
      'lib/system/brandProfileDriftGuard.test.ts',
      // Stage 8.2 type flag + per-brand opt-out tags
      'lib/system/brandProfiles/types.ts',
      'lib/system/brandProfiles/sungrow.ts',
      'lib/system/brandProfiles/sma.ts',
      'lib/system/brandProfiles/goodwe.ts',
      'lib/system/brandProfiles/generic-string.ts',
      // Release artifacts
      'docs/UPGRADE_ROADMAP_v47.399.md',
      'lib/version.ts',
      'lib/roadmapRE26.ts',
    ],
    shippedIn: 'v47.432',
    notes: 'Stage 8.3 (racking unification) and Stage 8.4 (brand-profile centralization + reconcile 3 documented stale profile drifts) remain deferred per user directive. Drift-guard audit log surfaces the full override list on every CI run for review visibility.',
    createdAt: '2026-04-22',
    updatedAt: '2026-04-22',
  },

  // \u2500\u2500\u2500 IN PROGRESS'''

assert anchor in txt, 'roadmapRE26 anchor not found'
txt = txt.replace(anchor, new_entry, 1)
p.write_text(txt, encoding='utf-8')
print('lib/roadmapRE26.ts updated for v47.432')