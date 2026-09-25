# Provider / Native-Google Protection — Regression Audit

**Date:** 2026-09-25
**Branch:** `dev` @ `dbc6a858` (+ uncommitted 3D working-tree changes)
**Scope:** imagery + geometry provider layer, substitution guards, metered-call protection
**Method:** read-only. No test suite run. No network call made to any provider.

---

## 0. Verdict

| Question | Answer |
|---|---|
| Is native Google protection intact? | **Geometry: yes. Imagery provenance: NO.** |
| Can a fallback silently substitute? | **Yes — in the 3D viewer's imagery layer.** |
| Can a metered call fire from a hot path? | **No.** Only one `fetch` exists in the 3D engine and it is click-gated. |
| Did the recent 3D work touch any of this? | **No. Zero hunks intersect the provider region.** |
| Do tests guard it? | **No. Zero tests reference the tileset, imagery or render mode.** |

The recent pointer-gesture / shadow / shade work is **not** the problem. The provider
layer is untouched by it. The defect is older and structural, and it is a **provenance**
defect, not an availability defect — exactly the failure mode that matters most here.

---

## 1. Provider inventory

### 1.1 Google Photorealistic 3D Tiles — the native path

| Property | Value |
|---|---|
| Configured | `components/3d/SolarEngine3D.tsx:4136-4156` |
| Endpoint | `https://tile.googleapis.com/v1/3dtiles/root.json` (`:4137`) |
| Env gate | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — read at `:355` with `?? ''` |
| Key absent | Explicit `console.error` with remediation steps (`:4120-4126`), `addLog('WARN', …)` (`:4127`), `setTileStatus('failed')` (`:4128`), `setRenderMode('TERRAIN_ONLY')` (`:4129`); the tile promise is **rejected without a network call** (`:4156`) |
| Load failure | `:4186-4193` — logs, `setTileStatus('failed')`, `setRenderMode('TERRAIN_ONLY')` |

**This is fail-closed and well-instrumented.** The key check at `:4119` is a genuine guard:
it refuses to construct a `?key=` URL that would 403. Good.

On success the ellipsoid globe is hidden (`:4179`); on failure the comment at `:4177-4178`
is explicit that "the failure branch keeps `globe.show=true` so the Esri base map remains
as a fallback." The fallback is deliberate and documented **in code**. It is not disclosed
**in product** — see §2.

### 1.2 Esri ArcGIS World Imagery — the undisclosed fallback

| Property | Value |
|---|---|
| Configured | `components/3d/SolarEngine3D.tsx:4084-4088` |
| Endpoint | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (`:4085`) |
| Env gate | **None.** No key, no flag, no config. |
| Behaviour | Added **unconditionally** on every boot, before the tileset is attempted |
| Credit string | `'Esri, Maxar, GeoEye'` (`:4087`) — a Cesium credit, never surfaced (see §2.3) |

This is the substituting provider. It is keyless, always present, and free — so it can
never fail in a way that would make its presence obvious.

### 1.3 Google Solar API (buildingInsights)

| Property | Value |
|---|---|
| Client | `lib/siteSurveys/googleSolarApi/client.ts:31` (base), `:165` (URL) |
| Route | `app/api/solar/route.ts:21-23` |
| Consumed by 3D | `lib/digitalTwin.ts:373-374` → `/api/solar?endpoint=buildingInsights` |
| Env gate | `GOOGLE_SOLAR_API_KEY` → `GOOGLE_MAPS_API_KEY` → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (`client.ts:54-56`) |
| Key absent | Structured error returned, **no fetch issued** (`client.ts:137-146`) |
| Cost | $0.015/call, stated at `client.ts:16` |

Fail-closed on the key. Cache weakness in §3.2.

### 1.4 Google Elevation / DSM / static tiles / Maps session

| Path | File:line | Rate-limited |
|---|---|---|
| Elevation (direct) | `lib/digitalTwin.ts:303-304`, `:355-356` | via `/api/elevation` proxy |
| Elevation (proxy) | `app/api/elevation/route.ts:12-13` | yes |
| DSM | `app/api/dsm/route.ts:11-13`; called `lib/digitalTwin.ts:194` | yes |
| Map tile | `app/api/tile/route.ts:11-12` | **no** |
| Solar tile | `app/api/solar-tile/route.ts:27-29` | **no** |
| Maps session | `app/api/maps-session/route.ts:14-15` | yes |
| Geocode | `app/api/geocode/route.ts:136`, `:263` | yes |
| Static satellite | `lib/permit/satelliteService.ts:52`, `:90` | n/a (server) |

