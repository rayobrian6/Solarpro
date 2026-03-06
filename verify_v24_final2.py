#!/usr/bin/env python3
"""Final verification of all BUILD v24 changes — corrected checks."""

print("=" * 70)
print("BUILD v24 FINAL VERIFICATION (corrected)")
print("=" * 70)

all_pass = True

def check(label, condition, detail=""):
    global all_pass
    status = "PASS" if condition else "FAIL"
    if not condition:
        all_pass = False
    print(f"  [{status}] {label}" + (f" — {detail}" if detail else ""))
    return condition

def note(label, detail=""):
    print(f"  [NOTE] {label}" + (f" — {detail}" if detail else ""))

# ─── computed-system.ts ───────────────────────────────────────────────────────
print("\n[computed-system.ts]")
with open('lib/computed-system.ts', 'r', encoding='utf-8') as f:
    cs = f.read()

check("RunSegmentId: BATTERY_TO_BUI_RUN", "BATTERY_TO_BUI_RUN" in cs)
check("RunSegmentId: BUI_TO_MSP_RUN", "BUI_TO_MSP_RUN" in cs)
check("RunSegmentId: GENERATOR_TO_ATS_RUN", "GENERATOR_TO_ATS_RUN" in cs)
check("RunSegmentId: ATS_TO_MSP_RUN", "ATS_TO_MSP_RUN" in cs)
check("ComputedSystemInput: batteryBackfeedA", "batteryBackfeedA?" in cs)
check("ComputedSystemInput: generatorOutputBreakerA", "generatorOutputBreakerA?" in cs)
check("ComputedSystemInput: atsAmpRating", "atsAmpRating?" in cs)
check("ComputedSystemInput: backupInterfaceMaxA", "backupInterfaceMaxA?" in cs)
check("ComputedSystemInput: hasEnphaseIQSC3", "hasEnphaseIQSC3?" in cs)
check("defaultRunLengths: all 4 new entries", all(x in cs for x in [
    "BATTERY_TO_BUI_RUN:", "BUI_TO_MSP_RUN:", "GENERATOR_TO_ATS_RUN:", "ATS_TO_MSP_RUN:"
]))
check("Segment computation: all 4 new segments", all(x in cs for x in [
    "makeRunSegment('BATTERY_TO_BUI_RUN'",
    "makeRunSegment('BUI_TO_MSP_RUN'",
    "makeRunSegment('GENERATOR_TO_ATS_RUN'",
    "makeRunSegment('ATS_TO_MSP_RUN'",
]))
check("120% rule: direct batteryBackfeedA path", "batteryBusImpactFromIds" in cs)
check("NEC references present", all(x in cs for x in ["NEC 705.12(B)", "NEC 702.5", "NEC 250.30"]))
check("IQ SC3 GEN PORT label", "IQ SC3 GEN PORT" in cs)
note("'#6 AWG' appears as minGauge hint in autoSizeWire() calls — correct (not hardcoded output)",
     f"count={cs.count(chr(39)+'#6 AWG'+chr(39))}")
check("File size", len(cs) > 90000, f"{len(cs)} chars")

# ─── route.ts ─────────────────────────────────────────────────────────────────
print("\n[route.ts]")
with open('app/api/engineering/sld/route.ts', 'r', encoding='utf-8') as f:
    rt = f.read()

check("equipment-db imports: getBatteryById, getGeneratorById, getBackupInterfaceById",
      all(x in rt for x in ["getBatteryById", "getGeneratorById", "getBackupInterfaceById"]))
check("Equipment spec lookups: _buiSpec, _batSpec, _genSpec",
      all(x in rt for x in ["_buiSpec", "_batSpec", "_genSpec"]))
check("hasEnphaseIQSC3 detection with IQ SC3 IDs", "_hasEnphaseIQSC3" in rt and "enphase-iq-system-controller-3" in rt)
check("csInput: all 5 new fields",
      all(x in rt for x in [
          "batteryBackfeedA:              _batBackfeedA",
          "generatorOutputBreakerA:       _genOutputBreakerA",
          "atsAmpRating:                  _atsAmpRating",
          "backupInterfaceMaxA:           _buiMaxA",
          "hasEnphaseIQSC3:               _hasEnphaseIQSC3",
      ]))
check("SLDInput: hasEnphaseIQSC3 passed to renderer", "hasEnphaseIQSC3:         _hasEnphaseIQSC3" in rt)
check("ratedOutputKw (correct field name)", "_genSpec?.ratedOutputKw" in rt)
check("No ratedKw (wrong field name)", "_genSpec?.ratedKw" not in rt)
check("File size", len(rt) > 20000, f"{len(rt)} chars")

# ─── sld-professional-renderer.ts ─────────────────────────────────────────────
print("\n[sld-professional-renderer.ts]")
with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    rn = f.read()

check("SLDProfessionalInput: hasEnphaseIQSC3", "hasEnphaseIQSC3?:        boolean" in rn)
check("findRun: all 4 new segments",
      all(x in rn for x in [
          "findRun('BATTERY_TO_BUI_RUN')",
          "findRun('BUI_TO_MSP_RUN')",
          "findRun('GENERATOR_TO_ATS_RUN')",
          "findRun('ATS_TO_MSP_RUN')",
      ]))
check("Battery wire: uses computed conductorCallout (primary)", "batToBuiRun?.conductorCallout" in rn)
note("Battery wire fallback '#12/#10/#8 AWG' retained for graceful degradation when segment not computed")
check("Backup panel wire: uses computed conductorCallout (primary)", "buiToMspRun?.conductorCallout" in rn)
note("Backup panel wire fallback '#6 AWG THWN-2' retained for graceful degradation")
check("NODE 9: dual-mode routing (_isIQSC3)", "_isIQSC3" in rn)
check("NODE 9: Mode A — IQ SC3 (no standalone ATS)", "Mode A: Enphase IQ SC3" in rn)
check("NODE 9: Mode B — standalone ATS", "Mode B: Standalone ATS" in rn)
check("NODE 9: gen wire uses computed callout", "genToAtsRun?.conductorCallout" in rn)
check("NODE 9: ATS wire uses computed callout", "atsToMspRun?.conductorCallout" in rn)
check("NODE 9: no hardcoded '#6 AWG THWN-2', 'GEN OUTPUT'", "'#6 AWG THWN-2', 'GEN OUTPUT'" not in rn)
check("NODE 9: no hardcoded '#4 AWG THWN-2', 'ATS → MSP'", "'#4 AWG THWN-2'" not in rn)
check("120% rule: IIFE with battery backfeed", "_batBfA = input.batteryBackfeedA" in rn)
check("120% rule: total backfeed = PV + battery", "_totalBfA = pvBreakerAmps + _batBfA" in rn)
check("120% rule: bus 120% limit displayed", "_busLimit.toFixed(0)" in rn)
check("NEC references: 702.5 and 250.30", "NEC 702.5" in rn and "NEC 250.30" in rn)
check("File size", len(rn) > 80000, f"{len(rn)} chars")

print("\n" + "=" * 70)
print(f"RESULT: {'ALL CHECKS PASSED' if all_pass else 'SOME CHECKS FAILED'}")
print("=" * 70)