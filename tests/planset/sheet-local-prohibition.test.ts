// W2.1 acceptance — sheet-local electrical calculations and literal fallbacks
// remain PROHIBITED in the live projection paths. Source-level gate: the
// converted projection functions must not re-acquire engineering math or
// literal specs. (The retired dead code — buildSLD body awaiting the W4
// deletion sweep — is explicitly out of the live path: E-1 throws before it
// and this gate pins the LIVE functions.)
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

/** Extract a top-level function's source by name (brace-balanced). */
function fnSource(file: string, name: string): string {
  const src = read(file);
  const at = src.indexOf(`function ${name}(`);
  expect(at, `${name} present in ${file}`).toBeGreaterThan(-1);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(at, i + 1);
}

describe('W2.1 — sheet-local electrical calculation prohibition (live paths)', () => {
  it('resolveInterconnection performs no OCPD rounding, no 120% decision, no literal fallbacks', () => {
    const s = fnSource('lib/permit/sections/electricalPages.ts', 'resolveInterconnection');
    expect(s).not.toMatch(/necNextStandardOcpd\s*\(/);
    expect(s).not.toMatch(/\|\|\s*200\b/);
    expect(s).not.toMatch(/\?\?\s*(200|40|60)\b/);
    expect(s).not.toMatch(/isSupplySideInterconnection\s*\(/);   // method comes from the snapshot
    expect(s).toContain('getSnapshot(input)');
  });

  it('the cover has no local 120%/backfeed math', () => {
    const s = read('lib/permit/sections/coverSheet.ts');
    expect(s).not.toMatch(/backfeedBreakerA\s*\?\?\s*project\.pvBackfeedA/);
    expect(s).not.toMatch(/necNextStandardOcpd\(acKw/);
  });

  it('E-1 has no stored-SVG or inline-fallback SLD tiers in the live path', () => {
    const s = read('lib/permit/sections/electricalPages.ts');
    expect(s).toContain('fail closed (no stored/inline fallback renders');
    expect(s).not.toMatch(/sldBodyHtml\s*=[^;]*storedSldSvg/);
    expect(s).not.toMatch(/const svgContent = buildSLD\(\)/);
  });

  it('the fabricated NEC 220.82 dwelling-load calc stays dead', () => {
    const s = read('lib/permit/sections/electricalPages.ts');
    expect(s).not.toMatch(/220\.82\(B\)\(1\)/);
    expect(s).not.toMatch(/sqft\s*=\s*mainA\s*>=\s*200/);
  });

  it('generatePermit seeds no 690.8 backfeed estimates (fail-closed engine)', () => {
    const s = read('lib/permit/generatePermit.ts');
    expect(s).not.toMatch(/690\.8 estimate.*seeded/);
    expect(s).toContain('fail closed (W2.1: no legacy fallback, no estimates)');
  });
});
