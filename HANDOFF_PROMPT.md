# SolarPro Dev Session Handoff
## Context for New Task Window

---

## 🔒 STANDING RULES — NEVER VIOLATE

1. **NEVER push to `master` branch** unless user explicitly says "merge it"
2. **Always work on the `dev` branch**
3. **Run the three-check suite before EVERY commit:**
   - `npx tsc --noEmit` → must be 0 errors
   - `npx eslint . --ext .ts,.tsx` → must be 0 errors (pre-existing warnings OK)
   - `npx vitest run` → must be **3424/3424** tests passing
4. **Sandbox `.git` instability**: The `.git` directory can disappear between sessions. Before every push, verify with `git log --oneline -3`. If missing, re-init:
   ```bash
   cd /workspace/solarpro-git
   git init
   git remote add origin https://github.com/rayobrian6/Solarpro.git
   git fetch origin dev
   git checkout dev
   # verify your changes are still in the working tree
   git add -A && git commit -m "..."
   git push origin dev
   ```
5. **Never force-push** unless specifically directed. A prior force-push disaster wiped the entire dev branch — recovery took hours.

---

## 📁 Project

- **Repo**: `https://github.com/rayobrian6/Solarpro.git`
- **Working branch**: `dev`
- **Local workspace**: `/workspace/solarpro-git`
- **Stack**: Next.js + TypeScript + CesiumJS (Google 3D Photorealistic Tiles)
- **Key files**:
  - `components/3d/SolarEngine3D.tsx` — entire 3D Cesium engine
  - `components/design/DesignStudio.tsx` — main design UI / sidebar
  - `lib/planeEngine.ts` — 2D ground array layout math
  - `lib/mounting/adapter.ts` — racking/mounting database

---

## 🐛 CURRENT OPEN BUGS (as of v48.33)

### Bug A — Ground mount panels render underground
**Status**: 3 fix attempts failed. Root causes identified.

**Symptom**: After placing a ground array in 3D mode, panels appear underground (invisible under the map) or disappear entirely.

**Two root causes**:

**Root cause A1 — `getGroundPlanePosition` height threshold too aggressive (SolarEngine3D.tsx ~line 2638):**
```typescript
// BROKEN — rejects valid terrain heights near sea level
const hitH = isFinite(carto.height) && carto.height > 10 ? carto.height : null;
const height = hitH ?? (cesiumGroundElevRef.current > 0 ? cesiumGroundElevRef.current : 0);
```
`globe.pick` returns ellipsoidal height. For terrain at low elevation (near sea level, or where geoid offset makes the ellipsoidal height < 10m), the `> 10` check rejects it and falls back to `cesiumGroundElevRef.current`, which may be 0. Result: `baseZ_arr = 0`, `mountPlaneZ_arr = 1.2m` → panels render at near-sea-level, which is underground at most sites.

**Fix A1**: Use `carto.height > -500` (valid ECEF range) instead of `> 10`, and ensure fallback is always `cesiumGroundElevRef.current` (which is sampled from the terrain provider at boot):
```typescript
const hitH = isFinite(carto.height) && carto.height > -500 ? carto.height : null;
const height = hitH ?? (cesiumGroundElevRef.current > 0 ? cesiumGroundElevRef.current : 0);
```

**Root cause A2 — `relayoutWithOrientation` generates 2D panels with no height field (DesignStudio.tsx):**
The right sidebar Portrait/Landscape buttons call `relayoutWithOrientation()` which generates 2D layout panels with `lat`/`lng` but **no `height` field**. These flow to SolarEngine3D via `onPanelsChange` → `panels` prop → `renderAllPanels`. In `addPanelEntity`: `const h = panel.height ?? 0` → renders at height 0 = underground.

**Fix A2** (partially done in v48.33 but broke 2D): The fix of wrapping buttons in `{!show3D && (...)}` was correct in logic BUT broke 2D mode because `show3D` defaults to `true` and the user switches to 2D manually. The portrait/landscape buttons were always hidden.

**Correct fix A2**: Instead of hiding the buttons, fix `relayoutWithOrientation` to preserve the existing panel heights when called, OR add a guard in `renderAllPanels`/`addPanelEntity` that skips panels where `height` is undefined/0 when there are already-rendered panels with valid heights.

