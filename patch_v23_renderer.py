#!/usr/bin/env python3
"""
BUILD v23: Full SLD professional renderer overhaul
- Add renderBUI() for Enphase IQ SC3 / Tesla Gateway / generic BUI
- Move battery connection from MSP bus → BUI battery port
- Fix generator ATS placement (between utility meter and MSP)
- Upgrade inverter icon to professional rectangular box
- Update 120% rule to include battery backfeed amps
- Add backupInterfaceId/Brand/Model/IsATS to SLDProfessionalInput
"""

with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    src = f.read()

print(f"Renderer loaded: {len(src)} chars")

# ─── 1. Extend SLDProfessionalInput with backupInterface fields ───────────────
old_iface = "  backupPanelBrand?:       string;\n  scale:                   string;"
new_iface = """  backupPanelBrand?:       string;
  backupInterfaceId?:      string;
  backupInterfaceBrand?:   string;
  backupInterfaceModel?:   string;
  backupInterfaceIsATS?:   boolean;
  scale:                   string;"""

assert old_iface in src, "Interface tail not found"
src = src.replace(old_iface, new_iface, 1)
print("OK Step 1: SLDProfessionalInput extended with backupInterface fields")

# ─── 2. Add renderBUI() function before the Wire Segment section ──────────────
lines = src.splitlines(keepends=True)
wire_seg_idx = None
for i, line in enumerate(lines):
    if 'Wire Segment with Inline Label' in line:
        wire_seg_idx = i
        break
assert wire_seg_idx is not None

