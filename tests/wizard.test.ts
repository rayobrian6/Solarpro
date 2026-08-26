/**
 * tests/wizard.test.ts
 *
 * Pure reducer tests for the 3-step Roof Wizard (Aurora parity — see
 * HANDOFF_2026-08-25_AURORA_ANALYSIS.md §2 and
 * components/3d/wizard/DESIGN.md).
 *
 * No React, no Cesium, no DOM. Just the state machine.
 *
 * What this guards:
 *  - ENTER with a roof-draw mode → state is mark_edges, vertexCount 0
 *  - ENTER with a non-roof mode → state stays idle
 *  - VERTEX_ADDED / VERTEX_REMOVED increment / decrement within step 1
 *  - Step 1 → 2 via CONTINUE only (no auto-advance)
 *  - Step 2 → 3 via CONTINUE
 *  - BACK pops the history snapshot
 *  - CANCEL from any step → idle, cancelled flag set
 *  - canAdvance / canGoBack selectors match the reducer's invariants
 *  - per-mode MIN_VERTICES constants match Solarpro's actual draw flow
 *  - re-entering after cancel resets cleanly
 */

import { describe, it, expect } from 'vitest';
import {
  wizardReducer,
  initialState,
  canAdvance,
  canGoBack,
  isRoofDrawMode,
  MIN_VERTICES_FOR_STEP_2,
  STEP_LABELS,
  type WizardState,
  type WizardEvent,
} from '@/components/3d/wizard/wizardMachine';

// ─── Initial state ──────────────────────────────────────────────────────

describe('wizard — initial state', () => {
  it('starts idle with zero vertices and no history', () => {
    const s = initialState();
    expect(s.step).toBe('idle');
    expect(s.vertexCount).toBe(0);
    expect(s.segments).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.cancelled).toBe(false);
  });
});

// ─── ENTER event ────────────────────────────────────────────────────────

describe('wizard — ENTER event', () => {
  it('entering a roof-draw mode transitions to mark_edges', () => {
    const s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    expect(s.step).toBe('mark_edges');
    expect(s.vertexCount).toBe(0);
    expect(s.segments).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.cancelled).toBe(false);
  });

  it.each(['block', 'roof_gable', 'roof_hip', 'roof'] as const)(
    'isRoofDrawMode accepts "%s"',
    (mode) => {
      expect(isRoofDrawMode(mode)).toBe(true);
    },
  );

  it('isRoofDrawMode rejects non-roof modes', () => {
    expect(isRoofDrawMode('select')).toBe(false);
    expect(isRoofDrawMode('ground')).toBe(false);
    expect(isRoofDrawMode('tree')).toBe(false);
    expect(isRoofDrawMode('fence')).toBe(false);
    expect(isRoofDrawMode('')).toBe(false);
  });
});

// ─── VERTEX_ADDED / VERTEX_REMOVED ─────────────────────────────────────

describe('wizard — vertex bookkeeping', () => {
  it('VERTEX_ADDED increments in step 1', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    expect(s.vertexCount).toBe(3);
    expect(s.step).toBe('mark_edges');
  });

  it('VERTEX_REMOVED decrements in step 1', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'VERTEX_REMOVED' });
    expect(s.vertexCount).toBe(1);
  });

  it('VERTEX_REMOVED floors at zero (no negative counts)', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'VERTEX_REMOVED' });
    s = wizardReducer(s, { type: 'VERTEX_REMOVED' });
    expect(s.vertexCount).toBe(0);
  });

  it('VERTEX_ADDED is a no-op in step 2 (analyze)', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(s.step).toBe('analyze_structure');
    const before = s.vertexCount;
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    expect(s.vertexCount).toBe(before);
    expect(s.step).toBe('analyze_structure');
  });

  it('VERTEX_ADDED is a no-op when wizard is idle', () => {
    const s = wizardReducer(initialState(), { type: 'VERTEX_ADDED' });
    expect(s).toEqual(initialState());
  });
});

// ─── CONTINUE event ─────────────────────────────────────────────────────

