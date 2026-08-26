/**
 * tests/irradiance.test.ts
 *
 * Unit tests for the irradiance map toggle slice.
 *
 *   - State machine transitions (idle → queued → computing → visible → idle)
 *   - Re-trigger guard (inFlight blocks spam)
 *   - Reset (used by tests + the future abort epic)
 *   - Hotkey event predicate (isIrradianceHotkeyEvent)
 *   - Toast queue (single-slot, literal Aurora title)
 *   - Legal-transition table from DESIGN.md
 *
 * Stub computation timing: 2 seconds per IRRADIANCE_COMPUTE_DELAY_MS.
 * Tests use vitest's fake timers to step the clock without waiting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useIrradianceStore,
  isIrradianceHotkeyEvent,
  selectIsInFlight,
  selectIsVisible,
  selectToast,
  type IrradianceStoreState,
} from '@/components/3d/irradiance/irradianceStore';
import {
  IRRADIANCE_COMPUTE_DELAY_MS,
  IRRADIANCE_QUEUED_TOAST_TITLE,
  IRRADIANCE_STATES,
  IRRADIANCE_TOAST_DURATION_MS,
  IRRADIANCE_TOGGLE_TOOLTIP,
  IRRADIANCE_TRANSITIONS,
  type IrradianceState,
  type IrradianceToast,
} from '@/components/3d/irradiance/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Wait one microtask + macrotask so queueMicrotask() in toggle() runs. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Read the entire current state — useful for assertions that need
 * multiple fields. The store is a vanilla Zustand store so calling
 * getState() synchronously is safe.
 */
function snapshot(): IrradianceStoreState {
  return useIrradianceStore.getState();
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  // Each test starts from a clean store. The store is a module-level
  // singleton, so reset() is the only way to get a fresh slate.
  useIrradianceStore.getState().reset();
});

afterEach(() => {
  useIrradianceStore.getState().reset();
  vi.useRealTimers();
});

// ─── State machine ──────────────────────────────────────────────────────────

describe('irradiance store — state machine', () => {
  it('starts in the idle state with no toast and no result', () => {
    const s = snapshot();
    expect(s.state).toBe('idle');
    expect(s.inFlight).toBe(false);
    expect(s.result).toBeNull();
    expect(s.toast).toBeNull();
  });

  it('IRRA DIANCE_STATES exports the four states in the documented order', () => {
    expect(IRRADIANCE_STATES).toEqual(['idle', 'queued', 'computing', 'visible']);
  });

  it('IRRADIANCE_TRANSITIONS encodes the legal edges from DESIGN.md', () => {
    expect(IRRADIANCE_TRANSITIONS.idle).toEqual(['queued']);
    expect(IRRADIANCE_TRANSITIONS.queued).toContain('computing');
    expect(IRRADIANCE_TRANSITIONS.computing).toEqual(['visible', 'idle']);
    expect(IRRADIANCE_TRANSITIONS.visible).toEqual(['idle']);
  });

  it('idle → toggle() pushes a "queued" toast and flips state to queued/computing', async () => {
    snapshot().toggle();

    // After the synchronous part of toggle():
    expect(snapshot().state).toBe('queued');
    expect(snapshot().inFlight).toBe(true);

    // The toast must carry Aurora's literal text.
    const toast = selectToast(snapshot());
    expect(toast).not.toBeNull();
    expect(toast!.title).toBe(IRRADIANCE_QUEUED_TOAST_TITLE);
    expect(toast!.title).toBe('Irradiance Map was queued');

    // The microtask transitions queued → computing.
    await flushMicrotasks();
    expect(snapshot().state).toBe('computing');
    expect(snapshot().inFlight).toBe(true);
  });

  it('computing → visible after the stub delay, with a result populated', async () => {
    snapshot().toggle();
    await flushMicrotasks();
    expect(snapshot().state).toBe('computing');

    // Advance the stub timer exactly IRRADIANCE_COMPUTE_DELAY_MS.
    vi.advanceTimersByTime(IRRADIANCE_COMPUTE_DELAY_MS);

    const s = snapshot();
    expect(s.state).toBe('visible');
    expect(s.inFlight).toBe(false);
    expect(s.result).not.toBeNull();
    expect(s.result!.annualKwhPerM2).toBeGreaterThan(0);
    expect(typeof s.result!.computedAt).toBe('number');
  });

  it('visible → toggle() hides the overlay (state=idle, result cleared)', async () => {
    snapshot().toggle();
    await flushMicrotasks();
    vi.advanceTimersByTime(IRRADIANCE_COMPUTE_DELAY_MS);
    expect(snapshot().state).toBe('visible');

    snapshot().toggle();
    const s = snapshot();
    expect(s.state).toBe('idle');
    expect(s.inFlight).toBe(false);
    expect(s.result).toBeNull();
  });

  it('reset() from any state returns to idle, clears result and toast', async () => {
    snapshot().toggle();
    await flushMicrotasks();
    expect(snapshot().state).toBe('computing');

    snapshot().reset();

    const s = snapshot();
    expect(s.state).toBe('idle');
    expect(s.inFlight).toBe(false);
    expect(s.result).toBeNull();
    expect(s.toast).toBeNull();
  });

  it('selectIsInFlight and selectIsVisible track the machine correctly', async () => {
    expect(selectIsInFlight(snapshot())).toBe(false);
    expect(selectIsVisible(snapshot())).toBe(false);

    snapshot().toggle();
    expect(selectIsInFlight(snapshot())).toBe(true);
    expect(selectIsVisible(snapshot())).toBe(false);

    await flushMicrotasks();
    expect(selectIsInFlight(snapshot())).toBe(true);

    vi.advanceTimersByTime(IRRADIANCE_COMPUTE_DELAY_MS);
    expect(selectIsInFlight(snapshot())).toBe(false);
    expect(selectIsVisible(snapshot())).toBe(true);
  });
});

