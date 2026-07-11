// ============================================================
// lib/bom/distributorPricing.ts
// ─────────────────────────────────────────────────────────────
// Distributor pricing feed for BOM line items.
//
// ARCHITECTURE
//   1. STATIC CATALOG  — market-rate baseline for every registered
//      part number and category, drawn from CED Greentech / Soligent
//      / KWh Analytics published price sheets (Q1 2025 baseline).
//   2. DB OVERRIDES    — `distributor_prices` table rows win over
//      the static catalog (admin-editable, per-company).
//   3. CATEGORY FALLBACK — when no SKU match exists, a per-category
//      cost-per-unit estimate is used so every line always gets a price.
//
// ENTRY POINT
//   applyDistributorPricing(items, overrides?) → BOMLineItemV4[]
//     Stamps unitCost + totalCost onto every line item.
//     Never throws — falls back silently to category defaults.
//
// DISTRIBUTOR PRIORITY (for static catalog source notes)
//   1. CED Greentech (ced.com)     — panels, inverters, optimizers, racking
//   2. Soligent (soligent.com)     — batteries, BOS, wire, conduit
//   3. KWh Analytics (kwh.com)     — commodity wire, conduit, breakers
//   4. Internal estimate           — structural, labels, misc
// ============================================================

import type { BOMLineItemV4 } from '../bom-engine-v4';

// ─── Public types ─────────────────────────────────────────────────────────────

export type DistributorSource = 'CED' | 'Soligent' | 'KWh' | 'Internal';

export interface DistributorPriceEntry {
  /** Part number (primary lookup key). */
  partNumber: string;
  /** Human-readable description. */
  description: string;
  /** BOM category (used as secondary lookup key). */
  category: string;
  /** Unit (matches BOMLineItemV4.unit). */
  unit: 'ea' | 'ft' | 'lf' | 'roll' | 'set' | 'lot';
  /** Distributor list price per unit (USD). */
  listPrice: number;
  /** Typical contractor net price after standard discount (USD). */
  netPrice: number;
  /** Source distributor. */
  source: DistributorSource;
  /** Price sheet date (YYYY-MM-DD). */
  asOf: string;
}

export interface DistributorPriceOverride {
  /** Part number — matches BOMLineItemV4.partNumber. Use '*' for category-wide override. */
  partNumber: string;
  /** Category — used when partNumber is '*'. */
  category?: string;
  /** Unit cost (USD) to apply. */
  unitCost: number;
  /** Optional: override label for display. */
  label?: string;
}

export interface PricingApplyResult {
  items: BOMLineItemV4[];
  /** Count of items priced from static catalog. */
  catalogMatches: number;
  /** Count of items priced from DB overrides. */
  overrideMatches: number;
  /** Count of items priced from category fallback. */
  fallbackMatches: number;
  /** Count of items that got zero pricing (no match anywhere). */
  unpriced: number;
  /** Total BOM cost (sum of all totalCost values). */
  totalBomCost: number;
}

// ─── Static price catalog (CED / Soligent / KWh Q1 2025 baseline) ─────────────
// Prices represent typical contractor net after standard distributor discount.
// List price → Net price mapping uses published distributor discount schedules:
//   CED Greentech: ~18–22% off list for qualified contractors
//   Soligent: ~15–20% off list for registered installers
//   KWh Analytics: ~10–15% off list (commodity items, tighter margins)

