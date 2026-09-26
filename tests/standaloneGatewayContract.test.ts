/**
 * tests/standaloneGatewayContract.test.ts
 *
 * THE STANDALONE IQ GATEWAY + PV AC COMBINER PANEL — THE CONTRACT EVERY
 * CONSUMER BUILDS AGAINST.
 *
 * "Whatever Envoy I want" (Ray, 2026-09-25) could not include a bare IQ
 * Gateway: recorded as the project's combiner it resolved to a plan whose
 * brains was a DIN-rail box with no busbar, every consumer printed the brains AS
 * the combiner, and the SLD drew the branch breakers inside the Envoy while the
 * BOM bought a box the drawing did not show. The topology is now a selectable
 * catalogue row (`kind: 'gateway_system'`) that the resolver expands into the two
 * real boxes — the PV AC combiner panel the branches land in, and the gateway fed
 * from its own 2-pole breaker in it — and `planLandingDevice` is the one rule for
 * which of them a drawing names as the combiner.
 *
 * This file pins:
 *   · the catalogue facts (the new row; ENV2; the 4C's in-box CTs),
 *   · the standalone plan's shape and its panel sizing,
 *   · `planLandingDevice` on every plan kind,
 *   · what is selectable,
 *   · the metering composer's standalone answer and the per-channel CT leads,
 *   · `sldCombinerFields().standaloneGateway` — present only on a standalone,
 *   · and that the four existing designs below resolve exactly as they did
 *     before the change, except for the new `leads` on a metered micro drawing.
 *     That last group is a baseline recorded from the pre-change code
 *     (2026-09-26); a key appearing on an existing plan would move a permit
 *     snapshot digest and retire a live PE approval.
 */

import { describe, it, expect } from 'vitest';
import {
  BOS_DEVICES,
  getBosDevice,
  isSelectableCombiner,
  listCombiners,
  planLandingDevice,
  resolveAcCombinerPanel,
  resolveHybridAcCollection,
  resolveIntegratedEquipment,
  type IntegratedEquipmentPlan,
  type SystemBosContext,
} from '@/lib/equipment/integratedBos';
import { resolveDesignMetering } from '@/lib/equipment/designMetering';
import { sldCombinerFields, type SldCombinerInputs } from '@/lib/equipment/sldCombinerFields';
import { combinerCompatibilityFor } from '@/lib/equipment/combinerCompatibility';
import {
  consumptionMeteringIsSelfSufficient,
  getCurrentTransformer,
} from '@/lib/equipment/currentTransformers';

const STANDALONE = 'enphase-iq-gateway-standalone';
const GATEWAY = 'enphase-iq-gateway';
const SUPPLY_CONDUCTOR = '#14 AWG CU THWN-2 (L1, L2, N) + #14 EGC';

/** The keys that exist ONLY on a standalone plan. */
const STANDALONE_PLAN_KEYS = ['gatewayPlacement', 'aggregation', 'gateway', 'gatewaySupply', 'branchBreakerA'] as const;

const enphaseCtx = (over: Partial<SystemBosContext> = {}): SystemBosContext => ({
  inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', isMicro: true,
  totalDevices: 30, branchCount: 3, hasBattery: false,
  compatibleCombinerIds: combinerCompatibilityFor('Enphase', 'IQ8+', 'enphase-iq8plus'),
  ...over,
});

const standalonePlan = (branchCount: number) =>
  resolveIntegratedEquipment(enphaseCtx({ branchCount, totalDevices: branchCount * 10, selectedCombinerId: STANDALONE }));

/** What a caller hands the metering composer: the plan's slice, passed through. */
const meteringSlice = (plan: IntegratedEquipmentPlan) => ({
  brains: plan.brains ?? plan.devices[0] ?? null,
  hasIntegratedGateway: plan.hasIntegratedGateway,
  ...(plan.gatewayPlacement ? { gatewayPlacement: plan.gatewayPlacement } : {}),
});

