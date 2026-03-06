#!/usr/bin/env python3
"""
BUILD v22 patch: Add battery/generator/ATS visual symbols to sld-professional-renderer.ts
Uses line-number based insertion to avoid unicode box-drawing character issues.
"""

with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

src = ''.join(lines)

print(f"File loaded: {len(lines)} lines, {len(src)} chars")

# ─── 1. Extend SLDProfessionalInput interface ─────────────────────────────────
old_interface_tail = "  batteryKwh:              number;\n  scale:                   string;"
new_interface_tail = """  batteryKwh:              number;
  batteryBackfeedA?:       number;
  generatorBrand?:         string;
  generatorModel?:         string;
  generatorKw?:            number;
  atsBrand?:               string;
  atsModel?:               string;
  atsAmpRating?:           number;
  hasBackupPanel?:         boolean;
  backupPanelAmps?:        number;
  backupPanelBrand?:       string;
  scale:                   string;"""

assert old_interface_tail in src, "Interface tail not found"
src = src.replace(old_interface_tail, new_interface_tail, 1)
print("OK Step 1: Interface extended")

# ─── 2. Find line with "Wire Segment with Inline Label" and insert new symbols before it
lines = src.splitlines(keepends=True)
wire_seg_idx = None
for i, line in enumerate(lines):
    if 'Wire Segment with Inline Label' in line:
        wire_seg_idx = i
        break

assert wire_seg_idx is not None, "Wire Segment line not found"
print(f"   Wire Segment line found at line {wire_seg_idx + 1}")

