import { describe, it, expect } from 'vitest';
import {
  cropToSubjectBuilding,
  cropObstructionsToPlanes,
  filterToSubjectBuilding,
  DEFAULT_ADJACENCY_GAP_M,
} from './subjectBuildingCrop';
import type { NearmapRoofPlane, NearmapObstruction } from './nearmap';

const M_PER_DEG_LAT = 111_320;
const REF_LAT = 38.811;

// Build a rectangular facet (closed ring) centred at (lat,lng), sized in metres.
function rect(lat: number, lng: number, wM: number, hM: number): NearmapRoofPlane {
  const dLat = hM / 2 / M_PER_DEG_LAT;
  const dLng = wM / 2 / (M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180));
  return {
    worldPolygon: [
      { lat: lat - dLat, lng: lng - dLng },
      { lat: lat - dLat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng - dLng },
      { lat: lat - dLat, lng: lng - dLng },
    ],
    areaSqft: Math.round(wM * hM * 10.7639),
    pitchDeg: 22, azimuthDeg: null, roofType: 'gable', material: 'shingle',
    confidence: 0.9, captureDate: '2026-01-01', source: 'nearmap_ai',
  };
}

// Metre offsets → lat/lng delta from a reference point.
function offset(lat: number, lng: number, eastM: number, northM: number) {
  return {
    lat: lat + northM / M_PER_DEG_LAT,
    lng: lng + eastM / (M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180)),
  };
}

describe('cropToSubjectBuilding', () => {
  const subject = { lat: REF_LAT, lng: -89.954 };

  it('keeps a single plane untouched (no crop)', () => {
    const planes = [rect(subject.lat, subject.lng, 10, 8)];
    const res = cropToSubjectBuilding(planes, subject);
    expect(res.planes).toHaveLength(1);
    expect(res.cropped).toBe(false);
  });

  it('keeps the two adjacent facets of the subject gable and drops the neighbours', () => {
    // Subject gable: two 10m×4m facets sharing a ridge (touching, gap ~0).
    const south = offset(subject.lat, subject.lng, 0, -2); // facet centres 4m apart
    const north = offset(subject.lat, subject.lng, 0, +2);
    const subjectS = rect(south.lat, south.lng, 10, 4);
    const subjectN = rect(north.lat, north.lng, 10, 4);
    // Neighbour houses ~12m east and west — well beyond the 1.2m gap.
    const eastN = offset(subject.lat, subject.lng, 12, 0);
    const westN = offset(subject.lat, subject.lng, -12, 0);
    const neighbourE = rect(eastN.lat, eastN.lng, 8, 8);
    const neighbourW = rect(westN.lat, westN.lng, 8, 8);

    const planes = [neighbourW, subjectS, neighbourE, subjectN];
    const res = cropToSubjectBuilding(planes, subject);

    expect(res.cropped).toBe(true);
    expect(res.planes).toHaveLength(2);
    expect(res.keptIndices.sort()).toEqual([1, 3]); // the two subject facets
    expect(res.seedIndex === 1 || res.seedIndex === 3).toBe(true);
  });

  it('seeds by nearest centroid when the subject point lands in a ridge gap', () => {
    // Two facets straddling the subject point but with a 0.5m gap between them,
    // so the point itself is inside neither.
    const s = offset(subject.lat, subject.lng, 0, -3);
    const n = offset(subject.lat, subject.lng, 0, +3);
    const facetS = rect(s.lat, s.lng, 10, 5); // top edge ~0.5m below subject
    const facetN = rect(n.lat, n.lng, 10, 5);
    const far = offset(subject.lat, subject.lng, 30, 0);
    const neighbour = rect(far.lat, far.lng, 8, 8);

    const res = cropToSubjectBuilding([facetS, facetN, neighbour], subject);
    expect(res.seedIndex).not.toBeNull();
    expect(res.planes).toHaveLength(2); // both subject facets, not the far neighbour
    expect(res.keptIndices).not.toContain(2);
  });

  it('does not cluster neighbours that sit just beyond the adjacency gap', () => {
    const subjectPlane = rect(subject.lat, subject.lng, 10, 8);
    // Neighbour edge ~2m away (> default 1.2m gap): centre offset = 10m/2 + 8m/2 + 2m
    const nb = offset(subject.lat, subject.lng, 10 / 2 + 8 / 2 + 2, 0);
    const neighbour = rect(nb.lat, nb.lng, 8, 8);
    const res = cropToSubjectBuilding([subjectPlane, neighbour], subject);
    expect(res.planes).toHaveLength(1);
    expect(res.keptIndices).toEqual([0]);
  });

  it('clusters facets that touch within the adjacency gap', () => {
    expect(DEFAULT_ADJACENCY_GAP_M).toBeGreaterThan(1);
    const subjectPlane = rect(subject.lat, subject.lng, 10, 8);
    // Neighbour edge ~0.8m away (< 1.2m gap) → same cluster.
    const nb = offset(subject.lat, subject.lng, 10 / 2 + 8 / 2 + 0.8, 0);
    const attached = rect(nb.lat, nb.lng, 8, 8);
    const res = cropToSubjectBuilding([subjectPlane, attached], subject);
    expect(res.planes).toHaveLength(2);
  });

  it('fails open on empty input', () => {
    const res = cropToSubjectBuilding([], subject);
    expect(res.planes).toHaveLength(0);
    expect(res.seedIndex).toBeNull();
    expect(res.cropped).toBe(false);
  });
});

