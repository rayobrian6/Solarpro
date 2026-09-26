// ============================================================================
// THE SLD MUST READ CLEANLY — Ray, 2026-09-26, on a live IQ Combiner 5C
// supply-side Diagram SLD: "add CTs to the hybrid SLDs too. Biggest issue I
// have with the sld is the word bleed and overlays. This should be cleaner to
// read!!"
//
// Every defect in his screenshot was a label sharing ink with something else,
// and each is a class the audit counts (tests/support/sldGeometry.ts):
//   green dashed ground drops through the label blocks under the combiner, the
//     disconnect and the MSP, and through 'EQUIPMENT GROUNDING CONDUCTORS' ... TEXT_STROKE
//   'LOAD (FROM COMBINER)' / 'LINE (TO MSP)' on the disconnect's bottom edge ... TEXT_SYMBOL
//   '120/240V, 1Φ, 3W' across the meter's service line; the UTIL GRID symbol
//     and its drop on 'UTILITY GRID / <utility>' ........................ TEXT_STROKE
//   '3 branches (11/11/10) 20A OCPD ea.' and the module/micro note crossed by
//     dashed lines, the J-box terminal dot on them ........................ TEXT_STROKE / TEXT_SYMBOL
//   'AC COMBINER' printed twice ............................................ TEXT_REPEAT
//   'N — UNSWITCHED' on its line, 'CONSUMPTION CTs @ MSP' under a ground
//     symbol — 1.2 uu clear in the real face, touching in his serif one .... TEXT_CLEARANCE
// (The serif face itself is the Diagram tab not loading the 'SolarPro Sans'
// pack: every font-family names only the embedded faces. scripts/
// sld-legibility-audit.ts reports that; it is not a geometry count.)
// The tables under the drawing are also read cell by cell (tests/support/
// sldTableCells.ts): a value against its column rule, and a label and value
// run together on an unruled row, hit nothing and so are no collision above.
//
// THE BASELINE BELOW IS TODAY'S COUNT, NOT A TARGET. Later stages drive it to
// zero. They must LOWER it as they fix — the ratchet test fails until they do —
// and must NEVER raise it: a new label or a new CT lead that lands on something
// is a defect to fix, not a number to re-record. Adding a variant adds its own
// row; it never changes an existing one.
//
// Regenerate the pictures and the offender list with
//   npx tsx scripts/sld-legibility-audit.ts --out <dir outside the repo>
// (report.md ends with these objects, ready to paste).
// ============================================================================

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  parseSld, auditSld, countByClass, describeFinding, textWidth, unknownGlyphs,
  COLLISION_CLASS_ORDER, PER_VARIANT_CLASSES, type CollisionClass, type Finding,
} from './support/sldGeometry';
import {
  buildSldVariantMatrix, renderSldVariant, applyRenderMode, permitCase, type SldVariant,
} from './support/sldVariantMatrix';
import { auditTableCells, findTables, countCells, describeCell, CELL_PAD, CELL_GUTTER, type CellFinding } from './support/sldTableCells';
import { renderSLDProfessional } from '@/lib/sld-professional-renderer';
import { buildSLDInputFromPermit, generateLiveSLD } from '@/lib/permit/utils/sldAdapter';

// ── THE BASELINE — lower it as you fix; never raise it. ─────────────────────
//    Recorded 2026-09-26 at HEAD 75a74099 + the working tree's hybrid CT
//    composer: 48 · 1913 · 1234 · 290 · 84 · 2330 across the matrix.
//    Lowered the same day by the single-lane legibility pass (the renderer
//    stops every ground drop at the nameplate it passes, names the combiner
//    once, pitches every label stack for the 8.67 uu type that prints, fits
//    each conductor callout to its own run, and closes the schedule, seal,
//    utility and battery collisions): every single-lane and permit row is 0 in
//    every class, TEXT_CLEARANCE included. The hybrid rows fell where they
//    share those symbols (34 · 344 · 203 · 106 · 0 · 230 remained).
//    Lowered to zero by the multi-lane pass (each lane and tail run is laid out
//    as long as its callout's widest unbreakable piece and the callout is
//    fitted to it; the J-box, panel, disconnect, POI, meter, grid and battery
//    labels clear their symbols and drops; the band tables size their columns
//    to their cells and stop their rules above the footnotes; the E-1 embed's
//    schematic box, legend and tables end inside its frame). EVERY sheet —
//    single-lane and hybrid — is now held to nothing (the zero gate below).
//    The review of the same day found the audit BLIND inside illustrations and
//    symbols (27 of 104 sheets hid collisions there) and TEXT_REPEAT blind to
//    '(N) AC DISCONNECT' over 'AC DISCONNECT'. The audit now reads art labels at
//    their boundary and compares names by their words; the drawings were fixed
//    to match (the disconnect's strip, the printed illustrations, the symbol's
//    'NEC 690.15'), leaving ONE known finding, KNOWN_BLOCKED below.
const BASELINE_TOTALS: Record<CollisionClass, number> = {
  TEXT_TEXT: 0, TEXT_STROKE: 0, TEXT_SYMBOL: 0, TEXT_OFFSHEET: 0, TEXT_REPEAT: 2, TEXT_CLEARANCE: 0,
};
/**
 * A finding whose fix is blocked OUTSIDE the drawing code, named exactly —
 * the zero gate lets these (and nothing else) through; the ratchet still
 * counts them, so the fix lowers the rows above and deletes the entry here.
 *
 * The generic string-inverter symbol (lib/sld-symbols.ts, the cabinet's label
 * bar) prints 'STRING INVERTER' 31 uu under the node header that says the same
 * thing. Removing it moves tests/goldens/wave0-sld-baseline.golden.test.ts'
 * pinned `stringInverterHdr` count (4 → 3) — a snapshot this stage does not
 * own. The fix: blank the cabinet label in symInverter (cab(…, {label:
 * undefined})) and update that one snapshot count together.
 */
