#!/usr/bin/env python3
"""v58.16 Phase 3 — Sol-Ark, Growatt, Solis, APsystems, Hoymiles device illustrations.

Scope decision:
  - Sol-Ark    : hybrid inverter + BUI (Smart Load Center)
  - Growatt    : hybrid inverter + battery (ARK LV) + BUI (ATS)
  - Solis      : hybrid inverter only (battery is third-party)
  - APsystems  : microinverter only (MLPE vendor, no first-party battery)
  - Hoymiles   : microinverter only (microinverter leader, battery too nascent)
  - Tigo       : deferred — pure MLPE/optimizer vendor, covered by brand emblem

Phase 3 ships 7 new illustrations, bringing registry to 21 entries total.
"""

PATH = 'lib/sld-device-illustrations.ts'
with open(PATH, 'r', encoding='utf-8') as f:
    src = f.read()

PHASE3_FUNCTIONS = '''// ----- Sol-Ark 15K-2P-N Hybrid Inverter ------------------------------------
// Grey outdoor-rated cabinet, black display window, large ventilation grille on
// the right side. Sol-Ark's signature bright-blue brand plate near the top.
function renderSolArkHybridInverter(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 92;
  const nativeH = 120;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // Outdoor grey cabinet
  parts.push(rect(x, y, W, H, '#555A5E', '#1a1a1a', 0.8, Math.max(1.5, W * 0.03)));
  // Lighter grey front face plate
  parts.push(rect(x + W * 0.06, y + H * 0.05, W * 0.88, H * 0.9, '#6E7479', '#2b2b2b', 0.5, Math.max(1.2, W * 0.025)));
  // Top brand plate (Sol-Ark blue)
  parts.push(rect(x + W * 0.1, y + H * 0.08, W * 0.8, H * 0.09, '#0A66C2', '#074B8F', 0.4, 1.5));
  parts.push(textSvg(x + W / 2, y + H * 0.14, 'Sol-Ark', {
    size: Math.max(3.2, H * 0.04),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Display window
  parts.push(rect(x + W * 0.12, y + H * 0.22, W * 0.5, H * 0.18, '#0C1218', '#000', 0.5, 1.5));
  parts.push(textSvg(x + W * 0.37, y + H * 0.3, '15K-2P-N', {
    size: Math.max(2.4, H * 0.025),
    fill: '#2ECC71',
    bold: true,
  }));
  parts.push(textSvg(x + W * 0.37, y + H * 0.365, 'HYBRID', {
    size: Math.max(2, H * 0.022),
    fill: '#2ECC71',
    bold: false,
  }));
  // LED status dots
  for (let i = 0; i < 3; i++) {
    const lx = x + W * 0.72 + i * W * 0.055;
    const colors = ['#2ECC71', '#F39C12', '#E74C3C'];
    parts.push(circleSvg(lx, y + H * 0.26, Math.max(0.8, W * 0.012), colors[i], '#000', 0.3));
  }
  // Right-side ventilation grille
  const ventX = x + W * 0.7;
  const ventY = y + H * 0.45;
  const ventW = W * 0.22;
  const ventH = H * 0.4;
  parts.push(rect(ventX, ventY, ventW, ventH, '#3A3E42', '#1a1a1a', 0.4, 1));
  for (let i = 0; i < 8; i++) {
    const ly = ventY + ventH * 0.08 + i * ventH * 0.1;
    parts.push(line(ventX + ventW * 0.1, ly, ventX + ventW * 0.9, ly, '#1a1a1a', 0.3));
  }
  // Left-side info / regulatory label area
  parts.push(rect(x + W * 0.12, y + H * 0.5, W * 0.5, H * 0.35, '#7E8388', '#4a4a4a', 0.3, 1));
  parts.push(textSvg(x + W * 0.37, y + H * 0.57, 'UL 1741-SB', {
    size: Math.max(2, H * 0.02),
    fill: '#FFFFFF',
    bold: false,
  }));
  parts.push(textSvg(x + W * 0.37, y + H * 0.62, '48V DC BATT', {
    size: Math.max(1.9, H * 0.019),
    fill: '#E0E4E8',
    bold: false,
  }));
  parts.push(textSvg(x + W * 0.37, y + H * 0.67, '240V SPLIT-\u03C6', {
    size: Math.max(1.9, H * 0.019),
    fill: '#E0E4E8',
    bold: false,
  }));
  return `<g data-device="solark-15k-2p-n">${parts.join('')}</g>`;
}

// ----- Sol-Ark Smart Load Center (BUI) -------------------------------------
// Grey metal enclosure, hinged door with Sol-Ark brand plate, row of breakers
// visible through service window, heavy blue trim.
function renderSolArkSmartLoadCenter(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 80;
  const nativeH = 104;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // Metal enclosure
  parts.push(rect(x, y, W, H, '#6E7479', '#1a1a1a', 0.8, Math.max(1.2, W * 0.03)));
  // Door plate (slightly inset)
  parts.push(rect(x + W * 0.05, y + H * 0.05, W * 0.9, H * 0.9, '#7E8388', '#3a3a3a', 0.5, 1.5));
  // Blue brand plate at top
  parts.push(rect(x + W * 0.1, y + H * 0.08, W * 0.8, H * 0.1, '#0A66C2', '#074B8F', 0.4, 1.5));
  parts.push(textSvg(x + W / 2, y + H * 0.135, 'Sol-Ark', {
    size: Math.max(3, H * 0.038),
    fill: '#FFFFFF',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.165, 'SMART LOAD CENTER', {
    size: Math.max(1.8, H * 0.022),
    fill: '#BCD4F0',
    bold: false,
  }));
  // Breaker service window
  parts.push(rect(x + W * 0.12, y + H * 0.25, W * 0.76, H * 0.6, '#2B2F33', '#0a0a0a', 0.5, 1.5));
  // Breaker rows (2 columns x 6 rows of mini breakers)
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 2; col++) {
      const bx = x + W * 0.15 + col * W * 0.36;
      const by = y + H * 0.28 + row * H * 0.09;
      parts.push(rect(bx, by, W * 0.32, H * 0.065, '#D5D8DB', '#2a2a2a', 0.3, 0.8));
      // Breaker switch handle
      parts.push(rect(bx + W * 0.14, by + H * 0.013, W * 0.04, H * 0.04, '#E74C3C', '#8B0000', 0.3, 0.3));
    }
  }
  // Status LED bar bottom
  parts.push(rect(x + W * 0.12, y + H * 0.88, W * 0.76, H * 0.05, '#0C1218', '#000', 0.4, 0.8));
  for (let i = 0; i < 4; i++) {
    const lx = x + W * 0.2 + i * W * 0.18;
    parts.push(circleSvg(lx, y + H * 0.905, Math.max(0.7, W * 0.01), '#2ECC71', '#000', 0.3));
  }
  return `<g data-device="solark-smart-load-center">${parts.join('')}</g>`;
}

// ----- Growatt SPH Hybrid Inverter -----------------------------------------
// White plastic cabinet with blue Growatt trim, colour LCD, orange accent arc.
function renderGrowattSPHInverter(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 88;
  const nativeH = 120;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // White cabinet
  parts.push(rect(x, y, W, H, '#F4F6F8', '#B0B4B8', 0.8, Math.max(1.5, W * 0.04)));
  // Top orange accent band (Growatt signature)
  parts.push(rect(x + W * 0.04, y + H * 0.04, W * 0.92, H * 0.07, '#F68B1E', '#C86A0E', 0.4, 1.5));
  // Wordmark on orange band
  parts.push(textSvg(x + W / 2, y + H * 0.088, 'GROWATT', {
    size: Math.max(3, H * 0.036),
    fill: '#FFFFFF',
    bold: true,
  }));
  // LCD display window
  parts.push(rect(x + W * 0.1, y + H * 0.16, W * 0.8, H * 0.22, '#1D2A3A', '#0B141F', 0.5, 1.5));
  parts.push(textSvg(x + W / 2, y + H * 0.23, 'SPH 10000TL3 BH-UP', {
    size: Math.max(2.4, H * 0.026),
    fill: '#7FD4FF',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.29, '10.0 kW HYBRID', {
    size: Math.max(2.2, H * 0.023),
    fill: '#FFFFFF',
    bold: false,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.34, 'PV  BAT  GRID  LOAD', {
    size: Math.max(1.8, H * 0.02),
    fill: '#7FD4FF',
    bold: false,
  }));
  // Control button row
  for (let i = 0; i < 4; i++) {
    const bx = x + W * 0.18 + i * W * 0.16;
    parts.push(circleSvg(bx, y + H * 0.43, Math.max(1.2, W * 0.02), '#D5D8DB', '#6a6a6a', 0.4));
  }
  // Lower vent area (grey panel)
  parts.push(rect(x + W * 0.08, y + H * 0.5, W * 0.84, H * 0.42, '#E0E4E8', '#9a9ea2', 0.4, 1.5));
  // Horizontal vent slats
  for (let i = 0; i < 10; i++) {
    const ly = y + H * 0.54 + i * H * 0.035;
    parts.push(line(x + W * 0.12, ly, x + W * 0.88, ly, '#9a9ea2', 0.3));
  }
  return `<g data-device="growatt-sph-10000tl3">${parts.join('')}</g>`;
}

// ----- Growatt ARK LV Battery ----------------------------------------------
// Stackable 2.56 kWh LFP modules in a white tower with orange trim accents.
function renderGrowattARKBattery(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 62;
  const nativeH = 120;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // Base plinth
  parts.push(rect(x, y + H * 0.93, W, H * 0.07, '#4A4E52', '#1a1a1a', 0.6, 1));
  // BMS head unit (top, orange accent)
  parts.push(rect(x + W * 0.04, y, W * 0.92, H * 0.14, '#F68B1E', '#C86A0E', 0.6, Math.max(1.2, W * 0.04)));
  parts.push(textSvg(x + W / 2, y + H * 0.06, 'GROWATT', {
    size: Math.max(2.6, H * 0.03),
    fill: '#FFFFFF',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.105, 'ARK BMS', {
    size: Math.max(2.2, H * 0.023),
    fill: '#FFE4C0',
    bold: false,
  }));
  // 4 battery modules
  const modTop = y + H * 0.16;
  const stackH = H * 0.75;
  const modH = stackH / 4;
  for (let i = 0; i < 4; i++) {
    const my = modTop + i * modH;
    parts.push(rect(x + W * 0.04, my, W * 0.92, modH * 0.95, '#F4F6F8', '#B0B4B8', 0.6, 1.5));
    // Module label
    parts.push(textSvg(x + W / 2, my + modH * 0.42, 'ARK 2.5L', {
      size: Math.max(2, H * 0.022),
      fill: '#F68B1E',
      bold: true,
    }));
    parts.push(textSvg(x + W / 2, my + modH * 0.68, '2.56 kWh LFP', {
      size: Math.max(1.8, H * 0.018),
      fill: '#6a6a6a',
      bold: false,
    }));
    // LED indicator
    parts.push(circleSvg(x + W * 0.1, my + modH * 0.2, Math.max(0.7, W * 0.015), '#2ECC71', '#000', 0.3));
  }
  return `<g data-device="growatt-ark-lv">${parts.join('')}</g>`;
}

// ----- Growatt ATS / Smart Energy Manager (BUI) -----------------------------
function renderGrowattATS(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 76;
  const nativeH = 96;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // White cabinet
  parts.push(rect(x, y, W, H, '#F4F6F8', '#B0B4B8', 0.8, Math.max(1.2, W * 0.03)));
  // Orange top trim
  parts.push(rect(x + W * 0.04, y + H * 0.04, W * 0.92, H * 0.1, '#F68B1E', '#C86A0E', 0.4, 1.2));
  parts.push(textSvg(x + W / 2, y + H * 0.095, 'GROWATT', {
    size: Math.max(2.8, H * 0.034),
    fill: '#FFFFFF',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.155, 'ATS-S 200A', {
    size: Math.max(2.2, H * 0.024),
    fill: '#8a8a8a',
    bold: false,
  }));
  // Transfer-switch indicator lamps
  const lampY = y + H * 0.26;
  const lampLabels = ['GRID', 'GEN', 'LOAD'];
  const lampCols = ['#2ECC71', '#F39C12', '#3498DB'];
  for (let i = 0; i < 3; i++) {
    const lx = x + W * 0.22 + i * W * 0.28;
    parts.push(circleSvg(lx, lampY, Math.max(1.5, W * 0.028), lampCols[i], '#000', 0.4));
    parts.push(textSvg(lx, lampY + H * 0.06, lampLabels[i], {
      size: Math.max(1.8, H * 0.019),
      fill: '#4a4a4a',
      bold: true,
    }));
  }
  // Service window
  parts.push(rect(x + W * 0.1, y + H * 0.42, W * 0.8, H * 0.48, '#D8DCE0', '#7a7e82', 0.4, 1.5));
  // Contactor bank (simplified)
  for (let i = 0; i < 3; i++) {
    const bx = x + W * 0.16 + i * W * 0.24;
    parts.push(rect(bx, y + H * 0.48, W * 0.18, H * 0.32, '#3A3E42', '#1a1a1a', 0.4, 1));
    parts.push(rect(bx + W * 0.03, y + H * 0.52, W * 0.12, H * 0.08, '#E74C3C', '#8B0000', 0.3, 0.5));
  }
  return `<g data-device="growatt-ats-s">${parts.join('')}</g>`;
}

// ----- Solis S6-EH1P Hybrid Inverter ---------------------------------------
// Black-grey cabinet, compact square-ish form, red Solis accent.
function renderSolisHybridInverter(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 86;
  const nativeH = 110;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // Anthracite cabinet
  parts.push(rect(x, y, W, H, '#2D3136', '#0c0c0c', 0.8, Math.max(1.5, W * 0.04)));
  // Top red accent band (Solis signature)
  parts.push(rect(x + W * 0.04, y + H * 0.04, W * 0.92, H * 0.08, '#E60012', '#9E0008', 0.4, 1.5));
  parts.push(textSvg(x + W / 2, y + H * 0.093, 'Solis', {
    size: Math.max(3.2, H * 0.04),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Model label beneath brand
  parts.push(textSvg(x + W / 2, y + H * 0.15, 'S6-EH1P-L 7.6K', {
    size: Math.max(2.2, H * 0.024),
    fill: '#D5D8DB',
    bold: false,
  }));
  // LCD display
  parts.push(rect(x + W * 0.1, y + H * 0.2, W * 0.8, H * 0.24, '#0C1218', '#000', 0.5, 1.5));
  parts.push(textSvg(x + W / 2, y + H * 0.27, '7.6 kW', {
    size: Math.max(3, H * 0.036),
    fill: '#7FD4FF',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.33, 'HYBRID \u00B7 2 MPPT', {
    size: Math.max(2, H * 0.022),
    fill: '#C0D4E0',
    bold: false,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.39, 'UL 1741-SB', {
    size: Math.max(1.8, H * 0.02),
    fill: '#888',
    bold: false,
  }));
  // Button row
  for (let i = 0; i < 4; i++) {
    const bx = x + W * 0.2 + i * W * 0.2;
    parts.push(circleSvg(bx, y + H * 0.5, Math.max(1.2, W * 0.02), '#4a4a4a', '#0a0a0a', 0.4));
  }
  // Lower heatsink fins
  const finTop = y + H * 0.58;
  const finH = H * 0.37;
  parts.push(rect(x + W * 0.06, finTop, W * 0.88, finH, '#1F2327', '#0a0a0a', 0.4, 1));
  for (let i = 0; i < 9; i++) {
    const ly = finTop + finH * 0.08 + i * finH * 0.1;
    parts.push(line(x + W * 0.1, ly, x + W * 0.9, ly, '#4a4a4a', 0.3));
  }
  return `<g data-device="solis-s6-eh1p">${parts.join('')}</g>`;
}

// ----- APsystems DS3 Microinverter -----------------------------------------
// Compact black module with blue APsystems badge, dual-module (2-up) micro.
function renderAPsystemsDS3Micro(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 130;
  const nativeH = 70;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // Dark puck body (wider aspect, dual-module)
  parts.push(rect(x + W * 0.06, y + H * 0.18, W * 0.88, H * 0.64, '#1D232C', '#000', 0.8, Math.max(2, H * 0.07)));
  // Blue brand stripe
  parts.push(rect(x + W * 0.1, y + H * 0.23, W * 0.8, H * 0.08, '#00A0E4', '#0072B2', 0.3, 1));
  parts.push(textSvg(x + W / 2, y + H * 0.295, 'APsystems', {
    size: Math.max(2.8, H * 0.078),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Model + rating
  parts.push(textSvg(x + W / 2, y + H * 0.45, 'DS3-L / DS3-H', {
    size: Math.max(3, H * 0.1),
    fill: '#00A0E4',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.58, '2 x 440 W \u00B7 240V AC', {
    size: Math.max(2.4, H * 0.068),
    fill: '#BFC6CF',
    bold: false,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.72, 'UL 1741-SB \u00B7 RSD', {
    size: Math.max(2.2, H * 0.058),
    fill: '#888',
    bold: false,
  }));
  // Dual DC pigtails (left side - module A)
  parts.push(line(x + W * 0.02, y + H * 0.32, x + W * 0.06, y + H * 0.32, '#CC0000', 0.8));
  parts.push(line(x + W * 0.02, y + H * 0.42, x + W * 0.06, y + H * 0.42, '#111', 0.8));
  // Dual DC pigtails (left side - module B)
  parts.push(line(x + W * 0.02, y + H * 0.58, x + W * 0.06, y + H * 0.58, '#CC0000', 0.8));
  parts.push(line(x + W * 0.02, y + H * 0.68, x + W * 0.06, y + H * 0.68, '#111', 0.8));
  // AC trunk lead (right side)
  parts.push(line(x + W * 0.94, y + H * 0.5, x + W * 0.99, y + H * 0.5, '#1a1a1a', 1.2));
  parts.push(circleSvg(x + W * 0.99, y + H * 0.5, Math.max(1.2, W * 0.012), '#333', '#000', 0.3));
  return `<g data-device="apsystems-ds3">${parts.join('')}</g>`;
}

// ----- Hoymiles HMS Microinverter ------------------------------------------
// Compact dark module with bright green Hoymiles accent, 2-in-1 micro.
function renderHoymilesHMSMicro(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 125;
  const nativeH = 70;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // Dark puck body
  parts.push(rect(x + W * 0.06, y + H * 0.18, W * 0.88, H * 0.64, '#1E2428', '#000', 0.8, Math.max(2, H * 0.07)));
  // Green Hoymiles accent stripe
  parts.push(rect(x + W * 0.1, y + H * 0.23, W * 0.8, H * 0.08, '#78BE20', '#4E8A0C', 0.3, 1));
  parts.push(textSvg(x + W / 2, y + H * 0.295, 'Hoymiles', {
    size: Math.max(2.8, H * 0.078),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Model + rating
  parts.push(textSvg(x + W / 2, y + H * 0.45, 'HMS-2000DW-4T', {
    size: Math.max(3, H * 0.09),
    fill: '#78BE20',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.58, '2000 W \u00B7 4-in-1 \u00B7 240V', {
    size: Math.max(2.4, H * 0.068),
    fill: '#BFC6CF',
    bold: false,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.72, 'UL 1741-SB \u00B7 RSD', {
    size: Math.max(2.2, H * 0.058),
    fill: '#888',
    bold: false,
  }));
  // Four DC pigtails (4-in-1 micro)
  for (let i = 0; i < 4; i++) {
    const py = y + H * 0.3 + i * H * 0.12;
    const posColor = i % 2 === 0 ? '#CC0000' : '#111';
    parts.push(line(x + W * 0.02, py, x + W * 0.06, py, posColor, 0.8));
  }
  // AC trunk lead (right)
  parts.push(line(x + W * 0.94, y + H * 0.5, x + W * 0.99, y + H * 0.5, '#1a1a1a', 1.2));
  parts.push(circleSvg(x + W * 0.99, y + H * 0.5, Math.max(1.2, W * 0.012), '#333', '#000', 0.3));
  return `<g data-device="hoymiles-hms-2000dw">${parts.join('')}</g>`;
}

'''

