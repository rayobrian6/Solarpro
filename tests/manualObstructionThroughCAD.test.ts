/**
 * tests/manualObstructionThroughCAD.test.ts
 *
 * THE CHIMNEY, ALL THE WAY TO THE DRAWING — THROUGH THE REAL CAD CHAIN.
 *
 * `tests/manualObstructionReachesPlanset.test.ts` proves the projection is
 * correct and that the carriage exists. This proves the other half: that a
 * hand-placed obstruction actually SURVIVES the pipeline that turns a permit
 * input into something the roof plan can draw.
 *
 * It runs the production functions, not a model of them:
 *
 *   PermitInputShape  → roofCAD()            → CADModel.obstructions
 *                     → adaptCADToDrafting() → project.roofObstructions
 *
 * and `lib/drafting/templates/roof.ts` draws exactly that last array.
 *
 * 🚨 WHY THIS IS A SEPARATE FILE FROM THE SOURCE GUARDS. The two consumers of
 * obstruction data want DIFFERENT SHAPES — roofCAD reads `polygon` rings from
 * the aerial sources, while the template reads `{lat, lng, radiusFt,
 * clearanceFt}`. A hand-placed object has neither natively. Asserting the
 * wiring by reading source could not tell you whether the shape survives the
 * two conversions in between, and the shape is where this kind of change
 * silently dies.
 *
 * Covers, deterministically, the middle of the required fixture: generate →
 * the chimney is on the roof plan → its dimensions and clearance are
 * consistent → delete → regenerate → it is gone.
 */

import { describe, it, expect } from 'vitest';
import { roofCAD } from '../lib/cad/roof/roofCAD';
import { adaptCADToDrafting } from '../lib/cad/adapter';
import { projectObstructionsForPermit } from '../lib/obstruction/permitProjection';
import { DEFAULT_CLEARANCE_M } from '../lib/3d/panelKeepOut';
import type { PermitInputShape } from '../lib/drafting/permitInputShape';

const ORIGIN_LAT = 38.70615;
const ORIGIN_LNG = -90.04625;
const M2FT = 3.28084;

/** Local metres → lat/lng, matching the CAD origin convention. */
function localToLatLng(x: number, y: number) {
  const lat = ORIGIN_LAT + y / 111_320;
  const lng = ORIGIN_LNG + x / (111_320 * Math.cos((ORIGIN_LAT * Math.PI) / 180));
  return { lat, lng };
}

/** A 12 m x 8 m roof plane, as lat/lng vertices. */
const PLANE_VERTICES = [
  localToLatLng(0, 0),
  localToLatLng(12, 0),
  localToLatLng(12, 8),
  localToLatLng(0, 8),
];

/** The chimney the designer marked, in the canonical studio shape. */
const CHIMNEY = {
  id: 'obs-chimney-1',
  ...localToLatLng(6, 4),          // middle of the plane
  height: 150,
  radiusM: 0.54,
  widthM: 0.9,
  depthM: 0.6,
  heightM: 1.2,
  type: 'chimney' as const,
  space: 'roof' as const,
  planeId: 'plane-A',
};

function makeInput(manual: ReturnType<typeof projectObstructionsForPermit>): PermitInputShape {
  const panels = [
    { id: 'p1', ...localToLatLng(2, 4), orientation: 'portrait', row: 0, col: 0 },
    { id: 'p2', ...localToLatLng(10, 4), orientation: 'portrait', row: 0, col: 1 },
  ];
  return {
    project: {
      systemType: 'roof',
      panelLengthIn: 66,
      panelWidthIn: 40,
      lat: ORIGIN_LAT,
      lng: ORIGIN_LNG,
      panelPositions: panels,
      roofPlanes: [
        { id: 'plane-A', vertices: PLANE_VERTICES, pitch: 18.43, azimuth: 180, area: 96 },
      ],
      ...(manual.length ? { manualRoofObstructions: manual } : {}),
    },
    system: { totalPanels: panels.length, totalDcKw: 0.8, inverters: [] },
  } as unknown as PermitInputShape;
}

/** The array the roof plan actually draws. */
function drawnObstructions(manual: ReturnType<typeof projectObstructionsForPermit>) {
  const input = makeInput(manual);
  const cad = roofCAD(input);
  const drafting = adaptCADToDrafting(cad, input);
  return {
    cadObstructions: cad.obstructions ?? [],
    drawn: (drafting.project as any).roofObstructions ?? [],
  };
}

