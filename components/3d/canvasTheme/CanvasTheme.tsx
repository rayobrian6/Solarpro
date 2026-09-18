/**
 * components/3d/canvasTheme/CanvasTheme.tsx
 *
 * The dark-canvas overlay for the 3D design surface (Aurora parity).
 *
 * Renders a single absolutely-positioned `<div>` over the Cesium
 * container with the dark navy background + stacked linear-gradient
 * grid. The overlay is purely cosmetic — `pointer-events: none` so
 * Cesium pick events pass through.
 *
 * This is a thin React wrapper. All the policy (palette, grid, phase
 * mapping) lives in `canvasTheme.constants.ts` and is unit-tested
 * independently.
 *
 * Behavior:
 *  - `phase='design'`      → renders dark + grid overlay
 *  - `phase='site_model'`  → returns `null` (no overlay)
 *
 * The overlay also sets `data-canvas-phase={phase}` on the div. This
 * is the integration hook for the `map-sources` agent — they can read
 * the attribute (via `MutationObserver`, a CSS attribute selector, or
 * a styled-components theme) to dim the Cesium imagery when the phase
 * flips to `'design'`. See ./DESIGN.md §3.2.
 *
 * Design doc: ./DESIGN.md
 */

'use client';

import React from 'react';
import {
  getThemeForPhase,
  shouldRenderOverlay,
  type CanvasPhase,
} from './canvasTheme.constants';

// ── Props ───────────────────────────────────────────────────────────────────

export interface CanvasThemeProps {
  /**
   * Which visual phase the 3D design surface is in.
   *
   * - `'site_model'` — no overlay rendered (Cesium satellite imagery is the background)
   * - `'design'`     — dark + grid overlay painted over the canvas
   */
  phase: CanvasPhase;
}

// ── Component ───────────────────────────────────────────────────────────────

export function CanvasTheme({ phase }: CanvasThemeProps) {
  // Site Model: no overlay. The Cesium globe + Google satellite imagery
  // is the background; layering a dark overlay on top would hide the
  // very thing the user is trying to draw on.
  if (!shouldRenderOverlay(phase)) return null;

  const theme = getThemeForPhase(phase);

  // Design: dark + grid overlay. Sits above the Cesium container
  // (positioned absolutely, zIndex 5) but below the legend (zIndex 20)
  // and the wizard (auto z-index, no override). `pointer-events: none`
  // ensures Cesium pick events still reach the canvas.
  return (
    <div
      aria-hidden="true"
      data-canvas-phase={theme.dataAttribute}
      className={theme.className}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        zIndex: 5,
        background: theme.background,
        backgroundImage: theme.gridBackgroundImage,
        backgroundSize: theme.gridBackgroundSize,
        // Prevent the overlay from intercepting the cursor; some
        // browsers will still report hover events for an inert div
        // unless we explicitly set this.
        contain: 'strict',
      }}
    />
  );
}
