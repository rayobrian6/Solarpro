'use client';

// components/design/OutlineDrawCanvas.tsx
// 2D top-down polygon drawing canvas. Click to add vertices, double-click
// to close. Snap to 0.5m grid. Edit vertex positions by dragging after
// closure (post-close mode).

import { useRef, useState, useCallback, useEffect } from 'react';
import type { Point2D, OutlinePolygon } from '@/lib/outline/types';

const PX_PER_METER = 28;
const GRID_M = 0.5;
const VERTEX_HIT_PX = 9;

export interface OutlineDrawCanvasProps {
  polygon: OutlinePolygon;
  onChange: (polygon: OutlinePolygon) => void;
  width?: number;
  height?: number;
  /** Background hue — different layers (roof vs house) get different tones. */
  accent?: 'amber' | 'slate';
  /** Caption rendered in the bottom-left status bar. */
  hint?: string;
}

const ACCENTS = {
  amber: { stroke: '#f59e0b', strokePending: '#fbbf24', fill: '#fbbf24' },
  slate: { stroke: '#64748b', strokePending: '#94a3b8', fill: '#cbd5e1' },
} as const;

export default function OutlineDrawCanvas({
  polygon,
  onChange,
  width = 760,
  height = 560,
  accent = 'amber',
  hint,
}: OutlineDrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Point2D | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  // Coordinate transforms
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
    ctx.fillStyle = '#0f172a'; // slate-900
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Grid: 1m major, 0.5m minor
    ctx.strokeStyle = '#1e293b';
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

    ctx.strokeStyle = '#334155';
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
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(cssWidth, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, cssHeight);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText('+x', cssWidth - 20, cy - 5);
    ctx.fillText('+y', cx + 5, 12);

    // Scale bar
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    const barX = 10;
    const barY = cssHeight - 28;
    ctx.fillText('1 m', barX + PX_PER_METER / 2 - 8, barY - 3);
    ctx.strokeStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(barX, barY);
    ctx.lineTo(barX + PX_PER_METER, barY);
    ctx.moveTo(barX, barY - 3);
    ctx.lineTo(barX, barY + 3);
    ctx.moveTo(barX + PX_PER_METER, barY - 3);
    ctx.lineTo(barX + PX_PER_METER, barY + 3);
    ctx.stroke();

    // Polygon edges
    const colors = ACCENTS[accent];
    if (polygon.vertices.length > 0) {
      ctx.strokeStyle = polygon.closed ? colors.stroke : colors.strokePending;
      ctx.lineWidth = 2;
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
      ctx.fillStyle = 'rgba(251, 191, 36, 0.4)';
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Status bar
    const status = polygon.closed
      ? `Closed: ${polygon.vertices.length} vertices — drag to edit`
      : `${polygon.vertices.length} vertices placed — double-click to close`;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(0, cssHeight - 22, cssWidth, 22);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '11px monospace';
    ctx.fillText(status, 8, cssHeight - 7);
    if (hint) {
      ctx.fillStyle = '#64748b';
      const hintWidth = ctx.measureText(hint).width;
      ctx.fillText(hint, cssWidth - hintWidth - 8, cssHeight - 7);
    }
  }, [polygon, hover, draggingIdx, width, height, worldToPx, accent, hint]);

  // Mouse handlers
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
      if (idx >= 0) {
        setDraggingIdx(idx);
      }
    },
    [findVertexAtPx],
  );

  const handleMouseUp = useCallback(() => {
    setDraggingIdx(null);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (draggingIdx !== null) return; // drag in progress
      const pt = eventToPx(e);
      if (!pt) return;
      if (polygon.closed) return;
      const hit = findVertexAtPx(pt[0], pt[1]);
      if (hit >= 0) return; // vertex hit — let drag handle it
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
