// ═══════════════════════════════════════════════════════════════════════════
// D6 (Planset 19) — THE DOCUMENT ISSUE DATE IS TIMEZONE-EXPLICIT.
//
// Planset 19 printed 8/3/2026 on all 17 sheets for a package generated at 19:29
// on 2026-08-02 America/Chicago. The producer was one line:
//
//     new Date().toLocaleDateString('en-US')        // generatePermit.ts
//
// `toLocaleDateString` with no `timeZone` option formats in the HOST's zone. On
// a UTC serverless host that is the UTC calendar date, so the whole package
// advanced a day every evening. A permit document date is a calendar date in the
// JURISDICTION's zone — never a property of the machine that rendered it.
//
// These tests freeze the clock (the planset house style: `input.generatedAtIso`,
// which the generator reads explicitly) and pin the UTC-boundary behaviour that
// the defect lived in. They are HOST-INDEPENDENT by construction: every
// expectation names an instant and a zone, and the resolver formats with an
// explicit `timeZone`, so the result is identical on a Chicago laptop and a UTC
// container. That independence is the fix.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  resolveDocumentIssueContext, formatLocalCalendarDate, formatInDocumentTimezone,
  isValidTimezone, timezoneForStateCode, configuredDefaultTimezone,
  DEFAULT_DOCUMENT_TIMEZONE,
} from '@/lib/permit/utils/documentIssueContext';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const CHI = 'America/Chicago';

/** the resolved local issue date for an instant, in the project's zone. */
const issueDateAt = (iso: string, over: Record<string, unknown> = {}) =>
  resolveDocumentIssueContext({ generatedAtIso: iso, projectStateCode: 'IL', ...over }).issueDateLocal;

// ── 1. THE UTC BOUNDARY — the exact defect ─────────────────────────────────
describe('D6 §1 — America/Chicago UTC-boundary behaviour', () => {
  it('1. CASE 1 — 2026-08-03T00:30:00Z is still 8/2/2026 in Chicago (the Planset 19 defect)', () => {
    expect(issueDateAt('2026-08-03T00:30:00Z')).toBe('8/2/2026');
  });

  it('2. CASE 2 — 2026-08-03T06:30:00Z is 8/3/2026 in Chicago', () => {
    expect(issueDateAt('2026-08-03T06:30:00Z')).toBe('8/3/2026');
  });

  it('3. CASE 3 — 2026-01-01T03:00:00Z is 12/31/2025 in Chicago (year rolls back)', () => {
    expect(issueDateAt('2026-01-01T03:00:00Z')).toBe('12/31/2025');
  });

  it('4. the date is NOT hardcoded — it tracks the instant across the boundary minute', () => {
    // 04:59Z is the last CDT minute of Aug 2; 05:00Z is the first of Aug 3.
    expect(issueDateAt('2026-08-03T04:59:00Z')).toBe('8/2/2026');
    expect(issueDateAt('2026-08-03T05:00:00Z')).toBe('8/3/2026');
  });

  it('5. DAYLIGHT time (CDT, UTC-5) — the offset is 5 hours in August', () => {
    expect(issueDateAt('2026-07-15T04:59:00Z')).toBe('7/14/2026');
    expect(issueDateAt('2026-07-15T05:00:00Z')).toBe('7/15/2026');
  });

  it('6. STANDARD time (CST, UTC-6) — the offset is 6 hours in January', () => {
    expect(issueDateAt('2026-01-15T05:59:00Z')).toBe('1/14/2026');
    expect(issueDateAt('2026-01-15T06:00:00Z')).toBe('1/15/2026');
  });

  it('7. the DST transition itself resolves — spring forward and fall back', () => {
    // 2026 US DST: begins Mar 8, ends Nov 1.
    expect(issueDateAt('2026-03-08T07:30:00Z')).toBe('3/8/2026');
    expect(issueDateAt('2026-11-01T06:30:00Z')).toBe('11/1/2026');
  });

  it('8. other zones resolve on their own boundaries, not Chicago\'s', () => {
    expect(issueDateAt('2026-08-03T03:30:00Z', { projectStateCode: 'CA' })).toBe('8/2/2026');
    expect(issueDateAt('2026-08-03T03:30:00Z', { projectStateCode: 'NY' })).toBe('8/2/2026');
    expect(issueDateAt('2026-08-03T05:30:00Z', { projectStateCode: 'NY' })).toBe('8/3/2026');
  });
});

