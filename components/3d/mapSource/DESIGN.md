# MapSourcePicker — DESIGN

> Aurora 2017 reDesigned parity: the multi-source map toggle (`Details ▼` / `LiDAR | Street View` / `[Google ▼]`) that lives in the top bar of the Site Model / 3D viewer.

**Owner:** `map-sources` agent
**Scope:** `components/3d/mapSource/` (new) + minimal mount in `components/3d/SolarEngine3D.tsx`

---

## 1. Aurora parity bar

From `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §1 and frames 70 / 130 / 140, the top bar of Aurora's 3D viewer shows, in this order:

```
[Save] [Undo] [Redo]   …   [Details ▼]   [LiDAR | Street View]   [▲ Google ▼]   [Export] [Settings]
```

For this feature, only the three right-of-center controls are in scope:

1. **`Details ▼`** — dropdown of overlay layers (Imagery, Tree coverage, Sun path, Shade, Irradiance, etc.). Each layer is a checkbox. Default-on state for `imagery`.
2. **`LiDAR | Street View`** — two-tab segmented control. Mutually exclusive. Active tab is filled. Toggling rebuilds the main source layer (`lidar-integration` swaps the LiDAR mesh; `street-view` swaps the imagery provider).
3. **`[icon] Google ▼`** — source picker dropdown listing all four providers. The icon at the left of the label is the provider's brand mark (Google = green mountain; Bing = four-color square; Mapbox = blue square with white map; Nearmap = orange plane). Switching calls `onChange` with the new `MapSource`; the actual imagery swap is the integration step handled by `SolarEngine3D`.

**Active state rules:**
- Tabs: active = white background, dark text. Inactive = dark background, muted text.
- Picker trigger: shows the current provider name + icon. A green dot appears next to the active item in the dropdown.
- Details: the button text shows the number of active layers (`Details (3) ▼` when 3 layers are on).

---

## 2. State model

### 2.1 Types

```ts
// Source provider (raster basemap behind the 3D model)
export type MapSource = 'google' | 'bing' | 'mapbox' | 'nearmap';

// Tab — main source toggle
export type MapTab = 'streetView' | 'lidar';

// Layer — overlay layer toggled in the Details dropdown
export type MapLayer =
  | 'imagery'        // satellite/aerial raster
  | 'treeCoverage'   // LiDAR-derived canopy polygons
  | 'parcels'        // parcel boundaries
  | 'sunPath'        // annual sun-path arc
  | 'shadeMap'       // shadow heatmap
  | 'irradiance';    // irradiance heatmap

// Full state shape
export interface MapPickerState {
  source: MapSource;
  tab: MapTab;
  layers: Set<MapLayer>;     // active layers
}
```

### 2.2 Source registry

```ts
export const SOURCES: ReadonlyArray<{
  id: MapSource;
  label: string;
  iconKey: 'google' | 'bing' | 'mapbox' | 'nearmap';
  description: string;
}> = [
  { id: 'google', label: 'Google',   iconKey: 'google', description: 'Google satellite (zoom 21)' },
  { id: 'bing',   label: 'Bing',     iconKey: 'bing',   description: 'Bing Maps aerial' },
  { id: 'mapbox', label: 'Mapbox',   iconKey: 'mapbox', description: 'Mapbox satellite-streets-v12' },
  { id: 'nearmap',label: 'Nearmap',  iconKey: 'nearmap',description: 'Nearmap HD (~7.5cm aerial)' },
];
```

### 2.3 Tab state machine

```
        ┌──────────────┐ click  ┌──────────────┐
        │ streetView   │ ─────► │ lidar        │
        │ (default)    │ ◄───── │              │
        └──────────────┘ click  └──────────────┘
