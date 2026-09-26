/**
 * tests/support/sldGeometry.ts
 *
 * THE SLD AS GEOMETRY — and the collision audit that reads it.
 *
 * Ray, 2026-09-26, on a live IQ Combiner 5C supply-side one-line: "Biggest issue
 * I have with the sld is the word bleed and overlays. This should be cleaner to
 * read!!" Ray judges sheets by how they LOOK, and every defect in his screenshot
 * was a label and a line sharing ink: green EGC drops through the label blocks,
 * 'LOAD (FROM COMBINER)' on the disconnect's bottom edge, '120/240V, 1Φ, 3W'
 * across the meter circle, 'AC COMBINER' printed twice. A test that asserts a
 * string is PRESENT cannot see any of that. This module turns the finished SVG
 * (renderSLDProfessional's output, type floor already applied) into absolute
 * primitives so the overlaps can be counted, and later stages can drive the
 * count to zero instead of arguing about screenshots.
 *
 * ── WHAT IT READS ──────────────────────────────────────────────────────────
 * Nested <g transform> (translate / scale / rotate / matrix / skew), <text> and
 * <tspan> (x, y, dx, dy, font-size, font-weight, text-anchor,
 * dominant-baseline), <line>, <polyline>, <polygon>, <path> (M L H V Z C S Q T A
 * — curves and arcs flattened to segments), <rect>, <circle>, <ellipse>, and
 * presentation attributes inherited through groups (plus style="…" overrides).
 * The renderer's output is regular XML, so a tokenizer is enough.
 *
 * ── TEXT BOXES USE THE PRINTED FACE ────────────────────────────────────────
 * 'SolarPro Sans' IS Liberation Sans (lib/permit/fonts/font-pack.manifest.json).
 * The tables below were read from the shipped WOFF2 bytes (fontTools, hmtx +
 * glyf bounds, unitsPerEm 2048) — not measured in a browser and not Arial's
 * numbers. Advances match Arial by design; the VERTICAL numbers do not: this
 * face's cap height is 1409/2048 = 0.688 em (Arial's is 0.716), its hhea
 * ascent/descent 0.905 / 0.212 em.
 *
 * The box is the INK box of the actual string: top = the tallest glyph's yMax,
 * bottom = the deepest glyph's yMin. For ALL-CAPS text that is exactly the
 * cap-height box (0.688 em above the baseline, nothing below — 'Q' and 'J' aside);
 * a string with 'p', 'g', '(' or ',' grows down by that glyph's real descent.
 * Using the 0.905/0.212 LINE box instead would make every pair of adjacent
 * schedule rows "collide" (their line boxes touch by design) and bury the real
 * defects under noise, so the line box is not used for collision.
 *
 * Ignored on purpose (all well inside the 0.6 uu tolerance at 8.67 uu type):
 * pair kerning (Liberation kerns a few caps pairs by ≤ 0.07 em), synthetic
 * italic slant, and hinting. A codepoint in neither table is measured as a full
 * em wide and a full line box tall — conservative — and reported in
 * `unknownGlyphs` so the table can be extended rather than silently wrong.
 * `SolarPro Mono` (Liberation Mono) is fixed-pitch: 1229/2048 em per glyph.
 *
 * tests/sldStandaloneGatewayAndCtLeads.test.ts carries its own ASCII advance
 * table (1/1000 em, rounded up). This module is not allowed to edit that file,
 * so the tables here are a superset rather than a shared import.
 *
 * ── ILLUSTRATIONS: OPAQUE FROM OUTSIDE, AUDITED AT THEIR BOUNDARY ────────────
 * A <g data-device="…"> (lib/sld-device-illustrations.ts) or an embedded symbol
 * group (a transformed <g> nested inside the schematic's scale group, or one
 * holding fewer than ART_MAX_TEXTS labels — embedSymbol / brand emblems) is ONE
 * opaque box for every LAYOUT label outside it. Its own labels are audited by a
 * boundary rule (the review of 2026-09-26 found 27 of 104 sheets hiding
 * collisions here while every count read 0 — 'NEC 690.15' struck by its own
 * ground stub, 'UL 17[ON]B' under the Home Hub's handle, a layout line 0.5 uu
 * over 'IQ SYSTEM'):
 *   · against LAYOUT linework, shapes and labels painted AFTER the art (drawn
 *     over it) — the normal STROKE / SYMBOL / TEXT / CLEARANCE rules;
 *   · against ANOTHER art's shapes and labels painted after it (a brand badge
 *     slid over a cabinet's own label);
 *   · against its OWN art's lines, filled panels, labels and ink bounds when it
 *     prints at the type floor. The floor (applyTypeFloor) regex-raises every
 *     size under 8.67 uu on the finished sheet, art included, so a line the art
 *     authored at 2–4 uu no longer prints the way the art was drawn: the art is
 *     not "drawn once by hand" any more, and its words can run over its own
 *     shapes. Type the art authored above the floor is its own business.
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. FONT METRICS — Liberation Sans Regular / Bold, from the shipped bytes
// ═══════════════════════════════════════════════════════════════════════════

export const FONT_UPM = 2048;

// Format: runs of consecutive codepoints, `hexStart:v,v,v;…`. Advances in font
// units; extents as yMin/yMax (font units, y UP from the baseline). Codepoints:
// ASCII, Latin-1, and every other glyph the SLD sources print (—, →, ×, ·, Σ,
// Ω, Φ, φ, ≤, ≥, ±, °, ─, ═, …).
const ADV_R = '20:569,569,727,1139,1139,1821,1366,391,682,682,797,1196,569,682,569,569,1139,1139,1139,1139,1139,1139,1139,1139,1139,1139,569,569,1196,1196,1196,1139,2079,1366,1366,1479,1479,1366,1251,1593,1479,569,1024,1366,1139,1706,1479,1593,1366,1593,1479,1366,1251,1479,1366,1933,1366,1366,1251,569,569,569,961,1139,682,1139,1139,1024,1139,1139,569,1139,1139,455,455,1024,455,1706,1139,1139,1139,1139,682,1024,569,1139,1024,1479,1024,1024,1024,684,532,684,1196;a0:569,682,1139,1139,1139,1139,532,1139,682,1509,758,1139,1196,682,1509,1131,819,1124,682,682,682,1180,1100,682,682,682,748,1139,1708,1708,1708,1251,1366,1366,1366,1366,1366,1366,2048,1479,1366,1366,1366,1366,569,569,569,569,1479,1479,1593,1593,1593,1593,1593,1196,1593,1479,1479,1479,1479,1366,1366,1251,1139,1139,1139,1139,1139,1139,1821,1024,1139,1139,1139,1139,569,569,569,569,1139,1139,1139,1139,1139,1139,1139,1124,1251,1139,1139,1139,1139,1024,1139,1024;3a3:1266;3a6:1634;3a9:1531;3b2:1178;3bc:1180;3c6:1328;2013:1139,2048;2018:455,455;201c:682,682;2022:717;2026:2048;2030:2048;2032:384,725;2122:2048;2190:2048,1024,2048,1024,2048;21d4:2048;2206:1253;2211:1460,1196;221a:1124;221e:1460;2248:1124;2260:1124;2264:1124,1124;2500:1451;2550:1451';
const ADV_B = '20:569,682,971,1139,1139,1821,1479,487,682,682,797,1196,569,682,569,569,1139,1139,1139,1139,1139,1139,1139,1139,1139,1139,682,682,1196,1196,1196,1251,1997,1479,1479,1479,1479,1366,1251,1593,1479,569,1139,1479,1251,1706,1479,1593,1366,1593,1479,1366,1251,1479,1366,1933,1366,1366,1251,682,569,682,1196,1139,682,1139,1251,1139,1251,1139,682,1251,1251,569,569,1139,569,1821,1251,1251,1251,1251,797,1139,682,1251,1139,1593,1139,1139,1024,797,573,797,1196;a0:569,682,1139,1139,1139,1139,573,1139,682,1509,758,1139,1196,682,1509,1131,819,1124,682,682,682,1180,1139,682,682,682,748,1139,1708,1708,1708,1251,1479,1479,1479,1479,1479,1479,2048,1479,1366,1366,1366,1366,569,569,569,569,1479,1479,1593,1593,1593,1593,1593,1196,1593,1479,1479,1479,1479,1366,1366,1251,1139,1139,1139,1139,1139,1139,1821,1139,1139,1139,1139,1139,569,569,569,569,1251,1251,1251,1251,1251,1251,1251,1124,1251,1251,1251,1251,1251,1139,1251,1139;3a3:1229;3a6:1681;3a9:1642;3b2:1250;3bc:1253;3c6:1465;2013:1139,2048;2018:569,569;201c:1024,1024;2022:717;2026:2048;2030:2048;2032:491,981;2122:2048;2190:2048,1024,2048,1024,2048;21d4:2048;2206:1253;2211:1460,1196;221a:1124;221e:1460;2248:1124;2260:1124;2264:1124,1124;2500:1451;2550:1451';
const EXT_R = '20:0/0,0/1409,966/1409,0/1401,-142/1516,-12/1421,-20/1417,966/1409,-424/1484,-424/1484,690/1409,180/1182,-262/219,464/624,0/219,-20/1484,-20/1430,0/1409,0/1430,-20/1430,0/1409,-20/1409,-20/1430,0/1409,-20/1430,-20/1430,0/1082,-262/1082,154/1194,344/1004,154/1194,0/1430,-283/1484,0/1409,0/1409,-20/1430,0/1409,0/1409,0/1409,-20/1430,0/1409,0/1409,-20/1409,0/1409,0/1409,0/1409,0/1409,-20/1430,0/1409,-387/1430,0/1409,-20/1430,0/1409,-20/1409,0/1409,0/1409,0/1409,0/1409,0/1409,-425/1484,-20/1484,-425/1484,673/1409,-407/-277,1201/1508,-20/1102,-20/1484,-20/1102,-20/1484,-20/1102,0/1482,-425/1099,0/1484,0/1484,-425/1484,0/1484,0/1484,0/1102,0/1102,-20/1102,-425/1101,-425/1102,0/1102,-20/1099,-16/1324,-20/1082,0/1082,0/1082,0/1082,-425/1082,0/1082,-425/1484,-434/1484,-425/1484,553/807;a0:0/0,-327/1082,-31/1409,0/1430,225/1139,0/1409,-434/1484,-172/1484,1219/1403,-16/1430,651/1432,141/940,180/754,464/624,-16/1430,1452/1546,860/1430,0/1219,563/1421,551/1421,1201/1508,-425/1082,-264/1409,446/666,-434/0,563/1409,651/1432,141/940,-36/1409,0/1409,-36/1421,-348/1082,0/1776,0/1776,0/1790,0/1798,0/1714,0/1787,0/1409,-434/1430,0/1776,0/1776,0/1790,0/1714,0/1776,0/1776,0/1790,0/1714,0/1409,0/1798,-20/1776,-20/1776,-20/1790,-20/1798,-20/1714,225/1139,-53/1466,-20/1776,-20/1776,-20/1790,-20/1714,0/1776,0/1409,-20/1484,-20/1508,-20/1508,-20/1491,-20/1469,-20/1403,-20/1651,-20/1102,-434/1102,-20/1508,-20/1508,-20/1491,-20/1403,0/1508,0/1508,0/1491,0/1403,-20/1514,0/1469,-20/1508,-20/1508,-20/1491,-20/1469,-20/1403,223/1141,-38/1116,-20/1508,-20/1508,-20/1491,-20/1403,-425/1508,-425/1484,-425/1403;3a3:0/1409;3a6:-11/1419;3a9:0/1430;3b2:-425/1484;3bc:-393/1082;3c6:-425/1106;2013:451/588,451/588;2018:952/1409,952/1409;201c:952/1409,952/1409;2022:401/956;2026:0/219;2030:-11/1421;2032:890/1409,890/1409;2122:634/1409;2190:100/580,-61/1151,100/580,-61/1151,100/580;21d4:240/720;2206:0/1409;2211:-434/1409,608/754;221a:-14/1620;221e:203/983;2248:336/1012;2260:55/1296;2264:0/1231,0/1231;2500:549/694;2550:369/874';
const EXT_B = '20:0/0,0/1409,898/1409,0/1395,-152/1520,-16/1425,-20/1417,898/1409,-425/1484,-425/1484,647/1409,161/1201,-317/305,409/653,0/305,-41/1484,-20/1430,0/1409,0/1430,-23/1430,0/1409,-20/1409,-20/1430,0/1409,-20/1430,-20/1430,0/1034,-317/1034,125/1229,291/1065,125/1229,0/1430,-324/1454,0/1409,0/1409,-20/1430,0/1409,0/1409,0/1409,-20/1430,0/1409,0/1409,-20/1409,0/1409,0/1409,0/1409,0/1409,-20/1430,0/1409,-403/1430,0/1409,-20/1430,0/1409,-20/1409,0/1409,0/1409,0/1409,0/1409,0/1409,-425/1484,-41/1485,-425/1484,514/1409,-250/-172,1183/1502,-20/1102,-20/1484,-20/1102,-20/1484,-20/1102,0/1484,-434/1103,0/1484,0/1484,-425/1484,0/1484,0/1484,0/1103,0/1103,-20/1102,-425/1105,-425/1103,0/1103,-20/1103,-18/1336,-20/1082,0/1082,0/1082,0/1082,-425/1082,0/1082,-425/1484,-455/1484,-425/1484,516/840;a0:0/0,-327/1082,-33/1409,0/1430,170/1196,0/1409,-455/1454,-229/1427,1199/1418,-16/1430,725/1419,141/940,141/793,409/653,-16/1430,1452/1546,795/1425,0/1270,694/1426,684/1426,1183/1502,-426/1082,-264/1409,531/836,-425/0,694/1414,725/1419,141/940,-177/1414,-1/1414,-177/1426,-348/1082,0/1815,0/1815,0/1835,0/1823,0/1749,0/1806,0/1409,-425/1430,0/1815,0/1815,0/1835,0/1749,0/1815,0/1815,0/1835,0/1749,0/1409,0/1823,-20/1815,-20/1815,-20/1835,-20/1823,-20/1749,168/1194,-73/1473,-20/1815,-20/1815,-20/1835,-20/1749,0/1815,0/1409,-20/1484,-20/1502,-20/1502,-20/1529,-20/1476,-20/1418,-20/1685,-20/1102,-425/1102,-20/1502,-20/1502,-20/1529,-20/1418,0/1502,0/1502,0/1529,0/1418,-18/1503,0/1476,-20/1502,-20/1502,-20/1529,-20/1476,-20/1418,170/1194,-55/1133,-20/1502,-20/1502,-20/1529,-20/1418,-425/1502,-425/1484,-425/1418;3a3:0/1409;3a6:-11/1419;3a9:0/1430;3b2:-425/1484;3bc:-416/1082;3c6:-425/1106;2013:448/651,448/651;2018:831/1409,831/1409;201c:831/1409,831/1409;2022:381/969;2026:0/305;2030:-3/1419;2032:890/1409,890/1409;2122:768/1409;2190:100/580,-61/1151,100/580,-61/1151,100/580;21d4:280/760;2206:0/1409;2211:-455/1409,569/793;221a:-25/1620;221e:216/964;2248:274/1079;2260:37/1323;2264:0/1298,0/1298;2500:549/694;2550:369/874';
/** 'SolarPro Symbols' (DejaVu Sans subset): only the codepoints Liberation lacks
 *  that the sheets print. `cp:adv/yMin/yMax`. The browser reaches this face
 *  per-glyph, through the font-family list, exactly as it does here. */
