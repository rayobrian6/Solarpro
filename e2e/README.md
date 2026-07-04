# SolarPro Design Studio → Planset E2E Harness

This harness covers the `/design` Design Studio path with Playwright and a small env-gated app hook. It is intentionally state-driven instead of screenshot-only so regressions in stitched roof geometry, panel placement, setback rendering, and over-eager panel rebuilds can be detected even when Cesium rendering varies by machine.

## Run

```bash
npm run test:e2e
```

The Playwright config starts the Next dev server with:

```bash
DEV_AUTH_BYPASS=true NEXT_PUBLIC_E2E=1 npm run dev -- -p 3000
```

You can point at an already-running server instead:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 NEXT_PUBLIC_E2E=1 npm run test:e2e
```

## Browser/runtime assumptions

The Chromium project uses software WebGL flags for sandbox/CI stability:

```text
--use-gl=angle
--use-angle=swiftshader
--enable-unsafe-swiftshader
```

Cesium and Google Photorealistic Tiles still depend on the app's normal runtime configuration and network access. If the 3D canvas cannot initialize, the spec verifies the E2E hook installation and skips the WebGL-dependent assertions with an explicit message rather than failing as a false negative.

## E2E hook

When `NEXT_PUBLIC_E2E=1`, `components/design/DesignStudio.tsx` publishes:

```ts
window.__solarE2E = {
  roofPlanes,
  panels,
  stitchedCorners,
  setbackInsets,
  fullRebuildCount,
  roofPlaneEntityCount,
  setbackBandCentroids,    // centroids of each setback band polygon (lat/lng)
  panelMoveRebuildCount,   // full rebuilds triggered during panel drag (should be 0)
};
```

`components/3d/SolarEngine3D.tsx` reports diagnostics back to Design Studio through the `onE2EDiagnostics` callback. In production/default builds, the hook is not installed and no diagnostics callback is passed.

## Regression guards (2026-06-29 bugs)

Each test in `design-studio.spec.ts` guards a specific regression:

| Test | Regression | Commit | What it catches |
|------|-----------|--------|-----------------|
| stitch holds | Stitch came apart when panels added | `0e318b58` | Shared corners between stitched planes drift beyond ~1.6m tolerance |
| adding panels doesn't un-stitch | Stitch data lost after auto layout | `0e318b58` | `stitchedCorners` array shrinks or empties after panels placed |
| panels sit ON the roof | Auto Layout dropped panels off stitched roof | stale frame | Panels land outside their roof plane polygon (point-in-polygon fail) |
| setback bands hug edges | Fire-setback bands filled middle of roof | `cf0dd96b` | Setback band centroid is closer to polygon center than to nearest edge |
| move is smooth | Moving panels was jerky / over-rebuilt | `2176e4d3` | `panelMoveRebuildCount` > 0 during drag — incremental render bypassed |
| planset PV-2 panel count | Planset draws real geometry | general | PV-2 sheet missing or PV-2 ≡ PV-2B (no differentiation) |

## Current assertions

The spec loads `/design?e2eQuickDesign=1`, waits for `window.__solarE2E`, verifies the Cesium canvas when available, then exercises each regression guard through the hook's state mirror. Tests that depend on WebGL skip gracefully with an explicit message when the canvas cannot initialize.

The fast pure-Node planset guardrails live in `tests/planset/planset-structural.test.ts` and are part of `npm test` through the existing Vitest include glob.
