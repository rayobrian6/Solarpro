/**
 * tests/productionWriteDoesNotStealTheToken.test.ts
 *
 * A HAND-PLACED CHIMNEY WAS SILENTLY DISCARDED, BY A SECOND WRITER TO THE SAME ROW.
 *
 * 🚨 FOUND IN A REAL BROWSER, against real PostgreSQL, by
 * `e2e/obstruction-survives-reload.spec.ts` — the owed step 3 of Ray's obstruction
 * fixture. The refusal the operator got, verbatim from the trace:
 *
 *   LAYOUT_STALE_WRITE: this design was saved somewhere else — another tab,
 *   another device, or an older copy of this page — while you had it open.
 *
 * Nothing was open anywhere else. THE SERVER DID IT.
 *
 * `POST /api/production` writes the same single `layouts` row that the studio's
 * autosave writes, and a BEFORE UPDATE trigger re-stamps `updated_at` on every
 * write. The route accepts `expectedUpdatedAt` and returns the saved layout — but
 * the studio never adopted the version that came back. So the sequence was:
 *
 *   1. the studio saves the design (row version A);
 *   2. Calculate / Save posts to /api/production, which writes the row → version B;
 *   3. the studio's next autosave — the one carrying the chimney — still states
 *      version A, and is correctly refused as stale.
 *
 * The write that WINS is the one from /api/production, which says nothing about
 * obstructions; the write that is REFUSED is the one carrying the hand-placed
 * object. So the operator places a chimney, watches the modules clear on screen,
 * and the row keeps the pruned array with no chimney in it. The design reopens
 * with a hole nothing explains — or gets refilled over a flue by the next Auto
 * Layout. That is failure mode 3 in that spec's own header, the one it calls the
 * dangerous one, and it was live.
 *
 * 🚨 THE VERSION TOKEN DID NOT CAUSE THIS — IT REVEALED IT. Before the token
 * existed, /api/production's write simply won and the chimney-carrying save
 * silently overwrote it or was overwritten, depending on order. The refusal is
 * the concurrency control working exactly as designed and telling the truth; what
 * was missing is that a tab has to learn the version its OWN request produced.
 *
 * THE RULE THIS PINS, which the layout route already follows and states in its own
 * comments: any endpoint that writes the layouts row must return the resulting
 * version, and every caller must adopt it. A half-wired token is worse than none,
 * because the first write succeeds and the second is refused by the first.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

const STUDIO = read('components', 'design', 'DesignStudio.tsx');
const PROD   = read('app', 'api', 'production', 'route.ts');

/** Every place the studio posts to /api/production. */
function productionCallSites(src: string): number[] {
  const out: number[] = [];
  const needle = "fetch('/api/production'";
  let i = src.indexOf(needle);
  while (i !== -1) { out.push(i); i = src.indexOf(needle, i + 1); }
  return out;
}