const SYMBOLS = '21d2:1716/204/1080;26a0:1836/0/1492;2713:1716/198/1290;2717:1716/-18/1500;21c4:1716/-96/1380;26a1:1438/4/1496;21c6:1716/-96/1380;25b6:1575/-252/1316;25c0:1575/-252/1316;2b21:1788/-186/1532';
/** Liberation Mono advance (every glyph). */
const MONO_ADV = 1229;
/** hhea line box of the Sans face — the conservative box for an unknown glyph. */
const LINE_ASC = 1854, LINE_DESC = -434;

interface Glyph { adv: number; yMin: number; yMax: number }

function decodeFace(adv: string, ext: string): Map<number, Glyph> {
  const out = new Map<number, Glyph>();
  const advRuns = adv.split(';');
  const extRuns = ext.split(';');
  advRuns.forEach((run, i) => {
    const [hex, vals] = run.split(':');
    const exts = extRuns[i].split(':')[1].split(',');
    const start = parseInt(hex, 16);
    vals.split(',').forEach((v, k) => {
      const [lo, hi] = exts[k].split('/').map(Number);
      out.set(start + k, { adv: Number(v), yMin: lo, yMax: hi });
    });
  });
  return out;
}
const FACE_R = decodeFace(ADV_R, EXT_R);
const FACE_B = decodeFace(ADV_B, EXT_B);
const FACE_SYM = new Map<number, Glyph>(SYMBOLS.split(';').map(e => {
  const [hex, v] = e.split(':');
  const [a, lo, hi] = v.split('/').map(Number);
  return [parseInt(hex, 16), { adv: a, yMin: lo, yMax: hi }];
}));

export type FontFace = 'sans' | 'mono';

/** Every character measured with the conservative fallback, since load. */
const UNKNOWN_GLYPHS = new Set<string>();
export function unknownGlyphs(): string[] { return [...UNKNOWN_GLYPHS].sort(); }

/**
 * The printed metrics of one string: advance width and ink extents, in em
 * (y UP from the baseline). `ink` is false for an all-space string.
 */
export function measureEm(s: string, bold: boolean, face: FontFace = 'sans'):
  { width: number; yMin: number; yMax: number; ink: boolean } {
  const table = bold ? FACE_B : FACE_R;
  let w = 0, lo = Infinity, hi = -Infinity;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    let g = table.get(cp) ?? FACE_SYM.get(cp);
    if (!g) {
      UNKNOWN_GLYPHS.add(ch);
      g = { adv: FONT_UPM, yMin: LINE_DESC, yMax: LINE_ASC };
    }
    w += face === 'mono' ? MONO_ADV : g.adv;
    if (g.yMax > g.yMin) { lo = Math.min(lo, g.yMin); hi = Math.max(hi, g.yMax); }
  }
  const ink = hi > lo;
  return { width: w / FONT_UPM, yMin: ink ? lo / FONT_UPM : 0, yMax: ink ? hi / FONT_UPM : 0, ink };
}

/** Advance width in uu at `fontSize` — the printed face, no kerning. */
export function textWidth(s: string, fontSize: number, bold = false, face: FontFace = 'sans'): number {
  return measureEm(s, bold, face).width * fontSize;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. PLANE GEOMETRY
// ═══════════════════════════════════════════════════════════════════════════

export type Pt = [number, number];
export type Seg = [number, number, number, number];
export interface Box { x0: number; y0: number; x1: number; y1: number }

const NO_BOX: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
export const unite = (a: Box, b: Box): Box =>
  ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
/** Grow (d > 0) or shrink (d < 0) on every side. */
export const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
export const boxOk = (b: Box): boolean => b.x1 > b.x0 && b.y1 > b.y0;
export const overlapWH = (a: Box, b: Box): { w: number; h: number } =>
  ({ w: Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h: Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) });
export const touches = (a: Box, b: Box): boolean => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
export const within = (inner: Box, outer: Box): boolean =>
  inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1;
const boxOfPts = (pts: Pt[]): Box => pts.reduce<Box>((b, [x, y]) =>
  ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) }), NO_BOX);
const boxOfSegs = (segs: Seg[]): Box => segs.reduce<Box>((b, [a, c, d, e]) =>
  ({ x0: Math.min(b.x0, a, d), y0: Math.min(b.y0, c, e), x1: Math.max(b.x1, a, d), y1: Math.max(b.y1, c, e) }), NO_BOX);

/** Liang–Barsky: the parameter range of segment s inside box b, or null. */
function clipT(s: Seg, b: Box): [number, number] | null {
  const [x1, y1, x2, y2] = s;
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const edges: Array<[number, number]> = [[-dx, x1 - b.x0], [dx, b.x1 - x1], [-dy, y1 - b.y0], [dy, b.y1 - y1]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return t1 > t0 ? [t0, t1] : null;
}
/** The pieces of `segs` inside box b. */
function clipSegs(segs: Seg[], b: Box): Seg[] {
  const out: Seg[] = [];
  if (!boxOk(b)) return out;
  for (const s of segs) {
    const t = clipT(s, b);
    if (!t) continue;
    const [x1, y1, x2, y2] = s;
    out.push([x1 + (x2 - x1) * t[0], y1 + (y2 - y1) * t[0], x1 + (x2 - x1) * t[1], y1 + (y2 - y1) * t[1]]);
  }
  return out;
}
const segLen = (s: Seg): number => Math.hypot(s[2] - s[0], s[3] - s[1]);

export function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Sutherland–Hodgman: the part of `poly` inside box b. */
function clipPolyToBox(poly: Pt[], b: Box): Pt[] {
  const planes: Array<[(p: Pt) => boolean, (a: Pt, c: Pt) => Pt]> = [
    [p => p[0] >= b.x0, (a, c) => [b.x0, a[1] + ((c[1] - a[1]) * (b.x0 - a[0])) / (c[0] - a[0])]],
    [p => p[0] <= b.x1, (a, c) => [b.x1, a[1] + ((c[1] - a[1]) * (b.x1 - a[0])) / (c[0] - a[0])]],
    [p => p[1] >= b.y0, (a, c) => [a[0] + ((c[0] - a[0]) * (b.y0 - a[1])) / (c[1] - a[1]), b.y0]],
    [p => p[1] <= b.y1, (a, c) => [a[0] + ((c[0] - a[0]) * (b.y1 - a[1])) / (c[1] - a[1]), b.y1]],
  ];
  let out = poly;
  for (const [inside, cut] of planes) {
    const src = out;
    out = [];
    if (!src.length) break;
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(cut(prev, cur)); out.push(cur); } else if (pi) out.push(cut(prev, cur));
    }
  }
  return out;
}
const polyArea = (p: Pt[]): number => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(a / 2);
};