const KNOWN_BLOCKED: Array<{ variant: RegExp; cls: CollisionClass; text: string }> = [
  { variant: /^string-primo-load-(sheet|e1)$/, cls: 'TEXT_REPEAT', text: 'STRING INVERTER' },
];
const knownBlocked = (f: Finding) =>
  KNOWN_BLOCKED.some(k => k.cls === f.cls && k.text === f.text && k.variant.test(f.variant ?? ''));
/** Per variant: [TEXT_TEXT, TEXT_STROKE, TEXT_SYMBOL, TEXT_OFFSHEET, TEXT_REPEAT]
 *  (PER_VARIANT_CLASSES order). TEXT_CLEARANCE is gated on its total only. */
const BASELINE: Record<string, [number, number, number, number, number]> = {
  'micro-5c-load-dflt-3br-sheet': [0, 0, 0, 0, 0],
  'micro-5c-load-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-5c-load-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-5c-load-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-5c-tap-dflt-3br-sheet': [0, 0, 0, 0, 0],        // Ray's reported job (was 0/16/13/4/1)
  'micro-5c-tap-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-5c-tap-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-5c-tap-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-5c-tap-sec-3br-sheet': [0, 0, 0, 0, 0],
  'micro-5c-tap-sec-3br-e1': [0, 0, 0, 0, 0],
  'micro-5c-derate-dflt-3br-sheet': [0, 0, 0, 0, 0],
  'micro-5c-derate-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-5c-derate-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-5c-derate-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-6c-load-dflt-3br-sheet': [0, 0, 0, 0, 0],
  'micro-6c-load-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-6c-load-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-6c-load-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-6c-tap-dflt-3br-sheet': [0, 0, 0, 0, 0],
  'micro-6c-tap-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-6c-tap-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-6c-tap-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-6c-tap-sec-3br-sheet': [0, 0, 0, 0, 0],
  'micro-6c-tap-sec-3br-e1': [0, 0, 0, 0, 0],
  'micro-6c-derate-dflt-3br-sheet': [0, 0, 0, 0, 0],
  'micro-6c-derate-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-6c-derate-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-6c-derate-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-4c-load-dflt-3br-sheet': [0, 0, 0, 0, 0],
  'micro-4c-load-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-4c-load-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-4c-load-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-4c-tap-dflt-3br-sheet': [0, 0, 0, 0, 0],
  'micro-4c-tap-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-4c-tap-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-4c-tap-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-4c-tap-sec-3br-sheet': [0, 0, 0, 0, 0],
  'micro-4c-tap-sec-3br-e1': [0, 0, 0, 0, 0],
  'micro-4c-derate-dflt-3br-sheet': [0, 0, 0, 0, 0],
  'micro-4c-derate-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-4c-derate-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-4c-derate-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-gw-load-dflt-3br-sheet': [0, 0, 0, 0, 0],
  'micro-gw-load-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-gw-load-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-gw-load-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-gw-tap-dflt-3br-sheet': [0, 0, 0, 0, 0],
  'micro-gw-tap-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-gw-tap-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-gw-tap-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-gw-tap-sec-3br-sheet': [0, 0, 0, 0, 0],
  'micro-gw-tap-sec-3br-e1': [0, 0, 0, 0, 0],
  'micro-gw-derate-dflt-3br-sheet': [0, 0, 0, 0, 0],
  'micro-gw-derate-dflt-3br-e1': [0, 0, 0, 0, 0],
  'micro-gw-derate-mbl-3br-sheet': [0, 0, 0, 0, 0],
  'micro-gw-derate-mbl-3br-e1': [0, 0, 0, 0, 0],
  'micro-5c-load-dflt-1br-sheet': [0, 0, 0, 0, 0],
  'micro-5c-load-dflt-1br-e1': [0, 0, 0, 0, 0],
  'micro-5c-tap-dflt-1br-sheet': [0, 0, 0, 0, 0],
  'micro-5c-tap-dflt-1br-e1': [0, 0, 0, 0, 0],
  'micro-gw-load-dflt-1br-sheet': [0, 0, 0, 0, 0],
  'micro-gw-load-dflt-1br-e1': [0, 0, 0, 0, 0],
  'micro-gw-tap-dflt-1br-sheet': [0, 0, 0, 0, 0],
  'micro-gw-tap-dflt-1br-e1': [0, 0, 0, 0, 0],
  'micro-5c-load-dflt-5br-sheet': [0, 0, 0, 0, 0],
  'micro-5c-load-dflt-5br-e1': [0, 0, 0, 0, 0],
  'micro-5c-tap-dflt-5br-sheet': [0, 0, 0, 0, 0],
  'micro-5c-tap-dflt-5br-e1': [0, 0, 0, 0, 0],
  'micro-gw-load-dflt-5br-sheet': [0, 0, 0, 0, 0],
  'micro-gw-load-dflt-5br-e1': [0, 0, 0, 0, 0],
  'micro-gw-tap-dflt-5br-sheet': [0, 0, 0, 0, 0],
  'micro-gw-tap-dflt-5br-e1': [0, 0, 0, 0, 0],
  'micro-5c-load-dflt-3br-bat-sheet': [0, 0, 0, 0, 0],
  'micro-5c-load-dflt-3br-bat-e1': [0, 0, 0, 0, 0],
  'micro-5c-tap-dflt-3br-bat-sheet': [0, 0, 0, 0, 0],
  'micro-5c-tap-dflt-3br-bat-e1': [0, 0, 0, 0, 0],
  'micro-gw-load-dflt-3br-bat-sheet': [0, 0, 0, 0, 0],
  'micro-gw-load-dflt-3br-bat-e1': [0, 0, 0, 0, 0],
  'micro-gw-tap-dflt-3br-bat-sheet': [0, 0, 0, 0, 0],
  'micro-gw-tap-dflt-3br-bat-e1': [0, 0, 0, 0, 0],
  'optimizer-se7600h-load-sheet': [0, 0, 0, 0, 0],
  'optimizer-se7600h-tap-sheet': [0, 0, 0, 0, 0],
  'string-primo-load-sheet': [0, 0, 0, 0, 1],               // KNOWN_BLOCKED — the cabinet's own 'STRING INVERTER'
  'optimizer-se7600h-load-e1': [0, 0, 0, 0, 0],
  'optimizer-se7600h-tap-e1': [0, 0, 0, 0, 0],
  'string-primo-load-e1': [0, 0, 0, 0, 1],                  // KNOWN_BLOCKED — the cabinet's own 'STRING INVERTER'
  'hybrid-2lane-paired-load-sheet': [0, 0, 0, 0, 0],       // was 3/28/16/0/0 (+19 near misses)
  'hybrid-2lane-paired-load-e1': [0, 0, 0, 0, 0],          // was 3/28/16/17/0 — the tables ran past E-1's frame
  'hybrid-2lane-paired-tap-sheet': [0, 0, 0, 0, 0],
  'hybrid-2lane-paired-tap-e1': [0, 0, 0, 0, 0],
  'hybrid-2lane-gw-load-sheet': [0, 0, 0, 0, 0],
  'hybrid-2lane-gw-load-e1': [0, 0, 0, 0, 0],
  'hybrid-2lane-gw-tap-sheet': [0, 0, 0, 0, 0],
  'hybrid-2lane-gw-tap-e1': [0, 0, 0, 0, 0],
  'hybrid-2lane-paired-load-bat-sheet': [0, 0, 0, 0, 0],   // was 4/34/18/0/0 (+25 near misses)
  'hybrid-2lane-paired-load-bat-e1': [0, 0, 0, 0, 0],
  'hybrid-3lane-paired-load-sheet': [0, 0, 0, 0, 0],
  'hybrid-3lane-paired-load-e1': [0, 0, 0, 0, 0],
  'permit-roof-5c-tap-e1': [0, 0, 0, 0, 0],
  'permit-roof-5c-tap-e11': [0, 0, 0, 0, 0],
  'permit-roof-gw-load-e1': [0, 0, 0, 0, 0],
  'permit-roof-6c-derate-e1': [0, 0, 0, 0, 0],
  'permit-ground-e1': [0, 0, 0, 0, 0],
  'permit-fence-e1': [0, 0, 0, 0, 0],
};

