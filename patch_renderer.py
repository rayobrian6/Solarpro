import re

with open('lib/sld-professional-renderer.ts', 'r') as f:
    content = f.read()

# ── 1. renderGenerator: add genOutX/genOutY terminal returns ──────────────────
old_gen = '''\
// Generator Symbol (IEEE 315 / ANSI) - circle with G inside
function renderGenerator(
  cx: number, cy: number,
  brand: string, model: string, kw: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number} {
  const GEN_CLR = \'#2E7D32\';
  const r = 30;
  const p: string[] = [];

  p.push(circ(cx, cy, r, {fill: WHT, stroke: GEN_CLR, sw: SW_MED}));
  p.push(txt(cx, cy + 4, \'G\', {sz: 16, bold: true, anc: \'middle\', fill: GEN_CLR}));
  const swPath = `M${cx-8},${cy+12} Q${cx-4},${cy+8} ${cx},${cy+12} Q${cx+4},${cy+16} ${cx+8},${cy+12}`;
  p.push(`<path d=\&quot;${swPath}\&quot; fill=\&quot;none\&quot; stroke=\&quot;${GEN_CLR}\&quot; stroke-width=\&quot;${SW_THIN}\&quot;/>`);

  p.push(lug(cx + r, cy));
  p.push(ln(cx + r, cy, cx + r + 10, cy, {stroke: GEN_CLR, sw: SW_MED}));

  p.push(txt(cx, cy - r - 18, \'STANDBY GENERATOR\', {sz: F.hdr, bold: true, anc: \'middle\', fill: GEN_CLR}));
  p.push(txt(cx, cy - r - 8, `${brand} ${model}`.trim() || \'GENERATOR\', {sz: F.sub, anc: \'middle\', fill: GEN_CLR}));
  p.push(txt(cx, cy + r + 9, kw > 0 ? `${kw} kW / ${Math.round(kw*1000/240)}A` : \'\', {sz: F.tiny, anc: \'middle\', fill: GEN_CLR}));
  p.push(txt(cx, cy + r + 18, \'NEC 702.5 \\\\u2014 TRANSFER EQUIP. REQ.\', {sz: F.tiny, anc: \'middle\', italic: true, fill: GEN_CLR}));
  p.push(callout(cx + r + 14, cy - r - 5, calloutN));

  return {svg: p.join(\'\'), lx: cx - r, rx: cx + r + 10, ty: cy - r, by: cy + r};
}'''

new_gen = '''\
// Generator Symbol (IEEE 315 / ANSI) - circle with G inside
// Terminal GEN_OUT: right side lug — AC output connecting to ATS GEN or BUI GEN port
function renderGenerator(
  cx: number, cy: number,
  brand: string, model: string, kw: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number;
    genOutX: number; genOutY: number} {
  const GEN_CLR = \'#2E7D32\';
  const r = 30;
  const p: string[] = [];

  p.push(circ(cx, cy, r, {fill: WHT, stroke: GEN_CLR, sw: SW_MED}));
  p.push(txt(cx, cy + 4, \'G\', {sz: 16, bold: true, anc: \'middle\', fill: GEN_CLR}));
  const swPath = `M${cx-8},${cy+12} Q${cx-4},${cy+8} ${cx},${cy+12} Q${cx+4},${cy+16} ${cx+8},${cy+12}`;
  p.push(`<path d=\&quot;${swPath}\&quot; fill=\&quot;none\&quot; stroke=\&quot;${GEN_CLR}\&quot; stroke-width=\&quot;${SW_THIN}\&quot;/>`);

  // GEN_OUT terminal — right side lug (wire exits rightward to ATS GEN or BUI GEN port)
  const genOutX = cx + r + 10;
  const genOutY = cy;
  p.push(lug(cx + r, cy));
  p.push(ln(cx + r, cy, genOutX, cy, {stroke: GEN_CLR, sw: SW_MED}));
  p.push(txt(cx + r + 2, cy - 7, \'GEN OUT\', {sz: 4, anc: \'start\', fill: GEN_CLR}));

  p.push(txt(cx, cy - r - 18, \'STANDBY GENERATOR\', {sz: F.hdr, bold: true, anc: \'middle\', fill: GEN_CLR}));
  p.push(txt(cx, cy - r - 8, `${brand} ${model}`.trim() || \'GENERATOR\', {sz: F.sub, anc: \'middle\', fill: GEN_CLR}));
  p.push(txt(cx, cy + r + 9, kw > 0 ? `${kw} kW / ${Math.round(kw*1000/240)}A` : \'\', {sz: F.tiny, anc: \'middle\', fill: GEN_CLR}));
  p.push(txt(cx, cy + r + 18, \'NEC 702.5 \\\\u2014 TRANSFER EQUIP. REQ.\', {sz: F.tiny, anc: \'middle\', italic: true, fill: GEN_CLR}));
  p.push(callout(cx + r + 14, cy - r - 5, calloutN));

  return {svg: p.join(\'\'), lx: cx - r, rx: genOutX, ty: cy - r, by: cy + r,
          genOutX, genOutY};
}'''