new_symbols = r"""// Battery Storage Symbol (IEEE/ANSI)
// Drawn as a stack of cells (IEC 60617 battery symbol) with AC connection
function renderBattery(
  cx: number, cy: number,
  model: string, kwh: number, backfeedA: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number} {
  const W2 = 88, H2 = 72;
  const bx = cx - W2/2, by2 = cy - H2/2;
  const p: string[] = [];
  const BAT_CLR = '#1565C0';

  p.push(rect(bx, by2, W2, H2, {fill: WHT, stroke: BAT_CLR, sw: SW_MED}));
  p.push(ln(bx, by2+14, bx+W2, by2+14, {stroke: BAT_CLR, sw: SW_THIN}));
  p.push(txt(cx, by2+10, 'BATTERY STORAGE', {sz: 5.5, bold: true, anc: 'middle', fill: BAT_CLR}));

  // Battery cell stack symbol (IEC 60617)
  const cellX = cx - 14;
  const cellY = cy - 4;
  for (let i = 0; i < 3; i++) {
    const lx2 = cellX + i * 7;
    p.push(ln(lx2, cellY - 10, lx2, cellY + 10, {stroke: BAT_CLR, sw: 2.5}));
    if (i < 2) {
      p.push(ln(lx2 + 3, cellY - 6, lx2 + 3, cellY + 6, {stroke: BAT_CLR, sw: 1.5}));
    }
  }
  p.push(txt(cellX - 8, cellY + 4, '\u2212', {sz: 9, bold: true, anc: 'middle', fill: BAT_CLR}));
  p.push(txt(cellX + 22, cellY + 4, '+', {sz: 9, bold: true, anc: 'middle', fill: BAT_CLR}));

  p.push(lug(cx, by2 + H2 - 6));
  p.push(ln(cx, by2 + H2 - 6, cx, by2 + H2, {stroke: BAT_CLR, sw: SW_MED}));

  p.push(txt(cx, by2 + H2 + 10, model ? model.substring(0, 22) : 'BATTERY STORAGE', {sz: F.tiny, anc: 'middle', italic: true}));
  p.push(txt(cx, by2 + H2 + 19, kwh > 0 ? `${kwh} kWh` : '', {sz: F.tiny, anc: 'middle', bold: true, fill: BAT_CLR}));
  if (backfeedA > 0) {
    p.push(txt(cx, by2 + H2 + 28, `${backfeedA}A BACKFEED \u2014 NEC 705.12(B)`, {sz: F.tiny, anc: 'middle', fill: BAT_CLR}));
  }
  p.push(callout(bx + W2 + 14, by2 - 5, calloutN));
  return {svg: p.join(''), lx: bx, rx: bx + W2, ty: by2, by: by2 + H2};
}

// Generator Symbol (IEEE 315 / ANSI) - circle with G inside
function renderGenerator(
  cx: number, cy: number,
  brand: string, model: string, kw: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number} {
  const GEN_CLR = '#2E7D32';
  const r = 30;
  const p: string[] = [];

  p.push(circ(cx, cy, r, {fill: WHT, stroke: GEN_CLR, sw: SW_MED}));
  p.push(txt(cx, cy + 4, 'G', {sz: 16, bold: true, anc: 'middle', fill: GEN_CLR}));
  const swPath = `M${cx-8},${cy+12} Q${cx-4},${cy+8} ${cx},${cy+12} Q${cx+4},${cy+16} ${cx+8},${cy+12}`;
  p.push(`<path d="${swPath}" fill="none" stroke="${GEN_CLR}" stroke-width="${SW_THIN}"/>`);

  p.push(lug(cx + r, cy));
  p.push(ln(cx + r, cy, cx + r + 10, cy, {stroke: GEN_CLR, sw: SW_MED}));

  p.push(txt(cx, cy - r - 18, 'STANDBY GENERATOR', {sz: F.hdr, bold: true, anc: 'middle', fill: GEN_CLR}));
  p.push(txt(cx, cy - r - 8, `${brand} ${model}`.trim() || 'GENERATOR', {sz: F.sub, anc: 'middle', fill: GEN_CLR}));
  p.push(txt(cx, cy + r + 9, kw > 0 ? `${kw} kW / ${Math.round(kw*1000/240)}A` : '', {sz: F.tiny, anc: 'middle', fill: GEN_CLR}));
  p.push(txt(cx, cy + r + 18, 'NEC 702.5 \u2014 TRANSFER EQUIP. REQ.', {sz: F.tiny, anc: 'middle', italic: true, fill: GEN_CLR}));
  p.push(callout(cx + r + 14, cy - r - 5, calloutN));

  return {svg: p.join(''), lx: cx - r, rx: cx + r + 10, ty: cy - r, by: cy + r};
}

// ATS Symbol (Automatic Transfer Switch)
function renderATS(
  cx: number, cy: number,
  brand: string, model: string, ampRating: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number} {
  const W2 = 90, H2 = 68;
  const bx = cx - W2/2, by2 = cy - H2/2;
  const ATS_CLR = '#E65100';
  const p: string[] = [];

  p.push(rect(bx, by2, W2, H2, {fill: WHT, stroke: ATS_CLR, sw: SW_MED}));
  p.push(ln(bx, by2 + 14, bx + W2, by2 + 14, {stroke: ATS_CLR, sw: SW_THIN}));
  p.push(txt(cx, by2 + 10, 'AUTO TRANSFER SWITCH', {sz: 5.5, bold: true, anc: 'middle', fill: ATS_CLR}));

  const utilY = cy - 12;
  const genY  = cy + 12;

  p.push(lug(bx + 8, utilY));
  p.push(txt(bx + 8, utilY - 8, 'UTIL', {sz: 4.5, anc: 'middle', fill: '#444'}));
  p.push(ln(bx, utilY, bx + 8, utilY, {stroke: ATS_CLR, sw: SW_MED}));

  p.push(lug(bx + 8, genY));
  p.push(txt(bx + 8, genY + 10, 'GEN', {sz: 4.5, anc: 'middle', fill: ATS_CLR}));
  p.push(ln(bx, genY, bx + 8, genY, {stroke: ATS_CLR, sw: SW_MED}));

  // Utility blade closed (horizontal)
  p.push(ln(bx + 11, utilY, bx + 38, utilY, {stroke: ATS_CLR, sw: SW_MED}));
  p.push(circ(bx + 11, utilY, 2.5, {fill: ATS_CLR, stroke: ATS_CLR, sw: 0}));
  p.push(circ(bx + 38, utilY, 2.5, {fill: WHT, stroke: ATS_CLR, sw: SW_THIN}));

  // Gen blade open (angled)
  p.push(ln(bx + 11, genY, bx + 30, genY - 10, {stroke: ATS_CLR, sw: SW_MED}));
  p.push(circ(bx + 11, genY, 2.5, {fill: ATS_CLR, stroke: ATS_CLR, sw: 0}));
  p.push(circ(bx + 38, genY, 2.5, {fill: WHT, stroke: ATS_CLR, sw: SW_THIN}));

  const busX = bx + 50;
  p.push(ln(busX, utilY, busX, genY, {stroke: ATS_CLR, sw: 2.5}));
  p.push(ln(bx + 38, utilY, busX, utilY, {stroke: ATS_CLR, sw: SW_THIN}));
  p.push(ln(bx + 38, genY, busX, genY, {stroke: ATS_CLR, sw: SW_THIN}));

  p.push(lug(bx + W2 - 8, cy));
  p.push(txt(bx + W2 - 8, cy - 8, 'LOAD', {sz: 4.5, anc: 'middle', fill: '#444'}));
  p.push(ln(busX, cy, bx + W2 - 8, cy, {stroke: ATS_CLR, sw: SW_MED}));
  p.push(ln(bx + W2 - 8, cy, bx + W2, cy, {stroke: ATS_CLR, sw: SW_MED}));

  p.push(txt(cx, by2 + H2 + 10, `${brand} ${model}`.trim() || 'ATS', {sz: F.tiny, anc: 'middle', italic: true}));
  p.push(txt(cx, by2 + H2 + 19, ampRating > 0 ? `${ampRating}A RATED` : '', {sz: F.tiny, anc: 'middle', bold: true, fill: ATS_CLR}));
  p.push(txt(cx, by2 + H2 + 28, 'NEC 702.5 \u2014 AUTO TRANSFER', {sz: F.tiny, anc: 'middle', italic: true, fill: ATS_CLR}));
  p.push(callout(bx + W2 + 14, by2 - 5, calloutN));

  return {svg: p.join(''), lx: bx - 10, rx: bx + W2 + 10, ty: by2, by: by2 + H2};
}

// Backup Sub-Panel Symbol
function renderBackupPanel(
  cx: number, cy: number,
  brand: string, ampRating: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number} {
  const W2 = 80, H2 = 72;
  const bx = cx - W2/2, by2 = cy - H2/2;
  const BP_CLR = '#6A1B9A';
  const p: string[] = [];

  p.push(rect(bx, by2, W2, H2, {fill: WHT, stroke: BP_CLR, sw: SW_MED}));
  p.push(ln(bx, by2 + 14, bx + W2, by2 + 14, {stroke: BP_CLR, sw: SW_THIN}));
  p.push(txt(cx, by2 + 10, 'BACKUP SUB-PANEL', {sz: 5.5, bold: true, anc: 'middle', fill: BP_CLR}));

  const mbY = by2 + 28;
  p.push(breakerSymbol(cx, mbY, 28, 12, ampRating));
  p.push(txt(cx, mbY - 5, `${ampRating}A MAIN`, {sz: 5, anc: 'middle', bold: true, fill: BP_CLR}));

  const busY2 = mbY + 18;
  p.push(busbar(bx + 8, bx + W2 - 8, busY2, 'CRIT. LOADS BUS'));
  p.push(ln(cx, mbY + 6, cx, busY2, {sw: SW_MED}));

  for (let i = 0; i < 3; i++) {
    const lx3 = bx + 12 + i * 22;
    p.push(ln(lx3, busY2, lx3, busY2 + 14, {sw: SW_THIN, stroke: BP_CLR}));
    p.push(breakerSymbol(lx3, busY2 + 20, 14, 10));
  }

  p.push(lug(bx, cy));
  p.push(ln(bx - 10, cy, bx, cy, {stroke: BP_CLR, sw: SW_MED}));

  p.push(txt(cx, by2 + H2 + 10, brand || 'BACKUP PANEL', {sz: F.tiny, anc: 'middle', italic: true}));
  p.push(txt(cx, by2 + H2 + 19, 'CRITICAL LOADS ONLY', {sz: F.tiny, anc: 'middle', fill: BP_CLR}));
  p.push(callout(bx + W2 + 14, by2 - 5, calloutN));

  return {svg: p.join(''), lx: bx - 10, rx: bx + W2, ty: by2, by: by2 + H2};
}

"""

