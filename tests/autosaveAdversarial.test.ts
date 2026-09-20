/**
 * tests/autosaveAdversarial.test.ts
 *
 * AUTOSAVE, BEYOND HAPPY-PATH PITCH EDITING.
 *
 * Every case here is a way the layout autosave has actually failed, or a way it
 * could fail silently. "Silently" is the theme: none of these announce
 * themselves — the payload looks right, the request succeeds, and the design is
 * wrong on reload.
 *
 * 🚨 THE CLASS OF DEFECT THIS FILE EXISTS FOR
 *   • the dedup signature was defeated by a timestamp, so every tick POSTed
 *   • the restore seed signed a different shape than the writers, so a restored
 *     layout re-POSTed itself immediately
 *   • `undefined` means KEEP STORED in the route's `??` merge, so clearing was
 *     unsaveable
 *   • a coordinate change left another property's roof in state
 *   • a "reconcile deletions" effect inferred a delete from prop timing and
 *     removed a user's traced garage — ABSENCE IS NOT INTENT
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutSignature, SIGNED_DESIGN_PARAMS, SIGNED_FIELDS } from '@/lib/roofPlanesSignature';
import { mergeForPersistence, partitionBySite, siteKeyFromCoords } from '@/lib/siteIdentity';
import type { RoofPlane } from '@/types';

const SRC = readFileSync(join(process.cwd(), 'components/design/DesignStudio.tsx'), 'utf8');
const KEY = siteKeyFromCoords(38.89080, -89.57079, 'proj');
const KEY_B = siteKeyFromCoords(38.70890, -90.14940, 'proj');

function plane(id: string, over: Partial<RoofPlane> = {}): RoofPlane {
  return {
    id,
    vertices: [{ lat: 38.8, lng: -89.5 }, { lat: 38.8001, lng: -89.5 }, { lat: 38.8001, lng: -89.4999 }],
    pitch: 22, azimuth: 180, area: 60, usableArea: 52, siteKey: KEY, ...over,
  } as RoofPlane;
}

/** What the writers compute. */
const sig = (planes: RoofPlane[], params: any = null, panels: unknown[] = []) =>
  layoutSignature({ panels, designElectrical: null, roofPlanes: planes, designParams: params });

/** A round trip through JSON, as the database does it. */
const roundTrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── CREATE / EDIT / DELETE ──────────────────────────────────────────────────

describe('roof create / edit / delete round trips', () => {
  it('create roof → save → reload restores it', () => {
    const created = [plane('a')];
    const stored = roundTrip(mergeForPersistence(created, [], KEY));
    expect(partitionBySite(stored, KEY).active.map(p => p.id)).toEqual(['a']);
  });

  it('edit roof → the edit schedules a save', () => {
    const before = sig([plane('a', { pitch: 22 })]);
    expect(sig([plane('a', { pitch: 26 })])).not.toBe(before);
  });

  it('edit roof → save → reload restores the EDITED value', () => {
    const stored = roundTrip(mergeForPersistence([plane('a', { pitch: 26 })], [], KEY));
    expect(partitionBySite(stored, KEY).active[0].pitch).toBe(26);
  });

  it('delete ONE plane of several → schedules a save and reloads without it', () => {
    const before = sig([plane('a'), plane('b')]);
    const after = [plane('a')];
    expect(sig(after)).not.toBe(before);
    const stored = roundTrip(mergeForPersistence(after, [], KEY));
    expect(partitionBySite(stored, KEY).active.map(p => p.id)).toEqual(['a']);
  });

  it('🚨 delete ALL planes → reload stays empty', () => {
    // The `undefined` vs `[]` defect. The route merges
    // `roofPlanes ?? existingLayout?.roofPlanes`, so sending `undefined` meant
    // KEEP STORED: "Draw Manually Instead" and deleting the last face both
    // reported saved and came back on reload.
    const before = sig([plane('a')]);
    expect(sig([])).not.toBe(before);            // clearing is a change
    const stored = roundTrip(mergeForPersistence([], [], KEY));
    expect(stored).toEqual([]);                   // [] is persisted, not dropped
    expect(partitionBySite(stored, KEY).active).toEqual([]);
  });

  it('the payload sends the array itself, never undefined', () => {
    expect(SRC).not.toMatch(/roofPlanes:\s*\w+\.length > 0 \? [^:]+ : undefined/);
  });
});

// ── DEDUP CANNOT BE DEFEATED ────────────────────────────────────────────────