All carry `requireAuth`. See §3.3 for the two without rate limits.

### 1.5 Google Maps JS / Map3DElement / Street View

`components/3d/Google3DViewer.tsx` — `importLibrary('maps3d')` (`:94`), `'streetView'` (`:115`).

> **Finding (credential):** `components/3d/Google3DViewer.tsx:19` falls back to a
> **hardcoded literal API key** when `NEXT_PUBLIC_GOOGLE_MAPS_KEY` is unset. The key
> is committed in client-shipped source. The comment on `:16-18` acknowledges this and
> says to rotate and drop the literal; that has not happened. Note also this file uses
> `NEXT_PUBLIC_GOOGLE_MAPS_KEY` while `SolarEngine3D.tsx:355` uses
> `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — **two different variable names** for the same
> credential, so setting one does not configure the other.

### 1.6 Nearmap

| Property | Value |
|---|---|
| Endpoints | `lib/aerial/nearmap.ts:26` (coverage, free), `:27` (AI Features, metered), `:28` (Vert tiles) |
| Env gate | `NEARMAP_API_KEY` (`:121`) |
| Key absent | Loud `console.warn` naming the reason, returns `null` → caller falls back to Google (`:124-127`) |
| Metered gateway | `lib/aerial/nearmapCache.ts:104` — the single door to AI Features |

The `:122-123` comment — "so a Google fallback is never silent" — is the correct
instinct, and is the behaviour the 3D viewer's imagery layer lacks.

### 1.7 EagleView

`lib/siteSurveys/aerialGeometry/eagleViewProvider.ts:48-62`. Env: `EAGLEVIEW_CLIENT_ID`,
`EAGLEVIEW_CLIENT_SECRET`, `EAGLEVIEW_ENV` (defaults to `'sandbox'`, `:44`). Credentials
absent → **throws** (`:62`). Fail-closed.

### 1.8 Mock aerial provider

`lib/siteSurveys/aerialGeometry/mockProvider.ts:45` (`name = 'mock'`), `:53`
(`source: 'mock'`). **Imported only by two test files** — not reachable from any
production selection path. It stamps its own provenance. This one is correct.

### 1.9 Declared-but-unimplemented: Bing and Mapbox

`components/3d/mapSource/constants.ts:23-24` registers `bing` and `mapbox` as selectable
sources with descriptions ("Bing Maps aerial imagery", "Mapbox satellite-streets-v12").
**Neither has any implementation anywhere in the repo.** Selecting them changes a label
and nothing else. See §2.1.

---

## 2. Substitution guard — the finding

### 2.1 The source picker asserts a provider it does not control

`components/3d/mapSource/` renders a provider picker whose default is
`source: 'google'` (`constants.ts:57`) and whose trigger button displays the provider
name (`MapSourcePicker` mounted at `SolarEngine3D.tsx:15318-15320`, state at `:1711`).

**`mapPickerState.source` has exactly zero consumers.** A repo-wide grep for
`mapPickerState.` in `SolarEngine3D.tsx` returns one line:

```
17963:  {mapPickerState.tab === 'lidar' || lidar.state.dataset ? (
```

Only `.tab` is read. `.source` is written by the picker and never acted on.

This was designed in: `components/3d/mapSource/DESIGN.md:284` lists "the actual Cesium
imagery provider swap" under **"Out of scope (intentionally)"**, and `:240` calls it
"a one-liner the next session will wire in." That session never happened. What shipped
is a control that **names a provider without selecting one**.

### 2.2 The resulting failure mode is the exact one named as unacceptable

Put the two facts together:

- The basemap raster actually rendered is **Esri** (`SolarEngine3D.tsx:4084-4088`),
  unconditionally, on every boot.
- The UI says **"Google"** (`constants.ts:57` default; label asserted at
  `tests/mapSources.test.tsx:166`).

When Google 3D Tiles fail to load — no key, no coverage, 403, quota, network — the
engine sets `renderMode = 'TERRAIN_ONLY'` (`:4192`), keeps `globe.show = true`, and the
user is looking at **Esri/Maxar imagery under a control that reads "Google"**. Neither
`tileStatus` nor `renderMode` is rendered anywhere in the UI; both are internal state
(`:2444`, `:2455`). A design can be built, saved and exported in this state with no
indication that the native path was never used.

That is a fallback silently standing in for the native provider *and claiming to be it*.

### 2.3 Attribution is suppressed on both sides

- `showCreditsOnScreen: false` on the Google tileset (`SolarEngine3D.tsx:4139`) —
  suppresses Google's on-screen attribution. (Google's Photorealistic 3D Tiles terms
  require attribution display; worth a separate legal check, flagged here only because
  it is the same line of code that erases provenance.)
- The Esri credit string exists (`:4087`) but the viewer is constructed with
  `imageryProvider: false` (`:3670`) and no credit container is configured; the string
  is never shown.

So neither the native provider nor the fallback is attributed on screen. There is no
surface anywhere in the 3D viewer that tells the user which provider they are looking at.

### 2.4 What *does* work — the guards that are intact

This is not uniformly bad. Three real provenance rails exist and should not regress:

1. **Planset imagery provenance is honest.** `lib/permit/sections/sitePlan.ts:713`
   declares `imageSource?: 'nearmap' | 'google'`, and `:557` prints it on the sheet —
   `'Nearmap HD aerial · 7.5 cm/px orthophoto'` when Nearmap produced it, the generic
   `'Satellite aerial imagery'` otherwise. It **never claims Nearmap for a Google
   image.** Disclosure is asymmetric (Google is unnamed) but not false.
2. **Geometry provenance is carried structurally.** `sourcePipeline` on the unified
   geometry artifact (`lib/siteSurveys/unifiedGeometry/types.ts:258`), and the mock
   provider self-stamps `source: 'mock'` (`mockProvider.ts:53`).
3. **Missing 3D coverage is disclosed to the user.** The flat-trace path tells the user
   in words: *"Flat trace (no 3D coverage here)…"* (`SolarEngine3D.tsx:2601-2604`), and
   the deferred-entry branch names Google explicitly (`:2581`). For *geometry*, the
   product does say when the native path is unavailable.

The gap is specific: **imagery provenance in the 3D viewer.** Geometry got this right;
imagery did not.

---

## 3. Metered-call protection

### 3.1 Nearmap AI Features — the reference implementation

`lib/aerial/nearmapCache.ts` is the standard the rest should be measured against:

| Protection | Line |
|---|---|
| Durable DB cache (migration 102), not in-memory | `:28`, `:64-72` |
| **Fail-CLOSED** — cache unreadable ⇒ no live fetch | `:117-119` |
| Negative cache sentinel — no-coverage never retries | `:43`, `:131` |
| Proximity lookup (~60 m) — drift cannot mint fresh keys | `:49-51`, `:58-72` |
| One shared AOI radius so one response serves every consumer | `:47` |
| `NEARMAP_AI_CACHE_ONLY=1` freezes all live fetches | `:121-124` |

The header comment `:10-11` states the governing principle: *in-memory caches do not
survive serverless cold starts — they are NOT quota protection.*

### 3.2 Google Solar API fails OPEN — and by Nearmap's own standard, is unprotected

`lib/siteSurveys/googleSolarApi/cache.ts` is a **process-level in-memory `Map`**
(`:11-13`), 24 h TTL (`:38`), 500 entries (`:41`).

By the rule `nearmapCache.ts:10-11` states, this is not quota protection. On Vercel each
cold start begins with an empty cache, so the same building re-bills at $0.015 per call
(`client.ts:16`). On a cache miss the client proceeds to the live fetch
(`client.ts:152-165`) — **fail-open**. There is no `GOOGLE_SOLAR_CACHE_ONLY` equivalent
to `NEARMAP_AI_CACHE_ONLY`.

This is materially better than it was — `client.ts:148-151` records that the cache was
previously **write-only** and every repeat call paid again. Reading it was the fix. But
the durability gap remains, and Google Solar is the provider the 3D boot path calls on
**every** engine boot (`SolarEngine3D.tsx:4162` → `buildDigitalTwin`).

### 3.3 Two tile routes have no rate limit

Measured by counting `checkRateLimit(` call sites per route:

| Route | `checkRateLimit` calls |
|---|---|
| `app/api/geocode/route.ts` | 2 |
| `app/api/solar/route.ts` | 2 |
| `app/api/dsm/route.ts` | 1 |
| `app/api/elevation/route.ts` | 1 |
| `app/api/maps-session/route.ts` | 1 |
| `app/api/solar-rgb/route.ts` | 1 |
| **`app/api/tile/route.ts`** | **0** |
| **`app/api/solar-tile/route.ts`** | **0** |

Both have `requireAuth` (`tile:41`, `solar-tile:41`) and 24 h `Cache-Control`
(`tile:79`, `solar-tile:87`), and both reuse a session token (`tile:15-33`). But they are
the two highest-request-per-session endpoints and the only two with no rate limit. An
authenticated client in a tile loop is bounded only by Google's own quota.

### 3.4 Hot paths are clean — no metered call from mouse-move or render loop

This was checked directly and the result is good.

**`components/3d/SolarEngine3D.tsx` contains exactly one `fetch`:**

```
7465:  fetch(`/api/geocode?lat=${pickedLat}&lng=${pickedLng}`)
```

It sits inside the LEFT_CLICK handler, gated on `mode === 'pick_house'` (`:7453`), and
the mode is disarmed via `onPlacementModeChange('select')` at **`:7463`, one line before
the fetch fires**. One deliberate click ⇒ one call, and the mode cannot re-fire.

The pointer-move handlers — `pointermove`/`mousemove` at `:4003-4009` and the
render-on-demand listeners at `:4450-4451` — perform **no I/O**. The tileset is
constructed once during boot. `buildDigitalTwin` is called once, in `Promise.allSettled`
at `:4160-4163`.

**No metered external is reachable from a mouse-move, a drag or a render loop.** The
recently-added drag/duplicate/tree-cursor handlers do not change this.

---

## 4. Did the recent 3D changes touch the provider layer?

**No. Precisely: no hunk in any recent 3D commit intersects the provider region.**

The provider region in `SolarEngine3D.tsx` is **lines 3642–4240** (viewer construction at
`:3670`, imagery at `:4084`, key check at `:4119`, tileset at `:4136`, fallback branch at
`:4186`, ground datum at `:4228`).

Changed hunk ranges in `components/3d/SolarEngine3D.tsx`, per commit:

| Commit | Subject | Hunk starts | Intersects 3642–4240? |
|---|---|---|---|
| `1849fe62` | drag a site object out to real size | 2317, 7378, 7415, 7457, 15115 | no |
| `1facb464` | duplicate the selected site object | 2318, 10749, 13155, 13267, 17261 | no |
| `7542c9b4` | tree cursor shows real size | 14997 | no |
| `57d92fc0` | overlay existence authority | 17466, 17478 | no |
| `f457da25` | edge length on the edge | 98, 261, 1358, 2722, 3055, 9289 | no (3055 ends ~3101) |
| `e597533c` | tool shortcuts / banner | 219, 421, 2257, 10593, 15048, 15284, 15305, 15355 | no |
| `569c6af6` | announce the armed tool | 15317 | no |
| `68049d41` | Escape leaves tool; rise:run | 102, 2163, 10646, 10667, 10690, 15878 | no |
| `87792277` | object geometry / extrusion datum | 28, 48, 11807, 11852, 12944, 15034, 16679 | no |
| *(uncommitted)* | working tree | 2155, 2331, 2438, 2767, 3146, 7170–7624, 10950, 12171–12349, 13379, 17188 | no (3146 ends ~3281) |

Corroborated by content, not just line numbers. A keyword filter over the full diff
`87792277~1..HEAD -- components/3d/SolarEngine3D.tsx` for
`tile.googleapis|Cesium3DTileset|ImageryProvider|arcgis|/api/solar|/api/dsm|/api/elevation|buildDigitalTwin|nearmap|GOOGLE_API_KEY|fetch(`
returns **zero added or removed lines**. The same filter over the uncommitted working-tree
diff also returns **zero**.

**The pointer-gesture ownership, shadow-casting and shade re-analysis work did not touch
any provider, tileset, imagery or Solar API code.** The defects in §2 and §3.2 predate it.

---

## 5. What tests guard this today

### 5.1 Nothing guards the imagery or tileset path

A search across every `*.test.ts`, `*.test.tsx` and `*.spec.ts` in the repo for
`googleapis`, `Cesium3DTileset`, `renderMode`, `TERRAIN_ONLY`, `arcgis`, `imageryLayers`
and `tileStatus` returns **no files**.

**Would any existing test notice if the Google tileset silently stopped loading and Esri
rendered instead? No.** Nothing asserts the tileset URL is requested, nothing asserts
`renderMode === 'TILES'`, nothing asserts which imagery provider is attached. The entire
`:4081-4193` block — imagery add, key check, tileset construct, fallback branch — is
untested.

### 5.2 The one provider test asserts the claim, not the fact

`tests/mapSources.test.tsx` is thorough about the picker's state machine and asserts:

```
:57   expect(DEFAULT_PICKER_STATE.source).toBe('google');
:166  expect(screen.getByTestId('map-source-picker-label').textContent).toBe('Google');
```

It verifies that **the UI says "Google."** It cannot verify that Google rendered, because
nothing connects the two. This test would pass unchanged in a build where the Google
tileset never loads at all — it is currently the *only* automated statement about which
provider is in use, and it is a statement about a string.

### 5.3 What is tested

- `lib/aerial/nearmap*.test.ts` (5 files) — tile math, stitching, roof-plane mapping.
- `tests/planset/aerial-edge-snap.test.ts:91,99,113` — exercises both
  `imageSource: 'google'` and `imageSource: 'nearmap'` branches. **This is the closest
  thing to a provenance test in the repo**, and it is about edge-snap registration, not
  about disclosure.
- `lib/siteSurveys/googleSolarApi/__tests__/cache.test.ts` — cache semantics.

---

## 6. Recommendations, in priority order

1. **Bind the picker's displayed source to the actual active provider** *(the single
   most valuable missing guard)*. Derive one `activeImagerySource` value from
   `tileStatus`/`renderMode` and render **that**, not `mapPickerState.source`. When
   `renderMode === 'TERRAIN_ONLY'`, the UI must say Esri — or at minimum stop saying
   Google. Pair it with a test that forces the tile load to reject and asserts the UI no
   longer claims Google. This closes the §2.2 failure mode and creates the first
   automated statement that ties a rendered pixel to a named provider.
2. **Either wire `mapPickerState.source` to a real imagery swap, or remove the sources
   that do not exist.** `bing` and `mapbox` (`constants.ts:23-24`) are selectable and
   unimplemented. A picker that cannot pick is worse than no picker.
3. **Give the Google Solar API a durable cache**, modelled on `nearmapCache.ts`, plus a
   `GOOGLE_SOLAR_CACHE_ONLY` flag. It is called on every 3D boot and currently
   fails open across cold starts.
4. **Add `checkRateLimit` to `/api/tile` and `/api/solar-tile`.**
5. **Rotate and remove the hardcoded key literal at `Google3DViewer.tsx:19`**, and
   reconcile `NEXT_PUBLIC_GOOGLE_MAPS_KEY` vs `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
6. **Re-check `showCreditsOnScreen: false` (`:4139`) against Google's 3D Tiles terms.**

---

## 7. Definition of "intact" — for re-checking later

Provider protection is intact when all of the following hold:

1. `tile.googleapis.com` tileset construction is gated on a present key and fails closed. ✅ *(holds)*
2. Tileset load failure sets `renderMode = 'TERRAIN_ONLY'` and is **visible to the user**. ❌ *(state set, never rendered)*
3. Any provider name shown in the UI equals the provider that actually produced the pixels. ❌ *(picker shows `source`, which nothing consumes)*
4. Every selectable source in `SOURCES` has a real implementation. ❌ *(`bing`, `mapbox` do not)*
5. Every metered external is reached through one gateway with a durable cache and a cache-only flag. ⚠️ *(Nearmap yes; Google Solar no)*
6. No metered external is reachable from a pointer-move or render loop. ✅ *(holds — one click-gated fetch)*
7. Outbound artifacts record which provider produced the imagery. ✅ *(`sitePlan.ts:713`, printed `:557`)*
8. A test fails if the Google tileset stops loading and a fallback renders instead. ❌ *(no such test exists)*

**Score at `dbc6a858`: 4 of 8 (3 hold, 1 partial, 4 fail).**
