// ═══════════════════════════════════════════════════════════════════════════
// TAC WS-18 — CROSS-SHEET REFERENCES resolved against the ACTIVE package.
//
// The audited DESIGN_REVIEW artifact contained 16 sheets and sent the reader to
// RS-1 twenty-five times and to PV-6 three times. Neither sheet was in the
// package. The invariant proven here is simple and absolute:
//
//   a package may not tell a reviewer to consult a sheet it does not contain.
//
// Enforced three ways: the reference resolver (which sheet holds this content
// in THIS package), the render-time normalization pass (a reference to an
// omitted sheet degrades to the record that does hold it), and a fail-closed
// render invariant (V36) that throws rather than shipping a dangling pointer.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  activeSheetIds, sheetRef, normalizeAbsentSheetReferences, findDanglingSheetReferences,
} from '@/lib/permit/utils/sheetRef';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function gen(profile: string): { html: string; snap: PermitDesignSnapshot; input: any } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = profile;
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot, input };
}

/** Only the PROSE a reviewer reads — never tags, attributes or comments. The
 *  merge provenance stamp data-merged-sheet="PV-6" and the source comments that
 *  document the design are markup and stay verbatim. */
function proseOnly(html: string): string {
  let out = '', i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out += html.slice(i); break; }
    out += html.slice(i, lt);
    i = html.startsWith('<!--', lt)
      ? (html.indexOf('-->', lt + 4) + 3 || html.length)
      : (html.indexOf('>', lt) + 1 || html.length);
  }
  return out;
}

const PROFILES = ['design-review', 'permit', 'full'] as const;

describe('WS-18 — no package points at a sheet it does not contain', () => {
  for (const profile of PROFILES) {
    it(`${profile}: every referenced sheet id is in the generated sheet set`, () => {
      const { html, input } = gen(profile);
      const active = activeSheetIds(input);
      expect(active.length).toBeGreaterThan(0);
      expect(findDanglingSheetReferences(html, active)).toEqual([]);
    });
  }

  it('design-review carries ZERO prose references to RS-1 (was 25)', () => {
    const { html } = gen('design-review');
    expect(proseOnly(html)).not.toContain('RS-1');
  });

  it('permit carries ZERO prose references to RS-1', () => {
    const { html } = gen('permit');
    expect(proseOnly(html)).not.toContain('RS-1');
  });

  it('full KEEPS its RS-1 references — the sheet is in that package', () => {
    const { html, input } = gen('full');
    expect(activeSheetIds(input)).toContain('RS-1');
    expect(proseOnly(html)).toContain('RS-1');
  });

  it('the compact packages degrade the pointer to the project review record', () => {
    const prose = proseOnly(gen('design-review').html);
    expect(prose).toContain('the project review record');
    expect(prose).toMatch(/SEE THE PROJECT REVIEW RECORD.{0,40}FOR ALL \d+ REQUIREMENTS/);
  });

  it('the PV-6 merge stamp and title-block sheet ids are NOT rewritten', () => {
    const { html } = gen('design-review');
    // PV-6 composed onto the labels sheet: the provenance attribute survives...
    expect(html).toContain('data-merged-sheet="PV-6"');
    // ...but no prose sends the reader to the sheet that was merged away.
    expect(proseOnly(html)).not.toContain('PV-6');
    // full: the dedicated sheet exists and IS referenced in prose.
    const full = gen('full');
    expect(activeSheetIds(full.input)).toContain('PV-6');
    expect(proseOnly(full.html)).toContain('PV-6');
  });
});

describe('WS-18 — the resolver answers with THIS package sheet', () => {
  it('review-status resolves to RS-1 in full, to the review record in the compact profiles', () => {
    const full = sheetRef(gen('full').input, 'review-status');
    expect(full.present).toBe(true);
    expect(full.sheetId).toBe('RS-1');
    const dr = sheetRef(gen('design-review').input, 'review-status');
    expect(dr.present).toBe(false);
    expect(dr.sheetId).toBeNull();
    expect(dr.short).toBe('the project review record');
  });

  it('disconnect-directory resolves PV-6 → the merged labels sheet when PV-6 is composed away', () => {
    expect(sheetRef(gen('full').input, 'disconnect-directory').sheetId).toBe('PV-6');
    expect(sheetRef(gen('design-review').input, 'disconnect-directory').sheetId).toBe('PV-5');
  });

  it('physical-section-schedule resolves to PV-4B.1 — it was never on E-1', () => {
    for (const profile of PROFILES) {
      const r = sheetRef(gen(profile).input, 'physical-section-schedule');
      expect(r.sheetId).toBe('PV-4B.1');
      expect(r.sheetId).not.toBe('E-1');
    }
  });

  it('a standalone render with no input at all does not throw', () => {
    expect(() => sheetRef(null, 'review-status')).not.toThrow();
    expect(() => activeSheetIds(undefined)).not.toThrow();
  });
});

describe('WS-18 — the normalization pass is prose-only and case-aware', () => {
  const ACTIVE = ['PV-0', 'PV-4B', 'PV-5'];   // no RS-1

  it('rewrites the pointer forms and keeps a caps headline in caps', () => {
    expect(normalizeAbsentSheetReferences('see sheet RS-1 (REVIEW STATUS)', ACTIVE))
      .toBe('see the project review record in the application');
    expect(normalizeAbsentSheetReferences('SEE RS-1 FOR ALL 15 REQUIREMENTS', ACTIVE))
      .toBe('SEE THE PROJECT REVIEW RECORD FOR ALL 15 REQUIREMENTS');
    expect(normalizeAbsentSheetReferences('(full text on RS-1)', ACTIVE))
      .toBe('(full text on the project review record)');
    expect(normalizeAbsentSheetReferences('continuation RS-1.2 detail', ACTIVE))
      .toBe('continuation the project review record detail');
  });

  it('never touches attributes, tags or comments', () => {
    const markup = '<div data-x="RS-1" title="see RS-1"><!-- RS-1 --><span>see RS-1</span></div>';
    expect(normalizeAbsentSheetReferences(markup, ACTIVE)).toBe(
      '<div data-x="RS-1" title="see RS-1"><!-- RS-1 --><span>see the project review record</span></div>');
  });

  it('is a no-op when the sheet IS in the package', () => {
    const s = 'see sheet RS-1 (REVIEW STATUS) and SEE RS-1 FOR ALL 3 REQUIREMENTS';
    expect(normalizeAbsentSheetReferences(s, ['RS-1', 'PV-0'])).toBe(s);
  });
});
