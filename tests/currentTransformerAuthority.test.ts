import { describe, it, expect } from 'vitest';
import {
  CURRENT_TRANSFORMERS,
  getCurrentTransformer,
  pvConnectionSide,
  deriveConsumptionMeteringMode,
  ungroundedConductorsForService,
  resolveMeteringRequirement,
  consumptionMeteringIsSelfSufficient,
  deviceMetersAnything,
  readProductionMeterFlag,
  skuIsOrderable,
  type DeviceMeteringCapability,
} from '@/lib/equipment/currentTransformers';
import { getBosDevice, BOS_DEVICES } from '@/lib/equipment/integratedBos';

/**
 * 🚨 WHAT THESE TESTS PIN, AND WHY THEY COULD NOT BE WRITTEN BEFORE.
 *
 * The question "can this design measure consumption" was ONE BOOLEAN
 * (`IntegratedFunctions.metering`), so the IQ Combiner 6C (ships NO consumption
 * CTs), the IQ Combiner 5C (ships two) and a bare IQ Gateway (ships a
 * field-installed PRODUCTION CT) were indistinguishable — and a 6C permit
 * asserted consumption metering the job had never bought, with no BOM line to
 * make it true. Every assertion below fails against the pre-change catalogue:
 * the fields it reads did not exist.
 */

const capOf = (id: string): DeviceMeteringCapability => {
  const m = getBosDevice(id)?.metering;
  if (!m) throw new Error(`device ${id} declares no structured metering capability`);
  return m;
};

describe('CT authority — device metering capability', () => {
  it('distinguishes the 6C (no consumption CTs) from the 5C (two in the box)', () => {
    const sixC = capOf('enphase-iq-combiner-6c');
    const fiveC = capOf('enphase-iq-combiner-5c');

    // Production: both integrate it at the factory.
    expect(sixC.production.realisation).toBe('factory-integrated');
    expect(fiveC.production.realisation).toBe('factory-integrated');

    // Consumption: THE material difference, invisible to the old boolean.
    expect(sixC.consumption.ctsIncluded).toBe(0);
    expect(sixC.consumption.realisation).toBe('separate-purchase-field-installed');
    expect(consumptionMeteringIsSelfSufficient(sixC)).toBe(false);

    expect(fiveC.consumption.ctsIncluded).toBe(2);
    expect(fiveC.consumption.realisation).toBe('ships-with-device');
    expect(consumptionMeteringIsSelfSufficient(fiveC)).toBe(true);
  });

  it('a bare IQ Gateway ships a FIELD-INSTALLED production CT — a third shape', () => {
    const gw = capOf('enphase-iq-gateway');
    expect(gw.production.realisation).toBe('ships-with-device');
    expect(gw.production.ctsIncluded).toBe(1);
    expect(gw.consumption.realisation).toBe('separate-purchase-field-installed');
    expect(consumptionMeteringIsSelfSufficient(gw)).toBe(false);
  });

  it('no device fixes WHERE consumption CTs clamp — that is a design fact', () => {
    for (const id of ['enphase-iq-combiner-6c', 'enphase-iq-combiner-5c', 'enphase-iq-gateway']) {
      expect(capOf(id).consumption.boundary, id).toBe('unresolved');
    }
  });

  it('the legacy boolean is DERIVED from the capability, never declared beside it', () => {
    // guard against passing vacuously on a catalogue with no capabilities at all
    expect(BOS_DEVICES.filter(d => d.metering).length).toBeGreaterThanOrEqual(4);
    for (const d of BOS_DEVICES) {
      if (!d.metering) continue;
      expect(d.integrated.metering, d.id).toBe(deviceMetersAnything(d.metering));
    }
    // and it is still true for every converted Enphase row — nothing regressed
    expect(getBosDevice('enphase-iq-combiner-6c')?.integrated.metering).toBe(true);
    expect(getBosDevice('enphase-iq-combiner-5c')?.integrated.metering).toBe(true);
  });

  it('every capability cites where its facts came from', () => {
    for (const d of BOS_DEVICES) {
      if (!d.metering) continue;
      expect(d.metering.citation, d.id).toMatch(/bos-devices-research\.json|data sheet/i);
    }
  });
});