describe('🚨 the production route is a layout writer, and says so', () => {
  it('it writes the layouts row — that is why this file exists', () => {
    expect(PROD).toMatch(/upsertLayout\(/);
  });

  it('it accepts the precondition', () => {
    expect(PROD, 'the production route cannot state which version it was based on')
      .toMatch(/expectedUpdatedAt/);
  });

  it('and returns the saved layout, which carries the resulting version', () => {
    // The route hands back `savedLayout`, whose `updatedAt` is the value actually
    // on disk after every statement in the save — `withCurrentVersion` in
    // lib/db/projects.ts exists to make that true, because one logical save
    // issues several UPDATEs and the trigger re-stamps the row on each.
    expect(PROD).toMatch(/data:\s*\{\s*layout:\s*savedLayout/);
  });
});

describe('🚨 and EVERY studio caller adopts the version it produced', () => {
  it('there are exactly the call sites this guard knows about', () => {
    // A third caller added later, not adopting the version, reintroduces the
    // defect — so the count is asserted rather than assumed.
    const sites = productionCallSites(STUDIO);
    expect(sites.length, 'the number of /api/production callers changed — check each one adopts the version')
      .toBe(2);
  });

  it('🚨 each one calls noteSavedVersion with the layout the route returned', () => {
    // 🚨 SCOPED TO EACH CALL SITE INDIVIDUALLY. A whole-file search for
    // `noteSavedVersion(` is satisfied by the autosave's own call and by the
    // version-history restore — this exact blind spot has bitten two guards in
    // this campaign, once where a second writer lost its token and once where a
    // restore handler did. Each site is checked in its own window.
    const sites = productionCallSites(STUDIO);
    for (const [n, at] of sites.entries()) {
      // From the fetch to the end of its success branch: `setCostEstimate` is
      // present in both branches and sits after the point the version must be
      // adopted, so it is a real end token rather than a fixed length.
      const end = STUDIO.indexOf('setCostEstimate(', at);
      expect(end, `call site ${n + 1} has no success branch — re-find it`).toBeGreaterThan(at);
      const window = STUDIO.slice(at, end + 200);
      expect(window,
        `/api/production call site ${n + 1} does not adopt the version its own write produced — ` +
        'the next autosave from this tab will be refused as somebody else\'s')
        .toMatch(/noteSavedVersion\(/);
      expect(window, `call site ${n + 1} adopts something other than the returned layout's version`)
        .toMatch(/data\.data\??\.?layout\?*\.?updatedAt|layout\?\.updatedAt/);
    }
  });

  it('🚨 and each one STATES the version it was based on', () => {
    // 🚨 THE OTHER HALF, AND IT IS NOT THE SAME HALF. Adopting the version a write
    // returns fixes a tab conflicting with ITSELF. It does nothing about a tab
    // conflicting with somebody else: this route writes the layouts row, and without
    // a precondition that write is unconditional, so a genuine two-tab collision on
    // the Calculate or Save path is still last-write-wins — the exact behaviour the
    // autosave path was fixed to stop.
    // 🚨 EACH WINDOW IS BOUNDED BY ITS OWN ENCLOSING FUNCTION, and that took two
    // attempts. A first version started the window at the nearest preceding
    // `const body` — but the Save path builds its request inline inside
    // `JSON.stringify({…})`, so there is no `const body` near it and the search ran
    // all the way back to the CALCULATE path's. Site 2's window then contained site
    // 1's token, and deleting the Save path's precondition stayed green.
    //
    // That is the two-writers blind spot, inside the guard written about the
    // two-writers blind spot. Anchoring on the enclosing declaration makes each
    // window structurally incapable of reaching into a sibling.
    const sites = productionCallSites(STUDIO);
    for (const [n, at] of sites.entries()) {
      const end = STUDIO.indexOf('setCostEstimate(', at);
      expect(end, `call site ${n + 1} has no success branch`).toBeGreaterThan(at);
      const fnStart = STUDIO.lastIndexOf('\n  const ', at);
      expect(fnStart, `call site ${n + 1} has no enclosing declaration`).toBeGreaterThan(-1);
      const window = STUDIO.slice(fnStart, end);

      // The bound is real: this window must NOT contain the other call site.
      const others = sites.filter(s => s !== at);
      for (const o of others) {
        expect(o >= fnStart && o < end,
          `call site ${n + 1}'s window swallows another call site — it can be satisfied by a sibling`)
          .toBe(false);
      }

      expect(window,
        `/api/production call site ${n + 1} writes the layouts row without saying which ` +
        'version it was based on — a second tab silently loses')
        .toMatch(/expectedUpdatedAt/);
    }
  });

  it('🚨 the route hands the precondition to the writer on BOTH paths', () => {
    // 🚨 TWO WRITE PATHS, AND A TOP-LEVEL FIELD REACHES ONLY ONE OF THEM. The
    // no-client path is a wholesale spread — `{...rawLayout, projectId, userId}` —
    // so a token at the top level of the body never arrives there. Wiring only the
    // field-by-field path would be a precondition that silently does not apply to
    // projects without a client, which is worse than none because the refusal code
    // would be in the registry and the guard would be off.
    const calls = [...PROD.matchAll(/upsertLayout\(\{/g)].map(m => m.index ?? -1);
    expect(calls.length, 'the production route no longer has two upsertLayout calls')
      .toBeGreaterThanOrEqual(2);
    for (const [n, at] of calls.entries()) {
      const end = PROD.indexOf('});', at);
      expect(end, `upsertLayout call ${n + 1} is unterminated`).toBeGreaterThan(at);
      expect(PROD.slice(at, end),
        `upsertLayout call ${n + 1} in the production route receives no precondition`)
        .toMatch(/expectedUpdatedAt/);
    }
  });

  it('and a refusal from it reaches the operator', () => {
    // Both callers are explicit user actions with a toast, so the server's own
    // sentence is the right thing to show — it names the stored panel count, both
    // timestamps, and says nothing was written.
    const sites = productionCallSites(STUDIO);
    for (const [n, at] of sites.entries()) {
      const window = STUDIO.slice(at, at + 4000);
      expect(window, `call site ${n + 1} swallows the server's message on failure`)
        .toMatch(/data\.error/);
    }
  });

  it('it adopts the RETURNED version, never the one it sent', () => {
    // Echoing the request's own token back into the tab would be worse than
    // silence: every save would believe it was current for ever, and the guard
    // would be off while appearing to be on.
    const sites = productionCallSites(STUDIO);
    for (const at of sites) {
      const end = STUDIO.indexOf('setCostEstimate(', at);
      const window = STUDIO.slice(at, end + 200);
      expect(window).not.toMatch(/noteSavedVersion\(\s*site\.storedVersion\(\)/);
    }
  });
});
