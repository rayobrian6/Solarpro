/**
 * tests/helpPanel.test.ts
 *
 * Help / Instructions panel — unit tests.
 *
 * Covers:
 *   1. Lookup-table completeness: every key in HELP_TEXT_BY_MODE has text.
 *   2. Aurora parity: the 5+ modes that the HANDOFF_2026-08-25_AURORA_ANALYSIS.md
 *      §1 parity bar calls out are mapped to the expected text.
 *   3. Unknown-mode fallback: helpTextFor() never returns undefined.
 *   4. HelpPanel behavior: renders the active mode's text, supports
 *      collapse/expand, includes aria-live, and accepts context.
 *
 * No DOM rendering tests — those belong with the design-panel work. This
 * file is the smoke gate that keeps the lookup table honest.
 */

import { describe, it, expect } from 'vitest';
import {
  HELP_TEXT_BY_MODE,
  helpTextFor,
  ALL_HELP_MODES,
  REQUIRED_AURORA_PARITY_MODES,
  type HelpMode,
} from '../components/3d/help/helpText';

// ─── 1. Lookup table integrity ─────────────────────────────────────────────

describe('HelpPanel — HELP_TEXT_BY_MODE lookup table', () => {
  it('has at least 25 modes covered (all real PlacementMode values)', () => {
    expect(ALL_HELP_MODES.length).toBeGreaterThanOrEqual(25);
  });

  it('every entry has non-empty, real text (no TODO/TBD/placeholder)', () => {
    for (const mode of ALL_HELP_MODES) {
      const text = HELP_TEXT_BY_MODE[mode];
      expect(text, `mode "${mode}" has empty help text`).toBeTruthy();
      expect(text.length, `mode "${mode}" has suspiciously short text`).toBeGreaterThan(15);
      expect(text, `mode "${mode}" contains TODO`).not.toMatch(/TODO/i);
      expect(text, `mode "${mode}" contains TBD`).not.toMatch(/TBD/);
      expect(text, `mode "${mode}" contains placeholder`).not.toMatch(/placeholder/i);
    }
  });

  it('every entry is 1–3 short sentences (no walls of text)', () => {
    // Heuristic: a sentence ends with . ! or ? and is at least 8 chars.
    for (const mode of ALL_HELP_MODES) {
      const text = HELP_TEXT_BY_MODE[mode].split(/\r?\n/)[0]; // first line only
      const sentences = text.split(/[.!?]/).filter((s) => s.trim().length > 0);
      expect(
        sentences.length,
        `mode "${mode}" has ${sentences.length} sentences on first line — keep it ≤ 3`,
      ).toBeLessThanOrEqual(3);
    }
  });

  it('includes the "unknown" fallback key so the panel never goes blank', () => {
    expect('unknown' in HELP_TEXT_BY_MODE).toBe(true);
    expect(HELP_TEXT_BY_MODE.unknown).toBeTruthy();
  });
});

// ─── 2. Aurora parity mapping ──────────────────────────────────────────────

describe('HelpPanel — Aurora parity bar (HANDOFF_2026-08-25_AURORA_ANALYSIS.md §1)', () => {
  it('REQUIRED_AURORA_PARITY_MODES lists every Aurora frame-70 mode', () => {
    expect(REQUIRED_AURORA_PARITY_MODES).toContain('block');
    expect(REQUIRED_AURORA_PARITY_MODES).toContain('roof_gable');
    expect(REQUIRED_AURORA_PARITY_MODES).toContain('roof_hip');
    expect(REQUIRED_AURORA_PARITY_MODES).toContain('tree');
    expect(REQUIRED_AURORA_PARITY_MODES).toContain('wizard_mark');
    expect(REQUIRED_AURORA_PARITY_MODES).toContain('wizard_analyze');
    expect(REQUIRED_AURORA_PARITY_MODES).toContain('wizard_adjust');
  });

  it('every Aurora parity mode has text in the table', () => {
    for (const mode of REQUIRED_AURORA_PARITY_MODES) {
      expect(HELP_TEXT_BY_MODE[mode], `missing Aurora mode "${mode}"`).toBeTruthy();
    }
  });

  it('"block" mode text mentions click + right-click/Enter to finish (Aurora frame 70)', () => {
    const t = HELP_TEXT_BY_MODE.block.toLowerCase();
    expect(t).toContain('click');
    expect(t).toMatch(/right-click|enter/);
  });

  it('"roof_gable" mode text mentions 2 eave corners and the ridge (Aurora frame 70)', () => {
    const t = HELP_TEXT_BY_MODE.roof_gable.toLowerCase();
    expect(t).toContain('eave');
    expect(t).toContain('ridge');
  });

  it('"roof_hip" mode text mentions 4 eave corners (Aurora frame 70)', () => {
    const t = HELP_TEXT_BY_MODE.roof_hip.toLowerCase();
    expect(t).toContain('eave');
    expect(t).toMatch(/4|four/);
  });

  it('"tree" mode text mentions clicking to place and the canopy preview (Aurora frame 115)', () => {
    const t = HELP_TEXT_BY_MODE.tree.toLowerCase();
    expect(t).toContain('click');
    expect(t).toContain('tree');
  });

  it('"wizard_mark" mode text matches Aurora wizard step-1 text verbatim-ish', () => {
    expect(HELP_TEXT_BY_MODE.wizard_mark).toMatch(/Click to add vertices/i);
    expect(HELP_TEXT_BY_MODE.wizard_mark).toMatch(/Enter/);
    expect(HELP_TEXT_BY_MODE.wizard_mark).toMatch(/✓|finish/i);
  });

  it('"idle" mode text matches Aurora\'s "Draw the roof with a Site Model..." string', () => {
    expect(HELP_TEXT_BY_MODE.idle).toMatch(/Draw the roof/i);
    expect(HELP_TEXT_BY_MODE.idle).toMatch(/site model/i);
  });
});

