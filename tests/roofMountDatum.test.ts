/**
 * tests/roofMountDatum.test.ts
 *
 * HOW HIGH ABOVE THE ROOF DOES A MODULE SIT? — ONE ANSWER, OR IT IS NOT AN ANSWER.
 *
 * WS1-013. Five placement paths answered this question with four different
 * numbers, so a roof carrying both auto-filled and hand-placed modules drew them
 * at different heights on the same plane:
 *
 *   buildSurfaceGridECEF / placeSinglePanel / addRow / extendRow   origin3D + 0.05
 *   panelPositionFromCAD                                           deck     + 0.18
 *   Google-segment fill, grid fill                                 deck     + 0.14
 *   single panel on a restored plane                               MODULE   + 0.14
 *
 * The last one is not even a height — it is a RATCHET. A plane restored from the
 * database has no frame of its own, so the renderer rebuilt one from a module
 * sitting on it and then treated that module as the deck. Every hand-placed
 * module after a reload floated one stack height above its neighbours, and the
 * next reload measured from the new one.
 *
 * WHAT THESE TESTS ASSERT
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. All four ECEF placement paths agree, to the stored-coordinate precision
 *      floor, on the same plane with the same racking.
 *   2. The datum and its inverse round-trip exactly, and applying the forward
 *      step twice drifts by EXACTLY one stack height — so the assertion is shown
 *      to detect the ratchet rather than merely to pass.
 *   3. The clearance actually varies with the racking system. A datum that is
 *      threaded but ignored looks identical to one that is correct, until the
 *      day someone changes racking.
 *   4. Rail dimensions come from the manufacturer database, not from a second
 *      copy in the renderer, and a rail fits in the gap the datum creates.
 */

import { describe, it, expect } from 'vitest';
import {
  moduleStackHeightM, railCrossSectionM, modulePointFromDeck, deckPointFromModule,
  DEFAULT_MODULE_STACK_M,
  drawnRailHeightM,
  drawnRailClearanceM,
  RAIL_DRAW_SCALE,
  RAIL_DECK_GAP_M,
} from '@/lib/roofMountDatum';
import { buildRoofPlane3D, latLngToECEF } from '@/lib/roofPlane3D';
import { buildSurfaceGrid, placeSinglePanel, addRow, extendRow } from '@/lib/surfaceGeometry3D';
import { getMountingSystemById, getAllMountingSystems } from '@/lib/mounting-hardware-db';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlacedPanel, RoofPlane } from '@/types';

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

// 3 Melvin Drive, the property from the live trace.
const LAT = 38.70615;
const LNG = -90.04625;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

const GROUND_M = 150;
const EAVE_H   = GROUND_M + 5;
const TILT_DEG = 30;        // a real pitch — on a flat roof the normal is "up" and
const WIDTH_M  = 12;        // an off-plane error cannot be told from a height error
const DEPTH_M  = 8;

const MOUNT_ID = 'ironridge-xr100';

/** See tests/panelSurfaceClearance.test.ts — panels store lat/lng at 7 dp while
 *  height keeps full precision, so a reconstructed point can move ~0.7 cm
 *  horizontally, which tips into the normal as sin(tilt)·error. MEASURED. */
const COPLANARITY_TOL_M = 1e-2;

function traceTiltedFace() {
  const dLng = WIDTH_M / 2 / mPerDegLng;
  const dLat = DEPTH_M / 2 / M_PER_DEG_LAT;
  const ridgeH = EAVE_H + DEPTH_M * Math.tan(TILT_DEG * DEG);
  return [
    latLngToECEF(LAT - dLat, LNG - dLng, EAVE_H),
    latLngToECEF(LAT - dLat, LNG + dLng, EAVE_H),
    latLngToECEF(LAT + dLat, LNG + dLng, ridgeH),
    latLngToECEF(LAT + dLat, LNG - dLng, ridgeH),
  ];
}

/** Signed distance from a module to its plane, along the plane normal. */
function clearanceM(panel: PlacedPanel, plane: RoofPlane): number {
  const n = plane.ecefFrame3D!.n;
  const o = plane.origin3D!;
  const p = latLngToECEF(panel.lat, panel.lng, panel.height!);
  return (p.x - o.x) * n.x + (p.y - o.y) * n.y + (p.z - o.z) * n.z;
}

