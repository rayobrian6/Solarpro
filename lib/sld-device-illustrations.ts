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

export type DeviceKind = 'inverter' | 'battery';

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
    .replace(/[®™©]/g, '')
    .replace(/\s+/g, '')
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
  return !!DEVICE_REGISTRY[`${key}::inverter`] || !!DEVICE_REGISTRY[`${key}::battery`];
}