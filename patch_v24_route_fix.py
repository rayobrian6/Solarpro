#!/usr/bin/env python3
"""Fix incorrect function names in route.ts import and usage."""

with open('app/api/engineering/sld/route.ts', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"Loaded: {len(src)} chars")

# Fix import names
old_import = """import {
  getBackupInterfaceById,
  getBatterySystemById,
  getGeneratorSystemById,
} from '@/lib/equipment-db';"""

new_import = """import {
  getBackupInterfaceById,
  getBatteryById,
  getGeneratorById,
} from '@/lib/equipment-db';"""

assert old_import in src, "equipment-db import not found"
src = src.replace(old_import, new_import, 1)
print("OK 1: import names fixed")

# Fix usage in lookups
old_usage = """    const _batSpec = _batId ? getBatterySystemById(_batId) : undefined;
    const _genId = body.generatorId ? String(body.generatorId) : undefined;
    const _genSpec = _genId ? getGeneratorSystemById(_genId) : undefined;"""

new_usage = """    const _batSpec = _batId ? getBatteryById(_batId) : undefined;
    const _genId = body.generatorId ? String(body.generatorId) : undefined;
    const _genSpec = _genId ? getGeneratorById(_genId) : undefined;"""

assert old_usage in src, "usage block not found"
src = src.replace(old_usage, new_usage, 1)
print("OK 2: usage names fixed")

with open('app/api/engineering/sld/route.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"\nALL DONE — route.ts fixed: {len(src)} chars")