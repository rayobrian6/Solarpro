/**
 * components/3d/mapSource/SourceTabs.tsx
 */

'use client';

import React from 'react';
import { TABS } from './constants';
import type { MapTab } from './types';

interface Props {
  tab: MapTab;
  onChange: (tab: MapTab) => void;
  disabled?: boolean;
  className?: string;
}

export default function SourceTabs({ tab, onChange, disabled, className }: Props) {
  return (
    <div role="tablist" aria-label="Main source" data-testid="map-source-tabs" className={`flex items-stretch overflow-hidden rounded-none border border-slate-700 ${className ?? ''}`}>
      {TABS.map((t, i) => {
        const isActive = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`map-source-panel-${t.id}`}
            tabIndex={isActive ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(t.id)}
            title={t.hint}
            data-testid={`map-source-tab-${t.id}`}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              isActive ? 'bg-white text-slate-900' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${
              i > 0 && !isActive ? 'border-l border-slate-700' : ''
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