// ── Affine transforms ──────────────────────────────────────────────────────
/** [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (SVG matrix order). */
export type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];
const mul = (p: Mat, l: Mat): Mat => [
  p[0] * l[0] + p[2] * l[1], p[1] * l[0] + p[3] * l[1],
  p[0] * l[2] + p[2] * l[3], p[1] * l[2] + p[3] * l[3],
  p[0] * l[4] + p[2] * l[5] + p[4], p[1] * l[4] + p[3] * l[5] + p[5],
];
const ap = (m: Mat, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** Linear scale of a transform (a uniform-scale measure for font size / stroke width). */
const scaleOf = (m: Mat): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const nums = (s: string | undefined): number[] => (s ?? '').match(NUM)?.map(Number) ?? [];

export function parseTransform(s: string | undefined): Mat {
  let m = IDENT;
  if (!s) return m;
  for (const [, fn, args] of s.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = nums(args);
    let l: Mat = IDENT;
    if (fn === 'matrix' && a.length >= 6) l = [a[0], a[1], a[2], a[3], a[4], a[5]];
    else if (fn === 'translate') l = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') l = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      l = mul(mul([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === 'skewX') l = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY') l = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, l);
  }
  return m;
}

// ── Path data → polylines ──────────────────────────────────────────────────
interface SubPath { pts: Pt[]; closed: boolean }
function flattenPath(d: string): SubPath[] {
  const out: SubPath[] = [];
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCtrl: Pt | null = null, lastQ: Pt | null = null;
  let cur: SubPath | null = null;
  const num = () => Number(toks[i++]);
  const more = () => i < toks.length && !/^[A-Za-z]$/.test(toks[i]);
  const start = (x: number, y: number) => { cur = { pts: [[x, y]], closed: false }; out.push(cur); };
  const to = (x: number, y: number) => { if (!cur) start(cx, cy); cur!.pts.push([x, y]); cx = x; cy = y; };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    const [x0, y0] = [cx, cy];
    for (let k = 1; k <= 12; k++) {
      const t = k / 12, u = 1 - t;
      to(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
         u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y);
    }
  };
  const quad = (x1: number, y1: number, x: number, y: number) => {
    const [x0, y0] = [cx, cy];
    for (let k = 1; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      to(u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y);
    }
  };
  const arc = (rx: number, ry: number, phiDeg: number, large: number, sweep: number, x: number, y: number) => {
    // SVG 1.1 F.6.5 endpoint → centre parameterisation.
    const [x1, y1] = [cx, cy];
    if (rx === 0 || ry === 0 || (x1 === x && y1 === y)) { to(x, y); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x) / 2, dy = (y1 - y) / 2;
    const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
    const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num2 = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
    const den = rx * rx * yp * yp + ry * ry * xp * xp;
    const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
    const cxp = (coef * rx * yp) / ry, cyp = (-coef * ry * xp) / rx;
    const ccx = cos * cxp - sin * cyp + (x1 + x) / 2, ccy = sin * cxp + cos * cyp + (y1 + y) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) =>
      Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const th1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
    let dth = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
    if (!sweep && dth > 0) dth -= 2 * Math.PI;
    if (sweep && dth < 0) dth += 2 * Math.PI;
    const n = Math.max(4, Math.ceil(Math.abs(dth) / (Math.PI / 12)));
    for (let k = 1; k <= n; k++) {
      const t = th1 + (dth * k) / n;
      if (k === n) to(x, y);
      else to(ccx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, ccy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos);
    }
  };
  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'Z') {
      if (cur) { (cur as SubPath).closed = true; cx = sx; cy = sy; cur = null; }
      lastCtrl = lastQ = null;
      continue;
    }
    if (!more()) { i++; continue; }
    if (C === 'M') {
      const x = num() + ox, y = num() + oy;
      start(x, y); cx = sx = x; cy = sy = y;
      cmd = rel ? 'l' : 'L';                  // implicit lineto after moveto
      lastCtrl = lastQ = null;
    } else if (C === 'L') { to(num() + ox, num() + oy); lastCtrl = lastQ = null; }
    else if (C === 'H') { to(num() + ox, cy); lastCtrl = lastQ = null; }
    else if (C === 'V') { to(cx, num() + oy); lastCtrl = lastQ = null; }
    else if (C === 'C') {
      const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy, x = num() + ox, y = num() + oy;
      cubic(x1, y1, x2, y2, x, y); lastCtrl = [x2, y2]; lastQ = null;
    } else if (C === 'S') {
      const [rx0, ry0] = lastCtrl ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
      const x2 = num() + ox, y2 = num() + oy, x = num() + ox, y = num() + oy;
      cubic(rx0, ry0, x2, y2, x, y); lastCtrl = [x2, y2]; lastQ = null;
    } else if (C === 'Q') {
      const x1 = num() + ox, y1 = num() + oy, x = num() + ox, y = num() + oy;
      quad(x1, y1, x, y); lastQ = [x1, y1]; lastCtrl = null;
    } else if (C === 'T') {
      const q: Pt = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
      const x = num() + ox, y = num() + oy;
      quad(q[0], q[1], x, y); lastQ = q; lastCtrl = null;
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num(), x = num() + ox, y = num() + oy;
      arc(rx, ry, rot, large, sweep, x, y); lastCtrl = lastQ = null;
    } else i++;
  }
  return out.filter(p => p.pts.length > 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE PARSE
// ═══════════════════════════════════════════════════════════════════════════

/** One printed line of type (a <text>, or one <tspan x=…> line of a callout). */
export interface SldText {
  i: number;
  /** Paint order: the element's position in the document. */
  order: number;
  text: string;
  /** Anchor point on the baseline, absolute. */
  x: number; y: number;
  /** Absolute size (the attribute × the transform's scale). */
  fontSize: number;
  /** The attribute as written — the renderer's own number, after applyTypeFloor. */
  authoredSize: number;
  bold: boolean;
  anchor: 'start' | 'middle' | 'end';
  face: FontFace;
  family: string;
  fill: string;
  /** Absolute ink box of the printed string. */
  box: Box;
  /** Which <text> element (the lines of one multi-line callout share it). */
  elem: number;
  /** Line index inside that element. */
  line: number;
  /** Index into `arts` when the text is part of an illustration. */
  art: number | null;
  /** Nearest ancestor data-* attribute, as `data-x=value`. */
  owner: string | null;
  /** Inside the schematic's fit-to-area scale group. */
  schematic: boolean;
}

/** Open linework: a wire, EGC drop, CT lead, leader, table rule. */
export interface SldStroke {
  i: number; order: number;
  tag: string;
  segs: Seg[];
  box: Box;
  sw: number;
  stroke: string;
  dash: string | null;
  art: number | null; owner: string | null; schematic: boolean;
  desc: string;
}

/** A closed region: a box, a circle, a polygon, a closed path. */
export interface SldShape {
  i: number; order: number;
  tag: string;
  poly: Pt[];
  /** The outline as drawn (segments), for crossings. */
  outline: Seg[];
  box: Box;
  /** null ⇔ no fill. */
  fill: string | null;
  /** null ⇔ no visible stroke. White strokes count as no stroke (a knockout). */
  stroke: string | null;
  sw: number;
  dash: string | null;
  art: number | null; owner: string | null; schematic: boolean;
  role: 'shape' | 'background' | 'frame' | 'title-block';
  desc: string;
}

/** An illustration: one opaque box for everything outside it. */
export interface SldArt {
  i: number;
  name: string;
  /** Paint order of the group's opening tag, and of the last element in it. */
  order: number; endOrder: number;
  box: Box;
  owner: string | null;
}

export interface SldGeometry {
  width: number; height: number;
  viewBox: Box;
  texts: SldText[];
  strokes: SldStroke[];
  shapes: SldShape[];
  arts: SldArt[];
  frame: Box | null;
  frameStrokeWidth: number;
  titleBlock: Box | null;
  /** Every font-family attribute value seen, with its count. */
  fontFamilies: Record<string, number>;
  /** Tags the parser does not model (reported, never silently dropped). */
  unmodelled: Record<string, number>;
}

/** A transformed group holding fewer labels than this is a symbol, not layout. */
export const ART_MAX_TEXTS = 10;

/** The printed type floor (lib/sld-professional-renderer.ts MIN_TYPE_UU —
 *  6.5 pt at 96 uu/in). applyTypeFloor writes it into every font-size under it,
 *  so an art label whose attribute reads this was (almost always) raised to it. */
export const TYPE_FLOOR_UU = 8.67;

interface Tok { k: 'open' | 'close' | 'text'; tag: string; attrs: Record<string, string>; self: boolean; text: string }
const TOKEN_RE = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
const ATTR_RE = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

function tokenize(svg: string): Tok[] {
  const out: Tok[] = [];
  for (const m of svg.matchAll(TOKEN_RE)) {
    if (m[1] !== undefined) { out.push({ k: 'text', tag: '', attrs: {}, self: false, text: m[1] }); continue; }
    if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(ATTR_RE)) attrs[a[1]] = a[2] ?? a[3] ?? '';
      out.push({ k: m[2] ? 'close' : 'open', tag: m[3], attrs, self: !!m[5], text: '' });
      continue;
    }
    if (m[6] !== undefined) out.push({ k: 'text', tag: '', attrs: {}, self: false, text: m[6] });
  }
  return out;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string): string => s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (w, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    : ENTITY[e] ?? w);

