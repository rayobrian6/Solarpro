import { describe, it, expect } from 'vitest';
import { parseEagleViewMeasurementJson } from '../eagleViewMeasurementParser';

// Real sample subset from EagleView sandbox report 69110976 (Tiburon, CA):
// faces F1 + F2 with their lines L1–L9 and points C5–C12.
const ORIGIN_LAT = 37.9041155;
const ORIGIN_LNG = -122.5064934;

const SAMPLE = {
  EAGLEVIEW_EXPORT: {
    STRUCTURES: {
      '@northorientation': '299.8',
      ROOF: {
        FACES: {
          FACE: [
            { '@id': 'F1', '@type': 'ROOF', POLYGON: { '@path': 'L1,L3,L4,L5,L2', '@pitch': '5', '@orientation': '330.2', '@size': '255', '@unroundedsize': '255.131907036' } },
            { '@id': 'F2', '@type': 'ROOF', POLYGON: { '@path': 'L2,L7,L9,L8,L6', '@pitch': '5', '@orientation': '60.2', '@size': '235', '@unroundedsize': '234.760636022' } },
            { '@id': 'F90', '@type': 'ROOFPENETRATION', POLYGON: { '@path': 'L1,L3,L4', '@pitch': '0', '@orientation': '0', '@size': '4' } },
          ],
        },
        LINES: {
          LINE: [
            { '@id': 'L1', '@path': 'C5,C6', '@type': 'EAVE' },
            { '@id': 'L2', '@path': 'C9,C5', '@type': 'HIP' },
            { '@id': 'L3', '@path': 'C6,C7', '@type': 'RAKE' },
            { '@id': 'L4', '@path': 'C7,C8', '@type': 'RIDGE' },
            { '@id': 'L5', '@path': 'C8,C9', '@type': 'HIP' },
            { '@id': 'L6', '@path': 'C10,C5', '@type': 'EAVE' },
            { '@id': 'L7', '@path': 'C9,C12', '@type': 'RIDGE' },
            { '@id': 'L8', '@path': 'C11,C10', '@type': 'VALLEY' },
            { '@id': 'L9', '@path': 'C12,C11', '@type': 'HIP' },
          ],
        },
        POINTS: {
          POINT: [
            { '@id': 'C5', '@data': '-4.539516139,84.636574305,32.510583787' },
            { '@id': 'C6', '@data': '-4.539516139,55.791039151,32.510583787' },
            { '@id': 'C7', '@data': '4.742679207,55.791039151,36.378165182' },
            { '@id': 'C8', '@data': '4.742679207,68.770745074,36.378165182' },
            { '@id': 'C9', '@data': '8.034496150,72.062562016,37.749755574' },
            { '@id': 'C10', '@data': '12.443786881,84.636574305,32.510583787' },
            { '@id': 'C11', '@data': '25.155949933,72.432897774,37.595449009' },
            { '@id': 'C12', '@data': '24.785614175,72.062562016,37.749755574' },
          ],
        },
      },
    },
  },
};

describe('parseEagleViewMeasurementJson', () => {
  const res = parseEagleViewMeasurementJson(SAMPLE, ORIGIN_LAT, ORIGIN_LNG);

  it('parses only ROOF faces (skips ROOFPENETRATION)', () => {
    expect(res.roofFacetCount).toBe(2);
  });

  it('extracts pitch (5/12 -> ~22.6deg), azimuth, and area', () => {
    for (const f of res.facets) expect(f.pitchDegrees).toBeCloseTo(22.6, 1);
    expect(res.facets.map((f) => f.azimuthDegrees).sort((a, b) => a - b)).toEqual([60.2, 330.2]);
    const areas = res.facets.map((f) => f.areaSqM).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(21.8, 0); // 234.76 sqft
    expect(areas[1]).toBeCloseTo(23.7, 0); // 255.13 sqft
  });

  it('self-calibrates rotation consistent with the north orientation (~60.2)', () => {
    expect(res.calibrationRotationDeg).not.toBeNull();
    expect(res.calibrationRotationDeg!).toBeGreaterThan(55);
    expect(res.calibrationRotationDeg!).toBeLessThan(66);
  });

  it('reconstructs each facet as a closed lat/lng ring near the origin', () => {
    for (const f of res.facets) {
      expect(f.polygon.length).toBe(5);
      for (const p of f.polygon) {
        expect(Math.abs(p.lat - ORIGIN_LAT)).toBeLessThan(0.001);
        expect(Math.abs(p.lng - ORIGIN_LNG)).toBeLessThan(0.001);
      }
    }
  });
});
