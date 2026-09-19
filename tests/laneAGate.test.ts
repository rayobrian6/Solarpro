/**
 * tests/laneAGate.test.ts
 *
 * LANE A — zero-click roof detection from Google Solar coverage.
 *
 * Lane A turns an address with Google Solar coverage into roof planes with no
 * tracing clicks. The pipeline for that already existed and was reachable from
 * exactly one place: the `eligiblePlanes.length === 0` branch of handleAutoRoof,
 * i.e. only after the user pressed Auto Fill. The missing piece was a TRIGGER,
 * and a trigger is only safe if it refuses in every state where running would
 * damage the user's work.
 *
 * This file pins the refusal matrix. `shouldRunLaneA` is pure, so the whole
 * thing is provable with no Cesium, no viewer, no terrain, no network and no
 * Google key — which matters because none of those are available in CI or on
 * the dev machine.
 *
 * THE TWO REFUSALS THAT EXIST BECAUSE OF REAL INCIDENTS
 * ----------------------------------------------------
 *  • `existingPlaneCount !== 0` — detected planes are merged by id, so running
 *    against a design that already has geometry would append a machine's guess
 *    next to a person's traced roof and the autosave would persist it. Lane A
 *    is a STARTING SHAPE for an empty design, never a replacement.
 *  • `restoreResolved` — detection lands in React state immediately, while the
 *    autosave mount-fence only blocks the WRITE. Detect before the DB restore
 *    resolves and the detected planes are already in state when the fence
 *    opens, so the first autosave tick persists them over the stored roof.
 *    Gating the detection itself is the only thing that actually prevents it.
 */

import { describe, it, expect } from 'vitest';
import { shouldRunLaneA, laneASiteKey, type LaneAGateInput } from '@/components/3d/SolarEngine3D';

/** The one state in which Lane A is allowed to run. */
const READY: LaneAGateInput = {
  stage: 'done',
  groundElevResolved: true,
  segmentCount: 4,
  existingPlaneCount: 0,
  restoreResolved: true,
  siteKey: '38.80000,-89.50000',
  lastRanSiteKey: null,
};

describe('shouldRunLaneA — the one state that runs', () => {
  it('runs on a covered address with an empty design after the restore resolved', () => {
    expect(shouldRunLaneA(READY)).toBe(true);
  });
});

describe('shouldRunLaneA — every refusal', () => {
  it('refuses until the scene is done loading', () => {
    for (const stage of ['idle', 'cesium', 'viewer', 'tiles', 'solar', 'error'] as const) {
      expect(shouldRunLaneA({ ...READY, stage })).toBe(false);
    }
  });

  it('refuses until ground elevation has resolved', () => {
    // segmentToRoofPlane3D builds every face at groundElevM + heightAboveGround.
    // Firing early puts the whole roof at elevation 0 — under the terrain.
    expect(shouldRunLaneA({ ...READY, groundElevResolved: false })).toBe(false);
  });

  it('refuses when Google Solar has no coverage here', () => {
    expect(shouldRunLaneA({ ...READY, segmentCount: 0 })).toBe(false);
  });

  it('refuses when the design ALREADY has roof geometry', () => {
    // The critical one. A traced face, a restored face, or an earlier detection
    // all count — Lane A must never run alongside existing work.
    expect(shouldRunLaneA({ ...READY, existingPlaneCount: 1 })).toBe(false);
    expect(shouldRunLaneA({ ...READY, existingPlaneCount: 12 })).toBe(false);
  });

  it('refuses until the DB restore has resolved', () => {
    expect(shouldRunLaneA({ ...READY, restoreResolved: false })).toBe(false);
  });

  it('refuses on a failed restore, which never sets restoreResolved', () => {
    // DesignStudio leaves roofRestoreResolved false on 'failed' deliberately:
    // a read that did not succeed must not license auto-detection.
    expect(shouldRunLaneA({ ...READY, restoreResolved: false, existingPlaneCount: 0 })).toBe(false);
  });

  it('refuses without a usable site key', () => {
    expect(shouldRunLaneA({ ...READY, siteKey: '' })).toBe(false);
  });
});

