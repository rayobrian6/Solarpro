// ═══════════════════════════════════════════════════════════════════════════
// lib/sld-device-illustrations.ts
// v58.16 Phase 1 — Front-view device silhouettes for SLD symbols.
//
// GOAL
//   Replace the generic IEEE inverter/battery emblem with a recognizable
//   front-view silhouette of the actual hardware when the user selects a
//   specific brand. These are *our own* simplified engineering drawings
//   rendered as pure SVG paths — no external imagery, no trademarked
//   artwork, no copyrighted marketing renders.
//
// STYLE (as selected by the user — option C)
//   • Straight-on front elevation (like a datasheet line drawing).
//   • Flat color fills in the brand's signature color + a neutral cabinet.
//   • Small wordmark bar so it is still brand-identifiable at SLD scale.
//   • Engineering-diagram aesthetic — no shading, no photorealism.
//
// CONTRACT
//   • Each illustration function fills a slot of arbitrary size; it
//     receives (cx, cy, w, h) in the host symbol's native coord space and
//     returns a ready-to-concat SVG string.
//   • Illustrations never emit wire terminals or labels — the host symbol
//     owns those. This module owns the "body of the box" only.
//   • Pure-function emission (no React, no DOM, no side effects).
//
// SCOPE (Phase 1)
//   • Tesla        → Powerwall 3 (tall white rounded slab, subtle grey trim)
//   • EcoFlow      → OCEAN Pro hybrid inverter (EF-PCS-24) — dark cabinet
//                    with blue accent + vent grille.
//   • EcoFlow      → OCEAN Pro battery (EF-BP-10) — vertical stack of LFP
//                    modules with blue top.
//
// SCOPE (Phase 2+, not in this file yet)
//   • Enphase IQ Battery 5P · IQ8 micro puck
//   • SolarEdge Home Hub · Energy Bank
//   • Generac PWRcell inverter + battery cabinet
//   • Sol-Ark 15K · Growatt MIN TL-XH · Solis S6 · Tigo EI
//   • APsystems DS3-H micro · Hoymiles HMS-2000 micro
//
// PLACEMENT IN THE RENDERER
//   lib/sld-professional-renderer.ts renderInverterBox() / renderBattery()
//   will call resolveDeviceIllustration(manufacturer, kind) and, if a match
//   is found, emit the illustration IN PLACE OF the generic embedSymbol().
//   If no match, it falls back to the current generic emblem so all 22+
//   remaining brands keep working until we fill in their illustrations.
// ═══════════════════════════════════════════════════════════════════════════

export type DeviceKind = 'inverter' | 'battery' | 'bui';

export interface DeviceIllustration {
  /** Registry key, lowercased/normalised brand. */
  brand: string;
  /** 'inverter' or 'battery'. */
  kind: DeviceKind;
  /** Short human label shown in the admin preview. */
  label: string;
  /** Short descriptor shown in admin preview (e.g. "Powerwall 3 · 13.5 kWh"). */
  sub: string;
  /** Native aspect ratio hint — we fit to slot but scale uniformly. */
  aspectW: number;
  aspectH: number;
  /**
   * Emit the illustration into the slot (cx, cy center, slotW / slotH size).
   * All coords are in the HOST symbol's native coordinate space.
   */
  render: (cx: number, cy: number, slotW: number, slotH: number) => string;
}

