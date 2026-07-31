// ═══════════════════════════════════════════════════════════════════════════
// lib/sld-brand-emblems.ts
// v58.15 — SLD Brand Emblems
//
// PURPOSE
//   Compact, brand-specific visual emblems that are overlaid on the generic
//   inverter/battery SLD symbols so that the chosen ecosystem brand is
//   immediately recognizable on the single-line diagram.
//
// DESIGN PRINCIPLES
//   • Emblems are small (≈54×16 px in the symbol's native coordinate space)
//     so they never collide with existing geometry (MPPT rows, AC zones,
//     cell slabs, terminal lugs, etc.).
//   • Each emblem is a rounded-rectangle badge filled with the brand's
//     signature color + a short text wordmark in contrast ink. This stays
//     legible when the symbol is scaled into any SLD slot.
//   • Unknown / non-ecosystem manufacturers fall back to a neutral grey
//     wordmark so the SLD still identifies the hardware brand.
//   • Pure-function emission — no React, no DOM, no side effects. The
//     renderer (lib/sld-professional-renderer.ts) concatenates the returned
//     SVG string after embedSymbol() so the emblem paints on top.
//
// PLACEMENT
//   Inverter symbol (200×170): top-right corner, x≈140, y≈10, w≈54, h≈14.
//   Battery  symbol (180×170): top-right corner, x≈118, y≈11, w≈54, h≈14.
//
// CONSUMERS
//   renderInverterBox()  -> emitBrandEmblem('inverter', manufacturer, ...)
//   renderBattery()      -> emitBrandEmblem('battery',  manufacturer, ...)
// ═══════════════════════════════════════════════════════════════════════════

export interface BrandEmblemStyle {
  /** Short wordmark that fits the 54×14 badge (≤9 chars preferred). */
  wordmark: string;
  /** Background fill hex — brand's primary color. */
  fill: string;
  /** Text ink hex — white or near-black for contrast. */
  ink: string;
  /** Optional stroke hex for the badge border. Defaults to a darker fill shade. */
  stroke?: string;
  /** Optional font-size override in px (defaults to 9). */
  fontSize?: number;
  /** Optional italic flag (defaults false). */
  italic?: boolean;
  /** Optional bold flag (defaults true). */
  bold?: boolean;
}

