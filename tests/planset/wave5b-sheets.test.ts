// ============================================================================
// Wave 5B — hybrid planset SHEETS (the last planset lies).
// docs/ARCHITECTURE-per-subsystem-equipment.md §3 Wave 5 Lane B.
//
// Fixture = the contract I-3 golden shape (wave2d-authority pattern):
// Enphase micro ROOF + Solis string GROUND + SolFence optimizer FENCE in ONE
// project (4 + 4 + 4 modules of the 12-panel roofProject fixture), rendered
// end-to-end through generatePermitHTML (real CAD engine, real manifest).
//
// Sheet-id scheme under test (documented in sheetManifest.ts):
//   primary sub (fixed roof > ground > fence order) keeps the legacy ids
//   (PV-1 / PV-1B / PV-3 / PE-1); additional subs suffix G (ground) and
//   F (fence): PV-1G, PV-1F, PV-1BG, PV-1BF, PV-3G, PV-3F, PE-1G, PE-1F.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { buildSheetManifest } from '@/lib/permit/sheetManifest';
import { roofProject } from '../../test-fixtures/roofProject';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** 3-sub hybrid fixture: retagged placements + per-sub tagged inverter fleet. */
function mkHybrid() {
  const input: any = clone(roofProject);
  (input.project.panelPositions as any[]).forEach((p: any, i: number) => {
    p.systemType = i < 4 ? 'fence' : i < 8 ? 'ground' : 'roof';
  });
  if (input.layout?.panels) (input.layout.panels as any[]).forEach((p: any, i: number) => {
    p.systemType = i < 4 ? 'fence' : i < 8 ? 'ground' : 'roof';
  });
  input.system.inverters = [
    {
      manufacturer: 'Enphase', model: 'IQ8M', type: 'micro',
      acOutputKw: 0.33, maxDcVoltage: 60, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'roof',
      strings: [{
        label: 'R-1', panelCount: 4, panelManufacturer: 'Canadian Solar', panelModel: 'CS6R-430MS',
        panelWatts: 430, panelVoc: 41.7, panelIsc: 13.85, isc: 13.85,
        wireGauge: '#10 AWG', wireLength: 45,
      }],
    },
    {
      manufacturer: 'Solis', model: 'S6-GR1P6K', type: 'string',
      acOutputKw: 6.0, maxDcVoltage: 600, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'ground',
      strings: [{
        label: 'G-1', panelCount: 4, panelManufacturer: 'Tesla', panelModel: 'TSP-420',
        panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03, isc: 13.03,
        wireGauge: '#10 AWG', wireLength: 80,
      }],
    },
    {
      manufacturer: 'SolFence', model: 'SF-OPT-3800', type: 'optimizer',
      acOutputKw: 3.8, maxDcVoltage: 480, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'fence',
      strings: [{
        label: 'F-1', panelCount: 4, panelManufacturer: 'SolFence', panelModel: 'SF-BIF-400',
        panelWatts: 400, panelVoc: 37.1, panelIsc: 13.6, isc: 13.6,
        wireGauge: '#10 AWG', wireLength: 60,
      }],
    },
  ];
  return input;
}

// One render, shared across suites (generatePermitHTML is expensive).
const hybridHtml = generatePermitHTML(mkHybrid());
const singleHtml = generatePermitHTML(clone(roofProject) as any);

const pageSeq = (html: string) =>
  [...html.matchAll(/class="tb-sheet-id">([^<]+)</g)].map(m => m[1].trim());

