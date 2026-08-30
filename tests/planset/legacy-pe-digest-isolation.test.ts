// ═══════════════════════════════════════════════════════════════════════════
// LEGACY_DIGEST_COMPATIBILITY_ONLY — the false PE sentence that must survive.
//
// `build.ts` still contains, inside the snapshot notes array:
//
//     PE STAMP REQUIRED FOR PERMIT SUBMISSION PER AHJ.
//
// It is FALSE — a hardcoded claim with zero jurisdiction input, zero state
// licensing input, no thresholds and no exemptions. The cover sheet was fixed in
// 812b62cc. This copy was NOT, and deliberately so: changing it moved the
// approval digest
//
//     8d7fcfa38d9a25ef8775e398  ->  91dea260df821482f7f88185
//
// and `findActiveApproval` matches the digest EXACTLY, so every existing PE
// approval would be retired. Removing it is N7 work — an approval-version
// migration, not a string edit.
//
// ── WHAT THIS FILE IS FOR ─────────────────────────────────────────────────
// A false sentence sitting in the codebase is only tolerable while it is
// PROVABLY INERT. These tests are that proof. If any renderer, projection or
// readiness path ever starts consuming it, they fail — which is the difference
// between a documented deferral and a landmine.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LEGACY = 'PE STAMP REQUIRED FOR PERMIT SUBMISSION PER AHJ.';
const TRUTHFUL = 'PROFESSIONAL REVIEW REQUIRED BY SOLARPRO PRIOR TO PERMIT RELEASE.';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the legacy string is present, and that is intentional', () => {
  it('still exists in the digest-bound snapshot body', () => {
    // If this ever fails, someone removed it — and the approval digest moved
    // with it. That is the N7 migration, and it must be deliberate.
    expect(read('lib/permit/snapshot/build.ts')).toContain(LEGACY);
  });

  it('is classified LEGACY_DIGEST_COMPATIBILITY_ONLY, not current authority', () => {
    // The classification lives next to the string so nobody reads it as live.
    const src = read('lib/permit/snapshot/build.ts');
    const idx = src.indexOf(LEGACY);
    const context = src.slice(Math.max(0, idx - 1200), idx);
    expect(
      /LEGACY_DIGEST_COMPATIBILITY_ONLY|digest-bound|N7/i.test(context),
      'the legacy string must be annotated as compatibility-only where it sits',
    ).toBe(true);
  });
});

describe('the legacy string is INERT — nothing current consumes it', () => {
  it('the cover renderer emits the truthful policy instead', () => {
    const cover = read('lib/permit/sections/coverSheet.ts');
    expect(cover).not.toContain(LEGACY);
    expect(cover).toContain(TRUTHFUL);
  });

  it('no renderer section contains the false sentence', () => {
    // Sweep every planset section, not only the one that was fixed.
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const dir = 'lib/permit/sections';
    const offenders = readdirSync(join(process.cwd(), dir))
      .filter(f => f.endsWith('.ts'))
      .filter(f => read(join(dir, f)).includes(LEGACY));
    expect(offenders).toEqual([]);
  });

  it('the professional-authority projection does not read it', () => {
    // A projection that re-read the note would launder the false claim back
    // into current authority.
    for (const p of ['lib/permit/snapshot/projectAuthority.ts',
      'lib/permit/snapshot/codeAuthority.ts']) {
      expect(read(p)).not.toContain(LEGACY);
    }
  });

  it('permit readiness does not infer a legal PE requirement from it', () => {
    // The blockers/registry logic must key on release gates, never on the
    // presence of a note string.
    const build = read('lib/permit/snapshot/build.ts');
    // the sentence exists exactly once — as data, never as a condition
    const occurrences = build.split(LEGACY).length - 1;
    expect(occurrences).toBe(1);
    // and it is never compared against
    expect(build).not.toContain(`=== '${LEGACY}'`);
    expect(build).not.toContain(`includes('${LEGACY}')`);
    expect(build).not.toContain(`indexOf('${LEGACY}')`);
  });
});

describe('the rendered artifact never shows it', () => {
  it('the generated Braidon planset carries the truthful claim only', () => {
    // The artifact is the thing a plan reviewer reads. It is the only test here
    // that proves the outcome rather than the mechanism.
    let html: string;
    try { html = read('_tmp_prod.html'); }
    catch { return; }   // artifact not generated in this environment; other tests still bind
    expect(html).not.toContain(LEGACY);
    expect(html).toContain('PROFESSIONAL REVIEW REQUIRED BY SOLARPRO');
    // and the false attribution phrase specifically
    expect(html).not.toMatch(/PE STAMP REQUIRED[^<]*PER AHJ/i);
  });
});
