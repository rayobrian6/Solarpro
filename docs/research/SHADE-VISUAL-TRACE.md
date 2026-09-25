# SHADE VISUAL TRACE — why a placed tree casts no shadow

Read-only forensic audit, 2026-09-25. Every claim is cited `file:line`. Nothing
in the repo was modified.

Reported live state: tree height ~14.15 m, canopy width ~9.2 m, solar-time
control at 09:00, tree visibly present, **no shadow anywhere**.

---

## VERDICT: **A — VISUAL SHADOW FAILURE**

The physics reaches irradiance and production. The renderer is told, explicitly
and by omission, not to draw the tree into the shadow map.

**Decisive evidence, in two lines:**

1. `components/3d/SolarEngine3D.tsx:12320` and `:12334` — the tree's trunk
   (`cylinder`) and canopy (`ellipsoid`) entity graphics are created with **no
   `shadows` key at all**.
2. `node_modules/@cesium/engine/Source/DataSources/GeometryUpdater.js:22`
   `const defaultShadows = new ConstantProperty(ShadowMode.DISABLED);`
   and `:468` `this._shadowsProperty = geometry.shadows ?? defaultShadows;`

So every tree part is `ShadowMode.DISABLED`. In Cesium that means **neither cast
nor receive**. The shadow map can be on, the sun can be in the right place, the
roof can be a perfect receiver — a `DISABLED` caster contributes nothing to the
shadow pass. Cesium version in this repo: `@cesium/engine` 23.0.1.

The same omission applies to the prism body at `:12293` (chimneys, vents,
skylights, rooftop units, hatches). **No placed object in this product can cast
a rendered shadow.** It is not tree-specific.

---

## THE CHAIN, LINK BY LINK

| # | Link | State | Evidence |
|---|---|---|---|
| 1 | Canonical tree record | **FINE** | `SolarEngine3D.tsx:13622-13646` builds one `PlacedObstruction` with `lat/lng/height/heightM/widthM/depthM/type:'tree'/space:'site'/canopyRadiusM` |
| 2 | Site transform / propagation | **FINE** | `commitPlacedObstruction` `:13423-13431` → `setObstructions` → effect `:2724` → `onObstructionsChange` → `DesignStudio.tsx:5302 setPlacedObstructions` → `placedObstructionsRef` |
| 3 | Canopy/trunk geometry as drawn | **FINE** | `lib/3d/obstructionGeometry.ts:159-206` — trunk cylinder + canopy ellipsoid, both derived from the record; absolute altitudes |
| 4 | Shade occluder registration | **FINE** | `lib/shade/canonicalShadeScene.ts:286-306` reads the same record; tree radius from `o.canopyRadiusM` |
| 5 | Sun vector for the selected solar time | **FINE — and the two clocks agree** | see §2 below |
| 6 | Numeric occlusion test | **FINE** | `canonicalShadeScene.ts:319-381 profileForPanel` → `computeShadeAnalysis` |
| 7 | Roof + panel irradiance / production | **FINE** | `DesignStudio.tsx:4800-4804` writes `annualShadeFactor`; consumed by `lib/pvwatts.ts` and the proposal derate |
| 8 | **VISUAL shadow rendering** | **BROKEN — FIRST AND ONLY BREAK IN THE PHYSICAL CHAIN** | `SolarEngine3D.tsx:12293, 12320, 12334` declare no `shadows`; Cesium defaults them to `DISABLED` |
| 9 | Per-panel shade tint overlay | **works, but is a tint on the modules — not a shadow on the roof** | `SolarEngine3D.tsx:7170-7175`, `:6844-6866` |

**First broken link: step 8 — caster registration on the tree's Cesium entity
graphics.** Everything upstream of it is correct.

---

## 1. Is Cesium's shadow map enabled at all?

Exact states, in the order they are applied:

