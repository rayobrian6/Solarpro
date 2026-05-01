#!/usr/bin/env python3
"""v58.16 Phase 2 - Enphase + SolarEdge + Generac device illustrations."""

PATH = 'lib/sld-device-illustrations.ts'
with open(PATH, 'r', encoding='utf-8') as f:
    src = f.read()

PHASE2_FUNCTIONS = '''// ----- Enphase IQ8 Microinverter -------------------------------------------
// Small black puck that mounts directly under each PV module. Oval/rectangular
// form factor, single branded face, two MC4 leads coming out one side.
function renderEnphaseIQ8Micro(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 120;
  const nativeH = 70;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // Dark puck body with rounded corners
  parts.push(rect(x + W * 0.08, y + H * 0.15, W * 0.84, H * 0.7, '#1a1a1a', '#000', 0.8, Math.max(2, H * 0.06)));
  // Subtle orange brand stripe
  parts.push(rect(x + W * 0.12, y + H * 0.2, W * 0.76, H * 0.08, '#F37021', '#C55A18', 0.3, 1));
  // Enphase wordmark
  parts.push(textSvg(x + W / 2, y + H * 0.26, 'Enphase', {
    size: Math.max(3, H * 0.08),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Label
  parts.push(textSvg(x + W / 2, y + H * 0.55, 'IQ8+ MICRO', {
    size: Math.max(3.5, H * 0.09),
    fill: '#F37021',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.7, '384 W · 240V AC', {
    size: Math.max(2.4, H * 0.06),
    fill: '#999',
    bold: false,
  }));
  // MC4 pigtails on the left (DC in from module)
  parts.push(line(x + W * 0.02, y + H * 0.4, x + W * 0.08, y + H * 0.4, '#CC0000', 0.8));
  parts.push(line(x + W * 0.02, y + H * 0.55, x + W * 0.08, y + H * 0.55, '#111', 0.8));
  parts.push(circleSvg(x + W * 0.02, y + H * 0.4, Math.max(1, W * 0.01), '#CC0000', '#000', 0.3));
  parts.push(circleSvg(x + W * 0.02, y + H * 0.55, Math.max(1, W * 0.01), '#111', '#000', 0.3));
  // AC lead on the right (to IQ cable)
  parts.push(line(x + W * 0.92, y + H * 0.5, x + W * 0.98, y + H * 0.5, '#1a1a1a', 1.0));
  parts.push(circleSvg(x + W * 0.98, y + H * 0.5, Math.max(1, W * 0.012), '#333', '#000', 0.3));
  return `<g data-device="enphase-iq8-micro">${parts.join('')}</g>`;
}

// ----- Enphase IQ Battery 5P -----------------------------------------------
// Short wide rectangular unit, horizontal orientation. Dark grey finish,
// Enphase orange accent strip, front-panel LED and side cooling vents.
function renderEnphaseIQBattery5P(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 110;
  const nativeH = 80;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // Cabinet
  parts.push(rect(x, y, W, H, '#2A2D30', '#111', 0.8, Math.max(2, W * 0.025)));
  // Orange accent strip along the top
  parts.push(rect(x + W * 0.03, y + H * 0.05, W * 0.94, H * 0.1, '#F37021', '#C55A18', 0.4, 1.5));
  parts.push(textSvg(x + W / 2, y + H * 0.12, 'Enphase', {
    size: Math.max(2.8, H * 0.055),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Side cooling vents (both sides)
  for (let i = 0; i < 5; i++) {
    const vy = y + H * (0.28 + i * 0.1);
    parts.push(line(x + W * 0.02, vy, x + W * 0.08, vy, '#555', 0.4));
    parts.push(line(x + W * 0.92, vy, x + W * 0.98, vy, '#555', 0.4));
  }
  // Front face: IQ Battery 5P label + status LED
  const faceX = x + W * 0.12;
  const faceY = y + H * 0.22;
  const faceW = W * 0.76;
  const faceH = H * 0.6;
  parts.push(rect(faceX, faceY, faceW, faceH, '#1C1F22', '#000', 0.4, 1));
  parts.push(textSvg(x + W / 2, y + H * 0.42, 'IQ Battery 5P', {
    size: Math.max(3.5, H * 0.08),
    fill: '#F37021',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.55, '5.0 kWh · 3.84 kW', {
    size: Math.max(2.6, H * 0.055),
    fill: '#bbb',
    bold: false,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.66, 'UL 9540 · LFP', {
    size: Math.max(2.2, H * 0.045),
    fill: '#888',
    bold: false,
  }));
  // Status LEDs in a row
  const ledColors = ['#4CAF50', '#4CAF50', '#FFA726', '#4A90E2'];
  for (let i = 0; i < ledColors.length; i++) {
    const lx = x + W * (0.38 + i * 0.08);
    parts.push(circleSvg(lx, y + H * 0.78, Math.max(0.6, W * 0.012), ledColors[i], '#222', 0.3));
  }
  return `<g data-device="enphase-iq-battery-5p">${parts.join('')}</g>`;
}

// ----- Enphase IQ System Controller 3 (BUI) --------------------------------
// Wall-mount controller/gateway. Slim white enclosure with an orange strip
// across the top, a small display window, and hinged service door.
function renderEnphaseIQSC3(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 76;
  const nativeH = 96;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // White body
  parts.push(rect(x, y, W, H, '#F5F5F3', '#B0B4B8', 0.7, Math.max(1.5, W * 0.04)));
  // Orange top strip
  parts.push(rect(x + W * 0.04, y + H * 0.04, W * 0.92, H * 0.09, '#F37021', '#C55A18', 0.4, 1.2));
  parts.push(textSvg(x + W / 2, y + H * 0.1, 'Enphase', {
    size: Math.max(2.6, H * 0.035),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Display window
  const dispY = y + H * 0.18;
  parts.push(rect(x + W * 0.18, dispY, W * 0.64, H * 0.14, '#0A0E12', '#000', 0.4, 1));
  parts.push(line(x + W * 0.22, dispY + H * 0.05, x + W * 0.7, dispY + H * 0.05, '#2EE6A8', 0.4));
  parts.push(line(x + W * 0.22, dispY + H * 0.1, x + W * 0.6, dispY + H * 0.1, '#2EE6A8', 0.3));
  // Service door seam
  const seamY = y + H * 0.4;
  parts.push(line(x + W * 0.06, seamY, x + W * 0.94, seamY, '#D0D4D8', 0.45));
  // Transfer switch badge panel
  parts.push(rect(x + W * 0.12, y + H * 0.48, W * 0.76, H * 0.24, '#E6E8EB', '#B0B4B8', 0.4, 1));
  parts.push(textSvg(x + W / 2, y + H * 0.56, 'IQ SYSTEM', {
    size: Math.max(2.4, H * 0.032),
    fill: '#1a1a1a',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.63, 'CONTROLLER 3', {
    size: Math.max(2.4, H * 0.032),
    fill: '#F37021',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.7, '200A · UL 1741-SB', {
    size: Math.max(2.0, H * 0.024),
    fill: '#666',
    bold: false,
  }));
  // Status LEDs
  for (let i = 0; i < 3; i++) {
    const lx = x + W * (0.35 + i * 0.1);
    const colors = ['#4CAF50', '#FFA726', '#4A90E2'];
    parts.push(circleSvg(lx, y + H * 0.8, Math.max(0.5, W * 0.016), colors[i], '#333', 0.2));
  }
  // Vent slats bottom
  for (let i = 0; i < 5; i++) {
    const vx = x + W * (0.25 + i * 0.1);
    parts.push(line(vx, y + H * 0.88, vx, y + H * 0.94, '#B0B4B8', 0.3));
  }
  return `<g data-device="enphase-iq-sc3">${parts.join('')}</g>`;
}

// ----- SolarEdge Home Hub Inverter -----------------------------------------
// Silver-white rectangular wall unit, HD-Wave family. Red accent stripe +
// display window + ventilation louvres.
function renderSolarEdgeHomeHub(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 86;
  const nativeH = 120;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // Cabinet - silver-white
  parts.push(rect(x, y, W, H, '#ECEDEF', '#B0B4B8', 0.8, Math.max(1.5, W * 0.035)));
  // Top red accent stripe
  parts.push(rect(x + W * 0.05, y + H * 0.04, W * 0.9, H * 0.06, '#E30613', '#A8040E', 0.4, 1.2));
  parts.push(textSvg(x + W / 2, y + H * 0.04 + H * 0.045, 'SolarEdge', {
    size: Math.max(2.8, H * 0.03),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Display window
  const dispX = x + W * 0.14;
  const dispY = y + H * 0.14;
  const dispW = W * 0.72;
  const dispH = H * 0.16;
  parts.push(rect(dispX, dispY, dispW, dispH, '#0A0E12', '#000', 0.4, 1));
  parts.push(line(dispX + dispW * 0.08, dispY + dispH * 0.35, dispX + dispW * 0.7, dispY + dispH * 0.35, '#2EE6A8', 0.4));
  parts.push(line(dispX + dispW * 0.08, dispY + dispH * 0.65, dispX + dispW * 0.5, dispY + dispH * 0.65, '#4A90E2', 0.3));
  // Model label under display
  parts.push(textSvg(x + W / 2, y + H * 0.34, 'Home Hub · SE7600H', {
    size: Math.max(2.4, H * 0.024),
    fill: '#444',
    bold: true,
  }));
  // HD-Wave ventilation louvres - diagonal slats
  const ventY0 = y + H * 0.4;
  const ventH = H * 0.42;
  const slatCount = 8;
  const slatGap = ventH / (slatCount + 1);
  for (let i = 1; i <= slatCount; i++) {
    const yy = ventY0 + i * slatGap;
    parts.push(line(x + W * 0.1, yy, x + W * 0.9, yy, '#B0B4B8', 0.4));
  }
  // Safety switch handle at bottom-right
  parts.push(rect(x + W * 0.78, y + H * 0.86, W * 0.14, H * 0.08, '#E30613', '#A8040E', 0.4, 1));
  parts.push(textSvg(x + W * 0.85, y + H * 0.91, 'ON', {
    size: Math.max(1.8, H * 0.02),
    fill: '#FFF',
    bold: true,
  }));
  // Model number plate bottom-left
  parts.push(textSvg(x + W * 0.08, y + H * 0.92, 'HD-Wave · UL 1741-SB', {
    size: Math.max(2.0, H * 0.02),
    fill: '#666',
    bold: false,
    anchor: 'start',
  }));
  return `<g data-device="solaredge-home-hub">${parts.join('')}</g>`;
}

// ----- SolarEdge Energy Bank Battery ---------------------------------------
// Tall grey-white cabinet pairs with Home Hub. Red accent, visible module
// stack, status LED column.
function renderSolarEdgeEnergyBank(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 66;
  const nativeH = 120;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  // Cabinet
  parts.push(rect(x, y, W, H, '#ECEDEF', '#B0B4B8', 0.8, Math.max(1.5, W * 0.04)));
  // Red top cap
  parts.push(rect(x, y, W, H * 0.09, '#E30613', '#A8040E', 0.5, Math.max(1.5, W * 0.04)));
  parts.push(textSvg(x + W / 2, y + H * 0.065, 'SolarEdge', {
    size: Math.max(2.6, H * 0.03),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Module stack (3 LFP modules)
  const stackY0 = y + H * 0.13;
  const stackH = H * 0.72;
  const modCount = 3;
  const modH = stackH / modCount;
  for (let i = 0; i < modCount; i++) {
    const my = stackY0 + i * modH;
    parts.push(rect(x + W * 0.1, my + modH * 0.06, W * 0.8, modH * 0.88, '#D5D7DA', '#999', 0.4, 1));
    parts.push(textSvg(x + W / 2, my + modH * 0.55, '4.6 kWh LFP', {
      size: Math.max(2.0, H * 0.02),
      fill: '#555',
      bold: true,
    }));
    // LED per module
    parts.push(circleSvg(x + W * 0.18, my + modH * 0.3, Math.max(0.6, W * 0.02), '#4CAF50', '#2E7D32', 0.25));
  }
  // Bottom label
  parts.push(textSvg(x + W / 2, y + H * 0.94, 'Energy Bank · 13.8 kWh', {
    size: Math.max(2.2, H * 0.022),
    fill: '#666',
    bold: false,
  }));
  return `<g data-device="solaredge-energy-bank">${parts.join('')}</g>`;
}

// ----- SolarEdge Backup Interface (BUI) ------------------------------------
// Slim wall unit that pairs with Home Hub to enable whole-home backup.
function renderSolarEdgeBackupInterface(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 72;
  const nativeH = 100;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  parts.push(rect(x, y, W, H, '#ECEDEF', '#B0B4B8', 0.7, Math.max(1.5, W * 0.04)));
  parts.push(rect(x + W * 0.04, y + H * 0.04, W * 0.92, H * 0.09, '#E30613', '#A8040E', 0.4, 1.2));
  parts.push(textSvg(x + W / 2, y + H * 0.1, 'SolarEdge', {
    size: Math.max(2.4, H * 0.032),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Transfer switch window
  const winY = y + H * 0.18;
  parts.push(rect(x + W * 0.12, winY, W * 0.76, H * 0.28, '#D5D7DA', '#999', 0.4, 1));
  // Two transfer blades
  parts.push(line(x + W * 0.18, y + H * 0.26, x + W * 0.48, y + H * 0.26, '#E30613', 1.2));
  parts.push(line(x + W * 0.52, y + H * 0.26, x + W * 0.82, y + H * 0.38, '#888', 0.8));
  parts.push(circleSvg(x + W * 0.18, y + H * 0.26, Math.max(0.8, W * 0.02), '#E30613', '#A8040E', 0.3));
  parts.push(circleSvg(x + W * 0.82, y + H * 0.26, Math.max(0.8, W * 0.02), '#FFF', '#999', 0.3));
  parts.push(textSvg(x + W / 2, y + H * 0.42, 'Transfer Switch', {
    size: Math.max(2.0, H * 0.022),
    fill: '#555',
    bold: true,
  }));
  // Info panel
  parts.push(rect(x + W * 0.12, y + H * 0.52, W * 0.76, H * 0.2, '#F8F8F6', '#CCC', 0.3, 1));
  parts.push(textSvg(x + W / 2, y + H * 0.6, 'Backup Interface', {
    size: Math.max(2.4, H * 0.025),
    fill: '#E30613',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.67, '200A · Whole-home', {
    size: Math.max(2.0, H * 0.022),
    fill: '#666',
    bold: false,
  }));
  // LEDs
  for (let i = 0; i < 3; i++) {
    const lx = x + W * (0.35 + i * 0.1);
    const colors = ['#4CAF50', '#FFA726', '#4A90E2'];
    parts.push(circleSvg(lx, y + H * 0.82, Math.max(0.5, W * 0.018), colors[i], '#333', 0.2));
  }
  return `<g data-device="solaredge-backup-interface">${parts.join('')}</g>`;
}

// ----- Generac PWRcell Inverter --------------------------------------------
// Grey cabinet with signature orange accent. Ventilation louvres + bold model.
function renderGeneracPWRcellInverter(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 90;
  const nativeH = 120;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  parts.push(rect(x, y, W, H, '#4A4D50', '#1a1a1a', 0.8, Math.max(1.5, W * 0.03)));
  // Orange accent stripe
  parts.push(rect(x + W * 0.04, y + H * 0.04, W * 0.92, H * 0.07, '#F68B1F', '#B66816', 0.4, 1.2));
  parts.push(textSvg(x + W / 2, y + H * 0.045 + H * 0.045, 'GENERAC', {
    size: Math.max(3, H * 0.034),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Display
  parts.push(rect(x + W * 0.14, y + H * 0.15, W * 0.72, H * 0.14, '#0A0E12', '#000', 0.4, 1));
  parts.push(line(x + W * 0.2, y + H * 0.2, x + W * 0.76, y + H * 0.2, '#F68B1F', 0.4));
  parts.push(line(x + W * 0.2, y + H * 0.25, x + W * 0.6, y + H * 0.25, '#FFA726', 0.3));
  // Model label
  parts.push(textSvg(x + W / 2, y + H * 0.33, 'PWRcell Inverter', {
    size: Math.max(2.6, H * 0.025),
    fill: '#F68B1F',
    bold: true,
  }));
  // Louvered vents (lower half)
  const ventY0 = y + H * 0.4;
  const ventH = H * 0.48;
  for (let i = 0; i < 12; i++) {
    const yy = ventY0 + (i + 1) * (ventH / 13);
    parts.push(line(x + W * 0.1, yy, x + W * 0.9, yy, '#777', 0.5));
  }
  // Model plate
  parts.push(textSvg(x + W / 2, y + H * 0.95, 'XVT076A03 · 7.6 kW', {
    size: Math.max(2.2, H * 0.022),
    fill: '#bbb',
    bold: false,
  }));
  return `<g data-device="generac-pwrcell-inverter">${parts.join('')}</g>`;
}

// ----- Generac PWRcell Battery Cabinet -------------------------------------
// Tall grey cabinet with orange accent. Shows stacked 3 kWh modules.
function renderGeneracPWRcellBattery(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 60;
  const nativeH = 120;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  parts.push(rect(x, y, W, H, '#4A4D50', '#1a1a1a', 0.8, Math.max(1.5, W * 0.04)));
  // Orange top cap
  parts.push(rect(x, y, W, H * 0.08, '#F68B1F', '#B66816', 0.5, Math.max(1.5, W * 0.04)));
  parts.push(textSvg(x + W / 2, y + H * 0.06, 'GENERAC', {
    size: Math.max(2.4, H * 0.028),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Module stack (up to 6 modules of 3 kWh each = 18 kWh)
  const stackY0 = y + H * 0.12;
  const stackH = H * 0.78;
  const modCount = 6;
  const modH = stackH / modCount;
  for (let i = 0; i < modCount; i++) {
    const my = stackY0 + i * modH;
    parts.push(rect(x + W * 0.08, my + modH * 0.08, W * 0.84, modH * 0.84, '#35383B', '#1a1a1a', 0.4, 0.8));
    parts.push(textSvg(x + W / 2, my + modH * 0.58, '3.0 kWh', {
      size: Math.max(1.8, H * 0.018),
      fill: '#F68B1F',
      bold: true,
    }));
    // LED
    parts.push(circleSvg(x + W * 0.15, my + modH * 0.3, Math.max(0.5, W * 0.025), '#4CAF50', '#2E7D32', 0.25));
  }
  // Label
  parts.push(textSvg(x + W / 2, y + H * 0.955, 'PWRcell Battery', {
    size: Math.max(2.0, H * 0.02),
    fill: '#F68B1F',
    bold: false,
  }));
  return `<g data-device="generac-pwrcell-battery">${parts.join('')}</g>`;
}

// ----- Generac PWRmanager (BUI / ATS) --------------------------------------
// Grey wall-mount transfer switch. Orange accent, breaker window, terminal bar.
function renderGeneracPWRmanager(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 80;
  const nativeH = 104;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const parts: string[] = [];
  parts.push(rect(x, y, W, H, '#4A4D50', '#1a1a1a', 0.8, Math.max(1.5, W * 0.04)));
  parts.push(rect(x + W * 0.04, y + H * 0.04, W * 0.92, H * 0.09, '#F68B1F', '#B66816', 0.4, 1.2));
  parts.push(textSvg(x + W / 2, y + H * 0.1, 'GENERAC', {
    size: Math.max(2.6, H * 0.035),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Transfer switch window
  const winY = y + H * 0.18;
  parts.push(rect(x + W * 0.1, winY, W * 0.8, H * 0.3, '#35383B', '#1a1a1a', 0.4, 1));
  // Breaker row
  for (let i = 0; i < 4; i++) {
    const bx = x + W * (0.14 + i * 0.18);
    parts.push(rect(bx, winY + H * 0.08, W * 0.12, H * 0.18, '#5A5D60', '#222', 0.3, 0.6));
    const swOn = i % 2 === 0;
    parts.push(rect(bx + W * 0.04, winY + H * 0.13, W * 0.04, H * 0.08, swOn ? '#4CAF50' : '#777', '#111', 0.25, 0.3));
  }
  parts.push(textSvg(x + W / 2, y + H * 0.54, 'PWRmanager', {
    size: Math.max(2.6, H * 0.027),
    fill: '#F68B1F',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.62, 'Smart Load Manager', {
    size: Math.max(2.0, H * 0.021),
    fill: '#bbb',
    bold: false,
  }));
  // LEDs
  for (let i = 0; i < 4; i++) {
    const lx = x + W * (0.32 + i * 0.1);
    const colors = ['#4CAF50', '#4CAF50', '#FFA726', '#4A90E2'];
    parts.push(circleSvg(lx, y + H * 0.74, Math.max(0.5, W * 0.018), colors[i], '#222', 0.2));
  }
  parts.push(textSvg(x + W / 2, y + H * 0.87, '200A · UL 1008', {
    size: Math.max(2.0, H * 0.02),
    fill: '#bbb',
    bold: false,
  }));
  // Vent slats bottom
  for (let i = 0; i < 6; i++) {
    const vx = x + W * (0.22 + i * 0.1);
    parts.push(line(vx, y + H * 0.92, vx, y + H * 0.97, '#777', 0.3));
  }
  return `<g data-device="generac-pwrmanager">${parts.join('')}</g>`;
}

'''

