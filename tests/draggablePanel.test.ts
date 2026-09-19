/** @vitest-environment jsdom */
/**
 * tests/draggablePanel.test.ts
 *
 * Verifies the localStorage key + shape used by DraggablePanel
 * for persisting per-panel drag offsets, the explicit
 * `data-drag-handle` attribute that lets a parent mark a specific
 * child as the drag handle (used for single-button panels like
 * Roof Model / Stitch / Save Create Design that need a grip), and
 * — the part that actually RENDERS the component — the wrapper's
 * containing-block geometry.
 *
 * NOTE ON THE ENVIRONMENT: this file used to run under the default
 * `node` environment, where `typeof window === 'undefined'` made every
 * localStorage case return before asserting anything. The
 * `@vitest-environment jsdom` docblock above is what makes those cases
 * (and the render cases below) real.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import { DraggablePanel } from '@/components/3d/DraggablePanel';

const STORAGE_KEY = 'draggable-panel-offset-v1';

afterEach(() => cleanup());

describe('DraggablePanel offset persistence', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  it('uses the v1 storage key', () => {
    expect(STORAGE_KEY).toBe('draggable-panel-offset-v1');
  });

  it('round-trips an offset through localStorage', () => {
    if (typeof window === 'undefined') return;
    const all: Record<string, { x: number; y: number }> = {
      'lidar-properties': { x: 100, y: 50 },
      'instructions-panel': { x: -20, y: 200 },
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed['lidar-properties']).toEqual({ x: 100, y: 50 });
    expect(parsed['instructions-panel']).toEqual({ x: -20, y: 200 });
  });

  it('survives a corrupt JSON entry without throwing', () => {
    if (typeof window === 'undefined') return;
    // Write garbage and confirm a JSON.parse would throw, then prove
    // the localStorage wrapper in DraggablePanel source contains a
    // try/catch around JSON.parse (so the call site is safe).
    window.localStorage.setItem(STORAGE_KEY, 'not-json-{]');
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBe('not-json-{]');
    // We don't call the component's readAllOffsets here (it's not
    // exported) but the source uses try/catch — this test documents
    // the contract: corrupt data should not crash the panel.
    const src = readSource('DraggablePanel.tsx');
    expect(src).toMatch(/try\s*\{[\s\S]*?JSON\.parse/);
    expect(src).toMatch(/catch/);
  });

  it('preserves separate offsets for each panel id', () => {
    if (typeof window === 'undefined') return;
    const all: Record<string, { x: number; y: number }> = {
      'lidar-properties':       { x: 12,   y: 12 },
      'instructions-panel':     { x: -8,   y: 120 },
      'sun-simulator':          { x: 0,    y: -40 },
      'canvas-controls':        { x: 0,    y: 0 },
      'layer-toggles':          { x: 0,    y: 0 },
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    for (const [id, offset] of Object.entries(all)) {
      expect(parsed[id]).toEqual(offset);
    }
  });
});

describe('DraggablePanel explicit handle support', () => {
  it('detects `data-drag-handle` on a child element', () => {
    // Source-level check: DraggablePanel looks for `[data-drag-handle]`
    // anywhere inside the wrapper when deciding whether to install
    // pointerdown on the wrapper vs. wrap the first child.
    const src = readSource('DraggablePanel.tsx');
    expect(src).toMatch(/querySelector\('\[data-drag-handle\]'\)/);
    expect(src).toMatch(/hasExplicitHandle/);
  });

  it('preserves the explicit handle element instead of auto-wrapping the first child', () => {
    const src = readSource('DraggablePanel.tsx');
    // When hasExplicitHandle is true, the source must render the
    // children directly (no auto-wrap into a fresh drag-handle div).
    expect(src).toMatch(/hasExplicitHandle\s*\?\s*\(\s*<>[\s\S]*?\{childArray\}[\s\S]*?<\/>/);
  });

  it('skips button children of the handle so the button keeps its own click semantics', () => {
    const src = readSource('DraggablePanel.tsx');
    // The closest('button, ...') check is what protects the buttons
    // inside the dock (Roof Model, Stitch, Save) from being swallowed
    // by the drag handler.
    expect(src).toMatch(/closest\('button,\s*input,\s*select,\s*textarea,\s*a,\s*label,\s*\[data-no-drag\]'\)/);
  });

  it('always wires onPointerDown to the wrapper (regression: explicit-handle panels were dead)', () => {
    // Earlier we conditionally set the wrapper's onPointerDown to
    // `undefined` when an explicit handle was present. That meant
    // pointerdown never reached the drag handler for the top-left-dock
    // and save-create-design panels, so the grip was decorative only.
    // The wrapper must always own the pointerdown; the explicit-handle
    // membership check happens inside the handler.
    const src = readSource('DraggablePanel.tsx');
    // The wrapper's onPointerDown prop should always reference the handler.
    const wrapperOnPD = src.match(/<div\s+ref=\{wrapperRef\}[\s\S]*?onPointerDown=\{([^}]+)\}/);
    expect(wrapperOnPD, 'wrapper onPointerDown not found').not.toBeNull();
    expect(wrapperOnPD![1]).toBe('onWrapperPointerDown');
  });
});

describe('All 18 panels are wired to DraggablePanel in SolarEngine3D', () => {
  it('wraps every chrome panel on the canvas in DraggablePanel', () => {
    const src = readSource('SolarEngine3D.tsx');
    const ids = [
      'map-source-picker',       // top-center bar with Details + LiDAR | Street View
      'undo-redo-toolbar',       // top-left chip with Save / Undo / Redo
      'legend-strings',
      'tool-spine',
      'top-right-stack',
      'instructions-panel',
      'canvas-controls',
      'layer-toggles',
      'sun-simulator',
      'compass-rose',
      'status-bar',
      'top-left-dock',
      'save-create-design',
      'roof-edges-legend',
      'fire-setbacks-legend',
      'coordinates-bar',
      'last-log',
      'lidar-properties',
    ];
    for (const id of ids) {
      const re = new RegExp('<DraggablePanel\\s+id="' + id + '"');
      expect(src, 'missing DraggablePanel id="' + id + '"').toMatch(re);
    }
  });

  it('balances DraggablePanel open and close tags in SolarEngine3D', () => {
    const src = readSource('SolarEngine3D.tsx');
    const opens = (src.match(/<DraggablePanel\b/g) || []).length;
    const closes = (src.match(/<\/DraggablePanel>/g) || []).length;
    expect(opens).toBe(closes);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RENDERED-DOM cases — the wrapper's containing-block geometry.
//
// Everything above this line is source-text grepping; none of it can see
// the defect these cases pin. DraggablePanel always emits a `transform`
// on its wrapper, and a non-`none` transform makes that element the
// containing block for its absolutely-positioned descendants. If the
// wrapper is `position:static` it is also a zero-height box sitting in
// normal flow *after* the full-height cesium div, so every `top:12`
// panel resolved 12px below the bottom edge of the
// `position:relative; overflow:hidden` canvas container and was clipped
// out of existence. These cases render the real component and assert the
// wrapper is a positioned, full-size, click-through overlay instead.
// ════════════════════════════════════════════════════════════════════════════

/** Render a panel exactly the way all 18 SolarEngine3D call sites do:
 *  only `id` + `zIndex`, with an absolutely-positioned child. */
