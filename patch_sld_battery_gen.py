import re

with open('lib/sld-renderer.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the battery section and replace it
old_battery = '''  if (input.batteryBrand && (input.batteryCount ?? 0) > 0) {
    const batX = cx + 200;
    const totalKwh = (input.batteryCount ?? 0) * (input.batteryKwh ?? 0);
    parts.push(symBattery(batX, yMSP - 80, input.batteryBrand, totalKwh));
    parts.push(line(batX - 40, yMSP - 80, cx + 40, yMSP - 80, { stroke: C.ac, strokeW: 2, dash: \'8,4\' }));
  }'''

new_battery_and_gen = '''  if (input.batteryBrand && (input.batteryCount ?? 0) > 0) {
    const batX = cx + 220;
    const totalKwh = (input.batteryCount ?? 0) * (input.batteryKwh ?? 0);
    parts.push(symBattery(batX, yMSP - 80, input.batteryBrand, totalKwh, input.batteryBackfeedA));
    // Dashed AC line from battery to MSP bus
    parts.push(line(batX - 45, yMSP - 80, cx + 80, yMSP - 80, { stroke: C.ac, strokeW: 2, dash: \'8,4\' }));
    parts.push(line(cx + 80, yMSP - 80, cx + 80, yMSP, { stroke: C.ac, strokeW: 2, dash: \'8,4\' }));
    // Battery backfeed breaker label
    if (input.batteryBackfeedA && input.batteryBackfeedA > 0) {
      parts.push(symBreaker(batX - 80, yMSP - 80, input.batteryBackfeedA, \'BATT\\\\nBREAKER\', \'#6A1B9A\'));
    }
  }

  // \u2500\u2500 Generator + ATS (if present) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (input.generatorBrand && input.generatorKw) {
    const genX = cx - 240;
    const genY = yMSP + 60;
    const atsY = yMSP + 20;

    // Generator symbol
    parts.push(symGenerator(genX, genY, input.generatorBrand, input.generatorKw));

    // ATS symbol (between generator and MSP)
    if (input.atsBrand && input.atsAmpRating) {
      parts.push(symATS(genX, atsY - 60, input.atsBrand, input.atsAmpRating, true));
      // Wire: generator \u2192 ATS
      parts.push(line(genX, genY - 28, genX, atsY - 60 + 26, { stroke: \'#2E7D32\', strokeW: 2 }));
      // Wire: ATS \u2192 MSP
      parts.push(line(genX + 50, atsY - 60, cx - 80, yMSP, { stroke: \'#E65100\', strokeW: 2, dash: \'6,3\' }));
      parts.push(text(genX + 10, atsY - 90, \'STANDBY POWER\', { size: F.tiny, weight: \'bold\', fill: \'#E65100\' }));
      parts.push(text(genX + 10, atsY - 76, \'NEC 702.5 \u00b7 Transfer Switch\', { size: F.tiny, fill: C.textLight }));
    } else {
      // No ATS \u2014 direct generator connection note
      parts.push(line(genX, genY - 28, cx - 80, yMSP, { stroke: \'#2E7D32\', strokeW: 2, dash: \'6,3\' }));
    }
  }'''

if old_battery in content:
    content = content.replace(old_battery, new_battery_and_gen)
    print("SUCCESS: Battery section replaced and generator/ATS section added")
else:
    print("ERROR: Could not find battery section")
    # Show what's around line 621
    lines = content.split('\n')
    for i, line in enumerate(lines[618:630], start=619):
        print(f"{i}: {repr(line)}")

with open('lib/sld-renderer.ts', 'w', encoding='utf-8') as f:
    f.write(content)