anchor = "// ─── Registry "
assert anchor in src, "registry anchor not found"
src = src.replace(anchor, PHASE2_FUNCTIONS + anchor, 1)

# Append new registry entries before the closing };
# Find the end of the last entry (ecoflow::bui) and insert after it, before the '};'
end_anchor = "    render: renderEcoflowSmartHomePanel,\n  },\n};"
assert end_anchor in src, "registry end anchor not found"
new_entries = """    render: renderEcoflowSmartHomePanel,
  },
  'enphase::inverter': {
    brand: 'enphase',
    kind: 'inverter',
    label: 'Enphase IQ8+ Microinverter',
    sub: '384 W AC · 240V split-phase · per-module',
    aspectW: 120,
    aspectH: 70,
    render: renderEnphaseIQ8Micro,
  },
  'enphase::battery': {
    brand: 'enphase',
    kind: 'battery',
    label: 'Enphase IQ Battery 5P',
    sub: '5.0 kWh LFP · 3.84 kW · UL 9540',
    aspectW: 110,
    aspectH: 80,
    render: renderEnphaseIQBattery5P,
  },
  'enphase::bui': {
    brand: 'enphase',
    kind: 'bui',
    label: 'Enphase IQ System Controller 3',
    sub: 'Wall-mount BUI · 200A · UL 1741-SB',
    aspectW: 76,
    aspectH: 96,
    render: renderEnphaseIQSC3,
  },
  'solaredge::inverter': {
    brand: 'solaredge',
    kind: 'inverter',
    label: 'SolarEdge Home Hub (SE7600H)',
    sub: '7.6 kW HD-Wave hybrid · UL 1741-SB',
    aspectW: 86,
    aspectH: 120,
    render: renderSolarEdgeHomeHub,
  },
  'solaredge::battery': {
    brand: 'solaredge',
    kind: 'battery',
    label: 'SolarEdge Energy Bank',
    sub: '13.8 kWh LFP · 3-module stack',
    aspectW: 66,
    aspectH: 120,
    render: renderSolarEdgeEnergyBank,
  },
  'solaredge::bui': {
    brand: 'solaredge',
    kind: 'bui',
    label: 'SolarEdge Backup Interface',
    sub: 'Whole-home BUI · 200A · paired with Home Hub',
    aspectW: 72,
    aspectH: 100,
    render: renderSolarEdgeBackupInterface,
  },
  'generac::inverter': {
    brand: 'generac',
    kind: 'inverter',
    label: 'Generac PWRcell Inverter (XVT076A03)',
    sub: '7.6 kW hybrid · 4 PV inputs · UL 1741-SB',
    aspectW: 90,
    aspectH: 120,
    render: renderGeneracPWRcellInverter,
  },
  'generac::battery': {
    brand: 'generac',
    kind: 'battery',
    label: 'Generac PWRcell Battery Cabinet',
    sub: 'Up to 18 kWh · 3 kWh LFP modules · UL 9540',
    aspectW: 60,
    aspectH: 120,
    render: renderGeneracPWRcellBattery,
  },
  'generac::bui': {
    brand: 'generac',
    kind: 'bui',
    label: 'Generac PWRmanager',
    sub: 'Smart load manager + ATS · 200A · UL 1008',
    aspectW: 80,
    aspectH: 104,
    render: renderGeneracPWRmanager,
  },
};"""
src = src.replace(end_anchor, new_entries, 1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(src)
print("OK - Phase 2 (9 new illustrations) added")