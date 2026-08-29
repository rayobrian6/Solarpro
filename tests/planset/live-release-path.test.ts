// ═══════════════════════════════════════════════════════════════════════════
// THE LIVE RELEASE PATH (2026-08-29)
//
// Two defects, both of which made a release gate UNCLOSEABLE from the running
// application while every unit test passed.
//
// ── 1. THE EXPOSURE CATEGORY NEVER LEFT THE BROWSER ───────────────────────
// RG-3 (ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED) is not a retrieval failure:
// the ASCE 7 hazard retrieval succeeds and returns wind, ground snow, seismic
// and elevation. It fails on exactly one thing — the §26.7 exposure category,
// a designer determination of upwind surface roughness that no dataset can
// supply. `jurisdictionResolvers` reads it off `project.windExposure`.
//
// A "Wind Exposure Category" select has existed on the engineering page for a
// long time and persists into `projects.engineering_config`. But NEITHER
// `permitInput.project` literal included the field, so the resolver saw
// `undefined` on every real generate and the gate could not clear no matter
// what the designer picked. That is invisible to a unit test that builds its
// own input — the break is in the object literal that constructs the payload,
// so this file asserts against the SOURCE of that literal.
//
// The value is also UNSTATED by default now. It used to default to 'C';
// threading a laundered default would have cleared an ASCE 7 gate by accident
// rather than by statement, which is worse than the blocker.
//
// ── 2. THE REVIEW RECORD POINTED AT A SCREEN NOBODY BUILT ─────────────────
// RS-1 (REVIEW STATUS) is the only enumeration of the open requirements — each
// with its authority path, explanation, resolution action, responsible role and
// evidence. It was dropped from every COMPACT profile, and the application only
// ever generates one profile: design-review. So a designer read
// "4 UNRESOLVED REQUIREMENTS ... SEE THE PROJECT REVIEW RECORD IN THE
// APPLICATION" and had no way to find out what they were: no API returns
// `permitReadiness.registry` and no component renders it.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { activeSheetIds, sheetRef } from '@/lib/permit/utils/sheetRef';

const ROOT = join(__dirname, '..', '..');
const PAGE = readFileSync(join(ROOT, 'app', 'engineering', 'page.tsx'), 'utf8');
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const gen = (profile: string) => {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = profile;
  return { html: generatePermitHTML(input) as unknown as string, input };
};
const sheetsOf = (html: string): string[] =>
  [...html.matchAll(/tb-sheet-id"[^>]*>\s*([A-Z0-9.\-]+)\s*</g)].map(m => m[1]);

describe('the exposure category reaches the resolver', () => {
  it('BOTH permit payload literals carry windExposure', () => {
    // The two POST bodies: the PDF generate and the HTML draft preview. The
    // defect was that neither named the field, so no amount of picking B/C/D in
    // the UI could reach `environmental-load-authority@v1`.
    const hits = [...PAGE.matchAll(/windExposure: config\.windExposure \|\| undefined/g)];
    expect(hits.length, 'both permitInput.project literals must thread it').toBe(2);
  });

  it('sends NOTHING when unstated — an empty string would read as an answer', () => {
    expect(PAGE).not.toMatch(/windExposure: config\.windExposure,\s*\n\s*windSpeed/);
    expect(PAGE).toContain('windExposure: config.windExposure || undefined,');
  });

  it('the default is UNSTATED, not a laundered C', () => {
    expect(PAGE).toMatch(/windSpeed: 115, windExposure: '',/);
  });

  it('the picker offers an explicit "not stated" choice', () => {
    expect(PAGE).toContain('<option value="">— not stated —</option>');
  });

  it('every engine boundary coalesces with || — ?? would pass "" into KZ_TABLE', () => {
    // '' is falsy but not nullish. `??` lets it through, and KZ_TABLE[''] is
    // undefined — a silently missing exposure coefficient rather than an error.
    expect(PAGE).not.toMatch(/windExposure: config\.windExposure \?\?/);
    expect(PAGE).not.toMatch(/exposureCategory:\s*config\.windExposure,/);
    const sub = readFileSync(
      join(ROOT, 'app', 'api', 'engineering', 'calculate', 'subSystemStructural.ts'), 'utf8');
    expect(sub).toContain("structural.windExposure || 'C'");
    expect(sub).not.toContain("structural.windExposure ?? 'C'");
  });
});

// The RG-3 lifecycle proofs live in aac-ws3-ws4-ahj-environmental.test.ts,
// which already owns the injected-provider harness (the resolvers must never
// reach the network from a test). The case this change adds there is that an
// EMPTY STRING is not a statement.

describe('the project review record is reachable', () => {
  it('design-review — the profile the app generates — CONTAINS RS-1', () => {
    const { html, input } = gen('design-review');
    const seq = sheetsOf(html);
    expect(seq).toContain('RS-1');
    // immediately after the cover, matching the manifest position exactly:
    // page assembly and manifest must stay in step or V12/V35 desync.
    expect(seq[1]).toBe('RS-1');
    expect(activeSheetIds(input)).toContain('RS-1');
  });

  it('and the cover pointer NAMES the sheet instead of an app screen', () => {
    const { html } = gen('design-review');
    const ptr = /data-release-record-pointer="1"[^>]*>([^<]*)</.exec(html)?.[1]?.trim();
    expect(ptr).toMatch(/SEE SHEET RS-1/);
    expect(ptr).not.toMatch(/IN THE APPLICATION/);
  });

  it('the AHJ permit submittal still omits it — our review record is not part of an application', () => {
    const { html, input } = gen('permit');
    expect(sheetsOf(html)).not.toContain('RS-1');
    expect(sheetRef(input, 'review-status').present).toBe(false);
    // and it degrades honestly rather than dangling
    const ptr = /data-release-record-pointer="1"[^>]*>([^<]*)</.exec(html)?.[1]?.trim();
    expect(ptr).toMatch(/PROJECT REVIEW RECORD IN THE APPLICATION/);
  });

  it('RS-1 actually enumerates the open requirements, not just a count', () => {
    const { html } = gen('design-review');
    const i = html.indexOf('REVIEW STATUS &mdash; RELEASE GATES');
    const rs = html.slice(i, i + 40_000);
    // the root-gate table, the responsible role, and a real resolution action
    expect(rs).toMatch(/RG-3/);
    expect(rs).toMatch(/RESPONSIBLE ROLE/i);
    expect(rs).toMatch(/exposure category/i);
  });

  it('the viewer can navigate to it: RS-1 is in PERMIT_SHEET_INDEX', async () => {
    const { PERMIT_SHEET_INDEX } = await import('@/lib/permit/types');
    expect(PERMIT_SHEET_INDEX.map(s => s.id)).toContain('RS-1');
  });

  it('the preview route resolves a sheet by ID, not by a hardcoded ordinal', () => {
    // The ordinal was already wrong for hybrid / conditional sheets: inserting
    // one page shifted every later sheet, so the viewer served the WRONG SHEET
    // under the right label — which looks like it worked.
    const route = readFileSync(
      join(ROOT, 'app', 'api', 'engineering', 'permit-preview', 'route.ts'), 'utf8');
    expect(route).toContain('extractPageBySheetId(raw, sheetId)');
    expect(route).toMatch(/'RS-1':\s*1,/);
  });
});
