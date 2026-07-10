import { describe, it, expect } from 'vitest';
import { resolveIntegratedEquipment, enphaseGeneration, getBosDevice } from '@/lib/equipment/integratedBos';
import { buildIntegratedEquipment } from '@/lib/permit/utils/integratedEquipment';
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

  it('auto-configures the integrated Gen-4 combiner (one box: combiner + gateway + disconnect)', () => {
    const plan = ctx({ branchCount: 3 });
    expect(plan.source).toBe('auto');
    expect(plan.brains?.model).toBe('IQ Combiner 4C');   // ≤4 branches → 4C
    expect(plan.hasIntegratedGateway).toBe(true);          // no separate Envoy
    expect(plan.providesAcDisconnect).toBe(true);          // no separate AC disconnect
    expect(plan.brains?.roleSummary).toContain('Combiner');
    expect(plan.brains?.roleSummary).toContain('Gateway');
    expect(plan.brains?.roleSummary).toContain('Disconnect');
  });

  it('scales to the 6C when branches exceed the 4C slot count', () => {
    const plan = ctx({ branchCount: 5 });
    expect(plan.brains?.model).toBe('IQ Combiner 6C');
    expect(plan.branchSlots).toBe(6);
    expect(plan.branchSlotWarning).toBeUndefined();
  });

  it('warns when the branch count exceeds even the 6C slot capacity', () => {
    const plan = ctx({ branchCount: 8 });
    expect(plan.brains?.model).toBe('IQ Combiner 6C');
    expect(plan.branchSlotWarning).toMatch(/exceed the IQ Combiner 6C 6-position limit/);
  });

  it('falls back to a standalone Envoy for Gen-3 (more boxes on the wall)', () => {
    const plan = ctx({ inverterModel: 'IQ7+' });
    expect(plan.brains?.model).toBe('IQ Gateway (Envoy)');
    expect(plan.hasIntegratedGateway).toBe(false);   // separate box
    expect(plan.providesAcDisconnect).toBe(false);   // separate AC disconnect required
  });

  it('honors an explicit user override', () => {
    const plan = ctx({ overrideDeviceIds: ['enphase-iq-combiner-6c'] });
    expect(plan.source).toBe('override');
    expect(plan.brains?.model).toBe('IQ Combiner 6C');
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

  it('exposes catalog lookup by id', () => {
    expect(getBosDevice('enphase-iq-combiner-6c')?.branchSlots).toBe(6);
    expect(getBosDevice('nope')).toBeUndefined();
  });
});
