/**
 * tests/manualObstructionReachesPlanset.test.ts
 *
 * THE DESIGNER MARKED A CHIMNEY AND THE STAMPED DRAWING DID NOT HAVE ONE.
 *
 * 🚨 TWO REALITIES, ONE ROOF.
 *
 * A chimney marked in the 3D studio was persisted (migration 122), correctly
 * cleared panels around itself via the keep-out authority, and then vanished:
 * `project.roofObstructions` — the field the roof plan draws from — was
 * assembled from exactly two sources, the Nearmap AI sweep and the
 * aerial-vision detector. `grep -i obstruct app/engineering/page.tsx` returned
 * ZERO hits.
 *
 * So the plan set described a roof the designer had already corrected, and the
 * only obstructions on it were the ones an algorithm spotted from above. The
 * drawing layer was never at fault — `lib/drafting/templates/roof.ts` has drawn
 * footprint, dashed keep-out ring and type label the whole time, and its own
 * comment names the source as "Nearmap AI / vision / manual". The manual third
 * was never wired.
 *
 * THE LAW THIS ENFORCES: if the user draws physical reality in SolarPro, every
 * downstream consumer must either consume it or say explicitly why it does not.
 * There is no separate "permit reality".
 *
 * What is guarded here:
 *   1. the projection is a PROJECTION, not a second obstruction list — its two
 *      numbers come from the same authorities the 3D keep-out uses
 *   2. site objects are excluded, deliberately, and the reason is a real one
 *   3. the radius errs LARGE, because erring small is how a module ends up
 *      over a flue
 *   4. a design with no hand-placed obstructions is BYTE-IDENTICAL to before,
 *      so no live PE approval is retired by this change
 *   5. the carriage exists on every permit payload builder, and is not gated on
 *      there being panels
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { projectObstructionsForPermit } from '../lib/obstruction/permitProjection';
import { DEFAULT_CLEARANCE_M, clearanceFor } from '../lib/3d/panelKeepOut';
import { legacyRadiusFor } from '../lib/3d/obstructionPresets';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

const ENG_PAGE = read('app', 'engineering', 'page.tsx');
const ROOF_CAD = read('lib', 'cad', 'roof', 'roofCAD.ts');

const M2FT = 3.28084;

/** A chimney as the studio stores it. */
const chimney = (over: Record<string, unknown> = {}) => ({
  id: 'obs-1', lat: 38.7, lng: -90.0, height: 150,
  radiusM: 0.54, widthM: 0.9, depthM: 0.6, heightM: 1.2,
  type: 'chimney' as const, space: 'roof' as const, planeId: 'plane-a',
  ...over,
});

