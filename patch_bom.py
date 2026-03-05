#!/usr/bin/env python3
"""
Patch for lib/bom-engine-v4.ts:
  1. Add 110A to nextStandardBreaker() — NEC 240.6(A) standard sizes
  2. Fix AC wire quantity: 3 CC + 1 EGC = 4 conductors (not 3)
  3. Fix AC wire description to reflect 4 conductors
"""

FILE = 'lib/bom-engine-v4.ts'

with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

original = src

# ─────────────────────────────────────────────────────────────────────────────
# FIX BOM-1: Add 110A to nextStandardBreaker() — NEC 240.6(A)
# Current: [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200]
# Correct: [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200]
# ─────────────────────────────────────────────────────────────────────────────
OLD_BREAKER_SIZES = "  const sizes = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200];"
NEW_BREAKER_SIZES = "  const sizes = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200]; // NEC 240.6(A) — 110A added"

if OLD_BREAKER_SIZES in src:
    src = src.replace(OLD_BREAKER_SIZES, NEW_BREAKER_SIZES, 1)
    print('✅ FIX BOM-1 applied: 110A added to nextStandardBreaker() per NEC 240.6(A)')
else:
    print('❌ FIX BOM-1 NOT FOUND')
    idx = src.find('nextStandardBreaker')
    if idx >= 0:
        print('  Context:', repr(src[idx:idx+300]))

# ─────────────────────────────────────────────────────────────────────────────
# FIX BOM-2: AC wire quantity — 3 CC + 1 EGC = 4 conductors
# Current: acWireLength * 3  (only counts L1, L2, N)
# Correct: acWireLength * 4  (L1, L2, N + EGC per NEC 250.122)
# ─────────────────────────────────────────────────────────────────────────────
OLD_AC_WIRE_QTY = (
  "  const acWireQty = conduitLength(input.acWireLength * 3); // 3 conductors (L1, L2, N)\n"
  "  items.push(addItem('ac', 'wire', 'Southwire', `${input.acWireGauge} THWN-2`,\n"
  "    `THWN2-${input.acWireGauge.replace('#', '').replace(' AWG', '')}`,\n"
  "    `${input.acWireGauge} THWN-2 — AC home run (3 conductors)`,\n"
  "    acWireQty, 'ft', 'NEC 310.15', 'acWireLength × 3 × 1.15', `${input.acWireLength} × 3 × 1.15`, true));\n"
  "  log.push({ stageId: 'ac', category: 'wire', item: `${input.acWireGauge} THWN-2`,\n"
  "    quantity: acWireQty, derivedFrom: 'acWireLength × 3 conductors × 1.15', formula: 'acWireLength * 3 * 1.15', necReference: 'NEC 310.15' });"
)

NEW_AC_WIRE_QTY = (
  "  // FIX NEC 250.122: AC home run has 4 conductors: L1, L2, N (current-carrying) + EGC\n"
  "  const acWireQty = conduitLength(input.acWireLength * 4); // 4 conductors: L1, L2, N + EGC\n"
  "  items.push(addItem('ac', 'wire', 'Southwire', `${input.acWireGauge} THWN-2`,\n"
  "    `THWN2-${input.acWireGauge.replace('#', '').replace(' AWG', '')}`,\n"
  "    `${input.acWireGauge} THWN-2 — AC home run (3 CC + 1 EGC = 4 conductors)`,\n"
  "    acWireQty, 'ft', 'NEC 310.15 / 250.122', 'acWireLength × 4 × 1.15', `${input.acWireLength} × 4 × 1.15`, true));\n"
  "  log.push({ stageId: 'ac', category: 'wire', item: `${input.acWireGauge} THWN-2`,\n"
  "    quantity: acWireQty, derivedFrom: 'acWireLength × 4 conductors (3 CC + EGC) × 1.15', formula: 'acWireLength * 4 * 1.15', necReference: 'NEC 310.15 / 250.122' });"
)

if OLD_AC_WIRE_QTY in src:
    src = src.replace(OLD_AC_WIRE_QTY, NEW_AC_WIRE_QTY, 1)
    print('✅ FIX BOM-2 applied: AC wire qty uses 4 conductors (3 CC + 1 EGC per NEC 250.122)')
else:
    print('❌ FIX BOM-2 NOT FOUND')
    idx = src.find('acWireQty = conduitLength')
    if idx >= 0:
        print('  Context:', repr(src[idx-50:idx+300]))

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