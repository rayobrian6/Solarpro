/**
 * tests/studioAutosaveCarriesItsVersion.test.ts
 *
 * THE CONCURRENCY CONTROL WAS BUILT AND THE MAIN WRITER DID NOT USE IT.
 *
 * `upsertLayout` takes an optional `expectedUpdatedAt`: state the version your
 * edit was based on, and a save that would overwrite somebody else's work is
 * refused with `LAYOUT_STALE_WRITE` before anything is written. `/api/production`
 * forwards it. The design studio — the writer that actually produces the
 * conflicting saves, because it autosaves — did not, so two tabs on one design
 * were still last-write-wins through the route people use.
 *
 * 🚨 AND A HALF-WIRED VERSION TOKEN IS WORSE THAN NONE. Three pieces have to
 * line up or the studio wedges:
 *
 *   1. the route must forward `expectedUpdatedAt` to `upsertLayout`;
 *   2. the route must RETURN the version the row ended up with;
 *   3. the studio must record that returned version as its new token.
 *
 * Miss (2) or (3) and the first autosave succeeds, the studio keeps the token it
 * loaded with, and the SECOND autosave is refused as stale — by its own previous
 * save. The feature would then look like it was working, once, on every tab.
 *
 * This file pins all three, plus the two halves of the round trip: the token the
 * studio sends on a save, and the token it adopts from a hydrate.
 *
 * Source-scanning, because the wiring is what is being asserted — three literals
 * in two files that have to name each other — and the behaviour they enable is
 * already proven against real PostgreSQL in
 * `tests/layoutConcurrency.postgres.test.ts`.
 *
 * 🚨 READS COMMENT-STRIPPED SOURCE. The comments explaining this wiring
 * necessarily name every identifier it asserts, so a raw text search would match
 * the explanation and report the wiring as present when it is not. This suite
 * has been bitten by exactly that, repeatedly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

const ROUTE = read('app', 'api', 'projects', '[id]', 'layout', 'route.ts');
const STUDIO = read('components', 'design', 'DesignStudio.tsx');
const HOOK = read('components', 'design', 'useSiteDesign.ts');

describe('🚨 the route carries the precondition and reports the result', () => {
  it('it accepts a version token from the client', () => {
    expect(ROUTE, 'the layout route never reads expectedUpdatedAt off the body')
      .toMatch(/expectedUpdatedAt/);
  });

  it('and passes it into upsertLayout — where the claim actually happens', () => {
    // 🚨 PINS THE HANDOFF, NOT THE SPELLING. Merely mentioning the field
    // somewhere in the file proves nothing; it has to reach the call that
    // performs the conditional write.
    const i = ROUTE.indexOf('upsertLayout({');
    expect(i, 'the upsertLayout call moved — this guard is now blind').toBeGreaterThan(-1);
    const end = ROUTE.indexOf('});', i);
    expect(end).toBeGreaterThan(i);
    expect(ROUTE.slice(i, end), 'the token is read but never handed to the writer')
      .toMatch(/expectedUpdatedAt/);
  });

  it('🚨 and RETURNS the version the row ended up with', () => {
    // Without this the studio has nothing to adopt, and its second autosave is
    // refused by its own first one.
    const i = ROUTE.indexOf('return NextResponse.json({');
    expect(i).toBeGreaterThan(-1);
    expect(ROUTE.slice(i), 'the success response does not carry the new version')
      .toMatch(/updatedAt:\s*savedLayout\.updatedAt/);
  });

  it('the version it returns is the SAVED row\'s, not the request\'s', () => {
    // Echoing the token the client sent back at the client would be worse than
    // silence: every tab would believe it was current for ever.
    const i = ROUTE.indexOf('return NextResponse.json({');
    const body = ROUTE.slice(i);
    expect(body).not.toMatch(/updatedAt:\s*expectedUpdatedAt/);
  });
});

describe('🚨 the studio holds a version and sends it back', () => {
  it('the hook exposes both halves of the round trip', () => {
    expect(HOOK).toMatch(/storedVersion:/);
    expect(HOOK).toMatch(/noteSavedVersion:/);
  });

  it('the studio adopts the version it hydrated from', () => {
    expect(STUDIO, 'the loaded design does not bring its version with it')
      .toMatch(/updatedAt:\s*data\.data\?\.updatedAt/);
  });

  it('🚨 the autosave states the version it was based on', () => {
    // 🚨 ANCHORED TO THE AUTOSAVE'S OWN REQUEST. A first version of this just
    // searched the whole file, and deleting the token from the autosave left it
    // green — the unload beacon carries the same line, so the guard could not
    // tell the two writers apart and covered whichever one happened to survive.
    //
    // It was then anchored to the payload OBJECT, between `destructive:` and the
    // `[LAYOUT SAVE PAYLOAD]` log — and a correct change broke it. The token moved out
    // of that object deliberately: the object is built well before the request leaves
    // and is also what goes to localStorage, so a token stamped there was the version
    // as it stood at BUILD time, which is how this tab came to refuse its own writes.
    // The obligation is unchanged and the anchor now sits on the construct that
    // actually carries it — the POST itself, which no other writer in this file
    // shares: the beacon uses `navigator.sendBeacon` and the restore is a bare GET.
    const i = STUDIO.indexOf('fetch(`/api/projects/${project.id}/layout`, {');
    expect(i, 'the autosave POST moved — this guard is now blind').toBeGreaterThan(-1);
    const end = STUDIO.indexOf('});', i);
    expect(end, 'could not find the end of the autosave request').toBeGreaterThan(i);
    expect(STUDIO.slice(i, end), 'the studio still autosaves without saying what it was editing')
      .toMatch(/expectedUpdatedAt:\s*site\.storedVersion\(\)/);
  });

  it('🚨 and reads that token INSIDE the queued turn, not before joining the queue', () => {
    // 🚨 THIS IS THE WHOLE MECHANISM. Three paths in the studio write the one layouts
    // row — the autosave, Calculate Production and the Save button — and sending two of
    // them inside one round trip made them state the SAME version, so the server
    // granted the first and refused the second as "saved somewhere else" with nothing
    // else open. Queueing them fixes it only if each reads `storedVersion()` in its own
    // turn; a token read before joining the queue is the same stale token, sent later.
    //
    // So: every `expectedUpdatedAt: site.storedVersion()` in this file must sit after
    // an `enqueueLayoutWrite(` — except the unload beacon's, which cannot queue at all
    // (`navigator.sendBeacon` is fire-and-forget at page death) and is documented as a
    // deliberate trade-off at its call site.
    //
    // The behaviour itself is proven, mutation-tested, in tests/layoutWriteQueue.test.ts;
    // this case is what notices a writer being added or unwrapped here.
    const beacon = STUDIO.indexOf('navigator.sendBeacon(');
    expect(beacon, 'the beacon is gone — if that is deliberate, revisit this case')
      .toBeGreaterThan(-1);
    const beaconPayload = STUDIO.lastIndexOf('const payload = JSON.stringify({', beacon);

    // 🚨 BOTH SPELLINGS. The autosave and the Save button set the token as an object
    // property (`expectedUpdatedAt: …`), Calculate Production assigns it onto a body it
    // built earlier (`body.expectedUpdatedAt = …`). A needle matching only the property
    // form silently exempted a whole writer — which is the failure this file's header
    // is about.
    const tokens: number[] = [];
    const re = /expectedUpdatedAt(?::|\s*=)\s*site\.storedVersion\(\)/g;
    for (let m = re.exec(STUDIO); m; m = re.exec(STUDIO)) {
      // Skip the beacon's, which is between its payload and the sendBeacon call.
      if (m.index > beaconPayload && m.index < beacon) continue;
      tokens.push(m.index);
    }
    expect(tokens.length, 'fewer queued writers state a version than the three that write this row')
      .toBeGreaterThanOrEqual(3);

    for (const at of tokens) {
      const queued = STUDIO.lastIndexOf('enqueueLayoutWrite(', at);
      expect(queued, `a layout writer at ${at} reads its version outside the write queue`)
        .toBeGreaterThan(-1);
      // 🚨 AND IT IS STILL INSIDE THAT TURN. `lastIndexOf` alone would be satisfied by a
      // token read anywhere AFTER some earlier queued block had already closed, which is
      // exactly the hoisted-token bug wearing the right prefix. Brace depth answers it
      // without depending on indentation: leaving the callback means the depth opened at
      // `enqueueLayoutWrite(` has returned to zero. Comments are already stripped, and
      // the braces inside `${…}` in a template literal balance out.
      let depth = 0;
      let closed = false;
      for (const ch of STUDIO.slice(queued, at)) {
        if (ch === '{' || ch === '(') depth += 1;
        else if (ch === '}' || ch === ')') {
          depth -= 1;
          if (depth <= 0) { closed = true; break; }
        }
      }
      expect(closed, `the queued turn closes before the version read at ${at} — the token is hoisted out of it`)
        .toBe(false);
    }
  });

  it('🚨 and so does the unload beacon — the one write with no UI to refuse into', () => {
    // Leaving the beacon tokenless would make closing a tab the single path that
    // silently overwrites another tab's whole design, on the write nobody can
    // see. The trade-off is documented at the call site: a stale beacon loses
    // this tab's last few seconds, which the autosave has almost always already
    // persisted.
    const i = STUDIO.indexOf('navigator.sendBeacon(');
    expect(i, 'the unload beacon is gone — if that is deliberate, delete this case')
      .toBeGreaterThan(-1);
    const start = STUDIO.lastIndexOf('const payload = JSON.stringify({', i);
    expect(start).toBeGreaterThan(-1);
    expect(STUDIO.slice(start, i), 'the beacon saves without stating its version')
      .toMatch(/expectedUpdatedAt:\s*site\.storedVersion\(\)/);
  });

  it('every layout writer in this file states a version — none left behind', () => {
    // The count, so a THIRD writer added later cannot quietly skip it. Both
    // known writers are asserted individually above; this is what notices a new
    // one.
    const writers = (STUDIO.match(/\/api\/projects\/\$\{project\.id\}\/layout/g) ?? []).length;
    const tokens = (STUDIO.match(/expectedUpdatedAt:\s*site\.storedVersion\(\)/g) ?? []).length;
    // One of the three matches is the GET that reads the layout back, which
    // sends nothing.
    expect(tokens, `${writers} layout endpoints referenced but only ${tokens} state a version`)
      .toBeGreaterThanOrEqual(writers - 1);
  });

  it('🚨 and adopts the new version on success — or the next save is refused', () => {
    expect(STUDIO, 'nothing records the version the save produced')
      .toMatch(/noteSavedVersion\(/);
  });

  it('the token it sends comes from the hook, never from a local variable', () => {
    // A studio-local copy is how the two drift apart: the hook updates on
    // hydrate and on save, and anything keeping its own shadow of it will
    // eventually send a version the row has not had for a while.
    const i = STUDIO.indexOf('expectedUpdatedAt:');
    expect(i).toBeGreaterThan(-1);
    const line = STUDIO.slice(i, STUDIO.indexOf('\n', i));
    expect(line).toMatch(/site\.storedVersion\(\)/);
  });
});

describe('the refusal reaches the operator rather than being swallowed', () => {
  it('LAYOUT_STALE_WRITE is a recognised refusal, not a database error', () => {
    const core = read('lib', 'db', 'core.ts');
    expect(core).toMatch(/'LAYOUT_STALE_WRITE'/);
  });

  it('the studio already has a 409 branch for it to land in', () => {
    expect(STUDIO).toMatch(/409/);
  });
});