lines_new = lines[:wire_seg_idx] + [new_symbols] + lines[wire_seg_idx:]
src = ''.join(lines_new)
lines = src.splitlines(keepends=True)
print("OK Step 2: Symbol functions inserted")

# ─── 3. Add battery/generator/ATS rendering after NODE 6 MSP ─────────────────
node7_idx = None
for i, line in enumerate(lines):
    if 'NODE 7: UTILITY METER' in line:
        node7_idx = i
        break

assert node7_idx is not None, "NODE 7 line not found"
print(f"   NODE 7 line found at line {node7_idx + 1}")

battery_gen_ats_block = """
  // NODE 8: BATTERY STORAGE (if configured)
  // Battery placed ABOVE the main bus, to the right of the MSP
  if (input.hasBattery && input.batteryModel) {
    const batCX = xMSP + 140;
    const batCY = BUS_Y - 110;
    const batResult = renderBattery(
      batCX, batCY,
      input.batteryModel,
      input.batteryKwh ?? 0,
      input.batteryBackfeedA ?? 0,
      isMicro ? 7 : 8
    );
    parts.push(batResult.svg);

    // AC connection: dashed line from battery bottom to MSP bus
    parts.push(ln(batCX, batResult.by, batCX, BUS_Y, {stroke: '#1565C0', sw: SW_MED, dash: '6,3'}));
    parts.push(ln(batCX, BUS_Y, xMSP + 20, BUS_Y, {stroke: '#1565C0', sw: SW_MED, dash: '6,3'}));
    parts.push(circ(xMSP + 20, BUS_Y, 3, {fill: '#1565C0', stroke: '#1565C0', sw: 0}));

    const batWireLabel = (input.batteryBackfeedA ?? 0) > 0
      ? [`#6 AWG THWN-2`, `${input.batteryBackfeedA}A \u2014 NEC 705.12(B)`]
      : ['#6 AWG THWN-2', 'AC-COUPLED BATTERY'];
    parts.push(tspan(batCX + 30, BUS_Y - 20, batWireLabel, {sz: F.tiny, anc: 'start', fill: '#1565C0'}));
  }

  // NODE 9: GENERATOR + ATS (if configured)
  // Generator placed BELOW the schematic area, left of MSP
  if ((input.generatorKw ?? 0) > 0) {
    const genCX = xMSP - 200;
    const genCY = BUS_Y + 160;
    const genResult = renderGenerator(
      genCX, genCY,
      input.generatorBrand ?? '',
      input.generatorModel ?? '',
      input.generatorKw!,
      isMicro ? 8 : 9
    );
    parts.push(genResult.svg);

    const atsCX = xMSP - 80;
    const atsCY = BUS_Y + 160;
    const atsResult = renderATS(
      atsCX, atsCY,
      input.atsBrand ?? '',
      input.atsModel ?? '',
      input.atsAmpRating ?? 200,
      isMicro ? 9 : 10
    );
    parts.push(atsResult.svg);

    // Generator -> ATS
    parts.push(ln(genResult.rx, genCY, atsResult.lx, atsCY, {stroke: '#2E7D32', sw: SW_MED}));
    const genAtsX = (genResult.rx + atsResult.lx) / 2;
    parts.push(tspan(genAtsX, genCY - 10, ['#6 AWG THWN-2', 'GEN OUTPUT'], {sz: F.tiny, anc: 'middle', fill: '#2E7D32'}));

    // Utility feed to ATS (vertical drop from BUS_Y)
    const utilFeedX = atsCX - 44;
    parts.push(ln(utilFeedX, BUS_Y + 36, utilFeedX, atsCY, {stroke: BLK, sw: SW_MED}));
    parts.push(txt(utilFeedX - 4, (BUS_Y + 36 + atsCY) / 2, 'UTILITY', {sz: F.tiny, anc: 'end', fill: '#444'}));

    // ATS -> MSP (vertical rise)
    const atsMspX = atsCX + 55;
    parts.push(ln(atsMspX, atsCY, atsMspX, BUS_Y + 36, {stroke: '#E65100', sw: SW_MED}));
    parts.push(tspan(atsMspX + 6, atsCY - 20, ['#4 AWG THWN-2', 'ATS \u2192 MSP'], {sz: F.tiny, anc: 'start', fill: '#E65100'}));

    parts.push(txt(atsCX, atsCY + 55, 'NEC 702.5 \u2014 TRANSFER EQUIPMENT REQUIRED', {sz: F.tiny, anc: 'middle', italic: true, fill: '#E65100'}));

    if (input.hasBackupPanel) {
      const bpCX = atsCX + 160;
      const bpCY = BUS_Y + 160;
      const bpResult = renderBackupPanel(
        bpCX, bpCY,
        input.backupPanelBrand ?? '',
        input.backupPanelAmps ?? 100,
        isMicro ? 10 : 11
      );
      parts.push(bpResult.svg);
      parts.push(ln(atsResult.rx, atsCY, bpResult.lx, bpCY, {stroke: '#6A1B9A', sw: SW_MED}));
      parts.push(tspan((atsResult.rx + bpResult.lx) / 2, bpCY - 10, ['#6 AWG THWN-2', 'CRITICAL LOADS'], {sz: F.tiny, anc: 'middle', fill: '#6A1B9A'}));
    }
  }

"""