bui_function = r"""// Backup Interface Unit (BUI) Symbol
// Handles: Enphase IQ SC3, Tesla Backup Gateway, generic BUI
// Placed between MSP and utility meter on the right side of the bus
function renderBUI(
  cx: number, cy: number,
  brand: string, model: string, ampRating: number,
  isEnphase: boolean, isTesla: boolean,
  hasGenerator: boolean, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number; batPortX: number; batPortY: number; loadPortX: number; loadPortY: number} {
  const W2 = 100, H2 = 90;
  const bx = cx - W2/2, by2 = cy - H2/2;
  const BUI_CLR = isEnphase ? '#0D47A1' : isTesla ? '#CC0000' : '#1565C0';
  const p: string[] = [];

  // Enclosure
  p.push(rect(bx, by2, W2, H2, {fill: WHT, stroke: BUI_CLR, sw: SW_MED}));
  p.push(ln(bx, by2+14, bx+W2, by2+14, {stroke: BUI_CLR, sw: SW_THIN}));

  // Header text
  const headerText = isEnphase ? 'IQ SYSTEM CONTROLLER 3'
    : isTesla ? 'BACKUP GATEWAY 2'
    : 'BACKUP INTERFACE UNIT';
  p.push(txt(cx, by2+10, headerText, {sz: 5.5, bold: true, anc: 'middle', fill: BUI_CLR}));

  // GRID input lug (left side, upper)
  const gridY = cy - 14;
  p.push(lug(bx+8, gridY));
  p.push(txt(bx+8, gridY-8, 'GRID', {sz: 4.5, anc: 'middle', fill: '#444'}));
  p.push(ln(bx, gridY, bx+8, gridY, {stroke: BUI_CLR, sw: SW_MED}));

  // GEN input lug (left side, lower) — only if generator configured
  const genInputY = cy + 14;
  if (hasGenerator) {
    p.push(lug(bx+8, genInputY));
    p.push(txt(bx+8, genInputY+9, 'GEN', {sz: 4.5, anc: 'middle', fill: '#2E7D32'}));
    p.push(ln(bx, genInputY, bx+8, genInputY, {stroke: '#2E7D32', sw: SW_MED}));
  }

  // Transfer switch blades inside
  // GRID blade — closed (utility is normal source)
  p.push(ln(bx+11, gridY, bx+42, gridY, {stroke: BUI_CLR, sw: SW_MED}));
  p.push(circ(bx+11, gridY, 2.5, {fill: BUI_CLR, stroke: BUI_CLR, sw: 0}));
  p.push(circ(bx+42, gridY, 2.5, {fill: WHT, stroke: BUI_CLR, sw: SW_THIN}));

  if (hasGenerator) {
    // GEN blade — open (angled)
    p.push(ln(bx+11, genInputY, bx+32, genInputY-12, {stroke: '#2E7D32', sw: SW_MED}));
    p.push(circ(bx+11, genInputY, 2.5, {fill: '#2E7D32', stroke: '#2E7D32', sw: 0}));
    p.push(circ(bx+42, genInputY, 2.5, {fill: WHT, stroke: '#2E7D32', sw: SW_THIN}));
  }

  // Internal bus (vertical center)
  const busX2 = bx + 55;
  p.push(ln(busX2, gridY, busX2, hasGenerator ? genInputY : gridY+20, {stroke: BUI_CLR, sw: 2.5}));
  p.push(ln(bx+42, gridY, busX2, gridY, {stroke: BUI_CLR, sw: SW_THIN}));
  if (hasGenerator) {
    p.push(ln(bx+42, genInputY, busX2, genInputY, {stroke: BUI_CLR, sw: SW_THIN}));
  }

  // LOAD output lug (right side, center)
  const loadY = cy;
  p.push(lug(bx+W2-8, loadY));
  p.push(txt(bx+W2-8, loadY-8, 'LOAD', {sz: 4.5, anc: 'middle', fill: '#444'}));
  p.push(ln(busX2, loadY, bx+W2-8, loadY, {stroke: BUI_CLR, sw: SW_MED}));
  p.push(ln(bx+W2-8, loadY, bx+W2, loadY, {stroke: BUI_CLR, sw: SW_MED}));

  // BATTERY port (bottom center)
  const batPortX2 = cx;
  const batPortY2 = by2 + H2;
  p.push(lug(batPortX2, batPortY2-4));
  p.push(txt(batPortX2, batPortY2+8, 'BATTERY', {sz: 4.5, anc: 'middle', fill: BUI_CLR}));
  p.push(ln(batPortX2, batPortY2-4, batPortX2, batPortY2, {stroke: BUI_CLR, sw: SW_MED}));

  // Labels below
  const labelBrand = brand || (isEnphase ? 'Enphase' : isTesla ? 'Tesla' : 'BUI');
  const labelModel = model || (isEnphase ? 'IQ SC3' : isTesla ? 'Gateway 2' : 'BUI');
  p.push(txt(cx, by2+H2+18, `${labelBrand} ${labelModel}`, {sz: F.tiny, anc: 'middle', italic: true, fill: BUI_CLR}));
  p.push(txt(cx, by2+H2+27, ampRating > 0 ? `${ampRating}A` : '200A', {sz: F.tiny, anc: 'middle', bold: true, fill: BUI_CLR}));
  if (isEnphase) {
    p.push(txt(cx, by2+H2+36, 'NEC 706 / NEC 230.82 / UL 1741-SA', {sz: F.tiny, anc: 'middle', italic: true, fill: BUI_CLR}));
  } else {
    p.push(txt(cx, by2+H2+36, 'NEC 706 / UL 1741', {sz: F.tiny, anc: 'middle', italic: true, fill: BUI_CLR}));
  }

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  return {
    svg: p.join(''),
    lx: bx-10, rx: bx+W2+10,
    ty: by2, by: by2+H2,
    batPortX: batPortX2, batPortY: batPortY2,
    loadPortX: bx+W2, loadPortY: loadY,
  };
}

// Professional Inverter Box (replaces generic circle symbol)
function renderInverterBox(
  cx: number, cy: number,
  manufacturer: string, model: string,
  acKw: number, acAmps: number,
  topologyLabel: string, mpptAllocation: string,
  calloutN: number
): {svg: string; lx: number; rx: number} {
  const W2 = 96, H2 = 80;
  const bx = cx - W2/2, by2 = cy - H2/2;
  const p: string[] = [];

  // Enclosure
  p.push(rect(bx, by2, W2, H2, {fill: WHT, stroke: BLK, sw: SW_MED}));
  p.push(ln(bx, by2+14, bx+W2, by2+14, {sw: SW_THIN}));
  p.push(txt(cx, by2+10, topologyLabel, {sz: 5.5, bold: true, anc: 'middle'}));

  // DC/AC conversion symbol in center
  const symY = cy - 4;
  // DC label left
  p.push(txt(bx+10, symY+4, 'DC', {sz: 7, bold: true, anc: 'middle', fill: '#555'}));
  // Arrow
  p.push(ln(bx+20, symY, bx+W2-20, symY, {sw: SW_MED}));
  p.push(`<path d="M${bx+W2-22},${symY-5} L${bx+W2-18},${symY} L${bx+W2-22},${symY+5}" fill="${BLK}" stroke="${BLK}" stroke-width="1"/>`);
  // Sine wave on AC side
  const swX = bx + W2 - 18;
  const swPath = `M${swX-8},${symY} Q${swX-4},${symY-7} ${swX},${symY} Q${swX+4},${symY+7} ${swX+8},${symY}`;
  p.push(`<path d="${swPath}" fill="none" stroke="${BLK}" stroke-width="${SW_MED}"/>`);
  // AC label right
  p.push(txt(bx+W2-10, symY+4, 'AC', {sz: 7, bold: true, anc: 'middle', fill: '#555'}));

  // Manufacturer + model
  const mfgLabel = manufacturer ? `${manufacturer}` : '';
  const mdlLabel = model ? model.substring(0, 18) : '';
  p.push(txt(cx, by2+H2-28, mfgLabel, {sz: F.sub, anc: 'middle', italic: true}));
  p.push(txt(cx, by2+H2-18, mdlLabel, {sz: F.label, anc: 'middle', bold: true}));

  // Output specs
  p.push(txt(cx, by2+H2-8, acKw > 0 ? `${acKw} kW / ${acAmps}A` : '', {sz: F.tiny, anc: 'middle'}));

  // MPPT allocation
  if (mpptAllocation) {
    p.push(txt(cx, by2+H2+9, `MPPT: ${mpptAllocation}`, {sz: F.tiny, anc: 'middle', fill: '#555'}));
  }

  // DC input lug (left)
  p.push(lug(bx, cy));
  p.push(ln(bx-10, cy, bx, cy, {sw: SW_MED}));
  // AC output lug (right)
  p.push(lug(bx+W2, cy));
  p.push(ln(bx+W2, cy, bx+W2+10, cy, {sw: SW_MED}));

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  return {svg: p.join(''), lx: bx-10, rx: bx+W2+10};
}

"""