describe('🚨 the hand-placed obstruction is projected for the plan set', () => {
  it('a roof object comes through', () => {
    const out = projectObstructionsForPermit([chimney() as any]);
    expect(out.length, 'the chimney did not reach the permit projection').toBe(1);
    expect(out[0].type).toBe('chimney');
    expect(out[0].planeId).toBe('plane-a');
    expect(out[0].source).toBe('manual');
  });

  it('🚨 the clearance is the SAME number the panel exclusion enforces', () => {
    // If the drawn ring were computed independently the plan set could print a
    // keep-out the design never enforced — the same class of defect that put
    // panels across a flue. One function, two consumers.
    const o = chimney();
    const out = projectObstructionsForPermit([o as any]);
    expect(out[0].clearanceFt).toBeCloseTo(clearanceFor(o as any) * M2FT, 6);
    expect(out[0].clearanceFt).toBeCloseTo(DEFAULT_CLEARANCE_M.chimney * M2FT, 6);
  });

  it('a clearance the installer typed beats the type default, here too', () => {
    // The override exists because an installer's judgement beats a table. If it
    // applied in the design and not on the drawing, the two would disagree
    // about the very thing the drawing exists to communicate.
    const out = projectObstructionsForPermit([chimney({ clearanceM: 0.9 }) as any]);
    expect(out[0].clearanceFt).toBeCloseTo(0.9 * M2FT, 6);
  });

  it('🚨 the radius CIRCUMSCRIBES the footprint — erring small is the dangerous direction', () => {
    // The drawing is a circle and the object is a rectangle, so no single
    // radius is exact. Half the diagonal is the smallest circle CONTAINING the
    // footprint; an area-matched radius would be smaller and would draw a
    // keep-out that understates the real one.
    const out = projectObstructionsForPermit([chimney() as any]);
    const expected = legacyRadiusFor(0.9, 0.6) * M2FT;
    expect(out[0].radiusFt).toBeCloseTo(expected, 6);

    const areaEquivalent = Math.sqrt((0.9 * 0.6) / Math.PI) * M2FT;
    expect(out[0].radiusFt,
      'the drawn footprint is smaller than the real one — it must never understate')
      .toBeGreaterThan(areaEquivalent);
  });

  it('falls back to the stored legacy radius when there is no rectangle', () => {
    // Every record stored before the rectangle existed has only radiusM.
    const out = projectObstructionsForPermit([
      chimney({ widthM: undefined, depthM: undefined, radiusM: 0.4 }) as any,
    ]);
    expect(out[0].radiusFt).toBeCloseTo(0.4 * M2FT, 6);
  });

  it('🚨 a TREE is excluded, and that is a decision rather than an oversight', () => {
    // A tree stands on the ground. It occupies no roof area and removes no
    // panels; its whole effect is shade, which already propagates through
    // canonicalShadeScene -> annualShadeFactor -> production. Worse, the
    // template renders a canopy as "CONCEALED AREA — FIELD VERIFY" because an
    // AERIAL canopy hides what is beneath it. A tree the designer placed
    // knowingly conceals nothing, so that warning would be fabricated — on a
    // permit drawing.
    const out = projectObstructionsForPermit([
      { id: 't1', lat: 38.7, lng: -90.0, height: 140, radiusM: 3, widthM: 6, depthM: 6,
        type: 'tree', space: 'site' } as any,
    ]);
    expect(out.length, 'a ground tree was drawn as a roof fixture').toBe(0);
  });

  it('an obstruction with no `space` is treated as a roof object', () => {
    // Which is what every record stored before that field existed was.
    const out = projectObstructionsForPermit([chimney({ space: undefined }) as any]);
    expect(out.length).toBe(1);
  });

  it('🚨 nothing in, nothing out — so no live PE approval is retired', () => {
    // The permit snapshot's digest decides whether a PE approval still applies.
    // A design that has no hand-placed obstructions must produce a payload
    // byte-identical to before this change, or every existing approval would
    // be invalidated by a feature those designs do not use.
    expect(projectObstructionsForPermit([])).toEqual([]);
    expect(projectObstructionsForPermit(null)).toEqual([]);
    expect(projectObstructionsForPermit(undefined)).toEqual([]);
    // And a site-only design likewise contributes nothing.
    expect(projectObstructionsForPermit([
      { id: 't', lat: 1, lng: 2, height: 0, radiusM: 3, type: 'tree', space: 'site' } as any,
    ])).toEqual([]);
  });

  it('a zero-size record is dropped rather than drawn as a dot', () => {
    expect(projectObstructionsForPermit([
      chimney({ widthM: 0, depthM: 0, radiusM: 0 }) as any,
    ])).toEqual([]);
  });
});

