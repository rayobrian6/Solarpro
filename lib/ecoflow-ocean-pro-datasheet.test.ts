/**
 * v58.14 — EcoFlow OCEAN Pro datasheet regression tests.
 *
 * Locks in every spec field against the manufacturer-published datasheets:
 *   PCS (inverter): https://enterprise-service-us-cdn.ecoflow.com/
 *                   enterprise/documentation/1760684472240/
 *                   Ocean%20Pro%20PCS%20datasheet%20v1013_View.pdf
 *   BP  (battery):  https://enterprise-service-us-cdn.ecoflow.com/
 *                   enterprise/documentation/1760684383859/
 *                   Ocean%20Pro%20BP%20datasheet%20v1013_View.pdf
 *
 * These tests exist so any future edit to equipment-db.ts that accidentally
 * corrupts an EcoFlow spec will immediately fail CI. The family-constant
 * electrical parameters (MPPT count, MPPT range, DC input, short-circuit
 * current, integrated DC disconnect) are locked across both PCS tiers
 * in one parameterised suite — EF-PCS-24 is ONE hardware platform
 * configured to two AC output tiers (11.5 / 24 kW).
 */
import { describe, it, expect } from 'vitest';
import {
  STRING_INVERTERS,
  BATTERIES,
  getInverterById,
  getBatteryById,
} from './equipment-db';

const OCEAN_PRO_INVERTERS = [
  'ecoflow-ocean-pro-11kw',
  'ecoflow-ocean-pro-24kw',
] as const;

const OCEAN_PRO_BATTERY = 'ecoflow-ocean-pro-bp-10';