| Where | Setting | Left at |
|---|---|---|
| `SolarEngine3D.tsx:3622` | `Viewer({ shadows: false, requestRenderMode: true, maximumRenderTimeChange: Infinity })` | shadow map **off** at construction |
| `:4049-4051` | `scene.shadowMap.enabled = false` / `softShadows = true` / `size = 1024` | **off by default** (comment says so) |
| — | `viewer.terrainShadows` | never assigned → Cesium default `ShadowMode.RECEIVE_ONLY` |
| `:7132-7135` (`updateShadeColors`) | `globe.enableLighting = shadeOn`; `shadowMap.enabled = shadeOn`; `softShadows = shadeOn`; `size = 1024` | **ON only while Shade mode is on** |
| `:4344-4355` (`camera.changed`) | retunes `shadowMap.size` / `softShadows` by camera height | never touches `.enabled` — harmless |

Per-entity shadow modes actually in the scene:

| Entity | `shadows` | Line |
|---|---|---|
| Building3D **wall** | `ShadowMode.ENABLED` | `:6148` |
| Building3D **roof polygon** | `ShadowMode.ENABLED` | `:6181` |
| Panel frame box | `ShadowMode.ENABLED` | `:6891` |
| Panel glass sheen | `DISABLED` | `:6932` |
| Racking / rails | `DISABLED` | `:4995`, `:5068` |
| LiDAR mesh | `DISABLED` | `lib/3d/lidar/meshRenderer.ts:136` |
| Google Photorealistic 3D Tileset | *(no option passed)* → Cesium default `ENABLED` | created `:4107-4127`; default at `node_modules/@cesium/engine/Source/Scene/Cesium3DTileset.js:541` |
| **Obstruction prism (chimney/vent/RTU)** | **absent → `DISABLED`** | `:12293-12315` |
| **Tree trunk (cylinder)** | **absent → `DISABLED`** | `:12320-12330` |
| **Tree canopy (ellipsoid)** | **absent → `DISABLED`** | `:12334-12342` |

So the scene has working **receivers** (tileset, Building3D roof and walls) and
working **casters** (panels, walls, roof), and the shadow map does switch on in
Shade mode. The one class of object the user expects to cast — placed objects —
is the one class excluded. Both halves of Cesium's requirement are needed; here
the scene half is satisfied and the entity half is not.

## 2. Is the clock / `scene.light` driven by the solar-time control? — YES. This link is FINE.

There are **not** two independent notions of "when". Both the rendered sun and
the numbers read the same instant:

- The slider (`:17208-17198`) writes `simHourRef.current = localH`, `setSimHour`,
  then calls `updateShadeColors()`.
- `updateShadeColors` `:7117-7126` converts local solar hour → UTC
  (`hour = ((localHour - lng/15) % 24 + 24) % 24`), builds a June-21 `Date` with
  `setUTCHours(...)`, and assigns
  `viewer.clock.currentTime = C.JulianDate.fromDate(d)` with
  `clock.shouldAnimate = false`.
- `scene.light` is never reassigned anywhere in the file (grep for `scene.light`
  / `DirectionalLight` returns nothing), so the scene keeps Cesium's default
  `SunLight`, which is driven by `frameState.time` — i.e. by that clock.
- The numeric path calls `getSunPosition(lat, lng, dLocal)` `:7153`, where
  `dLocal` is built from the *same* `hour`. `lib/solarMath.ts:71-74` derives
  true solar time from `getUTC*` plus its own longitude correction, so feeding
  it the already-corrected UTC instant is correct, not a double correction.
- `scene.requestRender()` is called twice (`:7141`, `:7144`) so
  `requestRenderMode: true` does not strand the new sun position.

Verified arithmetic for the reported case: 09:00 local solar at lng −90.046 →
15:00 UTC on 21 June. Cesium's ephemeris sun for that instant and
`getSunPosition`'s answer differ only by the equation-of-time term (~2 min).
**The rendered light direction is coupled to the same time the numbers use.**

## 3. How is the tree drawn?

Two Cesium **entities**, both from the single canonical renderer
`drawObstructionEntity` (`:12255`), which is the only draw path — used by
placement (`:13427`), reload (`:2793`) and the inspector edit (`:17566`):

- **trunk** — `cylinder` graphics, `length/topRadius/bottomRadius` from
  `buildObstructionGeometry` (`:12320-12330`)
- **canopy** — `ellipsoid` graphics, `radii` = canopy semi-axes (`:12334-12342`)

**Neither declares shadow casting.** That is the defect.

