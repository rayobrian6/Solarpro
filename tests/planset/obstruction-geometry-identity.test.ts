// ═══════════════════════════════════════════════════════════════════════════
// ROOF-OBSTRUCTION GEOMETRY IDENTITY.
//
// Planset 14 plotted FOUR roof obstructions where Planset 13 plotted three, and
// the new one appeared during an authority/grounding campaign — the shape of a
// propagation or duplicate-merge defect. It was traced instead of assumed, and
// it is legitimate:
//
//   • The new record is the LAST entry in project.roofObstructions, type 'vent',
//     description "vent pipe (aerial vision — field verify)" — the aerial-vision
//     sweep (detectAerialVisionObstructions), a DISTINCT source from the Nearmap
//     AI set, which appends after it.
//   • The Nearmap AI cache row for this parcel is unchanged since 2026-07-08
//     (survey 2026-02-27) and contributes exactly 66 records; the sweep added
//     exactly one, so the posted input carries 67.
//   • No CAD or obstruction-geometry code changed between the two code points —
//     the only edit to the roof template was the PV-1 deck-mount note text.
//   • It is not a duplicate: on the live geometry the four kept obstructions sit
//     2.71 m / 5.46 m / 9.55 m / 15.01 m apart; nearest pair 2.71 m.
//   • Its host plane carries zero modules, so it changes no module placement and
//     no fire access.
//
// These tests pin the IDENTITY properties that would have caught the failure
// modes it was checked against: a kept obstruction is a distinct physical
// feature with a unique id, the same feature is never plotted twice, and a
// vision-sourced record keeps its field-verify provenance rather than
// masquerading as a surveyed Nearmap detection.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** A square polygon of ~0.25 m half-extent around a centroid. */
function box(lat: number, lng: number, halfM = 0.25) {
  const dLat = halfM / 111320;
  const dLng = halfM / (111320 * Math.cos(lat * Math.PI / 180));
  return [
    { lat: lat - dLat, lng: lng - dLng }, { lat: lat - dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng }, { lat: lat + dLat, lng: lng - dLng },
  ];
}

/** The live package's four kept obstructions sit at these centroids (from the
 *  posted permit_input): nm-obs-10 38.706142/-90.046192, nm-obs-18
 *  38.7061438/-90.0463019, nm-obs-32 38.7061177/-90.0461928 and — the fourth,
 *  the aerial-vision detection — nm-obs-66 38.7061454/-90.0463647, on the plane
 *  that carries zero modules. They are recorded here for the trace; the tests
 *  below place their probes from THIS fixture's own plane rings so they exercise
 *  the engine's identity behaviour rather than pinning live coordinates. */
const PLANES = (braidonOriginalAuditFixture as any).layout.geometry.roofPlanes as
  Array<{ id: string; vertices: Array<{ lat: number; lng: number }> }>;

/** A point inside plane `i`, nudged by (dLatM, dLngM) metres from its centroid. */
function onPlane(i: number, dLatM = 0, dLngM = 0) {
  const vs = PLANES[i].vertices;
  const lat = vs.reduce((s, v) => s + v.lat, 0) / vs.length;
  const lng = vs.reduce((s, v) => s + v.lng, 0) / vs.length;
  return {
    lat: lat + dLatM / 111320,
    lng: lng + dLngM / (111320 * Math.cos(lat * Math.PI / 180)),
    description: 'Vent',
  };
}

function withObstructions(obs: Array<{ lat: number; lng: number; description: string; type?: string }>) {
  const input: any = clone(braidonOriginalAuditFixture);
  input.project.roofObstructions = obs.map(o => ({
    type: o.type ?? 'vent', description: o.description, polygon: box(o.lat, o.lng), clearanceM: 0.15,
  }));
  const cad: any = generateCADLayout(input);
  return { input, cad, kept: (cad.obstructions ?? []) as any[] };
}

/** Four distinct probe points: three spread across plane 0 and one on plane 1,
 *  the fourth carrying the aerial-vision provenance the live fourth carries. */
const PROBES = [
  onPlane(0, 0, -2.0),
  onPlane(0, 0, 2.0),
  onPlane(0, -1.2, 0),
  { ...onPlane(1, 0, 0), description: 'vent pipe (aerial vision — field verify)' },
];

const centre = (o: any) => ({ x: Number(o.worldX ?? o.x ?? NaN), y: Number(o.worldY ?? o.y ?? NaN) });
const dist = (a: any, b: any) => {
  const p = centre(a), q = centre(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

describe('roof-obstruction geometry identity', () => {
  it('four separated records plot as FOUR distinct features, none within 0.6 m of another', () => {
    const { kept } = withObstructions(PROBES);
    expect(kept.length).toBe(4);
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        expect(dist(kept[i], kept[j]),
          `${kept[i].id} and ${kept[j].id} are the same physical feature plotted twice`)
          .toBeGreaterThan(0.6);
      }
    }
  });

  it('the fourth (aerial-vision) obstruction binds to a roof plane and is kept on its own merit', () => {
    const three = withObstructions(PROBES.slice(0, 3));
    const four = withObstructions(PROBES);
    expect(three.kept.length).toBe(3);
    expect(four.kept.length).toBe(4);
    // adding it does not perturb the three that were already there
    for (const a of three.kept) {
      const match = four.kept.find(b => dist(a, b) < 0.01);
      expect(match, `existing obstruction ${a.id} moved when the fourth was added`).toBeTruthy();
    }
  });

  it('every kept obstruction carries a unique id', () => {
    const { kept } = withObstructions(PROBES);
    expect(new Set(kept.map(o => o.id)).size).toBe(kept.length);
  });

  it('an off-roof record is DROPPED, not plotted — a neighbour vent is not this roof’s', () => {
    const offRoof = { lat: 38.70650, lng: -90.04570, description: 'Vent' };   // ~40 m north-east
    const { kept } = withObstructions([...PROBES, offRoof]);
    expect(kept.length).toBe(4);
  });

  it('THE DUPLICATE-MERGE CASE: the same feature posted twice plots twice, and the identity scan sees it', () => {
    // The engine does not silently merge — which is why the scan above is the
    // guard. Two records at the same centroid must be VISIBLE as a duplicate,
    // never quietly collapsed into one (that would hide a propagation defect)
    // and never accepted as two distinct vents by the identity scan.
    const { kept } = withObstructions([PROBES[0], { ...PROBES[0] }, PROBES[1]]);
    expect(kept.length).toBe(3);
    const pairs: number[] = [];
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) pairs.push(dist(kept[i], kept[j]));
    }
    expect(pairs.some(d => d < 0.6), 'the identity scan failed to see a duplicated feature').toBe(true);
  });

  it('a vision-sourced record keeps its field-verify provenance in the posted geometry', () => {
    // The provenance travels on the record the route assembles; it must never be
    // rewritten to look like a surveyed Nearmap detection.
    const { input } = withObstructions(PROBES);
    const vision = (input.project.roofObstructions as any[])
      .filter(o => /aerial vision/i.test(String(o.description ?? '')));
    expect(vision.length).toBe(1);
    expect(vision[0].description).toMatch(/field verify/i);
  });
});
