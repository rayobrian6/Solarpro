import { describe, it, expect } from 'vitest';
import {
  buildStructuralInputV4,
  runSubSystemStructural,
  GROUND_DEFAULT_MOUNTING_ID,
} from '../../app/api/engineering/calculate/subSystemStructural';

// Hybrid multi-system: /api/engineering/calculate must analyze EACH sub-system
// (roof rafters, ground piles, fence posts) when the client partitions the
// project via structural.subSystems[], instead of sizing one 94-module fence.
// The route delegates to the pure helpers tested here (no Next request mocking
// needed): buildStructuralInputV4 is the exact legacy payload mapping (shared
// by the whole-project run) and runSubSystemStructural produces the additive
// structural.subSystems / structural.subSystemMeta response keys.

const DEFAULTS = { windSpeed: 115, groundSnowLoad: 30 };

/** Stowell-shaped hybrid: 51 roof + 26 ground + 17 fence, fence run 63 ft. */
const hybridStructuralPayload = () => ({
  installationType: 'fence',          // legacy field the page sends today (whole-project)
  panelCount: 94,                     // whole project — legacy run only
  windSpeed: 115,
  windExposure: 'C',
  groundSnowLoad: 30,
  meanRoofHeight: 15,
  roofPitch: 22,
  // Rafter fields → describe the ROOF sub-system
  framingType: 'rafter',
  rafterSize: '2x8',
  rafterSpacing: 16,
  rafterSpan: 14,
  rafterSpecies: 'Douglas Fir-Larch',
  // Shared module dims
  panelLength: 74.4,
  panelWidth: 41.1,
  panelWeight: 48.5,
  panelOrientation: 'portrait',
  mountingSystem: 'ironridge-xr100',  // roof mounting (ground run must NOT use it)
  // Fence geometry (project-level)
  fenceHeightFt: 6,
  postSpacingFt: 8,
  subSystems: [
    { key: 'roof',   panelCount: 51 },
    { key: 'ground', panelCount: 26, groundTiltDeg: 30, groundAzimuth: 180 },
    { key: 'fence',  panelCount: 17, fenceLengthFt: 63 },
  ],
});

