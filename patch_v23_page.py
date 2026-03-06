#!/usr/bin/env python3
"""
BUILD v23 Phase 1: Fix data flow in app/engineering/page.tsx
- Add backupInterfaceId to ProjectConfig interface and defaultProject
- Add all missing fields to SLD POST body
"""

with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"page.tsx loaded: {len(src)} chars")

# ─── 1. Add backupInterfaceId to ProjectConfig interface ──────────────────────
old_config_ids = "  batteryId: string;        // equipment-db battery ID — drives NEC 705.12(B) bus impact calc\n  generatorId: string;      // equipment-db generator ID\n  atsId: string;            // equipment-db ATS ID"
new_config_ids = "  batteryId: string;        // equipment-db battery ID — drives NEC 705.12(B) bus impact calc\n  generatorId: string;      // equipment-db generator ID\n  atsId: string;            // equipment-db ATS ID\n  backupInterfaceId: string; // equipment-db backup interface ID (Enphase IQ SC3, Tesla Gateway, etc.)"

assert old_config_ids in src, "Config interface IDs not found"
src = src.replace(old_config_ids, new_config_ids, 1)
print("OK Step 1a: backupInterfaceId added to ProjectConfig interface")

# ─── 2. Add backupInterfaceId to defaultProject ───────────────────────────────
old_default = "  batteryId: '', generatorId: '', atsId: '',"
new_default  = "  batteryId: '', generatorId: '', atsId: '', backupInterfaceId: '',"

assert old_default in src, "defaultProject IDs not found"
src = src.replace(old_default, new_default, 1)
print("OK Step 1b: backupInterfaceId added to defaultProject")

# ─── 3. Add missing fields to SLD POST body ───────────────────────────────────
old_battery_post = "          batteryModel:   config.batteryBrand ? `${config.batteryBrand} ${config.batteryModel}` : undefined,\n          batteryKwh:     config.batteryKwh * config.batteryCount || undefined,"

new_battery_post = """          batteryModel:   config.batteryBrand ? `${config.batteryBrand} ${config.batteryModel}` : undefined,
          batteryKwh:     config.batteryKwh * config.batteryCount || undefined,
          // Battery backfeed breaker (NEC 705.12(B)) — from equipment-db
          batteryBackfeedA: config.batteryId
            ? (() => { const b = getBatteryById(config.batteryId); return b?.backfeedBreakerA ?? 0; })()
            : undefined,
          // Generator fields
          generatorBrand: config.generatorId
            ? (() => { const g = getGeneratorById(config.generatorId); return g?.manufacturer ?? undefined; })()
            : undefined,
          generatorModel: config.generatorId
            ? (() => { const g = getGeneratorById(config.generatorId); return g?.model ?? undefined; })()
            : undefined,
          generatorKw: config.generatorId
            ? (() => { const g = getGeneratorById(config.generatorId); return g?.ratedOutputKw ?? undefined; })()
            : undefined,
          // ATS fields
          atsBrand: config.atsId
            ? (() => { const a = getATSById(config.atsId); return a?.manufacturer ?? undefined; })()
            : undefined,
          atsModel: config.atsId
            ? (() => { const a = getATSById(config.atsId); return a?.model ?? undefined; })()
            : undefined,
          atsAmpRating: config.atsId
            ? (() => { const a = getATSById(config.atsId); return a?.ampRating ?? undefined; })()
            : undefined,
          // Backup interface (Enphase IQ SC3, Tesla Gateway, etc.)
          backupInterfaceId:    config.backupInterfaceId || undefined,
          backupInterfaceBrand: config.backupInterfaceId
            ? (() => { const bi = getBackupInterfaceById(config.backupInterfaceId); return bi?.manufacturer ?? undefined; })()
            : undefined,
          backupInterfaceModel: config.backupInterfaceId
            ? (() => { const bi = getBackupInterfaceById(config.backupInterfaceId); return bi?.model ?? undefined; })()
            : undefined,
          backupInterfaceIsATS: config.backupInterfaceId
            ? (() => { const bi = getBackupInterfaceById(config.backupInterfaceId); return bi?.islandingCapable ?? false; })()
            : false,
          // Backup panel
          hasBackupPanel:    !!(config.backupInterfaceId),
          backupPanelAmps:   100,
          backupPanelBrand:  config.backupInterfaceId
            ? (() => { const bi = getBackupInterfaceById(config.backupInterfaceId); return bi?.manufacturer ?? undefined; })()
            : undefined,"""

assert old_battery_post in src, "Battery post body not found"
src = src.replace(old_battery_post, new_battery_post, 1)
print("OK Step 1c: All missing fields added to SLD POST body")

# ─── 4. Auto-select backupInterfaceId when battery is selected ────────────────
# Find the battery selection handler and add auto-selection of backup interface
old_bat_select = """                      const bat = getBatteryById(e.target.value);
                        batteryId: e.target.value,
                        batteryBrand: bat?.manufacturer ?? '',
                        batteryModel: bat?.model ?? '',
                        batteryKwh: bat?.usableCapacityKwh ?? 0,"""

new_bat_select = """                      const bat = getBatteryById(e.target.value);
                      const compatBI = e.target.value ? getCompatibleBackupInterfaces(e.target.value) : [];
                      const autoBI = compatBI[0]?.id ?? '';
                        batteryId: e.target.value,
                        batteryBrand: bat?.manufacturer ?? '',
                        batteryModel: bat?.model ?? '',
                        batteryKwh: bat?.usableCapacityKwh ?? 0,
                        backupInterfaceId: autoBI,"""

if old_bat_select in src:
    src = src.replace(old_bat_select, new_bat_select, 1)
    print("OK Step 1d: Auto-select backupInterfaceId when battery selected")
else:
    print("WARNING: Battery select handler not found with exact match — skipping auto-select")

# ─── Write ────────────────────────────────────────────────────────────────────
with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"\nALL DONE - page.tsx patched: {len(src)} chars")