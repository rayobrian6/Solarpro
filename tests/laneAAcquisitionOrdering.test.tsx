/** @vitest-environment jsdom */
/**
 * tests/laneAAcquisitionOrdering.test.tsx
 *
 * CAN LANE A ACQUIRE A ROOF BEFORE IT KNOWS WHETHER ONE WAS DELETED?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE QUESTION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `shouldRunLaneA` refuses acquisition when the property's geometry lifecycle
 * is `cleared`. In production that value arrives as
 * `lifecycle: geometryLifecycleRef?.current` from `useSiteDesign`, and the ref
 * is INITIALISED to the permissive state and only assigned the real answer once
 * the design (and with it the deletion ledger) has hydrated.
 *
 * The gate's other relevant condition, `existingPlaneCount === 0`, is satisfied
 * by a cleared design. So IF the gate could fire in the window between mount
 * and hydration, a property somebody deliberately emptied would read as a first
 * visit with no geometry, acquisition would be granted, and the roof the user
 * deleted would come back — the exact resurrection the deletion-authority model
 * exists to prevent.
 *
 * It is an ORDERING question, not a missing-value one. The ref's type is a
 * non-optional union and the prop is always passed, so the `??` fallbacks never
 * fire. Nothing is ever undefined. The only way the defect exists is if the
 * gate can be evaluated before the assignment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ANSWER: IT CANNOT. THREE INDEPENDENT BARRIERS, ANY ONE SUFFICIENT.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * BARRIER 1 — THE DATA IS IN PLACE BEFORE THE FENCE IS EVEN ASKED TO OPEN.
 *   `shouldRunLaneA` also refuses on `!restoreResolved`. The only thing that
 *   ever sets that true is `setRoofRestoreResolved(true)` in DesignStudio's
 *   restore effect, and it sits AFTER `site.hydrateFromStored(...)` in the same
 *   synchronous block. `hydrateFromStored` writes the loaded ledger into
 *   `stateRef.current` synchronously, before it returns. So at the instant the
 *   fence is asked to open, the ledger the lifecycle is computed from is
 *   already installed. Neither failure path (a non-ok read, or the catch) ever
 *   reaches the line that opens it.
 *
 * BARRIER 2 — RENDER PRECEDES EFFECTS, AND THE TWO VALUES SIT ON OPPOSITE
 *   SIDES OF THAT LINE.
 *   `geometryLifecycleRef.current` is assigned inside a `useMemo`, i.e. during
 *   the RENDER phase, and `hydrateFromStored` bumps that memo's dependency
 *   unconditionally. `roofRestoreResolvedRef.current` — the value the gate
 *   actually reads for `restoreResolved` — is assigned inside a `useEffect`,
 *   i.e. AFTER the commit. So in the very commit that first carries a resolved
 *   restore, the lifecycle ref has already been rewritten from the loaded
 *   ledger. This holds whether React batches the two updates into one commit or
 *   splits them, because the archive tick is queued first either way.
 *
 * BARRIER 3 — THE GATE IS BEHIND A NETWORK ROUND TRIP.
 *   It has exactly ONE caller, inside `buildDigitalTwin(...).then()`, in an
 *   effect keyed on the coordinates. So the fetch has not even STARTED until
 *   the effects of the commit that moved the property have run, and the gate is
 *   evaluated a round trip after that. This is what also covers arriving at a
 *   cleared property via Pick House rather than loading into one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SO THIS FILE DOES NOT TEST A FIX. IT PINS THE ORDERING THAT IS THE FIX.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Nothing was changed in production code for this finding, because nothing was
 * wrong. What was missing is cover: every one of those barriers is an ordering
 * that a perfectly reasonable refactor would dissolve without a single type
 * error. Moving the lifecycle assignment into an effect, opening the restore
 * fence before hydrating, or making the archive-tick bump conditional each
 * reopens the window silently.
 *
 * 🚨 THE INVERTED-ORDER CONTROL IS THE POINT. `the window would be real if the
 * ordering were reversed` drives the same real gate with the barriers swapped
 * and asserts acquisition IS granted. Without it every assertion here could be
 * passing because Lane A never runs at all, which is also what a fail-closed
 * default would produce — and that is the wrong fix, since it would block
 * acquisition on every legitimately fresh design. The fresh-design controls
 * prove it is not happening.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { act, render, renderHook, cleanup } from '@testing-library/react';
import React, { useEffect, useRef, useState } from 'react';
import fs from 'fs';
import path from 'path';
import { useSiteDesign } from '@/components/design/useSiteDesign';
import { shouldRunLaneA, type LaneAGateInput } from '@/lib/3d/laneA';
import {
  emptyLedger, withTombstones, lifecycleFor, acquisitionPermittedByLifecycle,
  type DeletionLedger, type DesignGeometryLifecycle,
} from '@/lib/design/deletionAuthority';
import { siteKeyFromCoords } from '@/lib/siteIdentity';
import { stripCommentsAndStrings } from './support/stripSource';

const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const MELVIN = { lat: 38.70615257709013, lng: -90.04625419301613 };
const HOUSE = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT);

afterEach(() => cleanup());

// ═══════════════════════════════════════════════════════════════════════════
// THE HARNESS — the real hook, wired the way production wires it
// ═══════════════════════════════════════════════════════════════════════════

/** One evaluation of the REAL gate, as `maybeRunLaneA` would evaluate it. */
interface Probe {
  commit: number;
  lifecycle: DesignGeometryLifecycle;
  restoreResolved: boolean;
  existingPlaneCount: number;
  granted: boolean;
}

