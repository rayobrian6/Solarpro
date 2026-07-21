import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { buildSheetManifest } from '@/lib/permit/sheetManifest';
import { roofProject } from '../../test-fixtures/roofProject';

// The page order, the cover index, and the engineering-page sheet status all
// derive from buildSheetManifest so they can't drift. Discipline flow (Ray
// 2026-07-20): plans → STRUCTURAL (PV-3 · PV-4C) → ELECTRICAL (E-1 leads,
// PV-4A/PV-4B support) → labels → schedules/datasheets → certs. Never
// interleaved disciplines.
describe('planset sheet order', () => {
  const html = generatePermitHTML(JSON.parse(JSON.stringify(roofProject)));
  const pageSeq = [...html.matchAll(/class="tb-sheet-id">([^<]+)</g)].map(m => m[1].trim());
  const at = (id: string) => pageSeq.indexOf(id);

  it('renders pages and no stale PV-2', () => {
    expect(pageSeq.length).toBeGreaterThan(10);
    expect(pageSeq[0]).toBe('PV-0');
    expect(pageSeq).not.toContain('PV-2');
  });

  it('structural before electrical; E-1 leads the electrical section', () => {
    expect(at('PV-3')).toBeGreaterThan(-1);
    expect(at('PV-3')).toBeLessThan(at('PV-4C'));    // attachment detail, then its calcs
    expect(at('PV-4C')).toBeLessThan(at('E-1'));     // structural fully precedes electrical
    expect(at('E-1')).toBeLessThan(at('PV-4A'));     // the single-line leads
    expect(at('PV-4A')).toBeLessThan(at('PV-4B'));
    expect(at('PV-4B')).toBeLessThan(at('PV-5'));    // labels follow the electrical set
  });

  it('certifications come after schedules/datasheets', () => {
    expect(at('APP-A')).toBeLessThan(at('CERT'));
    expect(at('CERT')).toBeLessThan(at('PE-1'));
  });

  it('buildSheetManifest is the single ordered source (structural → electrical)', () => {
    const m = buildSheetManifest({ pv1Title: 'A', pv3Title: 'B' }).map(s => s.id);
    expect(m.indexOf('PV-1B')).toBeLessThan(m.indexOf('PV-3'));
    expect(m.indexOf('PV-3')).toBeLessThan(m.indexOf('PV-4C'));
    expect(m.indexOf('PV-4C')).toBeLessThan(m.indexOf('E-1'));
    expect(m.indexOf('E-1')).toBeLessThan(m.indexOf('PV-4A'));
    expect(m.indexOf('PV-4A')).toBeLessThan(m.indexOf('PV-4B'));
    expect(m.indexOf('PV-4B')).toBeLessThan(m.indexOf('PV-5'));
    expect(m.indexOf('APP-A')).toBeLessThan(m.indexOf('CERT'));
    // datasheets slot in after APP-A, before CERT
    const withDs = buildSheetManifest({ pv1Title: 'A', pv3Title: 'B', datasheets: [{ id: 'DS-1', title: 'x' }] }).map(s => s.id);
    expect(withDs.indexOf('DS-1')).toBeGreaterThan(withDs.indexOf('APP-A'));
    expect(withDs.indexOf('DS-1')).toBeLessThan(withDs.indexOf('CERT'));
  });
});
