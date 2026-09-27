/**
 * e2e/nearmap-imagery-toggle-in-3d.spec.ts
 *
 * ═══ "I AM IN THE 3D ENVIRONMENT RIGHT NOW. THERE IS NO VISIBLE NEARMAP TOGGLE." ═══
 *
 * Reported live, the second time, after the reference-imagery renderer had been built and the
 * `mapPickerState` wire connected. Both of those were real — and he was still right, in the way
 * that decides whether a feature exists. Measured in this browser, before the fix:
 *
 *     nearmapMentions: []
 *
 * — a sweep of every button, menu item and title on the page found the string "Nearmap" ZERO
 * times while in 3D. The imagery picker was on screen, visible, enabled and clickable, and the
 * only thing that named the provider was inside a closed dropdown labelled "Google", in a bar
 * labelled "Details / LiDAR / Street View". Meanwhile the 2D toolbar has a button that says
 * "🛰️ Nearmap HD" in words, rendered behind `{!show3D ? ... : null}`.
 *
 * So the first assertion below is the one that failed live: the control is FINDABLE BY NAME,
 * without opening anything. The rest is Ray's acceptance list, in order:
 *
 *   1. find the imagery selector        4. see the imagery (or an honest reason)
 *   2. click Nearmap                    5. draw/edit geometry
 *   3. remain in 3D                     6. switch back to Native   7. geometry unchanged
 *
 * ON THIS MACHINE there is no database, so the project has no stored aerial and this session has
 * loaded no Nearmap tiles — step 4 therefore resolves to the explicit-unavailability branch. That
 * is a real requirement and not a skip: "If Nearmap is unavailable to the current user/project,
 * say so explicitly. Never masquerade one provider as another."
 */

import { expect, test, type Page } from '@playwright/test';

const T = 90_000;

type E2EWin = Window & {
  __solarE2E?: { panels?: unknown[]; seedDesign?: (d: { panels?: unknown[] }) => void };
  __solarViewerE2E?: unknown;
  __solarEngineE2E?: {
    assemblies?: () => Array<{ arrayId: string; modules: Array<{ id: string; lat: number; lng: number; height: number }> }>;
    selection?: () => { groundArrayId: string | null; panelIds: string[] };
  };
};

const MPD = 111_320;
const SITE = { lat: 38.6657, lng: -90.2266 };

/** A ground mount, so there is real authored geometry to prove the toggle does not disturb. */
function seedPanels() {
  const t = 20 * Math.PI / 180;
  const rowDepth = 1.722 * Math.cos(t);
  const cosLat = Math.cos(SITE.lat * Math.PI / 180);
  const out: Record<string, unknown>[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const ns = r * rowDepth + rowDepth / 2, ew = c * 1.134 + 0.567;
      out.push({
        id: `imagery-p${r}-${c}`,
        lat: SITE.lat + ns / MPD, lng: SITE.lng + ew / (MPD * cosLat),
        height: 140.6096 + ns * Math.tan(t),
        widthFeet: 3.72, heightFeet: 5.65, tilt: 20, azimuth: 180,
        row: r, col: c, arrayRow: r, arrayId: 'ga-imagery',
        systemType: 'ground', orientation: 'portrait', wattage: 440,
        heading: 0, pitch: -t, roll: 0,
      });
    }
  }
  return out;
}

const geometry = (page: Page) => page.evaluate(() =>
  ((window as unknown as E2EWin).__solarEngineE2E?.assemblies?.() ?? [])
    .flatMap(a => a.modules)
    .map(m => ({ id: m.id, lat: m.lat, lng: m.lng, height: m.height }))
    .sort((a, b) => a.id.localeCompare(b.id)));

async function boot(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarE2E?.seedDesign,
    undefined, { timeout: T });
  await page.evaluate(p => { (window as unknown as E2EWin).__solarE2E!.seedDesign!({ panels: p }); }, seedPanels());
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarEngineE2E?.assemblies,
    undefined, { timeout: T * 2 });
  await page.waitForTimeout(1_500);
}

