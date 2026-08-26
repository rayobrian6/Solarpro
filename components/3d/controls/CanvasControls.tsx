'use client';
/**
 * components/3d/controls/CanvasControls.tsx
 *
 * Floating bottom-left control strip (Aurora parity — see
 * HANDOFF_2026-08-25_AURORA_ANALYSIS.md §1).
 *
 * A thin vertical dock sitting flush against the bottom-left corner of
 * the canvas. Contains:
 *   1. Compass / north arrow — needle rotates with `viewer.camera.heading`.
 *      Click → reset heading to north.
 *   2. Zoom + and Zoom − buttons — step the orbit radius by ±15%.
 *   3. Three layer toggle buttons (controlled by the parent).
 *
 * The strip is **pure UI** — it owns no camera state, no layer state, no
 * scene state. The parent (SolarEngine3D) reads `viewer.camera.heading`
 * to track the compass, and owns the layer on/off state.
 *
 * Design doc: components/3d/controls/DESIGN.md
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  headingToCompassRotationDeg,
  headingToCardinal,
  normalizeHeadingDeg,
} from './heading';

// ─── Public types ───────────────────────────────────────────────────────

/** A single layer toggle. Parent-owned state. */
export interface LayerToggle {
  /** Stable key — used as React key. */
  key: string;
  /** Human-readable label for tooltip / aria-label. */
  label: string;
  /** Inline SVG path data (24×24 viewBox). Drawn as the button icon. */
  iconPath: string;
  /** True when the layer is currently visible. */
  on: boolean;
  /** Called when the user clicks the toggle. */
  onToggle: () => void;
}

export interface CanvasControlsProps {
  /** Cesium viewer (used only to read `viewer.camera.heading`).
   *  `null` while Cesium is loading — strip renders dimmed. */
  viewer: any | null;

  /** True when the underlying 3D scene is fully booted. When false,
   *  the strip renders with lower opacity and ignores clicks. */
  ready?: boolean;

  /** Called when the user clicks the compass. */
  onResetNorth?: () => void;

  /** Called when the user clicks the Zoom + button. */
  onZoomIn?: () => void;

  /** Called when the user clicks the Zoom − button. */
  onZoomOut?: () => void;

  /** Up to three layer toggles, top-to-bottom. */
  layers?: LayerToggle[];
}

// ─── Component ─────────────────────────────────────────────────────────