if old_gen in content:
    content = content.replace(old_gen, new_gen)
    print("✅ renderGenerator updated")
else:
    print("❌ renderGenerator old string NOT found")

# ── 2. renderATS: add utilInX/Y, genInX/Y, loadOutX/Y terminal returns ────────
old_ats_sig = '): {svg: string; lx: number; rx: number; ty: number; by: number} {\n  const W2 = 90, H2 = 68;'
new_ats_sig = '): {svg: string; lx: number; rx: number; ty: number; by: number;\n    utilInX: number; utilInY: number; genInX: number; genInY: number;\n    loadOutX: number; loadOutY: number} {\n  const W2 = 90, H2 = 68;'

if old_ats_sig in content:
    content = content.replace(old_ats_sig, new_ats_sig, 1)
    print("✅ renderATS signature updated")
else:
    print("❌ renderATS signature NOT found")

# ── 3. renderATS: update return statement ─────────────────────────────────────
old_ats_ret = "  return {svg: p.join(''), lx: bx - 10, rx: bx + W2 + 10, ty: by2, by: by2 + H2};\n}\n\n// Backup Sub-Panel Symbol"
new_ats_ret = """  // Terminal coordinates for segment routing
  const utilInX = bx;          // UTIL input — left edge, upper
  const utilInY = cy - 12;
  const genInX  = bx;          // GEN input — left edge, lower
  const genInY  = cy + 12;
  const loadOutX = bx + W2;    // LOAD output — right edge, center
  const loadOutY = cy;
  return {svg: p.join(''), lx: bx - 10, rx: bx + W2 + 10, ty: by2, by: by2 + H2,
          utilInX, utilInY, genInX, genInY, loadOutX, loadOutY};
}

// Backup Sub-Panel Symbol"""

if old_ats_ret in content:
    content = content.replace(old_ats_ret, new_ats_ret)
    print("✅ renderATS return updated")
else:
    print("❌ renderATS return NOT found")

# ── 4. renderDisco: add lineOutX/Y, loadInX/Y terminal returns ────────────────
old_disco_sig = '): {svg:string; lx:number; rx:number} {\n  const W2 = 90, H2 = 70;'
new_disco_sig = '): {svg:string; lx:number; rx:number;\n    loadInX:number; loadInY:number; lineOutX:number; lineOutY:number} {\n  const W2 = 90, H2 = 70;'

if old_disco_sig in content:
    content = content.replace(old_disco_sig, new_disco_sig, 1)
    print("✅ renderDisco signature updated")
else:
    print("❌ renderDisco signature NOT found")

old_disco_ret = "  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10};\n}\n\n// ── MSP Load-Side Tap"
new_disco_ret = """  // Terminal coordinates for segment routing
  const loadInX  = bx;          // LOAD terminals — left edge (PV/combiner side)
  const loadInY  = cy;           // midpoint between poleY1 and poleY2
  const lineOutX = bx + W2;     // LINE terminals — right edge (utility/MSP side)
  const lineOutY = cy;
  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10,
          loadInX, loadInY, lineOutX, lineOutY};
}

// ── MSP Load-Side Tap"""

if old_disco_ret in content:
    content = content.replace(old_disco_ret, new_disco_ret)
    print("✅ renderDisco return updated")
else:
    print("❌ renderDisco return NOT found")

# ── 5. renderMSPLoad: add bkfdInX/Y, busOutX/Y terminal returns ───────────────
old_msp_load_sig = '): {svg:string; lx:number; rx:number} {\n  const W2 = 96, H2 = 120;'
new_msp_load_sig = '): {svg:string; lx:number; rx:number;\n    bkfdInX:number; bkfdInY:number; busOutX:number; busOutY:number} {\n  const W2 = 96, H2 = 120;'

if old_msp_load_sig in content:
    content = content.replace(old_msp_load_sig, new_msp_load_sig, 1)
    print("✅ renderMSPLoad signature updated")
else:
    print("❌ renderMSPLoad signature NOT found")

old_msp_load_ret = "  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10};\n}\n\n// ── MSP Supply-Side"
new_msp_load_ret = """  // Terminal coordinates for segment routing
  const bkfdInX = bx;           // Backfed breaker input — left edge (from AC disco)
  const bkfdInY = cy;
  const busOutX = bx + W2;      // Main bus output — right edge (to utility meter)
  const busOutY = mbY + 20;     // busY inside MSP
  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10,
          bkfdInX, bkfdInY, busOutX, busOutY};
}

// ── MSP Supply-Side"""

