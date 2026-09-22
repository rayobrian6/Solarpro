/**
 * tests/providerAuthorityRepair.test.ts
 *
 * "WHICH GEOMETRY SOURCE IS GOVERNING THIS PROJECT, AND WHY?"
 *
 * The disposition module could already answer that. Nothing asked it properly.
 * An independent audit found six ways the answer was lost, invented or
 * unreachable, and every one of them ends in the same place: the property reads
 * `undecided`, which is the state that PERMITS re-acquisition — so Google's
 * roof comes back over the installer's own model.
 *
 *   1. [critical] the decision was WRITTEN under the caller's key and READ under
 *      `activeSiteKey`, and the memo that read it overwrote the ref the write
 *      had just set. On a project whose coordinates are absent or the
 *      placeholder pair, `activeSiteKey` is '' forever, so EVERY decision was
 *      erased on the next render.
 *   2. [high] the Lane A gate read the decision from a prop — a closure — while
 *      every other gate input is a live ref, and the gate fires from inside a
 *      resolved promise seconds later.
 *   3. [high] `accepted` had no writer anywhere in the app.
 *   4. [high] `custom` was set by one traced section, survived Undo, and no
 *      control could clear it.
 *   5. [medium] the lookup was an exact string match while every other
 *      site-identity question is an 8 m property match.
 *   6. [low] the governing answer was never displayed.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  dispositionFor, withDisposition, nativeAcquisitionPermitted, dispositionLabel,
  type NativeGeometryMap,
} from '@/lib/design/nativeGeometryDisposition';
import {
  dispositionForProperty, withDispositionForProperty, SITE_MATCH_RADIUS_M,
} from '@/lib/design/siteDesignModel';
import {
  emptyHistory, pushSnapshot, undo, redo,
} from '@/lib/3d/geometryHistory';
import type { RoofPlane } from '@/types';

const REPO = process.cwd();
const STUDIO = fs.readFileSync(path.join(REPO, 'components/design/DesignStudio.tsx'), 'utf8');
const HOOK = fs.readFileSync(path.join(REPO, 'components/design/useSiteDesign.ts'), 'utf8');
const ENGINE = fs.readFileSync(path.join(REPO, 'components/3d/SolarEngine3D.tsx'), 'utf8');

/** Strip comments so a guard cannot be satisfied by prose describing itself. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** A site key `metres` north of another, the way a drifting camera mints one. */
function keyNorthOf(key: string, metres: number): string {
  const at = key.lastIndexOf('@');
  const [lat, lng] = key.slice(at + 1).split(',').map(Number);
  return `${key.slice(0, at)}@${(lat + metres / 111_320).toFixed(5)},${lng.toFixed(5)}`;
}

const K1 = 'proj7@38.70615,-90.04625';

