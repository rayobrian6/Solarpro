// Edge-snap registration (PV-1 Google-fallback design→imagery alignment).
// Synthetic imagery: a high-contrast "roof" rectangle drawn at a known pixel
// offset from where the design planes project — the snap must recover that
// offset (within a grid step) and must fail OPEN (null) on low-signal frames.
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { computeAerialEdgeSnap, applyAerialEdgeSnapRegistration } from '@/lib/permit/utils/aerialEdgeSnap';
import { lngToGlobalPx, latToGlobalPx } from '@/lib/aerial/nearmap';

const C_LAT = 38.7061, C_LNG = -90.0462, ZOOM = 20, IMG_W = 640, IMG_H = 360;
const MPP = (156543.03392 / Math.pow(2, ZOOM)) * Math.cos(C_LAT * Math.PI / 180);

// Invert the projection: logical px (relative to frame center) → lat/lng.
function pxToLL(x: number, y: number): { lat: number; lng: number } {
  const EPS = 1e-4;
  const pxPerDegLng = (lngToGlobalPx(C_LNG + EPS, ZOOM) - lngToGlobalPx(C_LNG, ZOOM)) / EPS;
  const pxPerDegLat = (latToGlobalPx(C_LAT + EPS, ZOOM) - latToGlobalPx(C_LAT, ZOOM)) / EPS;
  return { lat: C_LAT + (y - IMG_H / 2) / pxPerDegLat, lng: C_LNG + (x - IMG_W / 2) / pxPerDegLng };
}

// Design plane = rectangle centered in the frame, in logical px coords.
const RECT = { x0: 270, y0: 130, x1: 370, y1: 230 };
const designPlanes = [{
  vertices: [
    pxToLL(RECT.x0, RECT.y0), pxToLL(RECT.x1, RECT.y0),
    pxToLL(RECT.x1, RECT.y1), pxToLL(RECT.x0, RECT.y1),
  ],
}];

// Bitmap at scale 2 (like Google Static Maps scale=2), roof drawn offset by
// (dxPx, dyPx) LOGICAL px from the design rectangle.
async function syntheticAerial(dxPx: number, dyPx: number): Promise<string> {
  const S = 2;
  const svg = `<svg width="${IMG_W * S}" height="${IMG_H * S}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#7a9a5a"/>
    <rect x="${(RECT.x0 + dxPx) * S}" y="${(RECT.y0 + dyPx) * S}"
          width="${(RECT.x1 - RECT.x0) * S}" height="${(RECT.y1 - RECT.y0) * S}" fill="#3c3c40"/>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

function aerialFor(b64: string) {
  return { imageBase64: b64, imageWidth: IMG_W, imageHeight: IMG_H, lat: C_LAT, lng: C_LNG, zoom: ZOOM };
}

describe('computeAerialEdgeSnap', () => {
  it('recovers a known ~1.5 m offset within a grid step', async () => {
    const dx = 8, dy = -10; // logical px ≈ 0.93 m E, 1.17 m N
    const res = await computeAerialEdgeSnap(aerialFor(await syntheticAerial(dx, dy)), designPlanes);
    expect(res).not.toBeNull();
    // Convert returned degree shift back to px and compare.
    const EPS = 1e-4;
    const pxPerDegLng = (lngToGlobalPx(C_LNG + EPS, ZOOM) - lngToGlobalPx(C_LNG, ZOOM)) / EPS;
    const pxPerDegLat = (latToGlobalPx(C_LAT + EPS, ZOOM) - latToGlobalPx(C_LAT, ZOOM)) / EPS;
    expect(res!.dLng * pxPerDegLng).toBeCloseTo(dx, 0);
    expect(res!.dLat * pxPerDegLat).toBeCloseTo(dy, 0);
    expect(res!.shiftM).toBeGreaterThan(0.8);
    expect(res!.shiftM).toBeLessThan(2.2);
  });

  it('returns ~zero shift when already aligned (stays put)', async () => {
    const res = await computeAerialEdgeSnap(aerialFor(await syntheticAerial(0, 0)), designPlanes);
    // Aligned trace: either no confident improvement (null) or a sub-step nudge.
    if (res) expect(res.shiftM).toBeLessThan(2 * MPP);
  });

  it('fails open (null) on a featureless frame', async () => {
    const svg = `<svg width="${IMG_W * 2}" height="${IMG_H * 2}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#7a9a5a"/></svg>`;
    const b64 = 'data:image/png;base64,' + (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
    expect(await computeAerialEdgeSnap(aerialFor(b64), designPlanes)).toBeNull();
  });

  it('fails open (null) when the offset exceeds the search radius (neighbor roof)', async () => {
    // 14 m ≈ the measured Melvin Solar-API wrong-building offset.
    const res = await computeAerialEdgeSnap(aerialFor(await syntheticAerial(0, 14 / MPP)), designPlanes);
    expect(res).toBeNull();
  });

  it('fails open (null) with no usable design vertices or image', async () => {
    expect(await computeAerialEdgeSnap(aerialFor(await syntheticAerial(5, 5)), [])).toBeNull();
    expect(await computeAerialEdgeSnap({ ...aerialFor(''), imageBase64: undefined }, designPlanes)).toBeNull();
  });
});

describe('applyAerialEdgeSnapRegistration (route pre-pass policy)', () => {
  it('sets registrationShift only on the google path with no subject polygons', async () => {
    const b64 = await syntheticAerial(8, -10);
    const mk = (over: Record<string, unknown>) => ({
      aerialData: { ...aerialFor(b64), imageSource: 'google', ...over },
      project: { roofPlanes: designPlanes },
    }) as never;

    const googleInput = mk({});
    await applyAerialEdgeSnapRegistration(googleInput);
    expect((googleInput as { aerialData: { registrationShift?: unknown } }).aerialData.registrationShift).toBeTruthy();

    const nearmapInput = mk({ imageSource: 'nearmap' });
    await applyAerialEdgeSnapRegistration(nearmapInput);
    expect((nearmapInput as { aerialData: { registrationShift?: unknown } }).aerialData.registrationShift).toBeUndefined();

    const withPolys = mk({ subjectRoofPolygons: [[{ lat: C_LAT, lng: C_LNG }]] });
    await applyAerialEdgeSnapRegistration(withPolys);
    expect((withPolys as { aerialData: { registrationShift?: unknown } }).aerialData.registrationShift).toBeUndefined();
  });

  it('clears a stale persisted shift when recompute is unconfident', async () => {
    const svg = `<svg width="${IMG_W * 2}" height="${IMG_H * 2}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#7a9a5a"/></svg>`;
    const b64 = 'data:image/png;base64,' + (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
    const input = {
      aerialData: { ...aerialFor(b64), imageSource: 'google', registrationShift: { dLat: 1, dLng: 1 } },
      project: { roofPlanes: designPlanes },
    } as never;
    await applyAerialEdgeSnapRegistration(input);
    expect((input as { aerialData: { registrationShift?: unknown } }).aerialData.registrationShift).toBeUndefined();
  });
});