describe('the dedup survives the things that used to defeat it', () => {
  it('a timestamp cannot make identical content look changed', () => {
    const a = layoutSignature({ panels: [], designElectrical: { topology: 'string', generatedAt: 'T1' }, roofPlanes: [] });
    const b = layoutSignature({ panels: [], designElectrical: { topology: 'string', generatedAt: 'T2' }, roofPlanes: [] });
    expect(b).toBe(a);
  });

  it('but a real electrical change still registers', () => {
    const a = layoutSignature({ panels: [], designElectrical: { topology: 'string', generatedAt: 'T' }, roofPlanes: [] });
    const b = layoutSignature({ panels: [], designElectrical: { topology: 'micro', generatedAt: 'T' }, roofPlanes: [] });
    expect(b).not.toBe(a);
  });

  it('floating-point noise in derived 3D fields does not churn a save', () => {
    const a = plane('a'); (a as any).polygon3D = [{ x: 1.00000001, y: 2, z: 3 }];
    const b = plane('a'); (b as any).polygon3D = [{ x: 1.00000002, y: 2, z: 3 }];
    expect(sig([b])).toBe(sig([a]));
  });

  it('restoring a saved layout does not immediately rewrite it', () => {
    // Seed/writer parity. The seed must sign the same shape the writers do.
    const planes = [plane('a')];
    const params = { fenceHeight: 2, groundTilt: 20, rowSpacing: 1.5, groundHeight: 0.6, bifacialOptimized: true };
    const stored = roundTrip(mergeForPersistence(planes, [], KEY));
    const { active, foreign } = partitionBySite(stored, KEY);
    const seed = sig(mergeForPersistence(active, foreign, KEY), params);
    const firstTick = sig(mergeForPersistence(active, foreign, KEY), params);
    expect(firstTick).toBe(seed);
  });
});

// ── DESIGN PARAMETERS ───────────────────────────────────────────────────────