/** Everything about the gate input EXCEPT the two values whose ordering is
 *  under test. All set to the permissive value on purpose: if acquisition is
 *  refused it must be refused by the lifecycle or the fence, not by a
 *  bystander condition that would make this file vacuous. */
const OTHERWISE_READY = {
  stage: 'done',
  groundElevResolved: true,
  segmentCount: 4,
  siteKey: HOUSE,
  lastRanSiteKey: null as string | null,
  nativeDisposition: 'undecided' as const,
};

function evaluateGate(p: Omit<Probe, 'commit' | 'granted'>): boolean {
  const gate: LaneAGateInput = {
    ...OTHERWISE_READY,
    existingPlaneCount: p.existingPlaneCount,
    lifecycle: p.lifecycle,
    restoreResolved: p.restoreResolved,
  };
  return shouldRunLaneA(gate);
}

/**
 * SolarEngine3D's half of the wiring, reproduced exactly: the prop arrives as
 * React state from the parent and is mirrored into a ref by an effect, and the
 * gate reads the REF. The probe is a second effect declared BELOW that one, so
 * it observes the ref at the earliest moment any code in this component could —
 * which is strictly earlier than a resolved network promise ever could.
 *
 * It is a child of the component holding the hook, as in production, so React
 * flushes these effects BEFORE any effect the parent might own. That ordering
 * is adversarial on purpose: it gives the fence every chance to open first.
 */
function EngineStub(props: {
  lifecycleRef: React.MutableRefObject<DesignGeometryLifecycle>;
  roofPlanesRef: React.MutableRefObject<unknown[]>;
  restoreResolved: boolean;
  onProbe: (p: Omit<Probe, 'commit' | 'granted'>) => void;
}) {
  const { lifecycleRef, roofPlanesRef, restoreResolved, onProbe } = props;
  const roofRestoreResolvedRef = useRef<boolean>(restoreResolved);
  useEffect(() => { roofRestoreResolvedRef.current = restoreResolved; }, [restoreResolved]);
  useEffect(() => {
    onProbe({
      lifecycle: lifecycleRef.current,
      restoreResolved: roofRestoreResolvedRef.current,
      existingPlaneCount: (roofPlanesRef.current ?? []).length,
    });
  });
  return null;
}

type Hook = ReturnType<typeof useSiteDesign>;

interface Harness {
  probes: Probe[];
  hook: () => Hook;
  openFence: () => void;
}

