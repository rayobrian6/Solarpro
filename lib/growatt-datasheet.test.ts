/**
 * v47.420 — Stage 5.1 — Growatt MIN TL-XH-US datasheet regression tests.
 *
 * Locks in every spec field against the manufacturer-published datasheets:
 *   3–7.6 kW:  https://us.growatt.com/upload/file/MIN_3000-7600TL-XH-US_Datasheet_EN_202401.pdf
 *   8.2–11.4:  https://us.growatt.com/upload/file/MIN_8200-11400TL-XH-US_Datasheet_EN_202402.pdf
 *
 * These tests exist so any future edit to equipment-db.ts that accidentally
 * corrupts a Growatt spec will immediately fail CI. The family-constant
 * electrical parameters (max input current, short-circuit current, max DC
 * voltage, nominal DC voltage, integrated DC disconnect) are locked across
 * all 5 SKUs in one parameterized suite.
 */
import { describe, it, expect } from 'vitest';
import { STRING_INVERTERS, getInverterById } from './equipment-db';

const GROWATT_SKUS = [
  'growatt-min-5000tl-xh-us',
  'growatt-min-6000tl-xh-us',
  'growatt-min-7600tl-xh-us',
  'growatt-min-10000tl-xh-us',
  'growatt-min-11400tl-xh-us',
] as const;

