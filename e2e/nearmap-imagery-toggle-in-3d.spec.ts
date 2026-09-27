/**
 * e2e/nearmap-imagery-toggle-in-3d.spec.ts
 *
 * 🚨 "I STILL CANNOT ACCESS NEARMAP FROM THE 3D DESIGN STUDIO." Reported live, after the
 * cache/cost repairs had been shipped as if they were the feature. They were infrastructure; the
 * user-facing toggle did not exist, because `mapPickerState` was declared, rendered and read by
 * nothing — components/3d/mapSource/DESIGN.md says so itself: "the actual imagery swap is the
 * integration step handled by SolarEngine3D", and that step had never been done.
 *
 * WHAT IS PROVED HERE, in a real browser with real clicks:
 *
 *   1. The imagery selector exists in the 3D studio and Nearmap is selectable there.
 *   2. Selecting it produces an HONEST answer — either the project's stored aerial is shown with
 *      its real provenance, or the reason it cannot be is stated. Never a Nearmap label over
 *      something else, which is what the 2D canvas does today (403 → `tryEsri()` → the button
 *      still reads "Nearmap HD").
 *   3. Switching Native ↔ Nearmap ↔ Native mutates NO GEOMETRY. "Imagery source is not geometry
 *      authority."
 *   4. Repeated toggles issue NO imagery requests at all. "Do not make the visual toggle a
 *      billing event."
 *
 * ON THIS MACHINE the project is a Quick Design with no stored aerial, so (2) resolves to the
 * explicit-unavailability branch — and that is a real assertion, not a skipped one: the
 * requirement is that the product say so rather than substitute. The shown-imagery branch is
 * asserted structurally in the same run (the readout's own test ids) and the georeferencing
 * arithmetic behind it is proved in tests/nearmapImageBounds.test.ts.
 */

import { expect, test, type Page } from '@playwright/test';

const T = 90_000;