describe('CT authority — the CTs themselves', () => {
  it('carries core type, rating and channel for each CT', () => {
    const split = getCurrentTransformer('enphase-ct-200-split')!;
    expect(split.coreType).toBe('split-core');
    expect(split.channel).toBe('consumption');
    expect(split.ratedPrimaryA).toBe(200);
    expect(split.perUngroundedConductor).toBe(true);

    const solid = getCurrentTransformer('enphase-ct-200-solid')!;
    expect(solid.coreType).toBe('solid-core');
    expect(solid.channel).toBe('production');
    expect(solid.perUngroundedConductor).toBe(false);
  });

  it('REFUSES to state a ratio it cannot source, and never presents an unverified SKU as orderable', () => {
    for (const ct of CURRENT_TRANSFORMERS) {
      // A ratio is a number an engineer acts on. No document in this repo states
      // one for these CTs, so it stays null rather than becoming a typical value.
      expect(ct.ratio, ct.id).toBeNull();
      expect(ct.ratioProvenance, ct.id).toBe('unverified');
      // The part numbers come from this repo's research notes, not a CT data
      // sheet, so none of them may be presented as a verified selection.
      expect(ct.skuProvenance, ct.id).toBe('repo-research-secondary');
      expect(skuIsOrderable(ct.skuProvenance), ct.id).toBe(false);
      expect(ct.skuCitation.length, ct.id).toBeGreaterThan(20);
    }
  });
});

describe('CT authority — the mode is derived, and it refuses', () => {
  it('maps interconnection tokens EXACTLY — never by substring', () => {
    expect(pvConnectionSide('LOAD_SIDE')).toBe('load-side');
    expect(pvConnectionSide('Load Side Tap')).toBe('load-side');
    expect(pvConnectionSide('MAIN_BREAKER_DERATE')).toBe('load-side');
    expect(pvConnectionSide('sub_panel')).toBe('load-side');      // a sub-panel is 705.12, NOT supply side
    expect(pvConnectionSide('SUPPLY_SIDE_TAP')).toBe('supply-side');
    expect(pvConnectionSide('Line Side Tap')).toBe('supply-side');
    // Unknown spellings are UNRESOLVED, not quietly folded into a family.
    expect(pvConnectionSide('load center feeder somewhere')).toBe('unresolved');
    expect(pvConnectionSide('')).toBe('unresolved');
    expect(pvConnectionSide(undefined)).toBe('unresolved');
    expect(pvConnectionSide(null)).toBe('unresolved');
  });

  it('CTs upstream of a load-side PV connection are LOAD WITH SOLAR', () => {
    expect(deriveConsumptionMeteringMode('service-entrance-upstream-of-pv', 'load-side'))
      .toBe('LOAD_WITH_SOLAR');
  });

  it('CTs downstream of where PV lands are LOAD ONLY', () => {
    expect(deriveConsumptionMeteringMode('load-side-downstream-of-pv', 'supply-side')).toBe('LOAD_ONLY');
    expect(deriveConsumptionMeteringMode('load-side-downstream-of-pv', 'load-side')).toBe('LOAD_ONLY');
  });

  it('a supply-side tap on the service-entrance span is INDETERMINATE — it refuses', () => {
    // PV lands on the very span those CTs occupy; whether PV current passes
    // through them is not implied by the labels. There is no third mode.
    expect(deriveConsumptionMeteringMode('service-entrance-upstream-of-pv', 'supply-side'))
      .toBe('INDETERMINATE');
  });

  it('an unresolved boundary or an unresolved PV side is INDETERMINATE, never a default', () => {
    expect(deriveConsumptionMeteringMode('unresolved', 'load-side')).toBe('INDETERMINATE');
    expect(deriveConsumptionMeteringMode('service-entrance-upstream-of-pv', 'unresolved')).toBe('INDETERMINATE');
    expect(deriveConsumptionMeteringMode('load-side-downstream-of-pv', 'unresolved')).toBe('INDETERMINATE');
  });

  it('counts ungrounded conductors only for services it knows', () => {
    expect(ungroundedConductorsForService(240, 1)).toBe(2);
    expect(ungroundedConductorsForService(208, 3)).toBe(3);
    expect(ungroundedConductorsForService(277, 1)).toBeNull();   // UNRESOLVED, not 2
    expect(ungroundedConductorsForService(null, 1)).toBeNull();
  });
});