describe('filterToSubjectBuilding (Design Studio RoofPlane guard)', () => {
  const subject = { lat: REF_LAT, lng: -89.954 };

  // Minimal RoofPlane-like object: an id + lat/lng vertices ring.
  function plane(id: string, lat: number, lng: number, wM: number, hM: number) {
    return { id, vertices: rect(lat, lng, wM, hM).worldPolygon };
  }

  it('keeps the subject building and drops neighbour roofs (the 997-panel bug)', () => {
    const mine = plane('mine', subject.lat, subject.lng, 12, 10);
    const nb1 = offset(subject.lat, subject.lng, 30, 0);
    const nb2 = offset(subject.lat, subject.lng, -30, 5);
    const neighbours = [
      plane('n1', nb1.lat, nb1.lng, 10, 10),
      plane('n2', nb2.lat, nb2.lng, 10, 10),
    ];
    const res = filterToSubjectBuilding([neighbours[0], mine, neighbours[1]], p => p.vertices, subject);
    expect(res.cropped).toBe(true);
    expect(res.kept.map(p => p.id)).toEqual(['mine']);
  });

  it('keeps all planes of the subject building (multi-facet hip roof)', () => {
    // Two adjacent facets sharing a ridge = one building — both kept.
    const s = offset(subject.lat, subject.lng, 0, -2.5);
    const n = offset(subject.lat, subject.lng, 0, +2.5);
    const facetS = plane('S', s.lat, s.lng, 12, 5);
    const facetN = plane('N', n.lat, n.lng, 12, 5);
    const far = offset(subject.lat, subject.lng, 30, 0);
    const neighbour = plane('nb', far.lat, far.lng, 10, 10);
    const res = filterToSubjectBuilding([facetS, neighbour, facetN], p => p.vertices, subject);
    expect(res.kept.map(p => p.id).sort()).toEqual(['N', 'S']);
  });
});

describe('cropObstructionsToPlanes', () => {
  const subject = { lat: REF_LAT, lng: -89.954 };
  const subjectPlane = rect(subject.lat, subject.lng, 12, 10);

  function obstruction(lat: number, lng: number): NearmapObstruction {
    const d = 0.3 / M_PER_DEG_LAT;
    const dl = 0.3 / (M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180));
    return {
      type: 'vent', description: 'Vent',
      polygon: [
        { lat: lat - d, lng: lng - dl }, { lat: lat - d, lng: lng + dl },
        { lat: lat + d, lng: lng + dl }, { lat: lat + d, lng: lng - dl },
        { lat: lat - d, lng: lng - dl },
      ],
      confidence: 0.9, captureDate: '2026-01-01',
    };
  }

  it('keeps obstructions on the subject plane and drops far-away ones', () => {
    const onRoof = obstruction(subject.lat, subject.lng);
    const off = offset(subject.lat, subject.lng, 30, 0);
    const farAway = obstruction(off.lat, off.lng);
    const res = cropObstructionsToPlanes([onRoof, farAway], [subjectPlane], subject);
    expect(res).toHaveLength(1);
    expect(res[0]).toBe(onRoof);
  });

  it('fails open when there are no kept planes', () => {
    const o = obstruction(subject.lat, subject.lng);
    expect(cropObstructionsToPlanes([o], [], subject)).toEqual([o]);
  });
});