export const DISTRIBUTOR_PRICE_CATALOG: DistributorPriceEntry[] = [

  // ─── Solar Panels ──────────────────────────────────────────────────────────
  {
    partNumber: 'Q.PEAK DUO BLK ML-G10+400',
    description: 'Qcells Q.Peak Duo BLK ML-G10+ 400W Monocrystalline',
    category: 'solar_panel', unit: 'ea',
    listPrice: 0.42, netPrice: 0.34,   // $/W → per panel: listPrice * 400W
    source: 'CED', asOf: '2025-01-15',
  },
  {
    // REC Alpha Pure-R is a PREMIUM HJT black-on-black module — dealer ~$0.95–1.0/W
    // (~$385–486/panel), NOT the ~$0.37/W commodity rate previously assumed.
    partNumber: 'REC405AA-PURE-R',
    description: 'REC Alpha Pure-R 405W (HJT, black)',
    category: 'solar_panel', unit: 'ea',
    listPrice: 1.10, netPrice: 0.98,
    source: 'CED', asOf: '2025-09-15',
  },
  {
    // Alias for the equipment-db id ('rec-alpha-pure-405' → uppercased) the BOM
    // engine emits, so the resolved panel matches this SKU instead of the
    // generic $/W fallback.
    partNumber: 'REC-ALPHA-PURE-405',
    description: 'REC Alpha Pure-R 405W (HJT, black)',
    category: 'solar_panel', unit: 'ea',
    listPrice: 1.10, netPrice: 0.98,
    source: 'CED', asOf: '2025-09-15',
  },
  {
    partNumber: 'SIL-380-BK',
    description: 'Silfab SIL-380-BK 380W Black Frame',
    category: 'solar_panel', unit: 'ea',
    listPrice: 0.38, netPrice: 0.31,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'PS-MNB108-HCBF-440W',
    description: 'Philadelphia Solar Nexus PS-MNB108(HCBF)-440W Bifacial N-Type (SolFence panel)',
    category: 'solar_panel', unit: 'ea',
    listPrice: 0.597, netPrice: 0.52,   // $/W → SolFence distributor price $262.50 / 440W = $0.597/W (was mislabeled 'Panasonic EverVolt')
    source: 'Internal', asOf: '2026-06-21',
  },

  // ─── String Inverters ──────────────────────────────────────────────────────
  {
    partNumber: 'PRIMO-8.2-1-240',
    description: 'Fronius Primo 8.2-1 Single Phase String Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 1980.00, netPrice: 1584.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SB7.7-1SP-US-40',
    description: 'SMA Sunny Boy 7.7-US String Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 1650.00, netPrice: 1320.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SG8K-D-US',
    description: 'Sungrow SG8K-D 8kW String Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 1450.00, netPrice: 1160.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'SE7600H-US000BNU4',
    description: 'SolarEdge HD-Wave SE7600H 7.6kW Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 1890.00, netPrice: 1512.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SE10000H-US000BNU4',
    description: 'SolarEdge HD-Wave SE10000H 10kW Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 2100.00, netPrice: 1680.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SE11400H-US000BNU4',
    description: 'SolarEdge HD-Wave SE11400H 11.4kW Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 2350.00, netPrice: 1880.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SE10K-RWS',
    description: 'SolarEdge StorEdge SE10K-RWS Hybrid Inverter',
    category: 'hybrid_inverter', unit: 'ea',
    listPrice: 2850.00, netPrice: 2280.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'EF-PO-5K-HV',
    description: 'EcoFlow PowerOcean 5kW Single Phase Inverter',
    category: 'hybrid_inverter', unit: 'ea',
    listPrice: 2200.00, netPrice: 1870.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'EF-PO-10K-HV',
    description: 'EcoFlow PowerOcean 10kW Three Phase Inverter',
    category: 'hybrid_inverter', unit: 'ea',
    listPrice: 3400.00, netPrice: 2890.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'EF-PO-20K-HV-PRO',
    description: 'EcoFlow PowerOcean 20kW Pro Three Phase Inverter',
    category: 'hybrid_inverter', unit: 'ea',
    listPrice: 5800.00, netPrice: 4930.00,
    source: 'Soligent', asOf: '2025-01-15',
  },

  // ─── Trunk / AC bus cable (sold per connector-DROP, not per foot) ──────────
  // Sourced 2026-07-10 — research JSONs in lib/data/equipment/trunk-cable-*.json.
  {
    partNumber: 'Q-12-10-240',
    description: 'Enphase Q Cable, portrait (1.3 m drops) — per connector-drop',
    category: 'trunk_cable', unit: 'ea',
    listPrice: 22.29, netPrice: 22.29,
    source: 'Soligent', asOf: '2026-07-10',
  },
  {
    // Landscape per-drop price not published — set = portrait as a FLOOR
    // (longer cable per drop, so real price ≥ this). FIELD-VERIFY.
    partNumber: 'Q-12-17-240',
    description: 'Enphase Q Cable, landscape (2.0 m drops) — per connector-drop (≈portrait, verify)',
    category: 'trunk_cable', unit: 'ea',
    listPrice: 22.29, netPrice: 22.29,
    source: 'Soligent', asOf: '2026-07-10',
  },
  {
    partNumber: 'Q-CONN-10M',
    description: 'Enphase IQ Field-Wireable Connector, male ($138.57 / 10-pack)',
    category: 'connector', unit: 'ea',
    listPrice: 13.86, netPrice: 13.86,
    source: 'Soligent', asOf: '2026-07-10',
  },
  {
    // Female price not published — assume ≈ male. FIELD-VERIFY.
    partNumber: 'Q-CONN-10F',
    description: 'Enphase IQ Field-Wireable Connector, female (≈male price, verify)',
    category: 'connector', unit: 'ea',
    listPrice: 13.86, netPrice: 13.86,
    source: 'Soligent', asOf: '2026-07-10',
  },
  {
    partNumber: 'DS3-AC-BUS',
    description: 'APsystems DS3 AC Bus trunk (2.4 m drops) — per connector-drop',
    category: 'trunk_cable', unit: 'ea',
    listPrice: 49.00, netPrice: 49.00,
    source: 'Soligent', asOf: '2026-07-10',
  },
  {
    partNumber: '2300931202',
    description: 'APsystems AC Bus field-wireable connector, male (IP67)',
    category: 'connector', unit: 'ea',
    listPrice: 18.64, netPrice: 18.64,
    source: 'Soligent', asOf: '2026-07-10',
  },
  {
    // Polaris/NSI IPLD-class insulated multi-tap, 350 kcmil range — typical
    // distributor ~$25-40 ea depending on range. FIELD-VERIFY exact SKU/price.
    partNumber: 'IPLD350-3',
    description: 'NSI Polaris insulated multi-tap connector (350 kcmil-#6)',
    category: 'connector', unit: 'ea',
    listPrice: 32.00, netPrice: 32.00,
    source: 'Soligent', asOf: '2026-07-10',
  },
  {
    partNumber: '1531038',
    description: 'NEP BDM trunk end cap',
    category: 'terminator', unit: 'ea',
    listPrice: 4.55, netPrice: 4.55,
    source: 'Soligent', asOf: '2026-07-10',
  },
  {
    partNumber: '1531022',
    description: 'NEP BDM male splice adaptor',
    category: 'connector', unit: 'ea',
    listPrice: 2.00, netPrice: 2.00,
    source: 'Soligent', asOf: '2026-07-10',
  },

  // ─── Microinverters ────────────────────────────────────────────────────────
  {
    partNumber: 'IQ8PLUS-72-2-US',
    description: 'Enphase IQ8+ Microinverter',
    category: 'microinverter', unit: 'ea',
    listPrice: 195.00, netPrice: 156.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'IQ8M-72-2-US',
    description: 'Enphase IQ8M Microinverter',
    category: 'microinverter', unit: 'ea',
    listPrice: 230.00, netPrice: 185.00,
    source: 'CED', asOf: '2025-09-15',
  },

  // ─── Integrated combiners / gateways (SOURCED — bos-pricing-research.json) ───
  // The app previously priced ALL of these off the generic $145 "combiner"
  // category fallback. Real distributor prices are 5–12× that (a 6C is an
  // all-in-one smart load center: enclosure + IQ Gateway + CTs + breakers).
  {
    partNumber: 'X-IQ-AM1-240-6C',
    description: 'Enphase IQ Combiner 6C (combiner + IQ Gateway + integral disconnect)',
    category: 'combiner', unit: 'ea',
    listPrice: 2000.00, netPrice: 1800.00,
    source: 'CED', asOf: '2025-09-15',
  },
  {
    partNumber: 'X-IQ-AM1-240-5C',
    description: 'Enphase IQ Combiner 5C',
    category: 'combiner', unit: 'ea',
    listPrice: 1520.00, netPrice: 1350.00,
    source: 'CED', asOf: '2025-09-15',
  },
  {
    partNumber: 'X-IQ-AM1-240-4C',
    description: 'Enphase IQ Combiner 4C',
    category: 'combiner', unit: 'ea',
    listPrice: 800.00, netPrice: 709.00,
    source: 'CED', asOf: '2025-09-15',
  },
  {
    partNumber: 'ENV-IQ-AM1-240',
    description: 'Enphase IQ Gateway (standalone)',
    category: 'gateway', unit: 'ea',
    listPrice: 780.00, netPrice: 690.00,
    source: 'CED', asOf: '2025-09-15',
  },
  {
    partNumber: 'ENV2-IQ-AM1-240',
    description: 'Enphase IQ Gateway (IEEE 2030.5)',
    category: 'gateway', unit: 'ea',
    listPrice: 780.00, netPrice: 690.00,
    source: 'CED', asOf: '2025-09-15',
  },
  {
    partNumber: 'MC-200-011-V01',
    description: 'Enphase IQ Meter Collar (meter-socket adapter + MID)',
    category: 'meter_socket', unit: 'ea',
    listPrice: 700.00, netPrice: 630.00,
    source: 'Soligent', asOf: '2025-09-15',
  },
  {
    partNumber: '1624171',
    description: 'Tesla Backup Switch (meter-socket + grid isolation)',
    category: 'meter_socket', unit: 'ea',
    listPrice: 550.00, netPrice: 450.00,   // ⚠ LOW confidence — Tesla is quote-only via distributors
    source: 'Internal', asOf: '2025-09-15',
  },

  // ─── Power Optimizers ──────────────────────────────────────────────────────
  {
    partNumber: 'P401-5R2MRM',
    description: 'SolarEdge P401 Power Optimizer',
    category: 'optimizer', unit: 'ea',
    listPrice: 62.00, netPrice: 49.60,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'P505-5R2MRM',
    description: 'SolarEdge P505 Power Optimizer',
    category: 'optimizer', unit: 'ea',
    listPrice: 68.00, netPrice: 54.40,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'TAP-TS4-A-O',
    description: 'Tigo TS4-A-O Smart Module Optimizer',
    category: 'optimizer', unit: 'ea',
    listPrice: 45.00, netPrice: 36.00,
    source: 'Soligent', asOf: '2025-01-15',
  },

  // ─── Batteries ─────────────────────────────────────────────────────────────
  {
    partNumber: 'IQ-BAT-5P-1P-240',
    description: 'Enphase IQ Battery 5P (5kWh)',
    category: 'battery', unit: 'ea',
    listPrice: 3800.00, netPrice: 3230.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'PW3-US',
    description: 'Tesla Powerwall 3 (13.5kWh)',
    category: 'battery', unit: 'ea',
    listPrice: 9200.00, netPrice: 8280.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'EF-BATT-5K-LFP',
    description: 'EcoFlow PowerOcean 5kWh LFP Battery Module',
    category: 'battery', unit: 'ea',
    listPrice: 3200.00, netPrice: 2720.00,
    source: 'Soligent', asOf: '2025-01-15',
  },

  // ─── Racking / Mounting ────────────────────────────────────────────────────
  // SolFence (Sol Fence LLC) — REAL distributor price sheet, 2026-06-21 (Ray-supplied).
  // Sections include side channels + rails. Steel post + concrete sourced locally;
  // optimizers + wiring supplied by the electrician (NOT in the SolFence kit).
  { partNumber: 'SOLFENCE-SECTION-6', description: "SOL Fence 6' Tall x 8' Wide Section (incl. side channels + rails, 2 panels)", category: 'racking', unit: 'ea', listPrice: 253.35, netPrice: 253.35, source: 'Internal', asOf: '2026-06-21' },
  { partNumber: 'SOLFENCE-SECTION-4', description: "SOL Fence 4' Tall x 8' Wide Section (incl. side channels + rails, 1 panel)", category: 'racking', unit: 'ea', listPrice: 231.00, netPrice: 231.00, source: 'Internal', asOf: '2026-06-21' },
  { partNumber: 'SOLFENCE-POST-6.5', description: 'SOL Fence 4x4x6.5 Post (6 ft section)', category: 'racking', unit: 'ea', listPrice: 197.88, netPrice: 197.88, source: 'Internal', asOf: '2026-06-21' },
  { partNumber: 'SOLFENCE-POST-4.5', description: 'SOL Fence 4x4x4.5 Post (4 ft section)', category: 'racking', unit: 'ea', listPrice: 129.14, netPrice: 129.14, source: 'Internal', asOf: '2026-06-21' },
  { partNumber: 'SOLFENCE-POST-9', description: 'SOL Fence 4x4x9 Post (tall option)', category: 'racking', unit: 'ea', listPrice: 250.77, netPrice: 250.77, source: 'Internal', asOf: '2026-06-21' },
  { partNumber: 'SOLFENCE-APEX-CAP', description: 'SOL Fence 4x4 Apex Cap', category: 'racking', unit: 'ea', listPrice: 6.30, netPrice: 6.30, source: 'Internal', asOf: '2026-06-21' },
  { partNumber: 'SOLFENCE-DONUT', description: 'SOL Fence 4x4 Donut w/ 2-3/8" Hole', category: 'racking', unit: 'ea', listPrice: 4.64, netPrice: 4.64, source: 'Internal', asOf: '2026-06-21' },
  { partNumber: 'SOLFENCE-RCP', description: 'SOL Fence RCP', category: 'racking', unit: 'ea', listPrice: 187.50, netPrice: 187.50, source: 'Internal', asOf: '2026-06-21' },
  {
    partNumber: 'RT-MINI-01',
    description: 'RoofTech RT Mini Rail-Free Mount',
    category: 'racking', unit: 'ea',
    listPrice: 18.50, netPrice: 14.80,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'RT-MINI-ASSY',
    description: 'RoofTech RT Mini Pad Assembly',
    category: 'racking', unit: 'ea',
    listPrice: 8.50, netPrice: 6.80,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'RT-MINI-FLASH',
    description: 'RoofTech RT Mini Flashing Kit',
    category: 'racking', unit: 'ea',
    listPrice: 12.50, netPrice: 10.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'LAG-516-3-SS',
    description: '5/16" × 3" Stainless Steel Lag Bolt',
    category: 'racking', unit: 'ea',
    listPrice: 0.65, netPrice: 0.52,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'LFT-001-B',
    description: 'IronRidge L-Foot Universal Attachment',
    category: 'racking', unit: 'ea',
    listPrice: 16.00, netPrice: 12.80,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'UFO-MID-01',
    description: 'IronRidge UFO Mid Clamp',
    category: 'racking', unit: 'ea',
    listPrice: 3.50, netPrice: 2.80,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'UFO-END-01',
    description: 'IronRidge UFO End Clamp',
    category: 'racking', unit: 'ea',
    listPrice: 3.75, netPrice: 3.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'WEEB-LUG-6.7',
    description: 'Wiley Electronics WEEB Lug 6.7 (Grounding Lug)',
    category: 'racking', unit: 'ea',
    listPrice: 4.50, netPrice: 3.60,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'PP-DRIVEN-PILE-01',
    description: 'IronRidge Ground Mount Driven Pile',
    category: 'racking', unit: 'ea',
    listPrice: 85.00, netPrice: 68.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'XR-100-168B',
    description: 'IronRidge XR100 Rail 168" Black',
    category: 'racking', unit: 'ea',
    listPrice: 62.00, netPrice: 49.60,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'XR-1000-168B',
    description: 'IronRidge XR1000 Rail 168" Black (Heavy Duty)',
    category: 'racking', unit: 'ea',
    listPrice: 78.00, netPrice: 62.40,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'GFT-01',
    description: 'IronRidge Ground Foot (Flush)',
    category: 'racking', unit: 'ea',
    listPrice: 22.00, netPrice: 17.60,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SNR-100-RAIL',
    description: 'SnapNrack Series 100 Roof Rail',
    category: 'racking', unit: 'ea',
    listPrice: 58.00, netPrice: 46.40,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SNR-UL-01',
    description: 'SnapNrack UL-Listed L-Foot Attachment',
    category: 'racking', unit: 'ea',
    listPrice: 12.50, netPrice: 10.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'UR-SF-168',
    description: 'Unirac SolarFoot Roof Mount 168"',
    category: 'racking', unit: 'ea',
    listPrice: 65.00, netPrice: 52.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'UR-RM-BALLAST',
    description: 'Unirac Roof Mount Ballast Block Set',
    category: 'racking', unit: 'set',
    listPrice: 145.00, netPrice: 116.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'QM-CLASSIC-1',
    description: 'QuickMount Classic Composition Flashing',
    category: 'racking', unit: 'ea',
    listPrice: 24.00, netPrice: 19.20,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'QM-TILE-1',
    description: 'QuickMount Tile Replacement Mount',
    category: 'racking', unit: 'ea',
    listPrice: 32.00, netPrice: 25.60,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'EF-ROCKIT-01',
    description: 'EcoFasten RockIt Roof Mount',
    category: 'racking', unit: 'ea',
    listPrice: 19.00, netPrice: 15.20,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'S5-PVKIT2-01',
    description: 'S-5! PV Kit 2.0 Standing Seam Clamp',
    category: 'racking', unit: 'ea',
    listPrice: 28.00, netPrice: 22.40,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'S5-CORR-01',
    description: 'S-5! CorruBracket Corrugated Roof Clamp',
    category: 'racking', unit: 'ea',
    listPrice: 14.00, netPrice: 11.20,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'BARE-CU-6',
    description: 'Southwire #6 AWG Bare Copper Ground Wire',
    category: 'wire', unit: 'ft',
    listPrice: 1.05, netPrice: 0.85,
    source: 'KWh', asOf: '2025-01-15',
  },
];