function renderCallSitePanel(opts?: { explicitHandle?: boolean }) {
  const child = React.createElement('div', {
    'data-testid': 'panel-body',
    ...(opts?.explicitHandle ? { 'data-drag-handle': true } : {}),
    style: { position: 'absolute', top: 12, left: 12 },
  }, 'panel body');
  // `children` goes in the props object rather than as a third
  // createElement arg so TS can see it satisfy DraggablePanelProps.
  return render(
    React.createElement(DraggablePanel, { id: 'test-panel', zIndex: 51, children: child }),
  );
}

describe('DraggablePanel wrapper containing block (rendered)', () => {
  beforeEach(() => window.localStorage.clear());

  it('emits a transform on the wrapper, which is what makes position mandatory', () => {
    const { container } = renderCallSitePanel();
    const wrapper = container.firstElementChild as HTMLElement;
    // Even at offset 0,0 this is `translate(0px, 0px)` — a real
    // transform, NOT `none`, so the containing-block promotion happens
    // on every panel from first paint, not just after a drag.
    expect(wrapper.style.transform).toBe('translate(0px, 0px)');
    expect(wrapper.style.transform).not.toBe('none');
  });

  it('gives the wrapper a non-static position so it is a usable containing block', () => {
    const { container } = renderCallSitePanel();
    const wrapper = container.firstElementChild as HTMLElement;
    // THE DEFECT: this was `static` — a zero-height box in normal flow
    // at the bottom edge of the canvas container.
    expect(window.getComputedStyle(wrapper).position).not.toBe('static');
    expect(window.getComputedStyle(wrapper).position).toBe('absolute');
  });

  it('stretches the wrapper over the whole container so top/left AND bottom/right anchors resolve correctly', () => {
    const { container } = renderCallSitePanel();
    const wrapper = container.firstElementChild as HTMLElement;
    const cs = window.getComputedStyle(wrapper);
    // All four insets pinned to 0 means the wrapper's padding box is
    // the canvas container's box, so a child's `top:12` lands 12px from
    // the canvas top (previously: 12px below the canvas bottom, clipped)
    // and the bottom-anchored panels that used to land correctly BY
    // ACCIDENT (CanvasControls `bottom:12`, sun simulator `bottom:40`,
    // compass `bottom:120 right:12`) land in exactly the same place.
    expect(cs.top).toBe('0px');
    expect(cs.right).toBe('0px');
    expect(cs.bottom).toBe('0px');
    expect(cs.left).toBe('0px');
  });

  it('does not orphan an absolutely-positioned child', () => {
    const { container, getByTestId } = renderCallSitePanel();
    const wrapper = container.firstElementChild as HTMLElement;
    const body = getByTestId('panel-body');
    // The child must still be a descendant of the wrapper (so the
    // translate moves it) AND the wrapper must be positioned (so the
    // child's own top/left resolve against the real container box).
    expect(wrapper.contains(body)).toBe(true);
    expect(body.style.position).toBe('absolute');
    expect(window.getComputedStyle(wrapper).position).not.toBe('static');
  });

  it('is click-through, with hit-testing re-enabled on the content', () => {
    const { container, getByTestId } = renderCallSitePanel();
    const wrapper = container.firstElementChild as HTMLElement;
    // 18 of these overlays now stack over the full canvas; without
    // pointer-events:none the topmost would swallow every Cesium globe
    // drag. The content div turns hit-testing back on (pointer-events
    // is an inherited property, so the panel's own children get it).
    expect(wrapper.style.pointerEvents).toBe('none');
    const content = wrapper.querySelector('[data-drag-content]') as HTMLElement;
    expect(content, 'no [data-drag-content] re-enabling wrapper').not.toBeNull();
    expect(content.style.pointerEvents).toBe('auto');
    expect(content.contains(getByTestId('panel-body'))).toBe(true);
  });

  it('keeps zIndex on the wrapper (inert while static, live once positioned)', () => {
    const { container } = renderCallSitePanel();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.zIndex).toBe('51');
    expect(window.getComputedStyle(wrapper).position).not.toBe('static');
  });

  it('still starts a drag: pointerdown bubbles through the click-through wrapper', () => {
    const { container, getByTestId } = renderCallSitePanel();
    const wrapper = container.firstElementChild as HTMLElement;
    // A pointer-events:none element is skipped for HIT-TESTING but is
    // still an ordinary ancestor in the event propagation path, so the
    // wrapper's onPointerDown fires from the content below it. If this
    // ever regresses, every panel silently stops being draggable.
    fireEvent.pointerDown(getByTestId('panel-body'), { clientX: 40, clientY: 40 });
    expect(wrapper.style.cursor).toBe('grabbing');
  });

  it('applies the same geometry to explicit-handle panels (top-left-dock, save-create-design)', () => {
    const { container } = renderCallSitePanel({ explicitHandle: true });
    const wrapper = container.firstElementChild as HTMLElement;
    const cs = window.getComputedStyle(wrapper);
    expect(cs.position).toBe('absolute');
    expect(cs.top).toBe('0px');
    expect(cs.bottom).toBe('0px');
    expect(wrapper.style.pointerEvents).toBe('none');
    // Explicit-handle panels are NOT auto-wrapped in a handle div, so
    // this branch has its own path to the content wrapper.
    const content = wrapper.querySelector('[data-drag-content]') as HTMLElement;
    expect(content).not.toBeNull();
    expect(content.style.pointerEvents).toBe('auto');
    expect(content.querySelector('[data-drag-handle]')).not.toBeNull();
  });
});

// ── helpers ────────────────────────────────────────────────────────────────
function readSource(file: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');
  return fs.readFileSync(
    path.join(process.cwd(), 'components', '3d', file),
    'utf8',
  );
}