// ── 2. RESOLUTION PRECEDENCE, AND NEVER A SILENT UTC ───────────────────────
describe('D6 §2 — how the zone is decided is recorded, never inferred from the host', () => {
  it('9. an explicit PROJECT timezone wins over the jurisdiction', () => {
    const c = resolveDocumentIssueContext({
      generatedAtIso: '2026-08-03T00:30:00Z', projectStateCode: 'IL',
      projectTimezone: 'America/New_York',
    });
    expect(c.timezone).toBe('America/New_York');
    expect(c.timezoneSource).toBe('project-timezone');
  });

  it('10. with no project timezone, a SINGLE-ZONE state supplies the jurisdiction zone', () => {
    const c = resolveDocumentIssueContext({ generatedAtIso: '2026-08-03T00:30:00Z', projectStateCode: 'IL' });
    expect(c.timezone).toBe(CHI);
    expect(c.timezoneSource).toBe('project-jurisdiction');
  });

  it('11. a SPLIT-zone state does not guess — it falls through to the tenant zone', () => {
    for (const st of ['FL', 'TX', 'TN', 'MI', 'IN', 'KS', 'ND', 'SD', 'NE', 'OR', 'ID', 'KY', 'AZ', 'AK', 'NV']) {
      expect(timezoneForStateCode(st), st).toBeNull();
    }
    const c = resolveDocumentIssueContext({
      generatedAtIso: '2026-08-03T00:30:00Z', projectStateCode: 'FL',
      tenantTimezone: 'America/New_York',
    });
    expect(c.timezone).toBe('America/New_York');
    expect(c.timezoneSource).toBe('tenant-timezone');
  });

  it('12. MISSING timezone information falls back to the ONE configured default — not UTC', () => {
    const c = resolveDocumentIssueContext({ generatedAtIso: '2026-08-03T00:30:00Z' });
    expect(c.timezoneSource).toBe('configured-default');
    expect(c.timezone).toBe(configuredDefaultTimezone());
    expect(c.timezone).not.toBe('UTC');
    expect(c.issueDateLocal).toBe('8/2/2026');
  });

  it('13. an INVALID timezone fails to the documented default and RECORDS that it did', () => {
    const c = resolveDocumentIssueContext({
      generatedAtIso: '2026-08-03T00:30:00Z', projectTimezone: 'Mars/Olympus_Mons',
    });
    expect(c.timezoneSource).toBe('configured-default-after-invalid');
    expect(c.timezone).toBe(DEFAULT_DOCUMENT_TIMEZONE);
    expect(c.timezone).not.toBe('UTC');
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(CHI)).toBe(true);
  });

  it('14. an invalid TENANT zone also fails closed to the default, never to UTC', () => {
    const c = resolveDocumentIssueContext({
      generatedAtIso: '2026-08-03T00:30:00Z', projectStateCode: 'FL', tenantTimezone: 'Nowhere/Nothing',
    });
    expect(c.timezoneSource).toBe('configured-default-after-invalid');
    expect(c.timezone).toBe(DEFAULT_DOCUMENT_TIMEZONE);
  });

  it('15. an EXPLICIT issue date outranks the timestamp, in either accepted form', () => {
    for (const given of ['2026-08-02', '8/2/2026']) {
      const c = resolveDocumentIssueContext({
        generatedAtIso: '2026-09-14T18:00:00Z', projectStateCode: 'IL', explicitIssueDate: given,
      });
      expect(c.issueDateLocal, given).toBe('8/2/2026');
      expect(c.issueDateIso, given).toBe('2026-08-02');
      expect(c.issueDateSource, given).toBe('explicit-issue-date');
      expect(c.timezoneSource, given).toBe('explicit-issue-date');
    }
  });

  it('16. a MALFORMED explicit issue date is ignored rather than printed', () => {
    for (const bad of ['not-a-date', '2026-02-30', '13/40/2026', '']) {
      const c = resolveDocumentIssueContext({
        generatedAtIso: '2026-08-03T00:30:00Z', projectStateCode: 'IL', explicitIssueDate: bad,
      });
      expect(c.issueDateSource, bad).toBe('generation-timestamp');
      expect(c.issueDateLocal, bad).toBe('8/2/2026');
    }
  });

  it('17. the context always records the true UTC instant alongside the local date', () => {
    const c = resolveDocumentIssueContext({ generatedAtIso: '2026-08-03T00:30:00Z', projectStateCode: 'IL' });
    expect(c.generatedAtUtc).toBe('2026-08-03T00:30:00.000Z');
    expect(c.issueDateIso).toBe('2026-08-02');
    expect(c.issueDateLocal).toBe('8/2/2026');
  });

  it('18. the ISO and the printed form always describe the SAME local day', () => {
    for (const iso of ['2026-08-03T00:30:00Z', '2026-01-01T03:00:00Z', '2026-11-01T06:30:00Z']) {
      const c = resolveDocumentIssueContext({ generatedAtIso: iso, projectStateCode: 'IL' });
      const [y, m, d] = c.issueDateIso.split('-').map(Number);
      expect(c.issueDateLocal, iso).toBe(`${m}/${d}/${y}`);
    }
  });

  it('19. formatting is deterministic — the same instant and zone always give the same day', () => {
    const a = formatLocalCalendarDate(new Date('2026-08-03T00:30:00Z'), CHI);
    const b = formatLocalCalendarDate(new Date('2026-08-03T00:30:00Z'), CHI);
    expect(a).toEqual(b);
    expect(a.local).toBe('8/2/2026');
    expect(a.iso).toBe('2026-08-02');
  });

  it('20. a non-issue-date instant also formats in the document zone, and a bad one prints an em dash', () => {
    expect(formatInDocumentTimezone('2026-08-03T00:30:00Z', { timezone: CHI })).toBe('8/2/2026');
    expect(formatInDocumentTimezone(null, { timezone: CHI })).toBe('—');
    expect(formatInDocumentTimezone('garbage', { timezone: CHI })).toBe('—');
  });
});