// ─── Category fallback pricing ────────────────────────────────────────────────
// Used when no exact part-number match is found in catalog or overrides.
// Unit should match what the BOM engine emits for that category.

export const CATEGORY_FALLBACK_PRICES: Record<string, { unitCost: number; unit: string; source: DistributorSource }> = {
  // Equipment
  solar_panel:       { unitCost: 0.50 * 400,  unit: 'ea',   source: 'CED' },      // fallback only — resolvePriceForItem prices resolved panels $/W × actual watts
  microinverter:     { unitCost: 175.00,        unit: 'ea',   source: 'CED' },
  string_inverter:   { unitCost: 1500.00,       unit: 'ea',   source: 'CED' },
  hybrid_inverter:   { unitCost: 2400.00,       unit: 'ea',   source: 'Soligent' },
  optimizer:         { unitCost: 52.00,         unit: 'ea',   source: 'CED' },
  battery:           { unitCost: 4200.00,       unit: 'ea',   source: 'Soligent' },
  // Racking
  racking:           { unitCost: 18.00,         unit: 'ea',   source: 'CED' },
  // Electrical BOS
  wire:              { unitCost: 0.85,          unit: 'ft',   source: 'KWh' },      // $/ft — #10 AWG THWN avg
  // Trunk cable is sold PER CONNECTOR-DROP (1 drop per micro), not per foot —
  // Enphase ≈ $22/drop, APsystems ≈ $49/drop; real SKUs priced above.
  trunk_cable:       { unitCost: 25.00,         unit: 'ea',   source: 'Soligent' },
  connector:         { unitCost: 14.00,         unit: 'ea',   source: 'Soligent' }, // field-wireable splice avg
  sealing_cap:       { unitCost: 4.50,          unit: 'ea',   source: 'Soligent' },
  conduit:           { unitCost: 0.75,          unit: 'ft',   source: 'KWh' },      // 3/4" EMT avg
  breaker:           { unitCost: 24.00,         unit: 'ea',   source: 'KWh' },
  disconnect:        { unitCost: 185.00,        unit: 'ea',   source: 'KWh' },
  rapid_shutdown:    { unitCost: 95.00,         unit: 'ea',   source: 'CED' },
  combiner:          { unitCost: 900.00,        unit: 'ea',   source: 'CED' },      // integrated smart combiner (4C ~$700 → 6C ~$1800); real SKUs priced above
  meter_socket:      { unitCost: 550.00,        unit: 'ea',   source: 'Soligent' },
  junction_box:      { unitCost: 18.00,         unit: 'ea',   source: 'KWh' },
  meter:             { unitCost: 320.00,        unit: 'ea',   source: 'KWh' },
  // Monitoring
  gateway:           { unitCost: 690.00,        unit: 'ea',   source: 'CED' },      // standalone IQ Gateway ~$690
  monitoring:        { unitCost: 95.00,         unit: 'ea',   source: 'CED' },
  // Structural (fence/ground)
  post:              { unitCost: 95.00,         unit: 'ea',   source: 'Internal' },
  rail:              { unitCost: 55.00,         unit: 'ea',   source: 'Internal' },
  clamp:             { unitCost: 8.50,          unit: 'ea',   source: 'Internal' },
  footer:            { unitCost: 45.00,         unit: 'ea',   source: 'Internal' },
  hardware:          { unitCost: 2.50,          unit: 'ea',   source: 'Internal' },
  panel_frame:       { unitCost: 85.00,         unit: 'ea',   source: 'Internal' },
  // Labels
  label:             { unitCost: 4.50,          unit: 'ea',   source: 'KWh' },
  // Misc
  terminator:        { unitCost: 3.50,          unit: 'ea',   source: 'Soligent' },
};

