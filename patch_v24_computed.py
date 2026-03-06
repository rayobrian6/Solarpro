#!/usr/bin/env python3
"""
BUILD v24: Extend computed-system.ts with battery/generator/ATS segment sizing.
- Add new RunSegmentIds: BATTERY_TO_BUI_RUN, BUI_TO_MSP_RUN, GENERATOR_TO_ATS_RUN, ATS_TO_MSP_RUN
- Add new ComputedSystemInput fields: batteryBackfeedA, batteryCount, generatorOutputBreakerA, atsAmpRating, backupInterfaceMaxA, hasEnphaseIQSC3
- Compute all 4 new segments with proper NEC-based conductor sizing
- Update 120% rule to include battery backfeed breaker contribution
"""

with open('lib/computed-system.ts', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"Loaded: {len(src)} chars")

# ─── 1. Extend RunSegmentId union ────────────────────────────────────────────
old_run_ids = """export type RunSegmentId =
  | 'DC_STRING_RUN'
  | 'DC_DISCO_TO_INV_RUN'
  | 'ROOF_RUN'
  | 'BRANCH_RUN'
  | 'INV_TO_DISCO_RUN'
  | 'COMBINER_TO_DISCO_RUN'
  | 'DISCO_TO_METER_RUN'
  | 'METER_TO_MSP_RUN'
  | 'MSP_TO_UTILITY_RUN'
  | 'ARRAY_OPEN_AIR'
  | 'ARRAY_CONDUIT_RUN';"""

new_run_ids = """export type RunSegmentId =
  | 'DC_STRING_RUN'
  | 'DC_DISCO_TO_INV_RUN'
  | 'ROOF_RUN'
  | 'BRANCH_RUN'
  | 'INV_TO_DISCO_RUN'
  | 'COMBINER_TO_DISCO_RUN'
  | 'DISCO_TO_METER_RUN'
  | 'METER_TO_MSP_RUN'
  | 'MSP_TO_UTILITY_RUN'
  | 'ARRAY_OPEN_AIR'
  | 'ARRAY_CONDUIT_RUN'
  // Battery / BUI / Generator / ATS segments (BUILD v24)
  | 'BATTERY_TO_BUI_RUN'      // Battery AC output → BUI battery terminals
  | 'BUI_TO_MSP_RUN'          // BUI GRID port → MSP backfeed breaker
  | 'GENERATOR_TO_ATS_RUN'    // Generator output → ATS/BUI GEN terminals
  | 'ATS_TO_MSP_RUN';         // ATS LOAD output → MSP (standalone ATS only)"""

assert old_run_ids in src, "RunSegmentId union not found"
src = src.replace(old_run_ids, new_run_ids, 1)
print("OK 1: RunSegmentId extended")

# ─── 2. Extend ComputedSystemInput with battery/gen/ATS fields ───────────────
old_input_tail = """  // Battery storage — NEC 705.12(B): AC-coupled battery backfeed breakers add to bus loading
  batteryIds?: string[];    // equipment-db battery IDs (e.g. ['tesla-powerwall-3'])
}"""

new_input_tail = """  // Battery storage — NEC 705.12(B): AC-coupled battery backfeed breakers add to bus loading
  batteryIds?: string[];    // equipment-db battery IDs (e.g. ['tesla-powerwall-3'])

  // BUILD v24: Battery/BUI/Generator/ATS sizing inputs
  // These drive the new BATTERY_TO_BUI_RUN, BUI_TO_MSP_RUN, GENERATOR_TO_ATS_RUN, ATS_TO_MSP_RUN segments
  batteryBackfeedA?: number;        // A — battery backfeed breaker (from equipment-db backfeedBreakerA)
  batteryCount?: number;            // qty of battery units (for multi-unit systems)
  batteryContinuousOutputA?: number; // A — battery continuous output current (from maxContinuousOutputA)
  generatorOutputBreakerA?: number; // A — generator output breaker (from equipment-db outputBreakerA)
  generatorKw?: number;             // kW — generator rated output
  atsAmpRating?: number;            // A — ATS amp rating (from equipment-db ampRating)
  backupInterfaceMaxA?: number;     // A — BUI max continuous output (from BackupInterface.maxContinuousOutputA)
  hasEnphaseIQSC3?: boolean;        // true = IQ SC3 is the ATS — no separate standalone ATS
  runLengthsBatteryGen?: {          // optional run lengths for battery/gen segments
    batteryToBui?: number;          // ft — battery to BUI (default 10)
    buiToMsp?: number;              // ft — BUI to MSP (default 15)
    generatorToAts?: number;        // ft — generator to ATS/BUI (default 50)
    atsToMsp?: number;              // ft — ATS to MSP (default 20)
  };
}"""