export const CanvasControls: React.FC<CanvasControlsProps> = ({
  viewer,
  ready = true,
  onResetNorth,
  onZoomIn,
  onZoomOut,
  layers = [],
}) => {
  // ── Compass heading state ──────────────────────────────────────────
  // Updated from `viewer.scene.postRender` throttled to ~10fps with a
  // 0.5° debounce, so the needle doesn't redraw on every frame.
  const [headingDeg, setHeadingDeg] = useState<number>(0);
  const lastDegRef = useRef<number>(0);

  useEffect(() => {
    if (!viewer) return;
    // Initialize from the current heading so the needle is in the right
    // place on first paint (avoids the 0° → actual-heading snap on boot).
    try {
      const initial = normalizeHeadingDeg(
        ((viewer.camera?.heading ?? 0) * 180) / Math.PI
      );
      setHeadingDeg(initial);
      lastDegRef.current = initial;
    } catch { /* viewer not fully ready yet */ }

    let lastTick = 0;
    const handler = () => {
      const now = performance.now();
      if (now - lastTick < 100) return; // ~10fps throttle
      lastTick = now;
      try {
        const headRad = viewer.camera?.heading ?? 0;
        const headDeg = normalizeHeadingDeg((headRad * 180) / Math.PI);
        if (Math.abs(headDeg - lastDegRef.current) > 0.5) {
          lastDegRef.current = headDeg;
          setHeadingDeg(headDeg);
        }
      } catch { /* camera may be mid-update; ignore this frame */ }
    };
    viewer.scene.postRender.addEventListener(handler);
    return () => {
      try { viewer.scene.postRender.removeEventListener(handler); } catch { /* */ }
    };
  }, [viewer]);

  // ── Derived ────────────────────────────────────────────────────────
  const rotationDeg = headingToCompassRotationDeg(headingDeg);
  const cardinal = headingToCardinal(headingDeg);
  const enabled = !!viewer && ready;
  const disabled = !enabled;

  // ── Handlers ───────────────────────────────────────────────────────
  const handleResetNorth = useCallback(() => {
    if (disabled) return;
    onResetNorth?.();
  }, [disabled, onResetNorth]);

  const handleZoomIn = useCallback(() => {
    if (disabled) return;
    onZoomIn?.();
  }, [disabled, onZoomIn]);

  const handleZoomOut = useCallback(() => {
    if (disabled) return;
    onZoomOut?.();
  }, [disabled, onZoomOut]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div
      data-testid="canvas-controls"
      data-ready={ready ? 'true' : 'false'}
      role="toolbar"
      aria-label="Canvas controls"
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        width: 48,
        background: 'rgba(10,12,24,0.78)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 12,
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
        opacity: disabled ? 0.35 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        transition: 'opacity 0.2s ease',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        userSelect: 'none',
      }}
    >
      {/* ── 1. Compass ────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleResetNorth}
        aria-label="Reset camera to north"
        title="Reset to north"
        data-testid="canvas-controls-compass"
        style={{
          width: 40,
          height: 40,
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          {/* Outer ring */}
          <circle
            cx="20" cy="20" r="18.5"
            fill="rgba(255,255,255,0.04)"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="1"
          />
          {/* 8 tick marks (every 45°) — fixed to the ring */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const r = (a * Math.PI) / 180;
            const r1 = 18.5;
            const r2 = a % 90 === 0 ? 15.5 : 16.5;
            return (
              <line
                key={a}
                x1={20 + r1 * Math.sin(r)} y1={20 - r1 * Math.cos(r)}
                x2={20 + r2 * Math.sin(r)} y2={20 - r2 * Math.cos(r)}
                stroke={a % 90 === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.20)'}
                strokeWidth={a % 90 === 0 ? 1.2 : 0.8}
              />
            );
          })}
        </svg>
        {/* Rotating needle group — drawn ABOVE the tick ring */}
        <svg
          width="40" height="40" viewBox="0 0 40 40"
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            transform: `rotate(${rotationDeg}deg)`,
            transition: 'transform 0.12s linear',
            pointerEvents: 'none',
          }}
        >
          {/* North half — red */}
          <polygon
            points="20,5 16.5,20 20,17 23.5,20"
            fill="#ff3333"
            opacity="0.95"
          />
          {/* South half — white */}
          <polygon
            points="20,35 16.5,20 20,23 23.5,20"
            fill="rgba(255,255,255,0.85)"
            opacity="0.95"
          />
          {/* Center dot */}
          <circle
            cx="20" cy="20" r="2"
            fill="rgba(255,255,255,0.95)"
            stroke="rgba(0,0,0,0.4)"
            strokeWidth="0.5"
          />
        </svg>
        {/* Cardinal label below needle, fixed */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: -14,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 9,
            color: 'rgba(255,255,255,0.7)',
            fontFamily: 'monospace',
            letterSpacing: 0.5,
            pointerEvents: 'none',
          }}
        >
          {Math.round(headingDeg)}° {cardinal}
        </div>
      </button>

      {/* spacer under compass to clear the readout label */}
      <div style={{ height: 14 }} />

      {/* ── 2. Zoom + ────────────────────────────────────────────── */}
      <IconButton
        onClick={handleZoomIn}
        label="Zoom in"
        testId="canvas-controls-zoom-in"
        content={<span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, marginTop: -2 }}>+</span>}
      />

      {/* ── 3. Zoom − ────────────────────────────────────────────── */}
      <IconButton
        onClick={handleZoomOut}
        label="Zoom out"
        testId="canvas-controls-zoom-out"
        content={<span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, marginTop: -2 }}>−</span>}
      />

      {/* ── 4–6. Layer toggles (up to 3) ─────────────────────────── */}
      {layers.slice(0, 3).map((layer) => (
        <LayerButton key={layer.key} layer={layer} />
      ))}
    </div>
  );
};

// ─── Sub-components ────────────────────────────────────────────────────

interface IconButtonProps {
  onClick: () => void;
  label: string;
  testId: string;
  content: React.ReactNode;
}

const IconButton: React.FC<IconButtonProps> = ({ onClick, label, testId, content }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    data-testid={testId}
    style={{
      width: 32,
      height: 32,
      padding: 0,
      border: 'none',
      borderRadius: 6,
      background: 'rgba(255,255,255,0.06)',
      color: 'rgba(255,255,255,0.85)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background 0.15s ease, color 0.15s ease, transform 0.15s ease',
    }}
    onMouseEnter={(e) => {
      const el = e.currentTarget as HTMLButtonElement;
      el.style.background = 'rgba(255,255,255,0.14)';
      el.style.transform = 'scale(1.04)';
    }}
    onMouseLeave={(e) => {
      const el = e.currentTarget as HTMLButtonElement;
      el.style.background = 'rgba(255,255,255,0.06)';
      el.style.transform = 'scale(1)';
    }}
    onMouseDown={(e) => {
      (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.96)';
    }}
    onMouseUp={(e) => {
      (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.04)';
    }}
  >
    {content}
  </button>
);

interface LayerButtonProps {
  layer: LayerToggle;
}

const LayerButton: React.FC<LayerButtonProps> = ({ layer }) => (
  <IconButton
    onClick={layer.onToggle}
    label={layer.label}
    testId={`canvas-controls-layer-${layer.key}`}
    content={
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{
          fill: layer.on ? '#ff8c00' : 'rgba(255,255,255,0.55)',
          stroke: layer.on ? '#ff8c00' : 'rgba(255,255,255,0.55)',
          strokeWidth: 1.5,
          transition: 'fill 0.15s ease, stroke 0.15s ease',
        }}
      >
        <path d={layer.iconPath} />
      </svg>
    }
  />
);
