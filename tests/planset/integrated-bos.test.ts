import { describe, it, expect } from 'vitest';
import { resolveIntegratedEquipment, enphaseGeneration, getBosDevice } from '@/lib/equipment/integratedBos';
import { buildIntegratedEquipment } from '@/lib/permit/utils/integratedEquipment';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import type { CADModel } from '@/lib/cad/types';

const ctx = (over: Partial<Parameters<typeof resolveIntegratedEquipment>[0]> = {}) => resolveIntegratedEquipment({
  inverterManufacturer: 'Enphase', inverterModel: 'IQ8M', isMicro: true,
  totalDevices: 12, branchCount: 3, hasBattery: false, ...over,
});

describe('integrated BOS device resolver', () => {
  it('detects Enphase generation from the model string', () => {
    expect(enphaseGeneration('IQ8M')).toBe('gen4');
    expect(enphaseGeneration('IQ8+')).toBe('gen4');
    expect(enphaseGeneration('IQ7A')).toBe('gen3');
    expect(enphaseGeneration('SE7600H')).toBeNull();
  });

  it('auto-configures the current-gen IQ Combiner 6C (one box: combiner + gateway + integral disconnect)', () => {
    const plan = ctx({ branchCount: 3 });
    expect(plan.source).toBe('auto');
    expect(plan.brains?.model).toBe('IQ Combiner 6C');     // best / easiest install
    expect(plan.brains?.partNumber).toBe('X-IQ-AM1-240-6C');
    expect(plan.hasIntegratedGateway).toBe(true);          // no separate Envoy
    expect(plan.providesAcDisconnect).toBe(true);          // its aggregate breaker is the PV disconnect
    expect(plan.brains?.roleSummary).toContain('Combiner');
    expect(plan.brains?.roleSummary).toContain('Gateway');
    expect(plan.brains?.roleSummary).toContain('Disconnect');
    expect(plan.branchSlotWarning).toBeUndefined();
  });

  it('defaults to the 6C regardless of micro model (generation is an ecosystem line)', () => {
    expect(ctx({ inverterModel: 'IQ7+' }).brains?.model).toBe('IQ Combiner 6C');
    expect(ctx({ inverterModel: 'IQ8H' }).brains?.model).toBe('IQ Combiner 6C');
  });

  it('warns when AC branches exceed the 6C PV busbar (4, or 5 with a quadplex)', () => {
    const plan = ctx({ branchCount: 8 });
    expect(plan.brains?.model).toBe('IQ Combiner 6C');
    expect(plan.branchSlotWarning).toMatch(/exceed the IQ Combiner 6C PV busbar/);
  });

  it('honors an explicit user override (e.g. the older main-lug 4C — no integral disconnect)', () => {
    const plan = ctx({ overrideDeviceIds: ['enphase-iq-combiner-4c'] });
    expect(plan.source).toBe('override');
    expect(plan.brains?.model).toBe('IQ Combiner 4C');
    expect(plan.providesAcDisconnect).toBe(false);   // 4C is main-lug only → needs external AC disconnect
    expect(plan.hasIntegratedGateway).toBe(true);
  });

  it('returns an empty plan for non-Enphase / string systems', () => {
    expect(resolveIntegratedEquipment({ inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H', isMicro: false, totalDevices: 0, branchCount: 0, hasBattery: false }).source).toBe('none');
  });

  it('resolves from a real PermitInput (roofProject is Enphase IQ8M micro)', () => {
    const cad = { systemType: 'roof', totalPanels: 12, totalDcKw: 5.16 } as CADModel;
    const plan = buildIntegratedEquipment(JSON.parse(JSON.stringify(roofProject)), cad);
    expect(plan.brand).toBe('Enphase');
    expect(plan.brains?.kind).toBe('integrated_combiner');
    expect(plan.hasIntegratedGateway).toBe(true);
  });

  it('a user override flows end-to-end through the rendered planset', () => {
    // Phase-5 hook: setting project.bosDeviceIds (what the design-studio picker
    // will write) makes every sheet render the chosen device instead of the
    // auto-configured 6C — proving the selection plumbing is wired.
    const p = JSON.parse(JSON.stringify(roofProject));
    p.project.bosDeviceIds = ['enphase-iq-combiner-5c'];
    const html = generatePermitHTML(p);
    expect(html).toContain('IQ Combiner 5C');   // the overridden device renders
    // the auto-config default (6C) must not leak onto the disconnect directory
    expect(html).not.toContain('ENPHASE IQ COMBINER 6C');
  });

  it('exposes catalog lookup by id', () => {
    expect(getBosDevice('enphase-iq-combiner-6c')?.branchSlots).toBe(4);   // "6C" is a gen name, not a slot count
    expect(getBosDevice('tesla-backup-switch')?.partNumber).toBe('1624171');
    expect(getBosDevice('nope')).toBeUndefined();
  });
});