interface Style {
  fill: string; stroke: string; sw: number; dash: string;
  fontSize: number; family: string; weight: string; anchor: string; baseline: string;
  fillOpacity: number; strokeOpacity: number; visibility: string;
}
const ROOT_STYLE: Style = {
  fill: '#000', stroke: 'none', sw: 1, dash: 'none', fontSize: 16, family: 'serif', weight: 'normal',
  anchor: 'start', baseline: 'auto', fillOpacity: 1, strokeOpacity: 1, visibility: 'visible',
};
function styleOf(parent: Style, attrs: Record<string, string>): { style: Style; hidden: boolean } {
  const decl: Record<string, string> = { ...attrs };
  for (const d of (attrs.style ?? '').split(';')) {
    const c = d.indexOf(':');
    if (c > 0) decl[d.slice(0, c).trim()] = d.slice(c + 1).trim();
  }
  const s = { ...parent };
  const num = (v: string | undefined, dflt: number) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : dflt; };
  if (decl.fill !== undefined) s.fill = decl.fill;
  if (decl.stroke !== undefined) s.stroke = decl.stroke;
  if (decl['stroke-width'] !== undefined) s.sw = num(decl['stroke-width'], s.sw);
  if (decl['stroke-dasharray'] !== undefined) s.dash = decl['stroke-dasharray'];
  if (decl['font-size'] !== undefined) s.fontSize = num(decl['font-size'], s.fontSize);
  if (decl['font-family'] !== undefined) s.family = decl['font-family'];
  if (decl['font-weight'] !== undefined) s.weight = decl['font-weight'];
  if (decl['text-anchor'] !== undefined) s.anchor = decl['text-anchor'];
  if (decl['dominant-baseline'] !== undefined) s.baseline = decl['dominant-baseline'];
  if (decl['fill-opacity'] !== undefined) s.fillOpacity = num(decl['fill-opacity'], 1);
  if (decl['stroke-opacity'] !== undefined) s.strokeOpacity = num(decl['stroke-opacity'], 1);
  if (decl.visibility !== undefined) s.visibility = decl.visibility;
  const hidden = decl.display === 'none' || num(decl.opacity, 1) === 0;
  return { style: s, hidden };
}

const isNone = (c: string | null | undefined): boolean =>
  !c || c === 'none' || c === 'transparent' || /^rgba\([^)]*,\s*0\s*\)$/.test(c);
