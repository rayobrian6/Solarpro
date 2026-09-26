// ═══════════════════════════════════════════════════════════════════════════
// THE METERING ROW THAT EXISTED EVERYWHERE EXCEPT ON THE PERMIT.
//
// `SLDProfessionalInput.meteringChannels` is an OPTIONAL field: the renderer
// prints the E-1 'Metering' row only when a caller HANDS it the CT authority's
// answer, and deliberately never composes one itself (a schedule that writes
// its own metering wording is a second authority).
//
// The standalone SLD route and the SLD PDF export both compose it. The PERMIT
// adapter (lib/permit/utils/sldAdapter.ts) composed nothing, so the row simply
// did not exist on the E-1 that goes to the AHJ — silence next to a schedule
// naming an IQ Combiner 6C, which ships no consumption CTs. Silence beside a
// gateway reads as "metering is handled", which is the exact inference the CT
// authority exists to stop.
//
// Both assertions fail against the pre-change adapter: `meteringChannels` was
// `undefined` for every permit, on every device.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import type { CADModel } from '@/lib/cad/types';
import { roofProject } from '../../test-fixtures/roofProject';
import { buildSLDInputFromPermit } from '@/lib/permit/utils/sldAdapter';
import { buildIntegratedEquipment } from '@/lib/permit/utils/integratedEquipment';
import { resolveDesignMetering } from '@/lib/equipment/designMetering';

const cad = { systemType: 'roof', totalPanels: 12, totalDcKw: 5.16 } as CADModel;

/** The 6C: production metering integral, consumption CTs a SEPARATE purchase. */
function sixCJob() {
  const p = JSON.parse(JSON.stringify(roofProject));
  p.project.selectedCombinerId = 'enphase-iq-combiner-6c';
  p.project.interconnectionMethod = 'LOAD_SIDE';
  return p;
}

/** The 5C: production integral AND two consumption clamp CTs in the box. */
function fiveCJob() {
  const p = JSON.parse(JSON.stringify(roofProject));
  p.project.selectedCombinerId = 'enphase-iq-combiner-5c';
  p.project.interconnectionMethod = 'LOAD_SIDE';
  return p;
}

describe('control — the probe devices resolve as selected', () => {
  it('each job resolves its own combiner and that device models metering', () => {
    expect(buildIntegratedEquipment(sixCJob(), cad).brains?.model).toBe('IQ Combiner 6C');
    expect(buildIntegratedEquipment(fiveCJob(), cad).brains?.metering).toBeTruthy();
  });
});

describe('permit E-1 carries the CT authority Metering row', () => {
  it('a 6C job prints the metering cell instead of saying nothing', () => {
    const sld = buildSLDInputFromPermit(sixCJob(), cad);
    // OLD: undefined — the renderer's row was omitted entirely, so the E-1 was
    // silent next to a schedule naming the 6C.
    // NOW: production metering is integral, and the consumption CTs the 6C does
    // NOT ship are specified. Since 2026-09-25 their location defaults from the
    // interconnection (load-side ⇒ service conductors ahead of the main ⇒ Net),
    // printed as a default — it was "MODE TBD" on every job forever before.
    expect(sld.meteringChannels).toBe('PROD (INT.) · CONS (NET)');
  });

  it('a 5C job also carries a cell — both boxes state what is measured', () => {
    const sld = buildSLDInputFromPermit(fiveCJob(), cad);
    expect(sld.meteringChannels).toBeTruthy();
    expect(sld.meteringChannels).toContain('CONS');
  });

  it('the wording is the authority verbatim — the adapter never writes its own', () => {
    // Composed here from the SAME plan and the SAME authority the standalone SLD
    // route and the PDF export use, so the three artefacts of one design cannot
    // disagree about what is measured. Any wording invented in the adapter would
    // break this.
    const job = sixCJob();
    const plan = buildIntegratedEquipment(job, cad);
    const brains = plan.brains ?? plan.devices[0];
    const expected = resolveDesignMetering({
      plan: { brains: brains ?? null, hasIntegratedGateway: plan.hasIntegratedGateway },
      interconnectionRaw: job.project.interconnectionMethod,
      consumptionCtLocation: job.project.consumptionCtLocation ?? null,
      systemVoltage: 240,
    }).scheduleValue;
    expect(buildSLDInputFromPermit(job, cad).meteringChannels).toBe(expected);
  });

  it('nothing is asserted when no metering device is modelled', () => {
    // A string job with no integrated combiner: the row stays absent rather
    // than printing an empty or invented metering claim.
    const p = JSON.parse(JSON.stringify(roofProject));
    p.project.selectedCombinerId = '';
    p.project.bosDeviceIds = [];
    p.system.topology = 'string';
    p.system.inverters[0].type = 'string';
    p.system.inverters[0].manufacturer = 'Fronius';
    p.system.inverters[0].model = 'Primo 6.0-1';
    const sld = buildSLDInputFromPermit(p, { ...cad } as CADModel);
    const brains = buildIntegratedEquipment(p, cad).brains;
    if (!brains?.metering) expect(sld.meteringChannels).toBeUndefined();
  });
});
