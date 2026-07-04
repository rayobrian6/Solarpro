import { describe, it, expect } from 'vitest';
import { locateEquipment, snapToBuildingRing } from './equipmentLocator';

// 20m × 10m building at lat 38.7 (real-GPS frame)
const RING = [
  { lat: 38.70000, lng: -90.04600 },
  { lat: 38.70000, lng: -90.04577 },
  { lat: 38.70009, lng: -90.04577 },
  { lat: 38.70009, lng: -90.04600 },
];
const C = { lat: 38.700045, lng: -90.045885 };

describe('locateEquipment', () => {
  it('uses labeled survey photos with GPS first (snapped onto the wall)', () => {
    // Surveyor stood ~3 m SOUTH of the south wall shooting the meter — the
    // marker must land ON the wall (photo GPS = surveyor position, not meter).
    const photos = [
      { label: 'utility meter closeup', gps: { lat: 38.699973, lng: -90.045801 } },
      { label: 'main panel interior',   gps: { lat: 38.699975, lng: -90.045803 } },
    ];
    const out = locateEquipment(RING, { lat: 38.6998, lng: -90.04588 }, photos);
    const um = out.find(e => e.kind === 'utility_meter')!;
    const msp = out.find(e => e.kind === 'msp')!;
    expect(um.provenance).toBe('survey_photo_gps');
    // snapped to the south wall (lat 38.70000), lng preserved along the wall
    expect(Math.abs(um.lat - 38.70000) * 111320).toBeLessThan(0.5);
    expect(um.lng).toBeCloseTo(-90.045801, 7);
    expect(msp.provenance).toBe('survey_photo_gps');
    // disconnect had no photo — falls to the heuristic
    expect(out.find(e => e.kind === 'ac_disconnect')!.provenance).toBe('street_side_heuristic');
  });

  it('snapToBuildingRing: projects onto the nearest wall, keeps far fixes raw', () => {
    // 3 m south of the SW corner region → lands on the south wall
    const near = snapToBuildingRing({ lat: 38.699973, lng: -90.04590 }, RING);
    expect(Math.abs(near.lat - 38.70000) * 111320).toBeLessThan(0.5);
    // 100+ m away (stale/cached fix) → returned unchanged
    const far = snapToBuildingRing({ lat: 38.6990, lng: -90.04590 }, RING);
    expect(far.lat).toBeCloseTo(38.6990, 9);
    // degenerate ring → unchanged
    const deg = snapToBuildingRing({ lat: 38.7, lng: -90.046 }, []);
    expect(deg.lat).toBeCloseTo(38.7, 9);
  });

  it('street to the SOUTH places equipment on the south wall', () => {
    const out = locateEquipment(RING, { lat: 38.6998, lng: C.lng }, []);
    expect(out).toHaveLength(3);
    for (const eq of out) {
      expect(eq.provenance).toBe('street_side_heuristic');
      // south wall lat ≈ 38.70000 (within a couple meters)
      expect(Math.abs(eq.lat - 38.70000) * 111320).toBeLessThan(2.5);
      // within the wall extents (lng between corners)
      expect(eq.lng).toBeGreaterThan(-90.04601);
      expect(eq.lng).toBeLessThan(-90.04576);
    }
  });

  it('street to the EAST places equipment on the east wall', () => {
    const out = locateEquipment(RING, { lat: C.lat, lng: -90.0455 }, []);
    for (const eq of out) {
      expect(Math.abs(eq.lng - (-90.04577)) * 111320 * Math.cos(38.7 * Math.PI / 180)).toBeLessThan(2.5);
    }
  });

  it('meter / MSP / disconnect are distinct points near each other', () => {
    const out = locateEquipment(RING, { lat: 38.6998, lng: C.lng }, []);
    const [a, b, c] = out;
    const dM = (p: any, q: any) => Math.hypot((p.lat - q.lat) * 111320, (p.lng - q.lng) * 86870);
    expect(dM(a, b)).toBeGreaterThan(0.5);
    expect(dM(a, b)).toBeLessThan(4);
    expect(dM(a, c)).toBeGreaterThan(0.5);
    expect(dM(a, c)).toBeLessThan(4);
  });

  it('no street pin → defaults to the south wall; degenerate ring → empty', () => {
    const out = locateEquipment(RING, null, []);
    expect(out).toHaveLength(3);
    expect(Math.abs(out[0].lat - 38.70000) * 111320).toBeLessThan(2.5);
    expect(locateEquipment([], null, [])).toEqual([]);
  });
});
