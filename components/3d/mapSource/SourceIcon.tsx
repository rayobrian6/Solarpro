/**
 * components/3d/mapSource/SourceIcon.tsx
 *
 * Small inline brand SVGs for the four supported raster basemap providers.
 */

import React from 'react';

export type SourceIconKey = 'google' | 'bing' | 'mapbox' | 'nearmap';

interface Props {
  kind: SourceIconKey;
  size?: number;
  title?: string;
  className?: string;
}

export default function SourceIcon({ kind, size = 14, title, className }: Props) {
  const w = size;
  const h = size;
  switch (kind) {
    case 'google':
      return (
        <svg width={w} height={h} viewBox="0 0 16 16" role="img" aria-label={title ?? 'Google'} className={className} data-source-icon="google">
          <title>{title ?? 'Google'}</title>
          <path d="M2 12 L6 5 L8.5 9 L10 6.5 L14 12 Z" fill="#22c55e" stroke="#16a34a" strokeWidth="0.5" strokeLinejoin="round" />
        </svg>
      );
    case 'bing':
      return (
        <svg width={w} height={h} viewBox="0 0 16 16" role="img" aria-label={title ?? 'Bing'} className={className} data-source-icon="bing">
          <title>{title ?? 'Bing'}</title>
          <rect x="0" y="0" width="7" height="7" fill="#f25022" />
          <rect x="9" y="0" width="7" height="7" fill="#7fba00" />
          <rect x="0" y="9" width="7" height="7" fill="#00a4ef" />
          <rect x="9" y="9" width="7" height="7" fill="#ffb900" />
        </svg>
      );
    case 'mapbox':
      return (
        <svg width={w} height={h} viewBox="0 0 16 16" role="img" aria-label={title ?? 'Mapbox'} className={className} data-source-icon="mapbox">
          <title>{title ?? 'Mapbox'}</title>
          <rect x="0" y="0" width="16" height="16" rx="2" fill="#1d4ed8" />
          <path d="M3 4 L8 3 L13 4 L13 12 L8 13 L3 12 Z" fill="none" stroke="#fff" strokeWidth="1" strokeLinejoin="round" />
          <path d="M8 3 L8 13" stroke="#fff" strokeWidth="0.5" />
        </svg>
      );
    case 'nearmap':
      return (
        <svg width={w} height={h} viewBox="0 0 16 16" role="img" aria-label={title ?? 'Nearmap'} className={className} data-source-icon="nearmap">
          <title>{title ?? 'Nearmap'}</title>
          <path d="M2 9 L14 6 L14 8 L9 9 L8 13 L6 13 L7 9 L2 10 Z" fill="#fb923c" stroke="#ea580c" strokeWidth="0.5" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}