// ═══════════════════════════════════════════════════════════════════════════
// Inverter — EF-PCS-24
// ═══════════════════════════════════════════════════════════════════════════
describe('v58.14 — EcoFlow OCEAN Pro PCS (EF-PCS-24) datasheet lock-in', () => {
  describe('Registry presence', () => {
    it.each(OCEAN_PRO_INVERTERS)('registers %s in STRING_INVERTERS', (id) => {
      const inv = getInverterById(id);
      expect(inv).toBeDefined();
      expect(inv?.manufacturer).toBe('EcoFlow');
      expect(inv?.category).toBe('string_inverter');
    });

    it('exposes exactly 2 OCEAN Pro SKUs via the registry', () => {
      const ocean = STRING_INVERTERS.filter(
        (i) => i.manufacturer === 'EcoFlow' && i.ecosystemFamily === 'ocean-pro',
      );
      expect(ocean).toHaveLength(2);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: active === true (US SKU must be selectable)', (id) => {
      expect(getInverterById(id)?.active).toBe(true);
    });
  });

  // ─── Family-constant electrical parameters ──────────────────────────────
  // Per PCS datasheet, EF-PCS-24 is ONE platform with two configured AC
  // output tiers. Every field below is identical across both rows.
  describe('Family-constant electrical parameters (identical across both tiers)', () => {
    it.each(OCEAN_PRO_INVERTERS)('%s: max DC voltage = 600 V', (id) => {
      expect(getInverterById(id)?.maxDcVoltage).toBe(600);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: MPPT voltage range 60–480 V (full-load)', (id) => {
      const inv = getInverterById(id)!;
      expect(inv.mpptVoltageMin).toBe(60);
      expect(inv.mpptVoltageMax).toBe(480);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: 8 MPPT channels (5 kW each)', (id) => {
      const inv = getInverterById(id)!;
      expect(inv.mpptChannels).toBe(8);
      expect(inv.numberOfMPPT).toBe(8);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: max input current per MPPT (Imp) = 16 A', (id) => {
      expect(getInverterById(id)?.maxInputCurrentPerMppt).toBe(16);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: max short-circuit current per MPPT (Isc) = 20 A', (id) => {
      expect(getInverterById(id)?.maxShortCircuitCurrent).toBe(20);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: max DC input = 40 kW STC (datasheet cap)', (id) => {
      expect(getInverterById(id)?.dcInputKwMax).toBe(40.0);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: factory-integrated DC disconnect = true', (id) => {
      expect(getInverterById(id)?.integratedDcDisconnect).toBe(true);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: rapid-shutdown compliant', (id) => {
      expect(getInverterById(id)?.rapidShutdownCompliant).toBe(true);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: built-in AFCI (UL 1699B)', (id) => {
      expect(getInverterById(id)?.arcFaultProtection).toBe(true);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: ground-fault protection', (id) => {
      expect(getInverterById(id)?.groundFaultProtection).toBe(true);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: UL 1741-SB listing', (id) => {
      expect(getInverterById(id)?.ulListing).toMatch(/UL 1741-SB/);
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: ecosystem brand tag = ecoflow', (id) => {
      expect(getInverterById(id)?.ecosystemBrand).toBe('ecoflow');
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: ecosystem family tag = ocean-pro', (id) => {
      expect(getInverterById(id)?.ecosystemFamily).toBe('ocean-pro');
    });

    it.each(OCEAN_PRO_INVERTERS)('%s: datasheetUrl is a published EcoFlow URL', (id) => {
      const url = getInverterById(id)?.datasheetUrl;
      expect(url).toMatch(/^https:\/\/enterprise-service-us-cdn\.ecoflow\.com\//);
      expect(url).toMatch(/\.pdf$/i);
    });
  });

  // ─── Per-tier AC output values ──────────────────────────────────────────
  describe('11.5 kW tier (EF-PCS-24 at 48 A output)', () => {
    const inv = getInverterById('ecoflow-ocean-pro-11kw')!;
    it('AC output = 11.5 kW', () => { expect(inv.acOutputKw).toBe(11.5); });
    it('AC output voltage = 240 V (split-phase)', () => { expect(inv.acOutputVoltage).toBe(240); });
    it('Max continuous AC output current = 48 A', () => { expect(inv.acOutputCurrentMax).toBe(48.0); });
    it('DC/AC ratio @ 40 kW DC = 3.48 (above hard-cap, covered by sizingTiers)', () => {
      // This tier is ratio-capped in brand profile sizingTiers to maxDcKw=20;
      // registry-level dcInputKwMax is the hardware ceiling, not the sizing cap.
      expect(inv.dcInputKwMax).toBe(40.0);
    });
  });

  describe('24 kW tier (EF-PCS-24 at 100 A output)', () => {
    const inv = getInverterById('ecoflow-ocean-pro-24kw')!;
    it('AC output = 24 kW', () => { expect(inv.acOutputKw).toBe(24.0); });
    it('AC output voltage = 240 V (split-phase)', () => { expect(inv.acOutputVoltage).toBe(240); });
    it('Max continuous AC output current = 100 A', () => { expect(inv.acOutputCurrentMax).toBe(100.0); });
  });

  describe('Required spec fields are defined on every OCEAN Pro SKU', () => {
    it.each(OCEAN_PRO_INVERTERS)('%s: all required fields defined', (id) => {
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

// ═══════════════════════════════════════════════════════════════════════════
// Battery — EF-BP-10 (OCEAN Pro Battery)
// ═══════════════════════════════════════════════════════════════════════════
describe('v58.14 — EcoFlow OCEAN Pro Battery (EF-BP-10) datasheet lock-in', () => {
  it('Registered in BATTERIES', () => {
    const bat = getBatteryById(OCEAN_PRO_BATTERY);
    expect(bat).toBeDefined();
    expect(bat?.manufacturer).toBe('EcoFlow');
    expect(bat?.category).toBe('battery');
  });

  it('active === true (US SKU must be selectable)', () => {
    expect(getBatteryById(OCEAN_PRO_BATTERY)?.active).toBe(true);
  });

  it('Usable capacity = 10 kWh per module', () => {
    expect(getBatteryById(OCEAN_PRO_BATTERY)?.usableCapacityKwh).toBe(10.0);
  });

  it('Continuous discharge power = 10 kW per unit', () => {
    expect(getBatteryById(OCEAN_PRO_BATTERY)?.continuousPowerKw).toBe(10.0);
  });

  it('LFP chemistry', () => {
    expect(getBatteryById(OCEAN_PRO_BATTERY)?.chemistry).toBe('LFP');
  });

  it('HV 400 V DC nominal (matches PCS DC-coupled string input)', () => {
    expect(getBatteryById(OCEAN_PRO_BATTERY)?.voltageNominalV).toBe(400);
  });

  it('DC-coupled subcategory (no separate backfeed breaker)', () => {
    const bat = getBatteryById(OCEAN_PRO_BATTERY)!;
    expect(bat.subcategory).toBe('dc_coupled');
    expect(bat.backfeedBreakerA).toBe(0);
  });

  it('UL 9540 / 9540A / 9540B / 1973 certified (industry-first UL 9540B, Sept 2025)', () => {
    const listing = getBatteryById(OCEAN_PRO_BATTERY)?.ulListing ?? '';
    expect(listing).toMatch(/UL 9540B/);
    expect(listing).toMatch(/UL 1973/);
  });

  it('ecosystem tags (brand=ecoflow, family=ocean-pro)', () => {
    const bat = getBatteryById(OCEAN_PRO_BATTERY)!;
    expect(bat.ecosystemBrand).toBe('ecoflow');
    expect(bat.ecosystemFamily).toBe('ocean-pro');
  });

  it('compatibleWith points ONLY at OCEAN Pro inverters (HV DC bus)', () => {
    const bat = getBatteryById(OCEAN_PRO_BATTERY)!;
    expect(bat.compatibleWith).toEqual(
      expect.arrayContaining(['ecoflow-ocean-pro-11kw', 'ecoflow-ocean-pro-24kw']),
    );
    // Does NOT reference legacy PowerOcean (different bus voltage).
    expect(bat.compatibleWith).not.toContain('ecoflow-power-ocean-5kw');
    expect(bat.compatibleWith).not.toContain('ecoflow-power-ocean-10kw');
    expect(bat.compatibleWith).not.toContain('ecoflow-power-ocean-20kw');
  });

  it('datasheetUrl points at the manufacturer-published BP datasheet', () => {
    const url = getBatteryById(OCEAN_PRO_BATTERY)?.datasheetUrl;
    expect(url).toMatch(/^https:\/\/enterprise-service-us-cdn\.ecoflow\.com\//);
    expect(url).toMatch(/Ocean%20Pro%20BP%20datasheet/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Brand-profile & registry integration (mirrors Growatt pattern)
// ═══════════════════════════════════════════════════════════════════════════
describe('v58.14 — EcoFlow brand profile integration', () => {
  it('ECOFLOW_PROFILE exports and registers in BRAND_PROFILES', async () => {
    const { ECOFLOW_PROFILE, BRAND_PROFILES, getBrandProfile } =
      await import('./system/brandProfiles');
    expect(ECOFLOW_PROFILE).toBeDefined();
    expect(ECOFLOW_PROFILE.id).toBe('ecoflow');
    expect(ECOFLOW_PROFILE.topology).toBe('hybrid');
    expect(BRAND_PROFILES.map((p) => p.id)).toContain('ecoflow');
    expect(getBrandProfile('ecoflow')?.manufacturer).toBe('EcoFlow');
  });

  it('Every supportedInverterModels equipmentDbId resolves to a real registry entry', async () => {
    const { ECOFLOW_PROFILE } = await import('./system/brandProfiles');
    for (const model of ECOFLOW_PROFILE.supportedInverterModels) {
      const inv = getInverterById(model.equipmentDbId);
      expect(inv, `registry missing ${model.equipmentDbId}`).toBeDefined();
      expect(inv!.manufacturer).toBe('EcoFlow');
    }
  });

  it('Sizing tiers cover 0 → Infinity DC kW with no gaps', async () => {
    const { ECOFLOW_PROFILE } = await import('./system/brandProfiles');
    const tiers = [...ECOFLOW_PROFILE.sizingTiers].sort((a, b) => a.minDcKw - b.minDcKw);
    expect(tiers[0].minDcKw).toBe(0);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].minDcKw).toBe(tiers[i - 1].maxDcKw);
    }
    expect(tiers[tiers.length - 1].maxDcKw).toBe(Infinity);
  });

  it('Every tier equipmentDbId is in supportedInverterModels AND is active', async () => {
    const { ECOFLOW_PROFILE } = await import('./system/brandProfiles');
    const supportedIds = new Set(
      ECOFLOW_PROFILE.supportedInverterModels.map((m) => m.equipmentDbId),
    );
    for (const tier of ECOFLOW_PROFILE.sizingTiers) {
      expect(supportedIds.has(tier.equipmentDbId), `tier references unlisted model ${tier.equipmentDbId}`).toBe(true);
      // Sizing engine must NEVER pick an inactive (EU-only) SKU
      const inv = getInverterById(tier.equipmentDbId);
      expect(inv?.active, `sizing tier references inactive SKU ${tier.equipmentDbId}`).toBe(true);
    }
  });

  it('Registered in ECOSYSTEM_BRANDS for UI picker', async () => {
    const { ECOSYSTEM_BRANDS } = await import('./system/brandProfiles/resolveBrandEquipment');
    const eco = ECOSYSTEM_BRANDS.find((b) => b.id === 'ecoflow');
    expect(eco).toBeDefined();
    expect(eco!.displayName).toBe('EcoFlow');
    expect(eco!.description).toMatch(/OCEAN Pro/);
  });

  it('Battery config: hybrid-capable, modular-stack strategy, 5–80 kWh range', async () => {
    // v58.14 — minKwh/defaultTargetKwh stay at legacy 5/10 values until the
    // sizing engine's hardcoded ECOFLOW_MODULE_KWH=5 is generalised. maxKwh
    // reflects the new OCEAN Pro datasheet cap (8 × 10 kWh = 80 kWh).
    const { ECOFLOW_PROFILE } = await import('./system/brandProfiles');
    expect(ECOFLOW_PROFILE.battery.capable).toBe(true);
    expect(ECOFLOW_PROFILE.battery.required).toBe(false);
    expect(ECOFLOW_PROFILE.battery.sizingStrategy).toBe('modular_stack');
    expect(ECOFLOW_PROFILE.battery.minKwh).toBe(5);
    expect(ECOFLOW_PROFILE.battery.defaultTargetKwh).toBe(10);
    expect(ECOFLOW_PROFILE.battery.maxKwh).toBe(80);
  });

  it('Compatibility: incompatible with micro topology (hybrid + micro is disallowed)', async () => {
    const { ECOFLOW_PROFILE } = await import('./system/brandProfiles');
    expect(ECOFLOW_PROFILE.compatibility.incompatibleTopologies).toContain('micro');
    expect(ECOFLOW_PROFILE.compatibility.incompatibleBrands).toContain('enphase');
  });

  it('resolveBrandEquipment returns OCEAN Pro inverters and OCEAN Pro battery', async () => {
    const { resolveBrandEquipment } = await import(
      './system/brandProfiles/resolveBrandEquipment'
    );
    const kit = resolveBrandEquipment('ecoflow');
    expect(kit.found).toBe(true);
    // String inverters discovered via ecosystemBrand tag include BOTH legacy
    // and OCEAN Pro rows; assert OCEAN Pro IDs are present.
    const ids = kit.stringInverters.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['ecoflow-ocean-pro-11kw', 'ecoflow-ocean-pro-24kw']));
    // Battery list includes the new EF-BP-10
    const batIds = kit.batteries.map((b) => b.id);
    expect(batIds).toContain('ecoflow-ocean-pro-bp-10');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Legacy PowerOcean — sanity guardrails (must remain inactive in US)
// ═══════════════════════════════════════════════════════════════════════════
describe('v58.14 — Legacy PowerOcean (EU/AU-only) remains inactive', () => {
  const LEGACY = [
    'ecoflow-power-ocean-5kw',
    'ecoflow-power-ocean-10kw',
    'ecoflow-power-ocean-20kw',
  ] as const;

  it.each(LEGACY)('%s: active === false (must NOT be selected by US sizing engine)', (id) => {
    expect(getInverterById(id)?.active).toBe(false);
  });

  it('Legacy 5kWh battery module still references all 3 legacy inverters (broadened in v58.14)', () => {
    const bat = getBatteryById('ecoflow-battery-5kwh');
    expect(bat).toBeDefined();
    expect(bat!.compatibleWith).toEqual(
      expect.arrayContaining([
        'ecoflow-power-ocean-5kw',
        'ecoflow-power-ocean-10kw',
        'ecoflow-power-ocean-20kw',
      ]),
    );
  });
});