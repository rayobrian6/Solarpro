'use client';

// components/design/OutlineDrawCanvas.tsx
// 2D top-down polygon drawing canvas. Click to add vertices, double-click
// to close. Snap to 0.5m grid. Edit vertex positions by dragging after
// closure (post-close mode).
//
// When given a `center` (lat,lng), the canvas draws a Google Maps satellite
// tile of the property as the background so the user has a real surface
// to mark up. The 1m grid is aligned with the tile's zoom 20 scale
// (~12 px/m) so the user can eyeball distances against the real house.

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { Point2D, OutlinePolygon } from '@/lib/outline/types';
import type { Units } from '@/lib/outline/units';

// At Google Maps zoom 20, one ground meter is ~11.76 pixels. We round to
// 12 px/m so the meter grid lines up with the satellite tile.
const PX_PER_METER = 12;
const GRID_M = 0.5;
const VERTEX_HIT_PX = 9;
const FT_PER_M = 3.28084;
// Static Map tile size in pixels. 640 is a sweet spot — enough detail
// for residential at zoom 20, fits inside a 800x800 canvas with padding.
const SAT_TILE_PX = 640;
// Approximate meters per pixel at zoom 20 / equator (the Static API rounds
// slightly by latitude but it's good enough for drawing-scale alignment).
const METERS_PER_SAT_PIXEL = 1 / PX_PER_METER;
// The tile is centered on the lat/lng. Half-width in world meters.
const SAT_HALF_M = (SAT_TILE_PX / 2) * METERS_PER_SAT_PIXEL;

export interface OutlineDrawCanvasProps {
  polygon: OutlinePolygon;
  onChange: (polygon: OutlinePolygon) => void;
  width?: number;
  height?: number;
  /** Background hue — different layers (roof vs house) get different tones. */
  accent?: 'amber' | 'slate';
  /** Caption rendered in the bottom-left status bar. */
  hint?: string;
  /** When set, the canvas renders a Google Maps satellite tile of this
   *  location as the background. The drawing grid is aligned to the
   *  tile's pixel scale so the user can mark the actual roof on the
   *  real house. */
  center?: { lat: number; lng: number };
  /** Set to true for the small side-panel canvas (no satellite, just grid). */
  hideSatellite?: boolean;
  /** Display units for the scale bar. Default 'imperial' (US convention). */
  units?: Units;
}

const ACCENTS = {
  amber: { stroke: '#f59e0b', strokePending: '#fbbf24', fill: '#fbbf24' },
  slate: { stroke: '#64748b', strokePending: '#94a3b8', fill: '#cbd5e1' },
} as const;

/**
 * Build the Google Maps Static API URL for a satellite tile centered on
 * (lat, lng) at zoom 20. Returns null if the API key is missing.
 */
