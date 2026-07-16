import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';

// PV-3's attach spacing must pull from the structural authority
// (structural.attachment.maxAllowedSpacing — the same value PV-4C/PE-1/CERT/
// APP-A print), NOT a hardcoded "48 O.C. STAGGERED". Roof Tech RT-MINI is an
// L-foot + rail base (rail_based), so it is NOT rail-less and must show the
// engine-resolved spacing. (Ray 2026-07-10: PV-3 was contradicting the single
// source.)
describe('PV-3 RT-MINI attach spacing (single source of truth)', () => {
  const rtMini = () => {
    const p: any = JSON.parse(JSON.stringify(roofProject));
    p.project.mountingSystem = 'ROOF TECH RT-MINI';
    p.project.mountingSystemId = 'rooftech-mini';
    p.project.rafterSpacing = 24;
    p.compliance.structural = { ...(p.compliance.structural || {}), attachment: { maxAllowedSpacing: 36 } };
    return p;
  };

  // Scope: PV-3's ATTACHMENT SPECS table (lib/drafting/sheetComposition.ts).
  // (The roof-plan drawn-feet callout in templates/roof.ts is a separate,
  // still-open instance — tracked as a follow-up.)
  const attachSpecCell = (html: string): string => {
    const m = html.match(/ATTACH SPACING<\/[^>]*>\s*<td[^>]*>([^<]*)</i);
    return m ? m[1] : '';
  };

  it('PV-3 attach spacing pulls the engine value, not a hardcoded 48 STAGGERED', () => {
    const cell = attachSpecCell(generatePermitHTML(rtMini()));
    expect(cell).toMatch(/\d+&quot; O\.C\. MAX/);   // railed format from structural.attachment.maxAllowedSpacing
    expect(cell).not.toContain('STAGGERED');       // the old RT-MINI rail-less hardcode is gone
  });
});
