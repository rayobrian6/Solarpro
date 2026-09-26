/** @vitest-environment jsdom */
/**
 * tests/modalsObeyTheEscapeGrammar.test.tsx
 *
 * ESCAPE IS THE PRODUCT'S INVARIANT EXIT, AND THE MODALS DID NOT HONOUR IT.
 *
 * The competitor gauntlet shipped an active-mode banner whose whole point is a
 * grammar Aurora keeps and SolarPro did not: **help, the mode's NAME IN WORDS, and
 * the way out — in the same place, every mode.** The engine's banner prints `ESC`
 * for exactly that reason, and a separate fix made Escape LEAVE the tool rather
 * than merely clear the selection, because leaving the user ARMED meant their next
 * click planted a second tree.
 *
 * 🚨 BUT NEITHER MODAL LISTENED FOR IT. `VersionHistory` — the recovery panel for a
 * stale-write refusal — could only be dismissed by clicking its backdrop or finding
 * a small ✕. `DeleteConfirm`, which stands in front of the two deletions that
 * cannot be a slip, was the same. A grammar that holds everywhere except the two
 * dialogs is not a grammar; it is a habit with exceptions, and the exceptions are
 * where a person is most likely to want out.
 *
 * 🚨 AND ESCAPE MUST NOT REACH THE 3D TOOL UNDERNEATH. The studio binds Escape
 * globally to leave the armed placement mode. If a modal closes on Escape and lets
 * the event through, one keypress both dismisses the dialog and disarms whatever
 * the operator had selected behind it — two actions from one intent, the second
 * invisible. So the modal handler runs in the CAPTURE phase and stops propagation:
 * while a dialog is open, Escape belongs to the dialog.
 *
 * On a destructive confirmation Escape means CANCEL, never confirm. That direction
 * is not a judgement call.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, act, screen } from '@testing-library/react';
import VersionHistory from '@/components/design/VersionHistory';
import DeleteConfirm from '@/components/design/DeleteConfirm';
import type { DeletionPlan } from '@/lib/design/deletionAuthority';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function pressEscape(opts: { capture?: boolean } = {}) {
  void opts;
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true,
    }));
  });
}

describe('🚨 VersionHistory obeys the Escape grammar', () => {
  async function mountHistory(onClose: () => void) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ success: true, data: [] }),
    })) as unknown as typeof fetch);
    await act(async () => {
      render(
        <VersionHistory
          open
          projectId="4030b664-bebe-433b-a11c-cda05ead2f7d"
          storedVersion={() => null}
          onClose={onClose}
          onRestored={() => {}}
        />,
      );
    });
  }

  it('🚨 Escape closes it', async () => {
    const onClose = vi.fn();
    await mountHistory(onClose);
    expect(screen.getByTestId('version-history')).toBeTruthy();
    pressEscape();
    expect(onClose, 'Escape did not close the design history').toHaveBeenCalled();
  });

  it('🚨 and Escape does NOT reach the tool underneath', async () => {
    // A listener standing in for the studio's global "leave the armed mode" bind.
    // It is registered on `document` in the BUBBLE phase, which is where a global
    // shortcut lives — so a modal that closes without stopping propagation lets
    // one keypress do two things.
    const globalEscape = vi.fn();
    document.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') globalEscape();
    });
    try {
      const onClose = vi.fn();
      await mountHistory(onClose);
      pressEscape();
      expect(onClose).toHaveBeenCalled();
      expect(globalEscape,
        'Escape closed the dialog AND reached the studio — the operator loses their armed tool ' +
        'as an invisible side effect of dismissing a panel')
        .not.toHaveBeenCalled();
    } finally {
      // The listener is left for the test's lifetime; cleanup() unmounts the modal.
    }
  });

  it('a key that is not Escape does nothing', async () => {
    // POSITIVE CONTROL. "Escape closes it" is also satisfied by a handler that
    // closes on any key at all, which would make the panel impossible to use —
    // typing anything would dismiss it.
    //
    // 🚨 AWAITED. A first version wrote `void mountHistory(onClose)`, so the
    // component was not mounted when the key was dispatched and the assertion was
    // vacuously true: a mutation making the handler close on ANY key sailed
    // through it. A control that does not run is worse than no control, because it
    // is counted.
    const onClose = vi.fn();
    await mountHistory(onClose);
    expect(screen.getByTestId('version-history'),
      'the panel is not mounted, so this control proves nothing').toBeTruthy();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(onClose, 'an ordinary keypress dismissed the panel').not.toHaveBeenCalled();
  });

  it('and nothing is listening while it is CLOSED', () => {
    // A modal that keeps a document listener when closed swallows the studio's own
    // Escape for the rest of the session — the bug this guard could easily cause.
    const globalEscape = vi.fn();
    document.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') globalEscape();
    });
    render(
      <VersionHistory
        open={false}
        projectId="4030b664-bebe-433b-a11c-cda05ead2f7d"
        storedVersion={() => null}
        onClose={() => {}}
        onRestored={() => {}}
      />,
    );
    pressEscape();
    expect(globalEscape,
      'a closed VersionHistory is still eating Escape — the studio can no longer leave a tool')
      .toHaveBeenCalled();
  });
});

describe('🚨 DeleteConfirm obeys it too, and Escape means CANCEL', () => {
  const plan = {
    ok: true,
    title: 'Clear Custom Building',
    lines: ['4 roof faces', '31 panels'],
    clearsProperty: true,
  } as unknown as DeletionPlan;

  it('🚨 Escape cancels — it never confirms', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteConfirm plan={plan} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByTestId('delete-confirm')).toBeTruthy();

    pressEscape();
    expect(onCancel, 'Escape did not cancel the destructive confirmation').toHaveBeenCalled();
    expect(onConfirm,
      'ESCAPE CONFIRMED A DESTRUCTIVE ACTION — this is the one direction that must never happen')
      .not.toHaveBeenCalled();
  });

  it('and it does not eat Escape when there is no plan', () => {
    const globalEscape = vi.fn();
    document.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') globalEscape();
    });
    render(<DeleteConfirm plan={null} onConfirm={() => {}} onCancel={() => {}} />);
    pressEscape();
    expect(globalEscape).toHaveBeenCalled();
  });
});
