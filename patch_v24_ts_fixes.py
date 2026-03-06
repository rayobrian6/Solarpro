#!/usr/bin/env python3
"""
Fix all TypeScript errors from BUILD v24:
1. route.ts: ratedKw → ratedOutputKw (GeneratorSystem field)
2. renderer: Add findRun lookups for new segments (batToBuiRun, buiToMspRun, genToAtsRun, atsToMspRun)
3. computed-system.ts: Remove conductorMaterial from makeRunSegment call objects (it's in Omit)
"""

# ─── Fix 1: route.ts ratedKw → ratedOutputKw ──────────────────────────────────
with open('app/api/engineering/sld/route.ts', 'r', encoding='utf-8') as f:
    src = f.read()

old_rated = "_genSpec?.ratedKw ??"
new_rated = "_genSpec?.ratedOutputKw ??"
assert old_rated in src, "ratedKw not found in route.ts"
src = src.replace(old_rated, new_rated, 1)
print("OK 1: ratedKw → ratedOutputKw in route.ts")

with open('app/api/engineering/sld/route.ts', 'w', encoding='utf-8') as f:
    f.write(src)

# ─── Fix 2: renderer — add findRun lookups for new segments ───────────────────
with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    src = f.read()

old_find = "  const branchRun     = findRun('BRANCH_RUN');"
new_find = """  const branchRun     = findRun('BRANCH_RUN');
  // BUILD v24: Battery/BUI/Generator/ATS computed segments
  const batToBuiRun   = findRun('BATTERY_TO_BUI_RUN');
  const buiToMspRun   = findRun('BUI_TO_MSP_RUN');
  const genToAtsRun   = findRun('GENERATOR_TO_ATS_RUN');
  const atsToMspRun   = findRun('ATS_TO_MSP_RUN');"""

assert old_find in src, "branchRun findRun not found in renderer"
src = src.replace(old_find, new_find, 1)
print("OK 2: findRun lookups added for new segments in renderer")

with open('lib/sld-professional-renderer.ts', 'w', encoding='utf-8') as f:
    f.write(src)

# ─── Fix 3: computed-system.ts — remove conductorMaterial from makeRunSegment calls ──
# The makeRunSegment function signature uses Omit<RunSegment, 'id'|'label'|'from'|'to'|'conductorMaterial'|'overallPass'>
# So conductorMaterial must NOT be passed in the object literal — it's set inside makeRunSegment
with open('lib/computed-system.ts', 'r', encoding='utf-8') as f:
    src = f.read()

# Find all occurrences of conductorMaterial: 'CU', in the new segment blocks
# These are in the 4 new segment computation blocks added by patch_v24_computed.py
import re

# Count occurrences
count = src.count("      conductorMaterial: 'CU',")
print(f"  Found {count} occurrences of conductorMaterial: 'CU', to remove")

# Remove all occurrences (they're all in the new segment blocks)
src = src.replace("      conductorMaterial: 'CU',\n", "")
remaining = src.count("conductorMaterial: 'CU',")
print(f"  Remaining occurrences: {remaining}")

with open('lib/computed-system.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print("OK 3: conductorMaterial removed from makeRunSegment call objects")

print("\nAll fixes applied. Running tsc check...")