```

Mutually exclusive, no multi-select. Tab transition is `onTabChange(tab: MapTab)`.

### 2.4 Layer state machine

A layer is either on or off. `imagery` is the only default-on layer — it's the basemap. All other layers are off by default and independent of each other.

```ts
export const LAYERS: ReadonlyArray<{
  id: MapLayer;
  label: string;
  defaultOn: boolean;
  description: string;
}> = [
  { id: 'imagery',      label: 'Imagery',      defaultOn: true,  description: 'Satellite / aerial raster basemap' },
  { id: 'treeCoverage', label: 'Tree coverage',defaultOn: false, description: 'LiDAR-derived canopy polygons' },
  { id: 'parcels',      label: 'Parcels',      defaultOn: false, description: 'Parcel boundary overlay' },
  { id: 'sunPath',      label: 'Sun path',     defaultOn: false, description: 'Annual sun arc for this lat/lng' },
  { id: 'shadeMap',     label: 'Shade map',    defaultOn: false, description: 'Hour-by-hour shadow heatmap' },
  { id: 'irradiance',   label: 'Irradiance',   defaultOn: false, description: 'Annual POA irradiance (kWh/m²)' },
];
```

`imagery` is special: it cannot be turned off (the basemap must be visible). The Details dropdown shows it as a disabled checked item to communicate this without surprising the user.

---

## 3. Component structure

```
components/3d/mapSource/
├── DESIGN.md                ← this file
├── types.ts                 ← MapSource, MapTab, MapLayer, MapPickerState
├── constants.ts             ← SOURCES, LAYERS, TABS, DEFAULT_STATE
├── SourceIcon.tsx           ← inline brand SVGs
├── DetailsDropdown.tsx      ← one popover, checkbox list of LAYERS
├── SourceTabs.tsx           ← LiDAR | Street View segmented control
├── SourcePicker.tsx         ← [icon] Google ▼ popover with SOURCES list
├── MapSourcePicker.tsx      ← composes the 3 above, owns popover state
└── index.ts                 ← barrel: { MapSourcePicker, types, constants }
```

### 3.1 `<MapSourcePicker>` — top-level component

**Props:**
```ts
interface MapSourcePickerProps {
  state: MapPickerState;
  onChange: (next: MapPickerState) => void;
  /** Disable the whole control (e.g. while LiDAR is loading). */
  disabled?: boolean;
  /** Show a "powered by X" badge next to the active source. Default true. */
  showAttribution?: boolean;
  className?: string;
}
```

**Behavior:**
- Renders a single floating bar containing the three sub-controls side-by-side.
- Owns one `openMenu: 'details' | 'source' | null` state (tabs are not menus).
- Outside-click + Escape close any open menu.
- Calls `onChange(next)` on every state transition with a NEW `MapPickerState` object (immutable updates; `layers` is always a fresh `Set`).

**Layout:** Single horizontal flex row, `gap: 0.5rem`. Each sub-control is its own `<div>` so it can mount independently in tests.

### 3.2 `<DetailsDropdown>`

**Props:** `{ activeLayers: Set<MapLayer>; onToggle: (layer: MapLayer) => void; open: boolean; onOpenChange: (v: boolean) => void; disabled?: boolean; }`

- Trigger: `<button aria-haspopup="menu" aria-expanded={open}>Details ({activeLayers.size}) ▼</button>`.
- Popover: vertical list, each row is `<button role="menuitemcheckbox" aria-checked={on}>` with a leading icon, label, and on/off chip.
- `imagery` row is `disabled` and always checked.
- Click outside / Escape closes.

### 3.3 `<SourceTabs>`

**Props:** `{ tab: MapTab; onChange: (t: MapTab) => void; disabled?: boolean; }`

- Two buttons in a single `display: flex` container with shared border.
- Active button: `background: #fff; color: #0f172a;`.
- Inactive: `background: transparent; color: #94a3b8;`.
- Buttons are `<button type="button" role="tab" aria-selected={isActive}>`.

### 3.4 `<SourcePicker>`

**Props:** `{ source: MapSource; onChange: (s: MapSource) => void; open: boolean; onOpenChange: (v: boolean) => void; disabled?: boolean; showAttribution?: boolean; }`

- Trigger: `<button aria-haspopup="menu" aria-expanded={open}><SourceIcon /> {label} ▼</button>`.
- Popover: vertical list of all 4 sources. Each row: `<button role="menuitemradio" aria-checked={isActive}>` with the source icon, label, and description. Active row has a leading green dot.

### 3.5 Brand icon set

Small inline SVG icons in `SourceIcon.tsx`:
- **Google:** green mountain silhouette
- **Bing:** four-color square (red/green/blue/yellow)
- **Mapbox:** blue square with white map glyph
- **Nearmap:** orange plane silhouette

Sized 14×14. Each icon is a pure component (`<SourceIcon kind="google" />`) so tests can render them with a stub.

---

## 4. State updates

All updates go through pure helpers in `constants.ts` so the test file can validate them without rendering React:

```ts
export const DEFAULT_PICKER_STATE: MapPickerState = {
  source: 'google',
  tab: 'streetView',
  layers: new Set<MapLayer>(['imagery']),
};

export function toggleLayer(state: MapPickerState, layer: MapLayer): MapPickerState {
  if (layer === 'imagery') return state;   // immutable, never toggled
  const next = new Set(state.layers);
  if (next.has(layer)) next.delete(layer);
  else next.add(layer);
  return { ...state, layers: next };
}

export function setSource(state: MapPickerState, source: MapSource): MapPickerState {
  return { ...state, source };
}

export function setTab(state: MapPickerState, tab: MapTab): MapPickerState {
  return { ...state, tab };
}

export function activeLayerCount(state: MapPickerState): number {
  return state.layers.size;
}
```

