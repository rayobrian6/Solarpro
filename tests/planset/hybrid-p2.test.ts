import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '../../lib/permit/generatePermit';
import { generateBOMForPermit } from '../../lib/permit/utils/bomForPermit';
import { generateCADLayout } from '../../lib/cad/cadEngine';
import { generateBOMV4 } from '../../lib/bom-engine-v4';
import { roofProject } from '../../test-fixtures/roofProject';

// Hybrid P2: per-sub-system structural + BOM. Each system follows its OWN
// source of truth — fence posts from analyzeFenceSystem's subset, ground piles
// from analyzeGroundMount's, roof racking from the roof-scoped run, and NEC
// 690.12 module-level RSD follows the ROOF subset (the old project-wide
// exemption skipped RSD for Stowell's on-roof panels — a code violation).
describe('hybrid P2 — per-sub-system structural + BOM', () => {
  const mkHybrid = () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    (input.project.panelPositions as any[]).forEach((p: any, i: number) => {
      p.systemType = i < 4 ? 'fence' : i < 8 ? 'ground' : 'roof';
    });
    if (input.layout?.panels) (input.layout.panels as any[]).forEach((p: any, i: number) => {
      p.systemType = i < 4 ? 'fence' : i < 8 ? 'ground' : 'roof';
    });
    return input;
  };

  it('NEC 690.12: RSD follows the ROOF subset, exemption only for ground/fence', () => {
    const mk = (counts: any, sysType: string): any => ({
      inverterId: 'solaredge-se7600h', panelId: 'rec-alpha-pure-r-405', moduleCount: 12,
      stringCount: 2, inverterCount: 1, systemKw: 5, dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
      dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4', roofType: 'shingle',
      attachmentCount: 20, railSections: 8, mainPanelAmps: 200, backfeedAmps: 30, acOCPD: 30, dcOCPD: 20,
      systemType: sysType, interconnectionMethod: 'LOAD_SIDE', panelBusRating: 200,
      requiresRapidShutdown: true, subSystemCounts: counts,
      includeTruckStock: false, includeSuggestedTools: false,
    });
    const rsd = (bom: any) => (bom.items || []).filter((i: any) => i.category === 'rapid_shutdown');
    // Hybrid tagged 'fence' but 4 roof modules → RSD qty 4 (NOT zero, NOT 12).
    const hybrid: any = generateBOMV4(mk({ roof: 4, ground: 4, fence: 4 }, 'fence'));
    expect(rsd(hybrid).length).toBe(1);
    expect(rsd(hybrid)[0].quantity).toBe(4);
    // Pure fence: still exempt.
    const fenceOnly: any = generateBOMV4(mk({ roof: 0, ground: 0, fence: 12 }, 'fence'));
    expect(rsd(fenceOnly).length).toBe(0);
    // Legacy single-roof (no counts): unchanged — all modules.
    const roofLegacy: any = generateBOMV4(mk(undefined, 'roof'));
    expect(rsd(roofLegacy)[0].quantity).toBe(12);
  });

  it('hybrid permit BOM carries fence posts + ground structure + roof racking, each scoped', () => {
    const input = mkHybrid();
    const cad = generateCADLayout(input);
    const items: any[] = generateBOMForPermit(input, cad as any);
    const cats = (c: string) => items.filter(i => (i.category || '').includes(c));
    // Fence structure (posts/footings) present.
    expect(cats('post').length + items.filter(i => /fence/i.test(i.description || '')).length).toBeGreaterThan(0);
    // Ground structure (piles/posts) present.
    expect(items.some(i => /pile|ground/i.test(`${i.category} ${i.description}`))).toBe(true);
    // Roof racking present (rails from the roof-scoped rackingBOM).
    expect(items.some(i => i.category === 'rail')).toBe(true);
  });

  it('hybrid structural runs are keyed on compliance.structural.subSystems', () => {
    const input = mkHybrid();
    generatePermitHTML(input);
    const subs = (input.compliance?.structural as any)?.subSystems ?? {};
    expect(Object.keys(subs).sort()).toEqual(['fence', 'ground', 'roof']);
  });
});