// ─── Brand wordmark + color registry ─────────────────────────────────────────
// Keys are lowercased manufacturer strings as they appear in equipment-db.ts.
// When a renderer receives a manufacturer, it's normalised (lowercase,
// whitespace-trimmed) before lookup.
export const BRAND_EMBLEMS: Record<string, BrandEmblemStyle> = {
  // ─── Ecosystem brands (Layer D picker) ────────────────────────────────────
  ecoflow: {
    wordmark: 'EcoFlow',
    fill: '#0E7CFF', // EcoFlow blue
    ink: '#FFFFFF',
    stroke: '#0B5ECC',
  },
  tesla: {
    wordmark: 'TESLA',
    fill: '#CC0000', // Tesla red
    ink: '#FFFFFF',
    stroke: '#8B0000',
    fontSize: 9,
  },
  enphase: {
    wordmark: 'Enphase',
    fill: '#F37021', // Enphase orange
    ink: '#FFFFFF',
    stroke: '#C55A18',
  },
  solaredge: {
    wordmark: 'SolarEdge',
    fill: '#E30613', // SolarEdge red
    ink: '#FFFFFF',
    stroke: '#A8040E',
    fontSize: 8,
  },
  generac: {
    wordmark: 'GENERAC',
    fill: '#F68B1F', // Generac orange
    ink: '#FFFFFF',
    stroke: '#B66816',
    fontSize: 8,
  },
  apsystems: {
    wordmark: 'APsystems',
    fill: '#0052A5', // APsystems blue
    ink: '#FFFFFF',
    stroke: '#003A78',
    fontSize: 8,
  },
  hoymiles: {
    wordmark: 'Hoymiles',
    fill: '#1DA1D6', // Hoymiles light-blue
    ink: '#FFFFFF',
    stroke: '#1584B0',
  },
  'sol-ark': {
    wordmark: 'Sol-Ark',
    fill: '#D81B24', // Sol-Ark red
    ink: '#FFFFFF',
    stroke: '#951016',
  },
  solark: {
    // alias (some equipment-db rows use 'Sol-Ark', some 'SolArk')
    wordmark: 'Sol-Ark',
    fill: '#D81B24',
    ink: '#FFFFFF',
    stroke: '#951016',
  },
  growatt: {
    wordmark: 'Growatt',
    fill: '#1F8A3A', // Growatt green
    ink: '#FFFFFF',
    stroke: '#145C26',
  },
  solis: {
    wordmark: 'Solis',
    fill: '#0071CE', // Solis blue
    ink: '#FFFFFF',
    stroke: '#004F91',
  },
  tigo: {
    wordmark: 'Tigo',
    fill: '#7AB800', // Tigo green-yellow
    ink: '#FFFFFF',
    stroke: '#587F00',
  },

  // ─── Non-ecosystem but common brands ──────────────────────────────────────
  fronius: {
    wordmark: 'Fronius',
    fill: '#E30613',
    ink: '#FFFFFF',
    stroke: '#A8040E',
  },
  sma: {
    wordmark: 'SMA',
    fill: '#003A78',
    ink: '#FFFFFF',
    stroke: '#002552',
  },
  chint: {
    wordmark: 'Chint',
    fill: '#D01F2C',
    ink: '#FFFFFF',
    stroke: '#8C1620',
  },
  huawei: {
    wordmark: 'Huawei',
    fill: '#CF0A2C',
    ink: '#FFFFFF',
    stroke: '#8E0720',
  },
  'franklin-wh': {
    wordmark: 'FranklinWH',
    fill: '#003865',
    ink: '#FFFFFF',
    stroke: '#001E38',
    fontSize: 7,
  },
  franklinwh: {
    wordmark: 'FranklinWH',
    fill: '#003865',
    ink: '#FFFFFF',
    stroke: '#001E38',
    fontSize: 7,
  },
  anker: {
    wordmark: 'Anker',
    fill: '#00AEEF',
    ink: '#FFFFFF',
    stroke: '#007CB0',
  },
  bluetti: {
    wordmark: 'BLUETTI',
    fill: '#0A5296',
    ink: '#FFFFFF',
    stroke: '#07396A',
    fontSize: 7,
  },
  savant: {
    wordmark: 'Savant',
    fill: '#111111',
    ink: '#FFFFFF',
    stroke: '#000000',
  },
  briggs: {
    wordmark: 'Briggs',
    fill: '#E01F27',
    ink: '#FFFFFF',
    stroke: '#A0161B',
  },
  kohler: {
    wordmark: 'KOHLER',
    fill: '#D4A017',
    ink: '#111111',
    stroke: '#9A7710',
    fontSize: 8,
  },
  cummins: {
    wordmark: 'Cummins',
    fill: '#DC241F',
    ink: '#FFFFFF',
    stroke: '#9A1916',
  },
  champion: {
    wordmark: 'Champion',
    fill: '#F59F00',
    ink: '#111111',
    stroke: '#B37500',
    fontSize: 7,
  },
  westinghouse: {
    wordmark: 'Westngh.',
    fill: '#004B87',
    ink: '#FFFFFF',
    stroke: '#00355F',
    fontSize: 7,
  },
};

// ─── Fallback style for unknown manufacturers ────────────────────────────────
const FALLBACK_STYLE: BrandEmblemStyle = {
  wordmark: '',       // filled in by emitBrandEmblem with the raw manufacturer
  fill: '#455A64',    // neutral slate
  ink: '#FFFFFF',
  stroke: '#263238',
  fontSize: 8,
  italic: true,
};

