import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';

/**
 * e2e/design-house-from-nothing.spec.ts
 *
 * 🚨 A HOUSE FROM NOTHING, THROUGH THE REAL TOOLS — NOT SEEDED FACES.
 *
 * `building-section-editing.spec.ts` builds its sections with
 * `buildSectionRoofPlanes` and seeds them in, so it never exercises the tools a
 * person actually uses. A live probe of those tools found the house could not
 * be built the way a designer reaches for it:
 *
 *   · the "New block eave" input was ignored — a 4 m Block came out at 6 m (s15);
 *   · a Block could not be given a gable: the inspector showed the roof type as
 *     a caption, and pitching the flat deck made a SHED (05e);
 *   · the walls that close a gable into a five-point house were hidden behind
 *     the 🏚 Building toggle, which defaults off (04b);
 *   · the Block's prism and its section were two masses in one place (04e).
 *
 * So this draws a Block with real canvas clicks at a 4 m eave, makes it a gable
 * with the inspector's Roof control, and asserts on what the application holds
 * and what Cesium draws: one section, two faces, no deck, six walls whose rake
 * halves meet at the ridge — and the same gable after a reload, from the
 * database.
 *
 * Section faces are user-authored geometry (`source: 'user-traced'`). Nothing
 * here treats them as anything more than that.
 *
 * Skips, loudly, without SOLARPRO_LOCAL_PG — the reload half is the point, and
 * it never pretends to pass against nothing. See e2e/README.md for the build.
 */

const LOCAL_PG = process.env.SOLARPRO_LOCAL_PG === '1';

/** Peoria, IL — the site the probe used. Footprint 12 m east-west × 9 m north-south. */
const SITE = { lat: 40.6936, lng: -89.5890, address: 'Peoria, IL' };
const GROUND_M = 127;
const BLOCK_EAVE_M = 4;
const WIDTH_M = 12;
const DEPTH_M = 9;
/** The studio's default new-roof pitch. The spec never touches that control. */
const STUDIO_PITCH_DEG = 22;
const RIDGE_ABOVE_PAD_M = BLOCK_EAVE_M + (DEPTH_M / 2) * Math.tan(STUDIO_PITCH_DEG * Math.PI / 180);

const M_LAT = 111_320;
function off(eastM: number, northM: number) {
  return {
    lat: SITE.lat + northM / M_LAT,
    lng: SITE.lng + eastM / (M_LAT * Math.cos(SITE.lat * Math.PI / 180)),
  };
}

// ── Harness ─────────────────────────────────────────────────────────────────

/**
 * 🚨 CESIUM FROM node_modules WHEN IT IS THERE. The studio loads Cesium from
 * cesium.com, which a sandbox or CI runner with egress rules cannot reach — and
 * then the viewer never boots and every assertion is about a blank canvas.
 * The same library ships in the `cesium` npm package, so serve that instead.
 * With no local package the request goes to the network as it would in a browser.
 */
