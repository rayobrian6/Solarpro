#!/usr/bin/env python3
"""Final verification of all BUILD v24 changes."""

print("=" * 70)
print("BUILD v24 FINAL VERIFICATION")
print("=" * 70)

all_pass = True

def check(label, condition, detail=""):
    global all_pass
    status = "PASS" if condition else "FAIL"
    if not condition:
        all_pass = False
    print(f"  [{status}] {label}" + (f" — {detail}" if detail else ""))
    return condition

# ─── computed-system.ts ───────────────────────────────────────────────────────
print("\n[computed-system.ts]")
with open('lib/computed-system.ts', 'r', encoding='utf-8') as f:
    cs = f.read()

check("RunSegmentId: BATTERY_TO_BUI_RUN", "BATTERY_TO_BUI_RUN" in cs)
check("RunSegmentId: BUI_TO_MSP_RUN", "BUI_TO_MSP_RUN" in cs)
check("RunSegmentId: GENERATOR_TO_ATS_RUN", "GENERATOR_TO_ATS_RUN" in cs)
check("RunSegmentId: ATS_TO_MSP_RUN", "ATS_TO_MSP_RUN" in cs)
check("ComputedSystemInput: batteryBackfeedA", "batteryBackfeedA?" in cs)
check("ComputedSystemInput: batteryContinuousOutputA", "batteryContinuousOutputA?" in cs)
check("ComputedSystemInput: generatorOutputBreakerA", "generatorOutputBreakerA?" in cs)
check("ComputedSystemInput: atsAmpRating", "atsAmpRating?" in cs)
check("ComputedSystemInput: backupInterfaceMaxA", "backupInterfaceMaxA?" in cs)
check("ComputedSystemInput: hasEnphaseIQSC3", "hasEnphaseIQSC3?" in cs)
check("ComputedSystemInput: runLengthsBatteryGen", "runLengthsBatteryGen?" in cs)
check("defaultRunLengths: BATTERY_TO_BUI_RUN entry", "BATTERY_TO_BUI_RUN:   input.runLengthsBatteryGen" in cs)
check("defaultRunLengths: GENERATOR_TO_ATS_RUN entry", "GENERATOR_TO_ATS_RUN: input.runLengthsBatteryGen" in cs)
check("Segment computation: BATTERY_TO_BUI_RUN", "makeRunSegment('BATTERY_TO_BUI_RUN'" in cs)
check("Segment computation: BUI_TO_MSP_RUN", "makeRunSegment('BUI_TO_MSP_RUN'" in cs)
check("Segment computation: GENERATOR_TO_ATS_RUN", "makeRunSegment('GENERATOR_TO_ATS_RUN'" in cs)
check("Segment computation: ATS_TO_MSP_RUN", "makeRunSegment('ATS_TO_MSP_RUN'" in cs)
check("120% rule: batteryBusImpactFromIds", "batteryBusImpactFromIds" in cs)
check("120% rule: direct batteryBackfeedA path", "input.batteryBackfeedA ?? 0" in cs)
check("NEC 705.12(B) reference", "NEC 705.12(B)" in cs)
check("NEC 702.5 reference", "NEC 702.5" in cs)
check("NEC 250.30 reference", "NEC 250.30" in cs)
check("IQ SC3 GEN PORT label", "IQ SC3 GEN PORT" in cs)
check("No hardcoded #6 AWG in new segments", cs.count("'#6 AWG'") <= 2)  # only in min-start hints
check("File size reasonable", len(cs) > 90000, f"{len(cs)} chars")

# ─── route.ts ─────────────────────────────────────────────────────────────────
print("\n[route.ts]")
with open('app/api/engineering/sld/route.ts', 'r', encoding='utf-8') as f:
    rt = f.read()