// ─── Normalisation helper ────────────────────────────────────────────────────
// Collapses whitespace/punctuation so "Sol-Ark" and "Sol Ark" and "SolArk"
// all resolve to the same emblem. Strips trademark/registered symbols.
export function normalizeBrandKey(manufacturer: string): string {
  if (!manufacturer) return '';
  return manufacturer
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

// ─── Lookup helper (exported for tests + renderer) ───────────────────────────
export function getBrandEmblemStyle(manufacturer: string): BrandEmblemStyle {
  const key = normalizeBrandKey(manufacturer);
  if (BRAND_EMBLEMS[key]) return BRAND_EMBLEMS[key];
  // Try the hyphenated form (e.g. 'sol-ark' stored, 'solark' input)
  const hyphenated = manufacturer.toLowerCase().trim().replace(/\s+/g, '-');
  if (BRAND_EMBLEMS[hyphenated]) return BRAND_EMBLEMS[hyphenated];
  // Unknown brand → neutral fallback, use raw manufacturer as wordmark
  return {
    ...FALLBACK_STYLE,
    wordmark: (manufacturer || 'OEM').substring(0, 9),
  };
}

// ─── SVG emission ────────────────────────────────────────────────────────────
// Emits a brand emblem badge anchored at (x, y) with fixed width/height.
// The coordinates are in the HOST SYMBOL's native coordinate space — the
// outer transform in embedSymbol() / renderer will scale it uniformly.
//
// Returns '' if manufacturer is empty so callers can unconditionally push
// the result without branching.
export function emitBrandEmblem(
  manufacturer: string,
  x: number,
  y: number,
  w: number = 54,
  h: number = 14,
): string {
  if (!manufacturer) return '';
  const style = getBrandEmblemStyle(manufacturer);
  if (!style.wordmark) return '';

  const fontSize = style.fontSize ?? 9;
  const bold = style.bold !== false;
  const italic = style.italic === true;
  const stroke = style.stroke ?? style.fill;
  const cx = x + w / 2;
  const cy = y + h / 2;
  // Visual baseline offset so the text sits optically centred in the badge.
  const baseline = cy + fontSize * 0.34;

  // Escape wordmark + data-brand attribute for SVG safety.
  const escapeSvgText = (s: string): string =>
    s.replace(/&/g, '&' + 'amp;')
     .replace(/</g, '&' + 'lt;')
     .replace(/>/g, '&' + 'gt;');
  const escapeSvgAttr = (s: string): string =>
    s.replace(/&/g, '&' + 'amp;')
     .replace(/</g, '&' + 'lt;')
     .replace(/>/g, '&' + 'gt;')
     .replace(/"/g, '&' + 'quot;');

  const safeWordmark = escapeSvgText(style.wordmark);
  const safeBrandAttr = escapeSvgAttr(normalizeBrandKey(manufacturer));

  return (
    `<g class="brand-emblem" data-brand="${safeBrandAttr}">` +
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" ry="3" ` +
    `fill="${style.fill}" stroke="${stroke}" stroke-width="0.8"/>` +
    `<text x="${cx.toFixed(1)}" y="${baseline.toFixed(1)}" text-anchor="middle" ` +
    `font-family="SolarPro Sans, SolarPro Symbols" font-size="${fontSize}" ` +
    `font-weight="${bold ? '700' : '400'}" ` +
    `${italic ? 'font-style="italic" ' : ''}` +
    `fill="${style.ink}">${safeWordmark}</text>` +
    `</g>`
  );
}

// Convenience: returns true if a manufacturer has a hand-tuned emblem
// (vs falling back to the neutral slate). Useful for tests.
export function hasTunedEmblem(manufacturer: string): boolean {
  const key = normalizeBrandKey(manufacturer);
  if (BRAND_EMBLEMS[key]) return true;
  const hyphenated = manufacturer.toLowerCase().trim().replace(/\s+/g, '-');
  return !!BRAND_EMBLEMS[hyphenated];
}