/**
 * tests/detectedPlaneElevation.test.ts
 *
 * DO AUTO-DETECTED FACES GET PANELS ABOVE THE ROOF? — ON REAL GOOGLE PAYLOADS.
 *
 * Ray, on a real house: *"the panels are not all rendering above the roof when
 * I do an auto layout to fill the roof."*
 *
 * Every elevation assertion written before this one used a roof I had traced
 * myself, with `buildRoofPlane3D` called directly on points I chose:
 *
 *   tests/panelSurfaceClearance.test.ts   one hand-built tilted face
 *   tests/roofMountDatum.test.ts          the same face, four placement paths
 *   e2e/panel-elevation.spec.ts           one face, then a gable, in a browser
 *
 * None of them is the path a person actually takes. Picking a house runs
 * Google Solar's segments through `segmentToRoofPlane` and fills **whatever
 * comes back** — faces of differing pitch, azimuth, size and data quality,
 * several at once. "Not ALL" is a per-face symptom, and a fixture with one face
 * of my own choosing cannot produce it.
 *
 * So this runs the REAL acquisition (`extractRoofSegments` →
 * `laneAPlanesFromSegments`) against the archived Google Solar payloads, then
 * the REAL placement engine (`buildSurfaceGrid`), and asserts the invariant per
 * face:
 *
 *   for every panel:  (panelECEF − itsPlane.origin3D) · itsPlane.normal
 *                      ==  moduleStackHeightM(racking)
 *
 * A signed distance, so it goes negative exactly when a panel is inside the
 * roof — which is what Ray is looking at.
 */

import { describe, it, expect } from 'vitest';
import { extractRoofSegments } from '@/lib/digitalTwin';
import { laneAPlanesFromSegments } from '@/lib/3d/laneA';
import { buildSurfaceGrid, hasUsableElevation } from '@/lib/surfaceGeometry3D';
import { moduleStackHeightM } from '@/lib/roofMountDatum';
import { latLngToECEF } from '@/lib/roofPlane3D';
import { siteKeyFromCoords } from '@/lib/siteIdentity';
import { placePanelsControlled, validatePanels } from '@/lib/3d/controlLayer';
import {
  NORMAL_SUBURBAN_PITCHED, MULTI_PLANE_COMPLEX, MEDIUM_QUALITY_RURAL, POCAHONTAS,
} from './fixtures/googleSolarResponses';
import type { PlacedPanel, RoofPlane } from '@/types';

const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const SITE = siteKeyFromCoords(POCAHONTAS.lat, POCAHONTAS.lng, PROJECT);
const MOUNT_ID = 'ironridge-xr100';
const STACK = moduleStackHeightM(MOUNT_ID);

/** See tests/panelSurfaceClearance.test.ts — panels store lat/lng at 7 dp while
 *  height keeps full precision, so a reconstructed point moves ~0.7 cm
 *  horizontally, which tips into the normal as sin(tilt)·error. MEASURED. */
const COPLANARITY_TOL_M = 1e-2;

function acquire(payload: unknown): RoofPlane[] {
  const segments = extractRoofSegments(payload as never, POCAHONTAS.elevationM);
  return laneAPlanesFromSegments(segments as never, POCAHONTAS.elevationM, { siteKey: SITE });
}

function fill(plane: RoofPlane): PlacedPanel[] {
  return buildSurfaceGrid({
    plane,
    groundElevM: POCAHONTAS.elevationM,
    orientation: 'portrait',
    eaveSetbackM: 0.3, ridgeSetbackM: 0.3, sideSetbackM: 0.3,
    panelSpacingM: 0, rowSpacingM: 0,
    layoutId: `detected-${plane.id}`,
    wattage: 400,
    mountingSystemId: MOUNT_ID,
  });
}

/** Signed distance from a panel to its own plane, along that plane's normal. */
function clearanceM(panel: PlacedPanel, plane: RoofPlane): number {
  const n = plane.ecefFrame3D!.n;
  const o = plane.origin3D!;
  const p = latLngToECEF(panel.lat, panel.lng, panel.height!);
  return (p.x - o.x) * n.x + (p.y - o.y) * n.y + (p.z - o.z) * n.z;
}

