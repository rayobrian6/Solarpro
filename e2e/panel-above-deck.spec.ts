import { expect, test } from '@playwright/test';
import { moduleStackHeightM } from '../lib/roofMountDatum';
import {
  DEFAULT_RACKING, buildGablePlanes, buildTaggedPlane, seedPlanes, seedRoofPlane, runAutoLayout,
  waitForCesiumCanvas,
} from './support/seedRoof';

/**
 * e2e/panel-above-deck.spec.ts
 *
 * IS THE PANEL ABOVE THE ROOF **ON SCREEN**?
 *
 * Ray: *"the panels are not all rendering above the roof when I do an auto
 * layout to fill the roof."*
 *
 * 🚨 EVERY GUARD BEFORE THIS ONE ASKED THE PLACEMENT LIBRARY ABOUT ITSELF.
 *
 *   tests/panelSurfaceClearance.test.ts   PlacedPanel.height vs the RoofPlane
 *   tests/roofMountDatum.test.ts          the same, across four placement paths
 *   tests/detectedPlaneElevation.test.ts  the same, on real Google payloads
 *   e2e/panel-elevation.spec.ts           the same, in a browser
 *
 * All four compute `(panelECEF − plane.origin3D) · plane.normal` and compare it
 * to `moduleStackHeightM`. That is arithmetic checking its own output. Not one
 * of them can see either of the two things a person actually looks at:
 *
 *     the BOX Cesium draws for a panel          — addPanelEntity
 *     the POLYGON Cesium draws for the deck     — renderPlane3DEntity
 *
 * So this spec reads the SCENE. `window.__solarViewerE2E` hands over the raw
 * viewer and nothing else — a ready-made clearance number would put the
 * measurement back inside the component under test.
 *
 * ── WHAT IT FOUND, FIRST RUN ─────────────────────────────────────────────────
 *
 *     55  [PANEL]
 *      1  [PLANE3D-OUTLINE]
 *      0  [PLANE3D-BASE]
 *
 * 🚨 THERE WAS NO ROOF UNDER THE ARRAY. `renderPlane3DEntity`'s outline branch
 * draws a polyline and returns; the branch it skips draws the opaque base coat
 * whose own comment says it "suppresses wavy mesh waviness beneath panels".
 * Without it the user is looking straight at Google's photogrammetry mesh,
 * which is NOT planar — ridge caps, vents, ±10–30 cm of noise — and a panel
 * placed a fixed height above a FITTED plane is swallowed wherever the mesh
 * rises above it. Per location, so SOME panels look wrong and others do not.
 *
 * The restore path decided "this face has no panels" once, from state that had
 * not been filled yet, and LATCHED it into a set nothing removes from. Every
 * face arriving from state — a reload, a restored design, every face Google
 * detects — was marked no-panels permanently; a face traced in the same session
 * took the other branch and got its deck. That is "not ALL", exactly.
 *
 * ── AND A SECOND DISAGREEMENT, ON master ─────────────────────────────────────
 *
 * The same restore path re-fits an already-lifted `polygon3D` through
 * `computePlaneFromPoints3D`, which applies `SURFACE_OFFSET_M` a second time,
 * so where the deck IS drawn it lands at `fitted + 0.24 m` while panels sit at
 * `origin3D + PANEL_OFFSET_ECEF` = `fitted + 0.17 m` — every panel 7 cm inside
 * the roof. Fixed on this branch; this spec is what keeps it fixed.
 *
 * Neither defect could have been caught before, because no test anywhere read a
 * Cesium entity, and both live in a 12,000-line React component between the
 * library and the screen that no unit test reaches.
 *
 * 🚨 WHAT IT STILL CANNOT SEE. With no Google Maps key there is no
 * photorealistic tileset, so this measures the panel against the DRAWN DECK. It
 * proves the deck exists, that it is on the datum `lib/roofMountDatum.ts` owns,
 * and that every panel clears it. It does NOT measure the mesh itself; see
 * e2e/README.md and the ledger entry for what closing that needs.
 */