function mountHarness(): Harness {
  const probes: Probe[] = [];
  let hook: Hook | null = null;
  let openFence: (() => void) | null = null;

  function Host() {
    const site = useSiteDesign();
    const [restoreResolved, setRestoreResolved] = useState(false);
    hook = site;
    openFence = () => setRestoreResolved(true);
    return (
      <EngineStub
        lifecycleRef={site.geometryLifecycleRef}
        roofPlanesRef={site.roofPlanesRef as unknown as React.MutableRefObject<unknown[]>}
        restoreResolved={restoreResolved}
        onProbe={(p) => probes.push({ ...p, commit: probes.length, granted: evaluateGate(p) })}
      />
    );
  }

  render(<Host />);
  return {
    probes,
    hook: () => hook as Hook,
    openFence: () => (openFence as () => void)(),
  };
}

/** A stored layout row, exactly the shape DesignStudio hands
 *  `hydrateFromStored`. `deletions` rides on `siteArchives`, which is where the
 *  ledger actually lives on the row. */
function storedRow(deletions: DeletionLedger, roofPlanes: unknown[] = []) {
  return {
    panels: [],
    roofPlanes,
    obstructions: [],
    measurements: [],
    designElectrical: null,
    siteArchives: { version: 1 as const, activeSiteKey: HOUSE, sites: {}, deletions },
  } as never;
}