/** White and near-white (luminance ≥ 0.93): a fill that reads as paper. */
export function isLight(c: string): boolean {
  const s = c.trim().toLowerCase();
  if (s === 'white') return true;
  let m = /^#([0-9a-f]{3})$/.exec(s);
  const hex = m ? m[1].split('').map(h => h + h).join('') : (/^#([0-9a-f]{6})$/.exec(s)?.[1] ?? null);
  if (!hex) return false;
  const [r, g, b] = [0, 2, 4].map(k => parseInt(hex.slice(k, k + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 0.93;
}
const COLOR_NAMES: Record<string, string> = {
  '#000000': 'black', '#000': 'black', '#111': 'black', '#005500': 'green (EGC/ground)', '#6a1b9a': 'purple (CT lead)',
  '#1565c0': 'blue (battery)', '#2e7d32': 'green (generator)', '#e65100': 'orange (ATS)', '#1b5e20': 'green (load side)',
  '#0d47a1': 'blue (supply side)', '#aa0000': 'red', '#555': 'grey', '#555555': 'grey', '#444': 'grey', '#333': 'grey',
};
export const colorName = (c: string): string => COLOR_NAMES[c.toLowerCase()] ?? c;
/** What a stroke IS on this sheet, from its colour and dash (the renderer's
 *  own conventions: GND_CLR '#2E7D32' dashed 4,3 is the equipment ground drop;
 *  the same green solid is the generator conductor). */
function strokeName(c: string, dash: string | null): string {
  const k = c.toLowerCase();
  if (k === '#2e7d32') return dash ? 'green dashed ground drop (EGC)' : 'green (generator / ground)';
  if (k === '#005500') return dash ? 'green dashed (open-air branch)' : 'green (EGC/ground)';
  if (k === '#6a1b9a') return dash ? 'purple dashed (CT lead)' : 'purple (CT)';
  return `${colorName(c)}${dash ? ' dashed' : ''}`;
}
const DOMINANT_BASELINE_EM: Record<string, number> = {
  // Shift from the attribute y DOWN to the alphabetic baseline, in em.
  middle: 1082 / FONT_UPM / 2, central: (1854 - 434) / FONT_UPM / 2, mathematical: 0.35, hanging: 0.8,
  'text-before-edge': 1854 / FONT_UPM, 'text-top': 1854 / FONT_UPM, 'before-edge': 1854 / FONT_UPM,
  'text-after-edge': -434 / FONT_UPM, 'text-bottom': -434 / FONT_UPM, 'after-edge': -434 / FONT_UPM, ideographic: -434 / FONT_UPM,
};
const SKIP_SUBTREE = new Set(['defs', 'clipPath', 'mask', 'symbol', 'marker', 'pattern', 'linearGradient',
  'radialGradient', 'filter', 'style', 'title', 'desc', 'metadata', 'script', 'foreignObject']);
const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'path']);
const CONTAINER_TAGS = new Set(['svg', 'g', 'a', 'switch']);
const TEXT_TAGS = new Set(['text', 'tspan', 'textPath']);

interface Frame {
  tag: string; m: Mat; style: Style; skip: boolean; hidden: boolean;
  art: number | null; startedArt: boolean; owner: string | null; schematic: boolean; transformed: boolean;
}

const fmt = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Parse a finished SLD SVG into absolute-coordinate primitives. */
export function parseSld(svg: string): SldGeometry {
  const toks = tokenize(svg);
  // Labels per <g>: an embedded symbol holds a handful, the schematic hundreds.
  const textsInG = new Map<number, number>();
  {
    const stack: number[] = [];
    const prefix: number[] = [0];
    toks.forEach(t => prefix.push(prefix[prefix.length - 1] + (t.k === 'open' && t.tag === 'text' ? 1 : 0)));
    toks.forEach((t, idx) => {
      if (t.k === 'open' && !t.self) stack.push(idx);
      else if (t.k === 'close') {
        const o = stack.pop();
        if (o !== undefined && toks[o].tag === 'g') textsInG.set(o, prefix[idx] - prefix[o]);
      }
    });
  }

  const g: SldGeometry = {
    width: 0, height: 0, viewBox: { x0: 0, y0: 0, x1: 0, y1: 0 },
    texts: [], strokes: [], shapes: [], arts: [], frame: null, frameStrokeWidth: 0, titleBlock: null,
    fontFamilies: {}, unmodelled: {},
  };
  const frames: Frame[] = [{
    tag: '#root', m: IDENT, style: ROOT_STYLE, skip: false, hidden: false, art: null, startedArt: false,
    owner: null, schematic: false, transformed: false,
  }];
  let order = 0;
  let textElem = -1;

  // ── the <text> being laid out ──
  interface Run { s: string; fs: number; bold: boolean; face: FontFace; y: number; dx: number; family: string }
  interface Chunk { x: number; y: number; anchor: string; runs: Run[] }
  let tb: { order: number; m: Mat; style: Style; art: number | null; owner: string | null; schematic: boolean;
    chunks: Chunk[]; penX: number; penY: number; pendingDx: number; fill: string; authored: number } | null = null;

  const artGrow = (art: number | null, b: Box) => { if (art !== null && boxOk(b)) g.arts[art].box = unite(g.arts[art].box, b); };

  const pushShape = (f: Frame, tag: string, local: Pt[], closed: boolean, filledOpen: boolean) => {
    const pts = local.map(([x, y]) => ap(f.m, x, y));
    if (pts.length < 2) return;
    const st = f.style;
    const sw = st.sw * scaleOf(f.m);
    const strokeVisible = !isNone(st.stroke) && sw > 0 && st.strokeOpacity > 0 && !isLight(st.stroke);
    const fill = !isNone(st.fill) && st.fillOpacity > 0 ? st.fill : null;
    const segs: Seg[] = [];
    for (let k = 1; k < pts.length; k++) segs.push([pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]]);
    if (closed) segs.push([pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]]);
    const dash = isNone(st.dash) ? null : st.dash;
    const ord = order;
    if (closed || (filledOpen && fill && pts.length > 2)) {
      if (!fill && !strokeVisible) return;
      const b = boxOfPts(pts);
      const shape: SldShape = {
        i: g.shapes.length, order: ord, tag, poly: pts, outline: strokeVisible ? segs : [], box: b,
        fill, stroke: strokeVisible ? st.stroke : null, sw: strokeVisible ? sw : 0, dash,
        art: f.art, owner: f.owner, schematic: f.schematic, role: 'shape',
        desc: `${tag}${fill ? ` fill ${colorName(fill)}` : ''}${strokeVisible ? ` stroke ${strokeName(st.stroke, dash)} sw${fmt(sw)}` : ''}`,
      };
      g.shapes.push(shape);
      artGrow(f.art, grow(b, shape.sw / 2));
      return;
    }
    if (!strokeVisible) return;
    const b = boxOfSegs(segs);
    g.strokes.push({
      i: g.strokes.length, order: ord, tag, segs, box: b, sw, stroke: st.stroke, dash,
      art: f.art, owner: f.owner, schematic: f.schematic,
      desc: `${tag} ${strokeName(st.stroke, dash)}${dash ? ` [${dash}]` : ''} sw${fmt(sw)}`,
    });
    artGrow(f.art, grow(b, sw / 2));
  };

  const emitShape = (f: Frame, t: Tok) => {
    const a = t.attrs;
    const n = (k: string) => { const v = parseFloat(a[k] ?? ''); return Number.isFinite(v) ? v : 0; };
    switch (t.tag) {
      case 'line': pushShape(f, 'line', [[n('x1'), n('y1')], [n('x2'), n('y2')]], false, false); break;
      case 'rect': {
        const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
        if (w > 0 && h > 0) pushShape(f, 'rect', [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, false);
        break;
      }
      case 'circle': case 'ellipse': {
        const rx = t.tag === 'circle' ? n('r') : n('rx'), ry = t.tag === 'circle' ? n('r') : n('ry');
        if (rx <= 0 || ry <= 0) break;
        const pts: Pt[] = [];
        for (let k = 0; k < 36; k++) pts.push([n('cx') + rx * Math.cos((k * Math.PI) / 18), n('cy') + ry * Math.sin((k * Math.PI) / 18)]);
        pushShape(f, t.tag, pts, true, false);
        break;
      }
      case 'polygon': case 'polyline': {
        const v = nums(a.points);
        const pts: Pt[] = [];
        for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
        pushShape(f, t.tag, pts, t.tag === 'polygon', true);
        break;
      }
      case 'path':
        for (const sp of flattenPath(a.d ?? '')) pushShape(f, 'path', sp.pts, sp.closed, true);
        break;
    }
  };

  const finishText = () => {
    if (!tb) return;
    const t = tb;
    tb = null;
    t.chunks.filter(c => c.runs.length).forEach((c, line) => {
      // xml:space="default" — what a browser prints: newlines/tabs are spaces,
      // runs of spaces are one, the chunk's ends are trimmed.
      const runs = c.runs.map(r => ({ ...r, s: r.s.replace(/[\r\n\t]/g, ' ').replace(/ {2,}/g, ' ') }));
      for (let k = 1; k < runs.length; k++) if (runs[k - 1].s.endsWith(' ') && runs[k].s.startsWith(' ')) runs[k].s = runs[k].s.slice(1);
      if (runs.length) { runs[0].s = runs[0].s.replace(/^ +/, ''); runs[runs.length - 1].s = runs[runs.length - 1].s.replace(/ +$/, ''); }
      const text = runs.map(r => r.s).join('');
      if (!text.trim()) return;
      let adv = 0, top = Infinity, bot = -Infinity, fsMax = 0;
      const shift = (DOMINANT_BASELINE_EM[t.style.baseline] ?? 0);
      for (const r of runs) {
        const mtr = measureEm(r.s, r.bold, r.face);
        adv += r.dx + mtr.width * r.fs;
        fsMax = Math.max(fsMax, r.fs);
        if (mtr.ink) {
          const base = r.y + shift * r.fs;
          top = Math.min(top, base - mtr.yMax * r.fs);
          bot = Math.max(bot, base - mtr.yMin * r.fs);
        }
      }
      if (!(bot > top) && !(adv > 0)) return;
      if (!(bot > top)) { top = c.y; bot = c.y; }
      const x0 = c.anchor === 'middle' ? c.x - adv / 2 : c.anchor === 'end' ? c.x - adv : c.x;
      const corners = [ap(t.m, x0, top), ap(t.m, x0 + adv, top), ap(t.m, x0 + adv, bot), ap(t.m, x0, bot)];
      const box = boxOfPts(corners);
      const [ax, ay] = ap(t.m, c.x, c.y);
      const r0 = runs.find(r => r.s.trim()) ?? runs[0];
      const st: SldText = {
        i: g.texts.length, order: t.order, text, x: ax, y: ay, fontSize: fsMax * scaleOf(t.m), authoredSize: t.authored,
        bold: r0.bold, anchor: (c.anchor === 'middle' || c.anchor === 'end') ? c.anchor : 'start', face: r0.face,
        family: r0.family, fill: t.fill, box, elem: textElem, line, art: t.art, owner: t.owner, schematic: t.schematic,
      };
      g.texts.push(st);
      artGrow(t.art, box);
    });
  };

  const isBold = (w: string) => w === 'bold' || w === 'bolder' || (Number(w) >= 600);
  const faceOf = (fam: string): FontFace => (/mono|courier/i.test(fam) ? 'mono' : 'sans');

  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx];
    const parent = frames[frames.length - 1];
    if (t.k === 'close') {
      if (frames.length > 1 && t.tag === parent.tag) {
        const f = frames.pop()!;
        if (f.tag === 'text') finishText();
        if (f.startedArt && f.art !== null) g.arts[f.art].endOrder = order;
      }
      continue;
    }
    if (t.k === 'text') {
      if (tb && !parent.skip && !parent.hidden && TEXT_TAGS.has(parent.tag)) {
        const st = parent.style;
        const s = decode(t.text);
        let chunk = tb.chunks[tb.chunks.length - 1];
        if (!chunk) { chunk = { x: tb.penX, y: tb.penY, anchor: st.anchor, runs: [] }; tb.chunks.push(chunk); }
        chunk.runs.push({ s, fs: st.fontSize, bold: isBold(st.weight), face: faceOf(st.family), y: tb.penY, dx: tb.pendingDx, family: st.family });
        tb.pendingDx = 0;
        tb.penX += textWidth(s, st.fontSize, isBold(st.weight), faceOf(st.family));
      }
      continue;
    }
    // open / self-closing
    order++;
    const { style, hidden } = styleOf(parent.style, t.attrs);
    const local = parseTransform(t.attrs.transform);
    const m = t.attrs.transform ? mul(parent.m, local) : parent.m;
    const dataAttr = Object.keys(t.attrs).find(k => k.startsWith('data-'));
    const f: Frame = {
      tag: t.tag, m, style, skip: parent.skip || SKIP_SUBTREE.has(t.tag), hidden: parent.hidden || hidden,
      art: parent.art, startedArt: false,
      owner: dataAttr ? `${dataAttr}=${t.attrs[dataAttr]}` : parent.owner,
      schematic: parent.schematic, transformed: parent.transformed || !!t.attrs.transform,
    };
    if (t.tag === 'svg' && frames.length === 1) {
      const vb = nums(t.attrs.viewBox);
      g.width = parseFloat(t.attrs.width ?? '') || vb[2] || 0;
      g.height = parseFloat(t.attrs.height ?? '') || vb[3] || 0;
      g.viewBox = vb.length === 4 ? { x0: vb[0], y0: vb[1], x1: vb[0] + vb[2], y1: vb[1] + vb[3] }
        : { x0: 0, y0: 0, x1: g.width, y1: g.height };
    }
    if (t.tag === 'g' && !f.skip && parent.art === null) {
      const nTexts = textsInG.get(idx) ?? 0;
      const isArt = !!dataAttr || (!!t.attrs.transform && (parent.transformed || nTexts < ART_MAX_TEXTS));
      if (isArt) {
        f.art = g.arts.length; f.startedArt = true;
        g.arts.push({ i: f.art, name: dataAttr ? `${dataAttr}=${t.attrs[dataAttr]}` : 'embedded-symbol', order, endOrder: order, box: NO_BOX, owner: f.owner });
      } else if (t.attrs.transform) f.schematic = true;
    }
    if (!f.skip && !f.hidden && f.style.visibility !== 'hidden') {
      if (SHAPE_TAGS.has(t.tag)) emitShape(f, t);
      else if (t.tag === 'text') {
        if (tb) finishText();
        textElem++;
        const x = nums(t.attrs.x)[0] ?? 0, y = nums(t.attrs.y)[0] ?? 0;
        tb = {
          order, m, style, art: f.art, owner: f.owner, schematic: f.schematic, chunks: [],
          penX: x + (nums(t.attrs.dx)[0] ?? 0), penY: y + (nums(t.attrs.dy)[0] ?? 0), pendingDx: 0,
          fill: style.fill, authored: style.fontSize,
        };
        const fam = style.family;
        g.fontFamilies[fam] = (g.fontFamilies[fam] ?? 0) + 1;
        tb.chunks.push({ x: tb.penX, y: tb.penY, anchor: style.anchor, runs: [] });
      } else if (t.tag === 'tspan' && tb) {
        const hasX = t.attrs.x !== undefined, hasY = t.attrs.y !== undefined;
        if (hasX) tb.penX = nums(t.attrs.x)[0] ?? tb.penX;
        if (hasY) tb.penY = nums(t.attrs.y)[0] ?? tb.penY;
        const dx = nums(t.attrs.dx)[0] ?? 0, dy = nums(t.attrs.dy)[0] ?? 0;
        tb.penY += dy;
        if (hasX || hasY) { tb.penX += dx; tb.chunks.push({ x: tb.penX, y: tb.penY, anchor: style.anchor, runs: [] }); }
        else tb.pendingDx += dx;
      } else if (!CONTAINER_TAGS.has(t.tag) && !TEXT_TAGS.has(t.tag)) {
        g.unmodelled[t.tag] = (g.unmodelled[t.tag] ?? 0) + 1;
      }
    }
    if (!t.self) frames.push(f);
    else if (f.startedArt && f.art !== null) g.arts[f.art].endOrder = order;
  }
  finishText();

  // ── The sheet's own furniture: page background, border, title block ──
  const W = g.viewBox.x1 - g.viewBox.x0, H = g.viewBox.y1 - g.viewBox.y0;
  const big = (s: SldShape) => s.tag === 'rect' && s.art === null
    && s.box.x1 - s.box.x0 >= 0.9 * W && s.box.y1 - s.box.y0 >= 0.9 * H;
  let frame: SldShape | null = null;
  for (const s of g.shapes) {
    if (!big(s)) continue;
    if (!s.stroke) { s.role = 'background'; continue; }
    if (!frame || (s.box.x1 - s.box.x0) * (s.box.y1 - s.box.y0) > (frame.box.x1 - frame.box.x0) * (frame.box.y1 - frame.box.y0)) frame = s;
  }
  if (frame) { frame.role = 'frame'; g.frame = frame.box; g.frameStrokeWidth = frame.sw; }
  const fb = g.frame ?? g.viewBox;
  for (const s of g.shapes) {
    if (s.role !== 'shape' || s.tag !== 'rect' || !s.stroke || s.art !== null) continue;
    const w = s.box.x1 - s.box.x0, h = s.box.y1 - s.box.y0;
    if (h >= 0.7 * (fb.y1 - fb.y0) && w <= 0.3 * (fb.x1 - fb.x0) && s.box.x0 > (fb.x0 + fb.x1) / 2) {
      s.role = 'title-block';
      g.titleBlock = g.titleBlock ? unite(g.titleBlock, s.box) : s.box;
    }
  }
  return g;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE AUDIT
// ═══════════════════════════════════════════════════════════════════════════

export type CollisionClass = 'TEXT_TEXT' | 'TEXT_STROKE' | 'TEXT_SYMBOL' | 'TEXT_OFFSHEET' | 'TEXT_REPEAT' | 'TEXT_CLEARANCE';
export const COLLISION_CLASS_ORDER: CollisionClass[] =
  ['TEXT_TEXT', 'TEXT_STROKE', 'TEXT_SYMBOL', 'TEXT_OFFSHEET', 'TEXT_REPEAT', 'TEXT_CLEARANCE'];
/** The defect classes, gated per variant by tests/sldLegibility.test.ts. A near
 *  miss (TEXT_CLEARANCE) is gated on its matrix total only: moving a label off
 *  a line may legitimately trade one near miss for another somewhere else. */
export const PER_VARIANT_CLASSES: CollisionClass[] = ['TEXT_TEXT', 'TEXT_STROKE', 'TEXT_SYMBOL', 'TEXT_OFFSHEET', 'TEXT_REPEAT'];

