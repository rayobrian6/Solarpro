# SolarPro Design Studio — Interaction Diagnostic Report
**Version:** v31.0 | **Date:** 2026-03-09 | **Auditor:** SuperNinja

---

## ARCHITECTURE OVERVIEW

The Design Studio has **two separate rendering engines**:
- **3D Mode** (`show3D = true`, default): Cesium-based `SolarEngine3D.tsx` with its own `PlacementMode` state
- **2D Mode** (`show3D = false`): HTML5 Canvas with `DrawingMode` state

These two modes share `panels[]` state via `onPanelsChange` but have **completely independent tool state systems**.

---

## FINDINGS — 3D ENGINE (SolarEngine3D.tsx)

### BUG-3D-1: Panel entity has NO explicit `id` set → pick identification uses O(n) map scan
**Location:** `addPanelEntity()` line ~1033  
**Issue:** `viewer.entities.add({ position, orientation, box: {...} })` — no `id` field set.  
Cesium auto-generates a UUID for the entity. `handleSelectClick` then does:
```
panelMapRef.current.forEach((ent, id) => { if (ent === entity) foundId = id; })
```
This works via reference equality but is O(n) on every click. Not a correctness bug but a performance issue.

### BUG-3D-2: `handleSelectClick` uses `scene.pick()` — can be blocked by 3D tiles mesh
**Location:** `handleSelectClick()` line ~1989  
**Issue:** `viewer.scene.pick(screenPos)` returns the **topmost** rendered object. If a Google Photorealistic 3D tile mesh renders on top of a panel entity (e.g., panel is slightly inside the building mesh), the pick returns the tile, not the panel. `depthTestAgainstTerrain = false` helps visibility but does NOT affect pick order.  
**Result:** Clicking a panel that overlaps a 3D tile mesh returns the tile → `foundId = null` → `clearPanelSelection()` is called → panel cannot be selected.

### BUG-3D-3: `handleRoofClick` places a panel on EVERY left-click while in `roof` mode
**Location:** `handleRoofClick()` line ~1260  
**Issue:** The `roof` PlacementMode places a panel at every click position. There is no "select roof segment first" behavior. The right-click ends the sequence. This is by design but creates confusion: users expect clicking a roof to SELECT it, not immediately place a panel.

### BUG-3D-4: Delete/Backspace only works when `modeRef.current === 'select'`
**Location:** `setupKeyboardHandler()` line ~2024  
**Issue:** `if ((e.key === 'Delete' || e.key === 'Backspace') && modeRef.current === 'select' && selectedPanelIdRef.current)` — correct guard, but if user accidentally switches mode, Delete stops working. Also: the keyboard handler is set up once in `boot()` and uses `modeRef` correctly via ref.

### BUG-3D-5: No `drillPick` used — only top-level pick
**Location:** `handleSelectClick()` line ~1989  
**Issue:** `viewer.scene.pick()` only returns the topmost object. `viewer.scene.drillPick()` returns ALL objects at that screen position in depth order. Using `drillPick` would allow finding panel entities even when partially occluded by terrain/tile mesh.

### BUG-3D-6: `placementMode3D` state in DesignStudio is NOT synced back from SolarEngine3D toolbar
**Location:** SolarEngine3D internal toolbar (line ~2614) calls `onPlacementModeChange(mode)` ✅  
**Issue:** The right-panel "3D Panel Placement" buttons in DesignStudio also call `setPlacementMode3D(mode)` ✅. These are in sync. **No bug here.**

---

## FINDINGS — 2D ENGINE (DesignStudio.tsx canvas)

### BUG-2D-1: `multiRowMode` is a SEPARATE boolean that overrides `drawingMode` — creates dual-mode conflict
**Location:** `handleCanvasClick()` line ~1245  
**Issue:** When `multiRowMode = true`, clicks are routed to `handleMultiRowClick` regardless of `drawingMode`. But `multiRowMode` is NOT cleared when switching `drawingMode` via the toolbar. So:
- User activates Multi-Row tool
- User clicks "Select" in toolbar → `drawingMode = 'select'` but `multiRowMode` still `true`
- Clicking the canvas routes to `handleMultiRowClick` instead of panel selection
- **Result:** Select tool appears active but clicks place rows instead of selecting panels

### BUG-2D-2: Panel hit detection uses `selectedPanel.width/height` not per-panel dimensions
**Location:** `handleCanvasClick()` select branch, line ~1261  
**Issue:** 
```js
const pw = selectedPanel.width * pxPerM;  // uses CURRENT selected panel type
const ph = selectedPanel.height * pxPerM;
```
If the user changes the panel model after placing panels, the hit box no longer matches the visual size. Also ignores `panel.orientation` — a landscape panel has swapped w/h but hit detection uses portrait dimensions.  
**Result:** Panels placed in landscape orientation cannot be selected (hit box is wrong size/shape).