/** The inset a table cell keeps off its rules and sides on the printed sheet
 *  (the cell audit's CELL_PAD, 2 uu, is where a value starts to read as
 *  spilling; 3.5 is where it stops reading as glued to the rule). */
const CELL_WALL_PRINT = 3.5;

// The renderer and the composers narrate every call; keep the output readable.
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { logSpy.mockRestore(); warnSpy.mockRestore(); });

const svgDoc = (inner: string, w = 400, h = 200) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
const T = (x: number, y: number, s: string, extra = '') =>
  `<text x="${x}" y="${y}" font-family="SolarPro Sans, SolarPro Symbols" font-size="10" text-anchor="middle" ${extra}>${s}</text>`;
const classes = (svg: string) => countByClass(auditSld(svg));

// ── The instrument can see what it claims to see ────────────────────────────
// A guard that cannot fail proves nothing: each class, fed a collision and its
// near-identical clean twin.
describe('the collision audit can see each class', () => {
  it('measures text in the printed face (Liberation Sans, from the shipped WOFF2)', () => {
    // tests/sldStandaloneGatewayAndCtLeads.test.ts pins this label at 145.5 uu
    // in Liberation Sans; a flat 0.6 em would say 140.4.
    expect(textWidth('EXISTING SERVICE CONDUCTORS', 8.67)).toBeCloseTo(145.48, 1);
    const [t] = parseSld(svgDoc('<text x="0" y="100" font-size="10">HELL</text>')).texts;
    // Caps ink: 1409/2048 em above the baseline, nothing below it.
    expect(t.box.y0).toBeCloseTo(100 - 6.88, 2);
    expect(t.box.y1).toBeCloseTo(100, 5);
    const [d] = parseSld(svgDoc('<text x="0" y="100" font-size="10">Typing</text>')).texts;
    expect(d.box.y1).toBeCloseTo(100 + 2.075, 2);          // 'y'/'p'/'g' descend 425/2048 em
  });

  it('resolves group transforms into absolute coordinates and sizes', () => {
    const g = parseSld(svgDoc('<g transform="translate(10,20) scale(2)"><text x="0" y="50" font-size="10" text-anchor="middle">HELL</text></g>'));
    const [t] = g.texts;
    expect(t.fontSize).toBe(20);
    expect(t.y).toBe(120);
    expect(t.box.x1 - t.box.x0).toBeCloseTo(2 * textWidth('HELL', 10), 5);
    expect((t.box.x0 + t.box.x1) / 2).toBeCloseTo(10, 5);
  });

  it('TEXT_TEXT: two labels on each other — and not two labels side by side', () => {
    expect(classes(svgDoc(T(100, 100, 'LABEL ONE') + T(110, 103, 'LABEL TWO'))).TEXT_TEXT).toBe(1);
    expect(classes(svgDoc(T(100, 100, 'LABEL ONE') + T(100, 130, 'LABEL TWO'))).TEXT_TEXT).toBe(0);
  });

  it('TEXT_STROKE: a line through a label; a leader that stops at it and a knocked-out line do not count', () => {
    const through = '<line x1="100" y1="80" x2="100" y2="120" stroke="#2E7D32" stroke-width="1" stroke-dasharray="4,3"/>';
    const leader = '<line x1="100" y1="60" x2="100" y2="92.9" stroke="#000" stroke-width="1"/>';
    const knockout = '<rect x="60" y="88" width="80" height="16" fill="#fff" stroke="none"/>';
    expect(classes(svgDoc(through + T(100, 100, 'EQUIPMENT GROUNDING'))).TEXT_STROKE).toBe(1);
    expect(classes(svgDoc(leader + T(100, 100, 'EQUIPMENT GROUNDING'))).TEXT_STROKE).toBe(0);
    expect(classes(svgDoc(through + knockout + T(100, 100, 'EQUIPMENT GROUNDING'))).TEXT_STROKE).toBe(0);
  });

  it('TEXT_SYMBOL: a box edge or a circle through a label, a shape painted over it — not a label inside its box', () => {
    const box = '<rect x="40" y="60" width="120" height="36" fill="#fff" stroke="#000" stroke-width="1.8"/>';
    expect(classes(svgDoc(box + T(100, 99, 'LOAD'))).TEXT_SYMBOL).toBe(1);       // on the bottom edge
    expect(classes(svgDoc(box + T(100, 82, 'LOAD'))).TEXT_SYMBOL).toBe(0);       // inside, clear
    const meter = '<circle cx="100" cy="60" r="36" fill="#fff" stroke="#000" stroke-width="1.8"/>';
    expect(classes(svgDoc(meter + T(100, 99, '120/240V, 1Ø, 3W'))).TEXT_SYMBOL).toBe(1);
    expect(classes(svgDoc(T(100, 82, 'HIDDEN') + '<rect x="60" y="70" width="80" height="20" fill="#fff" stroke="none"/>')).TEXT_SYMBOL).toBe(1);
  });

  it('TEXT_OFFSHEET: past the viewBox, across the border, into the title block', () => {
    expect(classes(svgDoc(T(395, 100, 'CLIPPED LABEL'))).TEXT_OFFSHEET).toBe(1);
    const sheet = '<rect x="0" y="0" width="400" height="200" fill="#fff" stroke="#fff" stroke-width="0"/>'
      + '<rect x="5" y="5" width="390" height="190" fill="#fff" stroke="#000" stroke-width="2"/>'
      + '<rect x="330" y="10" width="60" height="180" fill="#fff" stroke="#000" stroke-width="2"/>';
    expect(classes(svgDoc(sheet + T(320, 100, 'INTO THE BLOCK'))).TEXT_OFFSHEET).toBe(1);
    expect(classes(svgDoc(sheet + T(200, 100, 'IN THE DRAWING'))).TEXT_OFFSHEET).toBe(0);
  });

  it('TEXT_REPEAT: the same label twice in the schematic', () => {
    const filler = Array.from({ length: 12 }, (_, i) => T(30 + 30 * (i % 6), 150 + 20 * Math.floor(i / 6), `F${i}`)).join('');
    const sch = (inner: string) => svgDoc(`<g transform="translate(0,0) scale(1.1)">${filler}${inner}</g>`);
    expect(classes(sch(T(100, 40, 'AC COMBINER') + T(100, 58, 'AC COMBINER'))).TEXT_REPEAT).toBe(1);
    expect(classes(sch(T(100, 40, 'AC COMBINER') + T(100, 58, 'AC DISCONNECT'))).TEXT_REPEAT).toBe(0);
  });

  it('TEXT_REPEAT: one name inside another — "(N) AC DISCONNECT" over the strip\'s "AC DISCONNECT"', () => {
    const filler = Array.from({ length: 12 }, (_, i) => T(30 + 30 * (i % 6), 150 + 20 * Math.floor(i / 6), `F${i}`)).join('');
    const sch = (inner: string) => svgDoc(`<g transform="translate(0,0) scale(1.1)">${filler}${inner}</g>`);
    // Every single-lane sheet and E-1: 23 uu apart.
    expect(classes(sch(T(100, 40, '(N) AC DISCONNECT') + T(100, 61, 'AC DISCONNECT'))).TEXT_REPEAT).toBe(1);
    // The hybrid's system disconnect: " — SYSTEM" is not a different name.
    expect(classes(sch(T(100, 40, '(N) AC DISCONNECT — SYSTEM') + T(100, 61, 'AC DISCONNECT'))).TEXT_REPEAT).toBe(1);
    // A header and the nameplate of the same box, the model in both.
    expect(classes(sch(T(100, 40, 'ENPHASE IQ COMBINER 5C') + T(100, 70, 'Enphase IQ Combiner 5C'))).TEXT_REPEAT).toBe(1);
    // Far apart, or a one-word overlap, is not a repeat.
    expect(classes(sch(T(100, 20, '(N) AC DISCONNECT') + T(100, 130, 'AC DISCONNECT'))).TEXT_REPEAT).toBe(0);
    expect(classes(sch(T(100, 40, 'AC COMBINER') + T(100, 61, 'COMBINER OUTPUT'))).TEXT_REPEAT).toBe(0);
  });

  it('TEXT_REPEAT reads a symbol\'s own label: the cabinet that says what its header says', () => {
    const filler = Array.from({ length: 12 }, (_, i) => T(30 + 30 * (i % 6), 150 + 20 * Math.floor(i / 6), `F${i}`)).join('');
    const cab = '<g transform="translate(40,50) scale(1)"><rect x="0" y="0" width="120" height="60" fill="#eee" stroke="#000"/>'
      + '<text x="60" y="12" font-size="9" text-anchor="middle">STRING INVERTER</text></g>';
    const sch = (inner: string) => svgDoc(`<g transform="translate(0,0) scale(1.1)">${filler}${inner}</g>`);
    expect(classes(sch(T(100, 40, 'STRING INVERTER') + cab)).TEXT_REPEAT).toBe(1);
    expect(classes(sch(T(100, 40, 'STRING + OPTIMIZER') + cab)).TEXT_REPEAT).toBe(0);
  });

  // The review of 2026-09-26 found three collisions on the PNGs that every
  // count read as 0, because art labels were never looked at. Each is here,
  // with the clean twin that must stay 0.
  describe('an illustration\'s or symbol\'s own labels are audited at its boundary', () => {
    const DC = (lbl: string) => '<g transform="translate(100,40) scale(1)">'
      + '<rect x="20" y="18" width="80" height="48" fill="#FFF8E1" stroke="#C62828" stroke-width="2"/>'
      + lbl + '<line x1="60" y1="66" x2="60" y2="100" stroke="#2E7D32" stroke-width="1.5" stroke-dasharray="4,3"/></g>';
    const nec = (x: number, anc: string, size = '8.67') =>
      `<text x="${x}" y="79" font-family="SolarPro Mono, SolarPro Symbols" font-size="${size}" text-anchor="${anc}">NEC 690.15</text>`;

    it('its own ground stub through a floored label ("NEC 6|90.15") — and not once the label moves off the stub', () => {
      expect(classes(svgDoc(DC(nec(60, 'middle')))).TEXT_STROKE).toBe(1);
      expect(classes(svgDoc(DC(nec(54, 'end')))).TEXT_STROKE).toBe(0);
    });

    it('type the art authored ABOVE the floor is the art\'s own business', () => {
      expect(classes(svgDoc(DC(nec(60, 'middle', '11')))).TEXT_STROKE).toBe(0);
    });

    it('a layout line painted over the art, 0.5 uu off its label\'s caps, is a near miss ("IQ SYSTEM")', () => {
      const art = '<g data-device="enphase-iq-sc3"><rect x="60" y="40" width="100" height="80" fill="#F5F5F3" stroke="#B0B4B8"/>'
        + '<text x="110" y="86.3" font-size="8.67" font-weight="700" text-anchor="middle">IQ SYSTEM</text></g>';
      const over = (y: number) => `<line x1="40" y1="${y}" x2="180" y2="${y}" stroke="#0D47A1" stroke-width="1.5"/>`;
      // caps top = 86.3 − 5.97 = 80.3; the line's lower edge at y + 0.75.
      expect(classes(svgDoc(art + over(79))).TEXT_CLEARANCE).toBe(1);
      expect(classes(svgDoc(art + over(70))).TEXT_CLEARANCE).toBe(0);
      // Painted BEFORE the art, the same line is under it — not over the label.
      expect(classes(svgDoc(over(79) + art)).TEXT_CLEARANCE).toBe(0);
    });

    it('two floored labels of one art on each other, and a floored label on its own coloured panel ("UL 17[ON]B")', () => {
      const hub = (on: string) => '<g data-device="solaredge-home-hub"><rect x="40" y="20" width="100" height="140" fill="#ECEDEF" stroke="#B0B4B8"/>'
        + on + '<text x="48" y="150" font-size="8.67" text-anchor="start">HD-Wave · UL 1741-SB</text></g>';
      const handle = '<rect x="118" y="140" width="16" height="12" fill="#E30613" stroke="#A8040E"/><text x="126" y="149" font-size="8.67" text-anchor="middle">ON</text>';
      const f = countByClass(auditSld(svgDoc(hub(handle))));
      expect(f.TEXT_TEXT).toBe(1);
      expect(f.TEXT_SYMBOL).toBeGreaterThanOrEqual(1);
      expect(countByClass(auditSld(svgDoc(hub('')))).TEXT_TEXT).toBe(0);
    });

    it('another art painted over a symbol\'s label (a brand badge over the cabinet\'s words)', () => {
      const cab = '<g transform="translate(40,50) scale(1)"><rect x="0" y="0" width="160" height="60" fill="#eee" stroke="#000"/>'
        + '<text x="60" y="12" font-size="9" text-anchor="middle">STRING INVERTER</text></g>';
      const badge = (x: number) => `<g transform="translate(${x},52) scale(1)"><rect x="0" y="0" width="54" height="14" fill="#C8102E"/>`
        + '<text x="27" y="10" font-size="9" fill="#fff" text-anchor="middle">Fronius</text></g>';
      expect(classes(svgDoc(cab + badge(125))).TEXT_SYMBOL).toBe(1);
      expect(classes(svgDoc(cab + badge(150))).TEXT_SYMBOL).toBe(0);
    });
  });

  it('TEXT_CLEARANCE: a line 1 uu off the caps is a near miss; 3 uu is clear; a hit is never also a near miss', () => {
    const at = (y: number) => `<line x1="40" y1="${y}" x2="160" y2="${y}" stroke="#000" stroke-width="1.2"/>`;
    // 'UNSWITCHED' caps top = 100 − 6.88; the stroke's lower edge = y + 0.6.
    expect(classes(svgDoc(at(100 - 6.88 - 1.6) + T(100, 100, 'UNSWITCHED'))).TEXT_CLEARANCE).toBe(1);
    expect(classes(svgDoc(at(100 - 6.88 - 3.6) + T(100, 100, 'UNSWITCHED'))).TEXT_CLEARANCE).toBe(0);
    const hit = classes(svgDoc(at(96) + T(100, 100, 'UNSWITCHED')));
    expect([hit.TEXT_STROKE, hit.TEXT_CLEARANCE]).toEqual([1, 0]);
  });

  it('an illustration is one opaque box: a label on its edge counts, its own art does not', () => {
    const art = '<g data-device="enphase-iq-gateway"><rect x="60" y="40" width="80" height="40" fill="#222" stroke="#000"/>'
      + '<text x="100" y="62" font-size="8.67" fill="#fff" text-anchor="middle">ENVOY</text><line x1="60" y1="50" x2="140" y2="70" stroke="#fff"/></g>';
    expect(classes(svgDoc(art))).toEqual(countByClass([]));
    expect(classes(svgDoc(art + T(100, 84, 'MONITORING GATEWAY'))).TEXT_SYMBOL).toBe(1);
  });
});