check("Import: getBatteryById", "getBatteryById" in rt)
check("Import: getGeneratorById", "getGeneratorById" in rt)
check("Import: getBackupInterfaceById", "getBackupInterfaceById" in rt)
check("Equipment lookups: _buiSpec", "_buiSpec" in rt)
check("Equipment lookups: _batSpec", "_batSpec" in rt)
check("Equipment lookups: _genSpec", "_genSpec" in rt)
check("hasEnphaseIQSC3 detection", "_hasEnphaseIQSC3" in rt)
check("IQ SC3 ID detection", "enphase-iq-system-controller-3" in rt)
check("csInput: batteryBackfeedA", "batteryBackfeedA:              _batBackfeedA" in rt)
check("csInput: generatorOutputBreakerA", "generatorOutputBreakerA:       _genOutputBreakerA" in rt)
check("csInput: atsAmpRating", "atsAmpRating:                  _atsAmpRating" in rt)
check("csInput: backupInterfaceMaxA", "backupInterfaceMaxA:           _buiMaxA" in rt)
check("csInput: hasEnphaseIQSC3", "hasEnphaseIQSC3:               _hasEnphaseIQSC3" in rt)
check("SLDInput: hasEnphaseIQSC3", "hasEnphaseIQSC3:         _hasEnphaseIQSC3" in rt)
check("ratedOutputKw (not ratedKw)", "_genSpec?.ratedOutputKw" in rt and "_genSpec?.ratedKw" not in rt)
check("File size reasonable", len(rt) > 20000, f"{len(rt)} chars")

# ─── sld-professional-renderer.ts ─────────────────────────────────────────────
print("\n[sld-professional-renderer.ts]")
with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    rn = f.read()

check("SLDProfessionalInput: hasEnphaseIQSC3", "hasEnphaseIQSC3?:        boolean" in rn)
check("findRun: BATTERY_TO_BUI_RUN", "findRun('BATTERY_TO_BUI_RUN')" in rn)
check("findRun: BUI_TO_MSP_RUN", "findRun('BUI_TO_MSP_RUN')" in rn)
check("findRun: GENERATOR_TO_ATS_RUN", "findRun('GENERATOR_TO_ATS_RUN')" in rn)
check("findRun: ATS_TO_MSP_RUN", "findRun('ATS_TO_MSP_RUN')" in rn)
check("Battery wire: computed conductorCallout", "batToBuiRun?.conductorCallout" in rn)
check("Battery wire: no hardcoded #12/#10/#8 AWG", "bfA <= 20 ? '#12 AWG THWN-2'" not in rn)
check("Backup panel wire: computed conductorCallout", "buiToMspRun?.conductorCallout" in rn)
check("Backup panel wire: no hardcoded #6 AWG CRITICAL LOADS", "'#6 AWG THWN-2', 'CRITICAL LOADS'" not in rn)
check("NODE 9: dual-mode routing", "_isIQSC3" in rn)
check("NODE 9: IQ SC3 mode A", "Mode A: Enphase IQ SC3" in rn)
check("NODE 9: standalone ATS mode B", "Mode B: Standalone ATS" in rn)
check("NODE 9: gen wire computed callout", "genToAtsRun?.conductorCallout" in rn)
check("NODE 9: ATS wire computed callout", "atsToMspRun?.conductorCallout" in rn)
check("NODE 9: no hardcoded #6 AWG GEN OUTPUT", "'#6 AWG THWN-2', 'GEN OUTPUT'" not in rn)
check("NODE 9: no hardcoded #4 AWG ATS MSP", "'#4 AWG THWN-2', 'ATS" not in rn)
check("120% rule: IIFE with battery backfeed", "_batBfA = input.batteryBackfeedA" in rn)
check("120% rule: total backfeed calculation", "_totalBfA = pvBreakerAmps + _batBfA" in rn)
check("120% rule: bus limit display", "_busLimit.toFixed(0)" in rn)
check("NEC 702.5 in renderer", "NEC 702.5" in rn)
check("NEC 250.30 in renderer", "NEC 250.30" in rn)
check("File size reasonable", len(rn) > 80000, f"{len(rn)} chars")

print("\n" + "=" * 70)
print(f"RESULT: {'ALL CHECKS PASSED' if all_pass else 'SOME CHECKS FAILED'}")
print("=" * 70)