function buildSatelliteUrl(lat: number, lng: number, apiKey: string | undefined): string | null {
  if (!apiKey) return null;
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: '20',
    size: `${SAT_TILE_PX}x${SAT_TILE_PX}`,
    maptype: 'satellite',
    key: apiKey,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

export default function OutlineDrawCanvas({
  polygon,
  onChange,
  width = 760,
  height = 560,
  accent = 'amber',
  hint,
  center,
  hideSatellite,
  units = 'imperial',
}: OutlineDrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const satImageRef = useRef<HTMLImageElement | null>(null);
  const [hover, setHover] = useState<Point2D | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [satError, setSatError] = useState(false);

  // Build the satellite URL once per (center, key) pair. The key comes
  // from NEXT_PUBLIC_GOOGLE_MAPS_API_KEY at build time.
  const satUrl = useMemo(() => {
    if (hideSatellite || !center) return null;
    const key =
      (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) ||
      undefined;
    return buildSatelliteUrl(center.lat, center.lng, key);
  }, [center, hideSatellite]);

  // Pre-load the satellite image
  useEffect(() => {
    if (!satUrl) {
      satImageRef.current = null;
      return;
    }
    setSatError(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      satImageRef.current = img;
      // Force a re-render so the draw loop picks it up.
      setHover(h => h);
    };
    img.onerror = () => {
      satImageRef.current = null;
      setSatError(true);
    };
    img.src = satUrl;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [satUrl]);

  // Coordinate transforms (in world meters; (0,0) is the satellite center)
  const pxToWorld = useCallback(
    (px: number, py: number): Point2D => {
      const cx = width / 2;
      const cy = height / 2;
      return [(px - cx) / PX_PER_METER, (cy - py) / PX_PER_METER];
    },
    [width, height],
  );

  const worldToPx = useCallback(
    (wx: number, wy: number): [number, number] => {
      const cx = width / 2;
      const cy = height / 2;
      return [cx + wx * PX_PER_METER, cy - wy * PX_PER_METER];
    },
    [width, height],
  );

  const snap = useCallback((p: Point2D): Point2D => {
    return [
      Math.round(p[0] / GRID_M) * GRID_M,
      Math.round(p[1] / GRID_M) * GRID_M,
    ];
  }, []);

  const findVertexAtPx = useCallback(
    (px: number, py: number): number => {
      for (let i = 0; i < polygon.vertices.length; i++) {
        const [vx, vy] = worldToPx(polygon.vertices[i][0], polygon.vertices[i][1]);
        if (Math.hypot(vx - px, vy - py) <= VERTEX_HIT_PX) return i;
      }
      return -1;
    },
    [polygon.vertices, worldToPx],
  );

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssWidth = canvas.width;
    const cssHeight = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Background fill
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Satellite tile (centered on canvas)
    const sat = satImageRef.current;
    if (sat) {
      const tileW = SAT_TILE_PX * (PX_PER_METER * METERS_PER_SAT_PIXEL);
      // SAT_TILE_PX * 1/12 = 53.33 canvas px. We want the tile to render at
      // its native satellite resolution so 1 sat-pixel = 1 canvas-pixel
      // (since PX_PER_METER and METERS_PER_SAT_PIXEL are inverses).
      const tileH = SAT_TILE_PX;
      const tileX = (cssWidth - tileW) / 2;
      const tileY = (cssHeight - tileH) / 2;
      ctx.drawImage(sat, tileX, tileY, tileW, tileH);
      // Subtle border around the tile so it's clear what's the satellite
      const bx = tileX, by = tileY, bw = tileW, bh = tileH;
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
    } else if (satUrl && !satError) {
      // Tile is loading — render a "Loading satellite…" placeholder
      const cx = cssWidth / 2;
      const cy = cssHeight / 2;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(cx - 90, cy - 18, 180, 36);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Loading satellite…', cx, cy + 4);
      ctx.textAlign = 'start';
    } else if (satError) {
      // Fall through to grid below; tile failed to load
    }

    // Grid: 1m major, 0.5m minor
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cssWidth; x += PX_PER_METER * GRID_M) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssHeight);
    }
    for (let y = 0; y <= cssHeight; y += PX_PER_METER * GRID_M) {
      ctx.moveTo(0, y);
      ctx.lineTo(cssWidth, y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(51, 65, 85, 0.95)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = 0; x <= cssWidth; x += PX_PER_METER * 2) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssHeight);
    }
    for (let y = 0; y <= cssHeight; y += PX_PER_METER * 2) {
      ctx.moveTo(0, y);
      ctx.lineTo(cssWidth, y);
    }
    ctx.stroke();

    // Axes
    const cx = cssWidth / 2;
    const cy = cssHeight / 2;
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(cssWidth, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, cssHeight);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.font = '10px monospace';
    ctx.fillText('+x (east)', cssWidth - 60, cy - 5);
    ctx.fillText('+y (north)', cx + 5, 12);

    // Scale bar — width is a friendly round number in the user's units.
    // Metric: 1 m bar (12 px). Imperial: 5 ft bar (≈ 18.3 px).
    ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.font = '10px monospace';
    const barX = 10;
    const barY = cssHeight - 28;
    const barLabelMeters = units === 'imperial' ? 5 / FT_PER_M : 1;
    const barWidthPx = barLabelMeters * PX_PER_METER;
    const barLabel = units === 'imperial' ? '5 ft' : '1 m';
    ctx.fillText(barLabel, barX + barWidthPx / 2 - 12, barY - 3);
    ctx.strokeStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(barX, barY);
    ctx.lineTo(barX + barWidthPx, barY);
    ctx.moveTo(barX, barY - 3);
    ctx.lineTo(barX, barY + 3);
    ctx.moveTo(barX + barWidthPx, barY - 3);
    ctx.lineTo(barX + barWidthPx, barY + 3);
    ctx.stroke();

    // Polygon edges
    const colors = ACCENTS[accent];
    if (polygon.vertices.length > 0) {
      ctx.strokeStyle = polygon.closed ? colors.stroke : colors.strokePending;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(polygon.closed ? [] : [6, 4]);
      ctx.beginPath();
      const [sx, sy] = worldToPx(
        polygon.vertices[0][0],
        polygon.vertices[0][1],
      );
      ctx.moveTo(sx, sy);
      for (let i = 1; i < polygon.vertices.length; i++) {
        const [vx, vy] = worldToPx(
          polygon.vertices[i][0],
          polygon.vertices[i][1],
        );
        ctx.lineTo(vx, vy);
      }
      if (polygon.closed) {
        ctx.closePath();
      } else if (hover) {
        const [hx, hy] = worldToPx(hover[0], hover[1]);
        ctx.lineTo(hx, hy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Edge length labels (Aurora-style "26.6 ft" on every edge).
    // Only show for closed polygons — that's when the lengths are final.
    if (polygon.closed && polygon.vertices.length >= 3) {
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < polygon.vertices.length; i++) {
        const next = (i + 1) % polygon.vertices.length;
        const [x1, y1] = polygon.vertices[i];
        const [x2, y2] = polygon.vertices[next];
        const lengthM = Math.hypot(x2 - x1, y2 - y1);
        const label = units === 'imperial'
          ? `${(lengthM * FT_PER_M).toFixed(1)} ft`
          : `${lengthM.toFixed(1)} m`;
        const [px1, py1] = worldToPx(x1, y1);
        const [px2, py2] = worldToPx(x2, y2);
        const mx = (px1 + px2) / 2;
        const my = (py1 + py2) / 2;
        const tw = ctx.measureText(label).width;
        // Background pill for readability
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(mx - tw / 2 - 3, my - 7, tw + 6, 14);
        // Text
        ctx.fillStyle = '#fbbf24'; // amber-400
        ctx.fillText(label, mx, my + 1);
      }
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    // Vertices
    polygon.vertices.forEach((v, i) => {
      const [px, py] = worldToPx(v[0], v[1]);
      ctx.fillStyle = polygon.closed ? colors.stroke : colors.strokePending;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(String(i + 1), px + 7, py - 5);
    });

    // Hover ghost
    if (hover && !polygon.closed && draggingIdx === null) {
      const [hx, hy] = worldToPx(hover[0], hover[1]);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.5)';
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Status bar
    const status = polygon.closed
      ? `Closed: ${polygon.vertices.length} vertices — drag to edit`
      : `${polygon.vertices.length} vertices placed — double-click to close`;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(0, cssHeight - 22, cssWidth, 22);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '11px monospace';
    ctx.fillText(status, 8, cssHeight - 7);
    if (hint) {
      ctx.fillStyle = '#64748b';
      const hintWidth = ctx.measureText(hint).width;
      ctx.fillText(hint, cssWidth - hintWidth - 8, cssHeight - 7);
    }
  }, [polygon, hover, draggingIdx, width, height, worldToPx, accent, hint, satUrl, satError, units]);

  // Mouse handlers (unchanged from prior version)
  const eventToPx = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top] as [number, number];
  };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pt = eventToPx(e);
      if (!pt) return;
      const idx = findVertexAtPx(pt[0], pt[1]);
      if (idx >= 0) setDraggingIdx(idx);
    },
    [findVertexAtPx],
  );

  const handleMouseUp = useCallback(() => setDraggingIdx(null), []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (draggingIdx !== null) return;
      const pt = eventToPx(e);
      if (!pt) return;
      if (polygon.closed) return;
      const hit = findVertexAtPx(pt[0], pt[1]);
      if (hit >= 0) return;
      const world = snap(pxToWorld(pt[0], pt[1]));
      onChange({ ...polygon, vertices: [...polygon.vertices, world] });
    },
    [draggingIdx, polygon, onChange, findVertexAtPx, snap, pxToWorld],
  );

  const handleDoubleClick = useCallback(() => {
    if (polygon.vertices.length >= 3) {
      onChange({ ...polygon, closed: true });
    }
  }, [polygon, onChange]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pt = eventToPx(e);
      if (!pt) return;
      const world = snap(pxToWorld(pt[0], pt[1]));
      if (draggingIdx !== null) {
        const next = [...polygon.vertices];
        next[draggingIdx] = world;
        onChange({ ...polygon, vertices: next });
        return;
      }
      setHover(world);
    },
    [draggingIdx, polygon, onChange, snap, pxToWorld],
  );

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    setDraggingIdx(null);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width, height }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseMove={handleMouseMove}
      className="border border-slate-700 rounded-lg cursor-crosshair bg-slate-900"
      aria-label="Outline drawing canvas — click to add vertices, double-click to close"
    />
  );
}