describe('shouldRunLaneA — runs at most once per building', () => {
  it('refuses a second run for the same site', () => {
    expect(shouldRunLaneA({ ...READY, lastRanSiteKey: READY.siteKey })).toBe(false);
  });

  it('allows a run at a DIFFERENT site', () => {
    expect(shouldRunLaneA({ ...READY, lastRanSiteKey: '41.87800,-87.62980' })).toBe(true);
  });

  it('a repeat run would DUPLICATE, not replace — which is why the key exists', () => {
    // buildRoofPlane3D mints a fresh uuid per call and the handler merges by id,
    // so a second detection for the same building appends a whole second roof.
    // The gate is the only thing preventing that.
    const secondRun = shouldRunLaneA({ ...READY, lastRanSiteKey: READY.siteKey });
    expect(secondRun).toBe(false);
  });
});

describe('laneASiteKey', () => {
  it('is stable for the same building', () => {
    expect(laneASiteKey(38.8, -89.5)).toBe(laneASiteKey(38.8, -89.5));
  });

  it('ignores sub-metre jitter from orbit or a re-geocode', () => {
    // 5dp is ~1.1 m. The same address re-geocoded must not read as a new building.
    expect(laneASiteKey(38.800001, -89.500001)).toBe(laneASiteKey(38.8, -89.5));
  });

  it('distinguishes genuinely different buildings', () => {
    expect(laneASiteKey(38.8, -89.5)).not.toBe(laneASiteKey(38.801, -89.5));
  });

  it('returns an empty (refusing) key for non-finite coords', () => {
    expect(laneASiteKey(NaN, -89.5)).toBe('');
    expect(laneASiteKey(38.8, Infinity)).toBe('');
    // and an empty key is itself a refusal
    expect(shouldRunLaneA({ ...READY, siteKey: laneASiteKey(NaN, -89.5) })).toBe(false);
  });
});

describe('the ordering contract, asserted against the source', () => {
  it('Lane A is called only after ground elevation resolves, and never from a roofPlanes-keyed effect', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'components/3d/SolarEngine3D.tsx'),
      'utf8',
    );

    // Every call site must sit after the elevation-resolved assignment.
    const elevIdx = src.indexOf('cesiumGroundElevResolvedRef.current = true');
    expect(elevIdx).toBeGreaterThan(-1);

    const callSites = [...src.matchAll(/maybeRunLaneA\('/g)].map(m => m.index ?? -1);
    expect(callSites.length).toBeGreaterThan(0);
    for (const idx of callSites) expect(idx).toBeGreaterThan(elevIdx);

    // The gate must read refs, not captured props/state.
    expect(src).toContain('stage: stageRef.current');
    expect(src).toContain('restoreResolved: roofRestoreResolvedRef.current');
    expect(src).toContain('existingPlaneCount: (roofPlanesRef.current ?? []).length');

    // The dedupe key must be set BEFORE the emit, or a re-entrant twin load
    // appends a second roof.
    const markIdx = src.indexOf('laneARanForRef.current = siteKey');
    const emitIdx = src.indexOf("detectPlanesFromTwin(`LaneA(");
    expect(markIdx).toBeGreaterThan(-1);
    expect(emitIdx).toBeGreaterThan(markIdx);
  });

  it('detection still routes through onRoofPlanesDetected — emit-only-add', () => {
    // Lane A must never call a replace/delete path. The handler in DesignStudio
    // merges by id; this pins that Lane A has not grown its own writer.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const src = fs.readFileSync(path.join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8');
    expect(src).toContain('onRoofPlanesDetected?.(detected)');
    // and the engine still has no persistence writer of its own
    expect(src).not.toMatch(/sendBeacon/);
    expect(src).not.toMatch(/fetch\(\s*`?\/api\/projects/);
  });
});