(One caveat to flag, not a second defect: the canopy material is
`.withAlpha(0.85)`. Cesium does cast shadows from translucent geometry via the
alpha-discard cast shader, so enabling the flag should produce a canopy shadow —
but this must be confirmed visually, not assumed.)

## 4. Is there a separate non-Cesium shade overlay?

Two things exist, and **neither one is a shadow**:

1. **Per-panel tint.** `shadeToColor` (`:880`) recolours each panel box by its
   `annualShadeFactor` when Shade mode is on (`:7163-7175`, `:6844-6866`). This
   *is* wired to the tree (through `annualShadeFactor`) and it *is* rendered by
   default once Shade is toggled on. It tints the **modules**; it draws nothing
   on the roof or the ground, so a shadow's shape, direction and length are
   invisible.
2. **Irradiance heatmap** (`:3262-3410`, "☀ Heatmap" toggle at `:17119`). A
   `GroundPrimitive` with `ClassificationType.CESIUM_3D_TILE` painted from
   **Google Solar API** irradiance layers. It is **not** wired to the tree at
   all — it is external data about the property, not about the design. A user
   who turns it on looking for tree shade will see a heatmap that does not
   change when the tree is added or removed.

There is **no** shadow polygon drawn on the roof anywhere in the repo.
`shadowOf()` exists in `lib/shade/canonicalShadeScene.ts:390-403` and computes a
shadow's bearing and length from the canonical occluder — but its own docstring
says it is not used by the analysis, and it has no renderer consumer.

## 5. Do the numeric and visual paths share ONE geometry? — YES.

This is the good news, and it is the thing the architecture rule protects.

- Renderer: `buildObstructionGeometry` (`lib/3d/obstructionGeometry.ts:159`)
  → canopy horizontal radius `Math.max(widthM, depthM) / 2`.
- Shade: `buildShadeScene` (`lib/shade/canonicalShadeScene.ts:291-292`) reads
  `o.canopyRadiusM`, which is written at placement by `canopyRadiusFor(widthM,
  depthM)` (`SolarEngine3D.tsx:13619`) — the helper exported *from the same
  module as the geometry builder*, precisely so the two cannot drift
  (`obstructionGeometry.ts:215-224`).
- The inspector edit patches `canopyRadiusM: v/2, widthM: v, depthM: v` together
  (`SolarEngine3D.tsx:17586-17587`).
- Both read the same base altitude: renderer `baseAltitudeM: obs.height`
  (`:12259`), shade `base = o.height` (`canonicalShadeScene.ts:288`).

**No shadow-only tree dimensions, and no renderer-only geometry, in the live
path.** The correct repair therefore does not require inventing geometry — the
drawn tree is already the shading tree.

**One dead violation exists and should be deleted** — see Defect 3 below.

## 6. Does shade visualisation require a mode? — YES, and it is not discoverable.

The shadow map is only ever on inside Shade mode (`:7133`). Shade mode is
reachable from two places:

- the Canvas-controls layer toggle `{ key: 'shade', label: 'Shade' }`
  (`:17064-17072`) — this one also calls `onRunShadeAnalysis()`;
- a second bottom-dock button `🌡 Shade` (`:17100`, handler `:17108-17113`) —
  this one **does not** run the analysis.

Neither label, nor the tree tool's own tip (`:15640`: *"Place a tree that
SHADES… and Shade uses it."*), tells the user that shadows only appear in Shade
mode. A user who places a tree and looks for a shadow has no reason to press a
toggle labelled "Shade" that, today, would still show nothing.

---

## SMALLEST CORRECT REPAIR

**It is a config flag, not missing work.** The geometry, the record, the sun and
the numbers are all already correct and already shared.

Add `shadows: C.ShadowMode.ENABLED` to the three graphics objects in
`drawObstructionEntity`:

- `SolarEngine3D.tsx:12296` `polygon: { … }` (prism body — chimneys, vents, RTUs)
- `SolarEngine3D.tsx:12322` `cylinder: { … }` (tree trunk)
- `SolarEngine3D.tsx:12336` `ellipsoid: { … }` (tree canopy)

