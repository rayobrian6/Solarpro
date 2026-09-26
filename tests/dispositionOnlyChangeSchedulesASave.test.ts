/**
 * tests/dispositionOnlyChangeSchedulesASave.test.ts
 *
 * DECIDING "MY OWN MODEL GOVERNS THIS ROOF" WAS LOST ON RELOAD.
 *
 * The native-geometry disposition is the record of a decision a person made about
 * a property: whether SolarPro may acquire the provider's detected roof, or
 * whether the hand-built model governs and detection must not overwrite it. It
 * rides to the database inside `siteArchives.nativeGeometry`, so a save DOES
 * persist it.
 *
 * 🚨 BUT NOTHING SCHEDULED THAT SAVE. The studio's autosave effect fires on a
 * dependency array, and `site.nativeDisposition` was not in it. So a
 * disposition-only change — the user says "keep my model", touches nothing else,
 * and reloads — was gone, and the next hydration was free to acquire over the
 * work the decision existed to protect.
 *
 * 🚨 AND THIS IS THE SECOND TIME THIS EXACT SHAPE HAS BITTEN. The deletion ledger
 * had it first, and the comment left beside that fix says why it is so easy to
 * miss: `archivesSignature` already SIGNS the ledger, "which is why this looked
 * finished. Signing only suppresses a redundant POST once something else has
 * scheduled one; it cannot schedule one." The disposition is signed by the same
 * function, for the same reason, and was missing from the same array. A signature
 * is not a trigger.
 *
 * So this file asserts the general rule rather than one field: every piece of
 * state the persistence payload carries must be able to SCHEDULE a save, not
 * merely change its signature. That is the only form of the assertion that would
 * have caught the ledger, caught the disposition, and will catch the third one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

const STUDIO = read('components', 'design', 'DesignStudio.tsx');
const MODEL  = read('lib', 'design', 'siteDesignModel.ts');

/**
 * The dependency array of the autosave effect, as source text.
 *
 * 🚨 ANCHORED ON THE ARRAY'S OWN ENDS, NOT ON TWO ENTRIES BEING ADJACENT. A first
 * version anchored on the literal `site.deletionLedger, saveLayoutToDB]` — and the
 * very fix this file demands inserts a third entry between those two, so the
 * guard's anchor vanished the moment the code became correct. It failed with "the
 * dependency array moved" against exactly the source it was written to require.
 * An anchor that a correct change can destroy is not an anchor.
 */
function autosaveDeps(): string {
  const open = STUDIO.indexOf('}, [panels, roofPlanes, placedObstructions,');
  expect(open, 'the autosave dependency array moved — this guard is blind').toBeGreaterThan(-1);
  // 🚨 THE ARRAY IS LOCATED STRUCTURALLY, BY ITS OWN BRACKET.
  //
  // A second version anchored the end on the literal `saveLayoutToDB]`, because that
  // was the last member at the time. It then broke when `saveLayoutToDB` was
  // correctly REMOVED from the array — it is a `useCallback` over nine values, so
  // while it was a dependency the debounce restarted on its identity churning rather
  // than on the design changing, which could starve the save indefinitely. See
  // tests/autosaveCannotBeStarved.test.ts.
  //
  // So this is the SECOND time this helper's end anchor was a member name, and the
  // second time a correct change destroyed it. Anchoring on the closing bracket
  // cannot rot that way: the array ends where the array ends.
  const close = STUDIO.indexOf(']', open);
  expect(close, 'the dependency array is unterminated').toBeGreaterThan(open);
  return STUDIO.slice(open, close + 1);
}

describe('the disposition really is persisted — so a save is worth scheduling', () => {
  it('the persistence payload carries nativeGeometry', () => {
    // If it were not persisted, scheduling a save would be pointless and the fix
    // would be somewhere else entirely. This is the premise.
    expect(MODEL).toMatch(/nativeGeometry:\s*state\.nativeGeometry/);
  });

  it('and the archive signature covers it', () => {
    // Which is exactly why the bug was invisible: the signature changes, so once
    // a save happens it carries the new decision. Nothing makes one happen.
    expect(MODEL).toMatch(/nativeGeometry/);
  });
});

