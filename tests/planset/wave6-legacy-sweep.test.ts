// ============================================================================
// Wave 6 — LEGACY SINGLE-SYSTEM PLANSET SWEEP (I-1 at the planset level).
// docs/ARCHITECTURE-per-subsystem-equipment.md §3 Wave 6.
//
// Wave-0 goldens pin the ENGINES (computeSystem run-id set, generateBOMV4
// nextId/line sequence, electrical parity, SLD structural markers). What was
// missing is the END-TO-END planset pin: for each representative
// single-system fixture — roof MICRO, roof STRING, pure FENCE, pure GROUND —
// generatePermitHTML must keep producing the exact legacy sheet set, with
// zero hybrid chrome and deterministic output.
//
// Intentional Wave-6 deltas on the PURE-FENCE sheets (cosmetic text only,
// engine outputs untouched — punch items 1b/1c):
//   • fence elevation header/captions now read "TYPICAL 2-BAY … L.F. RUN";
//   • the fence wind chain falls back 115 (aligned with FENCE DATA) instead
//     of a private 90 — both fixtures carry explicit wind, so their rendered
//     values are unchanged (110 fence / 120 ground).
// Everything pinned here is the CURRENT = post-campaign N=1 behavior, which
// waves 0–5 proved byte-identical to pre-campaign at the engine level.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { fenceProject } from '../../test-fixtures/fenceProject';
import { groundProject } from '../../test-fixtures/groundProject';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const pageSeq = (h: string) =>
  [...h.matchAll(/class="tb-sheet-id">([^<]+)</g)].map(m => m[1].trim());

/** Roof STRING variant of the golden roof fixture (Fronius Primo). */
function roofStringProject(): any {
  const fx: any = clone(roofProject);
  fx.system.topology = 'string';
  fx.system.inverters = [{
    manufacturer: 'Fronius', model: 'Primo 8.2-1', type: 'string',
    acOutputKw: 8.2, maxDcVoltage: 600, efficiency: 0.97, ulListing: 'UL 1741',
    strings: [{
      label: 'String 1', panelCount: 12, panelManufacturer: 'Canadian Solar', panelModel: 'CS6R-430MS',
      panelWatts: 430, panelVoc: 41.7, panelIsc: 13.85, isc: 13.85,
      wireGauge: '#10 AWG', wireLength: 45, ampacity: 30, ocpd: 20, voltageDrop: 1.8,
    }],
  }];
  return fx;
}

// The pinned legacy sheet sequences (post-campaign N=1 = pre-campaign set).
// Discipline flow (Ray 2026-07-20): plans → structural → electrical (E-1
// leads) → labels → schedules/datasheets → certs. DS series: equipment pages
// + RACKING MOUNT (the manufacturer page PV-3 formerly reprinted inline —
// PV-3 is a DRAWING sheet again) + RACKING RAIL (rail_spec product sheet).
const LEGACY_SEQ = ['PV-0', 'PV-1', 'PV-1B', 'PV-3', 'PV-4C', 'E-1', 'PV-4A',
  'PV-4B', 'PV-5', 'PV-6', 'SCHED', 'SCHED-2', 'APP-A', 'DS-1', 'DS-2', 'DS-3',
  'CERT', 'PE-1'];
// Fence: no racking-mount image asset (SolFence has no public doc) and no
// registry rail accessory → equipment DS page only.
const LEGACY_SEQ_ONE_DS = LEGACY_SEQ.filter(id => id !== 'DS-2' && id !== 'DS-3');
// Ground: no datasheet images resolve for the fixture's equipment at all.
const LEGACY_SEQ_NO_DS = LEGACY_SEQ.filter(id => !id.startsWith('DS-'));

const FIXTURES: Array<{ name: string; mk: () => any; seq: string[] }> = [
  { name: 'roof micro',  mk: () => clone(roofProject),   seq: LEGACY_SEQ },
  { name: 'roof string', mk: roofStringProject,          seq: LEGACY_SEQ },
  { name: 'pure fence',  mk: () => clone(fenceProject),  seq: LEGACY_SEQ_ONE_DS },
  { name: 'pure ground', mk: () => clone(groundProject), seq: LEGACY_SEQ_NO_DS },
];

for (const { name, mk, seq } of FIXTURES) {
  describe(`wave 6 sweep — ${name}`, () => {
    const input = mk();
    const html = generatePermitHTML(input);

    it('sheet-manifest pin: exact legacy sequence, no suffixed sheets', () => {
      expect(pageSeq(html)).toEqual(seq);
    });

    it('zero hybrid chrome anywhere in the set (I-1/I-8)', () => {
      expect(html).not.toMatch(/PV-1G|PV-1F|PV-1BG|PV-1BF|PV-3G|PV-3F|PE-1G|PE-1F/);
      expect(html).not.toContain('SLD MULTI-LANE');
      expect(html).not.toContain('HYBRID:');
      expect(html).not.toContain('HYBRID MULTI-SYSTEM SET');
      expect(html).not.toContain('DO NOT SUBMIT');
      expect(html).not.toContain('E-1 SOURCE SUMMARY');
      expect(html).not.toContain('per sub-system (hybrid)');
      expect(html).not.toContain('SHARED TRENCH / SEPARATE CONDUITS (HYBRID)');
    });

    it('single-system inputs gain NO per-sub structural block (hybrid-only field)', () => {
      expect((input.compliance?.structural as any)?.subSystems).toBeUndefined();
    });

    it('deterministic: a second render is byte-identical', () => {
      expect(generatePermitHTML(mk())).toBe(html);
    });
  });
}

// ── Fixture-specific honesty pins ────────────────────────────────────────────
describe('wave 6 sweep — pure fence sheet honesty', () => {
  const html = generatePermitHTML(clone(fenceProject) as any);

  it('keeps its OWN legit fence-system branding (Wave 6.1 binding is guard, not clobber)', () => {
    expect(html).toContain('FENCE SYSTEM: SOLAR FENCE RAIL SYSTEM');
    expect(html).not.toContain('ROOF TECH');
    expect(html).not.toContain('IRONRIDGE');
  });

  it('wind agrees across the callout, schedule row and FENCE DATA (110 mph fixture)', () => {
    expect(html).toContain('WIND 110 MPH');
    expect(html).toContain('WIND LOAD — 110 MPH (ASCE 7-22)');
    expect(html).toContain('110 MPH Vult');
    expect(html).not.toContain('WIND 90 MPH');
  });

  it('elevation carries the Wave-6.2 typical-2-bay caption (intentional delta)', () => {
    expect(html).toContain('TYPICAL 2-BAY ELEVATION');
    expect(html).toContain('L.F. TOTAL RUN');
  });
});

describe('wave 6 sweep — pure ground sheet honesty', () => {
  const html = generatePermitHTML(clone(groundProject) as any);

  it('wind stays the fixture design wind (120 mph) on the structural sheet', () => {
    expect(html).toContain('120 MPH');
    expect(html).not.toContain('WIND 90 MPH');
  });
});