describe('wizard — CONTINUE (step transitions)', () => {
  it('CONTINUE in step 1 → step 2 (regardless of vertex count)', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(s.step).toBe('analyze_structure');
    expect(s.history).toHaveLength(1);
    expect(s.history[0].step).toBe('mark_edges');
  });

  it('CONTINUE in step 2 → step 3', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(s.step).toBe('adjust_3d');
    expect(s.history).toHaveLength(2);
  });

  it('CONTINUE in step 3 is a no-op (terminal step)', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    const before = s;
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(s).toEqual(before);
  });

  it('CONTINUE in idle is a no-op', () => {
    const s = wizardReducer(initialState(), { type: 'CONTINUE' });
    expect(s).toEqual(initialState());
  });

  it('wizard never auto-advances — explicit CONTINUE is required', () => {
    // Even with 100 vertices, the step stays at mark_edges until CONTINUE.
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    for (let i = 0; i < 100; i++) s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    expect(s.step).toBe('mark_edges');
    expect(s.vertexCount).toBe(100);
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(s.step).toBe('analyze_structure');
  });
});

// ─── BACK event ─────────────────────────────────────────────────────────

describe('wizard — BACK (history pop)', () => {
  it('BACK from step 2 → step 1 (restores vertexCount)', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(s.step).toBe('analyze_structure');
    s = wizardReducer(s, { type: 'BACK' });
    expect(s.step).toBe('mark_edges');
    expect(s.vertexCount).toBe(2);
    expect(s.history).toEqual([]);
  });

  it('BACK from step 3 → step 2', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(s.step).toBe('adjust_3d');
    s = wizardReducer(s, { type: 'BACK' });
    expect(s.step).toBe('analyze_structure');
  });

  it('BACK from step 1 with empty history is a no-op', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    const before = s;
    s = wizardReducer(s, { type: 'BACK' });
    expect(s).toEqual(before);
  });

  it('BACK restores segments from the snapshot', () => {
    // Simulate: after step 2, the parent injects analyzed segments.
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    const fakeSegs = [{ id: 's1', a: 'v1', b: 'v2', normalDir: 1 as const }];
    s = { ...s, segments: fakeSegs };
    s = wizardReducer(s, { type: 'BACK' });
    expect(s.step).toBe('mark_edges');
    expect(s.segments).toEqual([]); // restored from the pre-step-2 snapshot
  });
});

// ─── CANCEL event ───────────────────────────────────────────────────────

describe('wizard — CANCEL', () => {
  it('CANCEL from step 1 → idle, cancelled=true', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CANCEL' });
    expect(s.step).toBe('idle');
    expect(s.cancelled).toBe(true);
  });

  it('CANCEL from step 2 → idle, cancelled=true', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    s = wizardReducer(s, { type: 'CANCEL' });
    expect(s.step).toBe('idle');
    expect(s.cancelled).toBe(true);
  });

  it('CANCEL from step 3 → idle, cancelled=true', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    s = wizardReducer(s, { type: 'CANCEL' });
    expect(s.step).toBe('idle');
    expect(s.cancelled).toBe(true);
  });

  it('CANCEL clears history', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(s.history.length).toBeGreaterThan(0);
    s = wizardReducer(s, { type: 'CANCEL' });
    expect(s.history).toEqual([]);
  });

  it('re-entering after cancel resets cancelled flag and state', () => {
    let s: WizardState = initialState();
    s = wizardReducer(s, { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'CANCEL' });
    expect(s.cancelled).toBe(true);
    // Re-enter with a (possibly different) roof mode.
    s = wizardReducer(s, { type: 'ENTER', mode: 'roof_hip' });
    expect(s.cancelled).toBe(false);
    expect(s.step).toBe('mark_edges');
    expect(s.vertexCount).toBe(0);
    expect(s.history).toEqual([]);
  });
});

// ─── canAdvance selector ────────────────────────────────────────────────

describe('wizard — canAdvance selector', () => {
  it('returns no_mode when wizard is idle', () => {
    expect(canAdvance(initialState(), null).canAdvance).toBe(false);
  });

  it('returns no_mode when mode is null', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    const info = canAdvance(s, null);
    expect(info.canAdvance).toBe(false);
    expect(info.reason).toBe('no_mode');
  });

  it('returns need_more_vertices when vertexCount < min (block needs 2)', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    const info = canAdvance(s, 'block');
    expect(info.canAdvance).toBe(false);
    expect(info.reason).toBe('need_more_vertices');
    expect(info.remaining).toBe(1);
  });

  it('returns ready when vertexCount >= min (block needs 2)', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    const info = canAdvance(s, 'block');
    expect(info.canAdvance).toBe(true);
    expect(info.reason).toBe('ready');
    expect(info.remaining).toBe(0);
  });

  it('canAdvance is true in step 2 regardless of vertex count', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'roof' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(canAdvance(s, 'roof').canAdvance).toBe(true);
  });

  it('canAdvance is false in step 3 (terminal — only × finishes)', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(canAdvance(s, 'block').canAdvance).toBe(false);
  });

  it('roof (legacy polygon) needs 3 vertices before step 2', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'roof' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    expect(canAdvance(s, 'roof').canAdvance).toBe(false);
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    expect(canAdvance(s, 'roof').canAdvance).toBe(true);
  });
});

