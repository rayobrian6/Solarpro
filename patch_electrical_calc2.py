#!/usr/bin/env python3
"""
Patch 2 for electrical-calc.ts:
  1. Fix acSizing conduit fill: EGC area must be separate from current-carrying conductors
     (comment says L1, L2, EGC but code does acWireArea * 3 — should be acWireArea * 2 + egcArea
      OR for 240V single-phase: L1, L2, N, EGC = 4 conductors)
     For standard 240V residential solar: 2 hots + 1 neutral + 1 EGC = 4 conductors
     But NEC conduit fill: count ALL conductors including EGC
  2. Fix wireCount in conduitFillResult to reflect actual conductor count (3 CC + 1 EGC = 4)
"""

FILE = 'lib/electrical-calc.ts'

with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

original = src

# ─────────────────────────────────────────────────────────────────────────────
# FIX 4: acSizing conduit fill — EGC must be counted separately
# Current: acSizingWireArea * 3  (treats EGC as same size as phase conductors)
# Correct: (acSizingWireArea * 3) + egcArea  (EGC sized per NEC 250.122)
# ─────────────────────────────────────────────────────────────────────────────
OLD_ACSIZING_FILL = (
  "  // Step 7: Conduit Fill — NEC Chapter 9 Table 5 areas (3 conductors: L1, L2, EGC)\n"
  "  const acSizingWireArea = NEC_TABLE5_WIRE_AREA[acSizingConductorGauge] ?? getConductorArea(acSizingConductorGauge);\n"
  "  const acSizingTotalFillArea = acSizingWireArea * 3;\n"
  "  const acSizingConduit = getSmallestConduit(input.conduitType, acSizingTotalFillArea);"
)

NEW_ACSIZING_FILL = (
  "  // Step 7: Conduit Fill — NEC Chapter 9 Table 5 areas\n"
  "  // 240V single-phase: 3 current-carrying conductors (L1, L2, N) + 1 EGC = 4 total\n"
  "  // NEC Ch.9 Note 1: EGC must be included in conduit fill calculation\n"
  "  const acSizingWireArea = NEC_TABLE5_WIRE_AREA[acSizingConductorGauge] ?? getConductorArea(acSizingConductorGauge);\n"
  "  const acSizingEgcGauge = getEGCSize(acSizingOcpdAmps);\n"
  "  const acSizingEgcArea = NEC_TABLE5_WIRE_AREA[acSizingEgcGauge] ?? getConductorArea(acSizingEgcGauge);\n"
  "  const acSizingConductorCount = 3; // current-carrying: L1, L2, N (or L1, L2 for 2-wire)\n"
  "  const acSizingTotalFillArea = (acSizingWireArea * acSizingConductorCount) + acSizingEgcArea; // EGC per NEC Ch.9 Note 1\n"
  "  const acSizingConduit = getSmallestConduit(input.conduitType, acSizingTotalFillArea);"
)

if OLD_ACSIZING_FILL in src:
    src = src.replace(OLD_ACSIZING_FILL, NEW_ACSIZING_FILL, 1)
    print('✅ FIX 4 applied: acSizing conduit fill includes EGC area (NEC Ch.9 Note 1)')
else:
    print('❌ FIX 4 NOT FOUND')
    idx = src.find('acSizingTotalFillArea = acSizingWireArea * 3')
    if idx >= 0:
        print('  Context:', repr(src[idx-100:idx+200]))

# ─────────────────────────────────────────────────────────────────────────────
# FIX 5: wireCount in legacy conduitFillResult should reflect actual count
# (3 current-carrying + 1 EGC = 4 total conductors in conduit)
# ─────────────────────────────────────────────────────────────────────────────
OLD_WIRECOUNT = (
  "  const conduitFillResult: ConduitFillResult = {\n"
  "    conduitType: input.conduitType,\n"
  "    conduitSize: suitableConduit?.tradeSize ?? 'N/A',\n"
  "    wireCount: acWireCount,"
)

NEW_WIRECOUNT = (
  "  const conduitFillResult: ConduitFillResult = {\n"
  "    conduitType: input.conduitType,\n"
  "    conduitSize: suitableConduit?.tradeSize ?? 'N/A',\n"
  "    wireCount: acWireCount + 1, // +1 for EGC per NEC Ch.9 Note 1"
)

if OLD_WIRECOUNT in src:
    src = src.replace(OLD_WIRECOUNT, NEW_WIRECOUNT, 1)
    print('✅ FIX 5 applied: wireCount in conduitFillResult includes EGC (+1)')
else:
    print('❌ FIX 5 NOT FOUND')
    idx = src.find('wireCount: acWireCount')
    if idx >= 0:
        print('  Context:', repr(src[idx-100:idx+200]))

# ─────────────────────────────────────────────────────────────────────────────
# Write patched file
# ─────────────────────────────────────────────────────────────────────────────
if src != original:
    with open(FILE, 'w', encoding='utf-8') as f:
        f.write(src)
    print(f'\n✅ Patched file written: {FILE}')
    orig_lines = original.count('\n')
    new_lines = src.count('\n')
    print(f'   Lines: {orig_lines} → {new_lines} (+{new_lines - orig_lines})')
else:
    print('\n⚠️  No changes made')