OR — simplest correct fix: in `relayoutWithOrientation`, after generating the new 2D panels, inject the `cesiumGroundElevRef` height + `MOUNT_HEIGHT_M` into each panel if `show3D = true`. Something like:
```typescript
const relayoutWithOrientation = useCallback((newOrientation) => {
  // ... existing 2D layout logic that produces `newPanels` ...
  if (show3D && cesiumGroundElevRef > 0) {
    // inject proper height so panels don't render underground
    newPanels = newPanels.map(p => ({ ...p, height: cesiumGroundElevRef + MOUNT_HEIGHT_M }));
  }
  onPanelsChange(newPanels);
}, [...]);
```
Note: `cesiumGroundElevRef` lives in SolarEngine3D, not DesignStudio. The height would need to be passed up via a callback (`onGroundElevChange`) or stored in shared state.

**Alternative simplest fix**: Revert the `{!show3D}` wrapper added in v48.33, and instead just prevent `relayoutWithOrientation` from doing anything when `show3D = true`:
```typescript
const relayoutWithOrientation = useCallback((newOrientation) => {
  if (show3D) return; // 3D mode: SolarEngine3D handles orientation internally
  // ... rest of existing logic unchanged ...
}, [...]);
```
This is the safest single-line fix.

---

### Bug B — Ground mount cursor offset (start/end points land at wrong position)
**Status**: 3 fix attempts failed. Root cause confirmed.

**Symptom**: When clicking to set start/end points of a ground array row, the dots land at a position offset from where the cursor actually clicked. User: "It is snapping the start and the end points closer to the middle of the panel that is elevated off the ground."

**Root cause**: `scene.pick` hits elevated panel/racking geometry (~1.2m above ground = `MOUNT_HEIGHT_M`). When there are already-placed panels at the cursor position, `scene.pick` returns that panel's elevated face, not the terrain surface.

**Current state (v48.33)**: `getGroundPlanePosition` uses `globe.pick` as priority 1 (terrain-only, ignores all entities). This is the correct approach. BUT it's broken by the height threshold bug (Root cause A1 above) — when `globe.pick` height is rejected, it falls back to 0 → wrong position entirely.

**Fix B**: The `globe.pick` approach IS correct. Fix it by:
1. Fixing the `> 10` height threshold to `> -500` (Fix A1 above)
2. Ensuring `globe.pick` is actually available — it requires `depthTestAgainstTerrain` to be handling terrain. Since it's set to `false` in boot(), `globe.pick` may not work reliably. If `globe.pick` consistently returns null, fallback: use `scene.drillPick` (picks ALL objects at screen position, returns array) and find the first result that is NOT one of our entities.

**Alternative approach using `scene.drillPick`**:
```typescript
// drillPick returns array of all objects at cursor, ordered front-to-back
const picks = viewer.scene.drillPick(screenPos);
const groundPick = picks.find((p: any) => {
  const name = p?.id?.name ?? p?.primitive?.id?.name ?? '';
  return !name.startsWith('[PANEL') && !name.startsWith('[GRAC') &&
         !name.startsWith('[GND_') && !name.includes('__gracking__');
});
if (groundPick) {
  cartesian = viewer.scene.pickPosition(screenPos); // after filtering
}
```
Note: `drillPick` is expensive with many entities. Use only if `globe.pick` doesn't work.

**User insight**: "Our starting point for the cursor click should be the piller to ground point. That makes more sense to me." — the pile-to-ground point IS the terrain surface. `globe.pick` gives exactly that when it works.

---

### Bug C — Ghost grid behind panels ✅ FIXED (v48.31)
Cell grid polylines in `addPanelEntity` used `storedUx` (frame.u = along-row) as `pwDir`. For ground panels, frame.u ≠ box Y-axis (derived from HPR quaternion). Fix: always derive `pwDir`/`phDir` from orientation quaternion columns. User confirmed fixed.

---

## 📋 What's in Each Commit

| Commit | Tag | What it fixed |
|--------|-----|---------------|
| `bb90c24` | v48.30 | float height, ghost grid attempt, IronRidge guard |
| `2d815bb` | v48.31 | ghost grid ✅ (quaternion axes), click offset attempt, landscape attempt |
| `b6b71a2` | v48.32 | cursor attempt (getWorldPosition), landscape multiply fix (no onPanelsChange) |
| `f161852` | v48.33 | cursor attempt (globe.pick), landscape root cause fix attempt (broke 2D buttons) |