const fieldsFor = (over: Partial<SldCombinerInputs> = {}) => sldCombinerFields({
  inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', inverterId: 'enphase-iq8plus', isMicro: true,
  totalDevices: 30, branchCount: 3, hasBattery: false,
  interconnectionRaw: 'LOAD_SIDE', ungroundedConductorCount: 2,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the catalogue', () => {
  it('carries the standalone topology as a selectable row that is not itself a box', () => {
    const row = getBosDevice(STANDALONE)!;
    expect(row).toBeDefined();
    expect(row.kind).toBe('gateway_system');
    expect(row.brand).toBe('Enphase');
    expect(row.model).toBe('IQ Gateway (standalone) + PV AC combiner panel');
    expect(row.integrated.monitoring).toBe(true);
    expect(row.standalone).toEqual({
      gatewayDeviceId: GATEWAY,
      branchBreakerA: 20,
      gatewaySupplyBreakerA: 15,
      gatewaySupplyConductor: SUPPLY_CONDUCTOR,
    });
    expect(row.ecosystem).toBe('enphase-iq');
    expect(row.installComplexity).toBe(3);
    expect(row.active).toBe(true);
    // Its gateway is a real catalogue device — the expansion cannot dangle.
    expect(getBosDevice(row.standalone!.gatewayDeviceId)?.kind).toBe('gateway');
    // Enphase: 2-pole, 20 A maximum, for the gateway's own supply.
    expect(row.standalone!.gatewaySupplyBreakerA).toBeLessThanOrEqual(20);
  });

  it('only the gateway_system row carries `standalone`', () => {
    for (const d of BOS_DEVICES) {
      expect('standalone' in d, d.id).toBe(d.kind === 'gateway_system');
    }
  });

  it('names the IEEE 1547:2018 gateway, and no longer hints the BOM need not buy consumption CTs', () => {
    const gw = getBosDevice(GATEWAY)!;
    expect(gw.partNumber).toBe('ENV2-IQ-AM1-240');
    const notes = [gw.metering!.production.note, gw.metering!.consumption.note].join(' ');
    expect(notes).not.toMatch(/metered/i);
    expect(notes).not.toMatch(/distributor/i);
    expect(gw.metering!.consumption.realisation).toBe('separate-purchase-field-installed');
    expect(gw.metering!.consumption.ctsIncluded).toBe(0);
  });

  it('the IQ Combiner 4C ships its two consumption CTs in the box (IQC-4-4C-DSH-00217-5.0)', () => {
    const four = getBosDevice('enphase-iq-combiner-4c')!.metering!;
    expect(four.consumption.realisation).toBe('ships-with-device');
    expect(four.consumption.ctsIncluded).toBe(2);
    expect(consumptionMeteringIsSelfSufficient(four)).toBe(true);
    expect(four.citation).toMatch(/IQC-4-4C-DSH-00217-5\.0/);
    expect(four.citation).toMatch(/140-00233-08/);
  });

  it('the CT catalogue states each lead, and refuses a length it cannot source', () => {
    expect(getCurrentTransformer('enphase-ct-200-solid')!.lead).toMatchObject({ lengthFt: 5, extension: null });
    expect(getCurrentTransformer('enphase-ct-200-split')!.lead).toMatchObject({ lengthFt: 13 });
    expect(getCurrentTransformer('enphase-ct-200-split')!.lead!.extension).toMatch(/1\.5 Ω/);
    expect(getCurrentTransformer('enphase-ct-200-clamp')!.lead!.lengthFt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the standalone plan', () => {
  it('is the landing panel + the gateway, with the gateway as the metering brains', () => {
    const plan = standalonePlan(3);
    expect(plan.brand).toBe('Enphase');
    expect(plan.devices.map(d => d.id)).toEqual(['pv-ac-combiner-125', GATEWAY]);
    expect(plan.aggregation?.id).toBe('pv-ac-combiner-125');
    expect(plan.aggregation).toEqual(plan.devices[0]);
    expect(plan.gateway?.id).toBe(GATEWAY);
    expect(plan.gateway).toEqual(plan.devices[1]);
    expect(plan.brains).toEqual(plan.gateway);
    expect(plan.gateway?.partNumber).toBe('ENV2-IQ-AM1-240');
    // The gateway is its own enclosure: NOT integrated, and no box here is the
    // PV AC disconnect — the panel feeds the external disconnect as a 4C/5C does.
    expect(plan.hasIntegratedGateway).toBe(false);
    expect(plan.providesAcDisconnect).toBe(false);
    expect(plan.gatewayPlacement).toBe('standalone');
    expect(plan.gatewaySupply).toEqual({ breakerA: 15, conductor: SUPPLY_CONDUCTOR });
    expect(plan.branchBreakerA).toBe(20);
    expect(plan.source).toBe('override');
    expect(plan.combinerBasis).toBe('project-selected');
    // The topology row itself is never one of the boxes.
    expect(plan.devices.some(d => d.kind === 'gateway_system')).toBe(false);
  });

  it('the landing panel is a plain device — no feeder OCPD sized from a breaker sum', () => {
    const agg = standalonePlan(3).aggregation as unknown as Record<string, unknown>;
    for (const k of ['busbarA', 'mainOcpdA', 'positions']) expect(k in agg, k).toBe(false);
    expect(agg.roleSummary).toBe('Combiner');
    expect(agg.quantity).toBe(1);
  });

  it.each<[number, string, number]>([
    // branches → panel (sized for 20 A × branches + the 15 A gateway breaker,
    // and for branches + 1 positions), branch positions = panel positions − 1
    [3, 'pv-ac-combiner-125', 5],
    [5, 'pv-ac-combiner-125', 5],
    [6, 'pv-ac-combiner-200', 7],
    [8, 'pv-ac-combiner-225', 11],
  ])('%i branches land in %s with %i branch positions', (branches, panelId, slots) => {
    const plan = standalonePlan(branches);
    const sized = resolveAcCombinerPanel(20 * branches + 15, branches + 1)!;
    expect(sized.id).toBe(panelId);
    expect(plan.aggregation?.id).toBe(panelId);
    expect(plan.branchSlots).toBe(sized.positions - 1);
    expect(plan.branchSlots).toBe(slots);
    expect(plan.branchSlotWarning).toBeUndefined();
  });

  it('says so when the branches outgrow the largest panel', () => {
    expect(standalonePlan(12).branchSlotWarning).toMatch(/12 AC branches exceed .* 11 branch positions/);
    // 11 fit the positions but 11 × 20 A + 15 A overruns a 225 A busbar.
    expect(standalonePlan(11).branchSlotWarning).toMatch(/235 A\) exceed its 225 A busbar/);
  });

  it('a single session override expands the same way, under the override basis', () => {
    const plan = resolveIntegratedEquipment(enphaseCtx({ overrideDeviceIds: [STANDALONE] }));
    expect(plan.gatewayPlacement).toBe('standalone');
    expect(plan.devices.map(d => d.id)).toEqual(['pv-ac-combiner-125', GATEWAY]);
    expect(plan.combinerBasis).toBe('session-override');
  });

  it('a hand-built multi-device override keeps meaning exactly what it listed', () => {
    const plan = resolveIntegratedEquipment(enphaseCtx({ overrideDeviceIds: ['pv-ac-combiner-125', GATEWAY] }));
    expect(plan.devices.map(d => d.id)).toEqual(['pv-ac-combiner-125', GATEWAY]);
    for (const k of STANDALONE_PLAN_KEYS) expect(k in plan, k).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('planLandingDevice — the box the branches land in', () => {
  it('is the landing panel on a standalone plan, never the Envoy', () => {
    const plan = standalonePlan(3);
    expect(planLandingDevice(plan)?.id).toBe('pv-ac-combiner-125');
    expect(planLandingDevice(plan)?.id).not.toBe(plan.brains?.id);
  });

  it('is exactly `brains ?? devices[0]` on every other plan kind', () => {
    const plans: Array<[string, IntegratedEquipmentPlan]> = [
      ['auto (declared 5C)', resolveIntegratedEquipment(enphaseCtx())],
      ['auto (no declaration → 6C default)', resolveIntegratedEquipment(enphaseCtx({ compatibleCombinerIds: undefined }))],
      ['selected 5C', resolveIntegratedEquipment(enphaseCtx({ selectedCombinerId: 'enphase-iq-combiner-5c' }))],
      ['selected 6C', resolveIntegratedEquipment(enphaseCtx({ selectedCombinerId: 'enphase-iq-combiner-6c' }))],
      ['selected 4C', resolveIntegratedEquipment(enphaseCtx({ selectedCombinerId: 'enphase-iq-combiner-4c' }))],
      ['legacy stored bare gateway', resolveIntegratedEquipment(enphaseCtx({ selectedCombinerId: GATEWAY }))],
      ['unknown selection', resolveIntegratedEquipment(enphaseCtx({ selectedCombinerId: 'acme-9000' }))],
      ['override: panel only (no brains)', resolveIntegratedEquipment(enphaseCtx({ overrideDeviceIds: ['pv-ac-combiner-125'] }))],
      ['override: panel + gateway', resolveIntegratedEquipment(enphaseCtx({ overrideDeviceIds: ['pv-ac-combiner-125', GATEWAY] }))],
      ['string job', resolveIntegratedEquipment({ ...enphaseCtx(), inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H-US', isMicro: false })],
    ];
    for (const [name, plan] of plans) {
      expect('aggregation' in plan, name).toBe(false);
      expect(planLandingDevice(plan), name).toBe(plan.brains ?? plan.devices[0]);
    }
    // and the two edge answers
    expect(planLandingDevice(plans[7][1])?.id).toBe('pv-ac-combiner-125');
    expect(planLandingDevice(plans[9][1])).toBeUndefined();
    expect(planLandingDevice(null)).toBeUndefined();
    expect(planLandingDevice(undefined)).toBeUndefined();
  });

  it('a hybrid lane names its landing box the same way', () => {
    const h = resolveHybridAcCollection([
      { key: 'roof', inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', isMicro: true, branchCount: 3,
        deviceCount: 30, backfeedA: 40, selectedCombinerId: STANDALONE },
      { key: 'roof-6c', inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', isMicro: true, branchCount: 3,
        deviceCount: 30, backfeedA: 40, selectedCombinerId: 'enphase-iq-combiner-6c' },
    ]);
    expect(h.perSource[0].combiner?.id).toBe('pv-ac-combiner-125');
    expect(h.perSource[0].combinerHasDisconnect).toBe(false);
    expect(h.perSource[1].combiner?.id).toBe('enphase-iq-combiner-6c');
    expect(h.perSource[1].combinerHasDisconnect).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('what is selectable', () => {
  it('the standalone topology is; the bare gateway still is not', () => {
    expect(isSelectableCombiner(STANDALONE)).toBe(true);
    expect(isSelectableCombiner(GATEWAY)).toBe(false);
    const enphase = listCombiners('enphase').map(d => d.id);
    expect(enphase).toContain(STANDALONE);
    expect(enphase).not.toContain(GATEWAY);
    expect(listCombiners('tesla').map(d => d.id)).not.toContain(STANDALONE);
    // The IQ Combiners are all still offered.
    for (const id of ['enphase-iq-combiner-6c', 'enphase-iq-combiner-5c', 'enphase-iq-combiner-4c']) {
      expect(isSelectableCombiner(id), id).toBe(true);
    }
  });

  it('every selectable device resolves to a plan whose LANDING device has branch positions', () => {
    for (const d of listCombiners()) {
      const plan = resolveIntegratedEquipment(enphaseCtx({ selectedCombinerId: d.id }));
      expect(plan.branchSlots ?? 0, d.id).toBeGreaterThan(0);
      expect(planLandingDevice(plan)?.integrated.aggregation, d.id).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('metering — the one composer, on a standalone gateway', () => {
  const met = (interconnectionRaw: string | null, plan = standalonePlan(3)) => resolveDesignMetering({
    plan: meteringSlice(plan), interconnectionRaw, systemVoltage: 240,
  });

  it('puts the production CT on L1 in the PV panel, and requires (and buys) the consumption CTs', () => {
    const m = met('LOAD_SIDE');
    expect(m.drawing?.production).toEqual({
      realisation: 'ships-with-device',
      where: 'landing-panel-field',
      label: 'PCT (SHIPS W/ GATEWAY) — L1 IN PV PANEL',
    });
    expect(m.resolution?.consumptionMeteringProvided).toBe(true);
    expect(m.resolution?.lines.map(l => [l.partNumber, l.quantity])).toEqual([['CT-200-SPLIT', 2]]);
    expect(m.drawing?.consumption?.supplied).toBe('order-separately');
    expect(m.scheduleValue).toBe('PROD (CT) · CONS (NET)');
  });

  it('draws both leads to the gateway, each under its own rule', () => {
    expect(met('LOAD_SIDE').drawing?.leads).toEqual([
      { channel: 'production', label: 'PCT LEAD 5 FT — DO NOT EXTEND', maxLengthFt: 5, extendable: false },
      { channel: 'consumption', label: 'CT LEADS 13 FT — EXTEND ≤1.5 Ω/WIRE, TWISTED PAIR IN RACEWAY', maxLengthFt: 13, extendable: true },
    ]);
  });

  it('with no recorded interconnection the consumption CTs are not drawn — the production lead still is', () => {
    const m = met(null);
    expect(m.drawing?.consumption).toBeNull();
    expect(m.drawing?.leads).toEqual([
      { channel: 'production', label: 'PCT LEAD 5 FT — DO NOT EXTEND', maxLengthFt: 5, extendable: false },
    ]);
  });

  it('🚨 a caller that drops gatewayPlacement from the slice drops the consumption CTs', () => {
    // The reason the field exists — pinned so a consumer that forgets it is
    // visibly wrong here rather than silently short two CTs on site.
    const plan = standalonePlan(3);
    const m = resolveDesignMetering({
      plan: { brains: plan.brains, hasIntegratedGateway: plan.hasIntegratedGateway },
      interconnectionRaw: 'LOAD_SIDE', systemVoltage: 240,
    });
    expect(m.resolution?.lines).toEqual([]);
    expect(m.resolution?.consumptionMeteringProvided).toBe(false);
  });
});

describe('metering — integrated IQ Combiners draw the consumption lead only', () => {
  const met = (selectedCombinerId: string, interconnectionRaw: string | null = 'LOAD_SIDE') => {
    const plan = resolveIntegratedEquipment(enphaseCtx({ selectedCombinerId }));
    return resolveDesignMetering({ plan: meteringSlice(plan), interconnectionRaw, systemVoltage: 240 });
  };

  it('6C (CT-200-SPLIT, 13 ft) — its production CT is factory pre-wired', () => {
    expect(met('enphase-iq-combiner-6c').drawing?.leads).toEqual([
      { channel: 'consumption', label: 'CT LEADS 13 FT — EXTEND ≤1.5 Ω/WIRE, TWISTED PAIR IN RACEWAY', maxLengthFt: 13, extendable: true },
    ]);
  });

  it('5C (CT-200-CLAMP) — the length is not borrowed from another CT', () => {
    expect(met('enphase-iq-combiner-5c').drawing?.leads).toEqual([
      { channel: 'consumption', label: 'CT LEADS (LENGTH PER MFR) — EXTEND ≤1.5 Ω/WIRE, TWISTED PAIR IN RACEWAY', maxLengthFt: null, extendable: true },
    ]);
  });

  it('4C — the CTs are in the box now, so nothing is bought', () => {
    const m = met('enphase-iq-combiner-4c');
    expect(m.drawing?.consumption?.supplied).toBe('in-box');
    expect(m.resolution?.lines).toEqual([]);
    expect(m.resolution?.consumptionMeteringProvided).toBe(true);
    expect(m.drawing?.production?.where).toBe('combiner-integral');
  });

  it('no lead to draw ⇒ no `leads` key at all', () => {
    const d = met('enphase-iq-combiner-6c', null).drawing!;
    expect(d.consumption).toBeNull();
    expect('leads' in d).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('sldCombinerFields', () => {
  it('names the landing panel as the combiner and carries the gateway beside it', () => {
    const f = fieldsFor({ selectedCombinerId: STANDALONE });
    expect(f.combinerLabel).toBe('Generic 125A PV AC Combiner Panel');
    expect(f.combinerModel).toBe('Generic 125A PV AC Combiner Panel');
    expect(f.combinerHasIntegratedGateway).toBe(false);
    expect(f.combinerProvidesAcDisconnect).toBe(false);
    expect(f.combinerSelectionIsDecided).toBe(true);
    expect(f.standaloneGateway).toEqual({
      label: 'Enphase IQ Gateway',
      partNumber: 'ENV2-IQ-AM1-240',
      supplyBreakerA: 15,
      supplyConductor: SUPPLY_CONDUCTOR,
      landingLabel: 'Generic 125A PV AC Combiner Panel',
    });
    expect(f.standaloneGateway?.landingLabel).toBe(f.combinerLabel);
    // …and the metering it hands the renderer is the standalone answer.
    expect(f.meteringDrawing?.production?.where).toBe('landing-panel-field');
    expect(f.meteringDrawing?.leads?.map(l => l.channel)).toEqual(['production', 'consumption']);
    expect(f.combinerMeteringSummary).toBe('PROD (CT) · CONS (NET)');
    expect(f.metering?.lines.map(l => l.partNumber)).toEqual(['CT-200-SPLIT']);
  });

  it('is ABSENT on every other design — not undefined-valued', () => {
    for (const selectedCombinerId of [null, 'enphase-iq-combiner-5c', 'enphase-iq-combiner-6c', 'enphase-iq-combiner-4c', GATEWAY]) {
      expect('standaloneGateway' in fieldsFor({ selectedCombinerId }), String(selectedCombinerId)).toBe(false);
    }
    expect('standaloneGateway' in fieldsFor({
      inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H-US', inverterId: 'se-7600h', isMicro: false,
    })).toBe(false);
    // A leftover standalone pick on a string job draws no gateway: only a micro
    // job draws the box its branches land in.
    expect('standaloneGateway' in fieldsFor({
      inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H-US', inverterId: 'se-7600h', isMicro: false,
      selectedCombinerId: STANDALONE,
    })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BASELINE — recorded from the pre-change code (2026-09-26) with a probe over
// the same inputs. The full outputs were deep-diffed before/after; the only
// difference was the new `drawing.leads`. What is pinned here is every
// behaviour-bearing field of that baseline.
// ─────────────────────────────────────────────────────────────────────────────

type Variant = 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP' | null;

/** The baseline drawing for an integrated combiner, minus the new `leads`. */
const integratedDrawing = (model: '5C' | '6C', v: Variant) => {
  const supplied = model === '5C' ? 'in-box' : 'order-separately';
  const box = model === '5C' ? 'IN BOX' : 'ORDER — SEE BOM';
  const production = { realisation: 'factory-integrated', where: 'combiner-integral', label: 'PCT (INTEGRAL) — PRODUCTION' };
  if (v === null) return { production, consumption: null, lead: null, scheduleRow: null };
  const lead = {
    toDeviceLabel: `IQ Combiner ${model}`,
    label: `CT SECONDARY LEADS → IQ COMBINER ${model} CONSUMPTION INPUTS — MFR CT CABLE; EXTEND / RACEWAY PER MFR — FIELD VERIFY`,
  };
  return v === 'LOAD_SIDE'
    ? {
        production,
        consumption: {
          ctCount: 2, location: 'sec-line-side-of-main', mode: 'LOAD_WITH_SOLAR', supplied,
          label: 'CT ×2 (L1, L2) — CONSUMPTION — LOAD WITH SOLAR (NET)',
          basisLabel: 'DEFAULT PER INTERCONNECTION — FIELD VERIFY',
        },
        lead,
        scheduleRow: `2 × CLAMP (${box}) · L1/L2 · SVC, LINE SIDE OF MAIN · NET · DEFAULT — FIELD VERIFY`,
      }
    : {
        production,
        consumption: {
          ctCount: 2, location: 'between-tap-and-main', mode: 'LOAD_ONLY', supplied,
          label: 'CT ×2 (L1, L2) — CONSUMPTION — LOAD ONLY (TOTAL)',
          basisLabel: 'DEFAULT PER INTERCONNECTION — FIELD VERIFY',
        },
        lead,
        scheduleRow: `2 × CLAMP (${box}) · L1/L2 · TAP → MAIN · TOTAL · DEFAULT — FIELD VERIFY`,
      };
};

const withoutLeads = <T extends object | null>(d: T): T => {
  if (!d) return d;
  const { leads: _leads, ...rest } = d as Record<string, unknown>;
  return rest as T;
};

const BASELINE_CASES = [
  {
    name: '(i) IQ8+ micro, 3 branches, no selection',
    ctx: enphaseCtx(),
    fieldsOver: {},
    plan: { brand: 'Enphase', deviceIds: ['enphase-iq-combiner-5c'], brainsId: 'enphase-iq-combiner-5c',
      hasIntegratedGateway: true, providesAcDisconnect: false, branchSlots: 4, source: 'auto',
      combinerBasis: 'declared-compatibility' },
    model: '5C' as const,
    label: 'Enphase IQ Combiner 5C',
    decided: false,
    lines: [] as Array<[string, number]>,
    leadsLoadSide: [{ channel: 'consumption', label: 'CT LEADS (LENGTH PER MFR) — EXTEND ≤1.5 Ω/WIRE, TWISTED PAIR IN RACEWAY', maxLengthFt: null, extendable: true }],
  },
  {
    name: '(ii) selected IQ Combiner 5C',
    ctx: enphaseCtx({ selectedCombinerId: 'enphase-iq-combiner-5c' }),
    fieldsOver: { selectedCombinerId: 'enphase-iq-combiner-5c' },
    plan: { brand: 'Enphase', deviceIds: ['enphase-iq-combiner-5c'], brainsId: 'enphase-iq-combiner-5c',
      hasIntegratedGateway: true, providesAcDisconnect: false, branchSlots: 4, source: 'override',
      combinerBasis: 'project-selected' },
    model: '5C' as const,
    label: 'Enphase IQ Combiner 5C',
    decided: true,
    lines: [] as Array<[string, number]>,
    leadsLoadSide: [{ channel: 'consumption', label: 'CT LEADS (LENGTH PER MFR) — EXTEND ≤1.5 Ω/WIRE, TWISTED PAIR IN RACEWAY', maxLengthFt: null, extendable: true }],
  },
  {
    name: '(iii) selected IQ Combiner 6C',
    ctx: enphaseCtx({ selectedCombinerId: 'enphase-iq-combiner-6c' }),
    fieldsOver: { selectedCombinerId: 'enphase-iq-combiner-6c' },
    plan: { brand: 'Enphase', deviceIds: ['enphase-iq-combiner-6c'], brainsId: 'enphase-iq-combiner-6c',
      hasIntegratedGateway: true, providesAcDisconnect: true, branchSlots: 4, source: 'override',
      combinerBasis: 'project-selected' },
    model: '6C' as const,
    label: 'Enphase IQ Combiner 6C',
    decided: true,
    lines: [['CT-200-SPLIT', 2]] as Array<[string, number]>,
    leadsLoadSide: [{ channel: 'consumption', label: 'CT LEADS 13 FT — EXTEND ≤1.5 Ω/WIRE, TWISTED PAIR IN RACEWAY', maxLengthFt: 13, extendable: true }],
  },
];

describe('BASELINE — the existing designs resolve exactly as before', () => {
  for (const c of BASELINE_CASES) {
    describe(c.name, () => {
      const plan = resolveIntegratedEquipment(c.ctx);

      it('the plan: same devices, same flags, same basis — and none of the new keys', () => {
        expect({
          brand: plan.brand,
          deviceIds: plan.devices.map(d => d.id),
          brainsId: plan.brains?.id,
          hasIntegratedGateway: plan.hasIntegratedGateway,
          providesAcDisconnect: plan.providesAcDisconnect,
          branchSlots: plan.branchSlots,
          source: plan.source,
          combinerBasis: plan.combinerBasis,
        }).toEqual(c.plan);
        expect(plan.branchSlotWarning).toBeUndefined();
        for (const k of STANDALONE_PLAN_KEYS) expect(k in plan, k).toBe(false);
        // The only keys the pre-change plan had (branchSlotWarning undefined-valued).
        expect(Object.keys(plan).sort()).toEqual([
          'brains', 'branchSlotWarning', 'branchSlots', 'brand', 'combinerBasis', 'devices',
          'hasIntegratedGateway', 'providesAcDisconnect', 'source',
        ]);
      });

      it.each(['LOAD_SIDE', 'SUPPLY_SIDE_TAP', null] as Variant[])('metering (%s): same drawing, same resolution', (v) => {
        const m = resolveDesignMetering({ plan: meteringSlice(plan), interconnectionRaw: v, systemVoltage: 240 });
        expect(withoutLeads(m.drawing)).toEqual(integratedDrawing(c.model, v));
        expect(m.scheduleValue).toBe(
          v === 'LOAD_SIDE' ? 'PROD (INT.) · CONS (NET)'
          : v === 'SUPPLY_SIDE_TAP' ? 'PROD (INT.) · CONS (TOTAL)'
          : 'PROD (INT.) · CONS (MODE TBD)');
        expect(m.resolution?.consumptionMeteringProvided).toBe(true);
        expect(m.resolution?.lines.map(l => [l.partNumber, l.quantity])).toEqual(c.lines);
        expect(m.resolution?.blockerCode).toBe(
          c.lines.length ? 'CT-SKU-UNVERIFIED' : v === null ? 'CT-TOPOLOGY-UNRESOLVED' : null);
        expect(m.placement).toEqual(
          v === 'LOAD_SIDE' ? { location: 'sec-line-side-of-main', basis: 'interconnection-default', boundary: 'service-entrance-upstream-of-pv' }
          : v === 'SUPPLY_SIDE_TAP' ? { location: 'between-tap-and-main', basis: 'interconnection-default', boundary: 'load-side-downstream-of-pv' }
          : { location: null, basis: 'unresolved', boundary: 'unresolved' });
        // The one permitted difference.
        if (v === null) expect('leads' in (m.drawing ?? {})).toBe(false);
        else expect(m.drawing?.leads).toEqual(c.leadsLoadSide);
      });

      it('sldCombinerFields: same names, same flags, same keys', () => {
        const f = fieldsFor(c.fieldsOver);
        expect(f.combinerLabel).toBe(c.label);
        expect(f.combinerModel).toBe(c.label);
        expect(f.combinerHasIntegratedGateway).toBe(true);
        expect(f.combinerProvidesAcDisconnect).toBe(c.plan.providesAcDisconnect);
        expect(f.combinerSelectionIsDecided).toBe(c.decided);
        expect(f.combinerMeteringSummary).toBe('PROD (INT.) · CONS (NET)');
        expect(withoutLeads(f.meteringDrawing)).toEqual(integratedDrawing(c.model, 'LOAD_SIDE'));
        expect(Object.keys(f).sort()).toEqual([
          'combinerHasIntegratedGateway', 'combinerLabel', 'combinerMeteringSummary', 'combinerModel',
          'combinerProvidesAcDisconnect', 'combinerSelectionIsDecided', 'metering', 'meteringDrawing', 'plan',
        ]);
      });
    });
  }

  describe('(iv) a SolarEdge string job', () => {
    const ctx: SystemBosContext = {
      ...enphaseCtx(), inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H-US', isMicro: false,
      totalDevices: 0, branchCount: 2, compatibleCombinerIds: combinerCompatibilityFor('SolarEdge', 'SE7600H-US', 'se-7600h'),
    };

    it('an empty plan with none of the new keys', () => {
      const plan = resolveIntegratedEquipment(ctx);
      expect(plan).toEqual({ brand: null, devices: [], hasIntegratedGateway: false, providesAcDisconnect: false, source: 'none' });
      expect(Object.keys(plan).sort()).toEqual(['brand', 'devices', 'hasIntegratedGateway', 'providesAcDisconnect', 'source']);
    });

    it('asserts no metering, and names no combiner', () => {
      const f = fieldsFor({ inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H-US', inverterId: 'se-7600h',
        isMicro: false, totalDevices: 0, branchCount: 2 });
      expect(f.combinerLabel).toBeUndefined();
      expect(f.combinerModel).toBeUndefined();
      expect(f.combinerHasIntegratedGateway).toBe(false);
      expect(f.combinerProvidesAcDisconnect).toBe(false);
      expect(f.combinerSelectionIsDecided).toBe(false);
      expect(f.combinerMeteringSummary).toBeUndefined();
      expect(f.metering).toBeNull();
      expect(f.meteringDrawing).toBeNull();
      expect(Object.keys(f).sort()).toEqual([
        'combinerHasIntegratedGateway', 'combinerLabel', 'combinerMeteringSummary', 'combinerModel',
        'combinerProvidesAcDisconnect', 'combinerSelectionIsDecided', 'metering', 'meteringDrawing', 'plan',
      ]);
    });
  });

  it('the hybrid lanes name the same combiners as before', () => {
    const h = resolveHybridAcCollection([
      { key: 'roof', inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', isMicro: true, branchCount: 3, deviceCount: 30,
        backfeedA: 40, compatibleCombinerIds: combinerCompatibilityFor('Enphase', 'IQ8+', 'enphase-iq8plus') },
      { key: 'roof-6c', inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', isMicro: true, branchCount: 3, deviceCount: 30,
        backfeedA: 40, selectedCombinerId: 'enphase-iq-combiner-6c' },
      { key: 'ground', inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H-US', isMicro: false, branchCount: 2,
        deviceCount: 0, backfeedA: 40 },
    ]);
    expect(h.perSource.map(p => [p.key, p.combiner?.id ?? null, p.combinerBasis ?? null])).toEqual([
      ['roof', 'enphase-iq-combiner-5c', 'declared-compatibility'],
      ['roof-6c', 'enphase-iq-combiner-6c', 'project-selected'],
      ['ground', null, null],
    ]);
    expect(h.sharedPanel?.id).toBe('pv-ac-combiner-125');
    expect(h.disconnectA).toBe(125);
  });
});
