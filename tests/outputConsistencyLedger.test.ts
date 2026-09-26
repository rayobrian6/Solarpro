/**
 * tests/outputConsistencyLedger.test.ts
 *
 * THE OUTPUT-CONSISTENCY LAW, MADE MACHINE-CHECKED.
 *
 * Ray's standing rule: **if the user draws physical reality in SolarPro, every
 * downstream consumer must either consume it or explicitly say why it does not.
 * No hidden parallel worlds — `3D reality ≠ permit reality` is prohibited.**
 *
 * That law was learned from a specific failure: a hand-placed chimney cleared the
 * modules over it on screen and never reached the plan set, so the 3D view and the
 * stamped drawing described different roofs and nothing objected. It is now proven
 * end-to-end, in a real browser, through the real CAD chain.
 *
 * 🚨 BUT THE LAW WAS ONLY EVER ENFORCED ONE OBJECT AT A TIME, after somebody
 * noticed. This file is the ledger: every kind of thing a person can place or
 * shape in the studio, and for each one either the consumer that carries it into
 * an output, or the recorded reason it has none. A new placeable thing added
 * without an entry fails this test, which is the point — the next chimney should
 * be caught by a test rather than by a user.
 *
 * WHAT THE SWEEP FOUND, and the honest split:
 *
 *   CONSUMED — panels, roof planes, obstructions.
 *
 *   DELIBERATELY NOT CONSUMED, and correctly so:
 *     • Measurements are a RULER: two picked points plus a computed distance, with
 *       no user-entered value anywhere in the type. Propagating them would be
 *       circular — the drawings compute the same dimensions from the same
 *       geometry. (Its spherical-haversine model differs from an exact ellipsoid
 *       by well under a centimetre at roof spans, which its own header states.)
 *     • Ground and fence SCALARS — tilt, azimuth, row spacing, ground height,
 *       fence height — are INPUTS TO PLACEMENT, not facts about the finished
 *       design. The rows they produce are what reaches the drawings, and a row
 *       spacing has nothing to say on a sheet.
 *
 *   🚨 NOT CONSUMED, AND THAT IS A GAP, NOT A DESIGN CHOICE:
 *     • The building-section model's WALL, EAVE and RIDGE heights reach no output
 *       at all. Not because they are derived or irrelevant — because NO ROOF SHEET
 *       DRAWS A BUILDING ELEVATION. The fence gets "SOLAR FENCE ELEVATION & PLAN";
 *       the roof gets a top-down plan and a mounting cross-section. So a person can
 *       model a 10 ft 6 wall and a ridge height, and no drawing in the package
 *       shows either. Recorded as NEEDS-RAY R7, because whether an AHJ elevation
 *       sheet belongs in the package is a product call and not one to guess at.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

/** Where an output actually lives. A "consumer" must be one of these. */
const OUTPUT_DIRS = ['lib/cad', 'lib/permit'] as const;

/**
 * One entry per kind of thing a person can place or shape.
 *
 * `consumedBy` names a real file under an output directory that reads it, or is
 * null when nothing does — in which case `why` must say why, and be true.
 */
interface LedgerEntry {
  what: string;
  /** The field or type the studio stores it as. */
  field: string;
  consumedBy: string | null;
  why?: string;
}

const LEDGER: LedgerEntry[] = [
  {
    what: 'Modules the user placed',
    field: 'panels',
    consumedBy: 'lib/cad/roof/roofCAD.ts',
  },
  {
    what: 'Roof faces the user traced or reshaped',
    field: 'roofPlanes',
    consumedBy: 'lib/cad/roof/roofCAD.ts',
  },
  {
    what: 'Obstructions the user marked by hand (chimney, vent, tree…)',
    field: 'manualRoofObstructions',
    consumedBy: 'lib/cad/roof/roofCAD.ts',
  },
  {
    what: 'Ruler measurements the user drew',
    field: 'measurements',
    consumedBy: null,
    why:
      'A ruler, not an assertion: LayoutMeasurement is two picked points plus a ' +
      'computed horizDistM/slopeDistM, with no user-entered length anywhere in the ' +
      'type. The drawings compute the same dimensions from the same geometry, so ' +
      'propagating a ruler would be circular.',
  },
  {
    what: 'Ground-mount and fence scalars (tilt, azimuth, row spacing, heights)',
    field: 'groundTilt / groundAzimuth / rowSpacing / groundHeight / fenceHeight',
    consumedBy: null,
    why:
      'Inputs to placement rather than facts about the finished design. The rows ' +
      'and posts they produce are what reaches the sheets; a row spacing has ' +
      'nothing to say on a drawing.',
  },
  {
    what: 'Building-section wall, eave and ridge heights',
    field: 'RoofPlane.section',
    consumedBy: null,
    why:
      'NOT a design choice — a GAP. No roof sheet draws a building elevation: the ' +
      'fence has one, the roof has a top-down plan and a mounting cross-section. ' +
      'See NEEDS-RAY R7.',
  },
];