/**
 * The classes, each with its tolerance and what it means on paper. One physical
 * defect lands in ONE class: open linework is TEXT_STROKE; the outline of a
 * closed shape (a box, a circle, a hexagon tag) is TEXT_SYMBOL.
 */
export const COLLISION_CLASSES: Record<CollisionClass, { tolerance: number; unit: string; description: string }> = {
  TEXT_TEXT: {
    tolerance: 0.6, unit: 'uu',
    description: 'Two labels print on top of each other: their ink boxes overlap by more than 0.6 uu both across and down.',
  },
  TEXT_STROKE: {
    tolerance: 0.6, unit: 'uu',
    description: 'An open line — a wire, a green EGC drop, a CT lead, a leader, a table rule — runs through a label: more '
      + 'than 0.6 uu of its centre-line lies inside the label\'s ink box (shrunk 0.6 uu, grown by half the stroke width). '
      + 'A leader that stops at the label edge does not count; a stretch hidden under an opaque fill painted after '
      + 'the line and before the label (a knockout) does not count.',
  },
  TEXT_SYMBOL: {
    tolerance: 0.6, unit: 'uu',
    description: 'A label sits on a symbol it does not belong to: a closed shape\'s outline (box border, meter circle, '
      + 'breaker, hexagon tag) runs through it by more than 0.6 uu; it straddles a coloured fill or an illustration\'s box; '
      + 'or a shape/illustration painted AFTER it covers more than 0.36 uu² of it. A label wholly inside a box, a badge '
      + 'or an illustration it was placed on belongs to it.',
  },
  TEXT_OFFSHEET: {
    tolerance: 0.6, unit: 'uu',
    description: 'A label is clipped by the viewBox, crosses the sheet border, or runs into the title block, by more than 0.6 uu.',
  },
  TEXT_REPEAT: {
    tolerance: 80, unit: 'uu',
    description: 'One equipment name printed twice within 80 uu inside the schematic, illustration and symbol labels '
      + 'included — the same label, or one label\'s words contained in a nearby label ("AC DISCONNECT" 23 uu under '
      + '"(N) AC DISCONNECT"; "STRING INVERTER" on the cabinet under the "STRING INVERTER" header). Compared with '
      + '"(N) ", "(E) ", " — SYSTEM" and a trailing "PANEL" removed; the contained label needs 8+ letters and 2+ words.',
  },
  TEXT_CLEARANCE: {
    tolerance: 1.5, unit: 'uu',
    description: 'A near miss: a line, a symbol outline or another label comes within 1.5 uu of a label\'s ink without '
      + 'hitting it (a hit is one of the classes above, never both). 1.5 uu is 0.4 mm of paper at 1:1 — it reads as '
      + 'touching, and in any fallback face (the Diagram tab printed SERIF) it IS touching: Ray\'s \'N — UNSWITCHED\' '
      + 'and \'CONSUMPTION CTs @ MSP\' sit 1.2 uu from their lines in the real face.',
  },
};

export interface Finding {
  cls: CollisionClass;
  variant?: string;
  text: string;
  textBox: Box;
  fontSize: number;
  /** What the label collides with. */
  other: { kind: 'text' | 'stroke' | 'shape' | 'art' | 'sheet'; tag: string; desc: string; text?: string; box: Box; order: number };
  /** Centre of the collision, absolute uu. */
  at: Pt;
  /** Crossing length / protrusion / overlap depth (uu), or overlap area (uu²). */
  amount: number;
  unit: 'uu' | 'uu²';
  /** A length-like number for ranking across classes (√area for areas). */
  severity: number;
  detail: string;
  textOwner: string | null;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
export const fmtBox = (b: Box): string => `[${r1(b.x0)},${r1(b.y0)} → ${r1(b.x1)},${r1(b.y1)}]`;
const centre = (b: Box): Pt => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const letters = (s: string): number => (s.match(/[A-Za-z]/g) ?? []).length;

interface Mask { order: number; box: Box; poly: Pt[] | null }

export interface AuditOptions {
  variant?: string;
  /** Override the hit tolerance (uu) of TEXT_TEXT / STROKE / SYMBOL / OFFSHEET. */
  tolerance?: number;
  /** Override the TEXT_CLEARANCE band (uu). */
  clearance?: number;
}

/** Audit one finished SLD (the SVG string, or its parsed geometry). */
export function auditSld(input: string | SldGeometry, opts: AuditOptions = {}): Finding[] {
  const g = typeof input === 'string' ? parseSld(input) : input;
  const TOL = opts.tolerance ?? 0.6;
  const out: Finding[] = [];
  const texts = g.texts.filter(t => t.art === null);
  const strokes = g.strokes.filter(s => s.art === null);
  const shapes = g.shapes.filter(s => s.art === null && s.role === 'shape');
  const arts = g.arts.filter(a => boxOk(a.box));

  // Opaque paint that can hide a stretch of line under a label (a knockout).
  const masks: Mask[] = [
    ...g.shapes.filter(s => s.art === null && s.fill).map(s => ({ order: s.order, box: s.box, poly: s.poly })),
    ...arts.map(a => ({ order: a.order, box: a.box, poly: null })),
  ];
  const maskedAt = (x: number, y: number, lo: number, hi: number): boolean => masks.some(mk =>
    mk.order > lo && mk.order < hi && x >= mk.box.x0 && x <= mk.box.x1 && y >= mk.box.y0 && y <= mk.box.y1
    && (!mk.poly || pointInPoly(x, y, mk.poly)));
  /** Visible length of `pieces` — sampled every ~0.25 uu against the masks. */
  const visibleLen = (pieces: Seg[], lo: number, hi: number): { len: number; at: Pt | null } => {
    let len = 0, best = 0, at: Pt | null = null;
    for (const p of pieces) {
      const L = segLen(p);
      if (L <= 0) continue;
      const n = Math.max(2, Math.ceil(L / 0.25));
      let vis = 0;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        if (!maskedAt(p[0] + (p[2] - p[0]) * t, p[1] + (p[3] - p[1]) * t, lo, hi)) vis++;
      }
      const v = (L * vis) / n;
      len += v;
      if (v > best) { best = v; at = [(p[0] + p[2]) / 2, (p[1] + p[3]) / 2]; }
    }
    return { len, at };
  };
  const push = (f: Omit<Finding, 'variant' | 'severity'>, severity?: number) =>
    out.push({ ...f, variant: opts.variant, severity: severity ?? (f.unit === 'uu²' ? Math.sqrt(f.amount) : f.amount) });
  /** `${text}|kind|index` of every pair that is a HIT — a near miss is never also a hit. */
  const hits = new Set<string>();

  for (const T of texts) {
    const ink = T.box;
    const inset = grow(ink, -TOL);
    if (!boxOk(inset)) continue;          // a sliver of type (a lone '.') has no interior to collide

    // ── TEXT_STROKE: open linework through the label ──
    for (const S of strokes) {
      const eb = grow(ink, S.sw / 2 - TOL);
      if (!touches(S.box, eb)) continue;
      const pieces = clipSegs(S.segs, eb);
      if (!pieces.length) continue;
      const lo = Math.min(S.order, T.order), hi = Math.max(S.order, T.order);
      const { len, at } = S.order < T.order ? visibleLen(pieces, lo, hi)
        : { len: pieces.reduce((a, p) => a + segLen(p), 0), at: centre(boxOfSegs(pieces)) };
      if (len <= TOL) continue;
      hits.add(`${T.i}|s|${S.i}`);
      push({ cls: 'TEXT_STROKE', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
        other: { kind: 'stroke', tag: S.tag, desc: S.desc, box: S.box, order: S.order },
        at: at ?? centre(ink), amount: len, unit: 'uu',
        detail: `${S.desc} runs ${r1(len)} uu through the label` });
    }

    // ── TEXT_SYMBOL: closed shapes ──
    for (const S of shapes) {
      if (!touches(grow(S.box, S.sw / 2), ink)) continue;
      if (S.fill && S.order > T.order) {
        const area = polyArea(clipPolyToBox(S.poly, inset));
        if (area > TOL * TOL) {
          hits.add(`${T.i}|h|${S.i}`);
          push({ cls: 'TEXT_SYMBOL', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
            other: { kind: 'shape', tag: S.tag, desc: S.desc, box: S.box, order: S.order },
            at: centre(inset), amount: area, unit: 'uu²',
            detail: `${S.desc} is painted OVER the label (covers ${r1(area)} uu²)` });
          continue;
        }
      }
      if (S.stroke) {
        const eb = grow(ink, S.sw / 2 - TOL);
        const pieces = clipSegs(S.outline, eb);
        if (pieces.length) {
          const { len, at } = S.order < T.order ? visibleLen(pieces, S.order, T.order)
            : { len: pieces.reduce((a, p) => a + segLen(p), 0), at: centre(boxOfSegs(pieces)) };
          if (len > TOL) {
            hits.add(`${T.i}|h|${S.i}`);
            push({ cls: 'TEXT_SYMBOL', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
              other: { kind: 'shape', tag: S.tag, desc: S.desc, box: S.box, order: S.order },
              at: at ?? centre(ink), amount: len, unit: 'uu',
              detail: `the outline of ${S.desc} runs ${r1(len)} uu through the label` });
            continue;
          }
        }
      }
      if (S.fill && !isLight(S.fill)) {
        const inside = [[inset.x0, inset.y0], [inset.x1, inset.y0], [inset.x1, inset.y1], [inset.x0, inset.y1]]
          .every(([x, y]) => pointInPoly(x, y, S.poly));
        if (inside) continue;               // a badge: the label was placed on it
        const area = polyArea(clipPolyToBox(S.poly, inset));
        if (area > TOL * TOL) {
          hits.add(`${T.i}|h|${S.i}`);
          push({ cls: 'TEXT_SYMBOL', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
            other: { kind: 'shape', tag: S.tag, desc: S.desc, box: S.box, order: S.order },
            at: centre(inset), amount: area, unit: 'uu²',
            detail: `the label half-sits on ${S.desc} (${r1(area)} uu² on it)` });
        }
      }
    }
    for (const A of arts) {
      const { w, h } = overlapWH(inset, A.box);
      if (w <= 0 || h <= 0 || w * h <= TOL * TOL) continue;
      const after = A.order > T.order;
      if (!after && within(inset, A.box)) continue;   // a label placed on its illustration
      push({ cls: 'TEXT_SYMBOL', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
        other: { kind: 'art', tag: 'g', desc: `illustration ${A.name}`, box: A.box, order: A.order },
        at: centre({ x0: Math.max(inset.x0, A.box.x0), y0: Math.max(inset.y0, A.box.y0), x1: Math.min(inset.x1, A.box.x1), y1: Math.min(inset.y1, A.box.y1) }),
        amount: w * h, unit: 'uu²',
        detail: after ? `illustration ${A.name} is painted OVER the label (${r1(w)}×${r1(h)} uu)`
          : `the label straddles illustration ${A.name} (${r1(w)}×${r1(h)} uu on it)` });
    }

    // ── TEXT_OFFSHEET — at most one per label, the outermost edge it passes ──
    const vb = g.viewBox;
    const beyond = (b: Box) => Math.max(b.x0 - ink.x0, b.y0 - ink.y0, ink.x1 - b.x1, ink.y1 - b.y1);
    const sheetOther = (desc: string, b: Box) => ({ kind: 'sheet' as const, tag: 'svg', desc, box: b, order: 0 });
    const offsheet = (desc: string, b: Box, amount: number, detail: string) =>
      push({ cls: 'TEXT_OFFSHEET', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
        other: sheetOther(desc, b), at: centre(ink), amount, unit: 'uu', detail });
    const inner = g.frame ? grow(g.frame, -g.frameStrokeWidth / 2) : null;
    if (beyond(vb) > TOL) offsheet('viewBox edge', vb, beyond(vb), `clipped by the viewBox (${r1(beyond(vb))} uu outside)`);
    else if (inner && beyond(inner) > TOL) offsheet('sheet border', g.frame!, beyond(inner), `crosses the sheet border by ${r1(beyond(inner))} uu`);
    else if (g.titleBlock && !within(inset, g.titleBlock)) {
      const tbx = g.titleBlock;
      const { w, h } = overlapWH(ink, tbx);
      const [cx, cy] = centre(ink);
      const mine = cx >= tbx.x0 && cx <= tbx.x1 && cy >= tbx.y0 && cy <= tbx.y1;
      if (w > TOL && h > TOL) {
        if (mine) offsheet('title block', tbx, beyond(tbx), `a title-block label overflows the title block by ${r1(beyond(tbx))} uu`);
        else offsheet('title block', tbx, w, `runs ${r1(w)} uu into the title block`);
      }
    }
  }

