// ═══════════════════════════════════════════════════════════════════════════
// A PRICED BOM NAMED A BREAKER SQUARE D DOES NOT MAKE
//
// `lib/electrical/stdSizes.ts` states the rule in its own header:
//
//     DO NOT use Math.ceil(x/5)*5 — 55, 65, 75, 85, 95 A are NOT standard.
//
// That exact formula survived in eight places. On `/api/engineering/preliminary` it
// was not a fallback: it was the ONLY OCPD computation on the route, and
// `backfeedAmps` was set from it directly. It then reached `renderSLDProfessional`
// as the "AC OCPD (125%)" row and `generateBOMV4`, which used it for the EGC size,
// the GEC size, and a priced BOM line — so a 10 kW preliminary shipped a drawing and
// a quote naming a "55A 2-Pole Breaker", part number QO55-SPARE.
//
// 🚨 THE CONDUCTOR CONSEQUENCE IS THE SHARP ONE. At 25 kW the conductor and EGC were
// sized for 130 A — `autoSizeGauge` picks #1 AWG — while the installer buys the real
// next size, 150 A, which requires #1/0. The installed conductor ends up
// under-protected by a breaker the drawing never named.
//
// These cases assert the PROPERTY — every rating this product emits is a real NEC
// 240.6(A) rating — rather than pinning today's numbers.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NEC_STANDARD_OCPD, nextStandardOcpd } from '@/lib/electrical/stdSizes';
// The old spellings, to prove they now resolve to the SAME function object rather
// than to a second ladder that differs only by a capital letter.
import {
  nextStandardOCPD as msNextStandardOcpd,
  STANDARD_OCPD_SIZES as MS_STANDARD_OCPD_SIZES,
  getEGCSize,
} from '@/lib/manufacturer-specs';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const STANDARD = new Set<number>(NEC_STANDARD_OCPD as readonly number[]);