// ── The tables under the drawing, cell by cell (tests/support/sldTableCells.ts)
// Two defects in a table hit nothing, so the collision audit cannot see them: a
// label and its value on one unruled row standing so close they read as one
// phrase, and a value jammed against its column rule. Each fed its clean twin.
describe('the table-cell audit can see each class', () => {
  // A 300 × 60 table: black title bar, a key/value row, then a ruled row.
  const L = (x: number, y: number, s: string, anc = 'start', extra = '') =>
    `<text x="${x}" y="${y}" font-family="SolarPro Sans, SolarPro Symbols" font-size="8.67" text-anchor="${anc}" ${extra}>${s}</text>`;
  const table = (inner: string) => svgDoc(
    '<rect x="50" y="50" width="300" height="60" fill="#fff" stroke="#000" stroke-width="1"/>'
    + '<rect x="50" y="50" width="300" height="14" fill="#000" stroke="#000" stroke-width="0"/>'
    + L(200, 60, 'EQUIPMENT SCHEDULE', 'middle', 'fill="#FFFFFF" font-weight="bold"') + inner, 400, 200);
  const cells = (svg: string) => countCells(auditTableCells(svg));

  it('finds the table, its title and its column rule', () => {
    const [t] = findTables(table(L(54, 80, 'Utility') + L(346, 80, 'Ameren', 'end')
      + '<line x1="200" y1="86" x2="200" y2="110" stroke="#999" stroke-width="0.5"/>' + L(54, 100, 'A') + L(204, 100, 'B')));
    expect(t.title).toBe('EQUIPMENT SCHEDULE');
    expect(t.walls.map(w => Math.round(w.x))).toEqual([50, 350, 200]);
  });

  it(`CELL_GUTTER: a label and its value closer than ${CELL_GUTTER} uu on one unruled row — and not when apart`, () => {
    // Its value 3 uu after 'Consumption CTs' ends, at the printed size.
    const w = 54 + textWidth('Consumption CTs', 8.67);
    expect(cells(table(L(54, 80, 'Consumption CTs') + L(w + 3, 80, '2 × CLAMP')))).toMatchObject({ CELL_GUTTER: 1, CELL_WALL: 0 });
    expect(cells(table(L(54, 80, 'Consumption CTs') + L(346, 80, '2 × CLAMP', 'end')))).toMatchObject({ CELL_GUTTER: 0, CELL_WALL: 0 });
    // A column rule between them is the separation: not a gutter.
    expect(cells(table(L(54, 80, 'Consumption CTs') + `<line x1="${w + 1.5}" y1="66" x2="${w + 1.5}" y2="110" stroke="#999" stroke-width="0.5"/>`
      + L(w + 3, 80, '2 × CLAMP'))).CELL_GUTTER).toBe(0);
  });

  it(`CELL_WALL: a value within ${CELL_PAD} uu of (or across) its column rule or the table's side — and not with its inset`, () => {
    const rule = '<line x1="200" y1="66" x2="200" y2="110" stroke="#999" stroke-width="0.5"/>';
    expect(cells(table(rule + L(199, 80, 'SPEC', 'end'))).CELL_WALL).toBe(1);       // 0.75 uu off the rule
    expect(cells(table(rule + L(196, 80, 'SPEC', 'end'))).CELL_WALL).toBe(0);       // the 4 uu inset
    expect(cells(table(rule + L(190, 80, 'LONG VALUE')))).toMatchObject({ CELL_WALL: 1 }); // across it
    expect(cells(table(L(349, 80, 'SPEC', 'end'))).CELL_WALL).toBe(1);              // on the table's side
  });
});