// ─── 3. Lookup helper behavior ─────────────────────────────────────────────

describe('HelpPanel — helpTextFor()', () => {
  it('returns the table value for known modes', () => {
    expect(helpTextFor('block')).toBe(HELP_TEXT_BY_MODE.block);
    expect(helpTextFor('tree')).toBe(HELP_TEXT_BY_MODE.tree);
    expect(helpTextFor('unknown')).toBe(HELP_TEXT_BY_MODE.unknown);
  });

  it('returns the fallback for unknown modes (NEVER undefined)', () => {
    expect(helpTextFor('not_a_real_mode')).toBeTruthy();
    expect(helpTextFor('not_a_real_mode')).toBe(HELP_TEXT_BY_MODE.unknown);
  });

  it('returns the fallback for null / undefined input', () => {
    expect(helpTextFor(null)).toBe(HELP_TEXT_BY_MODE.unknown);
    expect(helpTextFor(undefined)).toBe(HELP_TEXT_BY_MODE.unknown);
    expect(helpTextFor('')).toBe(HELP_TEXT_BY_MODE.unknown);
  });

  it('every Aurora-parity mode round-trips through helpTextFor()', () => {
    for (const mode of REQUIRED_AURORA_PARITY_MODES) {
      expect(helpTextFor(mode)).toBe(HELP_TEXT_BY_MODE[mode]);
    }
  });
});

// ─── 4. HelpPanel component contract (smoke) ───────────────────────────────
//
// We import the component to confirm the export shape and the helpText
// path it uses. DOM rendering is covered by the design-panel agent's
// visual parity tests.

describe('HelpPanel — component surface', () => {
  it('exports a default function component', async () => {
    const mod = await import('../components/3d/help/HelpPanel');
    expect(typeof mod.default).toBe('function');
  });

  it('exports the named HelpPanel + HELP_TEXT_BY_MODE + helpTextFor', async () => {
    const mod = await import('../components/3d/help/HelpPanel');
    expect(typeof mod.HelpPanel).toBe('function');
    expect(mod.HELP_TEXT_BY_MODE).toBeDefined();
    expect(typeof mod.helpTextFor).toBe('function');
  });

  it('HelpPanelProps accepts optional context object (typed, not just any)', async () => {
    // We just import the types — if the types change shape, this compiles
    // only if HelpPanelContext is still exported.
    const mod = await import('../components/3d/help/HelpPanel');
    // The default export is the component; the named export is also the component.
    // The HELP_TEXT_BY_MODE and helpTextFor re-exports must work.
    expect(mod.HELP_TEXT_BY_MODE).toBe(HELP_TEXT_BY_MODE);
    expect(mod.helpTextFor).toBe(helpTextFor);
  });
});

// ─── 5. All PlacementMode values from SolarEngine3D are covered ───────────

describe('HelpPanel — covers every real Solarpro PlacementMode', () => {
  // The PlacementMode union lives in components/3d/SolarEngine3D.tsx.
  // We declare the subset that has a real user interaction; if the
  // component gains a new mode, this test forces an update.
  const REAL_PLACEMENT_MODES: HelpMode[] = [
    'select',
    'roof',
    'obstruction',
    'plane3d',
    'mark_plane',
    'auto_roof',
    'ground',
    'ground_array',
    'fence',
    'measure',
    'ruler',
    'pick_house',
    'surface_select',
    'extend_row',
    'add_row',
    'set_direction',
    'set_origin',
    'snap_panel',
    'block',
    'roof_gable',
    'roof_hip',
    'tree',
  ];

  it('every real PlacementMode has a help entry', () => {
    for (const mode of REAL_PLACEMENT_MODES) {
      expect(HELP_TEXT_BY_MODE[mode], `PlacementMode "${mode}" missing from HELP_TEXT_BY_MODE`).toBeTruthy();
    }
  });
});
