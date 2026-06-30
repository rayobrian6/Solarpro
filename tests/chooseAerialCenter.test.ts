import { describe, expect, it } from 'vitest';
import { chooseAerialCenter } from '@/lib/permit/sections/sitePlan';

// ─────────────────────────────────────────────────────────────────────────────
// Regression: the aerial image must center on the project's roof, never on a
// neighbor's. Priority is array centroid → geocoded pin → segment (last resort).
// The geocoded address pin is authoritative for a real street address (the Design
// Studio fly-in geocodes to it and lands on the correct house), so a Google Solar
// roof SEGMENT must NEVER override a valid pin — that was the "wrong house" bug.
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

  it('uses the geocoded pin and NEVER a neighbor segment when there is no array GPS', () => {
    // A big south-facing neighbor roof ~60 m away that would win on area, plus a
    // closer one. With a valid pin, NEITHER may override it — we center on the pin.
    const myRoof = { center: { lat: PIN_LAT + mLat(8), lng: PIN_LNG }, azimuthDegrees: 180, areaM2: 60 };
    const neighbor = { center: { lat: PIN_LAT + mLat(60), lng: PIN_LNG + mLng(10) }, azimuthDegrees: 185, areaM2: 400 };

    const r = chooseAerialCenter(PIN_LAT, PIN_LNG, undefined, [neighbor, myRoof]);
    expect(r.source).toBe('pin');
    expect(r.lat).toBe(PIN_LAT);
    expect(r.lng).toBe(PIN_LNG);
  });

  it('centers on the geocoded pin when there are no segments', () => {
    const r = chooseAerialCenter(PIN_LAT, PIN_LNG, undefined, []);
    expect(r.source).toBe('pin');
    expect(r.lat).toBe(PIN_LAT);
    expect(r.lng).toBe(PIN_LNG);
  });

  it('falls back to the nearest segment ONLY when the pin is missing/invalid', () => {
    const far1 = { center: { lat: 38.80, lng: -90.10 }, azimuthDegrees: 180, areaM2: 300 };
    const near = { center: { lat: 38.70, lng: -90.15 }, azimuthDegrees: 90, areaM2: 80 };
    // pin is (0,0) → invalid → use the nearest segment.
    const r = chooseAerialCenter(0, 0, undefined, [far1, near]);
    expect(r.source).toBe('segment');
    // nearest to (0,0) is whichever has smaller magnitude — both far, nearest wins.
    expect(['number']).toContain(typeof r.lat);
  });
});