const EXPECTED_CLEARANCE_M = moduleStackHeightM(DEFAULT_RACKING);

/** addPanelEntity: `dimensions: new Cartesian3(ph, pw, PANEL_THICKNESS)` with
 *  PANEL_THICKNESS = 0.040, and a Cesium box is CENTRED on its position — so
 *  the bottom face of the drawn panel is half a thickness below the point this
 *  spec measures. The panel is only visibly clear of the roof if that face is. */
const PANEL_HALF_THICKNESS_M = 0.020;

/** A gap a person can actually see at design zoom. The real one is
 *  EXPECTED_CLEARANCE_M − PANEL_HALF_THICKNESS_M = 0.12 m; this is the floor
 *  below which "above the roof" stops being true on screen. */
const VISIBLE_GAP_M = 0.05;

/**
 * 🚨 THE TOLERANCE THIS FILE FIRST USED WAS JUSTIFIED BY A FALSE CLAIM.
 *
 * It read *"the panel position is a direct ECEF Cartesian3 with no lat/lng round
 * trip, so this is float noise only"* and was set to 2 mm. `addPanelEntity`
 * calls `safeCartesian3(C, panel.lng, panel.lat, h)` — it goes through the
 * stored lat/lng, and those are rounded to SEVEN decimal places while the
 * height keeps full precision. Reconstructing the point therefore moves it
 * HORIZONTALLY, and a horizontal error tips into the plane normal as
 * `error · sin(tilt)`.
 *
 * So the bound is derived from the quantum, not chosen: half a unit in the last
 * place, in latitude and longitude together, times the sine of the face's own
 * tilt — which is read from the deck Cesium drew, so there is no fixture
 * constant to drift. Measured on the 25° fixtures: 2.2 mm, against a derived
 * bound of 3.3 mm. The vitest layer reaches the same conclusion the same way
 * (`tests/panelSurfaceClearance.test.ts`).
 */
const LATLNG_DECIMALS = 7;
const M_PER_DEG = 111_320;
/** Worst horizontal displacement from rounding lat AND lng, in metres. */
const ROUNDING_HORIZONTAL_M = (Math.pow(10, -LATLNG_DECIMALS) / 2) * M_PER_DEG * Math.SQRT2;

/** The clearance tolerance for a face at this tilt. */
function clearanceTolM(tiltRad: number): number {
  return ROUNDING_HORIZONTAL_M * Math.sin(tiltRad) + 1e-4;
}

/** A deck's tilt from vertical-up, read from the normal Cesium drew. */
function deckTiltRad(plane: { origin: Vec; n: Vec }): number {
  const up = norm(plane.origin);   // ECEF position doubles as local up
  return Math.acos(Math.min(1, Math.max(-1, dot(plane.n, up))));
}

type Vec = { x: number; y: number; z: number };
type Deck = { planeId: string; pts: Vec[] };
type Panel = { id: string; pos: Vec };

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec, b: Vec): Vec => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
const norm = (a: Vec): Vec => {
  const m = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / m, y: a.y / m, z: a.z / m };
};
const mean = (pts: Vec[]): Vec => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
});

/**
 * The deck's plane, from the deck's OWN drawn corners.
 *
 * Newell's method rather than one cross product: it uses every corner, so a
 * near-degenerate first edge cannot silently produce a garbage normal that then
 * makes every clearance look fine.
 */
function deckPlane(deck: Deck): { origin: Vec; n: Vec; u: Vec; v: Vec } {
  const pts = deck.pts;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const origin = mean(pts);
  let n = norm({ x: nx, y: ny, z: nz });
  // ECEF position doubles as the local up direction, so this orients the normal
  // away from the Earth's centre. Without it a polygon wound the other way
  // flips the sign and a BURIED panel reads as a clearance.
  if (dot(n, origin) < 0) n = { x: -n.x, y: -n.y, z: -n.z };
  const u = norm(sub(pts[1], pts[0]));
  return { origin, n, u, v: cross(n, u) };
}

