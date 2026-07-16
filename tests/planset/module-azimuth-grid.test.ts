// PV-1 module-rotation regularizer — snap draw azimuths to the building grid.
import { describe, it, expect } from 'vitest';
import {
  computeModuleAzimuthGrid,
  snapModuleAzimuth,
  AZ_SNAP_TOL,
} from '@/lib/permit/utils/moduleAzimuthGrid';

describe('computeModuleAzimuthGrid', () => {
  it('collapses a near-square building to a cardinal grid (offset 0)', () => {
    // Melvin: 4 hip planes with ~3° trace noise, 22/22/4/4 modules.
    const azs = [
      ...Array(22).fill(3.2), ...Array(22).fill(180.1),
      ...Array(4).fill(273.2), ...Array(4).fill(89.4),
    ];
    expect(computeModuleAzimuthGrid(azs)).toBe(0);
  });

  it('preserves a genuinely rotated building', () => {
    const azs = [...Array(10).fill(20), ...Array(10).fill(200)];
    const off = computeModuleAzimuthGrid(azs)!;
    expect(off).toBeCloseTo(20, 1);
  });

  it('returns null with too few modules', () => {
    expect(computeModuleAzimuthGrid([180, 180])).toBeNull();
    expect(computeModuleAzimuthGrid([])).toBeNull();
  });

  it('ignores non-finite azimuths', () => {
    const azs = [NaN, 3.2, 3.2, 180.1, 180.1, Infinity];
    expect(computeModuleAzimuthGrid(azs)).toBe(0);
  });
});

describe('snapModuleAzimuth', () => {
  it('snaps noisy near-cardinal azimuths onto the sheet axes', () => {
    expect(snapModuleAzimuth(3.2, 0)).toBe(0);
    expect(snapModuleAzimuth(180.1, 0)).toBe(180);
    expect(snapModuleAzimuth(273.2, 0)).toBe(270);
    expect(snapModuleAzimuth(89.4, 0)).toBe(90);
  });

  it('makes opposite slopes exactly antiparallel', () => {
    const n = snapModuleAzimuth(3.2, 0);   // 0
    const s = snapModuleAzimuth(180.1, 0); // 180
    expect(Math.abs(s - n)).toBe(180);
  });

  it('leaves a genuinely off-grid array untouched (beyond snap tolerance)', () => {
    // 45° hip array on a cardinal building: 45 is >AZ_SNAP_TOL from 0/90.
    expect(45 - 0).toBeGreaterThan(AZ_SNAP_TOL);
    expect(snapModuleAzimuth(45, 0)).toBe(45);
  });

  it('snaps within a rotated grid', () => {
    expect(snapModuleAzimuth(21.5, 20)).toBe(20);
    expect(snapModuleAzimuth(199, 20)).toBe(200);
  });

  it('is a no-op when the grid is indeterminate', () => {
    expect(snapModuleAzimuth(3.2, null)).toBe(3.2);
  });
});