function fill(plane: RoofPlane, mountingSystemId = MOUNT_ID): PlacedPanel[] {
  return buildSurfaceGrid({
    plane, groundElevM: GROUND_M, orientation: 'portrait',
    eaveSetbackM: 0.3, ridgeSetbackM: 0.3, sideSetbackM: 0.3,
    panelSpacingM: 0, rowSpacingM: 0,
    layoutId: 'datum-test', wattage: 400, mountingSystemId,
  });
}

describe('the roof mounting datum — one question, one answer', () => {
  const plane = buildRoofPlane3D(traceTiltedFace());
  const STACK = moduleStackHeightM(MOUNT_ID);

  it('the fixture is a real pitched face that produces a real grid', () => {
    // Guard the guard. Every assertion below iterates panels; an empty array
    // would satisfy all of them silently.
    expect(plane.origin3D).toBeTruthy();
    expect(plane.ecefFrame3D).toBeTruthy();
    expect(plane.pitch).toBeGreaterThan(25);
    expect(fill(plane).length).toBeGreaterThanOrEqual(4);
    expect(STACK).toBeGreaterThan(0.05);
  });

  // ── 1. THE INVARIANT: every path agrees ──────────────────────────────────
  it('🚨 POSITIVE — all four ECEF placement paths put a module at the same height', () => {
    const grid = fill(plane);
    expect(grid.length).toBeGreaterThan(4);

    // A click near the middle of the face, as the single-panel tool supplies it.
    const mid = grid[Math.floor(grid.length / 2)];
    const single = placeSinglePanel(
      mid.lat, mid.lng, mid.height!, plane, 'portrait', 'datum-test', 400, MOUNT_ID,
    );

    const extended = extendRow(grid, plane, GROUND_M, 'portrait', 'datum-test', 400, MOUNT_ID);
    const added    = addRow(grid, plane, GROUND_M, 'portrait', 'datum-test', 400, undefined, MOUNT_ID);

    const everyPanel: PlacedPanel[] = [
      ...grid,
      single,
      ...(extended ? [extended] : []),
      ...added,
    ];
    // If a path silently produced nothing, this test would be asserting over the
    // grid alone and would not be comparing paths at all.
    expect(everyPanel.length).toBeGreaterThan(grid.length);

    for (const p of everyPanel) {
      expect(
        Math.abs(clearanceM(p, plane) - STACK),
        `panel ${p.id} sits ${clearanceM(p, plane).toFixed(4)} m above the plane, expected ${STACK}`,
      ).toBeLessThan(COPLANARITY_TOL_M);
    }
  });

  // ── 2. The datum and its inverse ─────────────────────────────────────────
  it('POSITIVE — deck → module → deck is the identity', () => {
    const n = plane.ecefFrame3D!.n;
    const deck = plane.origin3D!;
    const back = deckPointFromModule(modulePointFromDeck(deck, n, MOUNT_ID), n, MOUNT_ID);
    expect(Math.abs(back.x - deck.x)).toBeLessThan(1e-9);
    expect(Math.abs(back.y - deck.y)).toBeLessThan(1e-9);
    expect(Math.abs(back.z - deck.z)).toBeLessThan(1e-9);
  });

  it('🚨 ADVERSARIAL — the ratchet, reproduced: forward twice drifts by exactly one stack', () => {
    // This is what `collectRoofRenderables` did before the fix. It rebuilt a
    // restored plane's origin from a MODULE and handed that to the single-panel
    // tool as the deck; the tool added the stack again.
    const n = plane.ecefFrame3D!.n;
    const deck = plane.origin3D!;

    const firstModule  = modulePointFromDeck(deck, n, MOUNT_ID);
    // BROKEN: treat the module as the deck (no inverse) and place another.
    const ratcheted    = modulePointFromDeck(firstModule, n, MOUNT_ID);
    // FIXED: recover the deck first.
    const correct      = modulePointFromDeck(
      deckPointFromModule(firstModule, n, MOUNT_ID), n, MOUNT_ID,
    );

    const along = (p: { x: number; y: number; z: number }) =>
      (p.x - deck.x) * n.x + (p.y - deck.y) * n.y + (p.z - deck.z) * n.z;

    // A micron. ECEF coordinates are ~6.4e6 m, so differencing them leaves about
    // 1e-9 m of double-precision noise; 1e-6 is comfortably above that and still
    // five orders of magnitude below the 0.14 m signal.
    const MICRON = 1e-6;
    expect(Math.abs(along(firstModule) - STACK)).toBeLessThan(MICRON);
    expect(Math.abs(along(correct)     - STACK)).toBeLessThan(MICRON);     // idempotent
    expect(Math.abs(along(ratcheted)   - STACK * 2)).toBeLessThan(MICRON); // one stack of drift
    // And it is a ratchet, not a one-off: a third turn drifts again.
    expect(Math.abs(along(modulePointFromDeck(ratcheted, n, MOUNT_ID)) - STACK * 3))
      .toBeLessThan(MICRON);
  });

  // ── 3. The datum is actually consulted ───────────────────────────────────
  it('🚨 ADVERSARIAL — changing the racking moves the modules', () => {
    // A `mountingSystemId` that is threaded but ignored is indistinguishable
    // from one that is honoured, until someone changes racking and nothing
    // moves. XR1000 is a taller rail than XR100 and must read as taller.
    const low  = moduleStackHeightM('rooftech-mini-s');   // rail-less
    const mid  = moduleStackHeightM('ironridge-xr100');
    const high = moduleStackHeightM('ironridge-xr1000');
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);

    const lowPanels  = fill(plane, 'rooftech-mini-s');
    const highPanels = fill(plane, 'ironridge-xr1000');
    expect(lowPanels.length).toBeGreaterThan(0);
    expect(lowPanels.length).toBe(highPanels.length); // same grid, different height

    expect(Math.abs(clearanceM(lowPanels[0], plane) - low)).toBeLessThan(COPLANARITY_TOL_M);
    expect(Math.abs(clearanceM(highPanels[0], plane) - high)).toBeLessThan(COPLANARITY_TOL_M);
    expect(clearanceM(highPanels[0], plane) - clearanceM(lowPanels[0], plane))
      .toBeGreaterThan(0.04);
  });

  // ── 4. Negative / absence ────────────────────────────────────────────────
  it('NEGATIVE — an unknown or absent racking system gets the conservative default, never 0 or NaN', () => {
    for (const id of [undefined, null, '', 'not-a-real-system', 'ironridge-xr9999']) {
      const v = moduleStackHeightM(id as string | null | undefined);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(DEFAULT_MODULE_STACK_M);
    }
    // A module placed under an unknown system must still clear the roof.
    const panels = fill(plane, 'not-a-real-system');
    expect(panels.length).toBeGreaterThan(0);
    expect(clearanceM(panels[0], plane)).toBeGreaterThan(0.05);
  });

  it('NEGATIVE — every roof mounting system in the catalogue yields a plausible stack', () => {
    const roofSystems = getAllMountingSystems().filter(
      s => s.category === 'roof_residential' || s.category === 'roof_commercial',
    );
    expect(roofSystems.length).toBeGreaterThan(10);
    for (const s of roofSystems) {
      const v = moduleStackHeightM(s.id);
      expect(Number.isFinite(v), `${s.id} produced ${v}`).toBe(true);
      // Nothing real puts a module 4 cm or 30 cm off the deck. This is a guard
      // against a database edit quietly deforming the viewport, not a spec.
      expect(v, `${s.id} stack ${v} m is outside any plausible range`).toBeGreaterThan(0.04);
      expect(v, `${s.id} stack ${v} m is outside any plausible range`).toBeLessThan(0.30);
    }
  });

  // ── 5. Rails come from the manufacturer record ───────────────────────────
  it('POSITIVE — rail dimensions are read from the mounting-hardware database, not restated', () => {
    for (const id of ['ironridge-xr100', 'ironridge-xr1000', 'unirac-solarmount']) {
      const spec = getMountingSystemById(id)!;
      const rail = railCrossSectionM(id)!;
      expect(rail, `${id} publishes a rail height and must render rails`).toBeTruthy();
      expect(rail.heightM).toBeCloseTo(spec.rail!.heightIn * 0.0254, 9);
    }
  });

  it('NEGATIVE — a rail-less system draws no rail', () => {
    for (const id of ['rooftech-mini-s', 'rooftech-mini-t', 'rooftech-mini-m']) {
      expect(railCrossSectionM(id), `${id} is rail-less`).toBeNull();
    }
  });

  it('a rail-based system with no published rail section still draws its companion rail', () => {
    // RT-MINI is a standoff paired with an XR100-class rail and its record
    // carries no rail block. Reading the database and stopping there would have
    // silently removed rails the viewport has always drawn for it.
    for (const id of ['rooftech-mini', 'rt-mini']) {
      const rail = railCrossSectionM(id);
      expect(rail, `${id} is rail-based and must still render a rail`).toBeTruthy();
      expect(rail!.heightM).toBeCloseTo(1.66 * 0.0254, 9);
    }
  });

  it('🚨 the DRAWN rail fits in the gap the datum creates — for every system in the catalogue', () => {
    // 🚨 THIS TEST HAS BEEN WRONG TWICE, IN TWO DIFFERENT WAYS.
    //
    // First it checked three hardcoded ids — ironridge-xr100, ironridge-xr1000,
    // unirac-solarmount, the three that happen to fit — and called the class
    // closed. Measured across all 45 catalogue systems, four drive the drawn
    // rail through the deck and two more clear it by 0.4 mm.
    //
    // Then it iterated the catalogue but RE-DERIVED the clamp inside the test
    // and asserted on its own arithmetic, so deleting the clamp from
    // `renderRoofRails` left it green. A test that recomputes the thing it is
    // testing is a test of itself.
    //
    // The clamp is now `drawnRailHeightM` — a function the renderer calls and
    // this calls — so there is one piece of arithmetic and this exercises it.
    const offenders: string[] = [];
    let checked = 0;

    for (const system of getAllMountingSystems()) {
      const drawn = drawnRailHeightM(system.id);
      if (drawn === null) {
        expect(railCrossSectionM(system.id), `${system.id} returns no drawn height, so it must have no rail`).toBeNull();
        continue;
      }
      checked++;
      const clearance = drawnRailClearanceM(system.id)!;
      expect(clearance, `${system.id}: the two helpers disagree`)
        .toBeCloseTo(moduleStackHeightM(system.id) - drawn, 12);
      if (clearance < RAIL_DECK_GAP_M - 1e-9) {
        offenders.push(`${system.id}: stack ${moduleStackHeightM(system.id).toFixed(3)} m, drawn rail ${drawn.toFixed(4)} m, clearance ${clearance.toFixed(4)} m`);
      }
    }

    expect(checked, 'no railed system was examined — the scan found nothing to check')
      .toBeGreaterThan(10);
    expect(offenders,
      'these systems draw the rail into or through the roof deck it is bolted to',
    ).toEqual([]);
  });

  it('the clamp only binds where it has to — common systems keep the full exaggeration', () => {
    // Guard against the lazy fix. Clamping everything to the stack would also
    // satisfy the test above while quietly shrinking every rail on screen.
    for (const id of ['ironridge-xr100', 'ironridge-xr1000', 'unirac-solarmount', 'snapnrack-100']) {
      const rail = railCrossSectionM(id)!;
      expect(drawnRailHeightM(id), `${id} should still be drawn at the full ${RAIL_DRAW_SCALE}x`)
        .toBeCloseTo(rail.heightM * RAIL_DRAW_SCALE, 12);
    }
  });

  it('🚨 and the four that do not fit are really clamped, not merely passing', () => {
    // Name them. If a catalogue edit ever makes one of these fit unclamped,
    // this fails and the list is re-derived deliberately rather than drifting.
    for (const id of ['s5-pvkit', 'dpw-powerrail', 'renusol-vs-plus', 'mse-rapid-rail']) {
      const rail = railCrossSectionM(id)!;
      const drawn = drawnRailHeightM(id)!;
      expect(drawn, `${id} must be clamped below the full ${RAIL_DRAW_SCALE}x`)
        .toBeLessThan(rail.heightM * RAIL_DRAW_SCALE - 1e-9);
      expect(drawnRailClearanceM(id)!, `${id} must end up clear of the deck`)
        .toBeGreaterThanOrEqual(RAIL_DECK_GAP_M - 1e-9);
    }
  });

  it('the RENDERER calls the clamp — it does not restate it', () => {
    // The behavioural assertions above are of `drawnRailHeightM`. This is the
    // link between that function and the code that draws, and it is stated as
    // the weak source-level check it is: the behavioural proof of the rail's
    // position in the running app is e2e/panel-above-deck.spec.ts.
    const engine = readFileSync(join(process.cwd(), 'components', '3d', 'SolarEngine3D.tsx'), 'utf8');
    expect(engine, 'renderRoofRails must call drawnRailHeightM').toMatch(/drawnRailHeightM\(mountId\)/);
    expect(engine, 'and must not recompute the clamp beside it')
      .not.toMatch(/Math\.min\(railH \* RAIL_DRAW_SCALE/);
  });
});
