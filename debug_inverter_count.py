#!/usr/bin/env python3
"""
Trace exact inverter count for 141-panel SolarEdge system.
SE11400H: mpptCount=1, maxPanelsPerString=25, dcKwMax=17.1, acKw=11.4
"""

import math

# SE11400H specs
mpptCount = 1
maxPPS = 25
minPPS = 8
dcKwMax = 17.1
acKw = 11.4
maxParallelPerMppt = 2  # DEFAULT_PARALLEL_STRINGS_PER_MPPT

# System
panelCount = 141
totalDcKw = 56.4  # from screenshot

# Step 1: panelsPerUnit
ppu = mpptCount * maxParallelPerMppt * maxPPS
print(f"panelsPerUnit = {mpptCount} × {maxParallelPerMppt} × {maxPPS} = {ppu}")

# Step 2: unitsRequired
byDc = math.ceil(totalDcKw / dcKwMax)
byPanels = math.ceil(panelCount / ppu)
qty = max(byDc, byPanels)
print(f"byDc = ceil({totalDcKw}/{dcKwMax}) = {byDc}")
print(f"byPanels = ceil({panelCount}/{ppu}) = {byPanels}")
print(f"unitsRequired = max({byDc}, {byPanels}) = {qty}")
print()

# Step 3: DC/AC ratio check
totalAc = acKw * qty
ratio = totalDcKw / totalAc
print(f"DC/AC ratio = {totalDcKw} / ({acKw} × {qty}) = {ratio:.3f}")
print(f"MIN_DC_AC_RATIO = 0.9 → {'PASS' if ratio >= 0.9 else 'FAIL → downsize trigger'}")
print()

# Step 4: String layout for qty inverters
print(f"=== STRING LAYOUT for {qty} × SE11400H ===")
# Find chosenParallel (min p s.t. avg panels/slot <= maxPPS AND >= minPPS)
for p in range(1, maxParallelPerMppt + 1):
    slots = qty * mpptCount * p
    avg = panelCount / slots
    if avg <= maxPPS and avg >= minPPS:
        chosenParallel = p
        break
else:
    chosenParallel = maxParallelPerMppt

totalSlots = qty * mpptCount * chosenParallel
print(f"chosenParallel = {chosenParallel}")
print(f"totalSlots = {qty} × {mpptCount} × {chosenParallel} = {totalSlots}")
print()

# Distribute panels
panelsLeft = panelCount
strings = []
for i in range(totalSlots):
    slotsRemaining = totalSlots - i
    fairShare = math.ceil(panelsLeft / slotsRemaining)
    thisString = min(fairShare, maxPPS, panelsLeft)
    physicalUnit = i // (mpptCount * chosenParallel)
    strings.append({'panels': thisString, 'inverterIndex': physicalUnit})
    panelsLeft -= thisString

print(f"String distribution:")
for j, s in enumerate(strings):
    print(f"  String {j+1}: {s['panels']} panels → Inverter #{s['inverterIndex']}")

print(f"\nTotal strings: {len(strings)}")
print(f"inverterCount from rec.inverterCount: {qty}")
print(f"rec.strings.length: {len(strings)}")
print()

# What actually gets sent as config.inverters.length?
print("=== WHAT config.inverters.length BECOMES ===")
# When "Apply" is clicked: newInverters loop creates 1 entry per physicalUnitIndex 0..inverterCount-1
# inverterCount = rec.inverterCount = qty
print(f"After 'Apply' is clicked: config.inverters.length = rec.inverterCount = {qty}")
print()

# What if user manually added strings (not via Apply)?
# The UI has "Add String" per inverter card. If they added strings one by one
# with no Apply, config could have any structure.
# BUT: the most common bug path is a stale config from a previous session.
# If the system was previously configured as micro (or as a string with many strings),
# the inverters array could be much larger.

# The REAL bug: what if 141 panels were distributed as 1 panel per string 
# and 1 string per inverter? That would give 141 inverter objects.
# Or 36 strings × 1 inverter each = 36 inverters
# 36 strings of ~4 panels each = 36×4 = 144 ≈ 141 panels

print("=== IF USER HAS 36 STRINGS BEFORE APPLYING ===")
print(f"36 strings × ~4 panels each = {36 * 4} panels (≈ {panelCount})")
print(f"If 1 string per inverter card → config.inverters.length = 36")
print(f"BOM route receives inverterCount=36")
print()

# BOM route guard check for 36 inverters:
rawInvCount = 36
rawModules = panelCount  # 141
rawStrings = 36
isOptimizer = True

print("=== BOM ROUTE OPTIMIZER GUARD CHECK ===")
print(f"rawInvCount={rawInvCount}, rawModules={rawModules}, isOptimizer={isOptimizer}")
print(f"Condition: isOptimizer && rawModules>0 && rawInvCount >= rawModules")
print(f"         = {isOptimizer} && {rawModules>0} && {rawInvCount >= rawModules}")
print(f"         = {isOptimizer and rawModules > 0 and rawInvCount >= rawModules}")
print(f"→ Guard does NOT fire because 36 < 141")
print()

print("=== CONCLUSION ===")
print(f"The guard only fires when inverterCount >= moduleCount (catches the 141>=141 case)")
print(f"But inverterCount=36 is less than moduleCount=141, so 36 inverters slip through")
print(f"36 × $1,500 SE11400H = ${36*1500:,}")
print(f"Correct count is {qty} inverters × $1,500 = ${qty*1500:,}")
print()
print(f"FIX NEEDED: The optimizer guard should also catch inverterCount > ceil(moduleCount/maxPPS)")
print(f"  ceil({panelCount}/{ppu}) = {math.ceil(panelCount/ppu)} max inverters for optimizer topology")
print(f"  If rawInvCount ({rawInvCount}) > {math.ceil(panelCount/ppu)}, cap it")