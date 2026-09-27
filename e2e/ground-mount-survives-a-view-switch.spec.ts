/**
 * e2e/ground-mount-survives-a-view-switch.spec.ts
 *
 * 🚨 RAY'S LIVE FAILURE, IN A REAL BROWSER: he built a ground mount in 3D, switched to 2D to
 * look at Nearmap imagery, and on returning to 3D the rows had separated.
 *
 * WHY THIS SPEC IS ABOUT GEOMETRY AND NOT ABOUT PIXELS. Every spec here renders through
 * SwiftShader — WebGL on the CPU. It does not rasterise the scene: screenshots come back blank
 * and `drillPick` returns zero hits. So a browser test in this repo can drive state and read the
 * DOM, and it can NEVER prove how anything looks. Asserting on a screenshot would be theatre.
 *
 * What it can prove is the thing Ray actually asked for, in his words: "3D → 2D → 3D =
 * byte/logically equivalent project geometry within numerical tolerance." That is a property of
 * the canonical panel state, which `window.__solarE2E.panels` exposes, and it is exactly what
 * the defect violated — the committed geometry was the raw pre-grid positions while the entities
 * were drawn at corrected ones, so a remount drew the raw ones and the rows moved.
 *
 * WHY IT SEEDS RATHER THAN CLICKS. Placing a ground mount needs two clicks on terrain, which
 * needs `drillPick`, which returns nothing under software WebGL. `seedDesign` is the existing
 * E2E bridge the studio already exposes for exactly this reason (same precedent as `pickHouse`,
 * whose comment says the browser path to that click needs WebGL and a building under the cursor
 * while "the BEHAVIOUR being tested is what happens after"). The behaviour under test here is
 * the VIEW SWITCH, and the switch is driven by a real click on the real toolbar button.
 *
 * The seeded geometry is a deterministic 2-row PLP grid — the same arithmetic
 * `buildPanelGrid` produces — so this is the state a fixed placement commits. Under the defect
 * the committed state was NOT this, and the unit suite
 * (tests/groundMountSurvivesAViewSwitch.test.ts) covers that half: it proves the placement path
 * returns the corrected panels and that re-deriving them is a fixed point. This spec proves the
 * remaining half in the real application: the switch itself mutates nothing, and the racking
 * comes back.
 */

import { expect, test } from '@playwright/test';

type E2EWin = Window & {
  __solarE2E?: {
    panels?: Array<Record<string, unknown>>;
    seedDesign?: (d: { panels?: unknown[] }) => void;
  };
  __solarViewerE2E?: { entities?: { values?: Array<{ id?: unknown; name?: unknown }> } };
};

const T = 90_000;
const MPD = 111_320;

/** Springfield IL — the same basis the unit suite uses. */
const SITE = { lat: 39.7817, lng: -89.6501 };
const TILT = 20;
const PANEL_W = 1.134;   // PW_PORTRAIT
const PANEL_H = 1.722;   // PH_PORTRAIT
const CLEARANCE = 0.6096; // PLP_MIN_PANEL_CLEARANCE_M
const GROUND_Z = 200;

/**
 * A 2-row × 4-column PLP ground mount, already on the deterministic grid: azimuth-aligned axes,
 * row pitch = panelH·cos(tilt), and height = groundZ + clearance + nsM·tan(tilt). Azimuth 180°,
 * so the anti-azimuth axis points north.
 */
function griddedGroundMount() {
  const t = TILT * Math.PI / 180;
  const rowDepth = PANEL_H * Math.cos(t);
  const colStep = PANEL_W; // PLP_PANEL_COL_GAP_M is 0
  const cosLat = Math.cos(SITE.lat * Math.PI / 180);
  const panels: Array<Record<string, unknown>> = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const nsM = r * rowDepth + rowDepth / 2;
      const ewM = c * colStep + colStep / 2;
      panels.push({
        id: `gm-${r}-${c}`,
        lat: SITE.lat + nsM / MPD,
        lng: SITE.lng + ewM / (MPD * cosLat),
        height: GROUND_Z + CLEARANCE + nsM * Math.tan(t),
        widthFeet: 3.72, heightFeet: 5.65,
        tilt: TILT, azimuth: 180,
        row: r, col: c, arrayRow: r,
        arrayId: 'ga-e2e-groundmount',
        systemType: 'ground',
        orientation: 'portrait',
        wattage: 440,
        heading: 0, pitch: -(TILT * Math.PI / 180), roll: 0,
      });
    }
  }
  return panels;
}

/** The geometry that must not change, keyed by id so a reordering is not a failure. */
type Geom = Record<string, { lat: number; lng: number; height: number; tilt: number; azimuth: number }>;

async function readGeometry(page: import('@playwright/test').Page): Promise<Geom> {
  return page.evaluate(() => {
    const w = window as unknown as E2EWin;
    const out: Record<string, { lat: number; lng: number; height: number; tilt: number; azimuth: number }> = {};
    for (const p of w.__solarE2E?.panels ?? []) {
      out[String(p.id)] = {
        lat: Number(p.lat), lng: Number(p.lng), height: Number(p.height),
        tilt: Number(p.tilt), azimuth: Number(p.azimuth),
      };
    }
    return out;
  });
}