// ── Conductors land on what they connect ────────────────────────────────────
// Review of 2026-09-26: an illustration keeps its own aspect inside its slot,
// and the conductors were tied to the SLOT — the battery's lead started 30 uu
// under the art, the Home Hub's stubs floated 50 uu off it; the MSP's feeder,
// tap and service conductors met at nothing. Clean text is not a clean sheet.
describe('conductors land on the equipment they connect', () => {
  const byId = (id: string) => buildSldVariantMatrix().find(v => v.id === id)!;
  const endpoints = (g: ReturnType<typeof parseSld>) => g.strokes.flatMap(s =>
    s.segs.flatMap(([x1, y1, x2, y2]) => [{ x: x1, y: y1, s }, { x: x2, y: y2, s }]));
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

  it('the battery conductor leaves the battery ILLUSTRATION\'s foot, and no orphan stub sits beside it', () => {
    const g = parseSld(renderSldVariant(byId('micro-5c-load-dflt-3br-bat-sheet')));
    const art = g.arts.find(a => a.name === 'data-device=enphase-iq-battery-5p')!;
    expect(art).toBeTruthy();
    const lead = g.strokes.find(s => s.dash && s.stroke.toUpperCase() === '#1565C0'
      && s.segs.some(([x1, , x2]) => near(x1, x2, 0.1)));
    expect(lead, 'the dashed battery conductor').toBeTruthy();
    expect(Math.min(lead!.box.y0, lead!.box.y1)).toBeCloseTo(art.box.y1, 0);
    // Nothing of the battery's colour floats to the art's right.
    const orphan = g.strokes.filter(s => s.art === null && s.stroke.toUpperCase() === '#1565C0'
      && s.box.x0 > art.box.x1 && s.box.x0 < art.box.x1 + 40 && s.box.y1 < art.box.y1 && s.box.y0 > art.box.y0);
    expect(orphan.map(s => s.desc)).toEqual([]);
  });

  it('an inverter illustration\'s DC and AC conductors end ON the art, not 50 uu beside it', () => {
    for (const id of ['optimizer-se7600h-load-sheet', 'optimizer-se7600h-load-e1']) {
      const g = parseSld(renderSldVariant(byId(id)));
      const art = g.arts.find(a => a.name === 'data-device=solaredge-home-hub')!;
      const ends = endpoints(g).filter(e => e.s.art === null && e.y > art.box.y0 && e.y < art.box.y1);
      expect(ends.some(e => near(e.x, art.box.x0, 1)), `${id}: a conductor reaches the art's left edge`).toBe(true);
      expect(ends.some(e => near(e.x, art.box.x1, 1)), `${id}: a conductor leaves the art's right edge`).toBe(true);
    }
  });

  it('the MSP\'s feeder, its tap / lug conductor and its service conductors meet on the chain\'s line', () => {
    for (const id of ['micro-5c-tap-dflt-3br-sheet', 'micro-5c-load-dflt-3br-sheet', 'permit-roof-6c-derate-e1']) {
      const g = parseSld(renderSldVariant(byId(id)));
      const hdr = g.texts.find(t => t.text === 'MAIN SERVICE PANEL' && t.schematic)!;
      const box = g.shapes.filter(s => s.tag === 'rect' && s.stroke && s.box.x0 < hdr.box.x0 && s.box.x1 > hdr.box.x1
        && s.box.y0 < hdr.box.y0 && s.box.y1 > hdr.box.y1)
        .sort((a, b) => (a.box.x1 - a.box.x0) - (b.box.x1 - b.box.x0))[0].box;
      const cy = (box.y0 + box.y1) / 2;
      const k = (box.x1 - box.x0) / 160;                  // the schematic's fit scale
      const ends = endpoints(g).filter(e => e.s.art === null);
      // Left wall: the feeder, the panel's input stub AND the conductor inside
      // the panel all meet there (a tap's conductor and a backfed panel's
      // started elsewhere, or nowhere: 2 met, the inside one did not).
      const atWall = ends.filter(e => near(e.x, box.x0, 0.6) && near(e.y, cy, 0.6));
      expect(atWall.length, `${id}: conductors meeting at the left wall on the chain's line`).toBeGreaterThanOrEqual(3);
      // Right: the bus's jog comes down to the chain's line, where the service run starts.
      const outX = box.x1 + 10 * k;
      const atOut = ends.filter(e => near(e.x, outX, 0.8) && near(e.y, cy, 4 * k));
      expect(atOut.length, `${id}: the bus jog and the service run meet outside the right wall`).toBeGreaterThanOrEqual(2);
    }
  });
});