function fileReads(file: string, token: string): boolean {
  if (!existsSync(join(ROOT, file))) return false;
  return read(file).includes(token);
}

describe('🚨 the output-consistency ledger is complete and true', () => {
  it('every entry either names a consumer or gives a reason — never neither', () => {
    for (const e of LEDGER) {
      if (e.consumedBy === null) {
        expect(e.why, `"${e.what}" reaches no output and no reason is recorded — ` +
          'that is the hidden parallel world the law forbids')
          .toBeTruthy();
        expect((e.why ?? '').length, `the reason given for "${e.what}" is too thin to audit`)
          .toBeGreaterThan(40);
      }
    }
  });

  it('🚨 every claimed consumer EXISTS and is under an output directory', () => {
    // A consumer named but absent is worse than none: the ledger would read as
    // proof while proving nothing.
    for (const e of LEDGER) {
      if (!e.consumedBy) continue;
      expect(existsSync(join(ROOT, e.consumedBy)),
        `"${e.what}" claims ${e.consumedBy} as its consumer and that file does not exist`)
        .toBe(true);
      expect(OUTPUT_DIRS.some(d => e.consumedBy!.startsWith(d)),
        `${e.consumedBy} is not under an output directory, so it cannot be what carries ` +
        `"${e.what}" into a drawing`)
        .toBe(true);
    }
  });

  it('🚨 and every claimed consumer actually READS the field', () => {
    // The assertion that does the work. A file existing under lib/cad proves
    // nothing about whether it reads the thing.
    for (const e of LEDGER) {
      if (!e.consumedBy) continue;
      const token = e.field.split(' / ')[0];
      expect(fileReads(e.consumedBy, token),
        `${e.consumedBy} does not mention \`${token}\` — "${e.what}" is not actually ` +
        'carried into any output by the file the ledger names')
        .toBe(true);
    }
  });
});

describe('🚨 the NOT-CONSUMED entries are still true', () => {
  // 🚨 THESE ARE THE ONES THAT GO STALE SILENTLY. The day somebody wires the
  // building section into a sheet, this ledger's reason becomes a lie — and a
  // stale reason is exactly how a parallel world reappears. So each negative
  // claim is checked against the source rather than trusted.

  it('measurements really have no consumer under an output directory', () => {
    for (const d of OUTPUT_DIRS) {
      const hit = existsSync(join(ROOT, d)) && read(join(d, 'types.ts')).includes('LayoutMeasurement');
      expect(hit, `${d} now reads LayoutMeasurement — update the ledger: the ruler is being ` +
        'propagated, which is either a real change or the circularity the entry warns about')
        .toBe(false);
    }
  });

  it('🚨 the building section still reaches nothing — the recorded gap is still open', () => {
    // If this fails because somebody wired it up, that is GOOD NEWS and the entry
    // must be promoted to a consumer with its file named. It must not be deleted.
    const tokens = ['wallHeight', 'eaveHeight', 'ridgeHeight'];
    for (const d of OUTPUT_DIRS) {
      for (const t of tokens) {
        const files = ['types.ts', 'constants.ts'].filter(f => existsSync(join(ROOT, d, f)));
        for (const f of files) {
          expect(read(join(d, f)).includes(t),
            `${d}/${f} now reads \`${t}\` — the building-section gap may be closed. ` +
            'Promote the ledger entry to name its consumer rather than leaving a stale reason.')
            .toBe(false);
        }
      }
    }
  });
});

describe('the roof really has no building-elevation sheet', () => {
  it('the fence has one and the roof does not', () => {
    // This is the whole basis of the recorded gap, so it is asserted rather than
    // asserted-in-a-comment. If a roof elevation sheet is ever added, this fails
    // and the ledger entry must be revisited — which is the intent.
    const manifest = read('lib', 'permit', 'sheetManifest.ts');
    expect(manifest, 'the fence elevation sheet is gone — re-check what the roof has')
      .toMatch(/FENCE ELEVATION/);
    expect(manifest.match(/roof:\s*'[^']*ELEVATION[^']*'/),
      'a roof sheet now says ELEVATION — the building-section gap may be closeable, ' +
      'and NEEDS-RAY R7 should be revisited')
      .toBeNull();
  });
});
