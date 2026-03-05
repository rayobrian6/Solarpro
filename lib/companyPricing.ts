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
  const map: Record<string, SystemTypeKey> = {
    roof:         'ROOF_MOUNT',
    ground:       'GROUND_MOUNT',
    fence:        'SOL_FENCE',
    carport:      'CARPORT',
    ROOF_MOUNT:   'ROOF_MOUNT',
    GROUND_MOUNT: 'GROUND_MOUNT',
    SOL_FENCE:    'SOL_FENCE',
    CARPORT:      'CARPORT',
  };
  return map[systemType] ?? 'ROOF_MOUNT';
}