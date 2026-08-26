/**
 * components/3d/mapSource/types.ts
 *
 * Public types for the multi-source map toggle (Aurora parity).
 *
 * The picker exposes three control surfaces in the top bar of the 3D viewer:
 *   1. `Details` dropdown  — overlay layers (imagery, tree coverage, parcels, etc.)
 *   2. `LiDAR | Street View` tabs — main source toggle
 *   3. `[icon] Google ▾` picker — raster basemap provider
 */

export type MapSource = 'google' | 'bing' | 'mapbox' | 'nearmap';

export type MapTab = 'streetView' | 'lidar';

export type MapLayer =
  | 'imagery'        // basemap raster (always on, can't be toggled)
  | 'treeCoverage'   // LiDAR-derived canopy polygons
  | 'parcels'        // parcel boundary overlay
  | 'sunPath'        // annual sun arc for this lat/lng
  | 'shadeMap'       // hour-by-hour shadow heatmap
  | 'irradiance';    // annual POA irradiance (kWh/m²)

export interface MapPickerState {
  source: MapSource;
  tab: MapTab;
  layers: ReadonlySet<MapLayer>;
}
