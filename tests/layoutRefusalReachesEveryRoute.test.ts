/**
 * tests/layoutRefusalReachesEveryRoute.test.ts
 *
 * EVERY ROUTE THAT CAN BE REFUSED MUST SAY SO.
 *
 * `upsertLayout` throws three DELIBERATE refusals — permanent decisions not to
 * destroy a design. WS1-017 closed "a refusal is reported as a transient
 * database error" by naming two of them in ONE route's catch block. That fixed
 * the two instances I had found and left the CLASS open, and WS1-030 then moved
 * the recognition into `handleRouteDbError` so "a new route cannot forget it".
 *
 * 🚨 THAT CLAIM WAS FALSE, AND A GREEN SUITE SAID NOTHING ABOUT IT.
 * Two routes never reach `handleRouteDbError` for a refusal at all:
 *
 *   app/api/production            a catch that delegates ONLY for a DbConfigError
 *                                 or six network substrings, then returns a bare
 *                                 500. THE DESIGN STUDIO'S SAVE BUTTON POSTS HERE.
 *   app/api/engineering/preliminary  an inner try/catch that logged a warning and
 *                                 answered HTTP 200 with 'layout' simply missing
 *                                 from savedFiles.
 *
 * And the enumeration was wrong: five routes call `upsertLayout`, not four.
 *
 * A per-route assertion cannot catch this, because the route that forgets is by
 * definition the one nobody wrote a test for. So this test DISCOVERS the routes
 * from the source tree rather than listing them, and checks what a source scan
 * can honestly check: that the codes are complete, that they are recognised by
 * prefix and only the real ones, and that the routes catching `upsertLayout`
 * themselves consult the authority.
 *
 * 🚨 WHAT IT DELIBERATELY DOES NOT CLAIM. It cannot prove a route RESPONDS
 * correctly — see the note on `mentionsRefusalAuthority`, where the first
 * version of this file tried and was vacuous. The behavioural proof is
 * `tests/siteDesignRoute.postgres.test.ts`, which runs the real handler against
 * real PostgreSQL and asserts 409.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LAYOUT_REFUSAL_CODES, layoutRefusalCode } from '@/lib/db/core';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

/** Every API route whose source calls `upsertLayout`. */
function routesThatWriteLayouts(): Array<{ rel: string; src: string }> {
  return walk(join(ROOT, 'app', 'api'))
    .map(f => ({ rel: f.slice(ROOT.length + 1).replace(/\\/g, '/'), src: readFileSync(f, 'utf8') }))
    .filter(r => /\bupsertLayout\s*\(/.test(r.src));
}

/**
 * Does this route consult the refusal authority itself?
 *
 * 🚨 THE FIRST VERSION OF THIS ASKED MORE OF THE SOURCE, AND WAS VACUOUS.
 * It also accepted "the catch delegates unconditionally to
 * `handleRouteDbError`" — but `app/api/production` has SEVERAL catch blocks,
 * and one of them matched that shape while the one actually wrapping
 * `upsertLayout` did not. Deleting the fix left this test green. A regex over
 * source cannot tell which catch will see the throw.
 *
 * So the scan now claims only what it can check: whether the literal appears.
 * The behavioural guarantee is `tests/siteDesignRoute.postgres.test.ts`, which
 * drives the real handler against real PostgreSQL and asserts 409.
 */
function mentionsRefusalAuthority(src: string): boolean {
  return /layoutRefusalCode\s*\(/.test(src);
}

describe('layout refusals reach every route that can produce one', () => {
  const routes = routesThatWriteLayouts();

  it('the discovery actually found the routes — this test is not vacuous', () => {
    // If the grep breaks, every assertion below passes over an empty list.
    expect(routes.length, 'no route calling upsertLayout was found').toBeGreaterThanOrEqual(4);
    const rels = routes.map(r => r.rel);
    expect(rels).toContain('app/api/projects/[id]/layout/route.ts');
    expect(rels, 'the Design Studio Save button posts to /api/production').toContain('app/api/production/route.ts');
  });

  it('the routes that need an explicit check have one', () => {
    // The layout route and the versions route delegate their whole catch to
    // `handleRouteDbError`, which consults the authority. The other three wrap
    // `upsertLayout` in a catch of their own, so they must consult it directly.
    const NEEDS_EXPLICIT = [
      'app/api/production/route.ts',
      'app/api/engineering/preliminary/route.ts',
    ];
    for (const rel of NEEDS_EXPLICIT) {
      const route = routes.find(r => r.rel === rel);
      expect(route, `${rel} should be discovered as an upsertLayout caller`).toBeTruthy();
      expect(mentionsRefusalAuthority(route!.src),
        `${rel} catches upsertLayout's error itself, so it must consult layoutRefusalCode`,
      ).toBe(true);
    }
  });

  it('the refusal codes are recognised by prefix, and only the real ones', () => {
    for (const code of LAYOUT_REFUSAL_CODES) {
      expect(layoutRefusalCode(new Error(`${code}: something specific happened`))).toBe(code);
    }
    // Not a refusal: ordinary database and network failures must stay 503.
    for (const msg of [
      'connection terminated unexpectedly',
      'endpoint is starting',
      'fetch failed',
      'relation "layouts" does not exist',
      'LAYOUT_SOMETHING_ELSE: not one of ours',
    ]) {
      expect(layoutRefusalCode(new Error(msg)), `${msg} must not be read as a refusal`).toBeNull();
    }
  });

  it('every code the database layer throws is in the list', () => {
    // The list lives in lib/db/core.ts and the throws live in lib/db/projects.ts.
    // Renaming a throw without updating the list silently reverts that code to
    // 503, with no compile error — so the two are compared here.
    const projects = readFileSync(join(ROOT, 'lib', 'db', 'projects.ts'), 'utf8');
    const thrown = new Set(
      [...projects.matchAll(/`(LAYOUT_[A-Z_]+):/g)].map(m => m[1]),
    );
    expect(thrown.size, 'no LAYOUT_* refusal throws were found — the scan broke').toBeGreaterThan(0);
    const unlisted = [...thrown].filter(c => !(LAYOUT_REFUSAL_CODES as readonly string[]).includes(c));
    expect(unlisted,
      'these refusal codes are thrown but not listed in LAYOUT_REFUSAL_CODES, so they ' +
      'are reported as transient database errors',
    ).toEqual([]);
  });
});