describe('engineering /calculate — hybrid per-sub-system structural', () => {
  it('runs one V4 analysis per subSystems entry, keyed roof/ground/fence', () => {
    const out = runSubSystemStructural(hybridStructuralPayload(), DEFAULTS);
    expect(out).not.toBeNull();
    expect(Object.keys(out!.subSystems).sort()).toEqual(['fence', 'ground', 'roof']);
    expect(out!.subSystemMeta).toEqual({
      partitioned: true,
      counts: { roof: 51, ground: 26, fence: 17 },
    });
  });

  it('roof entry → roof_residential run scoped to 51 panels, with rafter + mount analysis', () => {
    const out = runSubSystemStructural(hybridStructuralPayload(), DEFAULTS)!;
    const roof: any = out.subSystems.roof;
    expect(roof).toBeDefined();
    expect(roof.installationType).toBe('roof_residential');
    expect(roof.arrayGeometry.totalPanels).toBe(51);
    // Real rafter analysis from the shared rafter fields (not the fence N/A stub)
    expect(roof.rafterAnalysis).toBeDefined();
    expect(roof.rafterAnalysis.size).toBe('2x8');
    expect(roof.rafterAnalysis.spanFt).toBe(14);
    expect(roof.rafterAnalysis.spacingIn).toBe(16);
    // Mount layout computed for the roof subset
    expect(roof.mountLayout).toBeDefined();
    expect(roof.mountLayout.mountCount).toBeGreaterThan(0);
    expect(roof.mountLayout.mountSpacingIn).toBeGreaterThan(0);
    expect(roof.fenceMountAnalysis).toBeUndefined();
  });

  it('ground entry → ground_mount run on a ground-capable mounting default, with pile analysis', () => {
    const out = runSubSystemStructural(hybridStructuralPayload(), DEFAULTS)!;
    const ground: any = out.subSystems.ground;
    expect(ground).toBeDefined();
    expect(ground.installationType).toBe('ground_mount');
    expect(ground.arrayGeometry.totalPanels).toBe(26);
    // Roof mounting id (ironridge-xr100) must be swapped for the ground default —
    // the V4 pile branch only activates on a ground-type mounting system.
    expect(ground.mountingSystem.id).toBe(GROUND_DEFAULT_MOUNTING_ID);
    expect(ground.groundMountAnalysis).toBeDefined();
    expect(ground.groundMountAnalysis.pileCount).toBeGreaterThan(0);
    expect(ground.fenceMountAnalysis).toBeUndefined();
  });

  it('fence entry → fence run scoped to the SUBSET length: 63 ft → 8 sections / 9 posts / 17 panels', () => {
    const out = runSubSystemStructural(hybridStructuralPayload(), DEFAULTS)!;
    const fence: any = out.subSystems.fence;
    expect(fence).toBeDefined();
    expect(fence.installationType).toBe('fence');
    expect(fence.fenceMountAnalysis).toBeDefined();
    expect(fence.fenceMountAnalysis.sectionCount).toBe(Math.ceil(63 / 8)); // = 8
    expect(fence.fenceMountAnalysis.sectionCount).toBe(8);
    expect(fence.fenceMountAnalysis.postCount).toBe(9);
    expect(fence.arrayGeometry.totalPanels).toBe(17);
  });

  it('fence length falls back to panelCount × module width when no length is sent', () => {
    const payload: any = hybridStructuralPayload();
    delete payload.fenceLengthFt;
    payload.subSystems = [{ key: 'fence', panelCount: 17 }]; // no fenceLengthFt anywhere
    const out = runSubSystemStructural(payload, DEFAULTS)!;
    const fence: any = out.subSystems.fence;
    // 17 × (41.1/12) ≈ 58.2 ft → ceil(58.2/8) = 8 sections
    expect(fence.fenceMountAnalysis.sectionCount).toBe(8);
    expect(fence.fenceMountAnalysis.postCount).toBe(9);
  });

  it('legacy payload (no subSystems) → null, so the response gains NO new keys', () => {
    const payload: any = hybridStructuralPayload();
    delete payload.subSystems;
    expect(runSubSystemStructural(payload, DEFAULTS)).toBeNull();
    // Empty / invalid partitions are also legacy
    expect(runSubSystemStructural({ ...payload, subSystems: [] }, DEFAULTS)).toBeNull();
    expect(
      runSubSystemStructural(
        { ...payload, subSystems: [{ key: 'carport', panelCount: 5 }, { key: 'roof', panelCount: 0 }] },
        DEFAULTS,
      ),
    ).toBeNull();
  });

  it('buildStructuralInputV4 preserves the exact legacy mapping (field aliases + defaults)', () => {
    // Alias fields (rafterSpacing/rafterSpan/panelLength/…) — as the page sends them
    const input = buildStructuralInputV4(hybridStructuralPayload(), DEFAULTS);
    expect(input).toMatchObject({
      installationType: 'fence',       // legacy whole-project type passes through untouched
      panelCount: 94,
      windSpeed: 115,
      windExposure: 'C',
      groundSnowLoad: 30,
      roofPitch: 22,
      framingType: 'rafter',
      rafterSize: '2x8',
      rafterSpacingIn: 16,
      rafterSpanFt: 14,
      panelLengthIn: 74.4,
      panelWidthIn: 41.1,
      panelWeightLbs: 48.5,
      mountingSystemId: 'ironridge-xr100',
      fenceHeightFt: 6,
      postSpacingFt: 8,
    });
    // Empty payload → the route's historical defaults
    const bare = buildStructuralInputV4({}, DEFAULTS);
    expect(bare).toMatchObject({
      installationType: 'roof_residential',
      windSpeed: 115,                  // jurisdiction default flows through
      groundSnowLoad: 30,
      panelCount: 24,
      rafterSize: '2x6',
      rafterSpacingIn: 24,
      rafterSpanFt: 16,
      panelLengthIn: 73.0,
      panelWidthIn: 41.0,
      mountingSystemId: 'ironridge-xr100',
      roofDeadLoadPsf: 15,
    });
  });

  it('duplicate keys: first entry wins (no double-run, counts stay sane)', () => {
    const payload: any = hybridStructuralPayload();
    payload.subSystems = [
      { key: 'fence', panelCount: 17, fenceLengthFt: 63 },
      { key: 'fence', panelCount: 99, fenceLengthFt: 800 },
    ];
    const out = runSubSystemStructural(payload, DEFAULTS)!;
    expect(out.subSystemMeta.counts).toEqual({ fence: 17 });
    expect((out.subSystems.fence as any).fenceMountAnalysis.sectionCount).toBe(8);
  });
});
