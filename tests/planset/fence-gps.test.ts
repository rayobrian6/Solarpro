import { describe, it, expect } from 'vitest';
import { fenceCAD } from '../../lib/cad/fence/fenceCAD';

// V0 verification findings (Stowell 4d720c49, 2026-07-11): fenceCAD never read
// the real designed panel positions. With layout.fenceSegments empty (fence_line
// NULL in the DB) it fabricated ONE schematic segment at lat 0/0, azimuth 90
// HARDCODED, panelCount = system.totalPanels — the user's REAL fence (17 panels
// in a ~57 ft east-west line at lat ~38.7353, panels facing south/az 180) was
// ignored, so the fence structural sheet + PE letter got synthetic geometry.
//
// GPS-first contract: when input.project.panelPositions carries ≥1 valid GPS
// panel (already scoped to fence panels by the hybrid engine), segments are
// built from the REAL positions (principal axis per arrayId/layoutId group);
// the schematic path only survives when there is NO GPS data at all.

// ~1.07 m of longitude at lat 38.7353 (matches Stowell module pitch)
const LAT0 = 38.7353;
const LNG0 = -90.2246;
const DLNG = 0.0000123;

function stowellFencePanels(count = 17, arrayId = 'fence-seg0-1752200000000') {
  return Array.from({ length: count }, (_, i) => ({
    id:          `fence-p${i}`,
    lat:         LAT0 + (i % 2 === 0 ? 0.000002 : -0.000002), // GPS jitter
    lng:         LNG0 + i * DLNG,
    azimuth:     180,
    orientation: 'portrait',
    arrayId,
    systemType:  'fence',
  }));
}

function mkInput(panelPositions: any[] | undefined, totalPanels: number) {
  return {
    project: {
      projectName:   'Stowell-Fence-GPS',
      systemType:    'solar_fence',
      panelLengthIn: 66,
      panelWidthIn:  40,
      panelPositions,
    },
    system: {
      totalDcKw:   totalPanels * 0.4,
      totalAcKw:   totalPanels * 0.35,
      totalPanels,
    },
    layout: {
      type: 'solar_fence',
      // fence_line NULL in the DB → no fenceSegments (the Stowell condition)
    },
  } as any;
}

describe('fenceCAD GPS-first path (real designed panel positions)', () => {
  it('builds ONE real segment from 17 GPS panels on an east-west line', () => {
    const panels = stowellFencePanels();
    const cad: any = fenceCAD(mkInput(panels, 17));

    expect(cad.systemType).toBe('solar_fence');
    expect(cad.fence.segments.length).toBe(1);

    const seg = cad.fence.segments[0];
    // Real design count — NOT a schematic fill
    expect(seg.panelCount).toBe(17);
    expect(seg.panels.length).toBe(17);
    expect(cad.fence.totalPanels).toBe(17);
    expect(cad.totalPanels).toBe(17);

    // Real length: 16 gaps × ~1.07 m + 1 panel width ≈ 18.1 m (~57-62 ft)
    expect(seg.lengthM).toBeGreaterThan(16);
    expect(seg.lengthM).toBeLessThan(20);
    const lengthFt = cad.fence.totalLengthM * 3.28084;
    expect(lengthFt).toBeGreaterThan(52);
    expect(lengthFt).toBeLessThan(66);

    // Azimuth from the DESIGN (panels face south), not the hardcoded 90
    const azErr = Math.abs(((seg.azimuth - 180) % 360 + 540) % 360 - 180);
    expect(azErr).toBeLessThanOrEqual(5);

    // Model origin = centroid of the real panels (not lat 0/0)
    expect(cad.originLat).toBeCloseTo(LAT0, 4);
    expect(cad.originLng).toBeCloseTo(LNG0 + 8 * DLNG, 4);

    // Real panel ids survive (design is authoritative, no synthetic renames)
    expect(seg.panels.map((p: any) => p.id)).toContain('fence-p0');
    expect(seg.panels.map((p: any) => p.id)).toContain('fence-p16');

    // Local geometry is consistent: endpoints span the segment length
    const dx = seg.endX - seg.startX, dy = seg.endY - seg.startY;
    expect(Math.hypot(dx, dy)).toBeCloseTo(seg.lengthM, 1);

    // Posts derived from the REAL length at default 8 ft spacing
    expect(seg.posts.length).toBe(Math.ceil(seg.lengthM / (8 * 0.3048)) + 1);
  });

  it('groups panels by arrayId/layoutId into one segment per group', () => {
    const groupA = stowellFencePanels(5, 'fence-seg0-1752200000000');
    const groupB = stowellFencePanels(7, 'fence-seg1-1752200000000').map(p => ({
      ...p,
      id:  `b-${p.id}`,
      lat: p.lat + 0.0005, // ~55 m north — a physically separate fence run
    }));
    const cad: any = fenceCAD(mkInput([...groupA, ...groupB], 12));

    expect(cad.fence.segments.length).toBe(2);
    const counts = cad.fence.segments
      .map((s: any) => s.panelCount)
      .sort((a: number, b: number) => a - b);
    expect(counts).toEqual([5, 7]);
    expect(cad.totalPanels).toBe(12);
  });

  it('keeps the legacy schematic fallback when there is NO GPS data at all', () => {
    const cad: any = fenceCAD(mkInput(undefined, 10));

    // Unchanged legacy behavior: one schematic segment, count from system
    expect(cad.fence.segments.length).toBe(1);
    expect(cad.fence.segments[0].id).toBe('schematic');
    expect(cad.fence.segments[0].panelCount).toBe(10);
    expect(cad.totalPanels).toBe(10);
    expect(cad.warnings.some((w: string) => w.includes('schematic'))).toBe(true);
  });
});
