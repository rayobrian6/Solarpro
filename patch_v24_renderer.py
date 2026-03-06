#!/usr/bin/env python3
"""
BUILD v24: Update sld-professional-renderer.ts
1. Add hasEnphaseIQSC3 to SLDProfessionalInput interface
2. Add findRun lookups for BATTERY_TO_BUI_RUN, BUI_TO_MSP_RUN, GENERATOR_TO_ATS_RUN, ATS_TO_MSP_RUN
3. Replace hardcoded battery wire label with computed conductorCallout
4. Replace hardcoded generator wire label with computed conductorCallout
5. Replace hardcoded ATS→MSP wire label with computed conductorCallout
6. Replace hardcoded backup panel wire label with computed conductorCallout
7. Fix duplicate ATS: if hasEnphaseIQSC3, suppress standalone renderATS() and route gen to BUI GEN port
8. Update 120% rule to include battery backfeed contribution
"""

with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"Loaded: {len(src)} chars")

# ─── 1. Add hasEnphaseIQSC3 to SLDProfessionalInput ───────────────────────────
old_interface_tail = """  backupInterfaceId?:      string;
  backupInterfaceBrand?:   string;
  backupInterfaceModel?:   string;
  backupInterfaceIsATS?:   boolean;
  scale:                   string;"""

new_interface_tail = """  backupInterfaceId?:      string;
  backupInterfaceBrand?:   string;
  backupInterfaceModel?:   string;
  backupInterfaceIsATS?:   boolean;
  // BUILD v24: IQ SC3 IS the ATS — suppress standalone renderATS() when true
  hasEnphaseIQSC3?:        boolean;
  scale:                   string;"""

assert old_interface_tail in src, "SLDProfessionalInput tail not found"
src = src.replace(old_interface_tail, new_interface_tail, 1)
print("OK 1: hasEnphaseIQSC3 added to SLDProfessionalInput")

# ─── 2. Add findRun lookups for new segments after existing findRun calls ──────
old_find_runs = """  const branchRun     = findRun('BRANCH_RUN');"""

new_find_runs = """  const branchRun     = findRun('BRANCH_RUN');
  // BUILD v24: Battery/BUI/Generator/ATS computed segments
  const batToBuiRun   = findRun('BATTERY_TO_BUI_RUN');
  const buiToMspRun   = findRun('BUI_TO_MSP_RUN');
  const genToAtsRun   = findRun('GENERATOR_TO_ATS_RUN');
  const atsToMspRun   = findRun('ATS_TO_MSP_RUN');"""

assert old_find_runs in src, "branchRun findRun not found"
src = src.replace(old_find_runs, new_find_runs, 1)
print("OK 2: findRun lookups added for new segments")

# ─── 3. Replace hardcoded battery wire label ──────────────────────────────────
old_bat_wire = """    const batWireGauge = bfA <= 20 ? '#12 AWG THWN-2' : bfA <= 30 ? '#10 AWG THWN-2' : '#8 AWG THWN-2';
    parts.push(tspan(batCX + 8, batCY + (buiResult.batPortY - batResult.by)/2,
      [batWireGauge, `${bfA}A CIRCUIT`],
      {sz: F.tiny, anc: 'start', fill: '#1565C0'}));"""

new_bat_wire = """    // BUILD v24: Use computed conductorCallout from BATTERY_TO_BUI_RUN (NEC-sized)
    // Fallback to legacy hardcoded gauge only if segment not computed
    const batWireGauge = batToBuiRun?.wireGauge
      ? `${batToBuiRun.wireGauge} THWN-2`
      : (bfA <= 20 ? '#12 AWG THWN-2' : bfA <= 30 ? '#10 AWG THWN-2' : '#8 AWG THWN-2');
    const batCalloutLines = batToBuiRun?.conductorCallout
      ? batToBuiRun.conductorCallout.split('\\n').filter((l:string)=>l.trim()).slice(0,2)
      : [batWireGauge, `${bfA}A CIRCUIT`];
    parts.push(tspan(batCX + 8, batCY + (buiResult.batPortY - batResult.by)/2,
      batCalloutLines,
      {sz: F.tiny, anc: 'start', fill: '#1565C0'}));"""

assert old_bat_wire in src, "battery wire label not found"
src = src.replace(old_bat_wire, new_bat_wire, 1)
print("OK 3: battery wire label replaced with computed conductorCallout")

# ─── 4. Replace hardcoded backup panel wire label ─────────────────────────────
old_bp_wire = """      parts.push(tspan(bpCX - 40 + 6, bpCY - 10, ['#6 AWG THWN-2', 'CRITICAL LOADS'], {sz: F.tiny, anc: 'start', fill: '#6A1B9A'}));"""

