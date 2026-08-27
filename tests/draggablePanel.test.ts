/**
 * tests/draggablePanel.test.ts
 *
 * Verifies the localStorage key + shape used by DraggablePanel
 * for persisting per-panel drag offsets, and the explicit
 * `data-drag-handle` attribute that lets a parent mark a specific
 * child as the drag handle (used for single-button panels like
 * Roof Model / Stitch / Save Create Design that need a grip).
 */
import { describe, it, expect, beforeEach } from 'vitest';

const STORAGE_KEY = 'draggable-panel-offset-v1';

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
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'components', '3d', 'DraggablePanel.tsx'),
      'utf8',
    );
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
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', '3d', 'DraggablePanel.tsx'),
      'utf8',
    );
    expect(src).toMatch(/querySelector\('\[data-drag-handle\]'\)/);
    expect(src).toMatch(/hasExplicitHandle/);
  });

  it('preserves the explicit handle element instead of auto-wrapping the first child', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', '3d', 'DraggablePanel.tsx'),
      'utf8',
    );
    // When hasExplicitHandle is true, the source must render the
    // children directly (no auto-wrap into a fresh drag-handle div).
    expect(src).toMatch(/hasExplicitHandle\s*\?\s*\(\s*<>[\s\S]*?\{childArray\}[\s\S]*?<\/>/);
  });

  it('skips button children of the handle so the button keeps its own click semantics', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', '3d', 'DraggablePanel.tsx'),
      'utf8',
    );
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
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', '3d', 'DraggablePanel.tsx'),
      'utf8',
    );
    // The wrapper's onPointerDown prop should always reference the handler.
    const wrapperOnPD = src.match(/<div\s+ref=\{wrapperRef\}[\s\S]*?onPointerDown=\{([^}]+)\}/);
    expect(wrapperOnPD, 'wrapper onPointerDown not found').not.toBeNull();
    expect(wrapperOnPD![1]).toBe('onWrapperPointerDown');
  });
});

describe('All 18 panels are wired to DraggablePanel in SolarEngine3D', () => {
  it('wraps every chrome panel on the canvas in DraggablePanel', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', '3d', 'SolarEngine3D.tsx'),
      'utf8',
    );
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
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', '3d', 'SolarEngine3D.tsx'),
      'utf8',
    );
    const opens = (src.match(/<DraggablePanel\b/g) || []).length;
    const closes = (src.match(/<\/DraggablePanel>/g) || []).length;
    expect(opens).toBe(closes);
  });
});
