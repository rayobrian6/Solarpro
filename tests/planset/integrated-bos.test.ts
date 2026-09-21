import { describe, it, expect } from 'vitest';
import { resolveIntegratedEquipment, enphaseGeneration, getBosDevice, resolveCompatibleCombiner } from '@/lib/equipment/integratedBos';
import { combinerCompatibilityFor } from '@/lib/equipment/combinerCompatibility';
import { buildIntegratedEquipment } from '@/lib/permit/utils/integratedEquipment';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import type { CADModel } from '@/lib/cad/types';

/**
 * 🚨 THIS FIXTURE USED TO OMIT `compatibleCombinerIds`, SO IT ONLY EVER TESTED
 * THE FALLBACK BRANCH.
 *
 * `resolveIntegratedEquipment` picks the combiner from the pairing the selected
 * inverter declares in equipment-db, and falls back to the current-generation 6C
 * when no pairing is supplied. Every IQ8 row declares
 * `compatibleWith: ['enphase-iq-combiner-5', ...]`, so production resolves the
 * 5C — while these tests, which supplied nothing, asserted the 6C six times and
 * passed. A fixture that cannot exhibit the production shape cannot prove
 * anything about it.
 *
 * `ctx()` is now the PRODUCTION shape: it carries the pairing, resolved by the
 * same `combinerCompatibilityFor` every call site uses. `ctxNoPairing()` keeps
 * the fallback covered, explicitly and separately, because the fallback is real
 * behaviour for an inverter the catalogue does not know.
 */
const ctx = (over: Partial<Parameters<typeof resolveIntegratedEquipment>[0]> = {}) => {
  const inverterModel = (over.inverterModel as string) ?? 'IQ8M';
  return resolveIntegratedEquipment({
    inverterManufacturer: 'Enphase', inverterModel, isMicro: true,
    totalDevices: 12, branchCount: 3, hasBattery: false,
    compatibleCombinerIds: combinerCompatibilityFor('Enphase', inverterModel),
    ...over,
  });
};

/** The fallback branch: an inverter the catalogue declares no pairing for. */
const ctxNoPairing = (over: Partial<Parameters<typeof resolveIntegratedEquipment>[0]> = {}) => resolveIntegratedEquipment({
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

  it('auto-configures the combiner the CATALOGUE pairs with the selected inverter', () => {
    const plan = ctx({ branchCount: 3 });
    expect(plan.source).toBe('auto');
    // Asserted against the catalogue rather than a hard-coded model, because
    // WHICH device is correct is manufacturer data. If equipment-db's IQ8
    // pairing is ever corrected to the 6C, this test follows it instead of
    // having to be rewritten — and it still fails if the resolver ignores it.
    const paired = combinerCompatibilityFor('Enphase', 'IQ8M');
    expect(paired, 'the catalogue must declare a pairing for IQ8M').toBeTruthy();
    expect(resolveCompatibleCombiner(paired)?.model).toBe(plan.brains?.model);
    // Today that is the 5C, which is MAIN-LUG: no integral AC disconnecting
    // means. That is a NEC 690.13 statement on the sheets, so it is pinned.
    expect(plan.brains?.model).toBe('IQ Combiner 5C');
    expect(plan.hasIntegratedGateway).toBe(true);          // no separate gateway on the wall
    expect(plan.providesAcDisconnect).toBe(false);
    expect(plan.brains?.roleSummary).toContain('Combiner');
    expect(plan.brains?.roleSummary).toContain('Gateway');
    expect(plan.branchSlotWarning).toBeUndefined();
  });

  it('falls back to the current-gen 6C ONLY when the catalogue declares no pairing', () => {
    const plan = ctxNoPairing();
    expect(plan.brains?.model).toBe('IQ Combiner 6C');
    expect(plan.brains?.partNumber).toBe('X-IQ-AM1-240-6C');
    expect(plan.providesAcDisconnect).toBe(true);          // the 6C DOES have one
    expect(plan.brains?.roleSummary).toContain('Disconnect');
  });

  it('follows the catalogue across micro models rather than defaulting', () => {
    for (const model of ['IQ7+', 'IQ8H']) {
      const paired = combinerCompatibilityFor('Enphase', model);
      const expected = paired ? resolveCompatibleCombiner(paired)?.model : 'IQ Combiner 6C';
      expect(ctx({ inverterModel: model }).brains?.model).toBe(expected);
    }
  });

  it('warns when AC branches exceed the resolved combiner PV busbar', () => {
    // On the fallback device the warning names the 6C; on the paired device it
    // names the 5C. The warning must describe the device that was RESOLVED, not
    // a fixed one, or it tells the installer about hardware they do not have.
    const fallback = ctxNoPairing({ branchCount: 8 });
    expect(fallback.brains?.model).toBe('IQ Combiner 6C');
    expect(fallback.branchSlotWarning).toMatch(/exceed the IQ Combiner 6C PV busbar/);

    const paired = ctx({ branchCount: 8 });
    expect(paired.brains?.model).toBe('IQ Combiner 5C');
    expect(paired.branchSlotWarning).toMatch(/exceed the IQ Combiner 5C PV busbar/);
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
