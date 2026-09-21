/**
 * tests/sourceControlBytes.test.ts
 *
 * NO CONTROL BYTES IN SOURCE.
 *
 * This guard exists because the same accident has now happened three times in
 * this workstream, always the same way: a regex written through a shell or a
 * script where `\b` is a BACKSPACE escape rather than a word boundary, so
 *
 *     /\bpanelPlaneKey\b/      the intent
 *     /<0x08>panelPlaneKey<0x08>/   what landed on disk
 *
 * It is invisible in a diff, invisible in an editor, invisible in review, and
 * `tsc` accepts it because a backspace is a legal character inside a regex
 * literal. It fails only at runtime, as a matcher that can never match — which
 * in a test is the worst possible failure mode: a guard that looks present and
 * protects nothing.
 *
 * The same trap covers the other C0 controls that shell and language escapes
 * produce by accident: \a (0x07), \f (0x0C), \v (0x0B), and a stray NUL.
 * TAB, LF and CR are excluded — they are ordinary whitespace here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SCAN_DIRS = ['app', 'components', 'lib', 'tests', 'e2e', 'scripts'];
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sql', '.md'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git', 'coverage']);

/** C0 controls that never belong in source, with TAB (9), LF (10) and CR (13)
 *  deliberately allowed. 0x08 is the one that has actually bitten. */
function offendingBytes(buf: Buffer): Array<{ byte: number; index: number }> {
  const out: Array<{ byte: number; index: number }> = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 0x20 || b === 0x7f) out.push({ byte: b, index: i });
  }
  return out;
}

function walk(dir: string, acc: string[]): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (EXTS.some(e => name.endsWith(e))) acc.push(full);
  }
  return acc;
}

describe('source files contain no stray control bytes', () => {
  it('finds none across app, components, lib, tests, e2e and scripts', () => {
    const files = SCAN_DIRS.flatMap(d => walk(join(ROOT, d), []));
    // The scan must actually have scanned something. A guard that silently
    // walks an empty tree is the same kind of lie it is here to catch.
    expect(files.length, 'the scan found no files to check').toBeGreaterThan(500);

    const hits: string[] = [];
    for (const f of files) {
      const found = offendingBytes(readFileSync(f));
      if (found.length === 0) continue;
      const shown = found.slice(0, 3)
        .map(h => `0x${h.byte.toString(16).padStart(2, '0')}@${h.index}`)
        .join(', ');
      hits.push(`${relative(ROOT, f)}: ${found.length} control byte(s) [${shown}]`);
    }

    expect(hits, `control bytes in source:\n  ${hits.join('\n  ')}`).toEqual([]);
  });

  it('detects the exact accident it was written for', () => {
    // A backspace where a word boundary was meant. If offendingBytes ever stops
    // reporting this, the scan above is decorative.
    // Built with fromCharCode rather than written literally, so THIS file does
    // not contain the very bytes it forbids — the scan above covers tests/ too.
    const BS = String.fromCharCode(8);
    const sample = Buffer.from(`.toMatch(/${BS}panelPlaneKey${BS}/)`, 'utf8');
    const found = offendingBytes(sample);
    expect(found.length).toBe(2);
    expect(found.every(h => h.byte === 0x08)).toBe(true);

    // And it does not cry wolf over ordinary source.
    expect(offendingBytes(Buffer.from('const a = /\\bword\\b/;\r\n\tconst b = 1;\n', 'utf8'))).toEqual([]);
  });
});
