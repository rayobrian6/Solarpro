/**
 * tests/rawServerErrorsNeverReachTheUser.test.ts
 *
 * THE INSTALLER WAS SHOWN 200 CHARACTERS OF SOMEBODY ELSE'S INTERNALS.
 *
 * Two call sites did `toast.error(... ${errText.slice(0, 200)})` with the
 * response body verbatim. When the server sends a deliberate message that is
 * fine — it was written for the user. When it sends an HTML error page, a stack
 * frame, or a database driver's complaint, the installer gets a fragment of a
 * crash and no idea what to do about their permit package.
 *
 * A competitor-failure audit catalogued exactly this in rival products — one
 * shows users a literal Python `TypeError` — and then found the same shape in
 * ours. It is small and it does disproportionate damage: a person who sees a
 * stack trace stops believing the rest of the screen.
 *
 * 🚨 NOTHING IS DISCARDED. The raw body is returned separately and written to
 * the decision log, so diagnosis still works — it just does not happen in a
 * toast. A sanitiser that threw the detail away would trade one defect for a
 * worse one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { userFacingServerError } from '../lib/http/userFacingError';

const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app', 'engineering', 'page.tsx'), 'utf8'));

describe('🚨 internals are withheld', () => {
  const internals: Array<[string, string]> = [
    ['an HTML error page', '<!DOCTYPE html><html><head><title>500</title></head><body>Internal Server Error</body></html>'],
    ['a stack frame', 'Error: boom\n    at handler (/var/task/route.js:118:23)\n    at process (node:internal/x:9:1)'],
    ['a driver complaint', 'error: relation "layouts" does not exist'],
    ['a leaked query', 'SELECT id, user_id FROM projects WHERE deleted_at IS NULL'],
    ['a foreign runtime', 'Traceback (most recent call last):\n  TypeError: NoneType'],
    ['an empty body', ''],
  ];

  for (const [label, body] of internals) {
    it(`${label} is never shown`, () => {
      const r = userFacingServerError(500, body, 'Permit generation');
      expect(r.fromServer).toBe(false);
      expect(r.message, `${label} leaked into the user-facing message`)
        .not.toContain(body.slice(0, 30).trim() || '\u0000');
      // The message is still a complete, actionable sentence.
      expect(r.message).toMatch(/^Permit generation failed \(500\)\./);
      expect(r.message.length).toBeGreaterThan(30);
    });
  }

  it('🚨 but the detail is KEPT, so the failure is still diagnosable', () => {
    const body = 'Error: boom\n    at handler (/var/task/route.js:118:23)';
    const r = userFacingServerError(500, body, 'Permit generation');
    expect(r.detail, 'the raw body was discarded — diagnosis is now impossible').toBe(body);
  });
});

describe('a message the server CHOSE is shown', () => {
  it('a deliberate JSON error reaches the user', () => {
    const r = userFacingServerError(422, JSON.stringify({ error: 'Roof pitch must be between 5 and 60 degrees.' }), 'Permit generation');
    expect(r.fromServer).toBe(true);
    expect(r.message).toContain('Roof pitch must be between 5 and 60 degrees.');
  });

  it('…unless that field is itself a forwarded internal error', () => {
    // A route that pipes a driver error straight into `error` is common, and
    // the JSON wrapper does not make it fit to read.
    const r = userFacingServerError(500, JSON.stringify({ error: 'error: relation "layouts" does not exist' }), 'Save');
    expect(r.fromServer).toBe(false);
    expect(r.message).not.toContain('relation');
  });

  it('and an absurdly long "message" is treated as a dump', () => {
    const r = userFacingServerError(500, JSON.stringify({ error: 'x'.repeat(400) }), 'Save');
    expect(r.fromServer).toBe(false);
  });
});

describe('the status sentence tells the user what to DO', () => {
  const cases: Array<[number, RegExp]> = [
    [0,   /connection/i],
    [401, /sign in/i],
    [403, /permission/i],
    [404, /not found/i],
    [409, /reload/i],
    [429, /wait/i],
    [500, /nothing was changed/i],
  ];
  for (const [status, re] of cases) {
    it(`${status} suggests an action`, () => {
      expect(userFacingServerError(status, '', 'Save').message).toMatch(re);
    });
  }
});

describe('🚨 the engineering page uses it on every raw-body path', () => {
  it('no raw response body is pasted into a toast any more', () => {
    // The exact shape of the defect: slicing the body straight into the message.
    expect(PAGE, 'a raw response body is being shown to the user again')
      .not.toMatch(/errText\.slice\(/);
  });

  it('both permit paths route through the sanitiser', () => {
    const n = (PAGE.match(/userFacingServerError\(res\.status, errText,/g) || []).length;
    expect(n, `${n} of the 2 permit paths sanitise their error`).toBe(2);
  });

  it('and both still log the detail', () => {
    const n = (PAGE.match(/ui\.detail\.slice\(0, 500\)/g) || []).length;
    expect(n, 'the raw detail is no longer being logged — the failure became undiagnosable').toBe(2);
  });
});