  // ── TEXT_TEXT (each pair once) ──
  for (let a = 0; a < texts.length; a++) {
    for (let b = a + 1; b < texts.length; b++) {
      const A = texts[a], B = texts[b];
      const { w, h } = overlapWH(A.box, B.box);
      if (w <= TOL || h <= TOL) continue;
      const ov: Box = { x0: Math.max(A.box.x0, B.box.x0), y0: Math.max(A.box.y0, B.box.y0),
        x1: Math.min(A.box.x1, B.box.x1), y1: Math.min(A.box.y1, B.box.y1) };
      // Knocked out: an opaque fill painted between them covers the overlap.
      const [lo, hi] = [Math.min(A.order, B.order), Math.max(A.order, B.order)];
      const c = centre(ov);
      if (lo !== hi && maskedAt(c[0], c[1], lo, hi) && maskedAt(ov.x0, ov.y0, lo, hi) && maskedAt(ov.x1, ov.y1, lo, hi)) continue;
      hits.add(`${A.i}|t|${B.i}`);
      push({ cls: 'TEXT_TEXT', text: A.text, textBox: A.box, fontSize: A.fontSize, textOwner: A.owner,
        other: { kind: 'text', tag: 'text', desc: `text "${B.text}"`, text: B.text, box: B.box, order: B.order },
        at: c, amount: w * h, unit: 'uu²',
        detail: `overlaps "${B.text}" by ${r1(w)}×${r1(h)} uu` });
    }
  }

