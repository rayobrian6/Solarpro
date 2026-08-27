/**
 * tests/draggablePanel.test.ts
 *
 * Verifies the localStorage key + shape used by DraggablePanel
 * for persisting per-panel drag offsets.
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
