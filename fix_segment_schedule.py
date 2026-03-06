with open('lib/segment-schedule.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Line 581 - COMBINER_TO_DISCO (micro feeder) - change 2 to 3 CCC
# This is inside the micro topology block
old1 = "    // Lands on LOAD side of AC disconnect (combiner feeds load terminals).\n    const feederSizing = autoSizeGauge(totalCurrentA, ambientC, 2, false, '#10 AWG');"
new1 = "    // Lands on LOAD side of AC disconnect (combiner feeds load terminals).\n    // NEC 200.3: neutral required for 120/240V split-phase; 3 current-carrying conductors (L1+L2+N)\n    const feederSizing = autoSizeGauge(totalCurrentA, ambientC, 3, false, '#10 AWG');"

if old1 in content:
    content = content.replace(old1, new1)
    print("Fix 1 applied: COMBINER_TO_DISCO feeder CCC 2 -> 3")
else:
    print("Fix 1 NOT FOUND - checking for variant...")
    # Try to find it
    idx = content.find("autoSizeGauge(totalCurrentA, ambientC, 2, false, '#10 AWG')")
    if idx >= 0:
        print(f"  Found at index {idx}, context: {repr(content[idx-100:idx+80])}")

# Fix 2: Line 700 - DISCO_TO_METER (common downstream) - change 2 to 3 CCC
# This is in the common downstream section
old2 = "  const acCurrentA = input.acOutputCurrentA;\n  const feederSizing = autoSizeGauge(acCurrentA, ambientC, 2, false, '#10 AWG');"
new2 = "  const acCurrentA = input.acOutputCurrentA;\n  // NEC 200.3: neutral required for 120/240V split-phase interconnection; 3 current-carrying conductors (L1+L2+N)\n  const feederSizing = autoSizeGauge(acCurrentA, ambientC, 3, false, '#10 AWG');"

if old2 in content:
    content = content.replace(old2, new2)
    print("Fix 2 applied: DISCO_TO_METER feeder CCC 2 -> 3")
else:
    print("Fix 2 NOT FOUND - checking for variant...")
    idx = content.find("autoSizeGauge(acCurrentA, ambientC, 2, false, '#10 AWG')")
    if idx >= 0:
        print(f"  Found at index {idx}, context: {repr(content[idx-200:idx+80])}")

with open('lib/segment-schedule.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")