// ─── Re-trigger guard ───────────────────────────────────────────────────────

describe('irradiance store — re-trigger guard', () => {
  it('toggle() is a no-op while state is queued (inFlight=true)', async () => {
    snapshot().toggle(); // idle → queued
    expect(snapshot().state).toBe('queued');

    const beforeToastId = snapshot().toast?.id;
    const beforeState = snapshot().state;

    snapshot().toggle(); // should be ignored
    expect(snapshot().state).toBe(beforeState);
    // The toast is single-slot; an ignored toggle must not stomp it.
    expect(snapshot().toast?.id).toBe(beforeToastId);
  });

  it('toggle() is a no-op while state is computing (inFlight=true)', async () => {
    snapshot().toggle();
    await flushMicrotasks();
    expect(snapshot().state).toBe('computing');

    const beforeToastId = snapshot().toast?.id;
    snapshot().toggle();
    expect(snapshot().state).toBe('computing');
    expect(snapshot().toast?.id).toBe(beforeToastId);
  });

  it('toggle() resumes the toggle path after visible → idle', async () => {
    snapshot().toggle();
    await flushMicrotasks();
    vi.advanceTimersByTime(IRRADIANCE_COMPUTE_DELAY_MS);
    expect(snapshot().state).toBe('visible');

    // Hide.
    snapshot().toggle();
    expect(snapshot().state).toBe('idle');

    // Show again — a fresh queued toast must appear.
    snapshot().toggle();
    expect(snapshot().state).toBe('queued');
    expect(snapshot().toast?.id).toBeDefined();
  });
});

// ─── Hotkey predicate ───────────────────────────────────────────────────────

describe('irradiance store — hotkey predicate', () => {
  it('matches a bare lowercase i', () => {
    expect(isIrradianceHotkeyEvent({ key: 'i' })).toBe(true);
  });

  it('matches a bare uppercase I (shift-i)', () => {
    expect(isIrradianceHotkeyEvent({ key: 'I' })).toBe(true);
  });

  it('rejects Cmd+I / Ctrl+I so the browser italic shortcut still works', () => {
    expect(isIrradianceHotkeyEvent({ key: 'i', metaKey: true })).toBe(false);
    expect(isIrradianceHotkeyEvent({ key: 'i', ctrlKey: true })).toBe(false);
    expect(isIrradianceHotkeyEvent({ key: 'I', metaKey: true, shiftKey: true })).toBe(false);
  });

  it('rejects Alt+I to keep OS-level menu shortcuts intact', () => {
    expect(isIrradianceHotkeyEvent({ key: 'i', altKey: true })).toBe(false);
  });

  it('rejects auto-repeat (e.repeat=true) so holding I does not spam the queue', () => {
    expect(isIrradianceHotkeyEvent({ key: 'i', repeat: true })).toBe(false);
    expect(isIrradianceHotkeyEvent({ key: 'I', repeat: true })).toBe(false);
  });

  it('rejects unrelated keys', () => {
    expect(isIrradianceHotkeyEvent({ key: 'j' })).toBe(false);
    expect(isIrradianceHotkeyEvent({ key: 'ArrowUp' })).toBe(false);
    expect(isIrradianceHotkeyEvent({ key: ' ' })).toBe(false);
    expect(isIrradianceHotkeyEvent({ key: 'Enter' })).toBe(false);
    expect(isIrradianceHotkeyEvent({ key: 'Tab' })).toBe(false);
  });

  it('dispatches toggle() through the hotkey path end-to-end', async () => {
    // Simulate the call path the SolarEngine3D keydown handler will use.
    const fakeEvent = { key: 'i', repeat: false, ctrlKey: false, metaKey: false, altKey: false };
    expect(isIrradianceHotkeyEvent(fakeEvent)).toBe(true);
    useIrradianceStore.getState().toggle();

    expect(snapshot().state).toBe('queued');
    expect(snapshot().toast?.title).toBe(IRRADIANCE_QUEUED_TOAST_TITLE);
  });
});

// ─── Toast queue ────────────────────────────────────────────────────────────