/** Is the panel over this deck? Point-in-polygon in the deck's own 2D basis. */
function deckCovers(deck: Deck, plane: ReturnType<typeof deckPlane>, p: Vec): boolean {
  const to2 = (q: Vec) => {
    const d = sub(q, plane.origin);
    return { x: dot(d, plane.u), y: dot(d, plane.v) };
  };
  const poly = deck.pts.map(to2);
  const { x, y } = to2(p);
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Everything the scene is drawing, read from the entity collection itself. */
async function readScene(page: import('@playwright/test').Page): Promise<{ decks: Deck[]; panels: Panel[]; outlineOnly: Deck[] }> {
  return page.evaluate(() => {
    const C = (window as any).Cesium;
    const viewer = (window as any).__solarViewerE2E;
    if (!C || !viewer) return { decks: [], panels: [], outlineOnly: [] };
    const t = C.JulianDate.now();
    const decks: any[] = [];
    const panels: any[] = [];
    const outlineOnly: any[] = [];
    for (const e of viewer.entities.values) {
      const name: string = e.name ?? '';
      if (name.startsWith('[PLANE3D-OUTLINE] ')) {
        // Keep the ring's own corners, not just the id: "a face was drawn as an
        // outline" is only a defect when PANELS are sitting over that face, and
        // deciding that needs its footprint.
        const ring = e.polyline?.positions?.getValue(t);
        outlineOnly.push({
          planeId: name.slice('[PLANE3D-OUTLINE] '.length),
          pts: (ring ?? []).map((p: any) => ({ x: p.x, y: p.y, z: p.z })),
        });
      } else if (name.startsWith('[PLANE3D-BASE] ')) {
        const h = e.polygon?.hierarchy?.getValue(t);
        const pos = h?.positions ?? h;
        if (pos && pos.length >= 3) {
          decks.push({
            planeId: name.slice('[PLANE3D-BASE] '.length),
            pts: pos.map((p: any) => ({ x: p.x, y: p.y, z: p.z })),
          });
        }
      } else if (name.startsWith('[PANEL] ')) {
        const p = e.position?.getValue(t);
        if (p) panels.push({ id: name.slice('[PANEL] '.length), pos: { x: p.x, y: p.y, z: p.z } });
      }
    }
    return { decks, panels, outlineOnly };
  });
}

/** Signed height of every drawn panel above every drawn deck that covers it. */
function clearances(decks: Deck[], panels: Panel[]) {
  const planes = decks.map(d => ({ deck: d, plane: deckPlane(d) }));
  const rows: Array<{ panelId: string; planeId: string; clearanceM: number; tiltRad: number }> = [];
  const uncovered: string[] = [];
  for (const panel of panels) {
    let covered = false;
    for (const { deck, plane } of planes) {
      if (!deckCovers(deck, plane, panel.pos)) continue;
      covered = true;
      rows.push({
        panelId: panel.id, planeId: deck.planeId,
        clearanceM: dot(sub(panel.pos, plane.origin), plane.n),
        tiltRad: deckTiltRad(plane),
      });
    }
    if (!covered) uncovered.push(panel.id);
  }
  return { rows, uncovered };
}

async function boot(page: import('@playwright/test').Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect.poll(
    () => page.evaluate(() => Boolean((window as any).__solarE2E?.seedDesign)),
    { message: 'NEXT_PUBLIC_E2E hook with seedDesign should be installed', timeout: 30_000 },
  ).toBe(true);
  expect(await waitForCesiumCanvas(page), 'the Cesium canvas never became visible').toBe(true);
  // The viewer handle appears only once the engine reaches stage 'done'. Reading
  // the scene before that finds an empty entity collection, and an empty
  // collection satisfies every assertion below in silence.
  await expect.poll(
    () => page.evaluate(() => Boolean((window as any).__solarViewerE2E)),
    { message: 'the 3D engine never reached stage "done" — no viewer to measure', timeout: 60_000 },
  ).toBe(true);
}

/** The deck is drawn by a React effect, so it can land after the panels do. */
async function waitForDecks(page: import('@playwright/test').Page, atLeast: number) {
  await expect.poll(
    async () => (await readScene(page)).decks.length,
    {
      message: `the scene never drew ${atLeast} roof deck polygon(s) — with nothing ` +
               'under the panels this spec cannot measure anything',
      timeout: 45_000,
      intervals: [500, 1000, 2000],
    },
  ).toBeGreaterThanOrEqual(atLeast);
}

test.describe('the drawn panel sits above the drawn roof', () => {
  test('🚨 every Auto Layout panel is visibly above the deck Cesium draws under it', async ({ page }) => {
    await boot(page);
    await seedRoofPlane(page);
    await runAutoLayout(page);
    await waitForDecks(page, 1);

    const { decks, panels, outlineOnly: sceneOutlines } = await readScene(page);

    // Guard the guard, three ways. Each of these has silently held in this
    // suite's history, and each turns everything below into a pass over an
    // empty list.
    expect(panels.length, 'no [PANEL] entity is in the scene').toBeGreaterThan(0);

    // 🚨 THE ASSERTION THAT FAILED FIRST, AND THE ONE THAT MATTERS MOST.
    // A face with panels over it must be drawn as a DECK. Drawn as an outline it
    // leaves the photogrammetry mesh as the surface under the array, and the
    // clearance measured below would then be measured against nothing.
    //
    // Stated as "no face that has panels over it is outline-only", NOT as "no
    // outlines exist" — a face a person marked and never filled is SUPPOSED to
    // be a clean outline, and a test that forbids all of them would fail on
    // correct behaviour the first time someone adds an unfilled face.
    const undecked = sceneOutlines
      .filter(o => o.pts.length >= 3)
      .filter(o => {
        const pl = deckPlane(o);
        return panels.some(p => deckCovers(o, pl, p.pos));
      })
      .map(o => o.planeId);
    expect(undecked,
      'these faces have drawn panels over them and were still drawn outline-only, ' +
      'so there is no roof deck under the array and the user sees the raw mesh',
    ).toEqual([]);
    expect(decks.length, 'no [PLANE3D-BASE] deck polygon is in the scene').toBeGreaterThanOrEqual(1);

    const { rows, uncovered } = clearances(decks, panels);
    expect(uncovered,
      'these panels are not over any drawn deck at all — they were measured ' +
      'against nothing, which is a different defect wearing the same green tick',
    ).toEqual([]);
    expect(rows.length, 'no panel/deck pair was measured').toBeGreaterThan(0);

    const buried = rows.filter(r => r.clearanceM - PANEL_HALF_THICKNESS_M < VISIBLE_GAP_M);
    expect(
      buried.map(r => `${r.panelId} over ${r.planeId.slice(0, 8)}: ${r.clearanceM.toFixed(4)} m`),
      `${buried.length} of ${rows.length} drawn panels are not visibly above the drawn deck. ` +
      'A negative clearance means the panel box is INSIDE the roof surface the user is looking at.',
    ).toEqual([]);

    // And the renderer must agree with the mount-datum authority, not merely
    // clear the deck by some happy accident. This is the assertion that ties
    // what is on screen to lib/roofMountDatum.ts.
    for (const r of rows) {
      expect(
        Math.abs(r.clearanceM - EXPECTED_CLEARANCE_M),
        `panel ${r.panelId} renders ${r.clearanceM.toFixed(4)} m above the drawn deck, but ` +
        `moduleStackHeightM('${DEFAULT_RACKING}') is ${EXPECTED_CLEARANCE_M} m`,
      ).toBeLessThan(clearanceTolM(r.tiltRad));
    }
  });

  test('🚨 "not ALL" — on a gable, no face is drawn on a different datum from its panels', async ({ page }) => {
    // One face cannot exhibit a per-face defect, and "fill the roof" means more
    // than one face on any real house. The master defect is per-face by
    // construction: a face traced this session is already in plane3DEntityMap
    // and is drawn once, while a face arriving from state goes through the
    // restore path and is drawn a second SURFACE_OFFSET_M up.
    await boot(page);
    await seedPlanes(page, buildGablePlanes());
    await runAutoLayout(page);
    await waitForDecks(page, 2);

    const { decks, panels } = await readScene(page);
    expect(decks.length, 'both gable faces should be drawn').toBeGreaterThanOrEqual(2);
    expect(panels.length, 'Auto Layout should fill both faces').toBeGreaterThan(0);

    const { rows, uncovered } = clearances(decks, panels);
    expect(uncovered, 'panels over no deck at all').toEqual([]);

    // Per FACE, so "most panels are fine" cannot hide a face that is not.
    const byPlane = new Map<string, number[]>();
    for (const r of rows) {
      if (!byPlane.has(r.planeId)) byPlane.set(r.planeId, []);
      byPlane.get(r.planeId)!.push(r.clearanceM);
    }
    expect(byPlane.size, 'panels landed on only one face — the gable case is not exercised')
      .toBeGreaterThanOrEqual(2);

    for (const [planeId, cs] of byPlane) {
      const worst = Math.min(...cs);
      expect(
        worst - PANEL_HALF_THICKNESS_M,
        `face ${planeId.slice(0, 8)}: worst of ${cs.length} panels renders ${worst.toFixed(4)} m ` +
        'above its own drawn deck',
      ).toBeGreaterThanOrEqual(VISIBLE_GAP_M);
    }
  });


  test('🚨 a 2D "Tag This Roof Plane" face — the shape every other fixture cannot be', async ({ page }) => {
    // 🚨 THE FIXTURE, NOT THE ASSERTION, WAS THE GAP.
    //
    // Every other seeded plane in this harness comes from `buildRoofPlane3D`,
    // so every one carries polygon3D / origin3D / ecefFrame3D — one shape out of
    // three, and the shape that was already correct. A face from the 2D "Tag
    // This Roof Plane" flow carries `vertices`, `pitch`, `azimuth` and
    // `localFrame3D` and nothing else, and the renderer and the placement
    // engine resolved THAT face differently:
    //
    //     panel centre   0.017 m above its own drawn deck
    //     panel box      0.040 m thick, centred
    //     underside      0.003 m INSIDE the roof it is standing on
    //
    // and with a low-profile racking (0.10 m stack) the whole box is under the
    // deck. Correct count, no error, array half-buried — Ray's report, for
    // every face tagged from the 2D map.
    await boot(page);
    await seedPlanes(page, [buildTaggedPlane()]);
    await runAutoLayout(page);
    await waitForDecks(page, 1);

    const { decks, panels, outlineOnly: sceneOutlines } = await readScene(page);
    expect(panels.length, 'Auto Layout must fill a tagged 2D face').toBeGreaterThan(0);

    const undecked = sceneOutlines
      .filter(o => o.pts.length >= 3)
      .filter(o => { const pl = deckPlane(o); return panels.some(p => deckCovers(o, pl, p.pos)); })
      .map(o => o.planeId);
    expect(undecked, 'a tagged face with panels on it must be drawn as a deck').toEqual([]);
    expect(decks.length, 'the tagged face must draw a deck').toBeGreaterThanOrEqual(1);

    const { rows, uncovered } = clearances(decks, panels);
    expect(uncovered, 'panels over no deck at all').toEqual([]);
    expect(rows.length, 'nothing measured').toBeGreaterThan(0);

    const buried = rows.filter(r => r.clearanceM - PANEL_HALF_THICKNESS_M < VISIBLE_GAP_M);
    expect(
      buried.map(r => `${r.panelId}: ${r.clearanceM.toFixed(4)} m`),
      `${buried.length} of ${rows.length} panels on a TAGGED 2D face are not visibly above its deck`,
    ).toEqual([]);

    for (const r of rows) {
      expect(
        Math.abs(r.clearanceM - EXPECTED_CLEARANCE_M),
        `a tagged 2D face renders its panel ${r.clearanceM.toFixed(4)} m above its deck; ` +
        `moduleStackHeightM('${DEFAULT_RACKING}') is ${EXPECTED_CLEARANCE_M} m. ` +
        'A value near 0.02 m is the deck drawn one SURFACE_OFFSET_M above the plane ' +
        'the panels were placed from.',
      ).toBeLessThan(clearanceTolM(r.tiltRad));
    }
  });

  test('🚨 a rebuild after a reload draws the deck on the same datum', async ({ page }) => {
    // 🚨 A CORRECTION TO WHAT THIS TEST FIRST CLAIMED. It was written as
    // "in-session trace versus restore path" — and it is not that, because
    // `seedDesign` puts geometry on the studio's state, which is the RESTORE
    // path both times. Both halves take the same branch, so the comparison
    // cannot show a trace-versus-restore divergence and it was wrong to say it
    // could.
    //
    // What it does show is worth keeping: the deck and the panels survive a
    // real page reload and a real refill on the SAME datum, with a fresh
    // Cesium viewer, fresh entity ids and fresh React state — which is where
    // the double-lift on `origin/master` becomes visible on a saved design.
    // The trace-versus-restore comparison needs a spec that drives the 3D
    // tracing tool, which needs a mesh to click on, which needs 3D tiles.
    await boot(page);
    await seedRoofPlane(page);
    await runAutoLayout(page);
    await waitForDecks(page, 1);

    const before = await readScene(page);
    const beforeRows = clearances(before.decks, before.panels).rows;
    expect(beforeRows.length, 'nothing measured before the rebuild').toBeGreaterThan(0);

    // Re-seed the SAME planes and panels the studio is holding. The engine's
    // restore effect skips ids already in plane3DEntityMap, so the deck is not
    // redrawn — which is exactly why this asserts the geometry is unchanged
    // rather than asserting a redraw happened.
    await page.reload();
    await expect.poll(
      () => page.evaluate(() => Boolean((window as any).__solarViewerE2E)),
      { message: 'the engine never came back after reload', timeout: 60_000 },
    ).toBe(true);

    // After a reload the quick-launch project has no persisted roof, so put the
    // SAME geometry back through the same setter and let the restore path —
    // not the trace path — draw it. That is the branch master gets wrong.
    await seedRoofPlane(page);
    await runAutoLayout(page);
    await waitForDecks(page, 1);

    const after = await readScene(page);
    const afterRows = clearances(after.decks, after.panels).rows;
    expect(afterRows.length, 'nothing measured after the rebuild').toBeGreaterThan(0);

    const worstAfter = Math.min(...afterRows.map(r => r.clearanceM));
    expect(
      worstAfter - PANEL_HALF_THICKNESS_M,
      `after a reload the worst panel renders ${worstAfter.toFixed(4)} m above the drawn deck`,
    ).toBeGreaterThanOrEqual(VISIBLE_GAP_M);

    // 🚨 AND IT MUST NOT HAVE MOVED. A 0.12 m step between the two is the
    // double-lift, and it is the whole defect.
    const worstBefore = Math.min(...beforeRows.map(r => r.clearanceM));
    expect(
      Math.abs(worstAfter - worstBefore),
      `the deck moved ${(worstAfter - worstBefore).toFixed(4)} m between a freshly ` +
      'seeded face and the same face drawn by the restore path — one of the two ' +
      'applied SURFACE_OFFSET_M a second time',
    ).toBeLessThan(2 * clearanceTolM(afterRows[0].tiltRad));
  });
});
