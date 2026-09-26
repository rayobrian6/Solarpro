/**
 * tests/ecosystemEnvoyPick.test.ts
 *
 * "WHATEVER ENVOY I WANT" — THE PICK MUST LAND, AND ONLY WHERE IT CAN BE CARRIED.
 *
 * 🚨 THE DEFECT: the ecosystem picker auto-selected the kit's first monitoring
 * gateway — for Enphase the bare IQ Gateway — and emitted it as `gatewayId`.
 * The engineering page applied only the inverter and the battery, and the
 * banner counted the gateway as "configured". The installer's Envoy went
 * nowhere, while the combiner card beside it could not offer a bare gateway at
 * all.
 *
 * Traced before deciding which way to repair it: a bare IQ Gateway recorded as
 * the project's combiner resolves to a plan with NO combiner in it. The SLD
 * route / sldCombinerFields hand its name to the renderer, which draws it as the
 * AC COMBINER with the branch breakers inside it; the BOM buys the gateway and
 * then falls back to the inverter's legacy combiner accessory. A drawing of a
 * box the BOM did not buy — so a bare gateway is NOT made selectable, and the
 * Envoy choice is which IQ Combiner (each has the IQ Gateway built in) — OR the
 * standalone topology ('enphase-iq-gateway-standalone', 2026-09-26): the IQ
 * Gateway in its own enclosure PLUS the PV AC combiner panel the branches land
 * in, resolved as two devices so nothing names the gateway as the combiner.
 *
 * This file pins the catalogue half (what is storable), the store half (a
 * non-combiner is declined by name, never by questioning the installer), and
 * the route half (the reader and the candidates are one set).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOS_DEVICES,
  getBosDevice,
  isSelectableCombiner,
  listCombiners,
  planLandingDevice,
  resolveIntegratedEquipment,
} from '@/lib/equipment/integratedBos';
import { planCombinerSelection, type CombinerDeviceFacts } from '@/lib/combinerSelection/service';
import { MICROINVERTERS } from '@/lib/equipment-db';
import { stripCommentsAndStrings } from './support/stripSource';

const GATEWAY = 'enphase-iq-gateway';
const FIVE_C = 'enphase-iq-combiner-5c';

const IQ8 = MICROINVERTERS.find(m => /enphase/i.test(m.manufacturer) && /IQ8/i.test(m.model))!;

/** The route's reader, fact for fact (app/api/projects/[id]/combiner-selection). */
const routeLookup = (id: string): CombinerDeviceFacts | null => {
  const d = getBosDevice(id);
  return d
    ? { id: d.id, manufacturer: d.brand, model: d.model, modelNumber: null, isSelectableCombiner: isSelectableCombiner(d.id) }
    : null;
};

const pick = (deviceId: string, lookupDevice = routeLookup) => planCombinerSelection({
  deviceId,
  lookupDevice,
  inverterId: IQ8.id,
  declaredCompatibleIds: null,
  actor: { id: 'ray@example.com', kind: 'user' },
  atIso: '2026-09-25T12:00:00.000Z',
  basis: null,
  current: null,
});

describe('the control — the catalogue really does know the bare gateway', () => {
  it('getBosDevice resolves it, so only an explicit rule keeps it out of the store', () => {
    // If this stops being true the hazard below is gone and the file should say so.
    expect(getBosDevice(GATEWAY)?.kind).toBe('gateway');
  });
});

describe('🚨 what is storable is exactly what the picker offers', () => {
  it('every listed combiner is selectable, and nothing else is', () => {
    const listed = new Set(listCombiners().map(d => d.id));
    expect(listed.size, 'no selectable combiners at all').toBeGreaterThan(0);
    for (const d of BOS_DEVICES) {
      expect(isSelectableCombiner(d.id), d.id).toBe(listed.has(d.id));
    }
  });

  it('the bare IQ Gateway, the meter collar and the generic panels are NOT selectable', () => {
    for (const id of [GATEWAY, 'enphase-iq-meter-collar', 'tesla-backup-switch', 'pv-ac-combiner-125']) {
      expect(isSelectableCombiner(id), id).toBe(false);
    }
    expect(isSelectableCombiner('acme-combiner-9000')).toBe(false);
    expect(isSelectableCombiner('')).toBe(false);
    expect(isSelectableCombiner('   ')).toBe(false);
    expect(isSelectableCombiner(null)).toBe(false);
    expect(isSelectableCombiner(undefined)).toBe(false);
  });

  it('the Enphase Envoy choices are the IQ Combiners (gateway built in) and the standalone topology — never the bare gateway', () => {
    const enphase = listCombiners('enphase');
    expect(enphase.length).toBeGreaterThan(0);
    for (const d of enphase) {
      expect(['integrated_combiner', 'gateway_system']).toContain(d.kind);
      expect(d.integrated.monitoring, `${d.model} must carry the gateway`).toBe(true);
    }
    expect(enphase.map(d => d.id)).toContain('enphase-iq-gateway-standalone');
    expect(enphase.map(d => d.id)).not.toContain(GATEWAY);
  });

  it('why: every selectable device resolves to a plan whose brains HAS branch positions; the gateway does not', () => {
    // The SLD lands the AC branches in the resolved brains and the BOM buys it as
    // the combiner. A selectable device must be something the branches can land in.
    const ctx = (selectedCombinerId: string) => resolveIntegratedEquipment({
      inverterManufacturer: IQ8.manufacturer, inverterModel: IQ8.model, isMicro: true,
      totalDevices: 24, branchCount: 2, hasBattery: false, selectedCombinerId,
    });
    for (const d of listCombiners()) {
      const plan = ctx(d.id);
      if (d.kind === 'gateway_system') {
        // Two boxes: the branches land in the PV AC combiner panel; the gateway
        // is its own device. The landing rule — never the brains — names the combiner.
        expect(plan.gatewayPlacement).toBe('standalone');
        expect(planLandingDevice(plan)?.kind).toBe('ac_combiner');
        expect(plan.gateway?.id).toBe(GATEWAY);
        expect(plan.branchSlots ?? 0, d.id).toBeGreaterThan(0);
        continue;
      }
      expect(plan.brains?.id).toBe(d.id);
      expect(plan.brains?.kind).toBe('integrated_combiner');
      expect(plan.brains?.branchSlots ?? 0, d.id).toBeGreaterThan(0);
    }
    const gw = ctx(GATEWAY);
    expect(gw.devices.some(d => d.kind === 'integrated_combiner' || d.kind === 'ac_combiner'),
      'a bare gateway plan now contains a combiner — revisit whether it can be selectable').toBe(false);
    expect(gw.brains?.branchSlots).toBeUndefined();
  });
});