// ═════ 1. Sheet manifest — per-sub sheet loop ══════════════════════════════
describe('wave 5B — hybrid sheet manifest', () => {
  const seq = pageSeq(hybridHtml);
  const at = (id: string) => seq.indexOf(id);

  it('renders fence + ground detail sheets ALONGSIDE the roof set', () => {
    for (const id of ['PV-1', 'PV-1G', 'PV-1F', 'PV-1B', 'PV-1BG', 'PV-1BF',
                      'PV-3', 'PV-3G', 'PV-3F', 'PE-1', 'PE-1G', 'PE-1F']) {
      expect(seq, `missing sheet ${id} in ${seq.join(',')}`).toContain(id);
    }
  });

  it('keeps reading order: plans → circuit layouts → electrical → structural → certs', () => {
    expect(at('PV-1')).toBeLessThan(at('PV-1G'));
    expect(at('PV-1G')).toBeLessThan(at('PV-1F'));
    expect(at('PV-1F')).toBeLessThan(at('PV-1B'));
    expect(at('PV-1BF')).toBeLessThan(at('PV-4A'));
    expect(at('E-1')).toBeLessThan(at('PV-3'));
    expect(at('PV-3')).toBeLessThan(at('PV-3G'));
    expect(at('PV-3F')).toBeLessThan(at('PV-4C'));
    expect(at('PE-1')).toBeLessThan(at('PE-1G'));
    expect(at('PE-1G')).toBeLessThan(at('PE-1F'));
  });

  it('cover TOC lists the same per-sub sheets (manifest = single source)', () => {
    const m = buildSheetManifest({
      pv1Title: 'A', pv3Title: 'B', hybridSubs: ['roof', 'ground', 'fence'],
    }).map(s => s.id);
    for (const id of ['PV-1G', 'PV-1F', 'PV-1BG', 'PV-1BF', 'PV-3G', 'PV-3F', 'PE-1G', 'PE-1F']) {
      expect(m).toContain(id);
    }
    // Rendered page order equals the manifest order (both filtered to common ids).
    const rendered = seq.filter(id => m.includes(id));
    const manifest = m.filter(id => rendered.includes(id));
    expect(rendered).toEqual(manifest);
  });

  it('single-type manifests carry NO suffixed sheets (byte-stable ids)', () => {
    const m = buildSheetManifest({ pv1Title: 'A', pv3Title: 'B' }).map(s => s.id);
    expect(m.join(',')).not.toMatch(/PV-1G|PV-1F|PV-1BG|PV-1BF|PV-3G|PV-3F|PE-1G|PE-1F/);
    const singleSeq = pageSeq(singleHtml);
    expect(singleSeq.join(',')).not.toMatch(/PV-1G|PV-1F|PV-1BG|PV-1BF|PV-3G|PV-3F|PE-1G|PE-1F/);
  });
});

// ═════ 2. Cover sheet — hybrid title + per-sub kW lines + summary ═══════════
describe('wave 5B — hybrid cover sheet', () => {
  it('prints the HYBRID headline with all present subs', () => {
    expect(hybridHtml).toContain('HYBRID: ROOF + GROUND + FENCE PHOTOVOLTAIC SYSTEM');
  });

  it('prints one kW line per sub-system with the sub\'s OWN equipment', () => {
    // Per-sub dcKw from cad.hybrid.sections: 4 modules × 430W = 1.72 kW each
    // (fixture wattage is uniform; equipment differs per sub).
    expect(hybridHtml).toMatch(/ROOF — [\d.]+ kW DC · 4 MODULES · .*ENPHASE IQ8M \(MICROINVERTER\)/);
    expect(hybridHtml).toMatch(/GROUND — [\d.]+ kW DC · 4 MODULES · .*SOLIS S6-GR1P6K \(STRING INVERTER\)/);
    expect(hybridHtml).toMatch(/FENCE — [\d.]+ kW DC · 4 MODULES · .*SOLFENCE SF-OPT-3800 \(POWER OPTIMIZER\)/);
  });

  it('SYSTEM SUMMARY has three module lines at subset counts (they differ)', () => {
    expect(hybridHtml).toMatch(/4 × Canadian Solar CS6R-430MS.* — ROOF/);
    expect(hybridHtml).toMatch(/4 × Tesla TSP-420.* — GROUND/);
    expect(hybridHtml).toMatch(/4 × SolFence SF-BIF-400.* — FENCE/);
    // Never a project-wide 12× winner row on the hybrid cover.
    expect(hybridHtml).not.toMatch(/12 × Canadian Solar CS6R-430MS/);
  });

  it('DO-NOT-SUBMIT banner survives (Wave 6 gate) with softened per-sub copy', () => {
    expect(hybridHtml).toContain('HYBRID DESIGN — THIS SET IS NOT PERMIT-READY');
    expect(hybridHtml).toContain('NOW DOCUMENTED PER SUB-SYSTEM');
    expect(hybridHtml).toContain('REMAINING BEFORE SUBMISSION (WAVE 6 GATE)');
  });

  it('single-type cover keeps the legacy headline and no hybrid chrome', () => {
    expect(singleHtml).toContain('PHOTOVOLTAIC ROOF MOUNT SYSTEM');
    expect(singleHtml).not.toContain('HYBRID:');
    expect(singleHtml).not.toContain('NOW DOCUMENTED PER SUB-SYSTEM');
  });
});