lines_new = lines[:node7_idx] + [battery_gen_ats_block] + lines[node7_idx:]
src = ''.join(lines_new)
lines = src.splitlines(keepends=True)
print("OK Step 3: Battery/Generator/ATS rendering block inserted")

# ─── 4. Expand the legend ─────────────────────────────────────────────────────
old_legend = "  const legX = SCH_X+SCH_W-195, legY = SCH_Y+SCH_H-68;\n  parts.push(rect(legX, legY, 188, 60, {fill:WHT, stroke:BLK, sw:SW_THIN}));\n  parts.push(txt(legX+4, legY+10, 'LEGEND', {sz:F.sub, bold:true}));\n  parts.push(ln(legX, legY+13, legX+188, legY+13, {sw:SW_THIN}));\n  [\n    {dash:'',    stroke:BLK, label:'AC Conductor in Conduit (THWN-2)'},\n    {dash:'10,5',stroke:GRN, label:'Open Air \u2014 PV Wire/THWN-2 (NEC 690.31)'},\n    {dash:'',    stroke:GRN, label:'Equipment Grounding Conductor (EGC)'},\n    {dash:'4,2', stroke:BLK, label:'DC Conductor in Conduit (USE-2/PV Wire)'},\n  ].forEach((item,i) => {\n    const ly = legY+19+i*11;\n    parts.push(ln(legX+4, ly, legX+38, ly, {stroke:item.stroke, sw:SW_MED, dash:item.dash}));\n    parts.push(txt(legX+44, ly+3, item.label, {sz:F.tiny}));\n  });"