// ─── Panel wattage inference for $/W → $/panel conversion ─────────────────────
// Part numbers that use $/W pricing need wattage to compute per-panel dollar cost.
const PANEL_WATTAGE_BY_PART: Record<string, number> = {
  'Q.PEAK DUO BLK ML-G10+400': 400,
  'REC405AA-PURE-R':            405,
  'REC-ALPHA-PURE-405':        405,
  'SIL-380-BK':                 380,
  'PS-MNB108-HCBF-440W':       440,
};

function isPerWattPricing(entry: DistributorPriceEntry): boolean {
  return entry.category === 'solar_panel';
}

function resolveNetPrice(entry: DistributorPriceEntry): number {
  if (isPerWattPricing(entry)) {
    const watts = PANEL_WATTAGE_BY_PART[entry.partNumber] ?? 400;
    return Math.round(entry.netPrice * watts * 100) / 100;
  }
  return entry.netPrice;
}

// ─── Build lookup maps (lazy, built once) ─────────────────────────────────────

let _catalogByPartNumber: Map<string, DistributorPriceEntry> | null = null;

function getCatalogByPartNumber(): Map<string, DistributorPriceEntry> {
  if (!_catalogByPartNumber) {
    _catalogByPartNumber = new Map();
    for (const entry of DISTRIBUTOR_PRICE_CATALOG) {
      _catalogByPartNumber.set(entry.partNumber.toUpperCase(), entry);
    }
  }
  return _catalogByPartNumber;
}