lines_new = lines[:wire_seg_idx] + [bui_function] + lines[wire_seg_idx:]
src = ''.join(lines_new)
lines = src.splitlines(keepends=True)
print("OK Step 2: renderBUI() and renderInverterBox() functions added")

# ─── 3. Replace generic inverterSymbol() call with renderInverterBox() ────────
# Find the NODE 4 INVERTER section and replace the inverterSymbol call
old_inv_node = """  if (!isMicro) {
    const invCX = xInv, invCY = BUS_Y;
    const invR = 28;
    parts.push(inverterSymbol(invCX, invCY, invR));
    // DC input lug
    parts.push(lug(invCX-invR, invCY));
    parts.push(ln(invCX-invR-10, invCY, invCX-invR, invCY, {sw:SW_MED}));
    // AC output lug
    parts.push(lug(invCX+invR, invCY));
    parts.push(ln(invCX+invR, invCY, invCX+invR+10, invCY, {sw:SW_MED}));
    const tl = input.topologyType==='STRING_WITH_OPTIMIZER' ? 'STRING + OPTIMIZER' : 'STRING INVERTER';
    parts.push(txt(invCX, invCY-invR-18, tl, {sz:F.hdr, bold:true, anc:'middle'}));
    parts.push(txt(invCX, invCY-invR-8, `${esc(input.inverterManufacturer)} ${esc(input.inverterModel)}`, {sz:F.sub, anc:'middle'}));
    parts.push(txt(invCX, invCY+invR+9, `${input.acOutputKw} kW / ${input.acOutputAmps}A`, {sz:F.tiny, anc:'middle'}));
    if (input.mpptAllocation) {
      parts.push(txt(invCX, invCY+invR+18, `MPPT: ${input.mpptAllocation}`, {sz:F.tiny, anc:'middle'}));
    }
    parts.push(callout(invCX+invR+14, invCY-invR-5, 4));
    invRX = invCX+invR+10;"""

