/**
 * tests/layoutWriteIdentity.test.ts
 *
 * A REQUEST BODY MUST NOT BE ABLE TO CHOOSE WHOSE ROW IT WRITES.
 *
 * `upsertLayout` writes `WHERE project_id = … AND user_id = …` with whatever it
 * is handed. It is not an authorisation boundary and does not pretend to be:
 * the route authorises, by calling `getProjectById(projectId, user.id)` first,
 * and must then pass **that** identity through.
 *
 * 🚨 `app/api/production` DID NOT.
 *
 *     upsertLayout({ projectId, userId: user.id, ...rawLayout })
 *
 * `rawLayout` is `body.layout` verbatim on the legacy path, and the spread is
 * LAST — so a request carrying `layout.projectId` or `layout.userId` replaced
 * both, and the row that got written was not the row that was authorised. The
 * ownership check ran, passed, and was then overwritten by the thing it was
 * checking.
 *
 * This is a source-level assertion because the property it defends is a
 * property of the CALL SITE — the order of keys in one object literal — and
 * survives no matter how the handler is exercised. It discovers the call sites
 * rather than listing them, for the same reason
 * `tests/layoutEngineRoutingIsComplete.test.ts` does: the site that gets it
 * wrong is by definition the one nobody wrote a test for.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

type Call = { rel: string; index: number; args: string };

/** Every `upsertLayout({ … })` argument literal, with braces balanced. */
function upsertCalls(): Call[] {
  const out: Call[] = [];
  for (const file of walk(join(ROOT, 'app', 'api'))) {
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    const re = /upsertLayout\s*\(\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      // Walk from the opening brace to its match, so a nested object cannot
      // truncate the slice and hide the key we are looking for.
      let depth = 0, i = m.index + m[0].length - 1, end = -1;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) continue;
      out.push({ rel, index: m.index, args: src.slice(m.index + m[0].length - 1, end + 1) });
    }
  }
  return out;
}

/** Strip comments so prose about a spread cannot fail (or pass) the scan. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('the layout row a request writes is the one the route authorised', () => {
  const calls = upsertCalls();

  it('the discovery found the call sites — this test is not vacuous', () => {
    expect(calls.length, 'no upsertLayout({...}) call was found under app/api')
      .toBeGreaterThanOrEqual(4);
    const rels = new Set(calls.map(c => c.rel));
    expect([...rels], 'the Design Studio Save button posts to /api/production')
      .toContain('app/api/production/route.ts');
  });

  it('🚨 every call names projectId and userId AFTER any spread of client data', () => {
    const bad: string[] = [];
    for (const c of calls) {
      const src = code(c.args);
      const lastSpread = src.lastIndexOf('...');
      if (lastSpread < 0) continue;              // nothing spread: nothing to override
      const pid = src.lastIndexOf('projectId');
      const uid = src.lastIndexOf('userId');
      if (pid < 0 || uid < 0) {
        bad.push(`${c.rel}: spreads client data but never states projectId/userId`);
        continue;
      }
      if (pid < lastSpread || uid < lastSpread) {
        bad.push(`${c.rel}: a spread at ${lastSpread} comes after projectId(${pid})/userId(${uid}) — ` +
                 'the body can replace the authenticated identity');
      }
    }
    expect(bad,
      'these calls let the request body choose which project and user row is written, ' +
      'after the route has already authorised a different one',
    ).toEqual([]);
  });

  it('every call states an identity at all', () => {
    // A call that inherits projectId/userId only from a spread is the same
    // defect with no literal to look at.
    for (const c of calls) {
      const src = code(c.args);
      expect(/\bprojectId\b/.test(src), `${c.rel}: upsertLayout call states no projectId`).toBe(true);
      expect(/\buserId\b/.test(src), `${c.rel}: upsertLayout call states no userId`).toBe(true);
    }
  });
});
