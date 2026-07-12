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
import { resolveEquipmentDatasheets } from '@/lib/permit/sections/datasheetAppendix';
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

  it('each per-sub PV-1B circuit layout documents ONLY its own 4 modules', () => {
    for (const id of ['PV-1B', 'PV-1BG', 'PV-1BF']) {
      const p = pageById(hybridHtml, id);
      expect(p, `${id} header`).toMatch(/CIRCUIT LAYOUT [\s\S]{0,40}4 MODULES/);
      expect(p, `${id} claims project total`).not.toMatch(/CIRCUIT LAYOUT [\s\S]{0,40}12 MODULES/);
    }
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

// ═════ 3. Electrical sheets — per-sub schedules from conductorAuthority ═════
describe('wave 5B — hybrid electrical sheets', () => {
  it('PV-4A renders one circuit schedule per sub with the sub\'s OWN equipment', () => {
    expect(hybridHtml).toMatch(/AC Branch Circuit Schedule — ROOF — 4 MODULES — Enphase IQ8M \(MICRO\)/);
    expect(hybridHtml).toMatch(/DC String Schedule — GROUND — 4 MODULES — Solis S6-GR1P6K \(STRING\)/);
    expect(hybridHtml).toMatch(/DC String Schedule — FENCE — 4 MODULES — SolFence SF-OPT-3800 \(OPTIMIZER\)/);
  });

  it('PV-4B has per-sub sections plus ONE shared service section', () => {
    expect(hybridHtml).toContain('SHARED SERVICE — POINT OF INTERCONNECTION (NEC 705)');
    expect(hybridHtml).toContain('ROOF AC Feeder');
    expect(hybridHtml).toContain('GROUND AC Feeder');
    expect(hybridHtml).toContain('FENCE AC Feeder');
    // Wiring notes for BOTH non-roof subs (the old ternary printed only one).
    expect(hybridHtml).toContain('FENCE WIRING REQUIREMENTS — FENCE SUB-SYSTEM');
    expect(hybridHtml).toContain('GROUND MOUNT WIRING REQUIREMENTS — GROUND SUB-SYSTEM');
    expect(hybridHtml).toContain('SHARED TRENCH / SEPARATE CONDUITS (HYBRID)');
  });

  it('no 94-modules-one-branch-set contamination: no branch covers >4 devices', () => {
    // Every micro branch row prints "N × microinverter" — the roof sub has 4
    // devices total, so no branch may claim more (aggregate had 12 before 2d).
    const counts = [...hybridHtml.matchAll(/(\d+) × microinverter/gi)].map(m => Number(m[1]));
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) expect(c).toBeLessThanOrEqual(4);
  });

  it('E-1 carries the per-sub source summary (same authority as PV-4A/4B)', () => {
    expect(hybridHtml).toContain('E-1 SOURCE SUMMARY — PER SUB-SYSTEM');
    expect(hybridHtml).toMatch(/AC branch/);
    expect(hybridHtml).toMatch(/DC string/);
    // Single-type E-1 has no per-sub zone.
    expect(singleHtml).not.toContain('E-1 SOURCE SUMMARY');
  });
});

/** The one rendered page whose title block carries the given sheet id.
 *  Splits on the page WRAPPER divs only (class="page" / "page sld-page"),
 *  never on page-content/page-draw. */
function pageById(html: string, id: string): string {
  const chunks = html.split(/<div class="page(?:\s[^"]*)?">/);
  const hit = chunks.find(c => c.includes(`class="tb-sheet-id">${id}<`));
  expect(hit, `no rendered page with sheet id ${id}`).toBeTruthy();
  return hit as string;
}