describe('🚨 a disposition-only change schedules a save', () => {
  it('🚨 the autosave effect depends on the disposition', () => {
    // 🚨 THE EXACT IDENTIFIER, WITH A BOUNDARY. A first version matched
    // `/site\.nativeDisposition/`, which also matches `site.nativeDispositionRef`
    // — and a REF is a dependency that can never fire, because its identity never
    // changes. So the guard accepted a version of the fix that fixes nothing, in
    // the same family as a regex that can never match.
    expect(autosaveDeps(),
      'a disposition-only change cannot schedule a save — the decision is lost on reload, and ' +
      'the next hydration may acquire over the model it was protecting')
      .toMatch(/site\.nativeDisposition(?![A-Za-z])/);
  });

  it('🚨 and it depends on the VALUE, never on a ref', () => {
    // A ref in a dependency array is stable for the component's whole life, so
    // the effect it is supposed to trigger never runs again. This is the shape
    // that escaped the case above.
    //
    // 🚨 THE WORD BOUNDARY IS A CHARACTER CLASS, NOT AN ESCAPE, AND THAT IS
    // DELIBERATE. This line shipped with a literal BACKSPACE byte (0x08) where
    // `\b` was meant — the regex was authored through a Python string, where a
    // lone backslash-b IS backspace. The matcher could then never match, so the
    // assertion was vacuously true: a guard against a dependency that can never
    // fire, which itself could never fire. `tests/sourceControlBytes.test.ts`
    // caught it, and it was the only control byte in 2,410 scanned files.
    // Spelling the boundary out removes the escape that can be mangled in
    // transit at all.
    expect(autosaveDeps(), 'the autosave depends on a ref, which can never change identity')
      .not.toMatch(/site\.[A-Za-z0-9_$]*Ref(?![A-Za-z0-9_$])/);
  });

  it('the ledger is still there too — this is an addition, not a swap', () => {
    // The ledger was the first instance of this bug. Losing it while fixing the
    // disposition would be the same defect moved.
    expect(autosaveDeps()).toMatch(/site\.deletionLedger/);
  });
});

describe('🚨 the general rule, which is what would have caught both', () => {
  it('every signed piece of shared state can also SCHEDULE a save', () => {
    // 🚨 THIS IS THE ASSERTION THAT GENERALISES. The two fields the persistence
    // payload carries that are NOT plain component state — the deletion ledger
    // and the native-geometry disposition — are exactly the two that were signed
    // without being depended on. A third such field added later would repeat it,
    // so both are required here by name and the list is stated as the rule it is.
    const deps = autosaveDeps();
    for (const field of ['site.deletionLedger', 'site.nativeDisposition']) {
      // Boundary-matched for the reason above: a `…Ref` suffix would satisfy a
      // substring check and could never fire.
      const re = new RegExp(field.replace('.', '\.') + '(?![A-Za-z])');
      expect(deps, `${field} is signed by archivesSignature but cannot schedule a save — ` +
        'a signature suppresses a redundant POST, it does not cause one')
        .toMatch(re);
    }
  });

  it('and the payload builder is the one place that decides what travels', () => {
    // So the list above can be checked against something real rather than
    // remembered. If `toPersistencePayload` grows a third non-component field,
    // this is where a reader finds it.
    expect(MODEL).toMatch(/function toPersistencePayload/);
    const i = MODEL.indexOf('function toPersistencePayload');
    const end = MODEL.indexOf('\n}', i);
    const body = MODEL.slice(i, end);
    expect(body).toMatch(/nativeGeometry/);
    expect(body).toMatch(/deletions/);
  });
});