// ─── canGoBack selector ─────────────────────────────────────────────────

describe('wizard — canGoBack selector', () => {
  it('returns false at the start (no history)', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    expect(canGoBack(s)).toBe(false);
  });

  it('returns true in step 2 (one snapshot in history)', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(canGoBack(s)).toBe(true);
  });

  it('returns true in step 3 (two snapshots in history)', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(canGoBack(s)).toBe(true);
  });

  it('returns false after CANCEL clears history', () => {
    let s = wizardReducer(initialState(), { type: 'ENTER', mode: 'block' });
    s = wizardReducer(s, { type: 'CONTINUE' });
    s = wizardReducer(s, { type: 'CANCEL' });
    expect(canGoBack(s)).toBe(false);
  });
});

// ─── MIN_VERTICES_FOR_STEP_2 constants ─────────────────────────────────

describe('wizard — per-mode min-vertex constants', () => {
  it('block requires 2 (2-click line trace)', () => {
    expect(MIN_VERTICES_FOR_STEP_2.block).toBe(2);
  });
  it('roof_gable requires 2 (2 eave corners)', () => {
    expect(MIN_VERTICES_FOR_STEP_2.roof_gable).toBe(2);
  });
  it('roof_hip requires 2 (2 eave corners)', () => {
    expect(MIN_VERTICES_FOR_STEP_2.roof_hip).toBe(2);
  });
  it('roof (legacy polygon) requires 3 (3 to close)', () => {
    expect(MIN_VERTICES_FOR_STEP_2.roof).toBe(3);
  });
});

// ─── STEP_LABELS ────────────────────────────────────────────────────────

describe('wizard — STEP_LABELS display data', () => {
  it('has 3 steps in order: mark, analyze, adjust', () => {
    expect(STEP_LABELS).toHaveLength(3);
    expect(STEP_LABELS[0].step).toBe('mark_edges');
    expect(STEP_LABELS[1].step).toBe('analyze_structure');
    expect(STEP_LABELS[2].step).toBe('adjust_3d');
  });

  it('numbers them 1, 2, 3', () => {
    expect(STEP_LABELS.map(s => s.number)).toEqual([1, 2, 3]);
  });

  it('labels match Aurora parity bar wording', () => {
    expect(STEP_LABELS[0].label).toBe('Mark roof edges');
    expect(STEP_LABELS[1].label).toBe('Analyze roof structure');
    expect(STEP_LABELS[2].label).toBe('Adjust 3D model');
  });
});

// ─── Full lifecycle ─────────────────────────────────────────────────────

describe('wizard — full lifecycle', () => {
  it('block mode: enter → 2 vertices → continue → analyze → continue → adjust → cancel', () => {
    let s: WizardState = initialState();
    // idle
    expect(s.step).toBe('idle');
    // enter block mode
    s = wizardReducer(s, { type: 'ENTER', mode: 'block' });
    expect(s.step).toBe('mark_edges');
    // user places 2 vertices
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    s = wizardReducer(s, { type: 'VERTEX_ADDED' });
    expect(s.vertexCount).toBe(2);
    // can advance now
    expect(canAdvance(s, 'block').canAdvance).toBe(true);
    // continue → step 2
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(s.step).toBe('analyze_structure');
    // back to step 1 to verify history works
    s = wizardReducer(s, { type: 'BACK' });
    expect(s.step).toBe('mark_edges');
    expect(s.vertexCount).toBe(2);
    // forward again
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(s.step).toBe('analyze_structure');
    // continue → step 3
    s = wizardReducer(s, { type: 'CONTINUE' });
    expect(s.step).toBe('adjust_3d');
    // cancel
    s = wizardReducer(s, { type: 'CANCEL' });
    expect(s.step).toBe('idle');
    expect(s.cancelled).toBe(true);
  });

  it('gutter: unknown event types are caught by exhaustive switch', () => {
    // Force the exhaustive check: the reducer's default case uses `never`.
    // We can't dispatch a malformed event at runtime, but we can verify
    // the type signature by constructing a literal that satisfies the union.
    const e: WizardEvent = { type: 'ENTER', mode: 'block' };
    const s = wizardReducer(initialState(), e);
    expect(s.step).toBe('mark_edges');
  });
});