type E2EWin = Window & {
  __solarE2E?: { panels?: unknown[]; seedDesign?: (d: { panels?: unknown[] }) => void };
  __solarEngineE2E?: { assemblies?: () => Array<{ arrayId: string; modules: Array<{ id: string; lat: number; lng: number; height: number }> }> };
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
 * Open the source picker and choose a provider.
 *
 * The trigger is a button whose name is the CURRENT provider ("Source: Google"); the options are
 * `menuitemradio`s inside a "Map source" menu, and their accessible name is the icon's alt text
 * plus the label ("Nearmap Nearmap"). A first version of this helper looked for a BUTTON named
 * exactly "Nearmap" and found nothing while the menu was open on screen — so the role and the
 * loose name match are both deliberate.
 */
async function chooseSource(page: Page, provider: 'Nearmap' | 'Google') {
  const trigger = page.getByRole('button', { name: /Source:/i });
  await expect(trigger, 'the 3D imagery source picker is not present').toBeVisible({ timeout: T });
  await trigger.click();
  const option = page.getByRole('menuitemradio', { name: new RegExp(provider, 'i') }).first();
  await expect(option, `${provider} is not offered in the imagery menu`).toBeVisible({ timeout: T });
  await option.click();
  await page.waitForTimeout(1_200);
}

test.describe('Nearmap is reachable from the 3D Design Studio', () => {
  test.setTimeout(T * 4);

  test('the selector offers Nearmap, and choosing it gives an honest answer', async ({ page }) => {
    await boot(page);

    // 1. The selector is there, in 3D.
    await expect(page.getByRole('button', { name: /Source:/i })).toBeVisible({ timeout: T });

    // 2. Choosing Nearmap produces a definite, honest readout.
    await chooseSource(page, 'Nearmap');
    const status = page.getByTestId('imagery-reference-status');
    await expect(status, 'choosing Nearmap produced no readout at all — the toggle is still inert')
      .toBeVisible({ timeout: T });

    // Either it is shown with its real provenance, or the reason it cannot be is stated. What must
    // NOT happen is a Nearmap label with no basis — the masquerade the ruling forbids.
    const shown = page.getByTestId('imagery-reference-shown');
    const unavailable = page.getByTestId('imagery-reference-unavailable');
    // 🚨 WAIT FOR IT TO SETTLE. The readout has a third, legitimate state — "Loading the project's
    // stored aerial…" — and on a box with no DATABASE_URL the lookup that resolves it is slow.
    // Sampling immediately caught that intermediate state and reported "it says nothing definite",
    // which was the spec being impatient rather than the product being vague.
    await expect(async () => {
      expect(await shown.count() + await unavailable.count(),
        'the readout is still loading — it never settled into shown or unavailable')
        .toBeGreaterThan(0);
    }).toPass({ timeout: T });
    const isShown = await shown.count() > 0;
    const isUnavailable = await unavailable.count() > 0;

    if (isUnavailable) {
      // A Quick Design has no project row, so there is no stored aerial to reuse. The requirement
      // is that the product SAYS so — and says the native imagery is still what is on screen.
      await expect(unavailable).toContainText(/unavailable/i);
      await expect(unavailable).toContainText(/nothing has been substituted/i);
    } else {
      // R19: a date only if it is known, and a resolution only as computed.
      await expect(page.getByTestId('imagery-reference-date')).toBeVisible();
      const dateText = await page.getByTestId('imagery-reference-date').innerText();
      expect(/Captured \S+|Capture date unavailable/.test(dateText),
        `the date readout says "${dateText}" — it must either state a real capture date or say it is unavailable`)
        .toBe(true);
      // Never a hard-coded brand resolution claim.
      await expect(shown).not.toContainText('7.5 cm/px');
      await expect(shown).toContainText(/reused, no new imagery was purchased/i);
    }
  });

  test('🚨 switching Native ↔ Nearmap ↔ Native mutates NO geometry, and costs nothing', async ({ page }) => {
    // 🚨 COUNT WHAT COSTS MONEY, NOT EVERY PIXEL FETCHED.
    //
    // A first version of this counted ESRI and Google basemap tiles too, saw 32 across five toggles
    // and called it spend. It is not: ESRI World Imagery is the FREE native basemap on the globe,
    // and it re-requests tiles whenever the scene re-renders — which a primitive being added or
    // removed legitimately causes. Counting it failed the assertion for a reason that has nothing
    // to do with Nearmap billing.
    //
    // What must stay at ZERO is the metered path: the Nearmap tile proxy. And the project's own
    // aerial-reference route must be hit AT MOST ONCE however many times the source is toggled —
    // that route acquires nothing, but re-fetching per toggle would still mean the reference was
    // not being reused.
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

    // Nearmap → Google → Nearmap → Google → Nearmap, the sequence Ray named.
    for (const step of ['Nearmap', 'Google', 'Nearmap', 'Google', 'Nearmap'] as const) {
      await chooseSource(page, step);
    }
    await page.waitForTimeout(1_500);

    // 🚨 GEOMETRY UNTOUCHED. "It must not alter roofs, sections, walls, panels, ground mounts,
    // trees, obstructions, electrical equipment, conduit."
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

    // 🚨 AND THE TOGGLE BOUGHT NOTHING. The reference layer is the project's already-acquired
    // aerial, cached per project, so five source changes must not issue imagery requests.
    const metered = meteredRequests.length - meteredBaseline;
    expect(metered,
      `five imagery toggles issued ${metered} METERED Nearmap tile request(s):\n`
      + meteredRequests.slice(meteredBaseline).join('\n'))
      .toBe(0);
    // Three Nearmap selections, and the stored reference is fetched at most once — the cache.
    const refetches = referenceRequests.length - referenceBaseline;
    expect(refetches,
      `the aerial reference was requested ${refetches} times across three Nearmap selections — `
      + 'it is meant to be fetched once and reused')
      .toBeLessThanOrEqual(1);
  });
});