describe('v47.420 — Growatt MIN TL-XH-US datasheet lock-in', () => {
  describe('Registry presence', () => {
    it.each(GROWATT_SKUS)('registers %s in STRING_INVERTERS', (id) => {
      const inv = getInverterById(id);
      expect(inv).toBeDefined();
      expect(inv?.manufacturer).toBe('Growatt');
      expect(inv?.category).toBe('string_inverter');
    });

    it('exposes all 5 Growatt SKUs via the registry', () => {
      const growatt = STRING_INVERTERS.filter(i => i.manufacturer === 'Growatt');
      expect(growatt).toHaveLength(5);
    });
  });

  // ─── Family-constant electrical parameters ──────────────────────
  // These values are IDENTICAL across all 9 TL-XH-US models per the
  // manufacturer datasheet. Locking them as a family invariant catches
  // any accidental per-SKU override.
  describe('Family-constant electrical parameters (all SKUs identical)', () => {
    it.each(GROWATT_SKUS)('%s: max DC voltage = 600 V', (id) => {
      expect(getInverterById(id)?.maxDcVoltage).toBe(600);
    });

    it.each(GROWATT_SKUS)('%s: max input current per MPPT = 13.5 A', (id) => {
      expect(getInverterById(id)?.maxInputCurrentPerMppt).toBe(13.5);
    });

    it.each(GROWATT_SKUS)('%s: max short-circuit current per MPPT = 16.9 A', (id) => {
      expect(getInverterById(id)?.maxShortCircuitCurrent).toBe(16.9);
    });

    it.each(GROWATT_SKUS)('%s: max parallel strings per MPPT = 2', (id) => {
      expect(getInverterById(id)?.maxParallelStringsPerMppt).toBe(2);
    });

    it.each(GROWATT_SKUS)('%s: nominal DC bus voltage = 360 V', (id) => {
      expect(getInverterById(id)?.nominalDcVoltage).toBe(360);
    });

    it.each(GROWATT_SKUS)('%s: factory-integrated DC disconnect = true', (id) => {
      expect(getInverterById(id)?.integratedDcDisconnect).toBe(true);
    });

    it.each(GROWATT_SKUS)('%s: rapid shutdown compliant', (id) => {
      expect(getInverterById(id)?.rapidShutdownCompliant).toBe(true);
    });

    it.each(GROWATT_SKUS)('%s: arc-fault protection (built-in AFCI UL 1699B)', (id) => {
      expect(getInverterById(id)?.arcFaultProtection).toBe(true);
    });

    it.each(GROWATT_SKUS)('%s: ground-fault protection', (id) => {
      expect(getInverterById(id)?.groundFaultProtection).toBe(true);
    });

    it.each(GROWATT_SKUS)('%s: UL 1741-SB listing', (id) => {
      const inv = getInverterById(id);
      expect(inv?.ulListing).toMatch(/UL 1741-SB/);
    });

    it.each(GROWATT_SKUS)('%s: ecosystem brand tag = growatt', (id) => {
      expect(getInverterById(id)?.ecosystemBrand).toBe('growatt');
    });

    it.each(GROWATT_SKUS)('%s: ecosystem family tag = min-tl-xh', (id) => {
      expect(getInverterById(id)?.ecosystemFamily).toBe('min-tl-xh');
    });

    it.each(GROWATT_SKUS)('%s: datasheetUrl points to us.growatt.com', (id) => {
      const url = getInverterById(id)?.datasheetUrl;
      expect(url).toMatch(/^https:\/\/us\.growatt\.com\//);
      expect(url).toMatch(/\.pdf$/);
    });
  });

  // ─── Per-SKU model-specific datasheet values ───────────────────
  describe('MIN 5000TL-XH-US datasheet values', () => {
    const inv = getInverterById('growatt-min-5000tl-xh-us')!;
    it('AC output = 5.0 kW', () => { expect(inv.acOutputKw).toBe(5.0); });
    it('DC input max = 10.0 kW (2:1 DC/AC ratio)', () => { expect(inv.dcInputKwMax).toBe(10.0); });
    it('MPPT channels = 2', () => { expect(inv.mpptChannels).toBe(2); expect(inv.numberOfMPPT).toBe(2); });
    it('Full-load voltage range 200–500 V', () => {
      expect(inv.mpptVoltageMin).toBe(200);
      expect(inv.mpptVoltageMax).toBe(500);
    });
    it('Max AC output current = 21.0 A @ 240 V', () => { expect(inv.acOutputCurrentMax).toBe(21.0); });
  });

  describe('MIN 6000TL-XH-US datasheet values', () => {
    const inv = getInverterById('growatt-min-6000tl-xh-us')!;
    it('AC output = 6.0 kW', () => { expect(inv.acOutputKw).toBe(6.0); });
    it('DC input max = 12.0 kW', () => { expect(inv.dcInputKwMax).toBe(12.0); });
    it('MPPT channels = 3 (first 3-MPPT model in the family)', () => { expect(inv.mpptChannels).toBe(3); expect(inv.numberOfMPPT).toBe(3); });
    it('Full-load voltage range 160–500 V', () => {
      expect(inv.mpptVoltageMin).toBe(160);
      expect(inv.mpptVoltageMax).toBe(500);
    });
    it('Max AC output current = 25.0 A @ 240 V', () => { expect(inv.acOutputCurrentMax).toBe(25.0); });
  });

  describe('MIN 7600TL-XH-US datasheet values', () => {
    const inv = getInverterById('growatt-min-7600tl-xh-us')!;
    it('AC output = 7.6 kW', () => { expect(inv.acOutputKw).toBe(7.6); });
    it('DC input max = 15.2 kW', () => { expect(inv.dcInputKwMax).toBe(15.2); });
    it('MPPT channels = 3', () => { expect(inv.mpptChannels).toBe(3); });
    it('Full-load voltage range 200–500 V', () => {
      expect(inv.mpptVoltageMin).toBe(200);
      expect(inv.mpptVoltageMax).toBe(500);
    });
    it('Max AC output current = 32.0 A @ 240 V', () => { expect(inv.acOutputCurrentMax).toBe(32.0); });
  });

  describe('MIN 10000TL-XH-US datasheet values', () => {
    const inv = getInverterById('growatt-min-10000tl-xh-us')!;
    it('AC output = 10.0 kW', () => { expect(inv.acOutputKw).toBe(10.0); });
    it('DC input max = 20.0 kW', () => { expect(inv.dcInputKwMax).toBe(20.0); });
    it('MPPT channels = 3', () => { expect(inv.mpptChannels).toBe(3); });
    it('Full-load voltage range 200–500 V', () => {
      expect(inv.mpptVoltageMin).toBe(200);
      expect(inv.mpptVoltageMax).toBe(500);
    });
    it('Max AC output current = 42.0 A @ 240 V', () => { expect(inv.acOutputCurrentMax).toBe(42.0); });
  });

  describe('MIN 11400TL-XH-US datasheet values (family flagship)', () => {
    const inv = getInverterById('growatt-min-11400tl-xh-us')!;
    it('AC output = 11.4 kW', () => { expect(inv.acOutputKw).toBe(11.4); });
    it('DC input max = 22.8 kW', () => { expect(inv.dcInputKwMax).toBe(22.8); });
    it('MPPT channels = 3', () => { expect(inv.mpptChannels).toBe(3); });
    it('Full-load voltage range 220–500 V (tightest in family)', () => {
      expect(inv.mpptVoltageMin).toBe(220);
      expect(inv.mpptVoltageMax).toBe(500);
    });
    it('Max AC output current = 48.0 A @ 240 V', () => { expect(inv.acOutputCurrentMax).toBe(48.0); });
    it('Max efficiency = 98.5% (highest in family)', () => { expect(inv.efficiency).toBe(98.5); });
  });

  // ─── Spec-completeness gate ─────────────────────────────────────
  // Guards against a future edit dropping any required field and
  // triggering DATASHEET_MISSING in the compliance evaluator.
  describe('Required spec fields are defined on every Growatt SKU', () => {
    it.each(GROWATT_SKUS)('%s: all required fields defined', (id) => {
      const inv = getInverterById(id);
      expect(inv).toBeDefined();
      expect(inv!.acOutputKw).toBeDefined();
      expect(inv!.dcInputKwMax).toBeDefined();
      expect(inv!.maxDcVoltage).toBeDefined();
      expect(inv!.mpptVoltageMin).toBeDefined();
      expect(inv!.mpptVoltageMax).toBeDefined();
      expect(inv!.mpptChannels).toBeDefined();
      expect(inv!.numberOfMPPT).toBeDefined();
      expect(inv!.maxInputCurrentPerMppt).toBeDefined();
      expect(inv!.maxShortCircuitCurrent).toBeDefined();
      expect(inv!.maxParallelStringsPerMppt).toBeDefined();
      expect(inv!.nominalDcVoltage).toBeDefined();
      expect(inv!.integratedDcDisconnect).toBeDefined();
      expect(inv!.acOutputVoltage).toBeDefined();
      expect(inv!.acOutputCurrentMax).toBeDefined();
      expect(inv!.efficiency).toBeDefined();
      expect(inv!.cec_efficiency).toBeDefined();
      expect(inv!.datasheetUrl).toBeDefined();
      expect(inv!.ulListing).toBeDefined();
      expect(inv!.rapidShutdownCompliant).toBeDefined();
      expect(inv!.arcFaultProtection).toBeDefined();
      expect(inv!.groundFaultProtection).toBeDefined();
    });
  });
});

describe('v47.420 — Growatt brand profile integration', () => {
  it('GROWATT_PROFILE exports and registers in BRAND_PROFILES', async () => {
    const { GROWATT_PROFILE, BRAND_PROFILES, getBrandProfile } = await import('./system/brandProfiles');
    expect(GROWATT_PROFILE).toBeDefined();
    expect(GROWATT_PROFILE.id).toBe('growatt');
    expect(GROWATT_PROFILE.topology).toBe('hybrid');
    expect(BRAND_PROFILES.map(p => p.id)).toContain('growatt');
    expect(getBrandProfile('growatt')?.displayName).toBe('Growatt');
  });

  it('Every supportedInverterModels equipmentDbId resolves to a real registry entry', async () => {
    const { GROWATT_PROFILE } = await import('./system/brandProfiles');
    for (const model of GROWATT_PROFILE.supportedInverterModels) {
      const inv = getInverterById(model.equipmentDbId);
      expect(inv, `registry missing ${model.equipmentDbId}`).toBeDefined();
      expect(inv!.manufacturer).toBe('Growatt');
    }
  });

  it('Sizing tiers cover 0→Infinity DC kW with no gaps', async () => {
    const { GROWATT_PROFILE } = await import('./system/brandProfiles');
    const tiers = [...GROWATT_PROFILE.sizingTiers].sort((a, b) => a.minDcKw - b.minDcKw);
    expect(tiers[0].minDcKw).toBe(0);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].minDcKw).toBe(tiers[i - 1].maxDcKw);
    }
    expect(tiers[tiers.length - 1].maxDcKw).toBe(Infinity);
  });

  it('Every tier equipmentDbId is in supportedInverterModels', async () => {
    const { GROWATT_PROFILE } = await import('./system/brandProfiles');
    const supportedIds = new Set(GROWATT_PROFILE.supportedInverterModels.map(m => m.equipmentDbId));
    for (const tier of GROWATT_PROFILE.sizingTiers) {
      expect(supportedIds.has(tier.equipmentDbId), `tier references unlisted model ${tier.equipmentDbId}`).toBe(true);
    }
  });

  it('Registered in ECOSYSTEM_BRANDS for UI picker', async () => {
    const { ECOSYSTEM_BRANDS } = await import('./system/brandProfiles/resolveBrandEquipment');
    const growatt = ECOSYSTEM_BRANDS.find(b => b.id === 'growatt');
    expect(growatt).toBeDefined();
    expect(growatt!.displayName).toBe('Growatt');
  });

  it('Battery config marks hybrid capable but not required', async () => {
    const { GROWATT_PROFILE } = await import('./system/brandProfiles');
    expect(GROWATT_PROFILE.battery.capable).toBe(true);
    expect(GROWATT_PROFILE.battery.required).toBe(false);
    expect(GROWATT_PROFILE.battery.sizingStrategy).toBe('modular_stack');
  });
});