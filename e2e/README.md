# SolarPro Design Studio → Planset E2E Harness

This harness covers the `/design` Design Studio path with Playwright and a small env-gated app hook. It is intentionally state-driven instead of screenshot-only so regressions in stitched roof geometry, panel placement, setback rendering, and over-eager panel rebuilds can be detected even when Cesium rendering varies by machine.

## Run

🚨 **Run against a production BUILD, not `next dev`.** Fifteen cold route compiles
make `page.goto` exceed 45 s and three tests fail on timeouts that look like
product defects. Never `next build` while a dev server is writing the same
`.next` — clear it first.

```bash
rm -rf .next
DEV_AUTH_BYPASS=true NEXT_PUBLIC_E2E=1 npx next build
DEV_AUTH_BYPASS=true NEXT_PUBLIC_E2E=1 npx next start -p 3011
E2E_BASE_URL=http://127.0.0.1:3011 NEXT_PUBLIC_E2E=1 npx playwright test
```

### If someone else is running a dev server on this repo

`next build` and `next dev` share `.next`, so building while a dev server is
serving the same checkout corrupts both. `next.config.js` reads `NEXT_DIST_DIR`,
so the E2E build can have a directory of its own:

```bash
NEXT_DIST_DIR=.next-e2e DEV_AUTH_BYPASS=true NEXT_PUBLIC_E2E=1 npx next build
NEXT_DIST_DIR=.next-e2e DEV_AUTH_BYPASS=true NEXT_PUBLIC_E2E=1 npx next start -p 3011
```

🚨 **A build with `NEXT_DIST_DIR` rewrites two tracked files** —
`next-env.d.ts` and `tsconfig.json` are regenerated to point at that directory,
because Next derives them from the active `distDir`. Put them back before
committing:

```bash
git checkout -- next-env.d.ts tsconfig.json
```

### With a real database, and no credential

`e2e/persistence-join.spec.ts` needs a database. It does **not** need the owner's
Neon credential: `SOLARPRO_LOCAL_PG=1` boots PostgreSQL compiled to WebAssembly
inside the Next server (`instrumentation.ts` → `lib/dev/pgliteNeonBridge.ts`) and
answers the driver's requests there. Route handlers, `upsertLayout` and
`rowToLayout` are untouched production code.

```bash
rm -rf .next
DEV_AUTH_BYPASS=true NEXT_PUBLIC_E2E=1 SOLARPRO_LOCAL_PG=1 npx next build
DEV_AUTH_BYPASS=true NEXT_PUBLIC_E2E=1 SOLARPRO_LOCAL_PG=1   DEV_AUTH_USER_ID=11111111-1111-4111-8111-111111111111   npx next start -p 3011
```

**You do not set `DATABASE_URL`.** The bridge points it at the in-process
database itself, using a host in the reserved `.invalid` TLD and no password.

That host can never resolve, which is the point: **if the bridge ever fails to
intercept, the query fails loudly instead of quietly talking to something real.**
Without `SOLARPRO_LOCAL_PG` those specs skip, loudly.

### Run it in two passes

```bash
npx playwright test e2e/design-studio.spec.ts e2e/panel-above-deck.spec.ts   # 11
# restart the server here
npx playwright test e2e/panel-elevation.spec.ts e2e/site-switch.spec.ts     #  9
# restart the server here
SOLARPRO_LOCAL_PG=1 npx playwright test e2e/persistence-join.spec.ts        #  4
```

All twenty-four pass, none skipped. **Restart the server between passes** — that
is not ceremony: running the last three specs together against one server
failed two of them, and the same three split across a restart passed all of
them, with individual tests dropping from 60 s to 6 s. Running them all in ONE pass against one
server intermittently fails two or three — the server reaches ~850 MB and
degrades under that many consecutive Cesium sessions, and the failures move
between runs (`read ECONNRESET`, "hook should be installed" timeouts, and
individual tests taking 60 s instead of 6 s). That is the machine, not the
product; the split, with a server restart between passes, is the supported way
to run it.

🚨 **`SOLARPRO_LOCAL_PG=1` has to be set on the PLAYWRIGHT command too**, not
just the server. `e2e/persistence-join.spec.ts` reads it from the test runner's
environment to decide whether a database is attached; without it those four
tests skip, and a skip is a pass over nothing.

### What each spec actually measures

| spec | measures | against |
|---|---|---|
| `design-studio` | studio state after real interactions | the app's own state hook |
| `panel-elevation` | `PlacedPanel.height` after Auto Layout | the `RoofPlane` it was placed from |
| `panel-above-deck` | the **Cesium entities Cesium drew** | each other |
| `site-switch` | which property a design belongs to | the studio's site model |
| `persistence-join` | a reload and A→B→A | real PostgreSQL, through the real route |

🚨 **`panel-elevation` is circular on its own and `panel-above-deck` is not.**
The first asks the placement library to check its own arithmetic — it cannot see
`addPanelEntity` or `renderPlane3DEntity`, which are different functions fed
different inputs. The second reads `[PANEL]` and `[PLANE3D-BASE]` out of the
live entity collection and measures one against the other. That is what caught
the defect where a face carrying fifty-five panels was drawn as a bare outline
with no roof deck under the array at all.

### Authentication

Every request needs `X-Dev-Auth: bypass` as well as `DEV_AUTH_BYPASS=true` —
`getDevSessionUser` AND-gates them deliberately, so a signed-in user is never
silently replaced by the dev user. `playwright.config.ts` sends the header for
every spec. Without it `/api/projects` 401s and the page redirects to
`/auth/login` mid-spec.

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
