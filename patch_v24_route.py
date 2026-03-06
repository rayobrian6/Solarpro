#!/usr/bin/env python3
"""
BUILD v24: Update route.ts to pass battery/gen/ATS fields to computeSystem().
- Import getBackupInterfaceById, getBatterySystemById, getGeneratorSystemById from equipment-db
- Derive hasEnphaseIQSC3, generatorOutputBreakerA, backupInterfaceMaxA, batteryContinuousOutputA
- Add all new fields to csInput
"""

with open('app/api/engineering/sld/route.ts', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"Loaded: {len(src)} chars")

# --- 1. Add equipment-db imports ---
old_import = """import {
  generateStringConfig,
  moduleSpecsFromRegistry,
  inverterSpecsFromRegistry,
} from '@/lib/string-generator';"""

new_import = """import {
  generateStringConfig,
  moduleSpecsFromRegistry,
  inverterSpecsFromRegistry,
} from '@/lib/string-generator';
import {
  getBackupInterfaceById,
  getBatterySystemById,
  getGeneratorSystemById,
} from '@/lib/equipment-db';"""

assert old_import in src, "string-generator import not found"
src = src.replace(old_import, new_import, 1)
print("OK 1: equipment-db imports added")

# --- 2. Add equipment-db lookups before csInput construction ---
old_cs_comment = """        // ── Compute RunSegments via computeSystem() ──────────────────────────────────
    // This is the single source of truth for conductor bundles, conduit sizing,
    // fill percentages, and all electrical data shown on the SLD.
    let computedRuns: ReturnType<typeof computeSystem>['runs'] | undefined;
    try {
      const csInput: ComputedSystemInput = {"""

# Try alternate spacing
if old_cs_comment not in src:
    # Find the actual text
    idx = src.find("let computedRuns: ReturnType<typeof computeSystem>")
    if idx >= 0:
        # Find the start of the try block
        try_idx = src.rfind("try {", 0, idx)
        comment_idx = src.rfind("//", 0, try_idx)
        print(f"  Found computedRuns at {idx}, try at {try_idx}, comment at {comment_idx}")
        # Show context
        print(repr(src[comment_idx:comment_idx+300]))
    else:
        print("ERROR: computedRuns not found at all")

# Use a simpler anchor - just the try block start
old_try_anchor = """    let computedRuns: ReturnType<typeof computeSystem>['runs'] | undefined;
    try {
      const csInput: ComputedSystemInput = {"""

new_try_anchor = """    let computedRuns: ReturnType<typeof computeSystem>['runs'] | undefined;

    // BUILD v24: Look up equipment specs for battery/gen/ATS conductor sizing
    // These are used to populate the new csInput fields for NEC-based segment sizing.
    const _buiId = body.backupInterfaceId ? String(body.backupInterfaceId) : undefined;
    const _buiSpec = _buiId ? getBackupInterfaceById(_buiId) : undefined;
    const _batId = body.batteryId ? String(body.batteryId) : undefined;
    const _batSpec = _batId ? getBatterySystemById(_batId) : undefined;
    const _genId = body.generatorId ? String(body.generatorId) : undefined;
    const _genSpec = _genId ? getGeneratorSystemById(_genId) : undefined;

    // Derive hasEnphaseIQSC3: true if BUI model contains 'IQ SC3' or 'IQSC3'
    const _buiModel = String(body.backupInterfaceModel ?? _buiSpec?.model ?? '');
    const _hasEnphaseIQSC3 = _buiModel.toUpperCase().includes('IQ SC3') ||
      _buiModel.toUpperCase().includes('IQSC3') ||
      String(body.backupInterfaceId ?? '').toLowerCase().includes('iq-sc3') ||
      String(body.backupInterfaceId ?? '').toLowerCase().includes('iqsc3');

    // Derive backupInterfaceMaxA: from spec or body override
    const _buiMaxA = _buiSpec?.maxContinuousOutputA ??
      (body.backupInterfaceMaxA ? Number(body.backupInterfaceMaxA) : undefined);

    // Derive batteryBackfeedA and batteryContinuousOutputA: from spec or body
    const _batBackfeedA = _batSpec?.backfeedBreakerA ??
      (body.batteryBackfeedA ? Number(body.batteryBackfeedA) : undefined);
    const _batContinuousA = _batSpec?.maxContinuousOutputA ??
      (body.batteryContinuousOutputA ? Number(body.batteryContinuousOutputA) : undefined);

    // Derive generatorOutputBreakerA: from spec or body override
    // Fallback: estimate from kW (kW / 0.24 for 240V single-phase, rounded up to std OCPD)
    const _genKw = body.generatorKw ? Number(body.generatorKw) : (_genSpec?.ratedKw ?? 0);
    const _genOutputBreakerA = _genSpec?.outputBreakerA ??
      (body.generatorOutputBreakerA ? Number(body.generatorOutputBreakerA) :
        (_genKw > 0 ? Math.ceil((_genKw * 1000 / 240) * 1.25 / 5) * 5 : undefined));

    // Derive atsAmpRating: from body or default to mainPanelAmps
    const _atsAmpRating = body.atsAmpRating ? Number(body.atsAmpRating) :
      (body.mainPanelAmps ? Number(body.mainPanelAmps) : undefined);

    try {
      const csInput: ComputedSystemInput = {"""

assert old_try_anchor in src, "try block anchor not found"
src = src.replace(old_try_anchor, new_try_anchor, 1)
print("OK 2: equipment-db lookups added before csInput")

# --- 3. Add new fields to csInput (after maxDCVoltageDropPct line) ---
old_cs_tail = """        maxACVoltageDropPct:           Number(body.maxACVoltageDropPct ?? 2),
        maxDCVoltageDropPct:           Number(body.maxDCVoltageDropPct ?? 3),
      };"""

new_cs_tail = """        maxACVoltageDropPct:           Number(body.maxACVoltageDropPct ?? 2),
        maxDCVoltageDropPct:           Number(body.maxDCVoltageDropPct ?? 3),

        // BUILD v24: Battery/BUI/Generator/ATS segment sizing inputs
        batteryBackfeedA:              _batBackfeedA,
        batteryContinuousOutputA:      _batContinuousA,
        batteryIds:                    _batId ? [_batId] : (body.batteryIds ?? undefined),
        generatorOutputBreakerA:       _genOutputBreakerA,
        generatorKw:                   _genKw > 0 ? _genKw : undefined,
        atsAmpRating:                  _atsAmpRating,
        backupInterfaceMaxA:           _buiMaxA,
        hasEnphaseIQSC3:               _hasEnphaseIQSC3 || undefined,
        runLengthsBatteryGen:          body.runLengthsBatteryGen ?? undefined,
      };"""

assert old_cs_tail in src, "csInput tail not found"
src = src.replace(old_cs_tail, new_cs_tail, 1)
print("OK 3: new fields added to csInput")

with open('app/api/engineering/sld/route.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"\nALL DONE — route.ts patched: {len(src)} chars")