describe('CT authority — resolution for a real 6C job', () => {
  const sixC = () => ({
    capability: capOf('enphase-iq-combiner-6c'),
    deviceLabel: 'IQ Combiner 6C',
    interconnectionRaw: 'LOAD_SIDE',
    ungroundedConductorCount: 2,
    consumptionMeteringRequired: true,
  });

  it('puts the consumption CTs in the BOM — the line that did not exist', () => {
    const r = resolveMeteringRequirement(sixC());
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].partNumber).toBe('CT-200-SPLIT');
    expect(r.lines[0].quantity).toBe(2);              // one per ungrounded conductor
    expect(r.lines[0].manufacturer).toBe('Enphase');
    expect(r.lines[0].necReference).toBe('NEC 690.4');
  });

  it('does not present that CT as orderable, and says exactly why', () => {
    const r = resolveMeteringRequirement(sixC());
    expect(r.lines[0].authorityStateHint).toBe('CANDIDATE_NON_ORDERABLE');
    expect(r.lines[0].authorityStateHintReason).toMatch(/bos-devices-research\.json/);
    expect(r.blockerCode).toBe('CT-SKU-UNVERIFIED');
    expect(r.status).toBe('UNRESOLVED');
  });

  it('REFUSES the quantity rather than assuming a split-phase pair', () => {
    const r = resolveMeteringRequirement({ ...sixC(), ungroundedConductorCount: null });
    expect(r.lines[0].quantity).toBe(0);
    expect(r.lines[0].authorityStateHint).toBe('QUANTITY_PENDING');
    expect(r.blockerCode).toBe('CT-TOPOLOGY-UNRESOLVED');
    expect(r.lines[0].formula).toMatch(/UNRESOLVED/);
  });

  it('refuses the MODE while still buying the hardware', () => {
    // Nothing in this repo records where the CTs clamp, so the mode is
    // INDETERMINATE — but the count is true wherever they clamp, so the crew
    // still gets the parts. Those are different questions.
    const r = resolveMeteringRequirement(sixC());
    expect(r.consumptionMode).toBe('INDETERMINATE');
    expect(r.consumptionBoundary).toBe('unresolved');
    expect(r.lines).toHaveLength(1);
    expect(r.basis).toMatch(/consumption CT boundary=unresolved/);
  });

  it('states the mode once the design records where the CTs clamp', () => {
    const r = resolveMeteringRequirement({
      ...sixC(),
      consumptionCtBoundary: 'service-entrance-upstream-of-pv',
    });
    expect(r.consumptionMode).toBe('LOAD_WITH_SOLAR');
    expect(r.disclosure).toMatch(/Load With Solar/);
  });

  it('a 5C job needs no CT purchase — it ships them', () => {
    const r = resolveMeteringRequirement({
      capability: capOf('enphase-iq-combiner-5c'),
      deviceLabel: 'IQ Combiner 5C',
      interconnectionRaw: 'LOAD_SIDE',
      ungroundedConductorCount: 2,
      consumptionMeteringRequired: true,
    });
    expect(r.lines).toHaveLength(0);
    expect(r.consumptionMeteringProvided).toBe(true);
  });

  it('🚨 a 6C design that does not buy the CTs may NOT be said to meter consumption', () => {
    // consumptionMeteringRequired: false ⇒ nothing is bought ⇒ nothing is claimed.
    const r = resolveMeteringRequirement({ ...sixC(), consumptionMeteringRequired: false });
    expect(r.lines).toHaveLength(0);
    expect(r.consumptionMeteringProvided).toBe(false);
    expect(r.disclosure).toMatch(/consumption metering is NOT PROVIDED/);
  });

  it('asserts nothing at all when no metering device is modelled', () => {
    const r = resolveMeteringRequirement({
      capability: null, deviceLabel: null, interconnectionRaw: 'LOAD_SIDE',
      ungroundedConductorCount: 2, consumptionMeteringRequired: true,
    });
    expect(r.consumptionMeteringProvided).toBe(false);
    expect(r.lines).toHaveLength(0);
  });
});

describe('the production-meter control has ONE key name', () => {
  it('reads the key the UI actually posts', () => {
    expect(readProductionMeterFlag({ productionMeter: false }, true)).toBe(false);
    expect(readProductionMeterFlag({ productionMeter: true }, false)).toBe(true);
  });

  it('still honours the two legacy spellings for unconverted callers', () => {
    expect(readProductionMeterFlag({ hasProductionMeter: false }, true)).toBe(false);
    expect(readProductionMeterFlag({ requiresProductionMeter: true }, false)).toBe(true);
  });

  it('the posted key WINS over a legacy one, and absence keeps the caller default', () => {
    expect(readProductionMeterFlag({ productionMeter: false, hasProductionMeter: true }, true)).toBe(false);
    expect(readProductionMeterFlag({}, true)).toBe(true);
    expect(readProductionMeterFlag({}, false)).toBe(false);
    expect(readProductionMeterFlag(undefined, true)).toBe(true);
  });
});