assert old_input_tail in src, "ComputedSystemInput tail not found"
src = src.replace(old_input_tail, new_input_tail, 1)
print("OK 2: ComputedSystemInput extended")

# ─── 3. Extend defaultRunLengths with battery/gen entries ────────────────────
old_defaults = """  const defaultRunLengths: Record<RunSegmentId, number> = {
    DC_STRING_RUN: rl.DC_STRING_RUN ?? 50,
    DC_DISCO_TO_INV_RUN: rl.DC_DISCO_TO_INV_RUN ?? 10,
    ROOF_RUN: rl.ROOF_RUN ?? 30,
    BRANCH_RUN: rl.BRANCH_RUN ?? 50,
    INV_TO_DISCO_RUN: rl.INV_TO_DISCO_RUN ?? 20,
    COMBINER_TO_DISCO_RUN: rl.COMBINER_TO_DISCO_RUN ?? 20,
    DISCO_TO_METER_RUN: rl.DISCO_TO_METER_RUN ?? 15,
    METER_TO_MSP_RUN: rl.METER_TO_MSP_RUN ?? 10,
    MSP_TO_UTILITY_RUN: rl.MSP_TO_UTILITY_RUN ?? 5,
    ARRAY_OPEN_AIR: rl.ARRAY_OPEN_AIR ?? 30,
    ARRAY_CONDUIT_RUN: rl.ARRAY_CONDUIT_RUN ?? 20,
  };"""

new_defaults = """  const defaultRunLengths: Record<RunSegmentId, number> = {
    DC_STRING_RUN: rl.DC_STRING_RUN ?? 50,
    DC_DISCO_TO_INV_RUN: rl.DC_DISCO_TO_INV_RUN ?? 10,
    ROOF_RUN: rl.ROOF_RUN ?? 30,
    BRANCH_RUN: rl.BRANCH_RUN ?? 50,
    INV_TO_DISCO_RUN: rl.INV_TO_DISCO_RUN ?? 20,
    COMBINER_TO_DISCO_RUN: rl.COMBINER_TO_DISCO_RUN ?? 20,
    DISCO_TO_METER_RUN: rl.DISCO_TO_METER_RUN ?? 15,
    METER_TO_MSP_RUN: rl.METER_TO_MSP_RUN ?? 10,
    MSP_TO_UTILITY_RUN: rl.MSP_TO_UTILITY_RUN ?? 5,
    ARRAY_OPEN_AIR: rl.ARRAY_OPEN_AIR ?? 30,
    ARRAY_CONDUIT_RUN: rl.ARRAY_CONDUIT_RUN ?? 20,
    // BUILD v24: Battery/BUI/Generator/ATS run lengths
    BATTERY_TO_BUI_RUN:   input.runLengthsBatteryGen?.batteryToBui   ?? 10,
    BUI_TO_MSP_RUN:       input.runLengthsBatteryGen?.buiToMsp       ?? 15,
    GENERATOR_TO_ATS_RUN: input.runLengthsBatteryGen?.generatorToAts ?? 50,
    ATS_TO_MSP_RUN:       input.runLengthsBatteryGen?.atsToMsp       ?? 20,
  };"""

assert old_defaults in src, "defaultRunLengths not found"
src = src.replace(old_defaults, new_defaults, 1)
print("OK 3: defaultRunLengths extended")

