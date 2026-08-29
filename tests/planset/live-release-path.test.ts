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
import { resolveSnapshotAuthorityInputs } from '@/lib/permit/snapshot/authorityInputs';

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

describe('Auto-Fill may not name the engineer of record', () => {
  it('does not seat the software vendor as the designer', () => {
    // One click used to patch `designer = 'SolarPro Engineer'`. The release gate
    // only tests that the field is NON-EMPTY, so that CLEARED
    // DESIGNER-OF-RECORD-MISSING and printed the vendor on the sheet that
    // carries professional responsibility. The permit route refuses to do this
    // on the server (a teardown P1: the platform is not a licensed design
    // firm) - the client was undoing it.
    expect(PAGE).not.toMatch(/patches\.designer\s*=\s*'SolarPro Engineer'/);
    expect(PAGE).not.toMatch(/patches\.designer\s*=/);
  });

  it('the field is marked required for release, so the gate is discoverable', () => {
    expect(PAGE).toMatch(/\{ label: 'Designer', key: 'designer'[^}]*required: true \}/);
    expect(PAGE).toContain('Required for permit release &mdash; Auto-Fill will not supply it.');
  });

  it('and the blocker still fires on a blank designer', () => {
    // The gate is a NON-EMPTY test on project.designer (build.ts), so removing
    // the vendor patch is exactly what keeps it open until a human answers.
    const input: any = clone(braidonOriginalAuditFixture);
    input.project.designer = '';
    input.plansetProfile = 'design-review';
    generatePermitHTML(input);
    const codes = ((input._snapshot?.permitReadiness?.registry ?? []) as any[]).map(r => r.code);
    expect(codes).toContain('DESIGNER-OF-RECORD-MISSING');

    // control: a stated name closes it
    const ok: any = clone(braidonOriginalAuditFixture);
    ok.plansetProfile = 'design-review';
    generatePermitHTML(ok);
    const okCodes = ((ok._snapshot?.permitReadiness?.registry ?? []) as any[]).map(r => r.code);
    expect(okCodes).not.toContain('DESIGNER-OF-RECORD-MISSING');
  });
});

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

// ═══════════════════════════════════════════════════════════════════════════
// THE SHIPPED DATASHEET MUST SURVIVE THE ASYNC PATH (2026-08-29)
//
// The pure build path already consults SolarPro's own shipped datasheet
// catalogue when no governed registry row exists. The RESOLVER did not - it
// recomputed the verdict from the database alone and overwrote the pure answer,
// so on any deployment with no archived Qcells row (which is every deployment)
// the async path REOPENED a requirement the product had already closed with a
// document it ships. That was the last design-lane item standing between a
// finished package and DESIGN COMPLETE.
//
// The precedence is delicate and these tests pin all three cases.
// ═══════════════════════════════════════════════════════════════════════════
describe('the shipped module datasheet survives the resolver', () => {
  const CODE = 'MODULE-EXACT-DATASHEET-PENDING';
  const openCodes = async (read: unknown) => {
    const input: any = clone(braidonOriginalAuditFixture);
    input.plansetProfile = 'design-review';
    const authority = await resolveSnapshotAuthorityInputs(input, { safeDbRead: read, providers: {} } as never);
    generatePermitHTML(input, undefined, authority as never);
    return ((input._snapshot?.permitReadiness?.registry ?? []) as any[])
      .filter(r => !r.resolved).map(r => r.code);
  };

  it('a READABLE registry holding no row lets the shipped document answer', async () => {
    // The shape of every real deployment today.
    const readable = async (label: string, _r: unknown, failSoftTo: unknown) => {
      if (label.startsWith('findVerifiedDocument(module_datasheet')) return { value: null, ok: true, error: null };
      if (label.startsWith('listDocuments(module_datasheet')) return { value: [], ok: true, error: null };
      return { value: failSoftTo, ok: false, error: 'offline (test)' };
    };
    expect(await openCodes(readable)).not.toContain(CODE);
  }, 300_000);

  it('an UNREADABLE registry fails CLOSED - an outage may not overturn a revoked row', async () => {
    // `ok: false` means we could not look, NOT that nothing is on file.
    // Substituting the catalogue there would let a database outage clear a
    // requirement an operator had deliberately reopened.
    const offline = async (_l: string, _r: unknown, failSoftTo: unknown) =>
      ({ value: failSoftTo, ok: false, error: 'offline (test)' });
    expect(await openCodes(offline)).toContain(CODE);
  }, 300_000);

  // The third case - a row that EXISTS but is revoked or does not cover the
  // selected wattage - is pinned in cmda-module-document-authority.test.ts
  // (12 and 13c). The catalogue must never overturn an operator's refusal.
});
