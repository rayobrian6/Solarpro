/**
 * tests/support/sldTableCells.ts — THE TABLES UNDER THE DRAWING, CELL BY CELL.
 *
 * Ray, 2026-09-26: "Biggest issue I have with the sld is the word bleed and
 * overlays. This should be cleaner to read!!" The collision audit
 * (./sldGeometry.ts) sees a value that runs THROUGH a column rule or onto the
 * text beside it. Two table defects it cannot see, because nothing is hit:
 *
 *   CELL_GUTTER  two values on one row of a table with no rule between them
 *                (a label and its value — the calculation panels are ruled
 *                only around the panel) stand closer than a half-em. Nothing
 *                touches, and it still reads as ONE phrase: 'Consumption
 *                CTs2 × CLAMP …'.
 *   CELL_WALL    a value jammed against its column rule or the table's side:
 *                closer than CELL_PAD to it. Inside 1.5 uu the main audit calls
 *                it a near miss; between that and CELL_PAD it still reads as
 *                spilling out of its cell — every cell here is drawn with 4 uu
 *                of inset.
 *
 * WHAT A TABLE IS, read from the finished SVG with no help from the renderer:
 * a stroked rectangle outside the schematic's scale group (and outside the
 * title block), at least 100 × 30 uu and under 45% of the sheet (the schematic
 * box is half of it; a stacked E-1.1 schedule a third), that
 * holds two or more labels. Each label belongs to the SMALLEST such rectangle
 * its ink centre is in. The table's walls are its own left and right edges and
 * every vertical line drawn inside it (column rules). This covers the
 * single-lane calculation panels and schedules (the Diagram sheet, E-1.1), the
 * multi-lane band tables, and the legend.
 */

import { parseSld, boxOk, type Box, type SldGeometry, type SldText, type Pt } from './sldGeometry';

export type CellClass = 'CELL_GUTTER' | 'CELL_WALL';
export const CELL_CLASS_ORDER: CellClass[] = ['CELL_GUTTER', 'CELL_WALL'];

/** A label keeps this far (uu) off its cell's walls. */
export const CELL_PAD = 2;
/** Two labels on one row, with no rule between them, stand at least this far
 *  apart (uu) — about 0.7 em at the printed floor (8.67 uu). */
export const CELL_GUTTER = 6;

export const CELL_CLASSES: Record<CellClass, { tolerance: number; description: string }> = {
  CELL_GUTTER: {
    tolerance: CELL_GUTTER,
    description: `Two labels on one table row with no column rule between them stand less than ${CELL_GUTTER} uu apart `
      + '(or overlap): they read as one run-on phrase.',
  },
  CELL_WALL: {
    tolerance: CELL_PAD,
    description: `A table label comes within ${CELL_PAD} uu of a column rule or the table's side (or crosses it): `
      + 'it reads as spilling out of its cell.',
  },
};

export interface SldTable {
  box: Box;
  /** The white title in its black bar, else the first label — for reports. */
  title: string;
  texts: SldText[];
  /** Vertical walls: the table's sides and its column rules. */
  walls: Array<{ x: number; y0: number; y1: number; sw: number; desc: string }>;
}

