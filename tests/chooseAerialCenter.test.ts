import { describe, expect, it } from 'vitest';
import { chooseAerialCenter } from '@/lib/permit/sections/sitePlan';

// ─────────────────────────────────────────────────────────────────────────────
// Regression: the aerial image must center on the project's roof, never on a
// neighbor's. When the design carries panel GPS we center on the array centroid;
// otherwise we pick a roof segment NEAR the address pin — not the largest
// south-facing roof in the vicinity (which can be the neighbor's bigger roof).
// ─────────────────────────────────────────────────────────────────────────────

const PIN_LAT = 38.7009;
const PIN_LNG = -90.1487;

// ~Meters → degrees offset helpers (rough, fine for test fixtures).
const mLat = (m: number) => m / 111320;
const mLng = (m: number) => m / (111320 * Math.cos(PIN_LAT * Math.PI / 180));

describe('chooseAerialCenter', () => {
  it('uses the array centroid when provided (most accurate)', () => {
    const arrayCenter = { lat: PIN_LAT + mLat(4), lng: PIN_LNG + mLng(2) };
    const r = chooseAerialCenter(PIN_LAT, PIN_LNG, arrayCenter, [
      { center: { lat: PIN_LAT + mLat(60), lng: PIN_LNG }, azimuthDegrees: 180, areaM2: 999 },
    ]);
    expect(r.source).toBe('array');
    expect(r.lat).toBeCloseTo(arrayCenter.lat, 7);
    expect(r.lng).toBeCloseTo(arrayCenter.lng, 7);
  });

  it('does NOT pick the neighbor\'s larger south-facing roof when no array GPS', () => {
    // This house: small-ish south roof, ~8 m from the pin.
    const myRoof = { center: { lat: PIN_LAT + mLat(8), lng: PIN_LNG }, azimuthDegrees: 180, areaM2: 60 };
    // Neighbor: much bigger south-facing roof, ~60 m away — would win on area.
    const neighbor = { center: { lat: PIN_LAT + mLat(60), lng: PIN_LNG + mLng(10) }, azimuthDegrees: 185, areaM2: 400 };

    const r = chooseAerialCenter(PIN_LAT, PIN_LNG, undefined, [neighbor, myRoof]);
    expect(r.source).toBe('segment');
    // Must be MY roof, not the neighbor's larger one.
    expect(r.lat).toBeCloseTo(myRoof.center.lat, 7);
    expect(r.lng).toBeCloseTo(myRoof.center.lng, 7);
  });

  it('prefers the largest south-facing roof AMONG on-parcel segments', () => {
    // Two segments both within ~25 m of the pin: a north face and a bigger south face.
    const northFace = { center: { lat: PIN_LAT + mLat(6), lng: PIN_LNG }, azimuthDegrees: 0, areaM2: 50 };
    const southFace = { center: { lat: PIN_LAT + mLat(10), lng: PIN_LNG + mLng(3) }, azimuthDegrees: 180, areaM2: 55 };
    const r = chooseAerialCenter(PIN_LAT, PIN_LNG, undefined, [northFace, southFace]);
    expect(r.source).toBe('segment');
    expect(r.lat).toBeCloseTo(southFace.center.lat, 7);
  });

  it('falls back to the nearest segment when none sit on-parcel', () => {
    const far1 = { center: { lat: PIN_LAT + mLat(120), lng: PIN_LNG }, azimuthDegrees: 180, areaM2: 300 };
    const far2 = { center: { lat: PIN_LAT + mLat(40), lng: PIN_LNG }, azimuthDegrees: 90, areaM2: 80 };
    const r = chooseAerialCenter(PIN_LAT, PIN_LNG, undefined, [far1, far2]);
    expect(r.source).toBe('segment');
    // 40 m is nearer than 120 m — nearest wins over largest.
    expect(r.lat).toBeCloseTo(far2.center.lat, 7);
  });

  it('falls back to the geocode pin when there are no usable segments', () => {
    const r = chooseAerialCenter(PIN_LAT, PIN_LNG, undefined, []);
    expect(r.source).toBe('pin');
    expect(r.lat).toBe(PIN_LAT);
    expect(r.lng).toBe(PIN_LNG);
  });
});