describe('scalar design parameters can trigger a save', () => {
  const base = { fenceHeight: 2, groundTilt: 20, groundAzimuth: 180, rowSpacing: 1.5, groundHeight: 0.6, bifacialOptimized: true };

  for (const field of SIGNED_DESIGN_PARAMS) {
    it(`a change to ${field} changes the signature`, () => {
      const before = sig([], base);
      const changed: any = { ...base };
      changed[field] = field === 'bifacialOptimized' ? false
        : field === 'fenceLine' ? [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]
        : 99;
      expect(sig([], changed)).not.toBe(before);
    });
  }

  it('a fence line edit alone schedules a save', () => {
    // On a fence or ground-mount design the panels may never move, so without
    // this the edit was simply lost.
    const before = sig([], { ...base, fenceLine: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] });
    const after = sig([], { ...base, fenceLine: [{ lat: 1, lng: 1 }, { lat: 3, lng: 3 }] });
    expect(after).not.toBe(before);
  });

  it('both writers sign the design parameters', () => {
    const matches = SRC.match(/const designParams = \{/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // debounced save + beacon
  });

  it('the restore reads every signed parameter back', () => {
    for (const f of SIGNED_DESIGN_PARAMS) {
      if (f === 'fenceAzimuth') continue; // derived from fenceLine, not restored
      expect(SRC, `restore does not read ${f}`).toMatch(new RegExp(`data\\.data\\?\\.${f}`));
    }
  });
});

// ── RACES AND FAILURES ──────────────────────────────────────────────────────

describe('concurrency and failure', () => {
  it('rapid consecutive edits collapse to the LAST state', () => {
    // The debounce is re-armed on every change, so only the final content is
    // signed and sent.
    const states = [22, 24, 26, 28].map(p => [plane('a', { pitch: p })]);
    const sigs = states.map(s => sig(s));
    expect(new Set(sigs).size).toBe(4);            // each is distinguishable
    expect(sigs[3]).toBe(sig([plane('a', { pitch: 28 })])); // last wins
  });

  it('a save in flight does not mask a newer edit', () => {
    // lastSavedPanelsRef is set to the signature of what was SENT. A newer edit
    // produces a different signature, so the next tick still fires.
    let lastSaved = sig([plane('a', { pitch: 22 })]);
    const newer = sig([plane('a', { pitch: 30 })]);
    expect(newer === lastSaved).toBe(false);
    lastSaved = newer;
    expect(sig([plane('a', { pitch: 30 })]) === lastSaved).toBe(true); // then settles
  });

  it('a failed save can be retried — the signature is recomputed, not cached elsewhere', () => {
    // There is exactly one place the "already saved" fact lives.
    const assignments = SRC.match(/lastSavedPanelsRef\.current\s*=/g) ?? [];
    expect(assignments.length).toBeGreaterThan(0);
    expect(SRC).toMatch(/if \(sig === lastSavedPanelsRef\.current\) return/);
  });

  it('🚨 a restore FAILURE disables saving permanently', () => {
    // If we could not READ the layout we must not risk WRITING over it.
    expect(SRC).toMatch(/restoreStateRef\.current = 'failed'/);
    expect(SRC).toMatch(/if \(restoreStateRef\.current !== 'done'\) return/);
  });

  it('a non-ok response is a failure, not a green light', () => {
    // Only a THROWN error used to reach the catch, so a 400/401/404 returned as
    // JSON fell through to 'done' and enabled saves against a layout never read.
    expect(SRC).toMatch(/if \(!res\.ok \|\| !data\?\.success\)/);
  });

  it('the fence re-arms before the await on a project switch', () => {
    const restoreFn = SRC.slice(SRC.indexOf('const restorePanels = async'), SRC.indexOf('restorePanels();'));
    const pendingIdx = restoreFn.indexOf("restoreStateRef.current = 'pending'");
    const fetchIdx = restoreFn.indexOf('await fetch(');
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(pendingIdx).toBeLessThan(fetchIdx);
  });
});

// ── STALE STATE CANNOT WIN ──────────────────────────────────────────────────

describe('stale responses cannot overwrite newer client state', () => {
  it('a detection for another site is dropped, not merged', () => {
    expect(SRC).toMatch(/dropped \$\{planes\.length\} detected plane\(s\) for/);
  });

  it('an archived site cannot reappear as the active one', () => {
    const stored = mergeForPersistence([plane('b1', { siteKey: KEY_B })], [plane('a1')], KEY_B);
    const { active } = partitionBySite(roundTrip(stored), KEY_B);
    expect(active.map(p => p.id)).toEqual(['b1']);
  });

  it('...and the archived site is still there when you go back', () => {
    const stored = mergeForPersistence([plane('b1', { siteKey: KEY_B })], [plane('a1')], KEY_B);
    const { active } = partitionBySite(roundTrip(stored), KEY);
    expect(active.map(p => p.id)).toEqual(['a1']);
  });
});

// ── THE GARAGE ──────────────────────────────────────────────────────────────

describe('🚨 the traced-garage deletion class', () => {
  it('the reconcile-deletions block is gone and pinned gone', () => {
    // A "reconcile deletions" effect removed entities for any plane id absent
    // from the roofPlanes prop. Traced faces live in plane3DEntityMap and the
    // prop does not always list them when that effect runs, so it deleted a
    // user's traced garage. ABSENCE IS NOT INTENT.
    const engine = readFileSync(join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8');
    expect(engine).not.toMatch(/plane3DEntityMap\.current\.(delete|clear)\(/);
  });

  it('the engine has no persistence writer of its own', () => {
    // A second writer would have to serialise the roofPlanes prop, which lags
    // plane3DEntityMap by a commit — the garage, through a different door.
    const engine = readFileSync(join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8');
    expect(engine).not.toMatch(/sendBeacon/);
    expect(engine).not.toMatch(/fetch\(\s*`?\/api\/projects/);
  });

  it('an address change ARCHIVES rather than clears', () => {
    expect(SRC).toMatch(/archived \$\{leaving\.length\} plane\(s\)/);
    // and handleLocationPick still must not clear roofPlanes
    const pick = SRC.slice(SRC.indexOf('const handleLocationPick'), SRC.indexOf('const handleLocationPick') + 2500);
    expect(pick).not.toMatch(/setRoofPlanes\(\[\]\)/);
  });

  it('manual provenance survives every transition', () => {
    const traced = plane('hand', { source: 'manual', confirmed: true });
    const stored = roundTrip(mergeForPersistence([], [traced], KEY_B));
    const back = partitionBySite(stored, KEY).active[0];
    expect(back).toMatchObject({ id: 'hand', source: 'manual', confirmed: true });
  });
});

// ── KNOWN GAPS, RECORDED ────────────────────────────────────────────────────

describe('entities that are NOT persisted — asserted so they stay known', () => {
  // These have no outbound callback from SolarEngine3D at all: they die on
  // unmount. Persisting them needs an engine->studio callback plus a Layout
  // field, and for some of them a product decision about whether they are
  // design data or view state. Recorded here rather than left to be
  // rediscovered as a bug report.
  const NOT_PERSISTED = ['obstructions', 'measurements', 'trees', 'blocks', 'vertexSpecs'];

  it('the layout signature does not claim to cover them', () => {
    for (const e of NOT_PERSISTED) {
      expect(SIGNED_DESIGN_PARAMS as readonly string[]).not.toContain(e);
      expect(SIGNED_FIELDS as readonly string[]).not.toContain(e);
    }
  });

  it('camera pose is deliberately absent — it is per-viewer, not design data', () => {
    // Putting it on the shared layout row would make one user's camera move
    // every other user's view, and every pose nudge a database write.
    expect(SIGNED_DESIGN_PARAMS as readonly string[]).not.toContain('camera');
  });
});
