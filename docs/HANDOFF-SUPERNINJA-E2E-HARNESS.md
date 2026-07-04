# SuperNinja Task — Automated Design-Studio → Planset Verification Harness

**Date:** 2026-06-29 (updated 2026-06-30) · **Owner:** Ray (rayobrian6@gmail.com) · **Branch:** `dev` (never master)
**Repo:** `C:\Users\Ray\Solarpro Claude\repo` — Next.js (App Router) + TypeScript.

> ## ⚡ STATUS UPDATE 2026-06-30 — PHASE 1 IS DONE. FOCUS ON PHASE 2.
> **Phase 1 (§2, the pure-Node planset golden/structural tests) is already built and green** —
> see `tests/planset/planset-structural.test.ts` (the exact 5 guardrails: PV-2≠PV-2B,
> panel-count fidelity, aerial centering, generation gate, no-throw smoke), plus
> `data-accuracy-audit.test.ts`, `acFeederDerating.test.ts`, `structural-wiring.test.ts`.
> **`npx vitest run tests/planset` = 25 tests passing.** Do NOT rebuild Phase 1.
>
> **Your job = Phase 2 (§3): the Playwright browser/3D Design-Studio → Generate harness** — the
> part that needs a live browser + WebGL, which is exactly where the silent 2026-06-29 regressions
> (stitch un-stitch, jerky panel move, off-roof panels, setback bands in the middle) hide. Build the
> `window.__solarE2E` state hook (§3c), the `e2e/` Playwright project (§4), and the assertions in
> §3b. If you finish Phase 2 with time to spare, extend Phase 1 coverage — don't duplicate it.
> **Coordination:** the main agent is working the planset (`lib/permit/**`, `lib/drafting/**`) in
> parallel — stay in `e2e/` + app-code hooks + `components/3d/**` reads to avoid collisions.

## 0. Mission (read this first)

SolarPro's 3D Design Studio (trace roof → stitch → auto-layout panels → generate a 16-sheet
permit planset) has **zero automated tests that exercise the UI or the 3D engine.** Every
regression there is found by Ray clicking around a live app. On 2026-06-29 a batch of 3D
regressions shipped silently and broke his workflow for hours:

- stitch came apart when panels were added (commit `0e318b58`),
- moving panels was jerky/over-rebuilt (`2176e4d3`),
- fire-setback bands filled the middle of the roof / ran down the eave (`cf0dd96b`),
- Auto Layout dropped panels off the stitched roof (stale plane frame).

All were fixed blind (no way to verify without a human in a browser). **Your job is to close
that gap: build a harness that drives the real flow and fails when any of these break again.**
This is the single highest-leverage thing to automate — it turns "a human must eyeball the 3D"
into "CI catches it."

Do the work in two phases. **Phase 1 is pure-Node and fast — ship it first.** Phase 2 is the
browser/3D harness — the bigger effort you're well-suited for.

---

## 1. Environment & access

- **Run:** `npm install`, then `npm run dev` (Next dev server, default `http://localhost:3000`).
  Production build check: `npm run build`. Typecheck: `npm run type-check`. Tests: `npm test`
  (Vitest; config `vitest.config.ts`, includes `tests/**/*.test.ts` + `lib/**/*.test.ts`).
- **Playwright is already a dependency** (`playwright@1.58.2`, `puppeteer-core@24` also present).
  There is currently **no** `e2e/` dir, no playwright config — you create them.
- **Auth bypass (critical for the harness):** the app gates pages/APIs behind a JWT session
  (`lib/auth.ts` `getUserFromRequest`). For local automation use the dev bypass in
  `lib/dev-auth.ts`: set **`DEV_AUTH_BYPASS=true`** in the dev server's env (local only; it is
  hard-disabled in prod). Read `lib/dev-auth.ts` fully to confirm the exact gate (it also checks
  `VERCEL_ENV`). If the bypass injects a fixed dev user, the harness can skip the login screen
  entirely. If not sufficient, fall back to driving `POST /api/auth/login` with a seeded test
  user and reusing the cookie via Playwright `storageState`.
