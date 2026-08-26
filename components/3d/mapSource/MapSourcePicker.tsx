/**
 * components/3d/mapSource/MapSourcePicker.tsx
 *
 * Aurora-style top-bar control:
 *   [Details (N) ▾]   [LiDAR | Street View]   [icon Google ▾]
 *
 * The actual Cesium imagery swap is the integration step — handled
 * by SolarEngine3D via its onChange callback.
 */

'use client';

import React, { useState } from 'react';
import DetailsDropdown from './DetailsDropdown';
import SourceTabs from './SourceTabs';
import SourcePicker from './SourcePicker';
import { setSource, setTab, toggleLayer } from './constants';
import type { MapLayer, MapPickerState, MapSource, MapTab } from './types';

interface MapSourcePickerProps {
  state: MapPickerState;
  onChange: (next: MapPickerState) => void;
  disabled?: boolean;
  showAttribution?: boolean;
  className?: string;
}

type OpenMenu = 'details' | 'source' | null;

export default function MapSourcePicker({
  state, onChange, disabled, showAttribution = true, className,
}: MapSourcePickerProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);

  const handleLayerToggle = (layer: MapLayer) => {
    if (disabled) return;
    onChange(toggleLayer(state, layer));
  };

  const handleTabChange = (tab: MapTab) => {
    if (disabled) return;
    if (state.tab === tab) return;
    onChange(setTab(state, tab));
  };

  const handleSourceChange = (source: MapSource) => {
    if (disabled) return;
    onChange(setSource(state, source));
  };

  return (
    <div
      data-testid="map-source-picker-root"
      data-source={state.source}
      data-tab={state.tab}
      data-layer-count={state.layers.size}
      className={`absolute top-3 left-1/2 -translate-x-1/2 z-[25] flex items-stretch ${className ?? ''}`}
    >
      <div
        className="flex items-stretch rounded-xl overflow-hidden shadow-2xl shadow-black/50 border border-slate-700/80 bg-slate-900/80 backdrop-blur"
        role="toolbar"
        aria-label="Map source toolbar"
      >
        <DetailsDropdown
          activeLayers={state.layers}
          onToggle={handleLayerToggle}
          open={openMenu === 'details'}
          onOpenChange={v => setOpenMenu(v ? 'details' : null)}
          disabled={disabled}
        />
        <SourceTabs tab={state.tab} onChange={handleTabChange} disabled={disabled} />
        <SourcePicker
          source={state.source}
          onChange={handleSourceChange}
          open={openMenu === 'source'}
          onOpenChange={v => setOpenMenu(v ? 'source' : null)}
          disabled={disabled}
          showAttribution={showAttribution}
        />
      </div>
    </div>
  );
}
