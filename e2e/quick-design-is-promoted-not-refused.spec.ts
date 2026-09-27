/**
 * e2e/quick-design-is-promoted-not-refused.spec.ts
 *
 * ═══ "RAY'S ACTUAL WORKING FLOW IS QUICK DESIGN" ═══
 *
 * The first version of the cost rule refused Nearmap for a Quick Design, on the reasoning that
 * imagery bought into an ephemeral object would be bought again on every toggle. The reasoning was
 * right and the product consequence was wrong:
 *
 *   "Do not buy Nearmap imagery into an ephemeral object. Instead give a resolved-address Quick
 *    Design a durable design identity before the first paid Nearmap acquisition... Ray should not
 *    have to leave Design Studio and manually build a project merely to use Nearmap."
 *
 * So the rule became "a design must be DURABLE before it buys", and choosing Nearmap in a Quick
 * Design promotes it through the persistence that already exists — `POST /api/projects`, which
 * geocodes the address and writes the row. What this spec asserts, in the real product:
 *
 *   1. the Nearmap control is ENABLED in a Quick Design — it is not the disabled button the first
 *      version would have produced;
 *   2. choosing it ATTEMPTS the promotion, through the existing project-creation route, BEFORE
 *      any imagery request;
 *   3. it promotes ONCE however many times the source is toggled;
 *   4. no paid imagery is requested when the promotion does not succeed.
 *
 * ON THIS BOX the promotion cannot complete: there is no DATABASE_URL, so `POST /api/projects`
 * fails and the design stays ephemeral. That is why (4) is assertable here and why the readout's
 * honest "no saved project yet" branch is the one exercised. The completed round trip —
 * address → acquire → persist → reload → reuse — is proved against a REAL Postgres in
 * tests/nearmapWorkzoneRoundTrip.postgres.test.ts, and against Nearmap's own servers only in Dev.
 */

import { expect, test, type Page } from '@playwright/test';

const T = 90_000;

type E2EWin = Window & {
  __solarEngineE2E?: { imagery?: () => { source: string; flatImagery: boolean } };
};

async function boot(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await page.waitForFunction(() => !!(window as unknown as E2EWin).__solarEngineE2E?.imagery,
    undefined, { timeout: T * 2 });
  await page.waitForTimeout(1_500);
}

test.describe('a Quick Design is promoted, not refused', () => {
  test.setTimeout(T * 4);

  test('🚨 the Nearmap control is live in a Quick Design, and choosing it tries to save the design', async ({ page }) => {
    const creates: string[] = [];
    const meteredTiles: string[] = [];
    const acquisitions: string[] = [];
    page.on('request', r => {
      const u = r.url();
      if (r.method() === 'POST' && /\/api\/projects$/.test(u)) creates.push(u);
      if (u.includes('/api/admin/nearmap-tile/')) meteredTiles.push(u);
      if (r.method() === 'POST' && u.includes('/aerial-reference')) acquisitions.push(u);
    });

    await boot(page);

    // 1. NOT DISABLED. The first version of the cost rule would have produced exactly that.
    const nearmap = page.getByTestId('imagery-nearmap');
    await expect(nearmap, 'the Nearmap control is missing in a Quick Design').toBeVisible();
    await expect(nearmap, 'the Nearmap control is disabled in a Quick Design — the flow Ray '
      + 'actually works in cannot reach Nearmap at all').toBeEnabled();

    // 2. Choosing it attempts the promotion, through the EXISTING project-creation route.
    await nearmap.click();
    await expect(async () => {
      expect(creates.length,
        'choosing Nearmap in a Quick Design issued no POST /api/projects — the design was not '
        + 'given a durable identity, so either it was refused outright or imagery is about to be '
        + 'bought into something ephemeral')
        .toBeGreaterThan(0);
    }).toPass({ timeout: T });

    // Let the readout settle either way.
    await expect(async () => {
      expect(await page.getByTestId('imagery-reference-shown').count()
        + await page.getByTestId('imagery-reference-unavailable').count()).toBeGreaterThan(0);
    }).toPass({ timeout: T });

    // 3. Toggle several times: the promotion is attempted once, not once per click.
    const afterFirst = creates.length;
    for (const which of ['imagery-native', 'imagery-nearmap', 'imagery-native', 'imagery-nearmap']) {
      await page.getByTestId(which).click();
      await page.waitForTimeout(900);
    }
    expect(creates.length - afterFirst,
      `four more source changes issued ${creates.length - afterFirst} further project-creation `
      + 'requests. A studio that re-posts on every toggle hammers its own API whenever the '
      + 'environment cannot save — promotion is one attempt per design, and the explicit Save '
      + 'control is the way to retry.')
      .toBe(0);

    // 4. AND NOTHING WAS BOUGHT. The promotion did not complete here (no database), so no imagery
    // may have been acquired — "Never acquire paid imagery unless there is... durable
    // owner/project/design identity".
    expect(meteredTiles.length,
      `${meteredTiles.length} metered Nearmap tile request(s) were issued from a design that has `
      + 'no durable identity').toBe(0);
    expect(acquisitions.length,
      `${acquisitions.length} acquisition request(s) were issued although the design was never `
      + 'made durable').toBe(0);

    // And the product says so, in its own words, rather than silently doing nothing.
    const unavailable = page.getByTestId('imagery-reference-unavailable');
    if (await unavailable.count() > 0) {
      await expect(unavailable).toContainText(/could not be saved|address/i);
      await expect(unavailable).toContainText(/nothing has been substituted/i);
    }
  });
});