new_bp_wire = """      // BUILD v24: Use computed BUI_TO_MSP_RUN conductorCallout for backup panel feeder
      const bpCalloutLines = buiToMspRun?.conductorCallout
        ? buiToMspRun.conductorCallout.split('\\n').filter((l:string)=>l.trim()).slice(0,2)
        : ['#6 AWG THWN-2', 'CRITICAL LOADS'];
      parts.push(tspan(bpCX - 40 + 6, bpCY - 10, bpCalloutLines, {sz: F.tiny, anc: 'start', fill: '#6A1B9A'}));"""

assert old_bp_wire in src, "backup panel wire label not found"
src = src.replace(old_bp_wire, new_bp_wire, 1)
print("OK 4: backup panel wire label replaced with computed conductorCallout")

# ─── 5. Fix NODE 9: Generator + ATS — full replacement ────────────────────────
# Replace the entire NODE 9 block with corrected logic:
# - If hasEnphaseIQSC3: generator connects to BUI GEN port (no standalone ATS)
# - If standalone ATS: generator → ATS → MSP with computed wire labels
old_node9 = """  // ─── NODE 9: GENERATOR + GENERATOR ATS (if configured) ──────────────────────
  // Generator ATS positioned between utility meter and MSP (service entrance)
  // Generator positioned below and left of the ATS
  if ((input.generatorKw ?? 0) > 0) {
    // Generator ATS ─ between utility meter and MSP, below the bus
    const genAtsCX = (xMSP + xUtil) / 2;
    const genAtsCY = BUS_Y + 140;
    const genAtsResult = renderATS(
      genAtsCX, genAtsCY,
      input.atsBrand ?? '',
      input.atsModel ?? '',
      input.atsAmpRating ?? 200,
      isMicro ? 10 : 11
    );
    parts.push(genAtsResult.svg);

    // Generator ─ below and left of ATS
    const genCX = genAtsCX - 160;
    const genCY = BUS_Y + 140;
    const genResult = renderGenerator(
      genCX, genCY,
      input.generatorBrand ?? '',
      input.generatorModel ?? '',
      input.generatorKw!,
      isMicro ? 11 : 12
    );
    parts.push(genResult.svg);

    // Generator → ATS GEN input (horizontal wire)
    parts.push(ln(genResult.rx, genCY, genAtsResult.lx, genAtsCY, {stroke: '#2E7D32', sw: SW_MED}));
    const genAtsLabelX = (genResult.rx + genAtsResult.lx) / 2;
    parts.push(tspan(genAtsLabelX, genCY - 10, ['#6 AWG THWN-2', 'GEN OUTPUT'], {sz: F.tiny, anc: 'middle', fill: '#2E7D32'}));

    // Utility → ATS NORM input (vertical drop from bus)
    const utilDropX = genAtsCX - 44;
    parts.push(ln(utilDropX, BUS_Y + 36, utilDropX, genAtsCY, {stroke: BLK, sw: SW_MED}));
    parts.push(txt(utilDropX - 4, (BUS_Y + 36 + genAtsCY) / 2, 'UTILITY', {sz: F.tiny, anc: 'end', fill: '#444'}));

    // ATS LOAD output → MSP (vertical rise back to bus)
    const atsLoadX = genAtsCX + 55;
    parts.push(ln(atsLoadX, genAtsCY, atsLoadX, BUS_Y + 36, {stroke: '#E65100', sw: SW_MED}));
    parts.push(tspan(atsLoadX + 6, genAtsCY - 20, ['#4 AWG THWN-2', 'ATS → MSP'], {sz: F.tiny, anc: 'start', fill: '#E65100'}));

    // NEC 702.5 note
    parts.push(txt(genAtsCX, genAtsCY + 55, 'NEC 702.5 — TRANSFER EQUIPMENT REQUIRED', {sz: F.tiny, anc: 'middle', italic: true, fill: '#E65100'}));
  }"""

