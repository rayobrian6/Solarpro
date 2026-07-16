import { describe, it, expect } from 'vitest';
import { buildCanonical } from '../../lib/permit/utils/canonical';
import { generatePermitHTML } from '../../lib/permit/generatePermit';
import { roofProject } from '../../test-fixtures/roofProject';

// Phase 0 of hybrid (multi-system) support — the Stowell finding: a design with
// fence + ground + roof panels resolved to "SOLAR FENCE SYSTEM", attributed all
// 80 modules to the fence, billed no roof/ground structure, and wrongly applied
// the fence/ground RSD exemption to on-roof panels. Until SubSystem[] support
// lands, a hybrid must NEVER pass silently: canonical flags it and the cover
// prints a DO-NOT-SUBMIT banner.
describe('hybrid design detection (Phase 0)', () => {
  const mkHybrid = () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    const panels = input.layout.panels as any[];
    // Retag a third of the panels as fence + a third as ground.
    panels.forEach((p: any, i: number) => {
      p.systemType = i % 3 === 0 ? 'fence' : i % 3 === 1 ? 'ground' : 'roof';
    });
    return input;
  };

  it('buildCanonical flags hybridSystemTypes and still resolves a winner', () => {
    const c = buildCanonical(mkHybrid());
    expect(c.hybridSystemTypes).toBeDefined();
    expect(c.hybridSystemTypes!.length).toBe(3);
    expect(c.hybridSystemTypes!.join(',')).toMatch(/roof:\d+/);
    expect(c.hybridSystemTypes!.join(',')).toMatch(/fence:\d+/);
    // Winner is still the legacy fence-first vote (documented, not silent).
    expect(c.systemType).toBe('solar_fence');
  });

  it('single-system designs are NOT flagged', () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    const c = buildCanonical(input);
    expect(c.hybridSystemTypes).toBeUndefined();
  });

  it('the cover prints a DO-NOT-SUBMIT banner for a hybrid, and never for single-system', () => {
    const hybridHtml = generatePermitHTML(mkHybrid());
    expect(hybridHtml).toContain('HYBRID DESIGN — THIS SET IS NOT PERMIT-READY');
    expect(hybridHtml).toContain('DO NOT SUBMIT');

    const single: any = JSON.parse(JSON.stringify(roofProject));
    const singleHtml = generatePermitHTML(single);
    expect(singleHtml).not.toContain('HYBRID DESIGN');
  });
});