Nothing else is required for a shadow to appear: the shadow map already switches
on in Shade mode, the clock already tracks the solar-time slider, and the Google
tileset and Building3D roof/walls already receive.

Two things must be true before this is called done, and neither can be proven by
a unit test:

1. **Screenshot it.** The acceptance suite runs software WebGL, where shadow
   maps and `drillPick` are unreliable; a green harness here proves nothing.
2. **Check the canopy's 0.85 alpha actually casts** in the real renderer.

Do **not** add a drawn shadow polygon from `shadowOf()` as a shortcut. It would
be a second visual authority over the same physics and would drift from the
shadow map the moment either changed.

---

## SECOND DEFECTS FOUND (each worth its own ticket)

**Defect 1 — the shade study never re-runs when the model changes; and there are
two Shade toggles, only one of which runs it.**
`runShadeAnalysis` (`DesignStudio.tsx:4748`) has exactly two call sites:
`SolarEngine3D.tsx:17071` (Shade layer toggle, and only on the ON transition)
and `DesignStudio.tsx:5485`, which feeds that same prop. There is **no** effect
on `placedObstructions`. So: place a tree while Shade is already on, or resize
its canopy, or delete it — and `annualShadeFactor`, the system derate and the
production estimate all stay at their previous values until the user toggles
Shade off and on again. The bottom-dock `🌡 Shade` button (`:17108-17113`) does
not call it at all, so toggling from *that* control paints stale numbers with no
warning. A production figure that silently lags the model is the class of defect
this codebase has recorded against itself repeatedly.

**Defect 2 — `ShadeAnalysisPanel.tsx` is still imported by nothing.** Its "Run
Shade Analysis" button (`components/design/ShadeAnalysisPanel.tsx:233`) is
unreachable. This is the same orphan the original shade audit flagged; it is
still orphaned, and it is the only UI that explains a shade result to a user.

**Defect 3 — `handleTreeClick` is a dead renderer-only tree geometry, still in
the file.** `SolarEngine3D.tsx:11896-11954` builds a trunk + foliage pair with
**hardcoded** `trunkHeightM = 2.0` / `foliageRadiusM = 1.8`, writes no canonical
record, and pushes into `treeEntitiesRef`. It has **no call site** — `mode ===
'tree'` routes to `handleObstructionClick` (`:7402`). It is exactly the
"renderer-only geometry" the architecture rule forbids, kept alive only by
`clearPlacedTrees` (`:12428-12434`) and `placedTreeCount`. Delete it before
someone re-wires it.

**Defect 4 — `lib/panelLOD.ts` is dead, and if it is ever wired it will fight
Shade mode.** `applyLODToViewer` (`lib/panelLOD.ts:96-127`) sets
`viewer.scene.shadowMap.enabled = false` for any camera above 300 m even when
`showShade` is true. Nothing imports the module today (grep returns only
self-references), so it is not the cause of the live failure — but it is a
latent second authority over `shadowMap.enabled`.

**Defect 5 — `components/3d/CesiumViewer.tsx` is a second, dead Cesium viewer**
with an entirely different shadow configuration (`:188` `shadows: true,
terrainShadows: ShadowMode.ENABLED`; `:532`/`:539` per-primitive modes). Nothing
imports it. It is a maintenance trap: anyone grepping for shadow configuration
finds the *working* config in the dead file and the broken one in the live file.

**Minor (not ticket-worthy on its own)** — `disableDepthTestDistance` is passed
inside `box: { … }` at `:6893` and `:6934`. That property exists on
Billboard/Label/Point graphics, not `BoxGraphics`; Cesium ignores it silently.

---

## LINKS THAT ARE GENUINELY FINE — do not touch them

- The canonical tree record and its persistence path.
- `buildObstructionGeometry` and the single `drawObstructionEntity` draw path.
- `buildShadeScene` / `profileForPanel` / `annualShadeFactor` / the PVWatts
  derate — proven numerically and by `e2e/tree-shades-production.spec.ts`.
- The solar-time → clock → `scene.light` coupling, and the agreement between the
  rendered sun and `getSunPosition`.
- The shadow map's own enable/disable logic in `updateShadeColors`.
- Receiver configuration: the Google tileset and the Building3D roof and walls
  all already receive shadows.