if old_msp_load_ret in content:
    content = content.replace(old_msp_load_ret, new_msp_load_ret)
    print("✅ renderMSPLoad return updated")
else:
    print("❌ renderMSPLoad return NOT found")

# ── 6. renderMSPSupply: add bkfdInX/Y, busOutX/Y terminal returns ─────────────
old_msp_sup_sig = '): {svg:string; lx:number; rx:number} {\n  const W2 = 96, H2 = 110;'
new_msp_sup_sig = '): {svg:string; lx:number; rx:number;\n    bkfdInX:number; bkfdInY:number; busOutX:number; busOutY:number} {\n  const W2 = 96, H2 = 110;'

if old_msp_sup_sig in content:
    content = content.replace(old_msp_sup_sig, new_msp_sup_sig, 1)
    print("✅ renderMSPSupply signature updated")
else:
    print("❌ renderMSPSupply signature NOT found")

old_msp_sup_ret = "  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10};\n}\n\n// ── Main Render"
new_msp_sup_ret = """  // Terminal coordinates for segment routing
  const bkfdInX = bx;           // Input — left edge (from AC disco or ATS)
  const bkfdInY = cy;
  const busOutX = bx + W2;      // Main bus output — right edge (to utility meter)
  const busOutY = by2 + 38;     // busY inside MSP supply
  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10,
          bkfdInX, bkfdInY, busOutX, busOutY};
}

// ── Main Render"""

if old_msp_sup_ret in content:
    content = content.replace(old_msp_sup_ret, new_msp_sup_ret)
    print("✅ renderMSPSupply return updated")
else:
    print("❌ renderMSPSupply return NOT found")

# ── 7. renderInverterBox: add dcInX/Y, acOutX/Y terminal returns ──────────────
old_inv_ret = "  return {svg: p.join(''), lx: bx-10, rx: bx+W2+10};\n}\n\n// ── Wire Segment"
new_inv_ret = """  // Terminal coordinates for segment routing
  const dcInX  = bx - 10;      // DC input lug — left edge
  const dcInY  = cy;
  const acOutX2 = bx + W2 + 10; // AC output lug — right edge
  const acOutY2 = cy;
  return {svg: p.join(''), lx: bx-10, rx: bx+W2+10,
          dcInX, dcInY, acOutX: acOutX2, acOutY: acOutY2};
}

// ── Wire Segment"""

if old_inv_ret in content:
    content = content.replace(old_inv_ret, new_inv_ret)
    print("✅ renderInverterBox return updated")
else:
    print("❌ renderInverterBox return NOT found")

old_inv_sig = '): {svg: string; lx: number; rx: number} {\n  const W2 = 96, H2 = 80;'
new_inv_sig = '): {svg: string; lx: number; rx: number;\n    dcInX: number; dcInY: number; acOutX: number; acOutY: number} {\n  const W2 = 96, H2 = 80;'

if old_inv_sig in content:
    content = content.replace(old_inv_sig, new_inv_sig, 1)
    print("✅ renderInverterBox signature updated")
else:
    print("❌ renderInverterBox signature NOT found")

# ── 8. renderCombiner: add feederOutX/Y terminal returns ──────────────────────
old_comb_sig = '): {svg:string; lx:number; rx:number; ty:number; by:number} {\n  const W2 = 80, H2 = 90;'
new_comb_sig = '): {svg:string; lx:number; rx:number; ty:number; by:number;\n    feederOutX:number; feederOutY:number} {\n  const W2 = 80, H2 = 90;'

if old_comb_sig in content:
    content = content.replace(old_comb_sig, new_comb_sig, 1)
    print("✅ renderCombiner signature updated")
else:
    print("❌ renderCombiner signature NOT found")

old_comb_ret = "  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10, ty:by2, by:by2+H2};\n}\n\n// ── AC Disconnect"
new_comb_ret = """  // Terminal coordinates for segment routing
  const feederOutX = bx + W2 + 10;  // Feeder lug output — right edge
  const feederOutY = cy + 8;         // busY inside combiner
  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10, ty:by2, by:by2+H2,
          feederOutX, feederOutY};
}

// ── AC Disconnect"""

if old_comb_ret in content:
    content = content.replace(old_comb_ret, new_comb_ret)
    print("✅ renderCombiner return updated")
else:
    print("❌ renderCombiner return NOT found")

with open('lib/sld-professional-renderer.ts', 'w') as f:
    f.write(content)

print("\nDone.")