new_inv_node = """  if (!isMicro) {
    const invCX = xInv, invCY = BUS_Y;
    const tl = input.topologyType==='STRING_WITH_OPTIMIZER' ? 'STRING + OPTIMIZER' : 'STRING INVERTER';
    const invBox = renderInverterBox(
      invCX, invCY,
      input.inverterManufacturer, input.inverterModel,
      input.acOutputKw, input.acOutputAmps,
      tl, input.mpptAllocation ?? '',
      4
    );
    parts.push(invBox.svg);
    invRX = invBox.rx;"""

assert old_inv_node in src, "Inverter node not found"
src = src.replace(old_inv_node, new_inv_node, 1)
print("OK Step 3: Inverter icon replaced with professional renderInverterBox()")

# ─── 4. Replace battery/generator/ATS block with BUI-aware implementation ─────
# Find and replace the entire NODE 8/9 block
old_bat_gen_block = """
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

new_bat_gen_block = """
  // ─── NODE 8: BUI + BATTERY (if battery configured) ───────────────────────
  // BUI (Enphase IQ SC3 / Tesla Gateway / generic) placed RIGHT of MSP
  // Battery connects to BUI battery port — NOT directly to MSP bus
  // Backfeed breaker at MSP connects MSP bus to BUI grid port
  let buiRX = mspRX;
  if (input.hasBattery && input.batteryModel) {
    const isEnphase = !!(input.backupInterfaceBrand?.toLowerCase().includes('enphase') ||
      input.inverterManufacturer?.toLowerCase().includes('enphase') ||
      input.batteryModel?.toLowerCase().includes('enphase') ||
      input.batteryModel?.toLowerCase().includes('iq battery'));
    const isTesla = !!(input.backupInterfaceBrand?.toLowerCase().includes('tesla') ||
      input.batteryModel?.toLowerCase().includes('powerwall'));

    // BUI positioned right of MSP, on the main bus line
    const buiCX = xMSP + 130;
    const buiCY = BUS_Y;
    const buiAmpRating = input.atsAmpRating ?? 200;
    const buiResult = renderBUI(
      buiCX, buiCY,
      input.backupInterfaceBrand ?? (isEnphase ? 'Enphase' : isTesla ? 'Tesla' : ''),
      input.backupInterfaceModel ?? (isEnphase ? 'IQ System Controller 3' : isTesla ? 'Backup Gateway 2' : 'BUI'),
      buiAmpRating,
      isEnphase, isTesla,
      (input.generatorKw ?? 0) > 0,
      isMicro ? 7 : 8
    );
    parts.push(buiResult.svg);
    buiRX = buiResult.rx;

    // Wire: MSP output → BUI grid input (horizontal on bus line)
    parts.push(ln(mspRX, BUS_Y, buiResult.lx, BUS_Y, {stroke: BLK, sw: SW_MED}));

    // Backfeed breaker at MSP for battery (NEC 705.12(B))
    const bfA = input.batteryBackfeedA ?? 20;
    const bfX = xMSP + 30;
    parts.push(breakerSymbol(bfX, BUS_Y + 30, 20, 12, bfA));
    parts.push(ln(bfX, BUS_Y, bfX, BUS_Y + 24, {sw: SW_THIN, stroke: '#1565C0'}));
    parts.push(txt(bfX, BUS_Y + 48, `${bfA}A BATT`, {sz: 5, anc: 'middle', bold: true, fill: '#1565C0'}));
    parts.push(txt(bfX, BUS_Y + 56, 'NEC 705.12(B)', {sz: 4.5, anc: 'middle', italic: true, fill: '#1565C0'}));

    // Battery symbol — above BUI, connected to BUI battery port
    const batCX = buiCX;
    const batCY = BUS_Y - 120;
    const batResult = renderBattery(
      batCX, batCY,
      input.batteryModel,
      input.batteryKwh ?? 0,
      input.batteryBackfeedA ?? 0,
      isMicro ? 8 : 9
    );
    parts.push(batResult.svg);

    // Wire: battery bottom → BUI battery port (vertical dashed blue line)
    parts.push(ln(batCX, batResult.by, batCX, buiResult.batPortY, {stroke: '#1565C0', sw: SW_MED, dash: '6,3'}));
    // Wire callout
    const batWireGauge = bfA <= 20 ? '#12 AWG THWN-2' : bfA <= 30 ? '#10 AWG THWN-2' : '#8 AWG THWN-2';
    parts.push(tspan(batCX + 8, batCY + (buiResult.batPortY - batResult.by)/2,
      [batWireGauge, `${bfA}A CIRCUIT`],
      {sz: F.tiny, anc: 'start', fill: '#1565C0'}));

    // Backup sub-panel — connected to BUI load port (right side)
    if (input.hasBackupPanel) {
      const bpCX = buiResult.loadPortX + 80;
      const bpCY = BUS_Y + 100;
      const bpResult = renderBackupPanel(
        bpCX, bpCY,
        input.backupPanelBrand ?? (isEnphase ? 'Enphase' : ''),
        input.backupPanelAmps ?? 100,
        isMicro ? 9 : 10
      );
      parts.push(bpResult.svg);
      // Wire: BUI load port → backup panel (L-shaped route)
      parts.push(ln(buiResult.loadPortX, buiResult.loadPortY, bpCX - 40, buiResult.loadPortY, {stroke: '#6A1B9A', sw: SW_MED}));
      parts.push(ln(bpCX - 40, buiResult.loadPortY, bpCX - 40, bpCY, {stroke: '#6A1B9A', sw: SW_MED}));
      parts.push(ln(bpCX - 40, bpCY, bpResult.lx, bpCY, {stroke: '#6A1B9A', sw: SW_MED}));
      parts.push(tspan(bpCX - 40 + 6, bpCY - 10, ['#6 AWG THWN-2', 'CRITICAL LOADS'], {sz: F.tiny, anc: 'start', fill: '#6A1B9A'}));
    }
  }

  // ─── NODE 9: GENERATOR + GENERATOR ATS (if configured) ───────────────────
  // Generator ATS positioned between utility meter and MSP (service entrance)
  // Generator positioned below and left of the ATS
  if ((input.generatorKw ?? 0) > 0) {
    // Generator ATS — between utility meter and MSP, below the bus
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
    parts.push(tspan(genAtsLabelX, genCY - 10, ['#6 AWG THWN-2', 'GEN OUTPUT'], {sz: F.tiny, anc: 'middle', fill: '#2E7D32'}));

    // Utility → ATS NORM input (vertical drop from bus)
    const utilDropX = genAtsCX - 44;
    parts.push(ln(utilDropX, BUS_Y + 36, utilDropX, genAtsCY, {stroke: BLK, sw: SW_MED}));
    parts.push(txt(utilDropX - 4, (BUS_Y + 36 + genAtsCY) / 2, 'UTILITY', {sz: F.tiny, anc: 'end', fill: '#444'}));

    // ATS LOAD output → MSP (vertical rise back to bus)
    const atsLoadX = genAtsCX + 55;
    parts.push(ln(atsLoadX, genAtsCY, atsLoadX, BUS_Y + 36, {stroke: '#E65100', sw: SW_MED}));
    parts.push(tspan(atsLoadX + 6, genAtsCY - 20, ['#4 AWG THWN-2', 'ATS \u2192 MSP'], {sz: F.tiny, anc: 'start', fill: '#E65100'}));

    // NEC 702.5 note
    parts.push(txt(genAtsCX, genAtsCY + 55, 'NEC 702.5 \u2014 TRANSFER EQUIPMENT REQUIRED', {sz: F.tiny, anc: 'middle', italic: true, fill: '#E65100'}));
  }

