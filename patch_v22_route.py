#!/usr/bin/env python3
"""
BUILD v22 patch: Wire battery/generator/ATS fields through app/api/engineering/sld/route.ts
"""

with open('app/api/engineering/sld/route.ts', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"Route file loaded: {len(src)} chars")

# Find the hasBattery line and add the new fields after batteryKwh
old_battery_block = """      hasBattery:              !!(body.hasBattery || body.batteryModel || body.batteryKwh),
      batteryModel:            String(body.batteryModel            ?? ''),
      batteryKwh:              Number(body.batteryKwh)             || 0,
      scale:                   String(body.scale                   ?? 'NOT TO SCALE'),"""

new_battery_block = """      hasBattery:              !!(body.hasBattery || body.batteryModel || body.batteryKwh),
      batteryModel:            String(body.batteryModel            ?? ''),
      batteryKwh:              Number(body.batteryKwh)             || 0,
      batteryBackfeedA:        Number(body.batteryBackfeedA)       || undefined,
      generatorBrand:          body.generatorBrand  ? String(body.generatorBrand)  : undefined,
      generatorModel:          body.generatorModel  ? String(body.generatorModel)  : undefined,
      generatorKw:             body.generatorKw     ? Number(body.generatorKw)     : undefined,
      atsBrand:                body.atsBrand        ? String(body.atsBrand)        : undefined,
      atsModel:                body.atsModel        ? String(body.atsModel)        : undefined,
      atsAmpRating:            body.atsAmpRating    ? Number(body.atsAmpRating)    : undefined,
      hasBackupPanel:          !!(body.hasBackupPanel || body.backupPanelBrand),
      backupPanelAmps:         body.backupPanelAmps  ? Number(body.backupPanelAmps)  : undefined,
      backupPanelBrand:        body.backupPanelBrand ? String(body.backupPanelBrand) : undefined,
      scale:                   String(body.scale                   ?? 'NOT TO SCALE'),"""

assert old_battery_block in src, "Battery block not found in route.ts"
src = src.replace(old_battery_block, new_battery_block, 1)
print("OK: Battery/generator/ATS fields wired through route.ts")

with open('app/api/engineering/sld/route.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"Route file updated: {len(src)} chars")