describe('🚨 the store declines a non-combiner BY NAME — and questions nobody', () => {
  it('a bare gateway is refused as NOT_A_SELECTABLE_COMBINER, not as unknown', () => {
    const r = pick(GATEWAY);
    expect(r.ok).toBe(false);
    expect(r.next).toBeNull();
    const codes = r.refusals.map(x => x.code);
    expect(codes).toContain('NOT_A_SELECTABLE_COMBINER');
    expect(codes).not.toContain('UNKNOWN_DEVICE');
    // It points at the Envoy choice that works, and asks for no reason or authority.
    const msg = r.refusals.find(x => x.code === 'NOT_A_SELECTABLE_COMBINER')!.message;
    expect(msg).toMatch(/IQ Gateway \(Envoy\) built in/);
    expect(msg).not.toMatch(/reason|authority|basis|justif/i);
  });

  it('a non-Enphase device is declined too — and is not handed Enphase advice', () => {
    // The refused set is every catalogue device that is not a listed combiner,
    // which includes the Tesla Backup Switch and the generic PV AC combiner panels.
    for (const id of ['tesla-backup-switch', 'pv-ac-combiner-125']) {
      const r = pick(id);
      const msg = r.refusals.find(x => x.code === 'NOT_A_SELECTABLE_COMBINER')?.message ?? '';
      expect(msg, id).toMatch(/cannot be recorded as one/);
      expect(msg, id).not.toMatch(/IQ|Enphase|Envoy/);
      expect(msg, id).not.toMatch(/reason|authority|basis|justif/i);
    }
  });

  it('every selectable combiner is still recorded on one pick, with no text at all', () => {
    for (const d of listCombiners()) {
      const r = pick(d.id);
      expect(r.refusals, d.id).toEqual([]);
      expect(r.next!.active!.combinerDeviceId).toBe(d.id);
      expect(r.next!.active!.basis).toBeNull();
    }
  });

  it('a reader that does not state the fact refuses nothing new', () => {
    // Only an explicit `false` refuses, so a fixture or reader that predates the
    // fact behaves exactly as it did.
    const bare = (id: string): CombinerDeviceFacts | null =>
      id === FIVE_C ? { id, manufacturer: 'Enphase', model: 'IQ Combiner 5C' } : null;
    expect(pick(FIVE_C, bare).ok).toBe(true);
  });
});

describe('the route — one set for the reader and the candidates', () => {
  const ROUTE = stripCommentsAndStrings(readFileSync(
    join(__dirname, '..', 'app', 'api', 'projects', '[id]', 'combiner-selection', 'route.ts'), 'utf8'));

  it('the POST reader states whether the device is selectable, from the same authority', () => {
    expect(ROUTE).toMatch(/isSelectableCombiner:\s*isSelectableCombiner\(d\.id\)/);
  });

  it('the GET candidates are listCombiners(), which excludes the bare gateway', () => {
    expect(ROUTE).toMatch(/candidates:\s*listCombiners\(\)/);
  });
});

describe('the ecosystem picker emits a STORABLE Envoy, never a gateway id nothing reads', () => {
  const PICKER = stripCommentsAndStrings(readFileSync(
    join(__dirname, '..', 'components', 'engineering', 'EcosystemPicker.tsx'), 'utf8'));

  it('the payload carries combinerId, gated on the same authority', () => {
    expect(PICKER).toMatch(/combinerId:\s*isSelectableCombiner\(selectedCombiner\)/);
  });

  it('🚨 and no longer emits gatewayId', () => {
    expect(PICKER).not.toMatch(/gatewayId/);
  });
});
