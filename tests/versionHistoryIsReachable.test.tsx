/** @vitest-environment jsdom */
/**
 * tests/versionHistoryIsReachable.test.tsx
 *
 * THE RECOVERY PATH EXISTED, WAS HARDENED TWICE, AND NOBODY COULD REACH IT.
 *
 * Every layout save writes a snapshot to `project_versions`. `GET
 * /api/projects/[id]/versions` lists them. `POST
 * /api/projects/[id]/versions/[versionId]` restores one, and that route carries
 * two hard-won repairs in its own comments: it reconstructs panel elevations
 * from the snapshot's roof planes rather than writing height-less panels that
 * cannot be drawn, and it carries `siteArchives` with the roof, because omitting
 * it made a restore delete the roof outright.
 *
 * 🚨 AND NOTHING IN THE PRODUCT EVER CALLED EITHER ROUTE. A search for
 * `/versions` outside `app/api/` returned zero results. Snapshots accumulated on
 * every save, the restore was repaired twice by people reading the code, and no
 * user could get at any of it.
 *
 * That became urgent rather than merely wasteful when the stale-write refusal
 * landed. `LAYOUT_STALE_WRITE` tells the losing tab "this design was saved
 * somewhere else — reload", and nothing was written, so that tab's edit is
 * discarded. Telling somebody their work was discarded is only defensible if
 * they can get the previous state back. The refusal and the version history are
 * one feature; shipping the first without the second is telling a person their
 * hour is gone.
 *
 * WHAT THIS PINS:
 *
 *   1. the panel exists, lists versions from the real route, and can restore one;
 *   2. restoring is CONFIRMED first — it overwrites the live design;
 *   3. the restore states the version it was based on, so restoring on top of
 *      somebody else's newer save is refused rather than silently winning;
 *   4. 🚨 after a restore the tab ADOPTS THE NEW VERSION. Without that the next
 *      autosave states a token the row no longer has and is refused — the studio
 *      would wedge immediately after every successful restore;
 *   5. the two refusals the route can return (`LAYOUT_RESTORE_UNPLACEABLE`,
 *      `LAYOUT_STALE_WRITE`) reach the operator instead of being swallowed;
 *   6. a version's real numbers are shown. A list of timestamps is not a
 *      recovery tool — "which one do I want" is answerable only from the panel
 *      count and system size, which the list route already returns.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, cleanup, screen } from '@testing-library/react';
import React from 'react';
import { stripComments } from './support/stripSource';
import VersionHistory from '../components/design/VersionHistory';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

const PANEL_PATH = join(ROOT, 'components', 'design', 'VersionHistory.tsx');
const STUDIO = read('components', 'design', 'DesignStudio.tsx');
const RESTORE = read('app', 'api', 'projects', '[id]', 'versions', '[versionId]', 'route.ts');

describe('🚨 the version history is reachable at all', () => {
  it('the panel exists', () => {
    expect(existsSync(PANEL_PATH),
      'components/design/VersionHistory.tsx is missing — the recovery path is unreachable again')
      .toBe(true);
  });

  it('the studio mounts it', () => {
    expect(STUDIO).toMatch(/import VersionHistory from '\.\/VersionHistory'/);
    expect(STUDIO, 'the panel is imported but never rendered').toMatch(/<VersionHistory/);
  });

  it('and there is a control that opens it', () => {
    // An unreachable panel is the defect this file exists about; a panel with no
    // trigger is the same defect wearing a component.
    expect(STUDIO).toMatch(/setVersionHistoryOpen\(true\)/);
  });
});

describe('🚨 it talks to the real routes', () => {
  const PANEL = read('components', 'design', 'VersionHistory.tsx');

  it('it lists versions from the list route', () => {
    expect(PANEL).toMatch(/\/api\/projects\/\$\{projectId\}\/versions/);
  });

  it('it restores through the restore route, with POST', () => {
    expect(PANEL).toMatch(/\/versions\/\$\{[A-Za-z.]+\}/);
    expect(PANEL).toMatch(/method: 'POST'/);
  });

  it('🚨 the restore states the version it was based on', () => {
    // Restoring is a write like any other. Without the precondition, a restore
    // launched from a stale panel overwrites a newer save by somebody else — and
    // does it while the operator believes they are undoing their OWN change.
    expect(PANEL, 'the restore does not send a precondition')
      .toMatch(/expectedUpdatedAt/);
    expect(RESTORE, 'the restore route does not accept a precondition')
      .toMatch(/expectedUpdatedAt/);
  });

  it('and the route hands it to the writer, not merely reads it', () => {
    const i = RESTORE.indexOf('upsertLayout({');
    expect(i, 'the upsertLayout call moved — this guard is blind').toBeGreaterThan(-1);
    const end = RESTORE.indexOf('});', i);
    expect(end).toBeGreaterThan(i);
    expect(RESTORE.slice(i, end)).toMatch(/expectedUpdatedAt/);
  });

  it('🚨 a restore CANCELS the pending autosave, or it silently undoes itself', () => {
    // 🚨 FOUND IN A REAL BROWSER, and it is the worst failure this feature could
    // have: the restore succeeded, and then the design went back to what it was.
    //
    // The studio holds its in-memory design and a pending autosave timer. A restore
    // writes a DIFFERENT design to the row, and the panel then correctly adopts the
    // version that write produced — which is what stops the next save being refused.
    // But the pending autosave still carries the PRE-RESTORE panels, and it is now
    // holding a CURRENT token, so the stale-write guard cannot refuse it. It fires,
    // writes the old design over the restored one, and the reload that follows
    // hydrates the old design. Measured: restore a 12-module version over a 4-module
    // design, and the studio comes back with 4.
    //
    // The precondition cannot help here, and that is the point — the write is not
    // stale, it is simply wrong. The in-memory design is about to be discarded by the
    // reload, so a save of it must not happen at all.
    //
    // A flag rather than only clearing the timer: a state change during the 600 ms
    // before the reload would re-arm it.
    // 🚨 THE WINDOW ENDS AT THE ELEMENT'S OWN CLOSE, NOT AT THE RELOAD CALL. Both
    // guards here anchored on `window.location.reload` — and the reload was then moved
    // to the TOP of the handler, deliberately, so that an exception below it cannot
    // skip it. That killed both anchors. Fourth time in this campaign that an anchor
    // was destroyed by the correct change it was written to require: anchor on a
    // construct's own delimiters, never on a statement inside it.
    const i = STUDIO.indexOf('onRestored={(result)');
    expect(i, 'the restore handler moved — this guard is blind').toBeGreaterThan(-1);
    const end = STUDIO.indexOf('/>', i);
    expect(end, 'the VersionHistory element is unterminated').toBeGreaterThan(i);
    const handler = STUDIO.slice(i, end);

    expect(handler,
      'a restore does not stop the pending autosave — it will write the pre-restore ' +
      'design over the restored one, and the reload will hydrate the old design')
      .toMatch(/restoreInFlightRef\.current = true/);

    // 🚨 AND THE FLAG HAS A WAY BACK. It is only otherwise cleared by the reload
    // remounting the component — so if the reload never happens, autosave and the
    // beacon are dead for the rest of the session, SILENTLY, and the user keeps
    // designing into a studio that no longer saves. That is strictly worse than the
    // defect the flag fixes. Found by re-reading my own change rather than by a test.
    //
    // The reload is scheduled BEFORE anything that can throw, and a valve clears the
    // flag if it has not happened — so the worst case degrades to the old behaviour
    // instead of to no saving at all.
    expect(STUDIO, 'nothing ever clears the restore flag — a failed reload kills autosave for the session')
      .toMatch(/restoreInFlightRef\.current = false/);

    // 🚨 AND THE RELOAD IS QUEUED BEFORE ANYTHING THAT CAN THROW, which is the whole
    // point of moving it. A mutation deleting the reload from the top and leaving only
    // the valve passed the assertions above — because they checked that both statements
    // EXIST, not that they are in the order that makes them work. If the reload is
    // scheduled after the toast, an exception in the toast skips it, and then only the
    // 10-second valve saves the session from a studio that never writes again.
    const reloadAt = handler.indexOf('window.location.reload');
    const adoptAt = handler.indexOf('noteSavedVersion');
    const toastAt = handler.indexOf('toast.success');
    expect(reloadAt, 'the restore handler no longer reloads at all').toBeGreaterThan(-1);
    expect(adoptAt, 'the restore handler no longer adopts the version').toBeGreaterThan(-1);
    expect(reloadAt, 'the reload is scheduled AFTER the version adoption — an exception there skips it')
      .toBeLessThan(adoptAt);
    if (toastAt > -1) {
      expect(reloadAt, 'the reload is scheduled AFTER the toast — an exception there skips it')
        .toBeLessThan(toastAt);
    }
    expect(handler, 'the pending autosave timer is not cleared')
      .toMatch(/clearTimeout\(autoSaveTimerRef\.current\)/);

    // And the flag must actually block the save, not merely exist.
    expect(STUDIO, 'the autosave effect ignores the restore flag')
      .toMatch(/if \(restoreInFlightRef\.current\) return;/);
  });

  it('🚨 and the tab adopts the version the restore produced', () => {
    // 🚨 THE WEDGE. A restore moves the row's version. A tab that keeps its old
    // token is refused on its very next autosave — so a SUCCESSFUL restore would
    // leave the studio unable to save, which reads as the restore having broken
    // the design.
    //
    // 🚨 ANCHORED INSIDE THE RESTORE HANDLER. A first version asserted only that
    // `noteSavedVersion(` appeared somewhere in DesignStudio, and deleting it
    // from this handler left the file green — the AUTOSAVE's own call satisfied
    // the search. Two call sites, one pattern, and the guard covered whichever
    // survived. That is the same blind spot that let a writer lose its version
    // token in `studioAutosaveCarriesItsVersion`; it is apparently the default
    // mistake when a file has more than one caller.
    expect(PANEL, 'the panel never hands the new version back').toMatch(/onRestored\(/);

    const i = STUDIO.indexOf('onRestored={(result)');
    expect(i, 'the restore handler moved — this guard is now blind').toBeGreaterThan(-1);
    // Same reason as above: the element's own close, not a statement inside it.
    const end = STUDIO.indexOf('/>', i);
    expect(end, 'the VersionHistory element is unterminated').toBeGreaterThan(i);
    expect(STUDIO.slice(i, end),
      'the restore handler does not adopt the new version — the next autosave will be refused')
      .toMatch(/noteSavedVersion\(/);
  });
});

describe('the refusals reach the operator', () => {
  const PANEL = read('components', 'design', 'VersionHistory.tsx');

  it('an unplaceable snapshot is reported, not swallowed', () => {
    // The route refuses with 409 and a sentence explaining that nothing was
    // written. A panel that treats every non-200 as "failed" throws that away.
    expect(PANEL).toMatch(/409/);
    expect(PANEL, 'the refusal message from the server is never shown')
      .toMatch(/\.error\b/);
  });

  it('🚨 restoring is confirmed before it overwrites the live design', () => {
    // 🚨 Not every action gets a dialog — the studio deliberately reserves them
    // for what cannot be a slip, because an editor you are afraid to experiment
    // in is unusable. This qualifies: it replaces the whole design from a
    // snapshot, and Undo does not reach across it.
    //
    // 🚨 THE ASSERTION IS THAT THE FIRST BUTTON DOES NOT RESTORE. A first
    // version searched the file for /confirm/i and passed against a panel whose
    // Restore button called the restore directly — "confirming", "setConfirm"
    // and the state variable all matched. A word appearing in the source is not
    // a confirmation step.
    const i = PANEL.indexOf('data-testid="version-history-restore"');
    expect(i, 'the Restore control moved — this guard is blind').toBeGreaterThan(-1);
    const end = PANEL.indexOf('</button>', i);
    expect(end).toBeGreaterThan(i);
    const firstButton = PANEL.slice(i, end);
    expect(firstButton, 'the Restore button overwrites the design on one click')
      .not.toMatch(/restore\(/);
    expect(firstButton, 'the Restore button does not arm a confirmation')
      .toMatch(/setConfirm\(/);

    // ...and a SECOND, separate control is the one that actually writes.
    const j = PANEL.indexOf('data-testid="version-history-confirm-ok"');
    expect(j, 'there is no confirm control at all').toBeGreaterThan(-1);
    const jEnd = PANEL.indexOf('</button>', j);
    expect(PANEL.slice(j, jEnd), 'the confirm control does not perform the restore')
      .toMatch(/restore\(/);
  });

  it('the list row names the fields it needs (structure)', () => {
    // A column of timestamps is not a recovery tool — "which one do I want" is
    // answerable from the module count and system size, both of which the list
    // route already returns and neither of which anyone could see.
    //
    // 🚨 EACH FIELD MUST BE INTERPOLATED IN THE LIST ROW ITSELF. Two earlier
    // versions of this failed to catch a mutation that blanked the count:
    //
    //   - the first matched the bare identifiers, which the props interface and
    //     the fetch handler satisfy on their own;
    //   - the second required a JSX interpolation anywhere in the file, which
    //     the CONFIRMATION text satisfies — and the confirmation appears only
    //     after you have already chosen a version, so it cannot help you choose.
    //
    // The list row is the recovery tool. Scoped to it.
    const i = PANEL.indexOf('data-testid="version-history-row"');
    expect(i, 'the list row moved — this guard is blind').toBeGreaterThan(-1);
    const end = PANEL.indexOf('data-testid="version-history-restore"', i);
    expect(end, 'the row no longer contains a Restore control').toBeGreaterThan(i);
    const row = PANEL.slice(i, end);

    for (const field of ['panelsCount', 'systemSizeKw', 'versionNumber']) {
      const re = new RegExp(`\\{[^{}]*row\\.${field}[^{}]*\\}`);
      expect(row, `${field} is not rendered in the list row — the list is a log, not a recovery tool`)
        .toMatch(re);
    }
    // And the count is labelled, so a bare number is not mistaken for the version.
    expect(row, 'the module count is unlabelled').toMatch(/module/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 AND THE SAME CLAIM, RENDERED — because source-scanning could not close it
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the rendered list actually shows the numbers', () => {
  /**
   * 🚨 THIS BLOCK EXISTS BECAUSE THREE SOURCE-SCANNING VERSIONS ALL MISSED THE
   * SAME MUTATION.
   *
   * Blanking the module count in the list row — replacing the interpolation with
   * a literal zero — stayed green against: the bare identifiers (satisfied by
   * the props interface), an interpolation anywhere in the file (satisfied by the
   * confirmation text, which appears only after you have already chosen), and an
   * interpolation scoped to the row (satisfied by the PLURALISATION, which still
   * reads the field to decide between "module" and "modules" while the number
   * itself is a constant).
   *
   * Every one of those was a reasonable guard, and the escape was the same
   * escape each time: a reference to a field is not a rendering of its value.
   * There is no regex that closes that, because the distinction is not textual.
   * So this renders the component and reads the DOM, which is the only thing
   * that can tell "shows 31 modules" from "shows 0 modules".
   */

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  const ROWS = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      versionNumber: 12,
      panelsCount: 31,
      systemSizeKw: 12.4,
      changeSummary: 'Auto Layout',
      createdAt: '2026-09-20T15:04:00.000Z',
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      versionNumber: 11,
      panelsCount: 1,
      systemSizeKw: 0.4,
      changeSummary: null,
      createdAt: '2026-09-20T14:31:00.000Z',
    },
  ];

  async function mount(rows: unknown[] = ROWS) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: rows }),
    })) as unknown as typeof fetch);

    await act(async () => {
      render(
        <VersionHistory
          open
          projectId="4030b664-bebe-433b-a11c-cda05ead2f7d"
          storedVersion={() => '2026-09-20T15:04:00.000Z'}
          onClose={() => {}}
          onRestored={() => {}}
        />,
      );
    });
  }

  it('🚨 the module count on screen is the version\'s OWN count', async () => {
    await mount();
    const rows = screen.getAllByTestId('version-history-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent, 'the first version\'s module count is not on screen')
      .toMatch(/31\s*modules/);
    // Same lookaround reason as the version number: the rendered text runs
    // "…9:31 AM1 module", so `\b` before the digit can never match.
    expect(rows[1].textContent, 'the second version shows the first one\'s count')
      .toMatch(/(?<!\d)1\s*module(?!s)/);
  });

  it('the system size is shown, to two decimals', async () => {
    await mount();
    const rows = screen.getAllByTestId('version-history-row');
    expect(rows[0].textContent).toMatch(/12\.40\s*kW/);
  });

  it('the version number is shown', async () => {
    await mount();
    const rows = screen.getAllByTestId('version-history-row');
    // 🚨 A LOOKAHEAD, NOT `\b`. The DOM concatenates adjacent elements with no
    // separator — "Version 12Sep 20, 10:04 AM" — so a word boundary after the
    // number never matches, and the assertion failed on correct output.
    expect(rows[0].textContent).toMatch(/Version\s*12(?!\d)/);
    expect(rows[1].textContent).toMatch(/Version\s*11(?!\d)/);
  });

  it('a count of one is not pluralised — the label follows the number', async () => {
    // Pinned because the pluralisation is exactly what let the blanked-count
    // mutation survive: it reads the field, so it looked like the count was
    // being rendered. Here it has to AGREE with the number beside it.
    await mount();
    const rows = screen.getAllByTestId('version-history-row');
    expect(rows[1].textContent).not.toMatch(/\b1\s*modules\b/);
  });

  it('an unparseable timestamp shows nothing rather than "Invalid Date"', async () => {
    await mount([{ ...ROWS[0], createdAt: 'not a date' }]);
    const rows = screen.getAllByTestId('version-history-row');
    expect(rows[0].textContent).not.toMatch(/Invalid Date/i);
    // ...and the row is still useful: the numbers do not depend on the date.
    expect(rows[0].textContent).toMatch(/31\s*modules/);
  });

  it('an empty history says so instead of rendering an empty box', async () => {
    await mount([]);
    expect(screen.queryAllByTestId('version-history-row')).toHaveLength(0);
    expect(document.body.textContent).toMatch(/No snapshots yet/i);
  });

  it('🚨 nothing is written until the confirm control is used', async () => {
    // The whole point of the confirmation. Rendering the list must issue exactly
    // one request — the LIST — and no restore.
    await mount();
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toMatch(/\/versions$/);
    expect(calls[0][1], 'the list request should be a plain GET').toBeUndefined();
  });
});
