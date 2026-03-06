#!/usr/bin/env python3
"""
BUILD v24 renderer patch - Step 5 (NODE 9) and Step 6 (120% rule).
Uses line-number based replacement to avoid unicode anchor issues.
"""

with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Loaded: {len(lines)} lines")

# ─── Find NODE 9 block boundaries ─────────────────────────────────────────────
node9_start = None
node9_end = None
for i, line in enumerate(lines):
    if 'NODE 9: GENERATOR + GENERATOR ATS' in line:
        node9_start = i
    if node9_start is not None and i > node9_start:
        # End of block: the closing brace of the if block followed by NODE 7 comment
        if 'NODE 7:' in line or 'NODE 7 ' in line:
            node9_end = i
            break

if node9_start is None:
    print("ERROR: NODE 9 start not found")
    exit(1)
if node9_end is None:
    print("ERROR: NODE 9 end not found")
    exit(1)

print(f"NODE 9 block: lines {node9_start+1} to {node9_end} (0-indexed: {node9_start} to {node9_end-1})")
print(f"  Start: {repr(lines[node9_start][:80])}")
print(f"  End:   {repr(lines[node9_end][:80])}")

# The new NODE 9 block to insert
new_node9_block = '''  // ─── NODE 9: GENERATOR + ATS/BUI GEN PORT (if configured) ──────────────────
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

      // Wire: Generator output → BUI GEN port (L-shaped route)
      const genWireX = genResult.rx + 20;
      const buiGenY  = BUS_Y + 60;
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
      parts.push(txt(genCX, genCY + 55, 'NEC 702.5 \u2014 TRANSFER FUNCTION IN IQ SC3', {sz: F.tiny, anc: 'middle', italic: true, fill: '#2E7D32'}));
      parts.push(txt(genCX, genCY + 63, 'NEC 250.30 \u2014 FLOATING NEUTRAL AT IQ SC3', {sz: F.tiny, anc: 'middle', italic: true, fill: '#2E7D32'}));

    } else {
      // ── Mode B: Standalone ATS — between utility meter and MSP ───────────────
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
            ? [`${atsToMspRun.wireGauge} THWN-2`, 'ATS \u2192 MSP']
            : ['SEE COMPUTED SCHEDULE', 'ATS \u2192 MSP']);
      parts.push(tspan(atsLoadX + 6, genAtsCY - 20, atsCalloutLines, {sz: F.tiny, anc: 'start', fill: '#E65100'}));

      // NEC notes
      parts.push(txt(genAtsCX, genAtsCY + 55, 'NEC 702.5 \u2014 TRANSFER EQUIPMENT REQUIRED', {sz: F.tiny, anc: 'middle', italic: true, fill: '#E65100'}));
      parts.push(txt(genAtsCX, genAtsCY + 63, 'NEC 250.30 \u2014 FLOATING NEUTRAL AT ATS', {sz: F.tiny, anc: 'middle', italic: true, fill: '#E65100'}));
    }
  }

'''

# Replace lines node9_start through node9_end (exclusive — keep node9_end line)
new_lines = lines[:node9_start] + [new_node9_block] + lines[node9_end:]
print(f"Replaced {node9_end - node9_start} lines with new NODE 9 block")

# ─── Find and fix 120% rule ────────────────────────────────────────────────────
# Find the isLoadSide ternary in acRows
load_side_start = None
load_side_end = None
for i, line in enumerate(new_lines):
    if '...(isLoadSide ? [' in line and 'Interconnection' not in line:
        load_side_start = i
    elif load_side_start is not None and '...(isLoadSide ? [' in line:
        # Second occurrence — this is the one in acRows
        load_side_start = i
    if load_side_start is not None and i > load_side_start:
        if '] : isSupplySide ? [' in line:
            load_side_end = i
            break

if load_side_start is None or load_side_end is None:
    print(f"WARNING: 120% rule block not found (start={load_side_start}, end={load_side_end})")
    print("Searching for isLoadSide...")
    for i, line in enumerate(new_lines):
        if 'isLoadSide' in line:
            print(f"  L{i+1}: {repr(line[:100])}")
else:
    print(f"120% rule block: lines {load_side_start+1} to {load_side_end+1}")
    # Show the block
    for i in range(load_side_start, load_side_end+1):
        print(f"  L{i+1}: {repr(new_lines[i][:100])}")

    # New 120% rule block
    new_120_block = '''    ...(isLoadSide ? (() => {
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
        ['120% Rule',`${_120pass ? 'PASS \u2713':'FAIL \u2717'}`],
      ];
      return _rows;
    })() : isSupplySide ? [
'''
    # Replace from load_side_start to load_side_end (inclusive of the '] : isSupplySide ? [' line)
    new_lines = new_lines[:load_side_start] + [new_120_block] + new_lines[load_side_end+1:]
    print(f"Replaced 120% rule block ({load_side_end - load_side_start + 1} lines)")

with open('lib/sld-professional-renderer.ts', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f"\nALL DONE — sld-professional-renderer.ts: {len(new_lines)} lines")