### BUG-2D-3: Panel rendering uses `project.systemType` for color — ignores `panel.systemType`
**Location:** `drawCanvas()` line ~962  
**Issue:**
```js
const color = project.systemType === 'roof' ? '#f59e0b' : ...
```
All panels render the same color regardless of their individual `systemType`. In mixed-system designs (roof + ground panels), all panels show the same color.  
**Result:** Visual confusion in mixed designs, but NOT a functional bug for classification.

### BUG-2D-4: No keyboard shortcut handler for Delete/Backspace in 2D mode
**Location:** No `window.addEventListener('keydown', ...)` in DesignStudio.tsx  
**Issue:** The only deletion mechanism in 2D mode is the toolbar Trash button (visible only when `selectedPanelIds.size > 0`). There is **no keyboard Delete/Backspace handler** for the 2D canvas.  
**Result:** Users cannot delete panels with keyboard in 2D mode.

### BUG-2D-5: No keyboard shortcuts for tool switching (V/R/G/F/M shown in tooltips but not wired)
**Location:** Toolbar tool buttons show `key: 'V'`, `key: 'R'` etc. in tooltips  
**Issue:** No `useEffect` with `window.addEventListener('keydown')` to handle these shortcuts.  
**Result:** Keyboard shortcuts shown in UI but non-functional.

### BUG-2D-6: `drawingMode` cursor shows `crosshair` for ALL non-select modes including after finalizeDrawing
**Location:** Canvas `style={{ cursor: drawingMode === 'select' ? ... : 'crosshair' }}`  
**Issue:** After `finalizeDrawing()`, `drawingMode` is set back to `'select'` ✅ — this is correct.

### BUG-2D-7: `finalizeDrawing()` auto-switches to `'select'` mode ✅ — this is CORRECT behavior
No bug here.

### BUG-2D-8: Active Zone Type switcher in sidebar sets `drawingMode` but toolbar buttons also set `drawingMode`
**Location:** Configuration section "Active Drawing Zone" buttons (line ~2099)  
**Issue:** These buttons set `activeZoneType` AND `drawingMode` (draw_roof/draw_ground/draw_fence). The toolbar buttons also set `drawingMode`. These are redundant but consistent. **Minor UX confusion** — two places to set the same thing.

---

## FINDINGS — TOOL STATE SYSTEM

### BUG-TOOL-1: No single source of truth for "active tool"
**Issue:** Tool state is spread across:
- `drawingMode: DrawingMode` (2D canvas tool)
- `placementMode3D: PlacementMode` (3D engine tool)  
- `multiRowMode: boolean` (separate override flag)
- `activeZoneType: SystemType` (which zone type is active)

These are independent and can conflict. Example: `multiRowMode=true` + `drawingMode='select'` = broken select.

### BUG-TOOL-2: No active tool indicator visible on canvas
**Issue:** The only tool feedback is the cursor shape (grab vs crosshair) and toolbar button highlight. No persistent "Active Tool: X" label on the canvas.

### BUG-TOOL-3: Switching to Select tool does NOT deactivate multiRowMode
**Location:** Toolbar tool onClick (line ~1831)  
**Issue:** `setDrawingMode(tool.id)` does not call `setMultiRowMode(false)`.

---

## SUMMARY OF BUGS BY PRIORITY

| # | Bug | Severity | Engine |
|---|-----|----------|--------|
| 1 | `multiRowMode` not cleared on tool switch → blocks Select | **HIGH** | 2D |
| 2 | Panel hit detection uses wrong dimensions (ignores orientation) | **HIGH** | 2D |
| 3 | `scene.pick()` blocked by 3D tiles → panels unselectable | **HIGH** | 3D |
| 4 | No keyboard Delete/Backspace in 2D mode | **MEDIUM** | 2D |
| 5 | No keyboard shortcuts (V/R/G/F/M) wired up | **MEDIUM** | 2D |
| 6 | Panel color uses `project.systemType` not `panel.systemType` | **LOW** | 2D |
| 7 | No active tool indicator on canvas | **LOW** | Both |
| 8 | `drillPick` not used → single-layer pick only | **MEDIUM** | 3D |
| 9 | Roof tool places panel immediately (no select-first flow) | **DESIGN** | 3D |

---

## SAFE TO FIX (no pipeline impact)
All bugs above are in the **interaction layer only**. Fixes will NOT touch:
- `panels[]` array structure
- `systemType` classification on panels
- `autoPlacePanels()` / `fillRoof()` / `optimizeLayout()`
- Engineering pipeline inputs
- Proposal generation
- BOM generation
- Cost line items