describe('irradiance store — toast queue', () => {
  it('shows the literal Aurora title on first toggle', () => {
    snapshot().toggle();
    const toast: IrradianceToast | null = selectToast(snapshot());
    expect(toast).not.toBeNull();
    expect(toast!.title).toBe('Irradiance Map was queued');
    expect(typeof toast!.id).toBe('string');
    expect(toast!.id.length).toBeGreaterThan(0);
    expect(toast!.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('auto-dismisses after IRRADIANCE_TOAST_DURATION_MS', () => {
    snapshot().toggle();
    expect(selectToast(snapshot())).not.toBeNull();

    vi.advanceTimersByTime(IRRADIANCE_TOAST_DURATION_MS - 1);
    expect(selectToast(snapshot())).not.toBeNull();

    vi.advanceTimersByTime(2); // crosses the threshold
    expect(selectToast(snapshot())).toBeNull();
  });

  it('toast is single-slot — only the latest one is ever on screen', async () => {
    // First request.
    snapshot().toggle();
    const firstId = snapshot().toast!.id;
    await flushMicrotasks();
    vi.advanceTimersByTime(IRRADIANCE_COMPUTE_DELAY_MS);
    expect(snapshot().state).toBe('visible');
    // visible state still shows the toast (it has its own 3s lifetime)
    // but the second request below happens after the first dismisses.

    // Hide and queue again.
    snapshot().toggle();
    expect(snapshot().state).toBe('idle');

    // (The first toast auto-dismissed at IRRADIANCE_TOAST_DURATION_MS;
    //  the second toggle happens well after that, so the slot is empty.)
    vi.advanceTimersByTime(IRRADIANCE_TOAST_DURATION_MS + 100);
    expect(selectToast(snapshot())).toBeNull();

    snapshot().toggle();
    const secondId = snapshot().toast!.id;
    expect(secondId).not.toBe(firstId);
    expect(selectToast(snapshot())!.id).toBe(secondId);
  });

  it('a stale dismiss timer does not clear a newer toast', () => {
    snapshot().toggle();
    const firstId = snapshot().toast!.id;

    // Fast-forward almost to the dismiss threshold but not past it,
    // then queue another toast (this is the path that can only
    // happen if visible → idle → toggle again, so use reset() to
    // simulate the equivalent timing without waiting the full 2s).
    vi.advanceTimersByTime(IRRADIANCE_TOAST_DURATION_MS - 50);

    // Force a fresh toast via reset+toggle. (In production this
    // would only happen after a successful visible cycle, but the
    // defensive behavior is the same.)
    snapshot().reset();
    snapshot().toggle();
    const secondId = snapshot().toast!.id;
    expect(secondId).not.toBe(firstId);

    // Now cross the FIRST toast's threshold — the older dismiss
    // timer must NOT wipe out the newer toast.
    vi.advanceTimersByTime(100);
    expect(selectToast(snapshot())?.id).toBe(secondId);
  });
});

// ─── Exported constants ─────────────────────────────────────────────────────

describe('irradiance store — exported constants', () => {
  it('IRRADIANCE_TOGGLE_TOOLTIP is the literal Aurora copy', () => {
    expect(IRRADIANCE_TOGGLE_TOOLTIP).toBe('Toggle Irradiance Map (I)');
  });

  it('IRRADIANCE_QUEUED_TOAST_TITLE is the literal Aurora copy', () => {
    expect(IRRADIANCE_QUEUED_TOAST_TITLE).toBe('Irradiance Map was queued');
  });

  it('IRRADIANCE_COMPUTE_DELAY_MS is the documented 2-second stub', () => {
    expect(IRRADIANCE_COMPUTE_DELAY_MS).toBe(2000);
  });

  it('IRRADIANCE_TOAST_DURATION_MS is the documented 3-second auto-dismiss', () => {
    expect(IRRADIANCE_TOAST_DURATION_MS).toBe(3000);
  });
});

// ─── State-table integrity ──────────────────────────────────────────────────

describe('irradiance store — state table integrity', () => {
  it('every entry in IRRADIANCE_STATES appears as a key in IRRADIANCE_TRANSITIONS', () => {
    for (const state of IRRADIANCE_STATES) {
      expect(IRRADIANCE_TRANSITIONS[state]).toBeDefined();
      expect(Array.isArray(IRRADIANCE_TRANSITIONS[state])).toBe(true);
    }
  });

  it('every value in IRRADIANCE_TRANSITIONS is a state in IRRADIANCE_STATES', () => {
    for (const from of IRRADIANCE_STATES) {
      for (const to of IRRADIANCE_TRANSITIONS[from]) {
        expect(IRRADIANCE_STATES).toContain(to);
      }
    }
  });

  it('no state transitions to itself (no self-loops in the diagram)', () => {
    for (const from of IRRADIANCE_STATES) {
      expect(IRRADIANCE_TRANSITIONS[from]).not.toContain(from);
    }
  });
});
