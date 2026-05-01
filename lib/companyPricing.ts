// ============================================================
// COMPANY PRICING CONFIGURATION
// Central source of truth for all pricing rates.
// Sales reps can override per-proposal via salesOverride fields.
// ============================================================

export type SystemTypeKey = 'ROOF_MOUNT' | 'GROUND_MOUNT' | 'SOL_FENCE' | 'CARPORT';

export const companyPricing = {
  // ── Customer-facing price per watt by system type ──────────────────────────
  // These are the BASE rates used when no sales override is provided.
  residentialPricePerWatt: 3.10,   // Standard roof mount residential
  commercialPricePerWatt:  2.35,   // Commercial ground/roof (volume discount)
  solFencePricePerWatt:    4.25,   // Sol Fence premium product
  carportPricePerWatt:     3.75,   // Carport canopy system

  // ── Cost-side inputs (used for cost-plus margin calculation) ───────────────
  laborCostPerWatt:        0.75,   // Installation labor per watt
  overheadPercent:         0.20,   // 20% overhead on material + labor
  defaultMarginPercent:    0.40,   // 40% gross margin target

  // ── Equipment cost per watt by system type ─────────────────────────────────
  equipmentCostPerWatt: {
    ROOF_MOUNT:   0.55,
    GROUND_MOUNT: 0.70,
    SOL_FENCE:    0.95,
    CARPORT:      0.85,
  } as Record<SystemTypeKey, number>,

  // ── Fixed costs per project ────────────────────────────────────────────────
  fixedCosts: 2000,               // Permitting, interconnection, misc

  // ── Financial assumptions ──────────────────────────────────────────────────
  taxCreditRate:           30,    // Federal ITC % (commercial §48E)
  utilityEscalationRate:   3,     // % per year utility rate increase
  systemLifeYears:         25,    // System lifetime for ROI calc
} as const;

// ── Per-system-type price per watt lookup ──────────────────────────────────
export function getBasePricePerWatt(systemType: SystemTypeKey): number {
  const map: Record<SystemTypeKey, number> = {
    ROOF_MOUNT:   companyPricing.residentialPricePerWatt,
    GROUND_MOUNT: companyPricing.commercialPricePerWatt,
    SOL_FENCE:    companyPricing.solFencePricePerWatt,
    CARPORT:      companyPricing.carportPricePerWatt,
  };
  return map[systemType] ?? companyPricing.residentialPricePerWatt;
}

// ── Map legacy SystemType strings to SystemTypeKey ─────────────────────────
export function toSystemTypeKey(systemType: string): SystemTypeKey {
  // v47.217: Extended with fence_mount/ground_mount/roof_mount canonical aliases
  // (design.installType values) and human-readable label round-trip safety.
  // Fallback logs a warning so silent defaults are visible in logs.
  const map: Record<string, SystemTypeKey> = {
    // Short-form canonical (SystemType in types/index.ts)
    roof:            'ROOF_MOUNT',
    ground:          'GROUND_MOUNT',
    fence:           'SOL_FENCE',
    carport:         'CARPORT',
    // Long-form canonical (design.installType values)
    roof_mount:      'ROOF_MOUNT',
    ground_mount:    'GROUND_MOUNT',
    fence_mount:     'SOL_FENCE',
    // Uppercase DB/legacy keys
    ROOF_MOUNT:      'ROOF_MOUNT',
    GROUND_MOUNT:    'GROUND_MOUNT',
    SOL_FENCE:       'SOL_FENCE',
    CARPORT:         'CARPORT',
    // Human-readable labels (round-trip safety)
    'Roof Mount':    'ROOF_MOUNT',
    'Ground Mount':  'GROUND_MOUNT',
    'Sol Fence':     'SOL_FENCE',
    'Solar Fence':   'SOL_FENCE',
    'Solar Carport': 'CARPORT',
    Carport:         'CARPORT',
  };
  const key = map[systemType];
  if (!key) {
    if (typeof systemType === 'string' && systemType.length > 0) {
      console.warn(`[toSystemTypeKey] Unknown systemType: "${systemType}" — falling back to ROOF_MOUNT. Check data source.`);
    }
    return 'ROOF_MOUNT';
  }
  return key;
}