new_node9 = """  // ─── NODE 9: GENERATOR + ATS/BUI GEN PORT (if configured) ──────────────────
  // BUILD v24: Two routing modes:
  //   A) hasEnphaseIQSC3 = true  → Generator connects to BUI GEN port (IQ SC3 IS the ATS)
  //      No standalone ATS rendered. NEC 702.5 transfer function is inside IQ SC3.
  //   B) hasEnphaseIQSC3 = false → Standalone ATS between utility and MSP (legacy topology)
  //      Generator → ATS GEN terminals → ATS LOAD → MSP
  // All wire labels from computed segments (NEC-sized) — no hardcoded gauges.
  if ((input.generatorKw ?? 0) > 0) {
    // Determine if IQ SC3 is the ATS (no separate ATS box needed)
    const _isIQSC3 = !!(input.hasEnphaseIQSC3 || input.backupInterfaceIsATS ||
      String(input.backupInterfaceId ?? '').toLowerCase().includes('iq-sc3') ||
      String(input.backupInterfaceId ?? '').toLowerCase().includes('iq-system-controller'));

    if (_isIQSC3) {
      // ── Mode A: Enphase IQ SC3 — generator connects to BUI GEN port ──────────
      // Generator positioned below and left of BUI (which is already rendered in NODE 8)
      // Wire: Generator output → BUI GEN port (diagonal/L-shaped route)
      const genCX = (buiRX ?? (xMSP + 130)) - 160;
      const genCY = BUS_Y + 160;
      const genResult = renderGenerator(
        genCX, genCY,
        input.generatorBrand ?? '',
        input.generatorModel ?? '',
        input.generatorKw!,
        isMicro ? 10 : 11
      );
      parts.push(genResult.svg);

      // Wire: Generator output → BUI GEN port
      // BUI GEN port is at buiResult.genPortX, buiResult.genPortY (if available)
      // Route: horizontal from gen right edge, then vertical up to BUI GEN port
      const genWireX = genResult.rx + 20;
      const buiGenY  = BUS_Y + 60; // approximate BUI GEN port Y
      parts.push(ln(genResult.rx, genCY, genWireX, genCY, {stroke: '#2E7D32', sw: SW_MED}));
      parts.push(ln(genWireX, genCY, genWireX, buiGenY, {stroke: '#2E7D32', sw: SW_MED}));

      // Wire callout — use computed GENERATOR_TO_ATS_RUN conductorCallout
      const genCalloutLines = genToAtsRun?.conductorCallout
        ? genToAtsRun.conductorCallout.split('\\n').filter((l:string)=>l.trim()).slice(0,2)
        : (genToAtsRun?.wireGauge
            ? [`${genToAtsRun.wireGauge} THWN-2`, `${genToAtsRun.ocpdAmps ?? ''}A OCPD`]
            : ['SEE COMPUTED SCHEDULE', 'GEN → IQ SC3 GEN PORT']);
      parts.push(tspan(genWireX + 4, genCY - 10, genCalloutLines, {sz: F.tiny, anc: 'start', fill: '#2E7D32'}));

      // NEC notes
      parts.push(txt(genCX, genCY + 55, 'NEC 702.5 — TRANSFER FUNCTION IN IQ SC3', {sz: F.tiny, anc: 'middle', italic: true, fill: '#2E7D32'}));
      parts.push(txt(genCX, genCY + 63, 'NEC 250.30 — FLOATING NEUTRAL AT IQ SC3', {sz: F.tiny, anc: 'middle', italic: true, fill: '#2E7D32'}));

    } else {
      // ── Mode B: Standalone ATS — between utility meter and MSP ───────────────
      // ATS positioned between utility meter and MSP, below the bus
      const genAtsCX = (xMSP + xUtil) / 2;
      const genAtsCY = BUS_Y + 140;
      const genAtsResult = renderATS(
        genAtsCX, genAtsCY,
        input.atsBrand ?? '',
        input.atsModel ?? '',
        input.atsAmpRating ?? 200,
        isMicro ? 10 : 11
      );
      parts.push(genAtsResult.svg);

      // Generator — below and left of ATS
      const genCX = genAtsCX - 160;
      const genCY = BUS_Y + 140;
      const genResult = renderGenerator(
        genCX, genCY,
        input.generatorBrand ?? '',
        input.generatorModel ?? '',
        input.generatorKw!,
        isMicro ? 11 : 12
      );
      parts.push(genResult.svg);

      // Generator → ATS GEN input (horizontal wire)
      parts.push(ln(genResult.rx, genCY, genAtsResult.lx, genAtsCY, {stroke: '#2E7D32', sw: SW_MED}));
      const genAtsLabelX = (genResult.rx + genAtsResult.lx) / 2;
      // BUILD v24: Use computed GENERATOR_TO_ATS_RUN conductorCallout
      const genCalloutLines = genToAtsRun?.conductorCallout
        ? genToAtsRun.conductorCallout.split('\\n').filter((l:string)=>l.trim()).slice(0,2)
        : (genToAtsRun?.wireGauge
            ? [`${genToAtsRun.wireGauge} THWN-2`, 'GEN OUTPUT']
            : ['SEE COMPUTED SCHEDULE', 'GEN OUTPUT']);
      parts.push(tspan(genAtsLabelX, genCY - 10, genCalloutLines, {sz: F.tiny, anc: 'middle', fill: '#2E7D32'}));

      // Utility → ATS NORM input (vertical drop from bus)
      const utilDropX = genAtsCX - 44;
      parts.push(ln(utilDropX, BUS_Y + 36, utilDropX, genAtsCY, {stroke: BLK, sw: SW_MED}));
      parts.push(txt(utilDropX - 4, (BUS_Y + 36 + genAtsCY) / 2, 'UTILITY', {sz: F.tiny, anc: 'end', fill: '#444'}));

      // ATS LOAD output → MSP (vertical rise back to bus)
      const atsLoadX = genAtsCX + 55;
      parts.push(ln(atsLoadX, genAtsCY, atsLoadX, BUS_Y + 36, {stroke: '#E65100', sw: SW_MED}));
      // BUILD v24: Use computed ATS_TO_MSP_RUN conductorCallout
      const atsCalloutLines = atsToMspRun?.conductorCallout
        ? atsToMspRun.conductorCallout.split('\\n').filter((l:string)=>l.trim()).slice(0,2)
        : (atsToMspRun?.wireGauge
            ? [`${atsToMspRun.wireGauge} THWN-2`, 'ATS → MSP']
            : ['SEE COMPUTED SCHEDULE', 'ATS → MSP']);
      parts.push(tspan(atsLoadX + 6, genAtsCY - 20, atsCalloutLines, {sz: F.tiny, anc: 'start', fill: '#E65100'}));

      // NEC 702.5 note
      parts.push(txt(genAtsCX, genAtsCY + 55, 'NEC 702.5 — TRANSFER EQUIPMENT REQUIRED', {sz: F.tiny, anc: 'middle', italic: true, fill: '#E65100'}));
      parts.push(txt(genAtsCX, genAtsCY + 63, 'NEC 250.30 — FLOATING NEUTRAL AT ATS', {sz: F.tiny, anc: 'middle', italic: true, fill: '#E65100'}));
    }
  }"""

