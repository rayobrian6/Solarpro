/**
 * components/3d/mapSource/constants.ts
 *
 * Pure-data registries + state-mutation helpers for MapSourcePicker.
 */

import type {
  MapLayer,
  MapPickerState,
  MapSource,
  MapTab,
} from './types';

export interface MapSourceMeta {
  id: MapSource;
  label: string;
  iconKey: 'google' | 'bing' | 'mapbox' | 'nearmap';
  description: string;
}

export const SOURCES: ReadonlyArray<MapSourceMeta> = [
  { id: 'google',  label: 'Google',  iconKey: 'google',  description: 'Google satellite (zoom 21)' },
  { id: 'bing',    label: 'Bing',    iconKey: 'bing',    description: 'Bing Maps aerial imagery' },
  { id: 'mapbox',  label: 'Mapbox',  iconKey: 'mapbox',  description: 'Mapbox satellite-streets-v12' },
  { id: 'nearmap', label: 'Nearmap', iconKey: 'nearmap', description: 'Nearmap HD (~7.5cm aerial)' },
];

export interface MapLayerMeta {
  id: MapLayer;
  label: string;
  defaultOn: boolean;
  locked?: boolean;
  description: string;
}

export const LAYERS: ReadonlyArray<MapLayerMeta> = [
  { id: 'imagery',      label: 'Imagery',      defaultOn: true,  locked: true, description: 'Satellite / aerial raster basemap (always on)' },
  { id: 'treeCoverage', label: 'Tree coverage',defaultOn: false,                description: 'LiDAR-derived canopy polygons' },
  { id: 'parcels',      label: 'Parcels',      defaultOn: false,                description: 'Parcel boundary overlay' },
  { id: 'sunPath',      label: 'Sun path',     defaultOn: false,                description: 'Annual sun arc for this lat/lng' },
  { id: 'shadeMap',     label: 'Shade map',    defaultOn: false,                description: 'Hour-by-hour shadow heatmap' },
  { id: 'irradiance',   label: 'Irradiance',   defaultOn: false,                description: 'Annual POA irradiance (kWh/m²)' },
];

export interface MapTabMeta {
  id: MapTab;
  label: string;
  hint: string;
}

export const TABS: ReadonlyArray<MapTabMeta> = [
  { id: 'streetView', label: 'Street View', hint: 'Aerial / street-view imagery basemap' },
  { id: 'lidar',      label: 'LiDAR',       hint: 'LiDAR elevation mesh + point cloud' },
];

export const DEFAULT_PICKER_STATE: MapPickerState = {
  source: 'google',
  tab: 'streetView',
  layers: new Set<MapLayer>(['imagery']),
};

export function toggleLayer(state: MapPickerState, layer: MapLayer): MapPickerState {
  if (layer === 'imagery') return state;
  const next = new Set(state.layers);
  if (next.has(layer)) next.delete(layer);
  else next.add(layer);
  return { ...state, layers: next };
}

export function setSource(state: MapPickerState, source: MapSource): MapPickerState {
  if (state.source === source) return state;
  return { ...state, source };
}

export function setTab(state: MapPickerState, tab: MapTab): MapPickerState {
  if (state.tab === tab) return state;
  return { ...state, tab };
}

export function activeLayerCount(state: MapPickerState): number {
  return state.layers.size;
}

const VALID_SOURCES: ReadonlySet<string> = new Set<string>(['google', 'bing', 'mapbox', 'nearmap']);
const VALID_TABS: ReadonlySet<string> = new Set<string>(['streetView', 'lidar']);
const VALID_LAYERS: ReadonlySet<string> = new Set<string>([
  'imagery', 'treeCoverage', 'parcels', 'sunPath', 'shadeMap', 'irradiance',
]);

export function isMapSource(v: unknown): v is MapSource {
  return typeof v === 'string' && VALID_SOURCES.has(v);
}
export function isMapTab(v: unknown): v is MapTab {
  return typeof v === 'string' && VALID_TABS.has(v);
}
export function isMapLayer(v: unknown): v is MapLayer {
  return typeof v === 'string' && VALID_LAYERS.has(v);
}
