/** @vitest-environment jsdom */
/**
 * components/3d/panel/__tests__/designPanel.test.tsx
 *
 * Tests for the design-phase right panel.
 *
 * Sections:
 *   1. Pure data: DESIGN_TOOLS shape, order, completeness
 *   2. Pure data: SITE_MODEL_TOOLS shape
 *   3. Pure function: designHotkeyToToolId (key → tool id)
 *   4. Pure function: hasModifierKey
 *   5. Component: phase switching, row rendering, click → onToolChange
 *   6. Component: hotkey integration (window keydown)
 *   7. Component: collapse toggle
 *
 * The component tests use @testing-library/react with jsdom.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import {
  DESIGN_TOOLS,
  SITE_MODEL_TOOLS,
  getToolsForPhase,
  findTool,
  designHotkeyToToolId,
  hasModifierKey,
  RightPanel,
} from '@/components/3d/panel';
import type { ToolId, PanelEntry } from '@/components/3d/panel';

// Force-unmount between tests so the global keydown listener from the
// previous test doesn't bleed into the next.
afterEach(() => cleanup());

// ════════════════════════════════════════════════════════════════════════════
// 1. Pure data — DESIGN_TOOLS
// ════════════════════════════════════════════════════════════════════════════

describe('DESIGN_TOOLS — Aurora frame 147 parity', () => {
  it('has exactly 9 entries (Aurora parity bar)', () => {
    expect(DESIGN_TOOLS).toHaveLength(9);
  });

  it('every entry has the required fields populated', () => {
    for (const entry of DESIGN_TOOLS) {
      expect(entry.id).toBeTruthy();
      expect(entry.icon).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.phase).toBe('design');
      expect(entry.tip).toBeTruthy();
    }
  });

  it('every id is unique', () => {
    const ids = DESIGN_TOOLS.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains the 9 Aurora design tools in the expected order', () => {
    const expected: ToolId[] = [
      'auto-design',
      'solar-panels',
      'inverter',
      'bos',
      'string-modules',
      'connect',
      'walkway',
      'roof-face-info',
      'ruler',
    ];
    expect(DESIGN_TOOLS.map(e => e.id)).toEqual(expected);
  });

  it('hotkey-bearing entries match Aurora frame 147 parens', () => {
    // Aurora frame 147 shows: Auto Design (A), String Modules (S), Connect (C), Walkway (H)
    const withHotkey = DESIGN_TOOLS.filter(e => e.hotkey !== null).map(e => e.id);
    expect(withHotkey).toEqual(['auto-design', 'string-modules', 'connect', 'walkway']);
  });

  it('hotkeys are single lowercase letters', () => {
    for (const entry of DESIGN_TOOLS) {
      if (entry.hotkey !== null) {
        expect(entry.hotkey).toMatch(/^[a-z]$/);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Pure data — SITE_MODEL_TOOLS
// ════════════════════════════════════════════════════════════════════════════

describe('SITE_MODEL_TOOLS — Aurora HOFF §1 parity', () => {
  it('has 5 entries (Draw Roof, Draw Tree, Add Obstruction, Measurements, Ruler)', () => {
    expect(SITE_MODEL_TOOLS).toHaveLength(5);
  });

  it('contains the expected tools in order', () => {
    expect(SITE_MODEL_TOOLS.map(e => e.id)).toEqual([
      'draw-roof',
      'draw-tree',
      'add-obstruction',
      'measurements',
      'ruler',
    ]);
  });

  it('every entry is tagged phase=site_model', () => {
    for (const entry of SITE_MODEL_TOOLS) {
      expect(entry.phase).toBe('site_model');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Pure function — designHotkeyToToolId
// ════════════════════════════════════════════════════════════════════════════

describe('designHotkeyToToolId', () => {
  it("'a' maps to auto-design", () => {
    expect(designHotkeyToToolId('a')).toBe('auto-design');
  });

  it("'A' (uppercase) maps to auto-design (case-insensitive)", () => {
    expect(designHotkeyToToolId('A')).toBe('auto-design');
  });

  it("'s' maps to string-modules", () => {
    expect(designHotkeyToToolId('s')).toBe('string-modules');
  });

  it("'c' maps to connect", () => {
    expect(designHotkeyToToolId('c')).toBe('connect');
  });

  it("'h' maps to walkway", () => {
    expect(designHotkeyToToolId('h')).toBe('walkway');
  });

  it("unmapped keys return null", () => {
    expect(designHotkeyToToolId('x')).toBeNull();
    expect(designHotkeyToToolId('z')).toBeNull();
    expect(designHotkeyToToolId('q')).toBeNull();
  });

  it("non-letter keys (Enter, Tab, Escape, arrow keys) return null", () => {
    expect(designHotkeyToToolId('Enter')).toBeNull();
    expect(designHotkeyToToolId('Tab')).toBeNull();
    expect(designHotkeyToToolId('Escape')).toBeNull();
    expect(designHotkeyToToolId('ArrowUp')).toBeNull();
    expect(designHotkeyToToolId(' ')).toBeNull();
  });

  it("empty string returns null", () => {
    expect(designHotkeyToToolId('')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Pure function — hasModifierKey
// ════════════════════════════════════════════════════════════════════════════

describe('hasModifierKey', () => {
  it('returns false when no modifier is held', () => {
    expect(hasModifierKey({ ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });
  it('returns true when Ctrl is held', () => {
    expect(hasModifierKey({ ctrlKey: true })).toBe(true);
  });
  it('returns true when Meta (Cmd on Mac) is held', () => {
    expect(hasModifierKey({ metaKey: true })).toBe(true);
  });
  it('returns true when Alt is held', () => {
    expect(hasModifierKey({ altKey: true })).toBe(true);
  });
  it('treats missing keys as not-held', () => {
    expect(hasModifierKey({})).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Component — phase switching + row rendering
// ════════════════════════════════════════════════════════════════════════════

describe('<RightPanel> — phase switching', () => {
  it('renders 9 design tool rows when phase="design"', () => {
    render(<RightPanel phase="design" />);
    for (const entry of DESIGN_TOOLS) {
      expect(screen.getByTestId(`right-panel-row-${entry.id}`)).toBeInTheDocument();
    }
  });

  it('renders 0 design-exclusive tool rows when phase="site_model"', () => {
    render(<RightPanel phase="site_model" />);
    // Aurora HOFF §1 + §6: Ruler is the one tool shared between phases.
    // The 8 design-exclusive tools (auto-design, solar-panels, inverter, bos,
    // string-modules, connect, walkway, roof-face-info) must NOT render in
    // site-model mode.
    const designExclusive = DESIGN_TOOLS.filter(e => e.id !== 'ruler');
    for (const entry of designExclusive) {
      expect(screen.queryByTestId(`right-panel-row-${entry.id}`)).toBeNull();
    }
    // But all 5 site-model rows should (draw-roof, draw-tree, add-obstruction,
    // measurements, ruler).
    for (const entry of SITE_MODEL_TOOLS) {
      expect(screen.getByTestId(`right-panel-row-${entry.id}`)).toBeInTheDocument();
    }
  });

  it('defaults to phase="design" when no phase is passed', () => {
    render(<RightPanel />);
    expect(screen.getByTestId('right-panel-row-auto-design')).toBeInTheDocument();
    expect(screen.queryByTestId('right-panel-row-draw-roof')).toBeNull();
  });

  it('renders the correct number of buttons for each phase', () => {
    const { rerender } = render(<RightPanel phase="design" />);
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(9 + 1); // 9 rows + toggle
    rerender(<RightPanel phase="site_model" />);
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(5 + 1); // 5 rows + toggle
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. Component — click → onToolChange
// ════════════════════════════════════════════════════════════════════════════

describe('<RightPanel> — click behavior', () => {
  it('clicking a row calls onToolChange with the entry id', () => {
    const onChange = vi.fn();
    render(<RightPanel phase="design" onToolChange={onChange} />);
    fireEvent.click(screen.getByTestId('right-panel-row-auto-design'));
    expect(onChange).toHaveBeenCalledWith('auto-design');
  });

  it('clicking a different row emits the new id (does not stack)', () => {
    const onChange = vi.fn();
    render(<RightPanel phase="design" onToolChange={onChange} />);
    fireEvent.click(screen.getByTestId('right-panel-row-auto-design'));
    fireEvent.click(screen.getByTestId('right-panel-row-walkway'));
    expect(onChange).toHaveBeenNthCalledWith(1, 'auto-design');
    expect(onChange).toHaveBeenNthCalledWith(2, 'walkway');
  });

  it('re-clicking the active row emits null (toggle off)', () => {
    const onChange = vi.fn();
    render(<RightPanel phase="design" onToolChange={onChange} />);
    const row = screen.getByTestId('right-panel-row-auto-design');
    fireEvent.click(row);
    fireEvent.click(row);
    expect(onChange).toHaveBeenNthCalledWith(1, 'auto-design');
    expect(onChange).toHaveBeenNthCalledWith(2, null);
  });

  it('uncontrolled mode updates internal state without parent callback', () => {
    render(<RightPanel phase="design" />);
    const row = screen.getByTestId('right-panel-row-auto-design');
    expect(row.getAttribute('data-active')).toBe('false');
    fireEvent.click(row);
    expect(row.getAttribute('data-active')).toBe('true');
  });

  it('controlled mode: active prop drives the highlighted row', () => {
    const { rerender } = render(<RightPanel phase="design" activeToolId={null} onToolChange={() => {}} />);
    expect(screen.getByTestId('right-panel-row-auto-design').getAttribute('data-active')).toBe('false');
    rerender(<RightPanel phase="design" activeToolId="auto-design" onToolChange={() => {}} />);
    expect(screen.getByTestId('right-panel-row-auto-design').getAttribute('data-active')).toBe('true');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7. Component — hotkey integration
// ════════════════════════════════════════════════════════════════════════════

describe('<RightPanel> — hotkey integration', () => {
  it('pressing the hotkey while phase="design" calls onToolChange', () => {
    const onChange = vi.fn();
    render(<RightPanel phase="design" onToolChange={onChange} />);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onChange).toHaveBeenCalledWith('auto-design');
  });

  it('pressing the hotkey while phase="site_model" does NOT fire', () => {
    const onChange = vi.fn();
    render(<RightPanel phase="site_model" onToolChange={onChange} />);
    fireEvent.keyDown(window, { key: 'a' });
    // a doesn't map to any site-model tool; even if it did, phase=site_model gates the listener
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Ctrl+key is ignored (does not hijack browser shortcuts)', () => {
    const onChange = vi.fn();
    render(<RightPanel phase="design" onToolChange={onChange} />);
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Meta+key is ignored (Mac Cmd)', () => {
    const onChange = vi.fn();
    render(<RightPanel phase="design" onToolChange={onChange} />);
    fireEvent.keyDown(window, { key: 'a', metaKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Alt+key is ignored', () => {
    const onChange = vi.fn();
    render(<RightPanel phase="design" onToolChange={onChange} />);
    fireEvent.keyDown(window, { key: 'a', altKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('enableHotkeys=false disables the global listener', () => {
    const onChange = vi.fn();
    render(<RightPanel phase="design" onToolChange={onChange} enableHotkeys={false} />);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('unmapped key is a no-op', () => {
    const onChange = vi.fn();
    render(<RightPanel phase="design" onToolChange={onChange} />);
    fireEvent.keyDown(window, { key: 'x' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 8. Component — collapse toggle
// ════════════════════════════════════════════════════════════════════════════

describe('<RightPanel> — collapse toggle', () => {
  it('toggle button is always visible', () => {
    render(<RightPanel phase="design" />);
    expect(screen.getByTestId('right-panel-toggle')).toBeInTheDocument();
  });

  it('clicking the toggle hides the row list', () => {
    render(<RightPanel phase="design" />);
    expect(screen.getByTestId('right-panel-row-auto-design')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('right-panel-toggle'));
    expect(screen.queryByTestId('right-panel-row-auto-design')).toBeNull();
  });

  it('clicking the toggle again shows the row list', () => {
    render(<RightPanel phase="design" />);
    fireEvent.click(screen.getByTestId('right-panel-toggle'));
    fireEvent.click(screen.getByTestId('right-panel-toggle'));
    expect(screen.getByTestId('right-panel-row-auto-design')).toBeInTheDocument();
  });

  it('collapsed=true (prop) starts with the list hidden', () => {
    render(<RightPanel phase="design" collapsed={true} />);
    expect(screen.queryByTestId('right-panel-row-auto-design')).toBeNull();
    expect(screen.getByTestId('right-panel-toggle')).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 9. Pure data — getToolsForPhase / findTool helpers
// ════════════════════════════════════════════════════════════════════════════

describe('getToolsForPhase + findTool', () => {
  it("getToolsForPhase('design') returns DESIGN_TOOLS", () => {
    expect(getToolsForPhase('design')).toBe(DESIGN_TOOLS);
  });
  it("getToolsForPhase('site_model') returns SITE_MODEL_TOOLS", () => {
    expect(getToolsForPhase('site_model')).toBe(SITE_MODEL_TOOLS);
  });
  it("findTool('auto-design') returns the auto-design entry", () => {
    const e = findTool('auto-design');
    expect(e?.id).toBe('auto-design');
    expect(e?.hotkey).toBe('a');
  });
  it("findTool('does-not-exist') returns undefined", () => {
    expect(findTool('does-not-exist')).toBeUndefined();
  });
});
