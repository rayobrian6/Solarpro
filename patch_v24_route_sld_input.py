#!/usr/bin/env python3
"""Add hasEnphaseIQSC3 to SLDProfessionalInput construction in route.ts."""

with open('app/api/engineering/sld/route.ts', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"Loaded: {len(src)} chars")

old_bui_tail = """      backupInterfaceId:       body.backupInterfaceId   ? String(body.backupInterfaceId)   : undefined,
      backupInterfaceBrand:    body.backupInterfaceBrand ? String(body.backupInterfaceBrand) : undefined,
      backupInterfaceModel:    body.backupInterfaceModel ? String(body.backupInterfaceModel) : undefined,
      backupInterfaceIsATS:    body.backupInterfaceIsATS ? !!(body.backupInterfaceIsATS)    : undefined,
      scale:                   String(body.scale                   ?? 'NOT TO SCALE'),"""

new_bui_tail = """      backupInterfaceId:       body.backupInterfaceId   ? String(body.backupInterfaceId)   : undefined,
      backupInterfaceBrand:    body.backupInterfaceBrand ? String(body.backupInterfaceBrand) : undefined,
      backupInterfaceModel:    body.backupInterfaceModel ? String(body.backupInterfaceModel) : undefined,
      backupInterfaceIsATS:    body.backupInterfaceIsATS ? !!(body.backupInterfaceIsATS)    : undefined,
      // BUILD v24: Pass IQ SC3 flag to renderer for correct generator routing
      hasEnphaseIQSC3:         _hasEnphaseIQSC3 || undefined,
      scale:                   String(body.scale                   ?? 'NOT TO SCALE'),"""

assert old_bui_tail in src, "SLDProfessionalInput backupInterface tail not found"
src = src.replace(old_bui_tail, new_bui_tail, 1)
print("OK 1: hasEnphaseIQSC3 added to SLDProfessionalInput construction")

with open('app/api/engineering/sld/route.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"\nALL DONE — route.ts updated: {len(src)} chars")