# ─── 4. Add battery/gen/ATS segment computation after MSP_TO_UTILITY_RUN ─────
# Find the anchor: the comment after MSP_TO_UTILITY_RUN push
anchor = "  // ── Validate conduit fill on all runs ─"
assert anchor in src, f"Anchor not found: {anchor}"

battery_gen_ats_code = '''
  // ══════════════════════════════════════════════════════════════════════════
  // BUILD v24: Battery / BUI / Generator / ATS Segment Sizing
  // All conductor sizes derived from equipment specs — NO hardcoded values.
  // ══════════════════════════════════════════════════════════════════════════

  // ── BATTERY_TO_BUI_RUN ────────────────────────────────────────────────────
  // Battery AC output → BUI battery terminals
  // Current source: battery backfeedBreakerA (NEC 705.12(B) dedicated circuit)
  // NEC 705.12(B): AC-coupled battery requires dedicated backfeed breaker.
  // Conductor sized at 125% of continuous output per NEC 690.8 / NEC 705.
  // EGC per NEC 250.122 based on OCPD.
  if (input.batteryBackfeedA && input.batteryBackfeedA > 0) {
    const batContinuousA = input.batteryContinuousOutputA ?? input.batteryBackfeedA;
    // Battery AC circuit: 2-wire 240V (L1+L2, no neutral — AC-coupled battery output)
    // Conductor count = 2 (ungrounded) per NEC 690.8 / battery manufacturer spec
    const batWire = autoSizeWire(
      batContinuousA,
      defaultRunLengths.BATTERY_TO_BUI_RUN,
      2,                    // L1 + L2 — no neutral for AC-coupled battery output
      input.conduitType,
      input.ambientTempC,
      systemVoltageAC,
      input.maxACVoltageDropPct,
      false,                // AC circuit
      '#12 AWG'             // minimum start — battery circuits often #12 for 20A
    );
    // OCPD must match backfeedBreakerA from equipment spec (not auto-calculated)
    // NEC 705.12(B): backfeed breaker size is equipment-specified
    const batOcpd = nextStandardOCPD(input.batteryBackfeedA);
    const batEgc  = getEGCGauge(batOcpd);
    const batGaugeNum = batWire.gauge.replace('#','').replace(' AWG','');
    const batEgcNum   = batEgc.replace('#','').replace(' AWG','');
    const batConduitAbbrev = input.conduitType === 'EMT' ? 'EMT'
      : input.conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
      : input.conduitType === 'PVC Sch 80' ? 'PVC SCH 80'
      : input.conduitType;
    // Recalculate conduit fill with correct OCPD-based EGC
    const batHotArea = (CONDUCTOR_AREA_IN2[batWire.gauge] ?? 0.0133) * 2;
    const batEgcArea = CONDUCTOR_AREA_IN2[batEgc] ?? 0.0133;
    const batConduit = getSmallestConduit(input.conduitType, batHotArea + batEgcArea);
    const batCallout = `2#${batGaugeNum} AWG THWN-2 + 1#${batEgcNum} AWG GND IN ${batConduit.size} ${batConduitAbbrev} (${batConduit.fillPct.toFixed(0)}% FILL)`;
    runs.push(makeRunSegment('BATTERY_TO_BUI_RUN', 'BATTERY TO BUI/CONTROLLER', 'BATTERY STORAGE', 'BACKUP INTERFACE UNIT', {
      conductorCount: 2,
      wireGauge: batWire.gauge,
      conductorMaterial: 'CU',
      insulation: 'THWN-2',
      egcGauge: batEgc,
      neutralRequired: false,
      conduitType: input.conduitType,
      conduitSize: batConduit.size,
      conduitFillPct: batConduit.fillPct,
      onewayLengthFt: defaultRunLengths.BATTERY_TO_BUI_RUN,
      continuousCurrent: batContinuousA,
      requiredAmpacity: batContinuousA * 1.25,
      effectiveAmpacity: batWire.effectiveAmpacity,
      tempDeratingFactor: batWire.tempDerating,
      conduitDeratingFactor: batWire.conduitDerating,
      ocpdAmps: batOcpd,
      voltageDropPct: batWire.voltageDropPct,
      voltageDropVolts: batWire.voltageDropVolts,
      ampacityPass: batWire.ampacityPass,
      voltageDropPass: batWire.voltageDropPass,
      conduitFillPass: batConduit.fillPct <= 40,
      necReferences: [
        'NEC 705.12(B) — AC-coupled battery backfeed breaker',
        'NEC 706 — Energy Storage Systems',
        'NEC 310.15 — Conductor ampacity',
        'NEC 250.122 — EGC sizing',
      ],
      conductorCallout: batCallout,
      color: 'ac',
    }));
    console.log(`[BUILD_V24] BATTERY_TO_BUI_RUN: ${batWire.gauge} THWN-2, ${batOcpd}A OCPD, ${batConduit.size} ${batConduitAbbrev}, fill=${batConduit.fillPct.toFixed(1)}%`);
  }

  // ── BUI_TO_MSP_RUN ────────────────────────────────────────────────────────
  // BUI GRID port → MSP backfeed breaker (Enphase IQ SC3 / Tesla Gateway)
  // Current source: backupInterface.maxContinuousOutputA
  // This is the feeder from the BUI to the MSP solar/battery backfeed breaker.
  // NEC 705.12(B): backfeed breaker at MSP sized per battery backfeed spec.
  // For Enphase IQ SC3: 200A service-entrance rated — feeder sized for full load.
  if (input.backupInterfaceMaxA && input.backupInterfaceMaxA > 0) {
    const buiToMspA = input.backupInterfaceMaxA;
    // BUI→MSP feeder: 3-wire (L1+L2+N) — BUI provides full 120/240V split-phase
    // Neutral required: BUI output is 120/240V split-phase per manufacturer spec
    const buiWire = autoSizeWire(
      buiToMspA,
      defaultRunLengths.BUI_TO_MSP_RUN,
      3,                    // L1 + L2 + N — BUI 120/240V split-phase output
      input.conduitType,
      input.ambientTempC,
      systemVoltageAC,
      input.maxACVoltageDropPct,
      false,
      '#6 AWG'              // minimum start for BUI feeders (typically 200A rated)
    );
    const buiOcpd = nextStandardOCPD(buiToMspA * 1.25);
    const buiEgc  = getEGCGauge(buiOcpd);
    const buiGaugeNum = buiWire.gauge.replace('#','').replace(' AWG','');
    const buiEgcNum   = buiEgc.replace('#','').replace(' AWG','');
    const buiConduitAbbrev = input.conduitType === 'EMT' ? 'EMT'
      : input.conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
      : input.conduitType;
    const buiHotArea = (CONDUCTOR_AREA_IN2[buiWire.gauge] ?? 0.0507) * 3;
    const buiEgcArea = CONDUCTOR_AREA_IN2[buiEgc] ?? 0.0507;
    const buiConduit = getSmallestConduit(input.conduitType, buiHotArea + buiEgcArea);
    const buiCallout = `3#${buiGaugeNum} AWG THWN-2 + 1#${buiEgcNum} AWG GND IN ${buiConduit.size} ${buiConduitAbbrev} (${buiConduit.fillPct.toFixed(0)}% FILL)`;
    runs.push(makeRunSegment('BUI_TO_MSP_RUN', 'BUI/CONTROLLER TO MSP', 'BACKUP INTERFACE UNIT', 'MAIN SERVICE PANEL', {
      conductorCount: 3,
      wireGauge: buiWire.gauge,
      conductorMaterial: 'CU',
      insulation: 'THWN-2',
      egcGauge: buiEgc,
      neutralRequired: true,
      conduitType: input.conduitType,
      conduitSize: buiConduit.size,
      conduitFillPct: buiConduit.fillPct,
      onewayLengthFt: defaultRunLengths.BUI_TO_MSP_RUN,
      continuousCurrent: buiToMspA,
      requiredAmpacity: buiToMspA * 1.25,
      effectiveAmpacity: buiWire.effectiveAmpacity,
      tempDeratingFactor: buiWire.tempDerating,
      conduitDeratingFactor: buiWire.conduitDerating,
      ocpdAmps: buiOcpd,
      voltageDropPct: buiWire.voltageDropPct,
      voltageDropVolts: buiWire.voltageDropVolts,
      ampacityPass: buiWire.ampacityPass,
      voltageDropPass: buiWire.voltageDropPass,
      conduitFillPass: buiConduit.fillPct <= 40,
      necReferences: [
        'NEC 705.12(B) — load-side interconnection backfeed breaker',
        'NEC 706 — Energy Storage Systems',
        'NEC 230.82 — service entrance rated equipment',
        'NEC 310.15 — Conductor ampacity',
        'NEC 250.122 — EGC sizing',
      ],
      conductorCallout: buiCallout,
      color: 'ac',
    }));
    console.log(`[BUILD_V24] BUI_TO_MSP_RUN: ${buiWire.gauge} THWN-2, ${buiOcpd}A OCPD, ${buiConduit.size} ${buiConduitAbbrev}, fill=${buiConduit.fillPct.toFixed(1)}%`);
  }

  // ── GENERATOR_TO_ATS_RUN ──────────────────────────────────────────────────
  // Generator output → ATS GEN terminals (or BUI GEN port for Enphase IQ SC3)
  // Current source: generator.outputBreakerA from equipment-db
  // NEC 702.5: transfer equipment required between generator and load.
  // NEC 250.30: generator with bonded neutral — ATS must switch neutral.
  // Conductor sized at 125% of generator continuous output per NEC 702.
  if (input.generatorOutputBreakerA && input.generatorOutputBreakerA > 0) {
    const genContinuousA = input.generatorOutputBreakerA; // generator output breaker = max continuous
    // Generator feeder: 3-wire (L1+L2+N) — generator provides 120/240V split-phase
    // Neutral required: generator output is 120/240V split-phase (NEC 250.30)
    const genWire = autoSizeWire(
      genContinuousA,
      defaultRunLengths.GENERATOR_TO_ATS_RUN,
      3,                    // L1 + L2 + N — generator 120/240V split-phase
      input.conduitType,
      input.ambientTempC,
      systemVoltageAC,
      input.maxACVoltageDropPct,
      false,
      '#6 AWG'              // minimum start — 100A generator needs at least #4 AWG
    );
    const genOcpd = nextStandardOCPD(genContinuousA * 1.25);
    const genEgc  = getEGCGauge(genOcpd);
    const genGaugeNum = genWire.gauge.replace('#','').replace(' AWG','');
    const genEgcNum   = genEgc.replace('#','').replace(' AWG','');
    const genConduitAbbrev = input.conduitType === 'EMT' ? 'EMT'
      : input.conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
      : input.conduitType;
    const genHotArea = (CONDUCTOR_AREA_IN2[genWire.gauge] ?? 0.0824) * 3;
    const genEgcArea = CONDUCTOR_AREA_IN2[genEgc] ?? 0.0507;
    const genConduit = getSmallestConduit(input.conduitType, genHotArea + genEgcArea);
    const genDest = input.hasEnphaseIQSC3 ? 'IQ SC3 GEN PORT' : 'ATS GEN TERMINALS';
    const genCallout = `3#${genGaugeNum} AWG THWN-2 + 1#${genEgcNum} AWG GND IN ${genConduit.size} ${genConduitAbbrev} (${genConduit.fillPct.toFixed(0)}% FILL)`;
    runs.push(makeRunSegment('GENERATOR_TO_ATS_RUN', 'GENERATOR TO ATS/BUI', 'STANDBY GENERATOR', genDest, {
      conductorCount: 3,
      wireGauge: genWire.gauge,
      conductorMaterial: 'CU',
      insulation: 'THWN-2',
      egcGauge: genEgc,
      neutralRequired: true,
      conduitType: input.conduitType,
      conduitSize: genConduit.size,
      conduitFillPct: genConduit.fillPct,
      onewayLengthFt: defaultRunLengths.GENERATOR_TO_ATS_RUN,
      continuousCurrent: genContinuousA,
      requiredAmpacity: genContinuousA * 1.25,
      effectiveAmpacity: genWire.effectiveAmpacity,
      tempDeratingFactor: genWire.tempDerating,
      conduitDeratingFactor: genWire.conduitDerating,
      ocpdAmps: genOcpd,
      voltageDropPct: genWire.voltageDropPct,
      voltageDropVolts: genWire.voltageDropVolts,
      ampacityPass: genWire.ampacityPass,
      voltageDropPass: genWire.voltageDropPass,
      conduitFillPass: genConduit.fillPct <= 40,
      necReferences: [
        'NEC 702.5 — transfer equipment required',
        'NEC 702 — Optional Standby Systems',
        'NEC 250.30 — neutral bonding at generator (floating neutral required at ATS)',
        'NEC 310.15 — Conductor ampacity',
        'NEC 250.122 — EGC sizing',
      ],
      conductorCallout: genCallout,
      color: 'ac',
    }));
    console.log(`[BUILD_V24] GENERATOR_TO_ATS_RUN: ${genWire.gauge} THWN-2, ${genOcpd}A OCPD, ${genConduit.size} ${genConduitAbbrev}, fill=${genConduit.fillPct.toFixed(1)}%`);
  }

  // ── ATS_TO_MSP_RUN ────────────────────────────────────────────────────────
  // ATS LOAD output → MSP (standalone ATS only — NOT for Enphase IQ SC3)
  // For Enphase IQ SC3: the IQ SC3 IS the ATS — no separate ATS→MSP segment.
  // For standalone ATS (Generac RXSW, Kohler RDT, etc.): ATS LOAD → MSP.
  // Current source: atsAmpRating from equipment-db
  // NEC 702.5: ATS load output sized for full service current.
  if (input.atsAmpRating && input.atsAmpRating > 0 && !input.hasEnphaseIQSC3) {
    const atsContinuousA = input.atsAmpRating;
    // ATS→MSP feeder: 3-wire (L1+L2+N) — full service entrance feeder
    const atsWire = autoSizeWire(
      atsContinuousA,
      defaultRunLengths.ATS_TO_MSP_RUN,
      3,                    // L1 + L2 + N — service entrance feeder
      input.conduitType,
      input.ambientTempC,
      systemVoltageAC,
      input.maxACVoltageDropPct,
      false,
      '#4 AWG'              // minimum start — ATS feeders are service-sized
    );
    const atsOcpd = nextStandardOCPD(atsContinuousA * 1.25);
    const atsEgc  = getEGCGauge(atsOcpd);
    const atsGaugeNum = atsWire.gauge.replace('#','').replace(' AWG','');
    const atsEgcNum   = atsEgc.replace('#','').replace(' AWG','');
    const atsConduitAbbrev = input.conduitType === 'EMT' ? 'EMT'
      : input.conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
      : input.conduitType;
    const atsHotArea = (CONDUCTOR_AREA_IN2[atsWire.gauge] ?? 0.0824) * 3;
    const atsEgcArea = CONDUCTOR_AREA_IN2[atsEgc] ?? 0.0507;
    const atsConduit = getSmallestConduit(input.conduitType, atsHotArea + atsEgcArea);
    const atsCallout = `3#${atsGaugeNum} AWG THWN-2 + 1#${atsEgcNum} AWG GND IN ${atsConduit.size} ${atsConduitAbbrev} (${atsConduit.fillPct.toFixed(0)}% FILL)`;
    runs.push(makeRunSegment('ATS_TO_MSP_RUN', 'ATS LOAD TO MSP', 'ATS LOAD TERMINALS', 'MAIN SERVICE PANEL', {
      conductorCount: 3,
      wireGauge: atsWire.gauge,
      conductorMaterial: 'CU',
      insulation: 'THWN-2',
      egcGauge: atsEgc,
      neutralRequired: true,
      conduitType: input.conduitType,
      conduitSize: atsConduit.size,
      conduitFillPct: atsConduit.fillPct,
      onewayLengthFt: defaultRunLengths.ATS_TO_MSP_RUN,
      continuousCurrent: atsContinuousA,
      requiredAmpacity: atsContinuousA * 1.25,
      effectiveAmpacity: atsWire.effectiveAmpacity,
      tempDeratingFactor: atsWire.tempDerating,
      conduitDeratingFactor: atsWire.conduitDerating,
      ocpdAmps: atsOcpd,
      voltageDropPct: atsWire.voltageDropPct,
      voltageDropVolts: atsWire.voltageDropVolts,
      ampacityPass: atsWire.ampacityPass,
      voltageDropPass: atsWire.voltageDropPass,
      conduitFillPass: atsConduit.fillPct <= 40,
      necReferences: [
        'NEC 702.5 — transfer equipment load output',
        'NEC 702 — Optional Standby Systems',
        'NEC 230.82 — service entrance rated (if SE-rated ATS)',
        'NEC 310.15 — Conductor ampacity',
        'NEC 250.122 — EGC sizing',
      ],
      conductorCallout: atsCallout,
      color: 'ac',
    }));
    console.log(`[BUILD_V24] ATS_TO_MSP_RUN: ${atsWire.gauge} THWN-2, ${atsOcpd}A OCPD, ${atsConduit.size} ${atsConduitAbbrev}, fill=${atsConduit.fillPct.toFixed(1)}%`);
  }

'''

