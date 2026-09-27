/**
 * e2e/nearmap-toggle-does-not-rebuy-imagery.spec.ts
 *
 * 🚨 RAY'S COST PROOF, IN HIS OWN TERMS: "Nearmap is expensive. Repeated display toggles must
 * not blindly reacquire the same imagery." And the test he named:
 * `Nearmap → Native → Nearmap → Native → Nearmap`.
 *
 * WHAT WAS WRONG. `TILE_CACHE` in components/design/DesignStudio.tsx was keyed `"z/x/y"` with no
 * provider component, so switching provider HAD to clear the whole cache — otherwise Google
 * tiles would have been drawn as Nearmap. The provider button's handler did exactly that:
 *
 *     setTileProvider(p);
 *     TILE_CACHE.clear(); TILE_INFLIGHT.clear(); setMapTiles(new Map());
 *
 * so every return to Nearmap discarded every Nearmap tile and re-requested all of them —
 * `loadTiles` only skips a key it already holds, and the clear had removed it. On this viewport
 * that is a (ceil(W/256)+3) × (ceil(H/256)+3) grid, i.e. dozens of requests per toggle-back,
 * against a metered paid endpoint. The only thing between that and dozens of paid calls was the
 * proxy's `Cache-Control: private, max-age=86400` — a per-browser HTTP cache, defeated by a hard
 * reload, devtools "Disable cache", a private window, eviction, or a second viewer, and
 * invisible to any quota accounting.
 *
 * WHAT THIS MEASURES. Every browser request to the Nearmap tile proxy
 * (`/api/admin/nearmap-tile/...`) is counted, per activation. The first activation must fetch
 * tiles — otherwise the spec is measuring nothing. The SECOND and THIRD activations of the same
 * view must not re-fetch them.
 *
 * 🚨 THIS TEST COSTS NOTHING. It counts requests the BROWSER issues; it never needs a real
 * Nearmap response. This box has no NEARMAP_API_KEY and the proxy is admin-gated, so the route
 * answers 403/500 and no paid upstream call is made either way. The assertion is about how many
 * times the application ASKS, which is the thing that spends money in production.
 */

import { expect, test } from '@playwright/test';

const T = 90_000;

test.describe('toggling imagery providers does not re-buy Nearmap tiles', () => {
  test('Nearmap → Google → Nearmap → Google → Nearmap re-fetches only the first time', async ({ page }) => {
    test.setTimeout(T * 4);

    /** Nearmap proxy requests, and SUCCESSFUL responses, bucketed by activation. */
    let bucket = 0;
    const perBucket: number[] = [0, 0, 0, 0, 0, 0];
    const okPerBucket: number[] = [0, 0, 0, 0, 0, 0];
    page.on('request', r => {
      if (r.url().includes('/api/admin/nearmap-tile/')) perBucket[bucket]++;
    });
    page.on('response', r => {
      if (r.url().includes('/api/admin/nearmap-tile/') && r.status() === 200) okPerBucket[bucket]++;
    });

    await page.goto('/design?e2eQuickDesign=1');

    // The provider buttons only render in 2D — they are inside `{!show3D ? (…) : null}`.
    const view = page.getByRole('button', { name: /3D View|2D Map/ });
    await expect(view).toBeVisible({ timeout: T });
    await view.click();
    await expect(page.getByRole('button', { name: /2D Map/ })).toBeVisible({ timeout: T });

    // The labels carry emoji: '🛰️ Nearmap HD' and 'Google'. Matched on the
    // distinctive word rather than an exact string so a label tweak does not silently
    // stop finding the button (a not-found locator would fail loudly, not pass).
    const nearmap = page.getByRole('button', { name: /Nearmap HD/i });
    const google  = page.getByRole('button', { name: /^Google$/i });
    await expect(nearmap).toBeVisible({ timeout: T });
    await expect(google).toBeVisible({ timeout: T });

    // loadTiles is debounced 80 ms and the images resolve asynchronously; a second of quiet is
    // enough for a grid to be requested and far short of anything that would mask a re-fetch.
    const settle = async () => { await page.waitForTimeout(1_500); };

    bucket = 0; await nearmap.click(); await settle();   // activation 1 — must fetch
    bucket = 1; await google.click();  await settle();
    bucket = 2; await nearmap.click(); await settle();   // activation 2 — must NOT re-fetch
    bucket = 3; await google.click();  await settle();
    bucket = 4; await nearmap.click(); await settle();   // activation 3 — must NOT re-fetch

    const [first, , second, , third] = perBucket;
    const firstOk = okPerBucket[0];

    // 🚨 PRECONDITION, AND IT IS A HARD SKIP RATHER THAN A PASS.
    //
    // Requesting a tile is not the same as CACHING one. If the first activation got no 200 back,
    // nothing entered the cache, so there is nothing to re-use and "0 re-requests" on the second
    // activation is meaningless — it would be a green test proving nothing, which is exactly the
    // blind-guard shape this campaign keeps finding. An earlier version of this spec asserted on
    // requests alone and PASSED AGAINST THE UNFIXED COMPONENT for precisely that reason.
    //
    // It happens on any box without a NEARMAP_API_KEY and an admin session: the proxy is
    // admin-gated (`requireAdminApi`), so it answers 403, `img.onerror` fires, and
    // DesignStudio's `tryEsri()` silently swaps in ESRI — which this harness then blocks too,
    // because playwright.config.ts applies `X-Dev-Auth` to cross-origin requests and ArcGIS
    // rejects that header in preflight. So on a developer machine NO 2D provider loads, and this
    // property is unmeasurable here.
    //
    // On a real environment it becomes meaningful automatically. The mechanism it guards —
    // the provider being part of the `TILE_CACHE` key instead of the cache being cleared on
    // every provider click — is asserted at unit level by
    // tests/tileCacheSurvivesAProviderToggle.test.ts, which does discriminate.
    test.skip(firstOk === 0,
      `UNMEASURABLE HERE: the first Nearmap activation issued ${first} request(s) and got `
      + `${firstOk} 200 response(s), so nothing was cached and a zero re-fetch count would prove `
      + `nothing. Needs NEARMAP_API_KEY and an admin session. Not a pass and not a failure.`);

    // THE ASSERTIONS. Returning to a provider whose tiles are already held must not re-ask.
    expect(second,
      `returning to Nearmap re-requested ${second} tiles (first activation cached ${firstOk}) — `
      + 'a display toggle is re-buying imagery').toBe(0);
    expect(third,
      `the third Nearmap activation re-requested ${third} tiles — the cache is not surviving `
      + 'repeated toggles').toBe(0);
  });
});