// ═════ 5. PE letters — per-sub subset params (kills the 94-modules lie) ═════
describe('wave 5B — per-sub PE structural letters', () => {
  it('PE-1 (roof) certifies the ROOF subset with roof equipment', () => {
    const p = pageById(hybridHtml, 'PE-1');
    expect(p).toContain('Roof-Mounted Array');
    expect(p).toMatch(/Total Modules<\/td><td class="iv">4</);
    expect(p).toContain('Canadian Solar CS6R-430MS');
  });

  it('PE-1F (fence) has FENCE subset params — never 12 modules or roof racking', () => {
    const p = pageById(hybridHtml, 'PE-1F');
    expect(p).toContain('Solar Fence Array');
    expect(p).toMatch(/Total Modules<\/td><td class="iv">4</);
    expect(p).toContain('SolFence SF-BIF-400');
    expect(p).toContain('Solar Fence Rail System');
    expect(p).not.toContain('IronRidge');          // roof racking must not be certified here
    expect(p).not.toMatch(/Total Modules<\/td><td class="iv">12</);
  });

  it('PE-1G (ground) has GROUND subset params + pile/pier language', () => {
    const p = pageById(hybridHtml, 'PE-1G');
    expect(p).toContain('Ground Mount Array');
    expect(p).toMatch(/Total Modules<\/td><td class="iv">4</);
    expect(p).toContain('Tesla TSP-420');
    expect(p).toContain('Ground Mount Racking System');
    expect(p).not.toContain('IronRidge');
  });

  it('single-type PE-1 letter untouched (project-wide params)', () => {
    const p = pageById(singleHtml, 'PE-1');
    expect(p).toMatch(/Total Modules<\/td><td class="iv">12</);
    expect(p).toContain('IronRidge XR100');
  });
});

// ═════ 4. SCHED — per-sub module/inverter rows + BOM sub grouping ═══════════
describe('wave 5B — hybrid equipment schedule (SCHED)', () => {
  it('module + inverter tables carry a System column with per-sub rows', () => {
    expect(hybridHtml).toContain('Solar Modules — per sub-system (hybrid)');
    expect(hybridHtml).toContain('Inverters — per sub-system (hybrid)');
    // Three module rows at subset counts with sub tags (order: row label then sub cell).
    expect(hybridHtml).toMatch(/<td class="fw7">ROOF<\/td>\s*<td>Canadian Solar<\/td><td>CS6R-430MS<\/td>\s*<td class="tr fw7">4<\/td>/);
    expect(hybridHtml).toMatch(/<td class="fw7">GROUND<\/td>\s*<td>Tesla<\/td><td>TSP-420<\/td>\s*<td class="tr fw7">4<\/td>/);
    expect(hybridHtml).toMatch(/<td class="fw7">FENCE<\/td>\s*<td>SolFence<\/td><td>SF-BIF-400<\/td>\s*<td class="tr fw7">4<\/td>/);
  });

  it('wire sizing renders one block per sub from the shared authority', () => {
    expect(hybridHtml).toMatch(/AC Branch Circuit Schedule &mdash; ROOF — 4 MODULES — Enphase IQ8M \(MICRO\)/);
    expect(hybridHtml).toMatch(/DC String Wire Sizing &mdash; GROUND — 4 MODULES — Solis S6-GR1P6K \(STRING\)/);
    expect(hybridHtml).toMatch(/DC String Wire Sizing &mdash; FENCE — 4 MODULES — SolFence SF-OPT-3800 \(OPTIMIZER\)/);
    expect(hybridHtml).toContain('WIRE SIZING INTERPRETATION (HYBRID)');
  });

  it('datasheet appendix fuzzes EVERY distinct panel/inverter across subs', () => {
    // The hybrid fixture carries 3 distinct panel models + 3 distinct inverter
    // models; the resolver must consider ALL of them (pages render only for
    // models with a manufacturer asset on file — so assert superset + dedupe,
    // not exact count).
    const hybridDs = resolveEquipmentDatasheets(mkHybrid() as any);
    const singleDs = resolveEquipmentDatasheets(JSON.parse(JSON.stringify(roofProject)) as any);
    const ids = hybridDs.map(d => d.asset.id);
    expect(new Set(ids).size).toBe(ids.length);                    // no duplicate pages
    expect(hybridDs.length).toBeGreaterThanOrEqual(singleDs.length); // never fewer than the winner-only path
  });

  it('BOM table groups stage rows by sub where stamped (System column)', () => {
    // Hybrid structural lines are stamped by bomForPermit's per-sub loop —
    // fence posts under FENCE, ground piles/beams under GROUND.
    expect(hybridHtml).toMatch(/<th style="width:7%">System<\/th>/);
    expect(hybridHtml).toMatch(/<td style="font-size:7.5px;font-weight:700;">FENCE<\/td>/);
    expect(hybridHtml).toMatch(/<td style="font-size:7.5px;font-weight:700;">GROUND<\/td>/);
    // Single-type SCHED keeps the legacy 10-column table (no System column).
    expect(singleHtml).not.toMatch(/<th style="width:7%">System<\/th>/);
  });
});