// ── 3. ONE DATE REACHES EVERY SHEET ────────────────────────────────────────
describe('D6 §3 — every project-facing date in the artifact is the same authority', () => {
  function render(iso: string, profile = 'permit') {
    const input: any = clone(braidonOriginalAuditFixture);
    input.generatedAtIso = iso;
    input.plansetProfile = profile;
    const html = generatePermitHTML(input);
    return { html, input };
  }
  const meta = (html: string, k: string) =>
    (html.match(new RegExp(`name="${k}" content="([^"]*)"`)) ?? [])[1] ?? null;
  const distinctDates = (s: string) => [...new Set(s.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) ?? [])];

  it('21. the whole package carries exactly ONE distinct calendar date', () => {
    const { html } = render('2026-08-03T00:30:00Z');
    expect(distinctDates(html)).toEqual(['8/2/2026']);
  });

  it('22. every sheet title block prints that same date — none resolves its own', () => {
    const { html } = render('2026-08-03T00:30:00Z');
    const pages = html.split(/<div class="page"[ >]/).slice(1);
    expect(pages.length).toBeGreaterThan(0);
    const mismatched: string[] = [];
    for (const p of pages) {
      const id = (p.match(/class="tb-sheet-id">([^<]+)</) ?? [])[1] ?? '?';
      const ds = distinctDates(p);
      if (ds.length > 1 || (ds.length === 1 && ds[0] !== '8/2/2026')) mismatched.push(`${id}:${ds.join('|')}`);
    }
    expect(mismatched).toEqual([]);
  });

  it('23. the ISSUE date and the REVISION date do not disagree', () => {
    const { html } = render('2026-08-03T00:30:00Z');
    // every REV A row on every sheet carries the same date the DATE row does
    const revs = [...html.matchAll(/REV A<\/td><td class="tbv">[^<]*?(\d{1,2}\/\d{1,2}\/\d{4})/g)].map(m => m[1]);
    expect(revs.length).toBeGreaterThan(0);
    expect([...new Set(revs)]).toEqual(['8/2/2026']);
  });

  it('24. the artifact records the timezone context that produced the date', () => {
    const { html } = render('2026-08-03T00:30:00Z');
    expect(meta(html, 'document-issue-date-local')).toBe('8/2/2026');
    expect(meta(html, 'document-issue-date-iso')).toBe('2026-08-02');
    expect(meta(html, 'document-timezone')).toBe(CHI);
    expect(meta(html, 'document-timezone-source')).toBe('project-jurisdiction');
    expect(meta(html, 'document-issue-date-source')).toBe('generation-timestamp');
    // the raw instant is NOT emitted — it would differ between two renders of the
    // same input, and byte-identical re-render is a pinned invariant.
    expect(meta(html, 'document-generated-at-utc')).toBeNull();
  });

  it('25. all three profiles print the SAME date for the same generation instant', () => {
    const dates = ['design-review', 'permit', 'full'].map(p => distinctDates(render('2026-08-03T00:30:00Z', p).html));
    for (const d of dates) expect(d).toEqual(['8/2/2026']);
  });

  it('26. repeated generation with a frozen timestamp is date-stable', () => {
    const a = distinctDates(render('2026-08-03T00:30:00Z').html);
    const b = distinctDates(render('2026-08-03T00:30:00Z').html);
    expect(a).toEqual(b);
    expect(a).toEqual(['8/2/2026']);
  });

  it('27. an injected instant reaches the snapshot verbatim as an ISO instant', () => {
    const { input } = render('2026-08-03T00:30:00Z');
    const gen = input._snapshot.meta.generatedAtIso;
    expect(gen).toBe('2026-08-03T00:30:00Z');
    expect(gen).not.toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
  });

  it('28. two renders of one input are byte-identical — the date authority adds no per-render entropy', () => {
    const a = render('2026-08-03T00:30:00Z').html;
    const b = render('2026-08-03T00:30:00Z').html;
    expect(a).toBe(b);
  });
});