/** The ledger a deliberate Start Over leaves behind at this property. */
const CLEARED = withTombstones(emptyLedger(), HOUSE, {
  faceIds: ['face-the-user-deleted'],
  clearedAt: 1_759_000_000_000,
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE ORDERING, THROUGH THE REAL HOOK
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 Lane A cannot acquire before it knows the property was cleared', () => {
  it('no commit EVER grants acquisition at a cleared property', () => {
    const h = mountHarness();
    // The mount commit: the ref still holds its initial value and the fence is
    // shut. This is the state the defect would need, and the fence refuses it.
    expect(h.probes.length).toBeGreaterThan(0);
    expect(h.probes[0].lifecycle).toBe('untouched');
    expect(h.probes[0].restoreResolved).toBe(false);

    // DesignStudio's restore, in one synchronous block, in its real order.
    act(() => {
      h.hook().hydrateFromStored(storedRow(CLEARED), HOUSE);
      h.openFence();
    });

    // Every commit that has ever existed, including the one that opened the
    // fence, refused.
    const granted = h.probes.filter(p => p.granted);
    expect(granted).toEqual([]);
  });

  it('the lifecycle ref holds the real answer by the time the fence opens', () => {
    const h = mountHarness();
    act(() => {
      h.hook().hydrateFromStored(storedRow(CLEARED), HOUSE);
      h.openFence();
    });
    const opened = h.probes.filter(p => p.restoreResolved);
    expect(opened.length).toBeGreaterThan(0);
    // 🚨 THE WHOLE FINDING, IN ONE ASSERTION. There is no commit in which the
    // fence is open and the lifecycle is still the initial permissive value.
    for (const p of opened) expect(p.lifecycle).toBe('cleared');
  });

  it('and the plane count is zero throughout — the lifecycle is what refuses', () => {
    // Without this the refusals above could be coming from the plane count,
    // which is the guard that was PROVEN INSUFFICIENT: zero planes is the same
    // integer for a first visit and for a deliberate clearing.
    const h = mountHarness();
    act(() => {
      h.hook().hydrateFromStored(storedRow(CLEARED), HOUSE);
      h.openFence();
    });
    for (const p of h.probes) expect(p.existingPlaneCount).toBe(0);
  });

  it('holds when React splits the two updates into separate commits', () => {
    // Barrier 2 does not depend on batching. The archive tick is queued inside
    // `hydrateFromStored`, before the fence setter is called, so unbatching can
    // only put the lifecycle assignment EARLIER relative to the fence.
    const h = mountHarness();
    act(() => { h.hook().hydrateFromStored(storedRow(CLEARED), HOUSE); });
    act(() => { h.openFence(); });
    expect(h.probes.filter(p => p.granted)).toEqual([]);
    for (const p of h.probes.filter(p => p.restoreResolved)) {
      expect(p.lifecycle).toBe('cleared');
    }
  });

  it('and when the cleared property is ARRIVED AT, not loaded into', () => {
    // The other way to reach a cleared property: hydrate at the neighbour, then
    // pick this house. `switchToSite` re-seats the ledger mirror synchronously
    // and bumps the same recompute, so the arriving property's answer is in
    // place before the effect that starts the twin fetch even runs.
    const NEIGHBOUR = siteKeyFromCoords(38.70629, -90.04620, PROJECT);
    const h = mountHarness();
    act(() => {
      h.hook().hydrateFromStored(storedRow(CLEARED), NEIGHBOUR);
      h.openFence();
    });
    act(() => { h.hook().switchToSite(HOUSE); });
    expect(h.hook().geometryLifecycleRef.current).toBe('cleared');
    expect(h.probes.filter(p => p.granted)).toEqual([]);
  });

  it('a deletion recorded WITHOUT a whole-property clear refuses too', () => {
    // A tombstoned face and no `clearedAt` is the ordinary single-face delete.
    // It is still a deliberate removal, so it must not be re-acquired.
    const oneFace = withTombstones(emptyLedger(), HOUSE, { faceIds: ['f1'] });
    const h = mountHarness();
    act(() => {
      h.hook().hydrateFromStored(storedRow(oneFace), HOUSE);
      h.openFence();
    });
    expect(h.probes.filter(p => p.granted)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. POSITIVE CONTROLS — a vacuous file would fail these
// ═══════════════════════════════════════════════════════════════════════════

describe('POSITIVE CONTROL: a genuinely fresh design still acquires', () => {
  it('a first visit IS granted acquisition once the fence opens', () => {
    // 🚨 THIS IS WHY A FAIL-CLOSED DEFAULT IS THE WRONG FIX. The permissive
    // initial value is not a bug to be flipped: it is the correct answer for a
    // property nobody has ever modelled, which is the common case. Any change
    // that refuses here has broken zero-click detection for every new design.
    const h = mountHarness();
    act(() => {
      h.hook().hydrateFromStored(storedRow(emptyLedger()), HOUSE);
      h.openFence();
    });
    expect(h.probes.some(p => p.granted)).toBe(true);
  });

  it('a row with no stored layout at all still acquires', () => {
    const h = mountHarness();
    act(() => {
      h.hook().hydrateFromStored(null, HOUSE);
      h.openFence();
    });
    expect(h.probes.some(p => p.granted)).toBe(true);
  });

  it('the lifecycle of a fresh property really is the permissive one', () => {
    const h = mountHarness();
    act(() => {
      h.hook().hydrateFromStored(storedRow(emptyLedger()), HOUSE);
      h.openFence();
    });
    for (const p of h.probes.filter(x => x.restoreResolved)) {
      expect(p.lifecycle).toBe('untouched');
    }
  });

  it('the hook reports the same lifecycle it puts in the ref', () => {
    // The rendered value and the synchronous mirror must not disagree; a gate
    // reading one while the UI shows the other is how a refusal becomes
    // unexplainable.
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(storedRow(CLEARED), HOUSE); });
    expect(r.result.current.geometryLifecycleRef.current).toBe('cleared');
    expect(r.result.current.geometryLifecycle).toBe('cleared');
    act(() => { r.result.current.hydrateFromStored(storedRow(emptyLedger()), HOUSE); });
    expect(r.result.current.geometryLifecycleRef.current).toBe('untouched');
    expect(r.result.current.geometryLifecycle).toBe('untouched');
  });

  it('the pure gate matrix is unchanged', () => {
    const READY: LaneAGateInput = { ...OTHERWISE_READY, existingPlaneCount: 0, restoreResolved: true };
    expect(shouldRunLaneA({ ...READY, lifecycle: 'untouched' })).toBe(true);
    expect(shouldRunLaneA({ ...READY, lifecycle: 'cleared' })).toBe(false);
    expect(shouldRunLaneA({ ...READY, lifecycle: 'populated' })).toBe(false);
    expect(shouldRunLaneA({ ...READY, restoreResolved: false })).toBe(false);
    expect(lifecycleFor(CLEARED, HOUSE, 0)).toBe('cleared');
    expect(lifecycleFor(emptyLedger(), HOUSE, 0)).toBe('untouched');
    expect(acquisitionPermittedByLifecycle('untouched')).toBe(true);
    expect(acquisitionPermittedByLifecycle('cleared')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. FALSIFIABILITY — the window is real, the ordering is what shuts it
// ═══════════════════════════════════════════════════════════════════════════

describe('the window would be real if the ordering were reversed', () => {
  it('🚨 the same gate GRANTS at a cleared property when the fence opens first', () => {
    // Not a hypothetical rewrite of the gate: the real `shouldRunLaneA`, the
    // real cleared ledger, and the only difference is WHICH of the two values
    // the commit carries first. This is what every assertion in section 1 is
    // ruling out, and it is why they are not tautologies.
    expect(lifecycleFor(CLEARED, HOUSE, 0)).toBe('cleared');
    const beforeAssignment: DesignGeometryLifecycle = 'untouched';  // the ref's initial value
    expect(shouldRunLaneA({
      ...OTHERWISE_READY, existingPlaneCount: 0, restoreResolved: true,
      lifecycle: beforeAssignment,
    })).toBe(true);
    // Which is precisely the resurrection: a property the user emptied, granted
    // acquisition, because the answer had not arrived yet.
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE ORDERING, PINNED IN THE SOURCE
// ═══════════════════════════════════════════════════════════════════════════
//
// Section 1 proves the ordering holds TODAY. These pin the three structural
// facts that make it hold, because each can be dissolved by a refactor that
// produces no type error and no behavioural test failure anywhere else.

const read = (rel: string) => stripCommentsAndStrings(
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8'),
);
const HOOK_SRC = read('components/design/useSiteDesign.ts');
const STUDIO_SRC = read('components/design/DesignStudio.tsx');
const ENGINE_SRC = read('components/3d/SolarEngine3D.tsx');

/**
 * 🚨 THE WORKAROUND THAT USED TO LIVE HERE IS GONE, AND THE HAZARD IT DODGED IS
 *    FIXED AT SOURCE.
 *
 * This constant used to be a comment-only view of DesignStudio.tsx, because
 * `stripCommentsAndStrings` was hand-rolled and treated every quote character as
 * a string delimiter regardless of context. A lone apostrophe in JSX *text* — the
 * possessive in a sentence a user reads — opened a string it never closed, and
 * everything to the next apostrophe was blanked. Measured on this file at the
 * time: `<SolarEngine3D` and `geometryLifecycleRef={` each went from 1 occurrence
 * in the raw source to 0 after stripping, so the JSX guard below was reading
 * whitespace and a guard ASSERTING THEIR ABSENCE would have passed.
 *
 * `tests/support/stripSource.ts` is now backed by TypeScript's own parser, so JSX
 * text is recognised as text (blanked by the identifier stripper, like any string
 * body) and the element and attribute names around it are recognised as code. The
 * JSX guard therefore reads STUDIO_SRC like every other guard in this file, which
 * is the stricter of the two: a mention inside a string literal no longer counts
 * as a render site. tests/stripSourceIsJsxSafe.test.ts pins that, on a fixture and
 * on this component.
 */

/**
 * The span of a call expression: from the `(` that follows `callee` to its
 * matching `)`, by paren depth.
 *
 * 🚨 NEVER A FIXED-LENGTH WINDOW. The stripper blanks comments to whitespace
 * while preserving byte offsets, so any window of a constant size can be pushed
 * off the real code by a comment somebody adds above it — a guard that then
 * fails on correct source. Every span here is anchored on real end tokens.
 *
 * An explicit type-argument list is allowed between the callee and its `(` —
 * `useCallback<UseSiteDesign['hydrateFromStored']>(...)` is how this hook
 * declares most of what it returns, and a matcher that missed it silently
 * anchored on the NEXT declaration instead.
 */
function callSpans(src: string, callee: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const re = new RegExp(callee + '\\s*(?:<[^>(]*>)?\\s*\\(', 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) break; }
    }
    spans.push({ start: m.index, end: i });
  }
  return spans;
}

const offsets = (src: string, re: RegExp): number[] => {
  const out: number[] = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (let m = g.exec(src); m; m = g.exec(src)) out.push(m.index);
  return out;
};

describe('🚨 the lifecycle is computed during RENDER, not in an effect', () => {
  it('its only assignment sits inside the memo that derives it', () => {
    const writes = offsets(HOOK_SRC, /geometryLifecycleRef\.current\s*=(?!=)/);
    expect(writes).toHaveLength(1);

    const anchor = HOOK_SRC.search(/const\s+geometryLifecycle\s*=\s*useMemo\s*\(/);
    expect(anchor).toBeGreaterThan(-1);
    const memo = callSpans(HOOK_SRC.slice(anchor), 'useMemo')[0];
    expect(memo).toBeTruthy();
    const start = anchor + memo.start, end = anchor + memo.end;
    // Inside the memo body means: evaluated in the render pass, so it is
    // already written when this commit's effects run.
    expect(writes[0]).toBeGreaterThan(start);
    expect(writes[0]).toBeLessThan(end);
  });

  it('it is not assigned from any post-commit callback in this hook', () => {
    // The requirement, not one spelling of it: no write to the mirror may be
    // deferred past the render pass, whichever post-commit hook defers it.
    const write = offsets(HOOK_SRC, /geometryLifecycleRef\.current\s*=(?!=)/)[0];
    for (const hook of ['useEffect', 'useLayoutEffect', 'useInsertionEffect']) {
      for (const span of callSpans(HOOK_SRC, hook)) {
        expect(write > span.start && write < span.end).toBe(false);
      }
    }
  });

  it('hydration installs the ledger BEFORE it schedules the recompute', () => {
    const anchor = HOOK_SRC.search(/const\s+hydrateFromStored\s*=\s*useCallback/);
    expect(anchor).toBeGreaterThan(-1);
    const body = callSpans(HOOK_SRC.slice(anchor), 'useCallback')[0];
    const region = HOOK_SRC.slice(anchor + body.start, anchor + body.end);
    const installsState = region.search(/stateRef\.current\s*=\s*res\.state/);
    const installsLedger = region.search(/deletionLedgerRef\.current\s*=/);
    const schedules = region.search(/setArchiveTick\s*\(/);
    expect(installsState).toBeGreaterThan(-1);
    expect(installsLedger).toBeGreaterThan(-1);
    expect(schedules).toBeGreaterThan(-1);
    expect(installsState).toBeLessThan(schedules);
    expect(installsLedger).toBeLessThan(schedules);
  });

  it('and schedules it unconditionally — a skipped recompute is a stale answer', () => {
    const anchor = HOOK_SRC.search(/const\s+hydrateFromStored\s*=\s*useCallback/);
    const body = callSpans(HOOK_SRC.slice(anchor), 'useCallback')[0];
    const region = HOOK_SRC.slice(anchor + body.start, anchor + body.end);
    // No branch may stand between entering the hydration and the recompute it
    // schedules, or a hydration that takes the other branch leaves the mirror
    // holding the previous property's answer.
    const upToSchedule = region.slice(0, region.search(/setArchiveTick\s*\(/));
    expect(upToSchedule).not.toMatch(/\bif\s*\(/);
  });
});

describe('🚨 the restore fence opens only after the design has hydrated', () => {
  it('every opening of the fence follows a hydration call', () => {
    const hydrations = offsets(STUDIO_SRC, /hydrateFromStored\s*\(/);
    const opens = offsets(STUDIO_SRC, /setRoofRestoreResolved\s*\(\s*true\s*\)/);
    expect(hydrations.length).toBeGreaterThan(0);
    expect(opens.length).toBeGreaterThan(0);
    for (const o of opens) expect(hydrations.some(h => h < o)).toBe(true);
  });

  it('and the one engine render site wires BOTH values it gates on', () => {
    // Both props are optional on the engine, and the gate falls back to the
    // permissive value for the lifecycle. That fallback is unreachable only
    // because the single render site passes the ref. Stop passing it and the
    // gate silently reverts to "nobody ever deleted anything here", at every
    // property, with no type error — the optional-prop variant of this bug.
    //
    // 🚨 POSITIVE CONTROL FIRST. This assertion is a COUNT, and a stripper that
    // blanked the JSX would make it read zero — which is what it did before
    // stripSource.ts was rebuilt on TypeScript's parser (see the note above
    // STUDIO_SRC). The density check says the file being scanned is code, not a
    // field of whitespace, so "exactly one render site" cannot be satisfied by
    // there being none visible.
    // Measured: 0.698 raw, 0.362 stripped. The floor is a catastrophe detector,
    // set well below that so a long string added to the component cannot fail it.
    expect(STUDIO_SRC.replace(/\s/g, '').length / STUDIO_SRC.length,
      'the stripped studio is mostly whitespace — this guard would prove nothing')
      .toBeGreaterThan(0.2);
    const renders = offsets(STUDIO_SRC, /<SolarEngine3D[\s>]/);
    expect(renders).toHaveLength(1);
    expect(STUDIO_SRC).toMatch(/geometryLifecycleRef\s*=\s*\{/);
    expect(STUDIO_SRC).toMatch(/roofRestoreResolved\s*=\s*\{/);
  });

  it('and the fence is re-armed before the layout is fetched', () => {
    // A fence left open from the previous project is open across the next
    // project's in-flight restore, which is the same window by another route.
    const rearms = offsets(STUDIO_SRC, /setRoofRestoreResolved\s*\(\s*false\s*\)/);
    const firstHydration = offsets(STUDIO_SRC, /hydrateFromStored\s*\(/)[0];
    expect(rearms.some(r => r < firstHydration)).toBe(true);
  });
});

describe('🚨 the gate reads the fence from a value written after the commit', () => {
  it('the mirror the gate reads is only ever written from an effect', () => {
    const writes = offsets(ENGINE_SRC, /roofRestoreResolvedRef\.current\s*=(?!=)/);
    expect(writes.length).toBeGreaterThan(0);
    const effects = [
      ...callSpans(ENGINE_SRC, 'useEffect'),
      ...callSpans(ENGINE_SRC, 'useLayoutEffect'),
    ];
    for (const w of writes) {
      expect(effects.some(s => w > s.start && w < s.end)).toBe(true);
    }
  });

  it('🚨 and the gate is only reachable behind an async boundary', () => {
    // The third barrier, and the coarsest: the gate's only caller sits in a
    // resolved-promise callback, so it cannot be reached in the same commit as
    // any state change — the twin fetch has not even STARTED until the effects
    // of that commit run. A call added on the synchronous path would dissolve
    // that, which is how the second acquisition door (Auto Fill) came to exist.
    // The declaration is excluded by ANCHORING on it, not by inspecting a
    // fixed-width window behind each call — a window of any constant size can
    // be pushed off the real token by whatever somebody writes above it.
    const declared = ENGINE_SRC.search(/function\s+maybeRunLaneA\s*\(/);
    expect(declared).toBeGreaterThan(-1);
    const declaredName = ENGINE_SRC.indexOf('maybeRunLaneA', declared);
    const calls = offsets(ENGINE_SRC, /maybeRunLaneA\s*\(/).filter(o => o !== declaredName);
    expect(calls.length).toBeGreaterThan(0);
    const thens = callSpans(ENGINE_SRC, '\\.then');
    for (const c of calls) {
      expect(thens.some(s => c > s.start && c < s.end)).toBe(true);
    }
  });

  it('the gate consults the lifecycle at all, from the ref and not a closure', () => {
    const anchor = ENGINE_SRC.search(/function\s+maybeRunLaneA\s*\(/);
    expect(anchor).toBeGreaterThan(-1);
    const region = ENGINE_SRC.slice(anchor, anchor + ENGINE_SRC.slice(anchor).search(/\n  \}/));
    expect(region).toMatch(/lifecycle\s*:[^,]*geometryLifecycleRef/);
    expect(region).toMatch(/restoreResolved\s*:[^,]*roofRestoreResolvedRef\.current/);
  });
});
