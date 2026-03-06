#!/usr/bin/env python3
"""Fix hasEnphaseIQSC3 detection to cover both enphase-iq-sc3-ats and enphase-iq-system-controller-3."""

with open('app/api/engineering/sld/route.ts', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"Loaded: {len(src)} chars")

old_detect = """    // Derive hasEnphaseIQSC3: true if BUI model contains 'IQ SC3' or 'IQSC3'
    const _buiModel = String(body.backupInterfaceModel ?? _buiSpec?.model ?? '');
    const _hasEnphaseIQSC3 = _buiModel.toUpperCase().includes('IQ SC3') ||
      _buiModel.toUpperCase().includes('IQSC3') ||
      String(body.backupInterfaceId ?? '').toLowerCase().includes('iq-sc3') ||
      String(body.backupInterfaceId ?? '').toLowerCase().includes('iqsc3');"""

new_detect = """    // Derive hasEnphaseIQSC3: true if BUI/ATS is the Enphase IQ System Controller 3
    // Equipment-db IDs: 'enphase-iq-system-controller-3' (BUI) or 'enphase-iq-sc3-ats' (ATS)
    // The IQ SC3 IS the ATS — no separate standalone ATS needed when this device is present.
    const _buiModel = String(body.backupInterfaceModel ?? _buiSpec?.model ?? '');
    const _buiIdStr = String(body.backupInterfaceId ?? '').toLowerCase();
    const _atsIdStr = String(body.atsId ?? body.atsModel ?? '').toLowerCase();
    const _hasEnphaseIQSC3 =
      _buiIdStr === 'enphase-iq-system-controller-3' ||
      _buiIdStr === 'enphase-iq-sc3-ats' ||
      _atsIdStr.includes('enphase-iq-sc3') ||
      _atsIdStr.includes('enphase-iq-system-controller') ||
      _buiModel.toUpperCase().includes('IQ SYSTEM CONTROLLER 3') ||
      _buiModel.toUpperCase().includes('IQ SC3');"""

assert old_detect in src, "IQ SC3 detection block not found"
src = src.replace(old_detect, new_detect, 1)
print("OK 1: hasEnphaseIQSC3 detection updated")

with open('app/api/engineering/sld/route.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"\nALL DONE — route.ts updated: {len(src)} chars")