  // ── ART LABELS — the words inside an illustration / embedded symbol ──────
  // See the module header. Each art label is checked at the art's BOUNDARY
  // (whatever was painted over the art) and, when it prints at the floor,
  // against its own art.
  const artHits = new Set<string>();
  {
    const floored = (t: SldText) => t.authoredSize <= TYPE_FLOOR_UU + 0.01;
    /** Every opaque fill (art or layout) — an art's own panels mask its lines. */
    const fillMasks: Mask[] = g.shapes.filter(s => s.fill).map(s => ({ order: s.order, box: s.box, poly: s.poly }));
    const hiddenAt = (x: number, y: number, lo: number, hi: number) => fillMasks.some(mk =>
      mk.order > lo && mk.order < hi && x >= mk.box.x0 && x <= mk.box.x1 && y >= mk.box.y0 && y <= mk.box.y1
      && (!mk.poly || pointInPoly(x, y, mk.poly)));
    const shownLen = (pieces: Seg[], lo: number, hi: number): { len: number; at: Pt | null } => {
      let len = 0, best = 0, at: Pt | null = null;
      for (const p of pieces) {
        const L = segLen(p);
        if (L <= 0) continue;
        const n = Math.max(2, Math.ceil(L / 0.25));
        let vis = 0;
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          if (!hiddenAt(p[0] + (p[2] - p[0]) * t, p[1] + (p[3] - p[1]) * t, lo, hi)) vis++;
        }
        const v = (L * vis) / n;
        len += v;
        if (v > best) { best = v; at = [(p[0] + p[2]) / 2, (p[1] + p[3]) / 2]; }
      }
      return { len, at };
    };
    const artName = (i: number | null) => (i === null ? 'the layout' : g.arts[i]?.name ?? 'an illustration');
    const artTexts = g.texts.filter(t => t.art !== null && boxOk(grow(t.box, -TOL)));
    // An art's own ink extent (its shapes and lines, not its words).
    const artInk = new Map<number, Box>();
    for (const s of [...g.shapes, ...g.strokes]) {
      if (s.art === null) continue;
      const b = grow(s.box, s.sw / 2);
      artInk.set(s.art, artInk.has(s.art) ? unite(artInk.get(s.art)!, b) : b);
    }
    for (const T of artTexts) {
      const A = g.arts[T.art!];
      const ink = T.box, inset = grow(ink, -TOL);
      const mine = floored(T);
      const own = (x: { art: number | null }) => x.art === T.art;
      const where = `(${A.name})`;

      // ── linework: layout painted over the art, or the art's own lines ──
      for (const S of g.strokes) {
        const over = S.art === null && S.order > A.endOrder;
        const ownLine = own(S) && mine;
        if (!over && !ownLine) continue;
        const eb = grow(ink, S.sw / 2 - TOL);
        if (!touches(S.box, eb)) continue;
        const pieces = clipSegs(S.segs, eb);
        if (!pieces.length) continue;
        const { len, at } = S.order < T.order ? shownLen(pieces, S.order, T.order)
          : { len: pieces.reduce((a, p) => a + segLen(p), 0), at: centre(boxOfSegs(pieces)) };
        if (len <= TOL) continue;
        artHits.add(`${T.i}|s|${S.i}`);
        push({ cls: 'TEXT_STROKE', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
          other: { kind: 'stroke', tag: S.tag, desc: `${S.desc}${ownLine ? ` of ${A.name}` : ''}`, box: S.box, order: S.order },
          at: at ?? centre(ink), amount: len, unit: 'uu',
          detail: `${S.desc} ${ownLine ? 'of its own art' : 'drawn over the art'} runs ${r1(len)} uu through the art label ${where}` });
      }

      // ── closed shapes: layout over the art, another art over this label, or its own panels ──
      for (const S of g.shapes) {
        if (S.role !== 'shape') continue;
        const layoutOver = S.art === null && S.order > A.endOrder;
        const otherArtOver = S.art !== null && !own(S) && S.order > T.order;
        const ownShape = own(S) && mine;
        if (!layoutOver && !otherArtOver && !ownShape) continue;
        if (!touches(grow(S.box, S.sw / 2), ink)) continue;
        if (S.fill && S.order > T.order) {
          const area = polyArea(clipPolyToBox(S.poly, inset));
          if (area > TOL * TOL) {
            artHits.add(`${T.i}|h|${S.i}`);
            push({ cls: 'TEXT_SYMBOL', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
              other: { kind: 'shape', tag: S.tag, desc: `${S.desc} (${artName(S.art)})`, box: S.box, order: S.order },
              at: centre(inset), amount: area, unit: 'uu²',
              detail: `${S.desc} of ${artName(S.art)} is painted OVER the art label ${where} (covers ${r1(area)} uu²)` });
            continue;
          }
        }
        if (otherArtOver) continue;             // another art's outline under its own fill is that art's business
        if (S.stroke) {
          const eb = grow(ink, S.sw / 2 - TOL);
          const pieces = clipSegs(S.outline, eb);
          if (pieces.length) {
            const { len, at } = S.order < T.order ? shownLen(pieces, S.order, T.order)
              : { len: pieces.reduce((a, p) => a + segLen(p), 0), at: centre(boxOfSegs(pieces)) };
            if (len > TOL) {
              artHits.add(`${T.i}|h|${S.i}`);
              push({ cls: 'TEXT_SYMBOL', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
                other: { kind: 'shape', tag: S.tag, desc: `${S.desc} (${artName(S.art)})`, box: S.box, order: S.order },
                at: at ?? centre(ink), amount: len, unit: 'uu',
                detail: `the outline of ${S.desc} (${artName(S.art)}) runs ${r1(len)} uu through the art label ${where}` });
              continue;
            }
          }
        }
        if (ownShape && S.fill && !isLight(S.fill) && S.order < T.order) {
          const inside = [[inset.x0, inset.y0], [inset.x1, inset.y0], [inset.x1, inset.y1], [inset.x0, inset.y1]]
            .every(([x, y]) => pointInPoly(x, y, S.poly));
          if (inside) continue;                 // printed on its plate
          const area = polyArea(clipPolyToBox(S.poly, inset));
          if (area > TOL * TOL) {
            artHits.add(`${T.i}|h|${S.i}`);
            push({ cls: 'TEXT_SYMBOL', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
              other: { kind: 'shape', tag: S.tag, desc: `${S.desc} (${A.name})`, box: S.box, order: S.order },
              at: centre(inset), amount: area, unit: 'uu²',
              detail: `the art label ${where}, grown to the type floor, half-sits on its own ${S.desc} (${r1(area)} uu² on it)` });
          }
        }
      }

      // ── its own ink bounds: a floored label wider than the art it belongs to ──
      const bound = artInk.get(T.art!);
      if (mine && bound) {
        const over = Math.max(bound.x0 - ink.x0, ink.x1 - bound.x1, bound.y0 - ink.y0, ink.y1 - bound.y1);
        if (over > TOL) {
          push({ cls: 'TEXT_SYMBOL', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
            other: { kind: 'art', tag: 'g', desc: `the edge of ${A.name}`, box: bound, order: A.order },
            at: centre(ink), amount: over, unit: 'uu',
            detail: `the art label ${where}, grown to the type floor, runs ${r1(over)} uu past its own illustration` });
        }
      }

      // ── labels: layout labels over the art, another art's labels, its own (floored) ──
      for (const B of g.texts) {
        if (B.i === T.i || !boxOk(grow(B.box, -TOL))) continue;
        const layoutOver = B.art === null && B.order > A.endOrder;
        const otherArt = B.art !== null && B.art !== T.art && B.i > T.i;
        const ownPair = B.art === T.art && B.i > T.i && (mine || floored(B));
        if (!layoutOver && !otherArt && !ownPair) continue;
        const { w, h } = overlapWH(ink, B.box);
        if (w <= TOL || h <= TOL) continue;
        artHits.add(`${T.i}|t|${B.i}`);
        push({ cls: 'TEXT_TEXT', text: T.text, textBox: ink, fontSize: T.fontSize, textOwner: T.owner,
          other: { kind: 'text', tag: 'text', desc: `text "${B.text}" (${artName(B.art)})`, text: B.text, box: B.box, order: B.order },
          at: centre({ x0: Math.max(ink.x0, B.box.x0), y0: Math.max(ink.y0, B.box.y0), x1: Math.min(ink.x1, B.box.x1), y1: Math.min(ink.y1, B.box.y1) }),
          amount: w * h, unit: 'uu²', detail: `the art label ${where} overlaps "${B.text}" by ${r1(w)}×${r1(h)} uu` });
      }
    }
  }

  // ── TEXT_REPEAT: one equipment name twice, close together, in the schematic ──
  // Art labels included (a cabinet that says what its header says is the same
  // defect as a strip that does). Equality OR containment, on the words.
  {
    const words = (s: string) => s.toUpperCase()
      .replace(/^\((?:N|E)\)\s+/, '')
      .replace(/\s+[—–-]\s+SYSTEM$/, '')
      .replace(/\s+PANEL$/, '')
      .replace(/[·|]/g, ' ')
      .split(/\s+/).filter(Boolean);
    const contains = (big: string[], small: string[]) => {
      if (small.length > big.length) return false;
      for (let i = 0; i + small.length <= big.length; i++) {
        if (small.every((w, k) => big[i + k] === w)) return true;
      }
      return false;
    };
    const pool = g.texts.filter(t => t.schematic && letters(t.text) >= 8);
    for (let a = 0; a < pool.length; a++) {
      for (let b = a + 1; b < pool.length; b++) {
        const A = pool[a], B = pool[b];
        const [wa, wb] = [words(A.text), words(B.text)];
        const same = wa.join(' ') === wb.join(' ');
        const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
        const inside = !same && small.length >= 2 && letters(small.join(' ')) >= 8 && contains(big, small);
        if (!same && !inside) continue;
        const [ca, cb] = [centre(A.box), centre(B.box)];
        const d = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
        if (d > COLLISION_CLASSES.TEXT_REPEAT.tolerance) continue;
        push({ cls: 'TEXT_REPEAT', text: A.text, textBox: A.box, fontSize: A.fontSize, textOwner: A.owner,
          other: { kind: 'text', tag: 'text', desc: `${same ? 'the same label' : `"${B.text}"`} again at ${fmtBox(B.box)}`, text: B.text, box: B.box, order: B.order },
          at: [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2], amount: d, unit: 'uu',
          detail: same ? `"${A.text}" is printed twice, ${r1(d)} uu apart`
            : `"${A.text}" and "${B.text}" name the same thing ${r1(d)} uu apart` });
      }
    }
  }

  // ── TEXT_CLEARANCE: near misses (never also a hit) ──
  {
    const CLEAR = opts.clearance ?? COLLISION_CLASSES.TEXT_CLEARANCE.tolerance;
    const near = (T: SldText, other: Finding['other'], gap: number, at: Pt, what: string) =>
      push({ cls: 'TEXT_CLEARANCE', text: T.text, textBox: T.box, fontSize: T.fontSize, textOwner: T.owner, other,
        at, amount: Math.max(0, gap), unit: 'uu', detail: `${what} ${r1(Math.max(0, gap))} uu from the label` },
      CLEAR - Math.max(0, gap));
    /** Closest approach of linework to the ink box; a LEADER (a segment that runs
     *  head-on into the label and stops there) is not a near miss — it is how a
     *  label is tied to what it names. */
    const approach = (segs: Seg[], b: Box, sw: number, lo: number, hi: number, leaderEnds: boolean) => {
      let best = Infinity, at: Pt = [0, 0];
      segs.forEach((s, k) => {
        const [d, p] = distSegBox(s, b);
        if (d - sw / 2 >= best) return;
        if (leaderEnds && (k === 0 || k === segs.length - 1)) {
          const L = segLen(s);
          const [dA] = distSegBox([s[0], s[1], s[0], s[1]], b), [dB] = distSegBox([s[2], s[3], s[2], s[3]], b);
          // The polyline's own first or last point is the one at the label.
          const startNear = k === 0 && dA <= dB, endNear = k === segs.length - 1 && dB <= dA;
          if (L > 0 && Math.abs(dA - dB) >= 0.7 * L && (startNear || endNear)) return;
        }
        if (lo < hi && maskedAt(p[0], p[1], lo, hi)) return;
        best = d - sw / 2; at = p;
      });
      return { gap: best, at };
    };
    // An art's label and the layout linework painted over its art: a line that
    // misses the caps by 0.5 uu reads as touching them (the BUI's transfer path
    // over 'IQ SYSTEM').
    for (const T of g.texts) {
      if (T.art === null || !boxOk(grow(T.box, -TOL))) continue;
      const A = g.arts[T.art];
      const zone = grow(T.box, CLEAR + 3);
      for (const S of strokes) {
        if (S.order <= A.endOrder || !touches(S.box, zone) || artHits.has(`${T.i}|s|${S.i}`)) continue;
        const { gap, at } = approach(S.segs, T.box, S.sw, S.order, T.order, true);
        if (gap < CLEAR) near(T, { kind: 'stroke', tag: S.tag, desc: `${S.desc} drawn over ${A.name}`, box: S.box, order: S.order }, gap, at, S.desc);
      }
    }
    for (const T of texts) {
      const ink = T.box;
      if (!boxOk(grow(ink, -TOL))) continue;
      const zone = grow(ink, CLEAR + 3);
      for (const S of strokes) {
        if (!touches(S.box, zone) || hits.has(`${T.i}|s|${S.i}`)) continue;
        const { gap, at } = approach(S.segs, ink, S.sw, S.order, T.order, true);
        if (gap < CLEAR) near(T, { kind: 'stroke', tag: S.tag, desc: S.desc, box: S.box, order: S.order }, gap, at, S.desc);
      }
      for (const S of shapes) {
        if (!S.stroke || !touches(grow(S.box, S.sw / 2), zone) || hits.has(`${T.i}|h|${S.i}`)) continue;
        const { gap, at } = approach(S.outline, ink, S.sw, S.order, T.order, false);
        if (gap < CLEAR) near(T, { kind: 'shape', tag: S.tag, desc: S.desc, box: S.box, order: S.order }, gap, at, `the outline of ${S.desc}`);
      }
    }
    for (let a = 0; a < texts.length; a++) {
      const A = texts[a];
      if (!boxOk(grow(A.box, -TOL))) continue;
      for (let b = a + 1; b < texts.length; b++) {
        const B = texts[b];
        if (hits.has(`${A.i}|t|${B.i}`) || !boxOk(grow(B.box, -TOL))) continue;
        const dx = Math.max(A.box.x0 - B.box.x1, B.box.x0 - A.box.x1, 0);
        const dy = Math.max(A.box.y0 - B.box.y1, B.box.y0 - A.box.y1, 0);
        const gap = Math.hypot(dx, dy);
        if (gap >= CLEAR) continue;
        const at: Pt = [(Math.max(A.box.x0, B.box.x0) + Math.min(A.box.x1, B.box.x1)) / 2,
          (Math.max(A.box.y0, B.box.y0) + Math.min(A.box.y1, B.box.y1)) / 2];
        near(A, { kind: 'text', tag: 'text', desc: `text "${B.text}"`, text: B.text, box: B.box, order: B.order }, gap, at, `"${B.text}" sits`);
      }
    }
  }
  return out;
}

/** Distance from segment s to box b (0 when they meet) and the closest point on s. */
function distSegBox(s: Seg, b: Box): [number, Pt] {
  if (clipT(s, b)) {
    const t = clipT(s, b)!;
    const m = (t[0] + t[1]) / 2;
    return [0, [s[0] + (s[2] - s[0]) * m, s[1] + (s[3] - s[1]) * m]];
  }
  const ptBox = (x: number, y: number) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
  let best = Infinity, at: Pt = [s[0], s[1]];
  // Endpoints of the segment to the box.
  for (const [x, y] of [[s[0], s[1]], [s[2], s[3]]] as Pt[]) { const d = ptBox(x, y); if (d < best) { best = d; at = [x, y]; } }
  // Box corners to the segment.
  const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy;
  for (const [cx, cy] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]] as Pt[]) {
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((cx - s[0]) * dx + (cy - s[1]) * dy) / L2)) : 0;
    const px = s[0] + dx * t, py = s[1] + dy * t;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) { best = d; at = [px, py]; }
  }
  return [best, at];
}

/** Findings per class (every class present, zeros included). */
export function countByClass(findings: readonly Finding[]): Record<CollisionClass, number> {
  const c = Object.fromEntries(COLLISION_CLASS_ORDER.map(k => [k, 0])) as Record<CollisionClass, number>;
  for (const f of findings) c[f.cls]++;
  return c;
}

/** One line per finding, for a failing assertion's message. */
export function describeFinding(f: Finding): string {
  return `${f.cls}${f.variant ? ` [${f.variant}]` : ''} "${f.text}" ${fmtBox(f.textBox)} × ${f.other.desc} `
    + `@${r1(f.at[0])},${r1(f.at[1])} — ${f.detail}`;
}

/**
 * A grouping key that survives a changed number: the class, the label with its
 * digits collapsed, and what it hits. The report groups by this so a later stage
 * sees "EQUIPMENT GROUNDING CONDUCTORS × green dashed line, 56 variants" rather
 * than 56 lines.
 */
export function offenderKey(f: Finding): string {
  const n = (s: string) => s.replace(/\d+(?:\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
  const other = f.other.kind === 'text' ? `text "${n(f.other.text ?? '')}"` : n(f.other.desc.replace(/ sw[\d.]+/, ''));
  return `${f.cls} | "${n(f.text)}" × ${other}`;
}