export interface CellFinding {
  cls: CellClass;
  variant?: string;
  table: string;
  text: string;
  textBox: Box;
  /** The other label, or the wall. */
  other: string;
  otherBox: Box;
  /** The clear space left (uu); 0 when they meet or cross. */
  gap: number;
  at: Pt;
  detail: string;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const fmt = (b: Box): string => `[${r1(b.x0)},${r1(b.y0)} → ${r1(b.x1)},${r1(b.y1)}]`;
const inside = (b: Box, x: number, y: number, d = 0): boolean =>
  x >= b.x0 + d && x <= b.x1 - d && y >= b.y0 + d && y <= b.y1 - d;
const within = (inner: Box, outer: Box, d = 0): boolean =>
  inner.x0 >= outer.x0 - d && inner.x1 <= outer.x1 + d && inner.y0 >= outer.y0 - d && inner.y1 <= outer.y1 + d;
const area = (b: Box): number => (b.x1 - b.x0) * (b.y1 - b.y0);

/** The tables of one finished SLD. */
export function findTables(input: string | SldGeometry): SldTable[] {
  const g = typeof input === 'string' ? parseSld(input) : input;
  const vb = g.viewBox;
  const sheet = (vb.x1 - vb.x0) * (vb.y1 - vb.y0);
  const inTitleBlock = (b: Box) => !!g.titleBlock && within(b, g.titleBlock, 1);
  const cands = g.shapes.filter(s => s.tag === 'rect' && s.role === 'shape' && !!s.stroke && s.art === null && !s.schematic
    && s.box.x1 - s.box.x0 >= 100 && s.box.y1 - s.box.y0 >= 30 && area(s.box) <= 0.45 * sheet && !inTitleBlock(s.box));
  const groups = new Map<number, SldText[]>();
  for (const t of g.texts) {
    if (t.art !== null || t.schematic || inTitleBlock(t.box) || !boxOk(t.box)) continue;
    const cx = (t.box.x0 + t.box.x1) / 2, cy = (t.box.y0 + t.box.y1) / 2;
    let best = -1;
    cands.forEach((c, k) => {
      if (inside(c.box, cx, cy, 0.5) && (best < 0 || area(c.box) < area(cands[best].box))) best = k;
    });
    if (best >= 0) groups.set(best, [...(groups.get(best) ?? []), t]);
  }
  const tables: SldTable[] = [];
  for (const [k, texts] of groups) {
    if (texts.length < 2) continue;
    const c = cands[k];
    const b = c.box;
    const walls: SldTable['walls'] = [
      { x: b.x0, y0: b.y0, y1: b.y1, sw: c.sw, desc: 'the table\'s left side' },
      { x: b.x1, y0: b.y0, y1: b.y1, sw: c.sw, desc: 'the table\'s right side' },
    ];
    for (const s of g.strokes) {
      if (s.art !== null || s.schematic || !within(s.box, b, 1)) continue;
      for (const [x1, y1, x2, y2] of s.segs) {
        if (Math.abs(x1 - x2) < 0.5 && Math.abs(y2 - y1) >= 12) {
          walls.push({ x: (x1 + x2) / 2, y0: Math.min(y1, y2), y1: Math.max(y1, y2), sw: s.sw, desc: `column rule (${s.desc})` });
        }
      }
    }
    const title = texts.find(t => /^#?f{3}(?:fff)?$/i.test(t.fill.replace('#', '')) || /white/i.test(t.fill))?.text ?? texts[0].text;
    tables.push({ box: b, title, texts, walls });
  }
  return tables;
}

/** Audit every table cell of one finished SLD. */
export function auditTableCells(input: string | SldGeometry, opts: { variant?: string } = {}): CellFinding[] {
  const out: CellFinding[] = [];
  for (const T of findTables(input)) {
    const push = (f: Omit<CellFinding, 'variant' | 'table'>) => out.push({ ...f, variant: opts.variant, table: T.title });
    // ── CELL_WALL ──
    for (const t of T.texts) {
      const b = t.box;
      for (const w of T.walls) {
        if (w.y1 < b.y0 + 0.5 || w.y0 > b.y1 - 0.5) continue;       // the rule does not pass this row
        const gap = (w.x < b.x0 ? b.x0 - w.x : w.x > b.x1 ? w.x - b.x1 : -1) - w.sw / 2;
        if (gap >= CELL_PAD) continue;
        push({ cls: 'CELL_WALL', text: t.text, textBox: b, other: w.desc,
          otherBox: { x0: w.x, y0: w.y0, x1: w.x, y1: w.y1 }, gap: Math.max(0, r1(gap)), at: [w.x, (b.y0 + b.y1) / 2],
          detail: gap < 0 ? `${w.desc} runs through the label` : `${w.desc} is ${r1(gap)} uu from the label` });
      }
    }
    // ── CELL_GUTTER ──
    for (let a = 0; a < T.texts.length; a++) {
      for (let c = a + 1; c < T.texts.length; c++) {
        const A = T.texts[a], B = T.texts[c];
        const vOver = Math.min(A.box.y1, B.box.y1) - Math.max(A.box.y0, B.box.y0);
        if (vOver < 0.5 * Math.min(A.box.y1 - A.box.y0, B.box.y1 - B.box.y0)) continue;   // not one row
        const [L, R] = A.box.x0 <= B.box.x0 ? [A, B] : [B, A];
        const gap = R.box.x0 - L.box.x1;
        if (gap >= CELL_GUTTER) continue;
        const ruled = T.walls.some(w => w.x > L.box.x1 - 0.5 && w.x < R.box.x0 + 0.5
          && w.y0 <= Math.max(A.box.y0, B.box.y0) && w.y1 >= Math.min(A.box.y1, B.box.y1));
        if (ruled) continue;
        push({ cls: 'CELL_GUTTER', text: L.text, textBox: L.box, other: `"${R.text}"`, otherBox: R.box,
          gap: Math.max(0, r1(gap)), at: [(L.box.x1 + R.box.x0) / 2, (Math.max(A.box.y0, B.box.y0) + Math.min(A.box.y1, B.box.y1)) / 2],
          detail: gap < 0 ? `overlaps "${R.text}" on the same row` : `only ${r1(gap)} uu from "${R.text}" on the same row, with no rule between` });
      }
    }
  }
  return out;
}

export function countCells(findings: readonly CellFinding[]): Record<CellClass, number> {
  const c = Object.fromEntries(CELL_CLASS_ORDER.map(k => [k, 0])) as Record<CellClass, number>;
  for (const f of findings) c[f.cls]++;
  return c;
}

export function describeCell(f: CellFinding): string {
  return `${f.cls}${f.variant ? ` [${f.variant}]` : ''} in "${f.table}": "${f.text}" ${fmt(f.textBox)} × ${f.other} `
    + `@${r1(f.at[0])},${r1(f.at[1])} — ${f.detail}`;
}