// ═══════════════════════════════════════════════════════════════════════════
// 5. A DECISION IS ABOUT A PROPERTY, NOT ABOUT A SPELLING OF ONE.
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the lookup matches by property, like every other site question', () => {
  const map: NativeGeometryMap = { [K1]: 'rejected' };

  it('the exact key still wins, and costs nothing', () => {
    expect(dispositionForProperty(map, K1)).toBe('rejected');
  });

  it('🚨 a key that drifted a few metres finds the SAME decision', () => {
    const drifted = keyNorthOf(K1, 5);   // inside the 8 m property radius
    // The exact primitive misses it — which is the defect, stated.
    expect(dispositionFor(map, drifted)).toBe('undecided');
    // The property-aware lookup does not.
    expect(dispositionForProperty(map, drifted)).toBe('rejected');
  });

  it('…and the NEIGHBOUR’s house is still a different property', () => {
    const neighbour = keyNorthOf(K1, SITE_MATCH_RADIUS_M * 3);
    expect(dispositionForProperty(map, neighbour)).toBe('undecided');
  });

  it('🚨 a second decision REPLACES the first rather than sitting beside it', () => {
    const drifted = keyNorthOf(K1, 5);
    const next = withDispositionForProperty(map, drifted, 'custom');
    expect(Object.keys(next)).toEqual([K1]);      // one house, one decision
    expect(next[K1]).toBe('custom');
    // The exact writer is what produced two entries for one house.
    const naive = withDisposition(map, drifted, 'custom');
    expect(Object.keys(naive).length).toBe(2);
  });

  it('an unmatched key files its own decision, as it must', () => {
    const neighbour = keyNorthOf(K1, 40);
    const next = withDispositionForProperty(map, neighbour, 'accepted');
    expect(next[K1]).toBe('rejected');
    expect(next[neighbour]).toBe('accepted');
  });

  it('an unresolved key writes nothing and reads undecided', () => {
    expect(dispositionForProperty(map, '')).toBe('undecided');
    expect(withDispositionForProperty(map, '', 'custom')).toEqual(map);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. UNDO RESTORES THE DECISION, NOT JUST THE ROOF.
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a geometry undo puts the provider decision back too', () => {
  const plane = (id: string): RoofPlane => ({
    id, vertices: [], pitch: 20, azimuth: 180, area: 10, usableArea: 8,
  } as RoofPlane);

  it('drawing one section and undoing it does not leave the property "custom" forever', () => {
    // Before: an untouched property with no planes.
    let h = pushSnapshot(emptyHistory(), 'Draw section', [], 'sec', 'undecided');
    // The tool emits a face carrying `.section`, so DesignStudio files 'custom'.
    const after = [plane('sec-1::slopeA')];

    const back = undo(h, after, 'custom');
    expect(back.ok).toBe(true);
    expect(back.planes).toEqual([]);
    // 🚨 THE HALF-UNDO, CLOSED. Without this the roof came back empty and the
    // property stayed 'custom' — refusing every acquisition door, with nothing
    // in the app able to clear it.
    expect(back.disposition).toBe('undecided');
    expect(nativeAcquisitionPermitted(back.disposition as any)).toBe(true);

    // And Redo puts BOTH forward again.
    const fwd = redo(back.history, back.planes, 'undecided');
    expect(fwd.ok).toBe(true);
    expect(fwd.planes.map(p => p.id)).toEqual(['sec-1::slopeA']);
    expect(fwd.disposition).toBe('custom');
  });

  it('a step recorded WITHOUT a decision restores none — null is not "undecided"', () => {
    // Coercing null to 'undecided' would let an undo silently license
    // re-acquisition over hand-built work.
    const h = pushSnapshot(emptyHistory(), 'Old edit', [plane('a')], null);
    const back = undo(h, [plane('a'), plane('b')], 'custom');
    expect(back.ok).toBe(true);
    expect(back.disposition).toBeNull();
  });

  it('a refusal carries the field too, with nothing in it', () => {
    const step = undo(emptyHistory(), [plane('a')], 'custom');
    expect(step.ok).toBe(false);
    expect(step.disposition).toBeNull();
    // 🚨 Uniform shape: a refusal hands back the CURRENT planes, so adopting it
    // is a no-op rather than a wipe.
    expect(step.planes.map(p => p.id)).toEqual(['a']);
  });

  it('coalesced presses keep the decision from BEFORE the run', () => {
    let h = pushSnapshot(emptyHistory(), 'Nudge', [plane('a')], 'nudge', 'accepted');
    h = pushSnapshot(h, 'Nudge', [plane('a')], 'nudge', 'custom');
    expect(h.past.length).toBe(1);
    expect(h.past[0].disposition).toBe('accepted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE WIRING. Every one of these was found by an audit as "no caller".
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the decision has writers for every state that needs one', () => {
  const studio = stripComments(STUDIO);

  it("'accepted' is recorded when the installer confirms the detected planes", () => {
    // It had NO writer anywhere, so a design built entirely on Google planes
    // read 'undecided' — identical to a property nobody had opened.
    expect(studio).toMatch(/setNativeDisposition\('accepted'/);
    const i = studio.indexOf('Confirm All Planes');
    expect(i, 'the confirm button is gone').toBeGreaterThan(-1);
    // The write is in the same handler as the confirm, not somewhere else.
    expect(studio.slice(Math.max(0, i - 1200), i)).toMatch(/setNativeDisposition\('accepted'/);
  });

  it("'rejected' is reachable from a row that does NOT unmount on confirm", () => {
    // It used to live only inside `roofPlanes.some(p => p.confirmed === false)`,
    // which the confirm click makes false — taking the only writer with it.
    const i = studio.indexOf('data-testid="geometry-source-row"');
    expect(i, 'the geometry-source row is not mounted').toBeGreaterThan(-1);
    const block = studio.slice(i, i + 2600);
    expect(block).toMatch(/setNativeDisposition\('rejected'/);
    expect(block).toMatch(/dispositionLabel\(/);
  });

  it("🚨 and there is a way BACK — 'custom' is no longer a one-way door", () => {
    const i = studio.indexOf('data-testid="geometry-source-reopen"');
    expect(i, 'nothing can reopen the decision').toBeGreaterThan(-1);
    const block = studio.slice(i, i + 1400);
    // 🚨 BACK TO 'undecided', NOT TO 'accepted'. Re-opening the question is not
    // answering it, and inferring an acceptance nobody made is the defect class
    // the whole module exists to prevent.
    expect(block).toMatch(/setNativeDisposition\('undecided'/);
    expect(block).not.toMatch(/setNativeDisposition\('accepted'/);
  });

  it('the governing answer is displayed, not only enforced', () => {
    expect(studio).toMatch(/dispositionLabel\(site\.nativeDisposition\)/);
    expect(studio).toMatch(/customModelGoverns\(site\.nativeDisposition\)/);
    // Every state says something a person can act on.
    for (const d of ['accepted', 'unavailable', 'rejected', 'custom', 'undecided'] as const) {
      expect(dispositionLabel(d).length).toBeGreaterThan(10);
    }
  });
});

describe('🚨 the gate reads the decision that exists NOW', () => {
  const engine = stripComments(ENGINE);

  it('Lane A takes it from a ref, like every other gate input', () => {
    // `maybeRunLaneA` is called from inside `buildDigitalTwin(...).then()`, so a
    // prop is the value from before the fetch. lib/3d/laneA.ts states the
    // contract: every gate field is read from a REF at fire time.
    expect(engine).toMatch(/nativeDisposition: nativeDispositionRef\?\.current \?\? nativeDisposition/);
  });

  it('…and so does the second acquisition door, Auto Fill', () => {
    expect(engine).toMatch(/const decided = nativeDispositionRef\?\.current \?\? nativeDisposition/);
    expect(engine).toMatch(/nativeAcquisitionPermitted\(decided\)/);
  });

  it('DesignStudio actually passes the ref down', () => {
    expect(stripComments(STUDIO)).toMatch(/nativeDispositionRef=\{site\.nativeDispositionRef\}/);
  });
});

describe('🚨 the read and the write use ONE key expression', () => {
  const hook = stripComments(HOOK);

  it('both go through dispositionKeyOf', () => {
    // The write took `siteKey || activeSiteKeyRef.current || state.activeSiteKey`
    // while the memo read `activeSiteKey` alone — so on a project whose
    // coordinates never resolve, the write filed the decision and the very next
    // render read '' and overwrote the ref with 'undecided'.
    expect(hook).toMatch(/const dispositionKeyOf = useCallback/);
    // Exactly two callers: the memo that READS, and the setter that WRITES.
    // A third would mean a third key expression, which is how they diverged.
    expect((hook.match(/dispositionKeyOf\(/g) ?? []).length).toBe(2);
    expect(hook).toMatch(/const key = dispositionKeyOf\(\);/);        // the read
    expect(hook).toMatch(/const key = dispositionKeyOf\(siteKey\);/); // the write
  });

  it('the memo never overwrites a known decision with "nobody looked"', () => {
    expect(hook).toMatch(/if \(key \|\| d !== 'undecided'\) nativeDispositionRef\.current = d;/);
  });

  it('both sides match by property', () => {
    expect(hook).toMatch(/dispositionForProperty\(/);
    expect(hook).toMatch(/withDispositionForProperty\(/);
    // 🚨 And the exact primitives are no longer used here at all, so there is
    // one answer to "is this the same house".
    expect(hook).not.toMatch(/[^y]dispositionFor\(/);
    expect(hook).not.toMatch(/[^y]withDisposition\(/);
  });

  it('undo carries the decision through the history, not around it', () => {
    expect(hook).toMatch(/nativeDispositionRef\.current,\s*\n\s*\)\);/);   // pushSnapshot
    expect(hook).toMatch(/restoreDisposition\(step\.disposition\)/);
  });
});