assert old_node9 in src, "NODE 9 block not found"
src = src.replace(old_node9, new_node9, 1)
print("OK 5: NODE 9 generator/ATS block replaced with dual-mode routing")

# ─── 6. Update 120% rule to include battery backfeed ─────────────────────────
# The load-side 120% rule currently only checks pvBreakerAmps vs mainPanelAmps
# NEC 705.12(B): ALL backfeed breakers (PV + battery) must sum ≤ 120% of bus
old_120_rule = """    ...(isLoadSide ? [
      ['Interconnection','Load Side Tap'] as [string,string],
      ['NEC Reference','NEC 705.12(B)'] as [string,string],
      ['PV Breaker',`${pvBreakerAmps} A`] as [string,string],
      ['120% Rule',`${input.mainPanelAmps*1.2 >= input.mainPanelAmps+pvBreakerAmps ? 'PASS ✓':'FAIL ✗'}`] as [string,string],
    ] : isSupplySide ? ["""

new_120_rule = """    ...(isLoadSide ? (() => {
      // BUILD v24: NEC 705.12(B) — ALL backfeed breakers must sum ≤ 120% of bus rating
      // Total backfeed = PV backfeed breaker + battery backfeed breaker(s)
      const _batBfA = input.batteryBackfeedA ?? 0;
      const _totalBfA = pvBreakerAmps + _batBfA;
      const _busLimit = input.mainPanelAmps * 1.2;
      const _120pass = _busLimit >= input.mainPanelAmps + _totalBfA;
      const _rows: [string,string][] = [
        ['Interconnection','Load Side Tap'],
        ['NEC Reference','NEC 705.12(B)'],
        ['PV Breaker',`${pvBreakerAmps} A`],
        ...(_batBfA > 0 ? [['Batt. Backfeed Bkr',`${_batBfA} A`] as [string,string]] : []),
        ['Total Backfeed',`${_totalBfA} A`],
        ['Bus 120% Limit',`${_busLimit.toFixed(0)} A`],
        ['120% Rule',`${_120pass ? 'PASS ✓':'FAIL ✗'}`],
      ];
      return _rows;
    })() : isSupplySide ? ["""

assert old_120_rule in src, "120% rule load-side block not found"
src = src.replace(old_120_rule, new_120_rule, 1)
print("OK 6: 120% rule updated to include battery backfeed")

# Fix the closing bracket — the old code had `] : isSupplySide` but new has `])() : isSupplySide`
# We need to close the ternary properly — find the end of the isLoadSide block
old_120_close = """    ] : isSupplySide ? [
      ['Interconnection','Supply Side Tap'] as [string,string],"""

new_120_close = """    ] : isSupplySide ? [
      ['Interconnection','Supply Side Tap'] as [string,string],"""

# The new code already has the right structure — the IIFE returns the array
# We just need to make sure the ternary chain closes correctly
# Check if the old closing bracket pattern still exists after our replacement
if old_120_close in src:
    print("OK 6b: ternary chain closing bracket OK")
else:
    # The replacement changed the structure — find and fix
    print("WARNING 6b: need to check ternary chain closing")

with open('lib/sld-professional-renderer.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"\nALL DONE — sld-professional-renderer.ts patched: {len(src)} chars")