---

## 🏗️ Architecture Reference

### Key Constants (SolarEngine3D.tsx)
```typescript
const MOUNT_HEIGHT_M = 1.2; // ~4ft standard ground-mount racking height above grade
// depthTestAgainstTerrain = false (set in boot) — entities render above terrain regardless
// disableDepthTestDistance: Number.POSITIVE_INFINITY — all panel/racking entities always pickable
```

### Globe.pick vs Scene.pick
| API | Hits |
|-----|------|
| `viewer.scene.globe.pick(ray, scene)` | Terrain surface ONLY — ignores all Cesium entities |
| `viewer.scene.pick(screenPos)` | Any renderable — terrain, 3D tiles, AND our entities |
| `viewer.scene.pickPosition(screenPos)` | Depth buffer world position — unreliable at oblique angles |
| `viewer.scene.drillPick(screenPos)` | ALL objects at cursor, front-to-back array |

### Panel Height Flow
```
2D layout (relayoutWithOrientation):  panel.height = undefined
3D placement (handleGroundClick):     panel.height = baseZ + MOUNT_HEIGHT_M (e.g., 252.5m)
addPanelEntity:                       const h = panel.height ?? 0
                                      →  if panel.height undefined → h=0 → underground
```

### Landscape/Portrait Toggle (two separate systems)
- **2D mode**: Sidebar buttons → `relayoutWithOrientation('landscape')` → 2D layout panels (no height)
- **3D mode**: Toggle button inside SolarEngine3D → `setPanelOrientation(next)` → directly re-renders Cesium entities with new dims, does NOT call `onPanelsChange`

### cesiumGroundElevRef
- Sampled from terrain provider at boot (in `flyToLocation`)
- Line 1075: `cesiumGroundElevRef.current = cesiumGroundElev;` (from Cesium terrain sample)
- Line 806: fallback using `googleGroundElev + geoidApprox` when terrain sampling unavailable
- Used as fallback height when `globe.pick`/`scene.pick` returns bad height

---

## ✅ What Works (Don't Break)
- Ghost grid behind panels: FIXED
- Roof panel placement (all modes: 3D tiles, photorealistic)
- Fence placement (use `getWorldPosition` — works correctly, don't change this)
- IronRidge guard (button disabled, shows warning)
- All 3424 unit tests (planeEngine, mounting adapter, panel count source, etc.)
- 3D ↔ 2D toggle
- Panel count, production calc, proposal generation
- Fire setbacks, multi-row tool, pathway enforcement

---

## 🔧 Recommended Next Steps (Priority Order)

1. **Fix A2 first (safest)**: Add `if (show3D) return;` at top of `relayoutWithOrientation` in DesignStudio.tsx. Revert the `{!show3D &&}` wrapper on the orientation buttons. This restores 2D buttons AND prevents underground panels from 2D relayout in 3D mode. One-line fix, zero risk.

2. **Fix A1**: Change `carto.height > 10` to `carto.height > -500` in `getGroundPlanePosition` (~line 2638). This fixes the height threshold that causes panels to render underground when terrain height is below 10m ellipsoidal.

3. **Fix B (cursor)**: With A1 fixed, test whether `globe.pick` now gives correct results. If it still returns null/bad values (because `depthTestAgainstTerrain = false` may interfere), switch to `scene.drillPick` approach — filter out our own entities, then call `scene.pickPosition` on the remaining ground hit.

4. **Run three-check suite and commit as v48.34**.

---

## 💡 Developer Notes

- The app is a **solar panel design tool** for residential/commercial rooftops and ground mounts
- Ground mount arrays use steel racking posts (~1.2m above grade = `MOUNT_HEIGHT_M`)
- "Landscape" and "portrait" refer to panel orientation (landscape = wider than tall)
- CesiumJS renders Google Photorealistic 3D Tiles (real satellite buildings/terrain)
- `depthTestAgainstTerrain = false` is intentional — keeps panels visible even with imperfect elevation math
- The fence tool (`handleFenceClick`) uses `getWorldPosition` and works perfectly — use it as reference for any new pick logic
- The `globe.pick` API docs: https://cesium.com/learn/cesiumjs/ref-doc/Globe.html#pick
