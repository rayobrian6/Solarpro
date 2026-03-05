#!/usr/bin/env python3
"""
Binary-safe patch script for electrical-calc.ts
Applies 3 NEC compliance fixes:
  1. Conduit fill: add EGC to fill area + fix denominator to maxFillArea_3plus
  2. Conductor sizing: use OCPD rating (not continuous current) as min ampacity
  3. DC disconnect: suppress error for microinverter systems (NEC 690.15)
"""

import sys

FILE = 'lib/electrical-calc.ts'

with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

original = src  # keep for diff

# ─────────────────────────────────────────────────────────────────────────────
# FIX 1: Legacy conduit fill section (lines ~795-800)
# WRONG: acWireCount=3, totalFillArea = acWireArea*3, fillPercent uses .area
# RIGHT: count EGC too, fillPercent uses .maxFillArea_3plus
# ─────────────────────────────────────────────────────────────────────────────
OLD_FILL = (
  '  const acWireArea = getConductorArea(acGaugeForConduit);\n'
  '  const acWireCount = 3;\n'
  '  const totalFillArea = acWireArea * acWireCount;\n'
  '  const suitableConduit = getSmallestConduit(input.conduitType, totalFillArea);\n'
  '  const conduitFillPercent = suitableConduit ? (totalFillArea / suitableConduit.area) * 100 : 100;\n'
  '  const conduitFillPasses = conduitFillPercent <= 40;'
)

NEW_FILL = (
  '  const acWireArea = getConductorArea(acGaugeForConduit);\n'
  '  const acWireCount = 3; // current-carrying conductors (L1, L2, N or L1, L2 + neutral)\n'
  '  // FIX NEC Ch.9 Note 1: EGC must be counted in conduit fill calculation\n'
  '  const egcGaugeForFill = getEGCSize(maxOcpd || 60);\n'
  '  const egcAreaForFill = getConductorArea(egcGaugeForFill);\n'
  '  const totalFillArea = (acWireArea * acWireCount) + egcAreaForFill; // EGC included per NEC Ch.9 Note 1\n'
  '  const suitableConduit = getSmallestConduit(input.conduitType, totalFillArea);\n'
  '  // FIX: fill% denominator must be maxFillArea_3plus (40% limit area), NOT total conduit area\n'
  '  const conduitFillPercent = suitableConduit ? (totalFillArea / suitableConduit.maxFillArea_3plus) * 100 : 100;\n'
  '  const conduitFillPasses = conduitFillPercent <= 100; // passes if fits within 40%-limit area'
)

if OLD_FILL in src:
    src = src.replace(OLD_FILL, NEW_FILL, 1)
    print('✅ FIX 1 applied: conduit fill EGC + maxFillArea_3plus denominator')
else:
    print('❌ FIX 1 NOT FOUND — check string match')
    # Print surrounding context for debugging
    idx = src.find('const acWireCount = 3;')
    if idx >= 0:
        print('  Context around acWireCount:', repr(src[idx-100:idx+200]))

# ─────────────────────────────────────────────────────────────────────────────
# FIX 2: Conductor sizing — use OCPD rating, not continuous current
# NEC 310.16: conductor ampacity must be ≥ OCPD rating
# ─────────────────────────────────────────────────────────────────────────────
OLD_CONDUCTOR = "  const acSizingConductor = getConductorByMinAmpacity(acSizingContinuousAmps, '75c');"
NEW_CONDUCTOR = (
  "  // FIX NEC 310.16: conductor ampacity must be >= OCPD rating (not just >= continuous current)\n"
  "  // Using acSizingOcpdAmps ensures conductor can handle the full OCPD trip current\n"
  "  const acSizingConductor = getConductorByMinAmpacity(acSizingOcpdAmps, '75c');"
)

if OLD_CONDUCTOR in src:
    src = src.replace(OLD_CONDUCTOR, NEW_CONDUCTOR, 1)
    print('✅ FIX 2 applied: conductor sizing uses OCPD rating (NEC 310.16)')
else:
    print('❌ FIX 2 NOT FOUND — check string match')
    idx = src.find('acSizingConductor = getConductorByMinAmpacity')
    if idx >= 0:
        print('  Context:', repr(src[idx-50:idx+150]))

# ─────────────────────────────────────────────────────────────────────────────
# FIX 3: DC disconnect — suppress error for microinverter systems
# NEC 690.15: DC disconnect NOT required for microinverter systems
# (no accessible DC circuit above 30V between modules and inverter)
# ─────────────────────────────────────────────────────────────────────────────
OLD_DC = (
  "  if (!input.dcDisconnect) {\n"
  "    allErrors.push({\n"
  "      code: 'E-DC-DISCONNECT',\n"
  "      severity: 'error',\n"
  "      message: 'DC disconnect required for each inverter',\n"
  "      necReference: 'NEC 690.15',\n"
  "      suggestion: 'Install DC disconnect switch at each inverter',\n"
  "    });\n"
  "  }"
)

NEW_DC = (
  "  // FIX NEC 690.15: DC disconnect NOT required for microinverter systems\n"
  "  // Microinverters have no accessible DC circuit > 30V (module-level conversion)\n"
  "  if (!input.dcDisconnect && !isMicroSystem) {\n"
  "    allErrors.push({\n"
  "      code: 'E-DC-DISCONNECT',\n"
  "      severity: 'error',\n"
  "      message: 'DC disconnect required for each string/central inverter',\n"
  "      necReference: 'NEC 690.15',\n"
  "      suggestion: 'Install DC disconnect switch at each inverter',\n"
  "    });\n"
  "  } else if (!input.dcDisconnect && isMicroSystem) {\n"
  "    // Microinverter systems: DC disconnect not required per NEC 690.15\n"
  "    // Module-level power electronics eliminate accessible DC conductors\n"
  "    allInfos.push({\n"
  "      code: 'I-DC-DISCONNECT-MICRO',\n"
  "      severity: 'info',\n"
  "      message: 'DC disconnect not required for microinverter system (NEC 690.15 — no accessible DC circuit)',\n"
  "      necReference: 'NEC 690.15',\n"
  "    });\n"
  "  }"
)

if OLD_DC in src:
    src = src.replace(OLD_DC, NEW_DC, 1)
    print('✅ FIX 3 applied: DC disconnect suppressed for microinverter systems (NEC 690.15)')
else:
    print('❌ FIX 3 NOT FOUND — check string match')
    idx = src.find("code: 'E-DC-DISCONNECT'")
    if idx >= 0:
        print('  Context:', repr(src[idx-100:idx+200]))

# ─────────────────────────────────────────────────────────────────────────────
# Write patched file
# ─────────────────────────────────────────────────────────────────────────────
if src != original:
    with open(FILE, 'w', encoding='utf-8') as f:
        f.write(src)
    print(f'\n✅ Patched file written: {FILE}')
    
    # Count changes
    orig_lines = original.count('\n')
    new_lines = src.count('\n')
    print(f'   Lines: {orig_lines} → {new_lines} (+{new_lines - orig_lines})')
else:
    print('\n⚠️  No changes made — all fixes already applied or not found')