describe('🚨 the ladder never emits a non-standard rating', () => {
  it('no multiple-of-five artefact appears for any realistic AC output', () => {
    // The specific values the banned formula produced, none of which is a rating.
    for (const bad of [55, 65, 75, 85, 95, 105, 115, 130, 135, 145, 155]) {
      expect(STANDARD.has(bad), `${bad} A is not an NEC 240.6(A) rating`).toBe(false);
    }
    // Sweep the whole residential/light-commercial range: every answer is real.
    for (let amps = 1; amps <= 600; amps += 1) {
      const r = nextStandardOcpd(amps);
      expect(STANDARD.has(r), `${amps} A -> ${r} A, which is not a standard rating`).toBe(true);
      expect(r, `${amps} A -> ${r} A, which is BELOW the required current`).toBeGreaterThanOrEqual(amps);
    }
  });

  it('🚨 gives the right answer at the sizes the old formula got wrong', () => {
    // Worked from the preliminary route's own inputs: acOutputAmps = kW*1000/240,
    // then x1.25. Left column is what `Math.ceil(x/5)*5` produced.
    const cases: Array<[number, number, number]> = [
      // [amps before rounding, banned result, correct NEC rating]
      [52.5, 55, 60],
      [62.5, 65, 70],
      [72.5, 75, 80],
      [93.75, 95, 100],
      [103.75, 105, 110],
      [130, 130, 150],
    ];
    for (const [amps, banned, correct] of cases) {
      expect(nextStandardOcpd(amps), `${amps} A`).toBe(correct);
      expect(nextStandardOcpd(amps), `${amps} A still returns the banned ${banned} A`).not.toBe(banned);
    }
  });

  it('is monotonic — a bigger load never gets a smaller breaker', () => {
    let prev = 0;
    for (let amps = 1; amps <= 1200; amps += 1) {
      const r = nextStandardOcpd(amps);
      expect(r, `${amps} A went DOWN`).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  // ── The top of the table ─────────────────────────────────────────────────
  // 🚨 The ladder used to STOP at 1200 A and fall back to
  // `Math.ceil(amps / 100) * 100`, which fabricated ratings: 1250 A returned 1300,
  // and NEC 240.6(A) says the next rating above 1200 is 1600. The old comment
  // acknowledged the gap and invited the fabrication. Reachable on any 208/480 V
  // three-phase commercial design, and a rating that does not exist cannot be
  // ordered — the same defect as the 55 A breaker, one decade up.
  it('🚨 continues through the published 240.6(A) list above 1200 A', () => {
    const rows: Array<[number, number]> = [
      [1201, 1600], [1600, 1600],
      [1601, 2000], [2000, 2000],
      [2001, 2500], [2501, 3000],
      [3001, 4000], [4001, 5000], [5001, 6000], [6000, 6000],
    ];
    for (const [amps, expected] of rows) {
      expect(nextStandardOcpd(amps), `${amps} A`).toBe(expected);
    }
    // The specific fabrications the old tail produced.
    for (const bad of [1300, 1400, 1500, 1700, 1800, 1900]) {
      expect(STANDARD.has(bad), `${bad} A is not an NEC 240.6(A) rating`).toBe(false);
    }
    expect(nextStandardOcpd(1250), '1250 A still returns the fabricated 1300 A').not.toBe(1300);
  });

  it('every answer across the WHOLE published range is a real rating', () => {
    // Sweep to the top of 240.6(A), not just to the residential range — the
    // previous sweep stopped at 600 A and could not have seen the broken tail.
    for (let amps = 1; amps <= 6000; amps += 1) {
      const r = nextStandardOcpd(amps);
      expect(STANDARD.has(r), `${amps} A -> ${r} A, which is not a standard rating`).toBe(true);
      expect(r, `${amps} A -> ${r} A, which is BELOW the required current`).toBeGreaterThanOrEqual(amps);
    }
  });

  it('above 6000 A it never returns something SMALLER than asked for', () => {
    // 240.6(A) publishes nothing above 6000 A, so there is no right answer. The
    // one thing that must never happen is an undersized device (NEC 240.4).
    for (const amps of [6001, 7500, 9000]) {
      expect(nextStandardOcpd(amps), `${amps} A`).toBeGreaterThanOrEqual(amps);
    }
  });
});

describe('🚨 there is ONE 240.6 ladder, not two differing by a capital letter', () => {
  it('the manufacturer-specs spelling IS the canonical function', () => {
    // `lib/manufacturer-specs.ts` carried a SECOND full ladder capped at 400 A with
    // a `Math.ceil(amps / 10) * 10` tail, and lib/electrical-calc.ts imported BOTH
    // under names differing only in letter case — so which answer a call site got
    // depended on a capital letter. They are now the same function object.
    expect(msNextStandardOcpd, 'manufacturer-specs re-exports a DIFFERENT function')
      .toBe(nextStandardOcpd);
    expect(MS_STANDARD_OCPD_SIZES).toBe(NEC_STANDARD_OCPD);
  });

  it('🚨 the old 400 A cap and its 10 A tail are gone', () => {
    // sizeAcBranch().ocpdAmps is the AC OCPD the Electrical tab reports and the
    // per-inverter / per-sub / POI aggregate. Above 400 A continuous (96 kW at 240 V,
    // or any 208/480 V three-phase design) the old ladder returned 10 A steps no
    // manufacturer lists, while totalInterconnectionBackfeedA in the SAME file
    // rounded the same current to a real size — two numbers on one sheet.
    for (const amps of [401, 450, 500, 640, 900, 1100]) {
      const r = msNextStandardOcpd(amps);
      expect(STANDARD.has(r), `${amps} A -> ${r} A via manufacturer-specs, not a rating`).toBe(true);
      expect(r, `${amps} A was clamped at or below 400 A`).toBeGreaterThanOrEqual(amps);
    }
    // The exact value the /10 tail produced for a 96 kW three-phase design.
    expect(msNextStandardOcpd(410), 'still returns the fabricated 410 A').not.toBe(410);
    expect(msNextStandardOcpd(410)).toBe(450);
  });
});

describe('NEC Table 250.122 — the canonical table, pinned', () => {
  // 🚨 THIS CASE IS BLIND TO THE DEFECT IT DESCRIBES, AND IS NOT COUNTED AS PROOF
  // OF IT. A SIXTH copy of 250.122 lived in lib/computed-system.ts as a private
  // `getEGCGauge`: 8 rungs, `return '#2 AWG'` for every OCPD above 400 A, where the
  // table requires #1 AWG at 600 A and #1/0 above. That copy is now
  // `const getEGCGauge = getEGCSize`.
  //
  // But `getEGCGauge` is module-private, and this case exercises `getEGCSize` — the
  // canonical function, which was ALWAYS correct. Measured: with the original bytes
  // restored this case stays GREEN. So it pins the canonical table against future
  // drift and nothing more; it is not evidence that the copy was removed.
  //
  // A discriminating test would have to drive `computeSystem` to a >400 A feeder
  // (~100 kW at 240 V) and read the EGC off a run segment. Recorded as the honest
  // gap rather than dressed up: the delegation is a one-line alias whose correctness
  // is visible by inspection, and the OCPD-ladder cases above DID go red.
  it('the canonical 250.122 ladder does not go flat above 400 A', () => {
    expect(getEGCSize(500)).toBe('#2 AWG');
    expect(getEGCSize(600)).toBe('#1 AWG');
    expect(getEGCSize(800)).toBe('#1/0 AWG');
    expect(getEGCSize(1200)).toBe('#1/0 AWG');
    for (const ocpd of [600, 800, 1000, 1200]) {
      expect(getEGCSize(ocpd), `${ocpd} A still gets the flat #2 AWG`).not.toBe('#2 AWG');
    }
  });
});

describe('🚨 the banned formula is gone from the routes that own their own OCPD', () => {
  // SOURCE GUARDS, said plainly: both sites need a request and a database, so the
  // wiring cannot be driven here. The LADDER above is tested behaviourally.
  // 🚨 COMMENT-STRIPPED. The first version of these scans matched the banned
  // formula quoted inside the comments that EXPLAIN the repair — a guard satisfied
  // by the prose describing the defect. Second time today.
  const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

  it('the preliminary route sizes from the NEC ladder', () => {
    const src = read('app', 'api', 'engineering', 'preliminary', 'route.ts');
    expect(src, 'the preliminary route still rounds to a multiple of five')
      .not.toMatch(/Math\.ceil\([^)]*\/\s*5\)\s*\*\s*5/);
    expect(src, 'the preliminary route no longer asks the canonical ladder')
      .toMatch(/nextStandardOcpd\(/);
  });

  it('stringSystem delegates instead of carrying a short ladder with a ceil/5 tail', () => {
    const src = read('app', 'engineering', 'core', 'stringSystem.ts');
    expect(src, 'stringSystem still falls back to a multiple of five above its table')
      .not.toMatch(/Math\.ceil\(amps\s*\/\s*5\)\s*\*\s*5/);
    expect(src).toMatch(/nextStandardOcpd\(/);
  });

  it('records the sites still carrying it, so the count cannot grow unnoticed', () => {
    // 🚨 THREE REMAIN, in files a peer session has uncommitted changes in:
    // app/api/engineering/sld/route.ts, .../sld/pdf/route.ts and
    // app/engineering/page.tsx. They are NOT fixed here — editing a file another
    // session is mid-edit in is how regression evidence gets polluted. This case
    // pins the number so it goes RED if it grows, and RED when they are fixed,
    // which forces this note to be updated rather than quietly left stale.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.next') continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
        // 🚨 A LINE FILTER, not the parser-backed `stripComments`. That helper THROWS
        // on unparseable input by design, and this walks every .ts in app/ and lib/ —
        // one file it cannot parse would fail this case for a reason with nothing to
        // do with OCPD rounding. Dropping comment lines is enough to stop the two
        // headers that FORBID the formula, and the comments explaining its removal,
        // from satisfying the scan — which the first version did not do, and it
        // reported five files where three is the truth.
        const src = readFileSync(p, 'utf8');
        const hits = src.split('\n').filter((l) => {
          const t = l.trimStart();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
          return /Math\.ceil\([^)]*\/\s*5\)\s*\*\s*5/.test(l);
        });
        if (hits.length) offenders.push(p.slice(ROOT.length + 1).replace(/\\/g, '/'));
      }
    };
    walk(join(ROOT, 'app'));
    walk(join(ROOT, 'lib'));
    expect(offenders.sort(),
      'the set of files using the banned OCPD rounding CHANGED — update this list')
      .toEqual([
        'app/api/engineering/sld/pdf/route.ts',
        'app/api/engineering/sld/route.ts',
        'app/engineering/page.tsx',
      ]);
  });
});
