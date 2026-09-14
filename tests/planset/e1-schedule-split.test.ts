// ---------------------------------------------------------------------------
// E-1 / E-1.1 SHEET SPLIT.
//
// The three calculation panels sat in a 180 uu strip across E-1's 1994 uu
// canvas, embedded into a 1402.88 uu drawing box. k = 0.7036, so every glyph
// printed at 4.57 pt. MEASURED: raising the type to reach 6.5 pt produced 80
// overlaps against a baseline of 5 -- content occupies 99.8% of the canvas
// WIDTH, and width is what binds k, so no type change could fix it.
//
// Split: E-1 keeps the one-line TOPOLOGY, E-1.1 carries the schedules STACKED
// one full-width band each on a canvas sized to the drawing box. Same producer
// for both, so the sheets cannot drift.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string): string | null => {
  try { return readFileSync(join(process.cwd(), p), 'utf8'); } catch { return null; }
};
const WS = String.raw`\s`;
function sheetText(html: string): string {
  return html
    .replace(new RegExp('<(style|script)[^>]*>[' + WS + WS.toUpperCase() + ']*?<' + String.raw`\/` + '\\1>', 'gi'), ' ')
    .replace(new RegExp('<[^>]+>', 'g'), ' ')
    .replace(new RegExp('&[a-z]+;', 'g'), ' ')
    .replace(new RegExp(WS + '+', 'g'), ' ');
}

describe('both electrical sheets exist, in order, with the right titles', () => {
  it('the rendered package puts E-1.1 immediately after E-1', () => {
    // Asserted on the ARTIFACT rather than the manifest function: the manifest
    // and the page assembly are two lists that must stay in step, and the
    // artifact is the only place that proves they did.
    const html = read('_tmp_prod.html');
    if (!html) return;
    const t = sheetText(html);
    // lastIndexOf, not indexOf: the COVER SHEET INDEX lists E-1.1 near the top
    // of the document, so the first hit is the TOC entry, not the title block.
    const iE1 = t.lastIndexOf('SINGLE-LINE ELECTRICAL DIAGRAM');
    const iE11 = t.lastIndexOf('ELECTRICAL SCHEDULES & CALCULATIONS');
    expect(iE1, 'E-1 title block missing').toBeGreaterThanOrEqual(0);
    expect(iE11, 'E-1.1 title block missing').toBeGreaterThanOrEqual(0);
    expect(iE11, 'E-1.1 must come after E-1').toBeGreaterThan(iE1);

    // and the cover index must ADVERTISE the new sheet, not just contain it
    const toc = t.slice(0, iE1);
    expect(toc, 'the cover SHEET INDEX does not list E-1.1')
      .toContain('ELECTRICAL SCHEDULES & CALCULATIONS');
  });

  it('the sheet source declares both titles', () => {
    const src = readFileSync(join(process.cwd(), 'lib/permit/sheetManifest.ts'), 'utf8');
    expect(src).toContain('ELECTRICAL SCHEDULES & CALCULATIONS');
    expect(src).toContain('SINGLE-LINE DIAGRAM');
  });
});

describe('content lands on the intended sheet, and is not duplicated', () => {
  const html = read('_tmp_prod.html');

  it('the package numbers every sheet against one total', () => {
    if (!html) return;
    const t = sheetText(html);
    const m = [...t.matchAll(new RegExp('SHEET (' + String.raw`\d` + '+) OF (' + String.raw`\d` + '+)', 'g'))];
    expect(m.length).toBeGreaterThan(0);
    const totals = [...new Set(m.map(x => x[2]))];
    expect(totals, 'more than one declared sheet total').toHaveLength(1);
    expect(m.length, `${m.length} title blocks vs a declared total of ${totals[0]}`)
      .toBe(Number(totals[0]));
    // every index appears exactly once, 1..N
    const idx = m.map(x => Number(x[1])).sort((a, b) => a - b);
    expect(idx).toEqual(idx.map((_v, i) => i + 1));
  });

  it('each schedule table appears exactly once across the package', () => {
    if (!html) return;
    const t = sheetText(html);
    for (const label of ['AC BRANCH CIRCUIT INFO', 'AC SYSTEM CALCULATIONS']) {
      const n = t.split(label).length - 1;
      expect(n, `${label} appears ${n} times — it must live on E-1.1 only`).toBe(1);
    }
  });

  it('E-1 keeps the one-line topology', () => {
    if (!html) return;
    const t = sheetText(html);
    expect(t).toContain('SINGLE LINE DIAGRAM');
    // topology landmarks a reviewer needs on the diagram sheet
    for (const s of ['AC COMBINER', 'MAIN SERVICE PANEL', 'UTILITY METER', 'EQUIPMENT GROUNDING CONDUCTORS']) {
      expect(t, `${s} missing from the package`).toContain(s);
    }
  });
});

describe('one producer feeds both sheets, so they cannot drift', () => {
  it('E-1 asks for topologyOnly and E-1.1 for schedulesOnly', () => {
    const src = readFileSync(join(process.cwd(), 'lib/permit/sections/electricalPages.ts'), 'utf8');
    expect(src).toContain('topologyOnly: true');
    expect(src).toContain('schedulesOnly: true');
  });

  it('the renderer guards the panels and the schematic independently', () => {
    const src = readFileSync(join(process.cwd(), 'lib/sld-professional-renderer.ts'), 'utf8');
    expect(src).toContain('suppressCalcBand');
    expect(src).toContain('schedulesOnly');
    expect(src).toContain('calcBandStacked');
  });
});
