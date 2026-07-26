import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { projectStructuralFromInput } from '@/lib/permit/snapshot/structuralProjection';

// PV-3's attach spacing must come from the ONE canonical spacing authority — the
// same object PV-1 / PV-4C / PV-4C.1 / APP-A / PE-1 print — never a sheet hardcode
// and never the legacy `compliance.structural.attachment.maxAllowedSpacing`
// operator field. PPC §3 retired that field as the §3 ROOT CAUSE: its NAME carried
// "maximum allowed" semantics with no verification state, and it was the source of
// all three rendered `48" O.C. MAX` strings (PV-1 data row, PV-3 data row, PV-3
// header). Roof Tech RT-MINI is an L-foot + rail base (rail_based), so it is NOT
// rail-less and must show the projected design spacing, not "48 O.C. STAGGERED".
describe('PV-3 RT-MINI attach spacing (single source of truth)', () => {
  const rtMini = () => {
    const p: any = JSON.parse(JSON.stringify(roofProject));
    p.project.mountingSystem = 'ROOF TECH RT-MINI';
    p.project.mountingSystemId = 'rooftech-mini';
    p.project.rafterSpacing = 24;
    return p;
  };

  // Scope: PV-3's ATTACHMENT SPECS table (lib/drafting/sheetComposition.ts).
  const spacingCell = (html: string): string => {
    const m = html.match(/DESIGN ATTACHMENT SPACING<\/[^>]*>\s*<td[^>]*>([^<]*)</i);
    return m ? m[1] : '';
  };

  it('PV-3 attach spacing projects the canonical authority, not a hardcoded 48 STAGGERED', () => {
    const input = rtMini();
    const html = generatePermitHTML(input);
    const cell = spacingCell(html);
    const spc = projectStructuralFromInput(input).spacingAuthority;
    expect(spc.designSpacingIn).not.toBeNull();
    // The rendered value IS the canonical design spacing, tagged DESIGN (or
    // VERIFIED once a verified source exists) — never MAX/MAXIMUM/allowable.
    expect(cell).toContain(String(Math.round(spc.designSpacingIn!)));
    expect(cell).toMatch(/\(DESIGN\)|\(VERIFIED\)/);
    expect(cell).not.toMatch(/MAX/i);
    expect(cell).not.toContain('STAGGERED');   // the old RT-MINI rail-less hardcode is gone
  });

  it('PV-3 states the spacing VERIFICATION STATUS beside the design value', () => {
    const html = generatePermitHTML(rtMini());
    expect(html).toContain('DESIGN ATTACHMENT SPACING: 48 IN. O.C. / STATUS: PENDING STRUCTURAL VERIFICATION');
  });
});
