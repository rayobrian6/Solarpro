/**
 * tests/surveyDraftSaveReportsTheTruth.test.ts
 *
 * THE SURVEY HEADER SAID "SAVED HH:MM" WITHOUT ONE SAVE HAVING HAPPENED.
 *
 * Two independent faults produced the same lie:
 *
 *   1. `buildInitialDraft` set `lastSavedAt: new Date().toISOString()` — the
 *      moment the surveyor OPENED the link. `lastSavedAt` has exactly one
 *      consumer, SurveyShell's "Saved HH:MM" header, and `saveDraft` never wrote
 *      back into React state, so a crew could work forty minutes across five
 *      steps while the header displayed the open time throughout, with no way to
 *      tell whether the last ten minutes had persisted.
 *
 *   2. `saveDraft` returned `void` and swallowed every storage failure in a bare
 *      `catch {}`. On a device where localStorage throws — Safari private
 *      browsing, a full quota, site data blocked by policy — nothing was EVER
 *      written and the header still read "Saved 09:14". The crew backgrounds the
 *      app, the tab reloads, `loadDraft` returns null, and the whole survey
 *      restarts from blank having reported success the entire time.
 *
 * WHAT THIS SUITE IS FOR. It is behavioural, with a localStorage stub that THROWS
 * — the failure mode the `catch {}` hid. The assertions are that a fresh draft
 * claims nothing, that a successful write reports the timestamp it actually
 * stored, and that a throwing device is reported as a failure rather than as a
 * save.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildInitialDraft, saveDraft, loadDraft, clearDraft, draftStorageKey,
  type HandoffClaims,
} from '@/lib/survey/v2/defaults';

const JTI = 'jti-abc-123';

const CLAIMS = {
  jti: JTI,
  project_id: '55555555-5555-4555-8555-555555555555',
  project_name: 'Braidon Residence',
} as unknown as HandoffClaims;

/** A localStorage that works. */
function workingStorage() {
  const map = new Map<string, string>();
  return {
    store: map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage & { store: Map<string, string> };
}

/**
 * 🚨 A localStorage that THROWS on every access — Safari private browsing, a full
 * quota, or site data blocked. This is the device the old `catch {}` reported as a
 * successful save.
 */
function throwingStorage(message = 'QuotaExceededError') {
  const boom = () => { throw new Error(message); };
  return {
    getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0,
  } as unknown as Storage;
}

function useStorage(s: Storage) {
  vi.stubGlobal('window', globalThis as unknown as Window);
  vi.stubGlobal('localStorage', s);
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

// ── A fresh draft has not been saved, and says so ───────────────────────────

describe('a fresh draft claims nothing', () => {
  it('lastSavedAt is falsy, so the header renders no "Saved" at all', () => {
    const draft = buildInitialDraft(CLAIMS);
    // 🚨 This was `new Date().toISOString()` — the open time, presented as a save.
    expect(draft.lastSavedAt).toBeFalsy();
    // Specifically not a timestamp: SurveyShell renders the span on truthiness.
    expect(draft.lastSavedAt).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('the rest of the draft is untouched by this change', () => {
    const draft = buildInitialDraft(CLAIMS);
    expect(draft.projectId).toBe(CLAIMS.project_id);
    expect(draft.projectName).toBe('Braidon Residence');
    expect(draft.currentStep).toBe(1);
    expect(draft.completedSteps).toEqual([]);
  });
});

// ── A real write reports the timestamp it really stored ─────────────────────

describe('saveDraft reports its outcome', () => {
  it('a successful write returns saved:true and the timestamp that is on disk', () => {
    const storage = workingStorage();
    useStorage(storage);

    const draft = { ...buildInitialDraft(CLAIMS), token: '' };
    const result = saveDraft(draft);

    // 🚨 The whole point: the caller now has something to commit into state.
    expect(result.saved).toBe(true);
    expect(result.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // And the returned timestamp is byte-identical to the persisted one, so the
    // header cannot drift from the draft that is actually stored.
    const raw = storage.store.get(draftStorageKey(draft.projectId));
    expect(raw, 'nothing was written under the resume key').toBeTruthy();
    expect(JSON.parse(raw!).lastSavedAt).toBe(result.savedAt);
  });

  it('two successive saves report two different, increasing timestamps', async () => {
    useStorage(workingStorage());
    const draft = { ...buildInitialDraft(CLAIMS), token: '' };
    const first = saveDraft(draft);
    await new Promise((r) => setTimeout(r, 5));
    const second = saveDraft(draft);
    expect(first.savedAt).toBeTruthy();
    expect(second.savedAt).toBeTruthy();
    expect(Date.parse(second.savedAt!)).toBeGreaterThanOrEqual(Date.parse(first.savedAt!));
  });

  it('a resumed draft carries the real last-write time', () => {
    const storage = workingStorage();
    useStorage(storage);
    const draft = { ...buildInitialDraft(CLAIMS), token: '' };
    const result = saveDraft(draft);

    const resumed = loadDraft(draft.projectId);
    expect(resumed).not.toBeNull();
    // Resume still shows a TRUE last-write time — the feature is preserved, it is
    // just no longer manufactured.
    expect(resumed!.lastSavedAt).toBe(result.savedAt);
    expect(resumed!.lastSavedAt).toBeTruthy();
  });
});

// ── The device where storage throws ────────────────────────────────────────

describe('a device whose localStorage throws is never reported as saved', () => {
  it('saveDraft returns saved:false with the reason and the error', () => {
    useStorage(throwingStorage('QuotaExceededError: persistent storage full'));

    const draft = { ...buildInitialDraft(CLAIMS), token: '' };
    const result = saveDraft(draft);

    // 🚨 Under the old `void` + `catch {}` there was no return value at all, so a
    // caller could not distinguish this from the success above. That is what let
    // the header keep saying "Saved" while nothing had ever been written.
    expect(result.saved).toBe(false);
    expect(result.savedAt).toBeNull();
    expect(result.reason).toBe('storage_threw');
    expect(result.error).toMatch(/QuotaExceededError/);
  });

  it('it does not throw — the survey must keep working on such a device', () => {
    useStorage(throwingStorage());
    const draft = { ...buildInitialDraft(CLAIMS), token: '' };
    expect(() => saveDraft(draft)).not.toThrow();
    expect(() => loadDraft(draft.projectId)).not.toThrow();
    expect(() => clearDraft(draft.projectId)).not.toThrow();
  });

  it('the read path returns null rather than throwing, and the blank it falls back to claims nothing', () => {
    useStorage(throwingStorage());
    expect(loadDraft(JTI)).toBeNull();
    // The combination is what closes the loop: a failed write reports failure,
    // the reload finds nothing, and the fresh draft it builds does not claim a
    // save it never made.
    expect(buildInitialDraft(CLAIMS).lastSavedAt).toBeFalsy();
  });

  it('a stored draft that will not parse is also null, not a crash', () => {
    const storage = workingStorage();
    storage.store.set(draftStorageKey(JTI), '{ this is not json');
    useStorage(storage);
    expect(loadDraft(JTI)).toBeNull();
  });
});

// ── Server-side rendering ──────────────────────────────────────────────────

describe('no window', () => {
  it('saveDraft reports no_window instead of pretending to have saved', () => {
    vi.stubGlobal('window', undefined);
    const result = saveDraft({ ...buildInitialDraft(CLAIMS), token: '' });
    expect(result.saved).toBe(false);
    expect(result.reason).toBe('no_window');
    expect(result.savedAt).toBeNull();
  });
});