// ── 4. NO UTC / HOST-LOCAL SHORTCUT SURVIVES IN THE GENERATORS ─────────────
describe('D6 §4 — the authoritative generators contain no host-local date shortcut', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  // comment lines are documentation of the defect; only CODE is checked.
  const codeOf = (src: string) => src.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

  const GENERATORS = [
    'lib/permit/generatePermit.ts',
    'lib/permit/utils/titleBlock.ts',
    'lib/permit/utils/sldAdapter.ts',
    'lib/permit/sections/electricalPages.ts',
    'lib/permit/sections/coverSheet.ts',
    'lib/permit/sections/certPages.ts',
    'lib/permit/utils/peLetter.ts',
  ];

  it('29. no authoritative generator calls toLocaleDateString/toLocaleString without a timeZone', () => {
    const bad: string[] = [];
    for (const f of GENERATORS) {
      for (const m of codeOf(read(f)).matchAll(/\.toLocale(?:Date|Time)?String\(([^)]*)\)/g)) {
        if (!/timeZone/.test(m[1])) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('30. no authoritative generator derives a calendar date by slicing a UTC ISO string', () => {
    const bad: string[] = [];
    for (const f of GENERATORS) {
      const code = codeOf(read(f));
      if (/toISOString\(\)\s*\.\s*(slice\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\])/.test(code)) {
        bad.push(f);
      }
    }
    expect(bad).toEqual([]);
  });

  it('31. the ONE date producer resolves through the document issue context', () => {
    const g = read('lib/permit/generatePermit.ts');
    expect(g).toContain('resolveDocumentIssueContext');
    expect(g).toContain('_documentIssueContext');
    // and the SLD adapter no longer carries its own clock read
    expect(codeOf(read('lib/permit/utils/sldAdapter.ts'))).not.toContain('new Date().toLocaleDateString');
  });

  it('32. the resolver itself is the only place an IANA default is stated', () => {
    expect(DEFAULT_DOCUMENT_TIMEZONE).toBe(CHI);
    expect(isValidTimezone(DEFAULT_DOCUMENT_TIMEZONE)).toBe(true);
  });
});