"""

assert old_bat_gen_block in src, "Battery/gen block not found"
src = src.replace(old_bat_gen_block, new_bat_gen_block, 1)
print("OK Step 4: Battery/BUI/Generator/ATS block replaced with correct topology")

# ─── 5. Update NODE 7 UTILITY METER to use buiRX instead of mspRX ─────────────
# The utility meter wire should come from buiRX (right edge of BUI if present, else MSP)
old_meter_wire = "    const {lines, cnt} = runLines(run, fb);\n    parts.push(wireSeg(mspRX, utilCX-mR-10, BUS_Y, lines, {bundleCount:cnt}));\n  }\n\n  // Meter symbol"
new_meter_wire = "    const {lines, cnt} = runLines(run, fb);\n    parts.push(wireSeg(buiRX, utilCX-mR-10, BUS_Y, lines, {bundleCount:cnt}));\n  }\n\n  // Meter symbol"

if old_meter_wire in src:
    src = src.replace(old_meter_wire, new_meter_wire, 1)
    print("OK Step 5: Utility meter wire now starts from buiRX")
else:
    print("WARNING: Meter wire anchor not found — trying alternate")
    # Try to find it differently
    old_meter_wire2 = "parts.push(wireSeg(mspRX, utilCX-mR-10, BUS_Y, lines, {bundleCount:cnt}));"
    new_meter_wire2 = "parts.push(wireSeg(buiRX, utilCX-mR-10, BUS_Y, lines, {bundleCount:cnt}));"
    if old_meter_wire2 in src:
        src = src.replace(old_meter_wire2, new_meter_wire2, 1)
        print("OK Step 5 (alt): Utility meter wire updated")
    else:
        print("ERROR: Could not find meter wire to update")

# ─── 6. Initialize buiRX before NODE 6 MSP ────────────────────────────────────
# buiRX needs to be declared before the battery block uses it
# It's initialized in the battery block, but we need a default before NODE 7
old_msp_rx_decl = "  let mspRX: number;\n  let mspBusY = BUS_Y;"
new_msp_rx_decl = "  let mspRX: number;\n  let mspBusY = BUS_Y;\n  let buiRX: number; // right edge of BUI (or MSP if no battery)"

if old_msp_rx_decl in src:
    src = src.replace(old_msp_rx_decl, new_msp_rx_decl, 1)
    print("OK Step 6: buiRX declared before NODE 6 MSP")
else:
    print("WARNING: mspRX declaration not found")

# ─── 7. Set buiRX = mspRX after MSP rendering (default when no battery) ───────
old_msp_segment = "  // SEGMENT: AC Disco → MSP\n  {\n    const run = discoMspRun;"
new_msp_segment = "  // SEGMENT: AC Disco → MSP\n  buiRX = mspRX; // default: no BUI, wire goes directly to meter\n  {\n    const run = discoMspRun;"

if old_msp_segment in src:
    src = src.replace(old_msp_segment, new_msp_segment, 1)
    print("OK Step 7: buiRX default set after MSP rendering")
else:
    print("WARNING: MSP segment anchor not found")

# ─── 8. Update 120% rule to include battery backfeed amps ─────────────────────
old_120_rule = "      ['120% Rule',`${input.mainPanelAmps*1.2 >= input.mainPanelAmps+pvBreakerAmps ? 'PASS \\u2713':'FAIL \\u2717'}`] as [string,string],"
new_120_rule = "      ['120% Rule',`${input.mainPanelAmps*1.2 >= input.mainPanelAmps+pvBreakerAmps+(input.batteryBackfeedA??0) ? 'PASS \\u2713':'FAIL \\u2717'} (PV:${pvBreakerAmps}A${(input.batteryBackfeedA??0)>0?'+Bat:'+input.batteryBackfeedA+'A':''})`] as [string,string],"

if old_120_rule in src:
    src = src.replace(old_120_rule, new_120_rule, 1)
    print("OK Step 8: 120% rule updated to include battery backfeed amps")
else:
    print("WARNING: 120% rule not found with exact match")

# ─── 9. Update backfed 120% rule too ─────────────────────────────────────────
old_120_backfed = "      ['120% Rule',`${input.mainPanelAmps*1.2 >= input.mainPanelAmps+input.backfeedAmps ? 'PASS \\u2713':'FAIL \\u2717'}`] as [string,string],"
new_120_backfed = "      ['120% Rule',`${input.mainPanelAmps*1.2 >= input.mainPanelAmps+input.backfeedAmps+(input.batteryBackfeedA??0) ? 'PASS \\u2713':'FAIL \\u2717'} (PV:${input.backfeedAmps}A${(input.batteryBackfeedA??0)>0?'+Bat:'+input.batteryBackfeedA+'A':''})`] as [string,string],"

if old_120_backfed in src:
    src = src.replace(old_120_backfed, new_120_backfed, 1)
    print("OK Step 9: Backfed 120% rule updated")
else:
    print("WARNING: Backfed 120% rule not found")

# ─── Write ────────────────────────────────────────────────────────────────────
with open('lib/sld-professional-renderer.ts', 'w', encoding='utf-8') as f:
    f.write(src)

print(f"\nALL DONE - renderer patched: {len(src)} chars")