- **3D needs tiles + WebGL.** The Cesium globe requires `NEXT_PUBLIC_CESIUM_ION_TOKEN` and
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Google Photorealistic 3D Tiles + Solar API). Confirm both
  are set (`/api/health/env` lists them). Headless Chromium must run with WebGL — launch with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` (software WebGL) so the
  scene renders without a GPU. Verify the canvas actually paints before asserting.
- **DB:** Neon Postgres; connection string at `C:\Users\Ray\Solarpro Claude\.db_url` (OUTSIDE
  repo, **has a UTF-8 BOM — strip `^﻿` before use**). You likely won't need it for Phase 1/2,
  but the permit route reads project rows; prefer a self-contained fixture over live DB.
- **Agents cannot call authenticated app endpoints with a real user session** — that's exactly
  why the dev bypass matters. Do not commit secrets or the `.db_url` contents.

---

## 2. Phase 1 — Planset structural/golden tests (pure Node, no browser) — DO FIRST

These need no UI. They call the real generator and assert on its HTML/SVG output. There is a
starter at `tests/_smoke_generate.test.ts` (calls `generatePermitHTML(roofProject)`); extend it.

Entry points:
- `generatePermitHTML(input, storedSldSvg?)` from `@/lib/permit` (orchestrator in
  `lib/permit/generatePermit.ts`).
- Fixtures: `test-fixtures/roofProject.ts` (12-panel roof, real lat/lng roofPlanes + panels),
  `groundProject.ts`, `fenceProject.ts`. `roofProject` is a full `PermitInput`.
- Roof CAD: `lib/cad/roof/roofCAD.ts` (`roofCAD(input)`); array sheet builder
  `lib/permit/sections/arrayPages.ts` (`pageRoofPlan`=PV-2, `pageArrayGeometry`=PV-2B).

Write `tests/planset/*.test.ts` asserting (each guards a real 2026-06-29 bug):
1. **PV-2 ≠ PV-2B.** Generate the HTML; extract the PV-2 and PV-2B `.page` blocks; assert their
   primary drawing SVGs are **not byte-identical** (they were literal duplicates before
   `arrayPages.ts` was fixed — both called `getArrayPlanFromCAD`).
2. **Panel count fidelity.** `roofCAD(roofProject)` → `cad.roof.planes.flatMap(p=>p.panels)` count
   matches the design's panel count; canonical path uses the real GPS panels, not a regenerated
   grid (see `tests/roofCADCanonicalPanels.test.ts` — extend its coverage).
3. **Aerial centering.** `chooseAerialCenter()` (exported from
   `lib/permit/sections/sitePlan.ts`) — keep/extend `tests/chooseAerialCenter.test.ts`
   (neighbor-roof case must stay green).
4. **Generation gate.** A roof project with real `roofPlanes` + GPS `panelPositions` must NOT be
   422-blocked (`tests/permitRoofGeometryGate.test.ts` — extend; the gate logic lives in
   `app/api/engineering/permit/route.ts` ~line 840, `hasRealDesignRoofGeometry`).
5. **No-throw smoke across system types:** `generatePermitHTML` returns valid HTML (>5kB,
   contains the expected sheet tags) for `roofProject`, `groundProject`, `fenceProject`.

These are fast, deterministic, and would have caught half of today's mess. Wire them into
`npm test`.

---

## 3. Phase 2 — Playwright Design-Studio → Planset E2E harness

### 3a. The flow to script
Target page: **`/design`** (`app/design/page.tsx` renders `components/design/DesignStudio.tsx`,
which embeds `components/3d/SolarEngine3D.tsx`). Use a fixed, terrain-covered test address with
known roof geometry — e.g. **3 Melvin Dr, Granite City IL 62040** (used elsewhere) or **1010
Franklin St, Pocahontas IL 62275** (pin 38.8903, -89.5710; has a persisted canonical model — see
`docs/HANDOFF-SUPERNINJA.md`).

Script the real sequence:
1. Boot dev server with `DEV_AUTH_BYPASS=true`; navigate to `/design`; wait for the Cesium canvas
   to render (poll until the scene has painted — check the `<canvas>` is non-blank, or wait on an
   app log/state hook, see 3c).
2. Enter the address / Pick House so the building + 3D tiles load. Wait for terrain sampling to
   settle (the app logs terrain readiness; `terrainReadyRef`).
3. **Trace** ≥2 roof planes (the "Mark Plane" / roof trace tool — find the tool button in
   `DesignStudio`/`SolarEngine3D` toolbars). Free-marking is intentional (no trace-time snap;
   `ENABLE_TRACE_SNAP=false`).
4. Click **Stitch** (button calls `stitchRoofVertices` in `SolarEngine3D.tsx:2928`; it sets a
   status message like `🔗 Stitched — N shared point(s) averaged`).
5. Click **Auto Layout** (`autoLayoutAll`, button at `components/design/DesignStudio.tsx:3535`,
   text "Auto Layout", `title="Auto Layout: fill all zones..."`; routes through the 3D
   `auto_roof` engine `handleAutoRoof`, `SolarEngine3D.tsx:7505`).
6. Click **Generate Permit Package** (text appears in the permit/engineering flow; the POST hits
   `/api/engineering/permit`). Capture the returned planset HTML.

### 3b. Assertions (each guards a specific 2026-06-29 regression)
- **Stitch holds:** after Stitch, planes that share a corner have those corners within ~1.6 m of
  each other (the stitch tolerance `TOL` in `stitchRoofVertices`). Read the geometry via the state
  hook (3c), not pixels.
- **Adding panels doesn't un-stitch:** assert the stitched corners are unchanged after Auto Layout
  (guards the vertices write-back, `onRoofPlanesStitched`).
- **Panels sit ON the roof:** every placed panel's center is inside its plane polygon (point-in-
  polygon on the stitched `roofPlanes[].vertices`). This is the Auto-Layout-stale-frame bug — panels
  must not land off the stitched roof.
- **Setback bands hug edges, not the middle:** the fire-setback overlay (`renderFireSetbackZones`,
  `SolarEngine3D.tsx` ~2700-2820) must not produce a band whose inset corner crosses the polygon
  centroid (the miter blow-up, `cf0dd96b`). Expose the computed inset corners via the hook and
  assert each is within `2.5×setback` of its vertex; OR screenshot-diff the overlay.
- **Move is smooth (perf guard):** with "Color strings"/"Show equipment" toggled on, dragging a
  panel must NOT rebuild every panel entity. Instrument `renderAllPanels`'s full-rebuild path
  (`forceFullRebuild`) with a counter on the hook; assert it fires 0 times on a panel move (only on
  an actual toggle). Guards `2176e4d3`.
- **Planset draws real geometry:** the generated PV-2 panel count == the studio panel count; PV-2 ≠
  PV-2B (reuse the Phase-1 extractors on the live HTML).

### 3c. Add a test-only state hook (do this in app code)
Pixel assertions alone are brittle. Add a **dev/test-gated** hook so Playwright can read real
geometry. In `SolarEngine3D.tsx` (and/or `DesignStudio.tsx`), when
`process.env.NEXT_PUBLIC_E2E === '1'`, mirror key state onto `window.__solarE2E`:
```ts
// guarded — only when NEXT_PUBLIC_E2E==='1'
(window as any).__solarE2E = {
  roofPlanes,                 // [{id, vertices:[{lat,lng}], localFrame3D}]
  panels,                     // [{id, lat, lng, row, col, planeId}]
  stitchedCorners,            // last stitch result (per-plane corner sets)
  setbackInsets,              // computed inset corners per plane (for the miter assert)
  fullRebuildCount,           // increments each renderAllPanels(forceFullRebuild=true)
};
```
Keep it strictly behind the env flag so it never ships to prod. This makes every assertion above
a clean `page.evaluate(() => window.__solarE2E…)` instead of fragile screenshot logic.

### 3d. Golden screenshots (secondary, for visual drift)
After Stitch and after Auto Layout, `page.screenshot()` the Cesium canvas region and compare to
committed baselines with a tolerance (Playwright's `toHaveScreenshot`). Software-WebGL output is
deterministic enough for a generous threshold. Store baselines under `e2e/__screenshots__/`.

---

## 4. Deliverables / acceptance criteria

1. `e2e/` with `playwright.config.ts` (software-WebGL Chromium, baseURL, webServer launching
   `npm run dev` with `DEV_AUTH_BYPASS=true NEXT_PUBLIC_E2E=1`).
2. **Phase 1:** `tests/planset/*.test.ts` — the 5 structural/golden checks in §2, green under
   `npm test`.
3. **Phase 2:** `e2e/design-studio.spec.ts` — the scripted flow in §3a with the assertions in §3b,
   green via `npx playwright test`.
4. The §3c `window.__solarE2E` hook, env-gated, in app code.
5. `package.json` scripts: `"test:e2e": "playwright test"` and ensure `npm test` runs Phase 1.
6. A short `e2e/README.md`: how to run, the test address, how to refresh golden screenshots, and
   the env vars required.
7. tsc + `npm run build` stay clean. Do not touch master. Commit on `dev` with clear messages.

## 5. Gotchas
- Cesium async: terrain + 3D tiles load over the network — **wait on app readiness signals**, not
  fixed sleeps. There are existing readiness refs/logs (`terrainReadyRef`, status messages).
- External APIs (Google Solar/Maps, Cesium Ion) cost money + rate-limit. For Phase 2, prefer ONE
  fixed address and consider recording/replaying the network (Playwright routing) so the suite is
  cheap and deterministic. Phase 1 needs no network.
- Auth: verify the dev bypass actually yields an authenticated session for BOTH page loads and the
  `/api/engineering/permit` POST; if the POST still 401s, seed a test user and use `storageState`.
- Don't assert on exact pixel colors of the satellite imagery (it changes) — assert on geometry via
  the hook and use generous screenshot thresholds only for overlay shapes.

## 6. Reference — files that matter
- `components/3d/SolarEngine3D.tsx` — 3D engine: `stitchRoofVertices` (2928), `handleAutoRoof`
  (7505), `renderFireSetbackZones` (~2700), `renderAllPanels`/`forceFullRebuild` (~3020),
  `onRoofPlanesStitched` prop (233), flags `ENABLE_TRACE_SNAP`/`ENABLE_PANEL_SNAP` (~111-126).
- `components/design/DesignStudio.tsx` — studio shell: `autoLayoutAll` (3010), Auto Layout button
  (3535), `onRoofPlanesStitched` handler (~3850), `roofPlanes`/`panels` state.
- `app/design/page.tsx` — the page.
- `lib/permit/generatePermit.ts` / `lib/permit/sections/arrayPages.ts` — planset + PV-2/PV-2B.
- `lib/permit/sections/sitePlan.ts` — `chooseAerialCenter`, `fetchAerialRoofData`.
- `app/api/engineering/permit/route.ts` — generation gate (`hasRealDesignRoofGeometry` ~840).
- `lib/dev-auth.ts`, `lib/auth.ts` — auth + bypass.
- Existing starter tests: `tests/_smoke_generate.test.ts`, `tests/roofCADCanonicalPanels.test.ts`,
  `tests/chooseAerialCenter.test.ts`, `tests/permitRoofGeometryGate.test.ts`.