// ─── Core pricing resolution ──────────────────────────────────────────────────

function resolvePriceForItem(
  item: BOMLineItemV4,
  overrideMap: Map<string, number>,
  overrideCategoryMap: Map<string, number>,
): { unitCost: number; source: 'override' | 'catalog' | 'fallback' | 'none' } {
  const partUpper = (item.partNumber ?? '').toUpperCase();

  // 1. Exact part-number override (highest priority)
  if (partUpper && overrideMap.has(partUpper)) {
    return { unitCost: overrideMap.get(partUpper)!, source: 'override' };
  }

  // 2. Category-level override
  if (overrideCategoryMap.has(item.category)) {
    return { unitCost: overrideCategoryMap.get(item.category)!, source: 'override' };
  }

  // 3. Static catalog — exact part number
  if (partUpper) {
    const catalog = getCatalogByPartNumber();
    const entry = catalog.get(partUpper);
    if (entry) {
      return { unitCost: resolveNetPrice(entry), source: 'catalog' };
    }
  }

  // 4. Category fallback
  const fallback = CATEGORY_FALLBACK_PRICES[item.category];
  if (fallback) {
    // Panels: price the actual wattage ($/W) rather than a flat 400W, so a 440W
    // module isn't undercharged like a 400W one.
    if (item.category === 'solar_panel') {
      const w = Number((`${item.model} ${item.description ?? ''}`.match(/(\d{3,4})\s*W/) ?? [])[1]);
      if (w >= 200 && w <= 800) return { unitCost: Math.round(0.50 * w * 100) / 100, source: 'fallback' };
    }
    return { unitCost: fallback.unitCost, source: 'fallback' };
  }

  return { unitCost: 0, source: 'none' };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Stamps `unitCost` and `totalCost` onto every BOM line item.
 *
 * Resolution order:
 *   DB/admin overrides → static catalog → category fallback → zero (unpriced)
 *
 * @param items     BOM line items from the V4 engine (or merged result).
 * @param overrides Optional array of DB-sourced price overrides (from
 *                  `distributor_prices` table, fetched by the calling route).
 *                  When undefined/empty, only catalog + category defaults apply.
 */
export function applyDistributorPricing(
  items: BOMLineItemV4[],
  overrides: DistributorPriceOverride[] = [],
): PricingApplyResult {
  // Build override lookup maps
  const overrideMap = new Map<string, number>();
  const overrideCategoryMap = new Map<string, number>();
  for (const o of overrides) {
    if (o.partNumber === '*') {
      if (o.category) overrideCategoryMap.set(o.category, o.unitCost);
    } else {
      overrideMap.set(o.partNumber.toUpperCase(), o.unitCost);
    }
  }

  let catalogMatches = 0;
  let overrideMatches = 0;
  let fallbackMatches = 0;
  let unpriced = 0;
  let totalBomCost = 0;

  const pricedItems: BOMLineItemV4[] = items.map(item => {
    // Skip items already priced (e.g. if called twice)
    if (item.unitCost !== undefined && item.unitCost > 0) {
      totalBomCost += item.totalCost ?? item.unitCost * item.quantity;
      catalogMatches++;
      return item;
    }

    const { unitCost, source } = resolvePriceForItem(item, overrideMap, overrideCategoryMap);
    const totalCost = Math.round(unitCost * item.quantity * 100) / 100;

    if (source === 'override')  overrideMatches++;
    else if (source === 'catalog')  catalogMatches++;
    else if (source === 'fallback') fallbackMatches++;
    else                            unpriced++;

    if (unitCost > 0) totalBomCost += totalCost;

    return {
      ...item,
      unitCost:  unitCost  > 0 ? Math.round(unitCost  * 100) / 100 : undefined,
      totalCost: totalCost > 0 ? totalCost                          : undefined,
    };
  });

  totalBomCost = Math.round(totalBomCost * 100) / 100;

  return {
    items: pricedItems,
    catalogMatches,
    overrideMatches,
    fallbackMatches,
    unpriced,
    totalBomCost,
  };
}

// ─── Convenience: resolve single-item price (used in admin price preview) ─────

/**
 * Returns the effective unit cost for a given part number + category,
 * applying the same resolution order as applyDistributorPricing.
 */
export function resolveUnitCost(
  partNumber: string,
  category: string,
  overrides: DistributorPriceOverride[] = [],
): number {
  const fakeItem: BOMLineItemV4 = {
    id: 'preview',
    stageId: 'array',
    stageLabel: '',
    category,
    manufacturer: '',
    model: '',
    partNumber,
    description: '',
    quantity: 1,
    unit: 'ea',
    derivedFrom: '',
    required: false,
  };
  const overrideMap = new Map<string, number>();
  const overrideCategoryMap = new Map<string, number>();
  for (const o of overrides) {
    if (o.partNumber === '*') {
      if (o.category) overrideCategoryMap.set(o.category, o.unitCost);
    } else {
      overrideMap.set(o.partNumber.toUpperCase(), o.unitCost);
    }
  }
  return resolvePriceForItem(fakeItem, overrideMap, overrideCategoryMap).unitCost;
}

// ─── Summary helpers ──────────────────────────────────────────────────────────

/**
 * Computes a cost breakdown by BOM stage (for proposal + engineering UI display).
 */
export function bomCostByStage(items: BOMLineItemV4[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    if (!item.totalCost) continue;
    result[item.stageId] = Math.round(((result[item.stageId] ?? 0) + item.totalCost) * 100) / 100;
  }
  return result;
}

/**
 * Computes a cost breakdown by category (for detailed cost analysis).
 */
export function bomCostByCategory(items: BOMLineItemV4[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    if (!item.totalCost) continue;
    result[item.category] = Math.round(((result[item.category] ?? 0) + item.totalCost) * 100) / 100;
  }
  return result;
}