/**
 * Count the ground racking entities currently in the Cesium scene.
 *
 * 🚨 BY NAME, NOT BY ID, and the first version of this spec got that wrong and reported 0 —
 * a false product failure. `renderGroundRackingOutput` calls
 * `viewer.entities.add({ name, position, orientation, box })` with NO `id`, so Cesium assigns
 * each member a generated GUID; the engine's own `__gnd__…` key is used only as the
 * `panelMapRef` map key and never reaches the entity. The members' NAMES are stable and
 * product-defined — `[PD-PYLON] b0`, `[PD-STRONGBACK b0]`, `[PD-S-STRUT] b0` for PLP and
 * `[XR-S-POST] b0` for IronRidge — so that is the discriminator.
 */
async function countRackingEntities(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const v = (window as unknown as E2EWin).__solarViewerE2E;
    const values = v?.entities?.values ?? [];
    return values.filter(e => typeof (e as { name?: unknown })?.name === 'string'
      && /^\[(PD|XR)-/.test((e as { name: string }).name)).length;
  });
}

test.describe('a ground mount survives a 3D → 2D → 3D view switch', () => {
  test('the committed geometry is unchanged, and the racking comes back', async ({ page }) => {
    test.setTimeout(T * 3);

    const consoleErrors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto('/design?e2eQuickDesign=1');

    // The bridge only exists while the studio is mounted, and its teardown is deliberate — a
    // spec that reads a dead component's frozen snapshot cannot tell "nothing happened" from
    // "the app is gone".
    await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarE2E?.seedDesign,
      undefined, { timeout: T });

    const seeded = griddedGroundMount();
    await page.evaluate(p => {
      (window as unknown as E2EWin).__solarE2E!.seedDesign!({ panels: p });
    }, seeded);

    await page.waitForFunction(n => ((window as unknown as E2EWin).__solarE2E?.panels?.length ?? 0) === n,
      seeded.length, { timeout: T });

    const before = await readGeometry(page);
    expect(Object.keys(before).length,
      'the seed did not reach the studio — everything below would be vacuous').toBe(8);

    // The 3D → 2D → 3D switch, through the real toolbar button. Its label flips between
    // "🌐 3D View" and "🗺️ 2D Map", so each click is addressed by the label it currently shows.
    const toggle = page.getByRole('button', { name: /3D View|2D Map/ });
    await expect(toggle).toBeVisible({ timeout: T });

    await toggle.click();                                    // → 2D
    await expect(page.getByRole('button', { name: /2D Map/ })).toBeVisible({ timeout: T });
    // 🚨 A DELIBERATE PAUSE IN 2D. The defect needed the 3D component to UNMOUNT
    // (`show3D ? <SolarEngine3D/> : …` is a conditional mount) and its refs to be discarded;
    // a switch faster than React's commit would not have exercised it.
    await page.waitForTimeout(1_500);

    await toggle.click();                                    // → back to 3D
    await expect(page.getByRole('button', { name: /3D View/ })).toBeVisible({ timeout: T });

    // 🚨 WAIT ON THE PRODUCT'S OWN BOOT SIGNAL, NOT ON A TEST HOOK, AND DO NOT MAKE THE
    // ASSERTION OPTIONAL.
    //
    // Two earlier versions of this were wrong in opposite directions. The first waited on
    // `__solarViewerE2E` and timed out, failing for a reason unrelated to the geometry. The
    // second made the racking assertion conditional on that hook appearing — and then PASSED
    // AGAINST THE UNFIXED CODE, because on that run the hook happened not to appear and the one
    // assertion that discriminates was skipped. A conditional assertion is a blind one.
    //
    // The engine sets its own status message at the end of boot, and it is rendered. Waiting on
    // that is deterministic and product-visible: once it is there, `stage === 'done'`, so the
    // viewer hook must exist too, and the racking count can be asserted unconditionally.
    await expect(page.getByText(/3D Digital Twin loaded/)).toBeVisible({ timeout: T * 2 });
    await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarViewerE2E,
      undefined, { timeout: T });
    await page.waitForTimeout(2_000);

    // ── THE INVARIANT ────────────────────────────────────────────────────────
    const after = await readGeometry(page);
    expect(Object.keys(after).sort(),
      'panels were lost or renamed across the view switch').toEqual(Object.keys(before).sort());

    const cosLat = Math.cos(SITE.lat * Math.PI / 180);
    for (const id of Object.keys(before)) {
      const a = before[id], b = after[id];
      const dNS = Math.abs(a.lat - b.lat) * MPD;
      const dEW = Math.abs(a.lng - b.lng) * MPD * cosLat;
      const moved = Math.hypot(dNS, dEW);
      expect(moved, `${id} moved ${(moved * 1000).toFixed(1)} mm across the view switch`)
        .toBeLessThan(0.001);
      expect(Math.abs(a.height - b.height),
        `${id} changed height by ${((a.height - b.height) * 1000).toFixed(1)} mm`).toBeLessThan(0.001);
      expect(b.tilt, `${id} tilt changed`).toBe(a.tilt);
      expect(b.azimuth, `${id} azimuth changed`).toBe(a.azimuth);
    }

    // ── AND THE ROWS RELATIVE TO EACH OTHER ──────────────────────────────────
    // Ray's wording is "no row moves relative to the array or other rows", so the pitch between
    // the rows is asserted directly as well as each panel's absolute position — a uniform
    // translation of the whole array would satisfy the loop above and fail this.
    const rowLead = (g: Geom, r: number) => g[`gm-${r}-0`];
    const pitch = (g: Geom) => {
      const p0 = rowLead(g, 0), p1 = rowLead(g, 1);
      return Math.hypot((p0.lat - p1.lat) * MPD, (p0.lng - p1.lng) * MPD * cosLat);
    };
    expect(Math.abs(pitch(after) - pitch(before)),
      `row pitch changed from ${pitch(before).toFixed(4)} m to ${pitch(after).toFixed(4)} m`)
      .toBeLessThan(0.001);

    // ── THE RACKING, WHICH THE FULL-REBUILD BRANCH USED TO DELETE AND NOT REPLACE ──
    // Ground racking members are keyed into the same entity map as the panels, so the remount's
    // clear removed every pylon, strongback and rail, and only panels and roof rails were
    // re-added. The modules came back floating.
    //
    // 🚨 THIS IS THE ASSERTION THAT DISCRIMINATES, so it is unconditional.
    //
    // The geometry check above is a regression GUARD, not a proof of the fix: this spec seeds
    // already-gridded panels through `seedDesign`, so it never runs `placeGroundArrayRow` and
    // would pass with or without the commit-path repair. What it locks in is that the switch
    // itself mutates nothing — which was always true, and must stay true.
    //
    // The racking count is different. Before `rebuildGroundRacking` existed, the remount's
    // full-rebuild branch cleared every entity in `panelMapRef` — which holds the racking
    // members as well as the panels — and re-added only panels and roof rails, so this count
    // was ZERO and the modules were left floating. Verified: against the pre-fix component this
    // assertion reports 0.
    const racking = await countRackingEntities(page);
    expect(racking,
      'no ground racking entities in the scene after the view switch — the modules are floating')
      .toBeGreaterThan(0);

    // ── DID THE REMOUNT THROW? ───────────────────────────────────────────────
    // A remount that threw could leave the geometry untouched and still be broken, so errors are
    // read rather than inferred. But "no console errors at all" is not achievable in this
    // harness and asserting it reported a false failure once already, so each exclusion below
    // is named with the reason it is environmental rather than a product fault:
    //
    //  · CORS on external tile hosts — playwright.config.ts sets
    //    `extraHTTPHeaders: { 'X-Dev-Auth': 'bypass' }`, which Playwright applies to EVERY
    //    request including cross-origin imagery fetches. ArcGIS and Google do not list
    //    `x-dev-auth` in Access-Control-Allow-Headers, so their preflight rejects it. The header
    //    exists so the dev auth bypass works on the app's own API; it is not meant for them.
    //  · project/client loading — this run has no DATABASE_URL (the server logs say so at boot)
    //    and the spec deliberately seeds its state instead, so the store's load failing is the
    //    expected shape of this environment.
    //  · chunk / favicon / ResizeObserver — dev-server and browser noise.
    const ENVIRONMENTAL: Array<[RegExp, string]> = [
      [/blocked by CORS policy/i, 'harness injects X-Dev-Auth into cross-origin tile fetches'],
      [/x-dev-auth is not allowed/i, 'same'],
      [/loadClients|loadProjects|\/api\/(projects|clients)/i, 'no DATABASE_URL in this run; state is seeded'],
      [/AUTH_DB_CONFIG_ERROR|DATABASE_URL is not configured/i, 'same — this box has no Neon credential'],
      [/3D_TILE_ERROR|NEXT_PUBLIC_GOOGLE_MAPS_API_KEY/i,
        'no Google Maps key, so Photorealistic 3D Tiles never load — which is also why the '
        + 'engine can be slow to reach stage "done" here'],
      [/^\[BROWSER_UNHANDLED_REJECTION\] route=\/design Request has failed\.?\s*$/,
        'the rejection surfaced by those same keyless tile/API requests — scoped to this exact '
        + 'message, so a rejection saying anything else still fails this assertion'],
      [/favicon|Failed to load resource|ResizeObserver|chunk/i, 'dev-server and browser noise'],
      [/^%c%s%c\s*$/, 'a console format-string fragment, not a message'],
    ];
    const relevant = consoleErrors.filter(e => !ENVIRONMENTAL.some(([re]) => re.test(e)));
    expect(relevant,
      `unexplained console errors during the view switch:\n${relevant.join('\n')}`).toEqual([]);

    // And a positive check that the thing under test ran at all, so a silently skipped remount
    // cannot pass: the panels are still the seeded set and the studio is back in 3D.
    expect(Object.keys(after).length).toBe(8);
    await expect(page.getByRole('button', { name: /3D View/ })).toBeVisible();
  });
});