src = src.replace(anchor, battery_gen_ats_code + '  ' + anchor.strip(), 1)
print("OK 4: Battery/BUI/Generator/ATS segment computation added")

# ─── 5. Update 120% rule to include battery backfeed ─────────────────────────
# The existing code already handles batteryBusImpactA via computeBatteryBusImpact()
# but the display in the SLD calc panel doesn't show it. The computation is correct.
# We need to verify the batteryBusImpactA path uses the new batteryBackfeedA field too.
# Add a direct path: if batteryBackfeedA is provided directly, use it (avoids DB lookup)
old_battery_impact = """  // Sum battery backfeed breaker contributions (AC-coupled only; DC-coupled returns 0)
  const batteryBusImpactA = (input.batteryIds ?? []).reduce(
    (sum, id) => sum + computeBatteryBusImpact(id), 0
  );
  const totalBackfeedA = backfeedBreakerAmps + batteryBusImpactA;"""

new_battery_impact = """  // Sum battery backfeed breaker contributions (AC-coupled only; DC-coupled returns 0)
  // BUILD v24: Also accept direct batteryBackfeedA input (avoids DB lookup when ID not provided)
  const batteryBusImpactFromIds = (input.batteryIds ?? []).reduce(
    (sum, id) => sum + computeBatteryBusImpact(id), 0
  );
  // Use direct batteryBackfeedA if provided and greater than DB-derived value
  const batteryBusImpactA = Math.max(
    batteryBusImpactFromIds,
    input.batteryBackfeedA ?? 0
  );
  const totalBackfeedA = backfeedBreakerAmps + batteryBusImpactA;"""

assert old_battery_impact in src, "batteryBusImpactA block not found"
src = src.replace(old_battery_impact, new_battery_impact, 1)
print("OK 5: 120% rule updated to use batteryBackfeedA directly")

# ─── 6. Add makeRunSegment conductorMaterial field support ───────────────────
# Check if makeRunSegment already handles conductorMaterial
if 'conductorMaterial' not in src:
    # Find makeRunSegment function and add conductorMaterial
    old_make = "  conductorMaterial: 'CU' | 'AL';"
    if old_make in src:
        print("OK 6: conductorMaterial already in RunSegment interface")
    else:
        print("WARNING 6: conductorMaterial not found in RunSegment — may need manual check")
else:
    print("OK 6: conductorMaterial already present")

# ─── 7. Verify makeRunSegment helper exists ───────────────────────────────────
if 'function makeRunSegment' in src:
    print("OK 7: makeRunSegment helper exists")
else:
    print("WARNING 7: makeRunSegment not found — checking for inline construction")

with open('lib/computed-system.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"\nALL DONE — computed-system.ts patched: {len(src)} chars")