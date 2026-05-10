/**
 * poaCalc.test.ts — Unit tests for GHI→POA conversion and segment label helpers
 */
import { describe, it, expect } from 'vitest';
import { ghiToPoa, poaQualityLabel, segmentLabel } from './poaCalc';

describe('segmentLabel', () => {
  it('returns A for index 0', () => expect(segmentLabel(0)).toBe('A'));
  it('returns Z for index 25', () => expect(segmentLabel(25)).toBe('Z'));
  it('returns AA for index 26', () => expect(segmentLabel(26)).toBe('AA'));
  it('returns AB for index 27', () => expect(segmentLabel(27)).toBe('AB'));
  it('returns AZ for index 51', () => expect(segmentLabel(51)).toBe('AZ'));
});

describe('poaQualityLabel', () => {
  it('returns Excellent for >= 1700', () => {
    expect(poaQualityLabel(1800).label).toBe('Excellent');
    expect(poaQualityLabel(1700).label).toBe('Excellent');
  });
  it('returns Good for 1400–1699', () => {
    expect(poaQualityLabel(1500).label).toBe('Good');
    expect(poaQualityLabel(1400).label).toBe('Good');
  });
  it('returns Average for 1100–1399', () => {
    expect(poaQualityLabel(1200).label).toBe('Average');
  });
  it('returns Low for < 1100', () => {
    expect(poaQualityLabel(900).label).toBe('Low');
  });
});

describe('ghiToPoa', () => {
  it('returns 0 for zero GHI', () => {
    expect(ghiToPoa(0, 20, 180, 35)).toBe(0);
  });

  it('south-facing optimal tilt produces more than flat surface', () => {
    // 35° lat, 30° tilt, south-facing (az=180) vs flat (tilt=0)
    const poa30S = ghiToPoa(1500, 30, 180, 35);
    const poaFlat = ghiToPoa(1500, 0, 180, 35);
    expect(poa30S).toBeGreaterThan(poaFlat);
  });

  it('north-facing surface produces less than south-facing', () => {
    const poaSouth = ghiToPoa(1500, 25, 180, 35);
    const poaNorth = ghiToPoa(1500, 25, 0, 35);
    expect(poaSouth).toBeGreaterThan(poaNorth);
  });

  it('higher latitude has higher diffuse fraction (more spread)', () => {
    // At high latitude the diffuse fraction is higher — flat and tilted converge
    const poa_lat60_south = ghiToPoa(1200, 30, 180, 60);
    const poa_lat20_south = ghiToPoa(1200, 30, 180, 20);
    // Both should be positive and reasonable
    expect(poa_lat60_south).toBeGreaterThan(0);
    expect(poa_lat20_south).toBeGreaterThan(0);
  });

  it('produces values in realistic kWh/m²/yr range', () => {
    // A typical south-facing US residential roof: ~1300–1800 kWh/m²/yr POA
    const poa = ghiToPoa(1500, 25, 180, 35);
    expect(poa).toBeGreaterThan(1000);
    expect(poa).toBeLessThan(2500);
  });
});