new_legend = """  // Legend expanded with battery/generator/ATS entries
  const legEntries: {dash: string; stroke: string; label: string}[] = [
    {dash:'',    stroke:BLK,       label:'AC Conductor in Conduit (THWN-2)'},
    {dash:'10,5',stroke:GRN,       label:'Open Air \u2014 PV Wire/THWN-2 (NEC 690.31)'},
    {dash:'',    stroke:GRN,       label:'Equipment Grounding Conductor (EGC)'},
    {dash:'4,2', stroke:BLK,       label:'DC Conductor in Conduit (USE-2/PV Wire)'},
    ...(input.hasBattery ? [{dash:'6,3', stroke:'#1565C0', label:'Battery AC-Coupled Connection'}] : []),
    ...((input.generatorKw ?? 0) > 0 ? [{dash:'', stroke:'#2E7D32', label:'Generator Output Conductor'}] : []),
    ...((input.generatorKw ?? 0) > 0 ? [{dash:'', stroke:'#E65100', label:'ATS Transfer Conductor'}] : []),
  ];
  const legH = 16 + legEntries.length * 11;
  const legX = SCH_X+SCH_W-195, legY = SCH_Y+SCH_H - legH - 4;
  parts.push(rect(legX, legY, 188, legH, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(txt(legX+4, legY+10, 'LEGEND', {sz:F.sub, bold:true}));
  parts.push(ln(legX, legY+13, legX+188, legY+13, {sw:SW_THIN}));
  legEntries.forEach((item,i) => {
    const ly = legY+19+i*11;
    parts.push(ln(legX+4, ly, legX+38, ly, {stroke:item.stroke, sw:SW_MED, dash:item.dash||undefined}));
    parts.push(txt(legX+44, ly+3, item.label, {sz:F.tiny}));
  });"""