/**
 * Choose an imagery source through the VISIBLE segmented control.
 *
 * 🚨 DELIBERATELY NOT THROUGH THE DROPDOWN. An earlier version of this spec opened the "Source:"
 * menu and clicked a `menuitemradio` — and it passed, every time, against a product in which a
 * user could not find Nearmap at all. A spec that opens the menu can never discover that the menu
 * is the only way in. This clicks what a person clicks.
 */
async function chooseImagery(page: Page, which: 'Nearmap' | 'Native 3D') {
  const btn = page.getByTestId(which === 'Nearmap' ? 'imagery-nearmap' : 'imagery-native');
  await expect(btn, `the ${which} imagery control is not visible in the 3D studio`)
    .toBeVisible({ timeout: T });
  await btn.click();
  await page.waitForTimeout(1_200);
}

test.describe('Nearmap is reachable from the 3D Design Studio', () => {
  test.setTimeout(T * 4);

  test('🚨 the control is FINDABLE BY NAME in 3D, and choosing it gives an honest answer', async ({ page }) => {
    await boot(page);

    // ── 1. FIND IT. No menu opened, no dropdown expanded. ────────────────────
    // This is the assertion that was false live: the word "Nearmap" appeared nowhere on the page.
    const visibleNearmapControls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button,[role="menuitemradio"],[role="button"]'))
        .filter(e => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && /nearmap/i.test(e.textContent ?? '');
        })
        .map(e => (e.textContent ?? '').trim()));
    expect(visibleNearmapControls.length,
      'nothing on the 3D page names Nearmap without opening a menu — which is exactly what Ray '
      + 'reported: "There is no visible Nearmap toggle."')
      .toBeGreaterThan(0);
    await expect(page.getByTestId('imagery-toggle')).toBeVisible();
    await expect(page.getByTestId('imagery-native')).toBeVisible();
    await expect(page.getByTestId('imagery-nearmap')).toBeVisible();
    // It says which one is on, so the operator can read the state without clicking.
    await expect(page.getByTestId('imagery-toggle')).toHaveAttribute('data-imagery-source', 'native');

    // ── 2. CLICK NEARMAP ────────────────────────────────────────────────────
    await chooseImagery(page, 'Nearmap');
    await expect(page.getByTestId('imagery-toggle')).toHaveAttribute('data-imagery-source', 'nearmap');

    // ── 3. STILL IN 3D ──────────────────────────────────────────────────────
    // The button offering the OTHER view still reads "2D Map", so the studio did not switch, and
    // the engine hook is still published, so the 3D component did not unmount.
    await expect(page.getByRole('button', { name: /3D View/ }),
      'choosing Nearmap left the 3D workspace').toBeVisible();
    expect(await page.evaluate(() => !!(window as unknown as E2EWin).__solarEngineE2E?.assemblies),
      'the 3D engine unmounted when Nearmap was chosen').toBe(true);

    // ── 4. A DEFINITE, HONEST READOUT ───────────────────────────────────────
    const status = page.getByTestId('imagery-reference-status');
    await expect(status, 'choosing Nearmap produced no readout at all — the toggle is still inert')
      .toBeVisible({ timeout: T });
    const shown = page.getByTestId('imagery-reference-shown');
    const unavailable = page.getByTestId('imagery-reference-unavailable');
    // 🚨 WAIT FOR IT TO SETTLE. There is a legitimate LOADING state; sampling it immediately once
    // reported "it says nothing definite", which was impatience rather than vagueness.
    await expect(async () => {
      expect(await shown.count() + await unavailable.count(),
        'the readout is still loading — it never settled into shown or unavailable')
        .toBeGreaterThan(0);
    }).toPass({ timeout: T });

    if (await unavailable.count() > 0) {
      // No database here, so no stored aerial and no tiles this session — the product must SAY so
      // and must not substitute another provider's pixels under a Nearmap label.
      await expect(unavailable).toContainText(/unavailable/i);
      await expect(unavailable).toContainText(/nothing has been substituted/i);
    } else {
      await expect(page.getByTestId('imagery-reference-date')).toBeVisible();
      const dateText = await page.getByTestId('imagery-reference-date').innerText();
      expect(/Captured \S+|Capture date unavailable/.test(dateText),
        `the date readout says "${dateText}" — it must either state a real capture date or say it is unavailable`)
        .toBe(true);
      await expect(shown).not.toContainText('7.5 cm/px');
      await expect(shown).toContainText(/no new imagery was purchased/i);
    }

    // A provider that reaches no imagery code must not be offered as a choice.
    await page.getByRole('button', { name: /Source:/i }).click();
    await expect(page.getByTestId('map-source-option-bing'),
      'Bing is selectable although nothing in the viewer renders it').toBeDisabled();
    await expect(page.getByTestId('map-source-option-mapbox')).toBeDisabled();
    await expect(page.getByTestId('map-source-option-nearmap')).toBeEnabled();
  });

  test('🚨 geometry can still be edited with Nearmap on, and survives the switch back', async ({ page }) => {
    await boot(page);
    const before = await geometry(page);
    expect(before.length, 'the seeded geometry is not present, so this proves nothing').toBe(6);

    await chooseImagery(page, 'Nearmap');

    // ── 5. DRAW / EDIT GEOMETRY while Nearmap is the imagery source ──────────
    // A real click and a real drag on the mount, with the reference layer selected. "Preserve
    // access to custom polygon/fallback tools" — if the reference surface swallowed the pointer
    // or the engine stopped accepting edits, this is where it would show.
    const hit = await page.evaluate(() => {
      const w = window as unknown as E2EWin;
      const v = w.__solarViewerE2E as any;
      const C = (window as any).Cesium;
      if (!v || !C) return null;
      const mods = (w.__solarEngineE2E?.assemblies?.() ?? []).flatMap(a => a.modules);
      if (!mods.length) return null;
      const lat = mods.reduce((s, m) => s + m.lat, 0) / mods.length;
      const lng = mods.reduce((s, m) => s + m.lng, 0) / mods.length;
      const h = mods.reduce((s, m) => s + m.height, 0) / mods.length;
      v.camera.setView({
        destination: C.Cartesian3.fromDegrees(lng, lat - 0.00035, h + 45),
        orientation: { heading: 0, pitch: -C.Math.toRadians(58), roll: 0 },
      });
      v.scene.requestRender();
      const rect = v.canvas.getBoundingClientRect();
      let best: { x: number; y: number } | null = null;
      for (const m of mods) {
        const px = v.scene.cartesianToCanvasCoordinates(C.Cartesian3.fromDegrees(m.lng, m.lat, m.height));
        if (!px) continue;
        if (px.x < 20 || px.y < 20 || px.x > rect.width - 20 || px.y > rect.height - 20) continue;
        if (!best || px.x < best.x - rect.left) best = { x: Math.round(rect.left + px.x), y: Math.round(rect.top + px.y) };
      }
      return best;
    });
    expect(hit, 'no module could be framed, so the edit step proves nothing').toBeTruthy();
    await page.mouse.click(hit!.x, hit!.y);
    await page.waitForTimeout(600);
    expect((await page.evaluate(() =>
      (window as unknown as E2EWin).__solarEngineE2E?.selection?.().panelIds.length ?? 0)),
      'with Nearmap on, clicking a module selected nothing — the reference layer is eating the pointer')
      .toBe(6);

    await page.mouse.move(hit!.x, hit!.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(hit!.x + i * 9, hit!.y + i * 5); await page.waitForTimeout(40); }
    await page.mouse.up();
    await page.waitForTimeout(900);

    const edited = await geometry(page);
    const cosLat = Math.cos(before[0].lat * Math.PI / 180);
    const movedM = Math.hypot((edited[0].lat - before[0].lat) * MPD,
                              (edited[0].lng - before[0].lng) * MPD * cosLat);
    expect(movedM, 'the mount could not be edited while Nearmap imagery was selected')
      .toBeGreaterThan(0.1);

    // ── 6-7. SWITCH BACK, AND THE EDIT IS STILL THERE, TO THE MILLIMETRE ─────
    await chooseImagery(page, 'Native 3D');
    await expect(page.getByTestId('imagery-toggle')).toHaveAttribute('data-imagery-source', 'native');
    const after = await geometry(page);
    expect(after.map(m => m.id)).toEqual(edited.map(m => m.id));
    for (let i = 0; i < edited.length; i++) {
      const c = Math.cos(edited[i].lat * Math.PI / 180);
      const d = Math.hypot((edited[i].lat - after[i].lat) * MPD, (edited[i].lng - after[i].lng) * MPD * c);
      expect(d, `${edited[i].id} moved ${(d * 1000).toFixed(1)} mm when the imagery source changed back`)
        .toBeLessThan(0.001);
      expect(Math.abs(edited[i].height - after[i].height),
        `${edited[i].id} changed height when the imagery source changed back`).toBeLessThan(0.001);
    }
  });

  test('🚨 switching Native ↔ Nearmap ↔ Native mutates NO geometry, and costs nothing', async ({ page }) => {
    // 🚨 COUNT WHAT COSTS MONEY, NOT EVERY PIXEL FETCHED.
    //
    // A first version of this counted ESRI and Google basemap tiles too, saw 32 across five
    // toggles and called it spend. It is not: ESRI World Imagery is the FREE native basemap and
    // it re-requests tiles whenever the scene re-renders — which adding or removing a primitive
    // legitimately causes. What must stay at ZERO is the metered path: the Nearmap tile proxy.
    // And the project's own aerial-reference route must be hit AT MOST ONCE however many times
    // the source is toggled.
    const meteredRequests: string[] = [];
    const referenceRequests: string[] = [];
    page.on('request', r => {
      const u = r.url();
      if (u.includes('/api/admin/nearmap-tile/')) meteredRequests.push(u);
      if (u.includes('/aerial-reference')) referenceRequests.push(u);
    });

    await boot(page);
    const before = await geometry(page);
    expect(before.length, 'the seeded geometry is not present, so this proves nothing').toBe(6);

    const meteredBaseline = meteredRequests.length;
    const referenceBaseline = referenceRequests.length;

    for (const step of ['Nearmap', 'Native 3D', 'Nearmap', 'Native 3D', 'Nearmap'] as const) {
      await chooseImagery(page, step);
    }
    await page.waitForTimeout(1_500);

    // 🚨 GEOMETRY UNTOUCHED. "Imagery source is not geometry authority."
    const after = await geometry(page);
    expect(after.map(m => m.id), 'a module disappeared across the imagery toggles')
      .toEqual(before.map(m => m.id));
    for (let i = 0; i < before.length; i++) {
      const cosLat = Math.cos(before[i].lat * Math.PI / 180);
      const dNS = Math.abs(before[i].lat - after[i].lat) * MPD;
      const dEW = Math.abs(before[i].lng - after[i].lng) * MPD * cosLat;
      expect(Math.hypot(dNS, dEW),
        `${before[i].id} moved ${(Math.hypot(dNS, dEW) * 1000).toFixed(1)} mm when the imagery source changed`)
        .toBeLessThan(0.001);
      expect(Math.abs(before[i].height - after[i].height),
        `${before[i].id} changed height when the imagery source changed`).toBeLessThan(0.001);
    }

    // 🚨 AND THE TOGGLE BOUGHT NOTHING.
    const metered = meteredRequests.length - meteredBaseline;
    expect(metered,
      `five imagery toggles issued ${metered} METERED Nearmap tile request(s):\n`
      + meteredRequests.slice(meteredBaseline).join('\n'))
      .toBe(0);
    const refetches = referenceRequests.length - referenceBaseline;
    expect(refetches,
      `the aerial reference was requested ${refetches} times across three Nearmap selections — `
      + 'it is meant to be fetched once and reused')
      .toBeLessThanOrEqual(1);
  });
});