async function serveCesiumLocally(page: Page): Promise<void> {
  const root = resolve(process.cwd(), 'node_modules/cesium/Build/Cesium');
  if (!existsSync(join(root, 'Cesium.js'))) return;
  const types: Record<string, string> = {
    '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
    '.xml': 'application/xml', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2',
  };
  await page.context().route(/^https:\/\/cesium\.com\/downloads\/cesiumjs\/releases\/[^/]+\/Build\/Cesium\//, async route => {
    const m = route.request().url().match(/\/Build\/Cesium\/([^?#]*)/);
    const file = resolve(root, decodeURIComponent(m ? m[1] : ''));
    if (!file.startsWith(root + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: 'not in node_modules/cesium' });
    return route.fulfill({
      status: 200,
      contentType: types[extname(file).toLowerCase()] ?? 'application/octet-stream',
      body: readFileSync(file),
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
}

async function createProject(page: Page): Promise<string> {
  const created = await page.request.post('/api/projects', {
    data: { name: `House from nothing ${Date.now()}`, address: SITE.address, systemType: 'roof', status: 'lead' },
  });
  expect([200, 201], 'creating a project through the real route').toContain(created.status());
  const id = (await created.json())?.data?.id as string;
  expect(id, 'the created project has an id').toBeTruthy();
  const put = await page.request.put(`/api/projects/${id}`, { data: { lat: SITE.lat, lng: SITE.lng, address: SITE.address } });
  expect(put.ok(), 'storing the project coordinates').toBe(true);
  return id;
}

async function waitForStudio(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__solarE2E?.seedDesign)),
    { message: 'the NEXT_PUBLIC_E2E hook never installed', timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window as any).__solarViewerE2E && !!(window as any).Cesium),
    { message: 'the 3D engine never reached stage "done"', timeout: 120_000 }).toBe(true);
}

async function nameTheProperty(page: Page): Promise<void> {
  await page.evaluate(a => (window as any).__solarE2E.pickHouse(a.lat, a.lng, a.address), SITE);
  await expect.poll(() => page.evaluate(() => (window as any).__solarE2E?.activeSiteKey ?? ''),
    { message: 'the property never got a site key — nothing could be saved', timeout: 60_000 }).not.toBe('');
}

/** Aim the camera, cancelling any flight still in progress from the site pick. */
async function aim(page: Page, opts: { headingDeg: number; pitchDeg: number; rangeM: number; h: number }) {
  await page.evaluate(({ c, o }) => {
    const v = (window as any).__solarViewerE2E; const C = (window as any).Cesium;
    try { v.camera.cancelFlight(); } catch { /* no flight */ }
    v.camera.lookAt(C.Cartesian3.fromDegrees(c.lng, c.lat, o.h),
      new C.HeadingPitchRange(C.Math.toRadians(o.headingDeg), C.Math.toRadians(o.pitchDeg), o.rangeM));
    v.camera.lookAtTransform(C.Matrix4.IDENTITY);
    v.scene.requestRender();
  }, { c: SITE, o: opts });
  await page.waitForTimeout(1200);
}

/** A real mouse click on the canvas at a ground position. Refuses to click off the canvas. */
async function clickGround(page: Page, ll: { lat: number; lng: number }, button: 'left' | 'right' = 'left') {
  const box = await page.locator('canvas').first().boundingBox();
  expect(box, 'no canvas').not.toBeNull();
  const p = await page.evaluate(({ lat, lng }) => {
    const v = (window as any).__solarViewerE2E; const C = (window as any).Cesium;
    const fn = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
    const w = fn(v.scene, C.Cartesian3.fromDegrees(lng, lat, 0));
    return w ? { x: w.x, y: w.y } : null;
  }, ll);
  expect(p && p.x > 4 && p.y > 4 && p.x < box!.width - 4 && p.y < box!.height - 4,
    `corner ${JSON.stringify(ll)} projects off the canvas at ${JSON.stringify(p)}`).toBe(true);
  await page.mouse.click(box!.x + p!.x, box!.y + p!.y, { button });
}

type Face = { id: string; sectionId: string | null; kind: string | null; eave: number | null; source: string | null };
const faces = (page: Page): Promise<Face[]> => page.evaluate(() =>
  ((window as any).__solarE2E?.roofPlanes ?? []).map((p: any) => ({
    id: p.id, sectionId: p.sectionId ?? p.section?.id ?? null, kind: p.section?.kind ?? null,
    eave: p.section?.eaveHeightM ?? null, source: p.section?.source ?? null,
  })));

/** Every wall Cesium is drawing: plan ends and the top/base heights at each. */
const walls = (page: Page) => page.evaluate(() => {
  const v = (window as any).__solarViewerE2E; const C = (window as any).Cesium; const now = C.JulianDate.now();
  return v.entities.values
    .filter((e: any) => (e.name ?? '').startsWith('[BUILD3D-WALL] ') && e.show !== false)
    .map((e: any) => ({
      name: e.name as string,
      plan: (e.wall.positions.getValue(now) as any[]).map(p => {
        const g = C.Cartographic.fromCartesian(p);
        return { lat: C.Math.toDegrees(g.latitude), lng: C.Math.toDegrees(g.longitude) };
      }),
      top: e.wall.maximumHeights.getValue(now) as number[],
      base: e.wall.minimumHeights.getValue(now) as number[],
    }));
});

/** The Block prisms and whether each is drawn. */
const prisms = (page: Page) => page.evaluate(() => {
  const v = (window as any).__solarViewerE2E; const C = (window as any).Cesium; const now = C.JulianDate.now();
  return v.entities.values.filter((e: any) => e.name === 'Building Block')
    .map((e: any) => ({ show: e.show !== false, height: e.polygon?.extrudedHeight?.getValue?.(now) }));
});

/** Click a face where Cesium draws it, trying points pulled in from each corner. */
async function selectFace(page: Page, faceId: string): Promise<boolean> {
  const box = await page.locator('canvas').first().boundingBox();
  const pts = await page.evaluate((id: string) => {
    const v = (window as any).__solarViewerE2E; const C = (window as any).Cesium; const now = C.JulianDate.now();
    const ring: any[] = [];
    for (const ent of v.entities.values) {
      const n: string = ent?.name ?? '';
      if (!(n.startsWith('[PLANE3D-') || n.startsWith('[BUILD3D-ROOF]')) || !n.endsWith(` ${id}`)) continue;
      const poly = ent.polygon?.hierarchy?.getValue?.(now);
      if (poly?.positions?.length) { ring.push(...poly.positions); break; }
    }
    if (ring.length < 3) return [];
    const c = ring.reduce((a, p) => ({ x: a.x + p.x / ring.length, y: a.y + p.y / ring.length, z: a.z + p.z / ring.length }), { x: 0, y: 0, z: 0 });
    const fn = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
    const out: Array<{ x: number; y: number }> = [];
    for (const t of [0, 0.5, 0.75]) for (const k of ring) {
      const w = fn(v.scene, new C.Cartesian3(c.x + (k.x - c.x) * t, c.y + (k.y - c.y) * t, c.z + (k.z - c.z) * t));
      if (w && isFinite(w.x)) out.push({ x: w.x, y: w.y });
    }
    return out;
  }, faceId);
  for (const p of pts) {
    if (p.x < 5 || p.y < 5 || p.x > box!.width - 5 || p.y > box!.height - 5) continue;
    await page.mouse.click(box!.x + p.x, box!.y + p.y);
    await page.waitForTimeout(500);
    if (await page.evaluate(() => (window as any).__solarE2E?.selected3DFaceId) === faceId) return true;
  }
  return false;
}

/** Group rake walls by the plan point of their HIGH end — the ridge apex. */
function gableEnds(ws: Awaited<ReturnType<typeof walls>>) {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.3;
  const eave = GROUND_M + BLOCK_EAVE_M;
  const ridge = GROUND_M + RIDGE_ABOVE_PAD_M;
  const eaveWalls = ws.filter(w => w.top.every(h => near(h, eave)));
  const rakes = ws.filter(w => {
    const [lo, hi] = [...w.top].sort((a, b) => a - b);
    return near(lo, eave) && near(hi, ridge);
  });
  const apex = (w: typeof ws[number]) => w.plan[w.top[0] > w.top[1] ? 0 : 1];
  const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    Math.hypot((a.lat - b.lat) * M_LAT, (a.lng - b.lng) * M_LAT * Math.cos(SITE.lat * Math.PI / 180));
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < rakes.length; i++) {
    for (let j = i + 1; j < rakes.length; j++) {
      if (dist(apex(rakes[i]), apex(rakes[j])) < 0.35) pairs.push([i, j]);
    }
  }
  const ridgeLengthM = pairs.length === 2 ? dist(apex(rakes[pairs[0][0]]), apex(rakes[pairs[1][0]])) : null;
  return { eaveWalls, rakes, pairs, ridgeLengthM };
}

async function shot(page: Page, testInfo: import('@playwright/test').TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

// ── The spec ────────────────────────────────────────────────────────────────

test.describe('Design: a Block becomes a visible five-point gable house — real tool clicks', () => {
  test.skip(!LOCAL_PG, 'needs SOLARPRO_LOCAL_PG=1 (in-process PostgreSQL) on the server AND this runner; see e2e/README.md');
  // Software WebGL, a production server, a reload: minutes, not seconds.
  test.setTimeout(480_000);

  test('a 4 m Block → Roof: Gable → two faces, no deck, six walls with pentagon ends — and the same after a reload', async ({ page }, testInfo) => {
    await serveCesiumLocally(page);
    const projectId = await createProject(page);
    await page.goto(`/design?projectId=${projectId}`);
    await waitForStudio(page);
    await nameTheProperty(page);

    // The pad. A sandbox has no elevation service; this is the same entry the
    // datum specs use, and it is gated on NEXT_PUBLIC_E2E.
    const datumSet = await page.evaluate(g => (window as any).__solarEngineE2E?.simulateGroundElevation?.(g), GROUND_M);
    test.skip(datumSet !== true, 'simulateGroundElevation is unavailable — the server was not built with NEXT_PUBLIC_E2E=1');
    await page.waitForTimeout(1500);

    const building = page.locator('button[title^="Building: extrude walls"]').first();
    await expect(building, 'the Building view starts off').not.toContainText('✓');

    // ── 1. Block, at a 4 m eave ────────────────────────────────────────────
    await aim(page, { headingDeg: 0, pitchDeg: -89.5, rangeM: 70, h: 0 });
    await page.getByTestId('toolgroup-building').click();
    await page.getByTestId('tool-block').click();
    const eaveInput = page.getByTestId('new-block-eave');
    await eaveInput.fill(String(BLOCK_EAVE_M));
    await expect(eaveInput).toHaveValue(String(BLOCK_EAVE_M));
    const corners = [off(-WIDTH_M / 2, -DEPTH_M / 2), off(WIDTH_M / 2, -DEPTH_M / 2),
      off(WIDTH_M / 2, DEPTH_M / 2), off(-WIDTH_M / 2, DEPTH_M / 2)];
    for (const c of corners) { await clickGround(page, c); await page.waitForTimeout(350); }
    await clickGround(page, corners[3], 'right');   // the tool's own "right-click to finish"

    await expect.poll(async () => (await faces(page)).length,
      { message: 'the Block produced no section face', timeout: 30_000 }).toBe(1);
    const [deck] = await faces(page);
    expect(deck.id, 'a Block is a flat deck').toMatch(/::deck$/);
    expect(deck.kind).toBe('flat');
    expect(deck.source, 'the section is user-authored, not derived').toBe('user-traced');
    // 🚨 s15: this was 6 — the mount-time default — whatever the input said.
    expect(deck.eave, 'the section eave is the "New block eave" input').toBe(BLOCK_EAVE_M);
    expect((await prisms(page)).map(p => p.height), 'the prism takes the same eave').toEqual([BLOCK_EAVE_M]);

    // The walls come on without pressing Building, and the prism steps aside.
    await expect(building, 'placing a section turns the Building view on').toContainText('✓');
    await expect.poll(async () => (await walls(page)).length,
      { message: 'a flat Block should stand on four walls', timeout: 20_000 }).toBe(4);
    await expect.poll(async () => (await prisms(page)).map(p => p.show),
      { message: 'the prism should hide while its section’s walls are drawn', timeout: 10_000 }).toEqual([false]);
    await aim(page, { headingDeg: 30, pitchDeg: -28, rangeM: 45, h: GROUND_M + 2 });
    await shot(page, testInfo, '01-block-4m-walls-on');

    // ── 2. Roof: Gable, in the inspector ───────────────────────────────────
    await page.keyboard.press('Escape');
    await page.getByTestId('tool-select').click();
    await aim(page, { headingDeg: 20, pitchDeg: -65, rangeM: 40, h: GROUND_M + BLOCK_EAVE_M });
    expect(await selectFace(page, deck.id), 'clicking the Block’s roof should select it').toBe(true);
    const kindRow = page.getByTestId('inspector-roof-kind');
    await expect(kindRow, 'a section shows its roof type as a control').toBeVisible();
    await expect(page.getByTestId('inspector-kind-flat')).toHaveAttribute('aria-pressed', 'true');
    await shot(page, testInfo, '02-inspector-roof-type');
    await page.getByTestId('inspector-kind-gable').click();

    await expect.poll(async () => (await faces(page)).map(f => f.id).sort(),
      { message: 'Gable should leave exactly two slopes', timeout: 20_000 })
      .toEqual([`${deck.sectionId}::slopeA`, `${deck.sectionId}::slopeB`]);
    const gable = await faces(page);
    expect(new Set(gable.map(f => f.sectionId)), 'one section, not two stacked ones').toEqual(new Set([deck.sectionId]));
    expect(gable.every(f => f.kind === 'gable')).toBe(true);
    expect(gable.every(f => f.eave === BLOCK_EAVE_M), 'the eave the Block was drawn with').toBe(true);
    expect(gable.some(f => f.id.endsWith('::deck')), 'no deck left under the gable').toBe(false);

    // ── 3. Six walls, pentagon ends — and nobody pressed Building ───────────
    await expect(building).toContainText('✓');
    await expect.poll(async () => (await walls(page)).length,
      { message: 'a closed gable house has six walls', timeout: 20_000 }).toBe(6);
    const ws = await walls(page);
    for (const w of ws) for (const b of w.base) expect(b, `${w.name} stands on the pad`).toBeCloseTo(GROUND_M, 1);
    const ends = gableEnds(ws);
    expect(ends.eaveWalls, 'two full-length eave walls').toHaveLength(2);
    expect(ends.rakes, 'four rake halves rising to the ridge').toHaveLength(4);
    expect(ends.pairs, 'each gable end: two rake halves meeting at one apex — a pentagon').toHaveLength(2);
    expect(ends.ridgeLengthM!, 'the two apexes are the two ends of the ridge').toBeGreaterThan(WIDTH_M - 1);
    await aim(page, { headingDeg: 300, pitchDeg: -18, rangeM: 38, h: GROUND_M + 2 });
    await shot(page, testInfo, '03-gable-house-pentagon-end');
    await aim(page, { headingDeg: 35, pitchDeg: -25, rangeM: 42, h: GROUND_M + 2 });
    await shot(page, testInfo, '04-gable-house-oblique');

    // The inspector now reads it as the gable it is — one section, renamed with its type.
    await aim(page, { headingDeg: 20, pitchDeg: -65, rangeM: 40, h: GROUND_M + BLOCK_EAVE_M });
    expect(await selectFace(page, `${deck.sectionId}::slopeA`), 'clicking a slope should select the section').toBe(true);
    await expect(page.getByTestId('inspector-kind-gable')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('inspector-section')).toContainText('Gable section');
    await expect(page.getByTestId('inspector-section')).toContainText('2 faces');
    await shot(page, testInfo, '04b-inspector-gable-section');
    await page.getByTestId('inspector-clear').click();

    // ── 4. Saved, and the same house after a reload ────────────────────────
    await expect.poll(async () => {
      const res = await page.request.get(`/api/projects/${projectId}/layout`);
      const j = await res.json().catch(() => null);
      return ((j?.data?.roofPlanes ?? []) as any[]).map(p => `${p.id}|${p.section?.kind}|${p.section?.eaveHeightM}`).sort();
    }, { message: 'the autosave never stored the gable', timeout: 45_000 }).toEqual([
      `${deck.sectionId}::slopeA|gable|${BLOCK_EAVE_M}`, `${deck.sectionId}::slopeB|gable|${BLOCK_EAVE_M}`,
    ]);

    await page.reload();
    await waitForStudio(page);
    await expect.poll(async () => (await faces(page)).map(f => `${f.id}|${f.kind}|${f.eave}`).sort(),
      { message: 'after a reload the design should still be the two-face gable', timeout: 60_000 })
      .toEqual([`${deck.sectionId}::slopeA|gable|${BLOCK_EAVE_M}`, `${deck.sectionId}::slopeB|gable|${BLOCK_EAVE_M}`]);
    await expect.poll(() => page.evaluate(() => (window as any).__solarE2E?.engineRoofPlaneCount ?? 0),
      { message: 'the 3D engine never drew the reloaded faces', timeout: 60_000 }).toBe(2);
    // The elevation service answers again on a real load; here the hook stands in for it, as before.
    expect(await page.evaluate(g => (window as any).__solarEngineE2E?.simulateGroundElevation?.(g), GROUND_M)).toBe(true);
    await page.waitForTimeout(1000);
    // The view toggle is not saved (a decision left to Ray); pressing it shows
    // the same closed house from the stored faces.
    if (!/✓/.test(await building.innerText())) await building.click();
    await expect.poll(async () => (await walls(page)).length,
      { message: 'the reloaded gable should close into six walls', timeout: 20_000 }).toBe(6);
    const reloaded = gableEnds(await walls(page));
    expect(reloaded.pairs, 'the reloaded house still has two pentagon ends').toHaveLength(2);
    await aim(page, { headingDeg: 300, pitchDeg: -18, rangeM: 38, h: GROUND_M + 2 });
    // Let the Building view finish redrawing (the aerial drape re-renders the roof) before the picture.
    await page.waitForTimeout(2000);
    expect((await walls(page)).length).toBe(6);
    await shot(page, testInfo, '05-after-reload');
  });
});