These are exported so callers (SolarEngine3D) can do `onChange(toggleLayer(state, 'parcels'))` if they want — though the component itself calls them.

---

## 5. Mount in SolarEngine3D

**One-line mount inside the existing root `<div style={{ position: 'relative', ... }}>`, right after the Cesium container `<div ref={cesiumRef} />`.**

```tsx
<MapSourcePicker
  state={mapPickerState}
  onChange={setMapPickerState}
  disabled={!terrainReady}
/>
```

Position is handled inside the component (`position: absolute; top: 12px; left: 50%; transform: translateX(-50%); zIndex: 25`) — Aurora's toolbar is centered at the top of the canvas.

**State management:** Add three refs + one useState to SolarEngine3D:
```ts
const [mapPickerState, setMapPickerState] = useState<MapPickerState>(DEFAULT_PICKER_STATE);
```

The state is propagated downward to the imagery swap. The actual Cesium imagery provider swap is a follow-up integration (out of scope for this agent — `lidar-integration` owns the LiDAR side, the Cesium provider swap is a one-liner the next session will wire in).

---

## 6. Test plan (`tests/mapSources.test.tsx`)

The tests are split into two layers:

### 6.1 Pure-state tests (no React)

- `DEFAULT_PICKER_STATE` has `source: 'google'`, `tab: 'streetView'`, `layers.size === 1` (imagery only).
- `SOURCES` has exactly 4 entries and they are unique.
- `LAYERS` has 6 entries, with `imagery` the only `defaultOn: true`.
- `toggleLayer(state, 'parcels')` returns a new state with `parcels` added; original state is unchanged.
- `toggleLayer(state, 'parcels')` twice = original (idempotent flip).
- `toggleLayer(state, 'imagery')` is a no-op (basemap can't be turned off).
- `setSource(state, 'bing')` returns a new state with `bing` set; layers are preserved.
- `setTab(state, 'lidar')` returns a new state with `tab: 'lidar'`.
- `activeLayerCount({...state, layers: new Set()})` is 0.
- `activeLayerCount({...state, layers: new Set(['imagery', 'parcels', 'shadeMap'])})` is 3.
- `isValidTab('foo')` (a guard helper) returns false.

### 6.2 Component tests (with `@testing-library/react`, jsdom)

- Renders the three control triggers: `Details (1)`, `LiDAR`, `Street View`, `Google`.
- Initial `Street View` is the active tab (aria-selected="true").
- Clicking `LiDAR` calls `onChange` with a new state where `tab === 'lidar'`.
- Clicking `Google ▾` opens the dropdown and shows all 4 sources with `Google` checked.
- Selecting `Bing` calls `onChange` with `source === 'bing'`.
- Clicking `Details ▾` opens a menu; clicking `Tree coverage` calls `onChange` with `layers` containing `'treeCoverage'`.
- Clicking `Imagery` in the Details menu does nothing (disabled, always on).
- Pressing Escape closes any open popover.
- Clicking outside the picker closes any open popover.
- The `disabled` prop greys out all three triggers and blocks interaction.

### 6.3 Aurora-parity assertions (light)

- The rendered output contains the words `Details`, `LiDAR`, `Street View`, `Google` (Aurora's exact tab names).
- The `MapSource` enum has the four values `google | bing | mapbox | nearmap` (Aurora's exact source list).

---

## 7. Out of scope (intentionally)

- The actual Cesium imagery provider swap (one-liner in `CesiumViewer` — owns by `lidar-integration`'s integration step).
- LiDAR mesh loading/offset (owns by `lidar-integration`).
- Persistence of the picker state across sessions (current scope is in-memory; persistence is a future PR).
- Localization / i18n (labels are English-only for now; matches Aurora).

---

## 8. File-level summary

| File | Purpose | New / Modified |
| --- | --- | --- |
| `components/3d/mapSource/types.ts` | Public types | new |
| `components/3d/mapSource/constants.ts` | SOURCES, LAYERS, TABS, DEFAULT_PICKER_STATE, state helpers | new |
| `components/3d/mapSource/SourceIcon.tsx` | Inline brand SVGs | new |
| `components/3d/mapSource/DetailsDropdown.tsx` | Layers popover | new |
| `components/3d/mapSource/SourceTabs.tsx` | LiDAR \| Street View segmented | new |
| `components/3d/mapSource/SourcePicker.tsx` | [icon] Google ▾ popover | new |
| `components/3d/mapSource/MapSourcePicker.tsx` | Composes the 3 above | new |
| `components/3d/mapSource/index.ts` | Barrel | new |
| `components/3d/SolarEngine3D.tsx` | Mounts the picker | modified (1 useState + 1 JSX line) |
| `tests/mapSources.test.tsx` | Unit tests | new |