describe('🚨 the carriage exists on every permit payload builder', () => {
  it('both builders in the engineering page carry it', () => {
    // 🚨 THE FILE CONSTRUCTS THE PERMIT PROJECT TWICE. An obstruction present
    // in one payload and absent from the other would mean two different plan
    // sets of the same roof depending on which button was pressed.
    const n = (ENG_PAGE.match(/manualRoofObstructions: projectObstructionsForPermit\(/g) || []).length;
    expect(n, `${n} of the 2 permit payload builders carry hand-placed obstructions`).toBe(2);
  });

  it('🚨 it is NOT gated on there being panels', () => {
    // A roof can carry a chimney before it carries a single module, and the
    // drawing still has to show it. `panelPositions` and `roofPlanes` sit
    // inside `projectLayout?.panels.length > 0 ? {...} : {}`; the obstruction
    // spread must be its own, outside that gate.
    // 🚨 ASSERTED STRUCTURALLY, NOT BY A FIXED LOOKBACK. A first version sliced
    // the 400 characters before the carriage and looked for the gate's closing
    // `} : {}),`. `stripComments` blanks comments to WHITESPACE rather than
    // deleting them, so the explanatory comment above the carriage pushed the
    // real code out of that window and the guard failed on correct source. This
    // suite has lost time to fixed-length slices more than once.
    const gate = ENG_PAGE.indexOf('panelPositions: projectLayout.panels.map(');
    const idx = ENG_PAGE.indexOf('manualRoofObstructions: projectObstructionsForPermit(');
    expect(gate).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(gate);
    // Everything between the gate opening and the carriage must contain the
    // gate's CLOSE — i.e. the carriage sits outside it.
    expect(ENG_PAGE.slice(gate, idx),
      'the obstruction carriage was folded into the panels-only block, so a roof with a chimney and no modules yet would draw no chimney')
      .toMatch(/\}\s*:\s*\{\}\),/);
    // And its own condition is about obstructions, not panels.
    expect(ENG_PAGE.slice(idx - 200, idx)).toMatch(/projectLayout\?\.obstructions\?\.length/);
  });

  it('the projection is imported from the one module', () => {
    expect(ENG_PAGE).toMatch(/import \{ projectObstructionsForPermit \} from '@\/lib\/obstruction\/permitProjection'/);
  });
});

describe('🚨 they merge where every other obstruction does', () => {
  it('roofCAD consumes them, so they get the same local-frame treatment', () => {
    // Injecting them at the adapter instead would skip the local-frame
    // projection and the plane binding — a bypass, and a bypass is how two
    // lists drift apart again.
    expect(ROOF_CAD).toMatch(/manualRoofObstructions/);
    expect(ROOF_CAD).toMatch(/source:      'manual' as const/);
    expect(ROOF_CAD, 'manual obstructions are not pushed into the shared list')
      .toMatch(/sysDefObstructions\.push\(\.\.\.manualObstructions\)/);
  });

  it('the AI-only filters are NOT applied to a human measurement', () => {
    // The per-type radius cap exists because coarse AI polygons blow up. A
    // designer typed these dimensions after looking at the roof; capping a
    // chimney they measured would overrule a person with a tape measure.
    const i = ROOF_CAD.indexOf('const manual = ');
    expect(i).toBeGreaterThan(-1);
    const block = ROOF_CAD.slice(i, ROOF_CAD.indexOf('sysDefObstructions.push(...manualObstructions)', i));
    expect(block, 'the AI radius cap is being applied to a hand-measured object')
      .not.toMatch(/_radCap/);
    expect(block, 'confidence must say a person placed it').toMatch(/confidence:  1/);
  });

  it('🚨 an unbound object is KEPT and warned about, never silently dropped', () => {
    // Discarding the designer's own mark is the same class of defect as never
    // carrying it, and it would be invisible.
    const i = ROOF_CAD.indexOf('const manual = ');
    const block = ROOF_CAD.slice(i, ROOF_CAD.indexOf('sysDefObstructions.push(...manualObstructions)', i));
    expect(block, 'an unbound manual obstruction is being dropped')
      .not.toMatch(/_manualOffPlane\+\+;\s*return null/);
    expect(ROOF_CAD).toMatch(/not bound to a design plane — kept, verify placement/);
  });
});