describe('🚨 a hand-placed chimney reaches the roof plan', () => {
  const manual = projectObstructionsForPermit([CHIMNEY as any]);

  it('the projection produced something to carry', () => {
    expect(manual.length).toBe(1);
  });

  it('roofCAD accepts it as a real obstruction, tagged manual', () => {
    const { cadObstructions } = drawnObstructions(manual);
    const mine = cadObstructions.filter((o: any) => o.source === 'manual');
    expect(mine.length, 'the hand-placed chimney did not survive roofCAD').toBe(1);
    // It is a person's measurement, not a guess from an aerial.
    expect(mine[0].confidence).toBe(1);
  });

  it('it binds to the face it was marked on', () => {
    const { cadObstructions } = drawnObstructions(manual);
    const mine = cadObstructions.find((o: any) => o.source === 'manual') as any;
    expect(mine.roofPlaneId, 'the chimney lost its face binding').toBe('plane-A');
  });

  it('🚨 and it arrives in the array the drawing renders', () => {
    const { drawn } = drawnObstructions(manual);
    expect(drawn.length, 'the chimney is not on the roof plan').toBeGreaterThan(0);
    expect(drawn.some((o: any) => o.type === 'chimney')).toBe(true);
  });

  it('🚨 its footprint and clearance survive both conversions intact', () => {
    // The chain converts metres -> local XY -> fake degrees and metres -> feet.
    // This is where a silent unit error would live, and a keep-out ring drawn
    // at the wrong size is worse than none: it is a wrong instruction to a
    // roofer, on a stamped sheet.
    const { drawn } = drawnObstructions(manual);
    const o = drawn.find((d: any) => d.type === 'chimney') as any;
    expect(o).toBeTruthy();

    const expectedRadiusFt = (Math.sqrt(0.9 * 0.9 + 0.6 * 0.6) / 2) * M2FT;
    expect(o.radiusFt).toBeCloseTo(expectedRadiusFt, 2);

    // The SAME clearance the panel exclusion enforces — 0.45 m for a chimney.
    expect(o.clearanceFt).toBeCloseTo(DEFAULT_CLEARANCE_M.chimney * M2FT, 1);
  });

  it('a clearance the installer typed survives too', () => {
    const custom = projectObstructionsForPermit([{ ...CHIMNEY, clearanceM: 0.9 } as any]);
    const { drawn } = drawnObstructions(custom);
    const o = drawn.find((d: any) => d.type === 'chimney') as any;
    expect(o.clearanceFt).toBeCloseTo(0.9 * M2FT, 1);
  });

  it('🚨 DELETE IT AND IT IS GONE — no ghost survives regeneration', () => {
    // The other half of propagation. An obstruction that appears when added and
    // lingers when removed is a stale drawing, which is the more dangerous
    // failure: the roofer avoids a flue that is not there, or trusts a sheet
    // that no longer matches the design.
    const { cadObstructions, drawn } = drawnObstructions(projectObstructionsForPermit([]));
    expect(cadObstructions.filter((o: any) => o.source === 'manual').length).toBe(0);
    expect(drawn.filter((o: any) => o.type === 'chimney').length,
      'the chimney is still drawn after being deleted').toBe(0);
  });

  it('🚨 a design that never had one is UNCHANGED — no PE approval is retired', () => {
    // The permit snapshot's digest decides whether an existing PE approval
    // still applies. A design with no hand-placed obstructions must produce the
    // same drawing input as before this feature existed, or every live approval
    // would be invalidated by a feature those designs do not use.
    const none = makeInput(projectObstructionsForPermit([]));
    expect((none.project as any).manualRoofObstructions,
      'an empty obstruction list is still being attached to the payload')
      .toBeUndefined();
  });

  it('a ground tree never becomes a roof fixture, end to end', () => {
    // It shades; it does not occupy. And the template renders a canopy as
    // "CONCEALED AREA — FIELD VERIFY", which would be a fabricated warning
    // about an object the designer placed knowingly.
    const tree = projectObstructionsForPermit([
      { id: 't1', ...localToLatLng(6, 4), height: 140, radiusM: 3,
        widthM: 6, depthM: 6, type: 'tree', space: 'site' } as any,
    ]);
    const { drawn } = drawnObstructions(tree);
    expect(drawn.filter((o: any) => o.type === 'tree' || o.type === 'canopy').length).toBe(0);
  });
});
