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
};
```

`components/3d/SolarEngine3D.tsx` reports diagnostics back to Design Studio through an optional callback. In production/default builds, the hook is not installed and no diagnostics callback is passed.

## Current assertions

The first spec loads `/design`, quick-launches a deterministic address when needed, waits for `window.__solarE2E`, verifies the Cesium canvas when available, toggles fire setback zones if the control is visible, runs Auto Layout if available, and checks geometry state invariants through the hook.

The fast pure-Node planset guardrails live in `tests/planset/planset-structural.test.ts` and are part of `npm test` through the existing Vitest include glob.