if old_legend in src:
    src = src.replace(old_legend, new_legend, 1)
    print("OK Step 4: Legend expanded")
else:
    # Try to find it by searching for key parts
    print("WARNING: Legend block not found with exact match, trying line-based approach")
    lines = src.splitlines(keepends=True)
    leg_start = None
    for i, line in enumerate(lines):
        if 'legX = SCH_X+SCH_W-195' in line and 'legY = SCH_Y+SCH_H-68' in line:
            leg_start = i
            break
    if leg_start is not None:
        # Find the end of the legend block (the forEach closing)
        leg_end = leg_start
        for j in range(leg_start, min(leg_start + 20, len(lines))):
            if '});' in lines[j] and j > leg_start + 5:
                leg_end = j
                break
        print(f"   Legend found at lines {leg_start+1}-{leg_end+1}")
        lines_new = lines[:leg_start] + [new_legend + '\n'] + lines[leg_end+1:]
        src = ''.join(lines_new)
        print("OK Step 4: Legend expanded (line-based)")
    else:
        print("ERROR: Could not find legend block")

lines = src.splitlines(keepends=True)

# ─── 5. Update equipment schedule rows ────────────────────────────────────────
old_eq_micro = "    ['Battery Storage',input.hasBattery?esc(input.batteryModel):'NONE'],\n  ] : ["
new_eq_micro = """    ['Battery Storage',input.hasBattery?esc(input.batteryModel):'NONE'],
    ...(input.hasBattery && input.batteryKwh ? [['Battery Capacity',`${input.batteryKwh} kWh`] as [string,string]] : []),
    ...(input.batteryBackfeedA ? [['Batt. Backfeed',`${input.batteryBackfeedA}A \u2014 NEC 705.12(B)`] as [string,string]] : []),
    ...((input.generatorKw ?? 0) > 0 ? [['Generator',`${input.generatorBrand??''} ${input.generatorKw}kW`] as [string,string]] : []),
    ...(input.atsAmpRating ? [['ATS',`${input.atsBrand??''} ${input.atsAmpRating}A`] as [string,string]] : []),
  ] : ["""

if old_eq_micro in src:
    src = src.replace(old_eq_micro, new_eq_micro, 1)
    print("OK Step 5a: Micro equipment schedule updated")
else:
    print("WARNING: Micro equipment schedule tail not found with exact match")

old_eq_string = "    ['Battery Storage',input.hasBattery?esc(input.batteryModel):'NONE'],\n  ];"
new_eq_string = """    ['Battery Storage',input.hasBattery?esc(input.batteryModel):'NONE'],
    ...(input.hasBattery && input.batteryKwh ? [['Battery Capacity',`${input.batteryKwh} kWh`] as [string,string]] : []),
    ...(input.batteryBackfeedA ? [['Batt. Backfeed',`${input.batteryBackfeedA}A \u2014 NEC 705.12(B)`] as [string,string]] : []),
    ...((input.generatorKw ?? 0) > 0 ? [['Generator',`${input.generatorBrand??''} ${input.generatorKw}kW`] as [string,string]] : []),
    ...(input.atsAmpRating ? [['ATS',`${input.atsBrand??''} ${input.atsAmpRating}A`] as [string,string]] : []),
  ];"""

if old_eq_string in src:
    src = src.replace(old_eq_string, new_eq_string, 1)
    print("OK Step 5b: String equipment schedule updated")
else:
    print("WARNING: String equipment schedule tail not found with exact match")

# ─── Write the patched file ───────────────────────────────────────────────────
with open('lib/sld-professional-renderer.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"\nALL DONE - sld-professional-renderer.ts patched successfully")
print(f"   New file size: {len(src)} chars, {src.count(chr(10))} lines")