/** Fill every face and report each panel that is not one mount stack above it. */
function offenders(planes: RoofPlane[]) {
  const bad: Array<{ planeId: string; panelId: string; clearanceM: number; pitch: number }> = [];
  let total = 0;
  for (const plane of planes) {
    const panels = fill(plane);
    total += panels.length;
    for (const panel of panels) {
      const c = clearanceM(panel, plane);
      if (Math.abs(c - STACK) > COPLANARITY_TOL_M) {
        bad.push({ planeId: plane.id.slice(0, 8), panelId: panel.id, clearanceM: c, pitch: plane.pitch });
      }
    }
  }
  return { bad, total };
}

const FIXTURES: Array<[string, unknown, number]> = [
  ['normal suburban pitched', NORMAL_SUBURBAN_PITCHED, 2],
  ['multi-plane complex',     MULTI_PLANE_COMPLEX,     3],
  ['medium-quality rural',    MEDIUM_QUALITY_RURAL,    1],
];

describe('auto-detected roof faces — panels sit ON the roof, on every face', () => {
  for (const [name, payload, atLeast] of FIXTURES) {
    describe(name, () => {
      const planes = acquire(payload);

      it('the fixture really produces faces with 3D frames', () => {
        // Guard the guard. Every assertion below iterates planes and panels;
        // an empty array satisfies all of them silently, and "auto layout put
        // nothing anywhere" is a different bug wearing the same green tick.
        expect(planes.length).toBeGreaterThanOrEqual(atLeast);
        for (const p of planes) {
          expect(p.origin3D, `${p.id} has no origin3D`).toBeTruthy();
          expect(p.ecefFrame3D, `${p.id} has no ecefFrame3D`).toBeTruthy();
          // 🚨 `buildSurfaceGrid` requires ALL FOUR of these or it silently
          // falls back to a legacy frame whose height is
          // `planeHeightAtCenterMeters ?? LEGACY_PLANE_HEIGHT_M` — and
          // `buildRoofPlane3D` writes 0.0, which `??` KEEPS. A face missing any
          // one of them gets its panels at ground level.
          expect(p.createdFrom3D, `${p.id} is not createdFrom3D`).toBe(true);
          expect((p.polygon3D?.length ?? 0), `${p.id} has no polygon3D`).toBeGreaterThanOrEqual(3);
        }
      });

      it('🚨 every panel on every face sits exactly one mount stack above it', () => {
        const { bad, total } = offenders(planes);
        expect(total, 'no panels were placed at all — nothing was measured').toBeGreaterThan(0);
        expect(
          bad.map(b => `${b.panelId} on ${b.planeId} (pitch ${b.pitch.toFixed(1)}°): ${b.clearanceM.toFixed(4)} m`),
          `${bad.length} of ${total} panels are not ${STACK} m above their own face. ` +
          'A negative clearance means the panel is INSIDE the roof.',
        ).toEqual([]);
      });

      it('faces are filled independently — no face inherits another face\'s frame', () => {
        // The stale-frame family (WS1-016, WS1-019): a panel measured against
        // its OWN plane can still be wrong if two planes share a frame, so
        // check that each face's panels are NOT coplanar with a different face.
        if (planes.length < 2) return;
        const [a, b] = planes;
        const panelsOfA = fill(a);
        if (panelsOfA.length === 0) return;
        const againstB = clearanceM(panelsOfA[0], b);
        const againstA = clearanceM(panelsOfA[0], a);
        expect(Math.abs(againstA - STACK)).toBeLessThan(COPLANARITY_TOL_M);
        // Two genuinely different faces cannot both hold the same panel at the
        // same clearance unless they are the same plane.
        expect(Math.abs(againstB - STACK)).toBeGreaterThan(COPLANARITY_TOL_M);
      });
    });
  }

  it('🚨 ADVERSARIAL — a face that loses its 3D frame is detected, not silently sunk', () => {
    // The failure mode the guard above exists for, constructed directly: strip
    // `origin3D` and the placement engine falls back to the legacy frame, whose
    // height is `planeHeightAtCenterMeters ?? 3.5` — and 0.0 ?? 3.5 is 0.0, so
    // the panels land at GROUND elevation, tens of metres below the roof.
    const planes = acquire(MULTI_PLANE_COMPLEX);
    const stripped = { ...planes[0], origin3D: undefined } as unknown as RoofPlane;
    const panels = fill(stripped);
    expect(panels.length, 'the stripped face should still produce panels').toBeGreaterThan(0);

    // Measured against the REAL plane it should have been placed on.
    const c = clearanceM(panels[0], planes[0]);
    expect(Math.abs(c - STACK),
      'a face placed from the legacy frame must NOT coincidentally land correctly — ' +
      'if it does, this test can never detect the fallback',
    ).toBeGreaterThan(COPLANARITY_TOL_M);
  });

  // ── Ray: "the panels are not ALL rendering above the roof" ────────────────
  describe('🚨 a panel with NO elevation must never be drawn at sea level', () => {
    it('every panel the placement engine produces carries a real elevation', () => {
      const planes = acquire(MULTI_PLANE_COMPLEX);
      const panels = planes.flatMap(fill);
      expect(panels.length).toBeGreaterThan(0);
      const missing = panels.filter(p => !hasUsableElevation(p));
      expect(missing.map(p => p.id), 'the engine must not emit a panel without an elevation').toEqual([]);
    });

    it('🚨 ADVERSARIAL — the control layer REJECTS a panel with no elevation', () => {
      // The guard that was supposed to catch this read
      //     if (!isFinite(p.height ?? 0)) reject
      // and `undefined ?? 0` is 0, which IS finite — so the one case that
      // matters was waved through, and the renderer then drew it at ellipsoidal
      // zero, ~100 m below the roof. Some panels right, some underground:
      // exactly the symptom, with a correct panel count and no error anywhere.
      expect(hasUsableElevation({ height: undefined })).toBe(false);
      expect(hasUsableElevation({ height: null })).toBe(false);
      expect(hasUsableElevation({ height: NaN })).toBe(false);
      // A real elevation of zero is still a real elevation — absence is the
      // thing being rejected, not the number.
      expect(hasUsableElevation({ height: 0 })).toBe(true);
      expect(hasUsableElevation({ height: 160.4 })).toBe(true);

      // 🚨 AND THE OLD EXPRESSION IS SHOWN KEEPING THE WORST CASE. `?? 0`
      // only substitutes for null/undefined, which are precisely "no elevation
      // was ever written" — so the guard passed them and rejected only NaN.
      const oldGuard = (h: number | null | undefined) => Number.isFinite(h ?? 0);
      expect(oldGuard(undefined), 'the old guard KEPT a panel with no height').toBe(true);
      expect(oldGuard(null), 'the old guard KEPT a panel with a null height').toBe(true);
      expect(oldGuard(NaN), 'NaN was the only case it caught').toBe(false);
    });

    it('🚨 the control layer drops it rather than passing it to the renderer', () => {
      // 🚨 THIS TEST WAS VACUOUS AND I WROTE IT.
      // It drove `placePanelsControlled` in `surface_select` mode and then
      // asserted `res.panels.every(hasUsableElevation)`. That mode RE-PLACES
      // from the plane, so the tampered panel never reached the validator at
      // all — the assertion ran over a freshly generated list, and `every` is
      // true on an empty one either way. Deleting `hasUsableElevation` from the
      // validator left it GREEN. It tested nothing.
      //
      // The validator is now exported, so this calls it with the exact input
      // the defect requires and reads what it returns.
      const planes = acquire(MULTI_PLANE_COMPLEX);
      const plane = planes[0];
      const good = fill(plane);
      expect(good.length, 'nothing to tamper with').toBeGreaterThan(2);

      // Exactly as an old saved design, a restored version snapshot, or the 2D
      // layout engine delivers it: everything else intact, no elevation.
      const tampered = good.map((p, i) => (i === 1 ? { ...p, height: undefined } : p));
      const warnings: string[] = [];
      const kept = validatePanels(tampered as never, { plane } as never, warnings);

      expect(kept.length, 'the validator must drop exactly the tampered panel')
        .toBe(good.length - 1);
      expect(kept.map(p => p.id), 'and it must be the one with no elevation')
        .not.toContain(good[1].id);
      expect(warnings.join(' '), 'and it must SAY so — a silent drop is a vanished panel')
        .toMatch(/elevation is MISSING/);

      // Mutation anchor: with the old expression the panel survives. Shown, not
      // asserted about the source, so a rename cannot make this pass silently.
      const oldGuard = (h: number | null | undefined) => Number.isFinite(h ?? 0);
      expect(tampered.filter(p => oldGuard(p.height)).length,
        'the old guard would have kept all of them').toBe(good.length);
    });
  });
});