// ─── Shared drawing helpers ──────────────────────────────────────────────────
// Pure functions — no dependency on the rest of the renderer.
function rect(
  x: number, y: number, w: number, h: number,
  fill: string, stroke = '#1a1a1a', sw = 0.8, rx = 2,
): string {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function line(
  x1: number, y1: number, x2: number, y2: number,
  stroke = '#333', sw = 0.6,
): string {
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function circleSvg(
  cx: number, cy: number, r: number,
  fill: string, stroke = '#1a1a1a', sw = 0.6,
): string {
  return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function textSvg(
  x: number, y: number, txt: string,
  opts: { size?: number; fill?: string; bold?: boolean; anchor?: string } = {},
): string {
  const size = opts.size ?? 4;
  const fill = opts.fill ?? '#fff';
  const weight = opts.bold !== false ? '700' : '400';
  const anc = opts.anchor ?? 'middle';
  const safe = txt.replace(/&/g, '&' + 'amp;')
                  .replace(/</g, '&' + 'lt;')
                  .replace(/>/g, '&' + 'gt;');
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anc}">${safe}</text>`;
}

// ─── Tesla Powerwall 3 (battery) ─────────────────────────────────────────────
// Proportions modelled on the published spec: ~1105 mm H × 609 mm W × 193 mm D.
// Tall, rounded-top white slab with a small status LED near the top-left and
// a subtle grey trim along the bottom (inverter block integrated in Powerwall 3).
function renderTeslaPowerwall(cx: number, cy: number, slotW: number, slotH: number): string {
  // Native aspect 0.55 : 1 (W:H) — map into slot preserving aspect.
  const nativeW = 60;
  const nativeH = 108;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;
  const r = Math.max(3, W * 0.12);

  const parts: string[] = [];
  // Body — white slab with rounded top, flat bottom.
  parts.push(
    `<path d="M ${x + r} ${y} H ${x + W - r} A ${r} ${r} 0 0 1 ${x + W} ${y + r} V ${y + H} H ${x} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z" fill="#F4F4F2" stroke="#9AA0A6" stroke-width="0.7"/>`
  );
  // Subtle vertical seam (edge of front cover panel)
  parts.push(line(x + W * 0.12, y + H * 0.08, x + W * 0.12, y + H * 0.88, '#D0D4D8', 0.4));
  parts.push(line(x + W * 0.88, y + H * 0.08, x + W * 0.88, y + H * 0.88, '#D0D4D8', 0.4));
  // Status LED (small green dot) near upper-left
  parts.push(circleSvg(x + W * 0.22, y + H * 0.07, Math.max(0.6, W * 0.02), '#4CAF50', '#2E7D32', 0.3));
  // Brand plate (centre, discreet)
  const plateW = W * 0.5;
  const plateH = H * 0.04;
  const plateX = x + (W - plateW) / 2;
  const plateY = y + H * 0.45;
  parts.push(rect(plateX, plateY, plateW, plateH, '#202124', '#202124', 0.3, 1));
  parts.push(textSvg(plateX + plateW / 2, plateY + plateH * 0.75, 'TESLA', {
    size: Math.max(2.4, H * 0.022),
    fill: '#F4F4F2',
    bold: true,
  }));
  // Lower trim (integrated inverter block)
  const trimY = y + H * 0.82;
  const trimH = H * 0.14;
  parts.push(rect(x + W * 0.06, trimY, W * 0.88, trimH, '#E6E8EB', '#B0B4B8', 0.4, 1));
  // Vent slats on trim
  for (let i = 0; i < 5; i++) {
    const vy = trimY + trimH * 0.25 + i * (trimH * 0.11);
    parts.push(line(x + W * 0.14, vy, x + W * 0.86, vy, '#B0B4B8', 0.3));
  }
  return `<g data-device="tesla-powerwall-3">${parts.join('')}</g>`;
}

// ─── EcoFlow OCEAN Pro Hybrid Inverter (EF-PCS-24) ───────────────────────────
// Wall-mount hybrid inverter. Dark anthracite cabinet, blue accent strip along
// the top, display window in the upper third, ventilation grille in the lower
// half, with the EcoFlow wordmark printed near the top.
function renderEcoflowOceanProInverter(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 90;
  const nativeH = 120;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;

  const parts: string[] = [];
  // Cabinet — anthracite grey
  parts.push(rect(x, y, W, H, '#2B2F33', '#111418', 0.8, Math.max(1.5, W * 0.03)));
  // Top blue accent strip (EcoFlow signature)
  parts.push(rect(x + W * 0.04, y + H * 0.04, W * 0.92, H * 0.06, '#0E7CFF', '#0B5ECC', 0.4, 1.2));
  // Wordmark on blue strip
  parts.push(textSvg(x + W / 2, y + H * 0.04 + H * 0.045, 'EcoFlow', {
    size: Math.max(2.8, H * 0.032),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Display window (dark glass, upper third)
  const dispX = x + W * 0.12;
  const dispY = y + H * 0.16;
  const dispW = W * 0.76;
  const dispH = H * 0.17;
  parts.push(rect(dispX, dispY, dispW, dispH, '#0A0E12', '#000', 0.4, 1));
  // Fake status readout lines on display
  parts.push(line(dispX + dispW * 0.08, dispY + dispH * 0.35, dispX + dispW * 0.55, dispY + dispH * 0.35, '#2EE6A8', 0.4));
  parts.push(line(dispX + dispW * 0.08, dispY + dispH * 0.6,  dispX + dispW * 0.78, dispY + dispH * 0.6,  '#2EE6A8', 0.3));
  parts.push(line(dispX + dispW * 0.08, dispY + dispH * 0.82, dispX + dispW * 0.42, dispY + dispH * 0.82, '#4A90E2', 0.3));
  // Small indicator LEDs beside display
  parts.push(circleSvg(dispX + dispW + W * 0.04, dispY + dispH * 0.3, W * 0.012, '#4CAF50', '#2E7D32', 0.2));
  parts.push(circleSvg(dispX + dispW + W * 0.04, dispY + dispH * 0.7, W * 0.012, '#FFA726', '#E6851A', 0.2));
  // Vent grille (lower half) — multiple horizontal slats
  const ventY0 = y + H * 0.4;
  const ventH  = H * 0.5;
  const slatCount = 11;
  const slatGap = ventH / (slatCount + 1);
  for (let i = 1; i <= slatCount; i++) {
    const yy = ventY0 + i * slatGap;
    parts.push(line(x + W * 0.08, yy, x + W * 0.92, yy, '#4A4E52', 0.45));
  }
  // Model number plate (bottom-right corner)
  parts.push(textSvg(x + W * 0.92, y + H * 0.965, 'EF-PCS-24', {
    size: Math.max(2.2, H * 0.022),
    fill: '#8A8E92',
    bold: false,
    anchor: 'end',
  }));
  return `<g data-device="ecoflow-ocean-pro-inverter">${parts.join('')}</g>`;
}

// ─── EcoFlow OCEAN Pro Battery (EF-BP-10) ────────────────────────────────────
// Stackable LFP battery module. Tall anthracite cabinet with blue top cap,
// visible module seams on the front face (representing individual 10 kWh
// cells in the stack), small status LED strip, and model number plate.
function renderEcoflowOceanProBattery(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 54;
  const nativeH = 120;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;

  const parts: string[] = [];
  // Cabinet body — anthracite
  parts.push(rect(x, y, W, H, '#2B2F33', '#111418', 0.8, Math.max(1.2, W * 0.04)));
  // Top cap — EcoFlow blue
  const capH = H * 0.08;
  parts.push(rect(x, y, W, capH, '#0E7CFF', '#0B5ECC', 0.5, Math.max(1.2, W * 0.04)));
  // Top-cap wordmark
  parts.push(textSvg(x + W / 2, y + capH * 0.72, 'EcoFlow', {
    size: Math.max(2.6, H * 0.028),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Module seams — 4 LFP modules stacked (representing up to 4-module 40 kWh pack
  // common in OCEAN Pro single-tower configurations).
  const stackY0 = y + capH + H * 0.04;
  const stackH  = H * 0.82;
  const moduleCount = 4;
  const modH = stackH / moduleCount;
  for (let i = 0; i < moduleCount; i++) {
    const my = stackY0 + i * modH;
    // Module seam
    if (i > 0) parts.push(line(x + W * 0.08, my, x + W * 0.92, my, '#111418', 0.5));
    // Status LED (left edge of each module)
    parts.push(circleSvg(x + W * 0.14, my + modH * 0.2, W * 0.028, '#4CAF50', '#2E7D32', 0.25));
    // Faint label — module number
    parts.push(textSvg(x + W / 2, my + modH * 0.6, `EF-BP-10`, {
      size: Math.max(1.8, H * 0.018),
      fill: '#5A5E62',
      bold: false,
    }));
  }
  // Vertical cooling fins (both side edges of cabinet)
  for (let i = 0; i < 6; i++) {
    const vy = stackY0 + stackH * (0.1 + i * 0.14);
    parts.push(line(x + W * 0.03, vy, x + W * 0.08, vy, '#4A4E52', 0.3));
    parts.push(line(x + W * 0.92, vy, x + W * 0.97, vy, '#4A4E52', 0.3));
  }
  // Bottom nameplate
  parts.push(textSvg(x + W / 2, y + H * 0.975, '10 kWh · UL 9540B', {
    size: Math.max(1.9, H * 0.019),
    fill: '#8A8E92',
    bold: false,
  }));
  return `<g data-device="ecoflow-ocean-pro-battery">${parts.join('')}</g>`;
}

// ----- Tesla Backup Gateway 2 (BUI) ----------------------------------------
// White slim wall-mount unit. Vertical rectangular cabinet with a visible
// service-door seam, status LED bar along the top, Tesla nameplate on the
// lower front. Real proportions ~446 mm W x 660 mm H x 152 mm D.
function renderTeslaGateway2(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 58;
  const nativeH = 86;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;

  const parts: string[] = [];
  parts.push(rect(x, y, W, H, '#F4F4F2', '#9AA0A6', 0.7, Math.max(1.5, W * 0.05)));
  // Status LED bar across the top
  const ledBarY = y + H * 0.06;
  const ledBarH = H * 0.03;
  parts.push(rect(x + W * 0.12, ledBarY, W * 0.76, ledBarH, '#E6E8EB', '#B0B4B8', 0.3, 1));
  const ledColors = ['#4CAF50', '#4CAF50', '#FFA726', '#4A90E2'];
  for (let i = 0; i < ledColors.length; i++) {
    const lx = x + W * (0.22 + i * 0.17);
    parts.push(circleSvg(lx, ledBarY + ledBarH * 0.5, Math.max(0.5, W * 0.015), ledColors[i], '#333', 0.2));
  }
  // Service-door seam across middle
  const seamY = y + H * 0.46;
  parts.push(line(x + W * 0.06, seamY, x + W * 0.94, seamY, '#D0D4D8', 0.45));
  parts.push(circleSvg(x + W * 0.08, seamY, Math.max(0.4, W * 0.012), '#B0B4B8', '#9AA0A6', 0.2));
  parts.push(circleSvg(x + W * 0.92, seamY, Math.max(0.4, W * 0.012), '#B0B4B8', '#9AA0A6', 0.2));
  // Lower vent slats
  for (let i = 0; i < 6; i++) {
    const vx = x + W * (0.22 + i * 0.11);
    parts.push(line(vx, y + H * 0.7, vx, y + H * 0.86, '#D0D4D8', 0.3));
  }
  // TESLA nameplate
  const plateW = W * 0.5;
  const plateH = H * 0.06;
  const plateX = x + (W - plateW) / 2;
  const plateY = y + H * 0.54;
  parts.push(rect(plateX, plateY, plateW, plateH, '#202124', '#202124', 0.3, 1));
  parts.push(textSvg(plateX + plateW / 2, plateY + plateH * 0.75, 'TESLA', {
    size: Math.max(2.4, H * 0.03),
    fill: '#F4F4F2',
    bold: true,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.94, 'GATEWAY 2', {
    size: Math.max(2.0, H * 0.024),
    fill: '#5A5E62',
    bold: false,
  }));
  // Mounting tabs
  parts.push(rect(x - W * 0.02, y + H * 0.14, W * 0.04, H * 0.03, '#B0B4B8', '#9AA0A6', 0.3, 0.5));
  parts.push(rect(x + W * 0.98, y + H * 0.14, W * 0.04, H * 0.03, '#B0B4B8', '#9AA0A6', 0.3, 0.5));
  parts.push(rect(x - W * 0.02, y + H * 0.82, W * 0.04, H * 0.03, '#B0B4B8', '#9AA0A6', 0.3, 0.5));
  parts.push(rect(x + W * 0.98, y + H * 0.82, W * 0.04, H * 0.03, '#B0B4B8', '#9AA0A6', 0.3, 0.5));

  return `<g data-device="tesla-gateway-2">${parts.join('')}</g>`;
}

// ----- EcoFlow OCEAN Pro Smart Home Panel (BUI) ----------------------------
// Grid-interconnect + load-control unit that pairs with OCEAN Pro. Anthracite
// cabinet with blue top strip, visible breaker rows behind front-door glass.
function renderEcoflowSmartHomePanel(cx: number, cy: number, slotW: number, slotH: number): string {
  const nativeW = 86;
  const nativeH = 110;
  const scale = Math.min(slotW / nativeW, slotH / nativeH);
  const W = nativeW * scale;
  const H = nativeH * scale;
  const x = cx - W / 2;
  const y = cy - H / 2;

  const parts: string[] = [];
  parts.push(rect(x, y, W, H, '#2B2F33', '#111418', 0.8, Math.max(1.5, W * 0.03)));
  // Blue accent strip with wordmark
  parts.push(rect(x + W * 0.04, y + H * 0.04, W * 0.92, H * 0.07, '#0E7CFF', '#0B5ECC', 0.4, 1.2));
  parts.push(textSvg(x + W / 2, y + H * 0.04 + H * 0.05, 'EcoFlow Smart Home Panel', {
    size: Math.max(2.4, H * 0.026),
    fill: '#FFFFFF',
    bold: true,
  }));
  // Front-door glass window
  const glassX = x + W * 0.08;
  const glassY = y + H * 0.16;
  const glassW = W * 0.84;
  const glassH = H * 0.62;
  parts.push(rect(glassX, glassY, glassW, glassH, '#14181C', '#0A0E12', 0.5, 1));
  // Main bus bar
  parts.push(line(glassX + glassW * 0.04, glassY + glassH * 0.02, glassX + glassW * 0.96, glassY + glassH * 0.02, '#0E7CFF', 0.5));
  // Breaker rows 2x6 = 12
  const rows = 6;
  const cols = 2;
  const colGap = glassW * 0.04;
  const brkW = (glassW - colGap * (cols + 1)) / cols;
  const rowGap = glassH * 0.02;
  const brkH = (glassH - rowGap * (rows + 1)) / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const bx = glassX + colGap + c * (brkW + colGap);
      const by = glassY + rowGap + r * (brkH + rowGap);
      parts.push(rect(bx, by, brkW, brkH, '#3A3E42', '#1a1a1a', 0.3, 0.8));
      const swW = brkW * 0.18;
      const swH = brkH * 0.5;
      const sx = bx + (brkW - swW) / 2;
      const sy = by + (brkH - swH) / 2;
      const isOn = (r + c) % 3 !== 0;
      parts.push(rect(sx, sy, swW, swH, isOn ? '#4CAF50' : '#616468', '#111', 0.25, 0.4));
    }
  }
  // Status LED strip
  const ledStripX = x + W * 0.96;
  for (let i = 0; i < 3; i++) {
    const ly = y + H * (0.22 + i * 0.07);
    const colors = ['#4CAF50', '#FFA726', '#4A90E2'];
    parts.push(circleSvg(ledStripX - W * 0.02, ly, Math.max(0.4, W * 0.012), colors[i], '#333', 0.2));
  }
  parts.push(textSvg(x + W / 2, y + H * 0.92, 'OCEAN Pro Hub | 200A Service', {
    size: Math.max(2.2, H * 0.022),
    fill: '#8A8E92',
    bold: false,
  }));
  for (let i = 0; i < 3; i++) {
    const kx = x + W * (0.22 + i * 0.22);
    parts.push(rect(kx, y + H * 0.96, W * 0.06, H * 0.03, '#111418', '#000', 0.3, 0.5));
  }

  return `<g data-device="ecoflow-ocean-pro-bui">${parts.join('')}</g>`;
}

// ----- Enphase IQ8 Microinverter -------------------------------------------
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

// ----- Sol-Ark 15K-2P-N Hybrid Inverter ------------------------------------
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
  parts.push(textSvg(x + W * 0.37, y + H * 0.67, '240V SPLIT-φ', {
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
  parts.push(textSvg(x + W / 2, y + H * 0.33, 'HYBRID · 2 MPPT', {
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
  parts.push(textSvg(x + W / 2, y + H * 0.58, '2 x 440 W · 240V AC', {
    size: Math.max(2.4, H * 0.068),
    fill: '#BFC6CF',
    bold: false,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.72, 'UL 1741-SB · RSD', {
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
  parts.push(textSvg(x + W / 2, y + H * 0.58, '2000 W · 4-in-1 · 240V', {
    size: Math.max(2.4, H * 0.068),
    fill: '#BFC6CF',
    bold: false,
  }));
  parts.push(textSvg(x + W / 2, y + H * 0.72, 'UL 1741-SB · RSD', {
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

// ─── Registry ────────────────────────────────────────────────────────────────
// Keyed by `${brand}::${kind}`. The brand key follows normalizeBrandKey()
// conventions from sld-brand-emblems.ts (lowercase, whitespace/trademark
// stripped). When a renderer looks up a device, it normalises the incoming
// manufacturer the same way.
const DEVICE_REGISTRY: Record<string, DeviceIllustration> = {
  'tesla::battery': {
    brand: 'tesla',
    kind: 'battery',
    label: 'Tesla Powerwall 3',
    sub: '13.5 kWh · integrated inverter · UL 9540',
    aspectW: 60,
    aspectH: 108,
    render: renderTeslaPowerwall,
  },
  'tesla::bui': {
    brand: 'tesla',
    kind: 'bui',
    label: 'Tesla Backup Gateway 2',
    sub: 'Wall-mount BUI · 200A service · split-phase',
    aspectW: 58,
    aspectH: 86,
    render: renderTeslaGateway2,
  },
  'ecoflow::inverter': {
    brand: 'ecoflow',
    kind: 'inverter',
    label: 'EcoFlow OCEAN Pro (EF-PCS-24)',
    sub: '11.5 / 24 kW hybrid · 8 MPPTs · UL 1741-SB',
    aspectW: 90,
    aspectH: 120,
    render: renderEcoflowOceanProInverter,
  },
  'ecoflow::battery': {
    brand: 'ecoflow',
    kind: 'battery',
    label: 'EcoFlow OCEAN Pro Battery (EF-BP-10)',
    sub: '10 kWh LFP · stackable · UL 9540B',
    aspectW: 54,
    aspectH: 120,
    render: renderEcoflowOceanProBattery,
  },
  'ecoflow::bui': {
    brand: 'ecoflow',
    kind: 'bui',
    label: 'EcoFlow OCEAN Pro Smart Home Panel',
    sub: '12-circuit load center · 200A service · integrated bus',
    aspectW: 86,
    aspectH: 110,
    render: renderEcoflowSmartHomePanel,
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
  'solark::inverter': {
    brand: 'solark',
    kind: 'inverter',
    label: 'Sol-Ark 15K-2P-N Hybrid Inverter',
    sub: '15 kW hybrid · 48V batt · UL 1741-SB',
    aspectW: 92,
    aspectH: 120,
    render: renderSolArkHybridInverter,
  },
  'solark::bui': {
    brand: 'solark',
    kind: 'bui',
    label: 'Sol-Ark Smart Load Center',
    sub: 'Integrated BUI · 200A · whole-home backup',
    aspectW: 80,
    aspectH: 104,
    render: renderSolArkSmartLoadCenter,
  },
  'growatt::inverter': {
    brand: 'growatt',
    kind: 'inverter',
    label: 'Growatt SPH 10000TL3 BH-UP',
    sub: '10 kW hybrid · 3-phase · UL 1741-SB',
    aspectW: 88,
    aspectH: 120,
    render: renderGrowattSPHInverter,
  },
  'growatt::battery': {
    brand: 'growatt',
    kind: 'battery',
    label: 'Growatt ARK LV Battery',
    sub: '2.56 kWh LFP modules · stackable up to 25.6 kWh',
    aspectW: 62,
    aspectH: 120,
    render: renderGrowattARKBattery,
  },
  'growatt::bui': {
    brand: 'growatt',
    kind: 'bui',
    label: 'Growatt ATS-S 200A',
    sub: 'Whole-home transfer switch · UL 1008',
    aspectW: 76,
    aspectH: 96,
    render: renderGrowattATS,
  },
  'solis::inverter': {
    brand: 'solis',
    kind: 'inverter',
    label: 'Solis S6-EH1P-L 7.6kW Hybrid',
    sub: '7.6 kW hybrid · 2 MPPT · UL 1741-SB',
    aspectW: 86,
    aspectH: 110,
    render: renderSolisHybridInverter,
  },
  'apsystems::inverter': {
    brand: 'apsystems',
    kind: 'inverter',
    label: 'APsystems DS3 Dual Microinverter',
    sub: '2 x 440 W · 240V · per-pair module-level',
    aspectW: 130,
    aspectH: 70,
    render: renderAPsystemsDS3Micro,
  },
  'hoymiles::inverter': {
    brand: 'hoymiles',
    kind: 'inverter',
    label: 'Hoymiles HMS-2000DW-4T Microinverter',
    sub: '2000 W · 4-in-1 · 240V split-phase',
    aspectW: 125,
    aspectH: 70,
    render: renderHoymilesHMSMicro,
  },
};

// ─── Public API ──────────────────────────────────────────────────────────────
// Normalise a manufacturer string the same way sld-brand-emblems does so the
// two registries stay in sync. Duplicated here (not imported) to keep this
// module self-contained and avoid circular imports when future renderer
// refactors land.
export function normalizeDeviceBrandKey(manufacturer: string): string {
  if (!manufacturer) return '';
  return manufacturer
    .toLowerCase()
    .replace(/[\u00ae\u2122\u00a9]/g, '')
    // Strip whitespace AND common separators so "Sol-Ark", "Sol Ark",
    // "SolArk", and "sol_ark" all collapse to the same key.
    .replace(/[\s\-_.]+/g, '')
    .trim();
}

/**
 * Return the illustration for a given manufacturer + device kind, or null if
 * no illustration is registered (caller should fall back to the generic
 * IEEE symbol).
 */
export function resolveDeviceIllustration(
  manufacturer: string,
  kind: DeviceKind,
): DeviceIllustration | null {
  const key = normalizeDeviceBrandKey(manufacturer);
  if (!key) return null;
  const direct = DEVICE_REGISTRY[`${key}::${kind}`];
  if (direct) return direct;
  // Try hyphenated form as a secondary lookup (parity with brand-emblems).
  const hyphenated = manufacturer.toLowerCase().trim().replace(/\s+/g, '-');
  const hyphenKey = `${hyphenated}::${kind}`;
  if (DEVICE_REGISTRY[hyphenKey]) return DEVICE_REGISTRY[hyphenKey];
  return null;
}

/** Enumerate all registered illustrations — used by the admin preview page. */
export function listDeviceIllustrations(): DeviceIllustration[] {
  return Object.values(DEVICE_REGISTRY);
}

/** Return true if at least one illustration exists for this brand. */
export function brandHasDevice(manufacturer: string): boolean {
  const key = normalizeDeviceBrandKey(manufacturer);
  if (!key) return false;
  return (
    !!DEVICE_REGISTRY[`${key}::inverter`] ||
    !!DEVICE_REGISTRY[`${key}::battery`] ||
    !!DEVICE_REGISTRY[`${key}::bui`]
  );
}