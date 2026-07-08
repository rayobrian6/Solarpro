import { describe, it, expect } from 'vitest';
import {
  pointToSegmentM, polygonEdgeLengthsFt, minSetbackFt, projectToLocalM,
  buildSiteContextInset, isPermitRenderable, type LatLng, type SiteContextFeature,
} from './siteContext';
import { latLngToXY } from '@/lib/cad/geometry';

// A representative rectangular parcel (~lat 40) with an inner building.
const ORIGIN: LatLng = { lat: 40, lng: -88 };
const PARCEL: LatLng[] = [
  { lat: 40.0000, lng: -88.0000 },
  { lat: 40.0000, lng: -87.9996 },
  { lat: 40.0004, lng: -87.9996 },
  { lat: 40.0004, lng: -88.0000 },
];
const BUILDING: LatLng[] = [
  { lat: 40.00015, lng: -87.99985 },
  { lat: 40.00015, lng: -87.99975 },
  { lat: 40.00025, lng: -87.99975 },
  { lat: 40.00025, lng: -87.99985 },
];
const PANELS: LatLng[] = [
  { lat: 40.00018, lng: -87.99982 }, { lat: 40.00018, lng: -87.99978 },
  { lat: 40.00022, lng: -87.99982 }, { lat: 40.00022, lng: -87.99978 },
];

describe('siteContext geometry', () => {
  it('pointToSegmentM is exact', () => {
    expect(pointToSegmentM({ x: 0, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5, 6);
    expect(pointToSegmentM({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5, 6); // past endpoint
  });

  it('coordinate alignment: 0.001° north ≈ 111.3 m; building projects inside parcel bbox', () => {
    const p = latLngToXY(40.001, -88, 40, -88);
    expect(p.y).toBeGreaterThan(111.0 * 1);   // metres
    expect(p.y).toBeLessThan(111.6 * 1);
    const par = projectToLocalM(PARCEL, ORIGIN);
    const bld = projectToLocalM(BUILDING, ORIGIN);
    const minX = Math.min(...par.map(q => q.x)), maxX = Math.max(...par.map(q => q.x));
    const minY = Math.min(...par.map(q => q.y)), maxY = Math.max(...par.map(q => q.y));
    for (const q of bld) {
      expect(q.x).toBeGreaterThanOrEqual(minX); expect(q.x).toBeLessThanOrEqual(maxX);
      expect(q.y).toBeGreaterThanOrEqual(minY); expect(q.y).toBeLessThanOrEqual(maxY);
    }
  });

  it('polygon edge lengths in feet are sane for the parcel', () => {
    const lens = polygonEdgeLengthsFt(PARCEL);
    expect(lens).toHaveLength(4);
    // 0.0004° lat ≈ 44.5 m ≈ 146 ft; 0.0004° lng at lat40 ≈ 34 m ≈ 112 ft
    expect(lens.some(l => l > 130 && l < 165)).toBe(true);
    expect(lens.some(l => l > 95 && l < 130)).toBe(true);
  });

  it('property-line setback: building further inside gives a larger setback than closer', () => {
    const sbCentered = minSetbackFt(BUILDING, PARCEL, PARCEL[0])!;
    const closer = BUILDING.map(v => ({ lat: v.lat, lng: v.lng - 0.00005 })); // shift toward west edge
    const sbCloser = minSetbackFt(closer, PARCEL, PARCEL[0])!;
    expect(sbCentered).toBeGreaterThan(0);
    expect(sbCloser).toBeLessThan(sbCentered);
    // approximate absolute check: centered building sits several feet off the line
    expect(sbCentered).toBeGreaterThan(5);
    expect(sbCentered).toBeLessThan(60);
  });

  it('minSetbackFt returns null with no subject or too-small parcel', () => {
    expect(minSetbackFt([], PARCEL, PARCEL[0])).toBeNull();
    expect(minSetbackFt(BUILDING, [{ lat: 40, lng: -88 }], PARCEL[0])).toBeNull();
  });
});

describe('buildSiteContextInset', () => {
  const box = { x: 0, y: 0, w: 270, h: 268 };
  const baseInput = { roofPlaneVertices: BUILDING, panelCenters: PANELS, streetName: 'MAPLE ST', streetPin: { lat: 39.9998, lng: -87.9998 } as LatLng, equipment: [] };

  it('NO-PARCEL FALLBACK: returns empty string when no parcel boundary', () => {
    expect(buildSiteContextInset({ ...baseInput, parcel: null }, box)).toBe('');
    expect(buildSiteContextInset({ ...baseInput, parcel: { polygon: [] } }, box)).toBe('');
  });

  it('renders parcel with APPROXIMATE / COUNTY GIS labeling', () => {
    const svg = buildSiteContextInset({ ...baseInput, parcel: { polygon: PARCEL, apn: '12-34-567', source: 'Test County GIS' } }, box);
    expect(svg).toContain('<g class="site-context-inset">');
    expect(svg).toContain('APPROXIMATE');
    expect(svg).toContain('COUNTY GIS');
    expect(svg).toContain('BASED ON COUNTY GIS');   // setback provenance
    expect(svg).toContain('12-34-567');             // APN
    expect(svg).toContain('MAPLE ST');              // street name (label only)
  });

  it('NO FABRICATION: no driveway/sidewalk/curb/road/right-of-way/easement rendered without real geometry', () => {
    const svg = buildSiteContextInset({ ...baseInput, parcel: { polygon: PARCEL }, features: [] }, box);
    expect(svg).not.toContain('data-feature');
    for (const w of ['driveway', 'sidewalk', 'curb', 'road', 'right-of-way', 'right of way', 'easement']) {
      expect(svg.toLowerCase()).not.toContain(w);
    }
  });

  it('review_required feature is OMITTED from the permit; only approved+renderable draws', () => {
    const mk = (reviewState: SiteContextFeature['reviewState'], permitRenderable: boolean): SiteContextFeature => ({
      id: 'f1', kind: 'driveway', geometryType: 'polygon',
      geometryWgs84: [{ lat: 40.0001, lng: -87.9999 }, { lat: 40.0001, lng: -87.9998 }, { lat: 40.0002, lng: -87.9998 }],
      provider: 'operator_trace', capturedAt: null, confidence: 0.9,
      measurementBasis: 'manually_traced', reviewState, operatorAdjusted: false,
      renderPolicy: { permitRenderable },
    });
    expect(isPermitRenderable(mk('review_required', true))).toBe(false);
    expect(isPermitRenderable(mk('approved', false))).toBe(false);
    expect(isPermitRenderable(mk('approved', true))).toBe(true);

    const omitted = buildSiteContextInset({ ...baseInput, parcel: { polygon: PARCEL }, features: [mk('review_required', true)] }, box);
    expect(omitted).not.toContain('data-feature');

    const drawn = buildSiteContextInset({ ...baseInput, parcel: { polygon: PARCEL }, features: [mk('approved', true)] }, box);
    expect(drawn).toContain('data-feature="driveway"');
  });
});