anchor = "// \u2500\u2500\u2500 Registry "
assert anchor in src, "registry anchor not found"
src = src.replace(anchor, PHASE3_FUNCTIONS + anchor, 1)

# Find end of Generac PWRmanager entry (last entry currently) and inject 7 new entries before };
end_anchor = "    render: renderGeneracPWRmanager,\n  },\n};"
assert end_anchor in src, "registry end anchor not found (expected Generac PWRmanager as last entry)"

new_entries = """    render: renderGeneracPWRmanager,
  },
  'solark::inverter': {
    brand: 'solark',
    kind: 'inverter',
    label: 'Sol-Ark 15K-2P-N Hybrid Inverter',
    sub: '15 kW hybrid \u00B7 48V batt \u00B7 UL 1741-SB',
    aspectW: 92,
    aspectH: 120,
    render: renderSolArkHybridInverter,
  },
  'solark::bui': {
    brand: 'solark',
    kind: 'bui',
    label: 'Sol-Ark Smart Load Center',
    sub: 'Integrated BUI \u00B7 200A \u00B7 whole-home backup',
    aspectW: 80,
    aspectH: 104,
    render: renderSolArkSmartLoadCenter,
  },
  'growatt::inverter': {
    brand: 'growatt',
    kind: 'inverter',
    label: 'Growatt SPH 10000TL3 BH-UP',
    sub: '10 kW hybrid \u00B7 3-phase \u00B7 UL 1741-SB',
    aspectW: 88,
    aspectH: 120,
    render: renderGrowattSPHInverter,
  },
  'growatt::battery': {
    brand: 'growatt',
    kind: 'battery',
    label: 'Growatt ARK LV Battery',
    sub: '2.56 kWh LFP modules \u00B7 stackable up to 25.6 kWh',
    aspectW: 62,
    aspectH: 120,
    render: renderGrowattARKBattery,
  },
  'growatt::bui': {
    brand: 'growatt',
    kind: 'bui',
    label: 'Growatt ATS-S 200A',
    sub: 'Whole-home transfer switch \u00B7 UL 1008',
    aspectW: 76,
    aspectH: 96,
    render: renderGrowattATS,
  },
  'solis::inverter': {
    brand: 'solis',
    kind: 'inverter',
    label: 'Solis S6-EH1P-L 7.6kW Hybrid',
    sub: '7.6 kW hybrid \u00B7 2 MPPT \u00B7 UL 1741-SB',
    aspectW: 86,
    aspectH: 110,
    render: renderSolisHybridInverter,
  },
  'apsystems::inverter': {
    brand: 'apsystems',
    kind: 'inverter',
    label: 'APsystems DS3 Dual Microinverter',
    sub: '2 x 440 W \u00B7 240V \u00B7 per-pair module-level',
    aspectW: 130,
    aspectH: 70,
    render: renderAPsystemsDS3Micro,
  },
  'hoymiles::inverter': {
    brand: 'hoymiles',
    kind: 'inverter',
    label: 'Hoymiles HMS-2000DW-4T Microinverter',
    sub: '2000 W \u00B7 4-in-1 \u00B7 240V split-phase',
    aspectW: 125,
    aspectH: 70,
    render: renderHoymilesHMSMicro,
  },
};"""

src = src.replace(end_anchor, new_entries, 1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(src)
print("OK - Phase 3 (8 new illustrations) added")
print("    Registry now ships 22 entries across 8 brands")