// ── The permit embed is mirrored, not guessed ───────────────────────────────
describe('the matrix renders the permit E-1 / E-1.1 exactly as generateLiveSLD does', () => {
  for (const [which, mode, opts] of [
    ['roof', 'e1', { embedded: true, topologyOnly: true }],
    ['roof', 'e11', { embedded: true, schedulesOnly: true }],
    ['fence', 'e1', { embedded: true, topologyOnly: true }],
  ] as const) {
    it(`${which} · ${mode}`, () => {
      const c = permitCase(which);
      const mirrored = renderSLDProfessional(applyRenderMode(buildSLDInputFromPermit(c.input as never, c.cad), mode));
      const real = generateLiveSLD(permitCase(which).input as never, permitCase(which).cad, opts);
      expect(mirrored).toBe(real);
    });
  }
});

// ── The gate ────────────────────────────────────────────────────────────────
describe('every SLD Ray can see — no collision count may rise', () => {
  const matrix: SldVariant[] = buildSldVariantMatrix();
  const results = new Map<string, Finding[]>();
  const cellResults = new Map<string, CellFinding[]>();
  const droppedRows = new Map<string, string[]>();
  const svgs = new Map<string, string>();
  beforeAll(() => {
    for (const v of matrix) {
      const before = warnSpy.mock.calls.length;
      const svg = renderSldVariant(v);
      svgs.set(v.id, svg);
      results.set(v.id, auditSld(svg, { variant: v.id }));
      cellResults.set(v.id, auditTableCells(svg, { variant: v.id }));
      droppedRows.set(v.id, warnSpy.mock.calls.slice(before).map(c => c.map(String).join(' '))
        .filter(s => s.includes('TABLE ROWS DROPPED')));
    }
  }, 60_000);

  it('the matrix and the baseline name the same variants (none dropped, none unrecorded)', () => {
    const ids = matrix.map(v => v.id);
    expect(new Set(ids).size, 'duplicate variant ids').toBe(ids.length);
    expect(ids.filter(id => !(id in BASELINE)), 'variants with no baseline row — add their CURRENT counts').toEqual([]);
    expect(Object.keys(BASELINE).filter(id => !ids.includes(id)), 'baseline rows with no variant — coverage was dropped').toEqual([]);
  });

  it('no variant gained a collision in any defect class', () => {
    const worse: string[] = [];
    for (const v of matrix) {
      const counts = countByClass(results.get(v.id)!);
      PER_VARIANT_CLASSES.forEach((k, i) => {
        const was = BASELINE[v.id]?.[i] ?? 0;
        if (counts[k] > was) {
          worse.push(`${v.id} ${k}: ${was} → ${counts[k]}`);
          for (const f of results.get(v.id)!.filter(f => f.cls === k).slice(0, 25)) worse.push(`    ${describeFinding(f)}`);
        }
      });
    }
    expect(worse, 'a label now shares ink with something — fix the drawing, do not raise the baseline').toEqual([]);
  });

  // The single-lane sheets (Diagram tab, SLD PDF, permit E-1 / E-1.1) reached
  // zero, then the hybrid ones did. From here EVERY sheet is held to NOTHING —
  // not a ratchet row, and not a near miss either: TEXT_CLEARANCE is otherwise
  // gated on the matrix total only, where a new near miss on Ray's job could
  // hide behind a fixed one somewhere else.
  it('every sheet — single-lane and hybrid — prints with no collision and no near miss', () => {
    const dirty: string[] = [];
    for (const v of matrix) {
      for (const f of results.get(v.id)!) if (!knownBlocked(f)) dirty.push(describeFinding(f));
    }
    expect(dirty.slice(0, 40), `${dirty.length} finding(s) — fix the drawing`).toEqual([]);
  });

  it('KNOWN_BLOCKED names findings that still exist (delete an entry once it is fixed)', () => {
    for (const k of KNOWN_BLOCKED) {
      const seen = matrix.some(v => k.variant.test(v.id)
        && results.get(v.id)!.some(f => f.cls === k.cls && f.text === k.text));
      expect(seen, `${k.cls} "${k.text}" no longer occurs — remove it from KNOWN_BLOCKED`).toBe(true);
    }
  });

  // A cell 2 uu off its rule is no collision, and still prints glued to it
  // ('|13.29A' in the conduit schedule, whose cells sat 2.75 uu in). Every
  // table's cells now stand at least 3.5 uu off every rule and side.
  it('every table cell stands at least 3.5 uu off its column rules and sides', () => {
    const tight: string[] = [];
    for (const v of matrix) {
      for (const t of findTables(svgs.get(v.id)!)) {
        for (const x of t.texts) for (const w of t.walls) {
          if (w.y1 < x.box.y0 + 0.5 || w.y0 > x.box.y1 - 0.5) continue;
          const gap = (w.x < x.box.x0 ? x.box.x0 - w.x : w.x > x.box.x1 ? w.x - x.box.x1 : -1) - w.sw / 2;
          if (gap < CELL_WALL_PRINT) tight.push(`${v.id} · ${t.title}: "${x.text}" ${gap.toFixed(2)} uu from ${w.desc}`);
        }
      }
    }
    expect(tight.slice(0, 30), `${tight.length} cell(s) printed against a rule`).toEqual([]);
  });

  // The tables under the drawing (AC BRANCH CIRCUIT INFO, AC SYSTEM
  // CALCULATIONS, EQUIPMENT SCHEDULE, the conduit schedule, the hybrid band) —
  // every cell holds its text, and every row a table was given is printed.
  it('every table cell holds its text: no value against its rule, no two values run together', () => {
    const dirty: string[] = [];
    for (const v of matrix) for (const f of cellResults.get(v.id)!) dirty.push(describeCell(f));
    expect(dirty.slice(0, 40), `${dirty.length} table cell finding(s) — fix the table`).toEqual([]);
  });

  it('the cell audit reads the tables of every sheet it is given', () => {
    // Guards the guard: a sheet whose tables it stopped finding would pass
    // the gate above with nothing checked.
    const v = matrix.find(m => m.id === 'micro-5c-tap-dflt-3br-sheet')!;
    expect(findTables(renderSldVariant(v)).map(t => t.title)).toEqual(expect.arrayContaining([
      'AC BRANCH CIRCUIT INFO', 'AC SYSTEM CALCULATIONS', 'EQUIPMENT SCHEDULE']));
    const h = matrix.find(m => m.id === 'hybrid-3lane-paired-load-e1')!;
    expect(findTables(renderSldVariant(h)).map(t => t.title)).toEqual(expect.arrayContaining([
      'CONDUIT AND CONDUCTOR SCHEDULE', 'MAX VOLTAGE DROP CALCULATION', 'EQUIPMENT SCHEDULE',
      'POINT OF INTERCONNECTION — NEC 705.12(B)', 'SYSTEM SUMMARY ( PER CIRCUIT )']));
  });

  it('no table drops a row it was given', () => {
    const dropped = matrix.flatMap(v => droppedRows.get(v.id)!.map(s => `${v.id}: ${s}`));
    expect(dropped).toEqual([]);
  });

  // The permit's E-1.1 for a hybrid (generateLiveSLD(…, { schedulesOnly })) was
  // the WHOLE multi-lane sheet squeezed into the 1420 uu schedules canvas — a
  // second, smaller E-1 whose table cells overran each other. It is the band's
  // seven tables alone now, stacked in two columns. (The matrix carries no
  // hybrid E-1.1 row, so each hybrid is rendered here in that mode.)
  it('the hybrid E-1.1 is the tables alone, and every one of them reads clean', () => {
    const TITLES = ['CONDUIT AND CONDUCTOR SCHEDULE', 'SYSTEM SUMMARY ( PER CIRCUIT )', 'DESIGN TEMPERATURES',
      'MAX SYSTEM VOLTAGE — NEC 690.7(A)', 'MAX VOLTAGE DROP CALCULATION', 'POINT OF INTERCONNECTION — NEC 705.12(B)',
      'EQUIPMENT SCHEDULE'];
    const dirty: string[] = [];
    const hybrids = matrix.filter(m => m.family === 'hybrid' && m.mode === 'e1');
    expect(hybrids.length).toBeGreaterThan(0);
    for (const v of hybrids) {
      const id = v.id.replace(/-e1$/, '-e11');
      const before = warnSpy.mock.calls.length;
      const svg = renderSLDProfessional(applyRenderMode(v.build(), 'e11'));
      expect(svg, id).toContain('viewBox="0 0 1420 1000"');
      expect(svg, `${id}: the one-line belongs on E-1`).not.toContain('PV ARRAY PV-');
      expect(findTables(svg).map(t => t.title).sort(), id).toEqual([...TITLES].sort());
      for (const f of auditSld(svg, { variant: id })) dirty.push(describeFinding(f));
      for (const f of auditTableCells(svg, { variant: id })) dirty.push(describeCell(f));
      for (const c of warnSpy.mock.calls.slice(before)) {
        const s = c.map(String).join(' ');
        if (s.includes('TABLE ROWS DROPPED')) dirty.push(`${id}: ${s}`);
      }
    }
    expect(dirty.slice(0, 40), `${dirty.length} finding(s) on hybrid E-1.1`).toEqual([]);
  });

  it('no class grew across the matrix (TEXT_CLEARANCE is gated here only)', () => {
    const totals = countByClass([...results.values()].flat());
    for (const k of COLLISION_CLASS_ORDER) expect(totals[k], k).toBeLessThanOrEqual(BASELINE_TOTALS[k]);
  });

  it('the baseline is tight — when a count falls, LOWER it here (the ratchet)', () => {
    const totals = countByClass([...results.values()].flat());
    const rowSums = Object.fromEntries(PER_VARIANT_CLASSES.map((k, i) =>
      [k, Object.values(BASELINE).reduce((s, r) => s + r[i], 0)])) as Record<CollisionClass, number>;
    const stale: string[] = [];
    for (const k of COLLISION_CLASS_ORDER) {
      if (totals[k] < BASELINE_TOTALS[k]) stale.push(`BASELINE_TOTALS.${k}: ${BASELINE_TOTALS[k]} → ${totals[k]}`);
    }
    // Rows ≥ actual (the gate above) and Σ rows = total = actual ⇒ every row is exact.
    for (const k of PER_VARIANT_CLASSES) {
      if (rowSums[k] !== BASELINE_TOTALS[k]) stale.push(`the ${k} rows sum to ${rowSums[k]}, BASELINE_TOTALS.${k} says ${BASELINE_TOTALS[k]}`);
    }
    if (stale.length) {
      for (const v of matrix) {
        const c = countByClass(results.get(v.id)!);
        const row = PER_VARIANT_CLASSES.map(k => c[k]);
        if (row.some((n, i) => n !== BASELINE[v.id]?.[i])) stale.push(`  '${v.id}': [${row.join(', ')}],`);
      }
    }
    expect(stale, 'a collision was fixed — record the lower count (never a higher one)').toEqual([]);
  });

  it('every printed glyph is in the metric tables (no conservative fallback was needed)', () => {
    expect(unknownGlyphs()).toEqual([]);
  });
});
