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
import ImageryToggle from './ImageryToggle';
import { setSource, setTab, toggleLayer } from './constants';
import type { MapLayer, MapPickerState, MapSource, MapTab } from './types';

interface MapSourcePickerProps {
  state: MapPickerState;
  onChange: (next: MapPickerState) => void;
  disabled?: boolean;
  className?: string;
}

type OpenMenu = 'details' | 'source' | null;

export default function MapSourcePicker({
  state, onChange, disabled, className,
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
        {/* 🚨 BOTH IMAGERY CHOICES, VISIBLE, IN THE 3D WORKSPACE. Ray could not find Nearmap in
            3D because the only thing that said the word was inside a closed dropdown — see the
            header of ImageryToggle.tsx. Same state, same onChange as the dropdown below. */}
        {/* 🚨 ONE IMAGERY CONTROL, NOT TWO THAT BOTH SAY "NEARMAP".
            The provider dropdown used to sit here as well, and with the segmented control beside
            it the bar read "… IMAGERY Native 3D | 🛰 Nearmap | 🛰 Nearmap ▾" — the same choice
            offered twice, one of them behind a menu. It also offered Bing and Mapbox, which reach
            no imagery code in this viewer at all. `SourcePicker` is kept in the tree for the
            LiDAR/Street-View work it was designed alongside; it is not mounted here. */}
        <ImageryToggle source={state.source} onChange={handleSourceChange} disabled={disabled} />
      </div>
    </div>
  );
}
