/**
 * lib/utilityNormalizer.ts — Utility Name → Canonical ID Mapping
 *
 * Maps all known variations of utility company names to a single
 * stable canonical ID (e.g. "COMED_IL", "MILFORD_IA").
 *
 * This is a pure in-memory lookup — no DB calls, no AI calls.
 * Runs after every bill parse to tag extracted utility names.
 *
 * Architecture:
 *   1. normalizeUtility(rawName, stateHint?) → CanonicalUtility | null
 *   2. Look up raw name in ALIAS_MAP → canonical ID
 *   3. If not found, try fuzzy token match against canonical names
 *   4. Return null if no confident match (caller falls back to DB fuzzy)
 *
 * Adding a new utility:
 *   1. Add entry to CANONICAL_UTILITIES
 *   2. Add all known name variants to ALIAS_MAP pointing to the new ID
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CanonicalUtility {
  id: string;           // e.g. "COMED_IL"
  name: string;         // canonical display name e.g. "Commonwealth Edison (ComEd)"
  state: string;        // 2-letter state code
  avgRate: number;      // $/kWh residential average (EIA 2024/2025 data)
  netMetering: boolean;
  tou: boolean;         // time-of-use rates available
}

// ─── Canonical Utility Registry ───────────────────────────────────────────────

export const CANONICAL_UTILITIES: Record<string, CanonicalUtility> = {
  // ── Illinois ──────────────────────────────────────────────────────────────
  COMED_IL: {
    id: 'COMED_IL', name: 'Commonwealth Edison (ComEd)', state: 'IL',
    avgRate: 0.148, netMetering: true, tou: true,
  },
  AMEREN_IL: {
    id: 'AMEREN_IL', name: 'Ameren Illinois', state: 'IL',
    avgRate: 0.142, netMetering: true, tou: false,
  },
  // ── Iowa ──────────────────────────────────────────────────────────────────
  MIDAMERICAN_IA: {
    id: 'MIDAMERICAN_IA', name: 'MidAmerican Energy', state: 'IA',
    avgRate: 0.118, netMetering: true, tou: false,
  },
  ALLIANT_IA: {
    id: 'ALLIANT_IA', name: 'Alliant Energy (IPL)', state: 'IA',
    avgRate: 0.122, netMetering: true, tou: false,
  },
  MILFORD_IA: {
    id: 'MILFORD_IA', name: 'Milford Municipal Utilities', state: 'IA',
    avgRate: 0.098, netMetering: true, tou: false,
  },
  // ── California ────────────────────────────────────────────────────────────
  PGE_CA: {
    id: 'PGE_CA', name: 'Pacific Gas & Electric (PG&E)', state: 'CA',
    avgRate: 0.318, netMetering: true, tou: true,
  },
  SCE_CA: {
    id: 'SCE_CA', name: 'Southern California Edison (SCE)', state: 'CA',
    avgRate: 0.298, netMetering: true, tou: true,
  },
  SDGE_CA: {
    id: 'SDGE_CA', name: 'San Diego Gas & Electric (SDG&E)', state: 'CA',
    avgRate: 0.408, netMetering: true, tou: true,
  },
  LADWP_CA: {
    id: 'LADWP_CA', name: 'Los Angeles Department of Water & Power (LADWP)', state: 'CA',
    avgRate: 0.258, netMetering: true, tou: true,
  },
  SMUD_CA: {
    id: 'SMUD_CA', name: 'Sacramento Municipal Utility District (SMUD)', state: 'CA',
    avgRate: 0.228, netMetering: true, tou: true,
  },
  // ── Texas ─────────────────────────────────────────────────────────────────
  ONCOR_TX: {
    id: 'ONCOR_TX', name: 'Oncor Electric Delivery', state: 'TX',
    avgRate: 0.128, netMetering: false, tou: false,
  },
  CENTERPOINT_TX: {
    id: 'CENTERPOINT_TX', name: 'CenterPoint Energy', state: 'TX',
    avgRate: 0.128, netMetering: false, tou: false,
  },
  AEP_TX: {
    id: 'AEP_TX', name: 'AEP Texas', state: 'TX',
    avgRate: 0.128, netMetering: false, tou: false,
  },
  // ── Florida ───────────────────────────────────────────────────────────────
  FPL_FL: {
    id: 'FPL_FL', name: 'Florida Power & Light (FPL)', state: 'FL',
    avgRate: 0.138, netMetering: true, tou: false,
  },
  DUKE_FL: {
    id: 'DUKE_FL', name: 'Duke Energy Florida', state: 'FL',
    avgRate: 0.142, netMetering: true, tou: false,
  },
  TECO_FL: {
    id: 'TECO_FL', name: 'Tampa Electric (TECO)', state: 'FL',
    avgRate: 0.138, netMetering: true, tou: false,
  },
  // ── New York ──────────────────────────────────────────────────────────────
  CONED_NY: {
    id: 'CONED_NY', name: 'Consolidated Edison (Con Ed)', state: 'NY',
    avgRate: 0.218, netMetering: true, tou: true,
  },
  NATIONALGRID_NY: {
    id: 'NATIONALGRID_NY', name: 'National Grid New York', state: 'NY',
    avgRate: 0.208, netMetering: true, tou: false,
  },
  PSEG_LI: {
    id: 'PSEG_LI', name: 'PSEG Long Island (LIPA)', state: 'NY',
    avgRate: 0.228, netMetering: true, tou: false,
  },
  // ── New Jersey ────────────────────────────────────────────────────────────
  PSEG_NJ: {
    id: 'PSEG_NJ', name: 'PSE&G (Public Service Electric & Gas)', state: 'NJ',
    avgRate: 0.178, netMetering: true, tou: false,
  },
  JCP_NJ: {
    id: 'JCP_NJ', name: 'Jersey Central Power & Light (JCP&L)', state: 'NJ',
    avgRate: 0.178, netMetering: true, tou: false,
  },
  ACE_NJ: {
    id: 'ACE_NJ', name: 'Atlantic City Electric', state: 'NJ',
    avgRate: 0.178, netMetering: true, tou: false,
  },
  // ── Virginia ──────────────────────────────────────────────────────────────
  DOMINION_VA: {
    id: 'DOMINION_VA', name: 'Dominion Energy Virginia', state: 'VA',
    avgRate: 0.128, netMetering: true, tou: false,
  },
  APCo_VA: {
    id: 'APCo_VA', name: 'Appalachian Power (AEP)', state: 'VA',
    avgRate: 0.122, netMetering: true, tou: false,
  },
  // ── Georgia ───────────────────────────────────────────────────────────────
  GEORGIA_POWER: {
    id: 'GEORGIA_POWER', name: 'Georgia Power', state: 'GA',
    avgRate: 0.128, netMetering: true, tou: false,
  },
  // ── North Carolina ────────────────────────────────────────────────────────
  DUKE_NC: {
    id: 'DUKE_NC', name: 'Duke Energy Carolinas', state: 'NC',
    avgRate: 0.118, netMetering: true, tou: false,
  },
  DEP_NC: {
    id: 'DEP_NC', name: 'Duke Energy Progress', state: 'NC',
    avgRate: 0.118, netMetering: true, tou: false,
  },
  // ── South Carolina ────────────────────────────────────────────────────────
  DOMINION_SC: {
    id: 'DOMINION_SC', name: 'Dominion Energy South Carolina', state: 'SC',
    avgRate: 0.138, netMetering: true, tou: false,
  },
  // ── Ohio ──────────────────────────────────────────────────────────────────
  AEP_OH: {
    id: 'AEP_OH', name: 'AEP Ohio', state: 'OH',
    avgRate: 0.128, netMetering: true, tou: false,
  },
  FIRSTENERGY_OH: {
    id: 'FIRSTENERGY_OH', name: 'FirstEnergy Ohio', state: 'OH',
    avgRate: 0.132, netMetering: true, tou: false,
  },
  DUKE_OH: {
    id: 'DUKE_OH', name: 'Duke Energy Ohio', state: 'OH',
    avgRate: 0.128, netMetering: true, tou: false,
  },
  // ── Pennsylvania ──────────────────────────────────────────────────────────
  PECO_PA: {
    id: 'PECO_PA', name: 'PECO Energy', state: 'PA',
    avgRate: 0.148, netMetering: true, tou: false,
  },
  PPL_PA: {
    id: 'PPL_PA', name: 'PPL Electric Utilities', state: 'PA',
    avgRate: 0.148, netMetering: true, tou: false,
  },
  // ── Massachusetts ─────────────────────────────────────────────────────────
  EVERSOURCE_MA: {
    id: 'EVERSOURCE_MA', name: 'Eversource Energy', state: 'MA',
    avgRate: 0.248, netMetering: true, tou: false,
  },
  NATIONALGRID_MA: {
    id: 'NATIONALGRID_MA', name: 'National Grid Massachusetts', state: 'MA',
    avgRate: 0.238, netMetering: true, tou: false,
  },
  // ── Connecticut ───────────────────────────────────────────────────────────
  EVERSOURCE_CT: {
    id: 'EVERSOURCE_CT', name: 'Eversource Connecticut', state: 'CT',
    avgRate: 0.252, netMetering: true, tou: false,
  },
  // ── Michigan ──────────────────────────────────────────────────────────────
  DTE_MI: {
    id: 'DTE_MI', name: 'DTE Energy', state: 'MI',
    avgRate: 0.188, netMetering: true, tou: false,
  },
  CONSUMERS_MI: {
    id: 'CONSUMERS_MI', name: 'Consumers Energy', state: 'MI',
    avgRate: 0.178, netMetering: true, tou: false,
  },
  // ── Minnesota ─────────────────────────────────────────────────────────────
  XCEL_MN: {
    id: 'XCEL_MN', name: 'Xcel Energy Minnesota', state: 'MN',
    avgRate: 0.138, netMetering: true, tou: false,
  },
  // ── Colorado ──────────────────────────────────────────────────────────────
  XCEL_CO: {
    id: 'XCEL_CO', name: 'Xcel Energy Colorado', state: 'CO',
    avgRate: 0.138, netMetering: true, tou: false,
  },
  // ── Arizona ───────────────────────────────────────────────────────────────
  APS_AZ: {
    id: 'APS_AZ', name: 'Arizona Public Service (APS)', state: 'AZ',
    avgRate: 0.128, netMetering: true, tou: true,
  },
  SRP_AZ: {
    id: 'SRP_AZ', name: 'Salt River Project (SRP)', state: 'AZ',
    avgRate: 0.122, netMetering: true, tou: true,
  },
  TEP_AZ: {
    id: 'TEP_AZ', name: 'Tucson Electric Power (TEP)', state: 'AZ',
    avgRate: 0.128, netMetering: true, tou: false,
  },
  // ── Nevada ────────────────────────────────────────────────────────────────
  NVE_NV: {
    id: 'NVE_NV', name: 'NV Energy', state: 'NV',
    avgRate: 0.118, netMetering: true, tou: false,
  },
  // ── Washington ────────────────────────────────────────────────────────────
  PSE_WA: {
    id: 'PSE_WA', name: 'Puget Sound Energy (PSE)', state: 'WA',
    avgRate: 0.108, netMetering: true, tou: false,
  },
  SCL_WA: {
    id: 'SCL_WA', name: 'Seattle City Light', state: 'WA',
    avgRate: 0.108, netMetering: true, tou: false,
  },
  // ── Oregon ────────────────────────────────────────────────────────────────
  PGE_OR: {
    id: 'PGE_OR', name: 'Portland General Electric (PGE)', state: 'OR',
    avgRate: 0.128, netMetering: true, tou: false,
  },
  PACIFICORP_OR: {
    id: 'PACIFICORP_OR', name: 'Pacific Power (PacifiCorp)', state: 'OR',
    avgRate: 0.122, netMetering: true, tou: false,
  },
  // ── Maryland ──────────────────────────────────────────────────────────────
  BGE_MD: {
    id: 'BGE_MD', name: 'Baltimore Gas & Electric (BGE)', state: 'MD',
    avgRate: 0.148, netMetering: true, tou: false,
  },
  PEPCO_MD: {
    id: 'PEPCO_MD', name: 'Potomac Electric Power (Pepco)', state: 'MD',
    avgRate: 0.148, netMetering: true, tou: false,
  },
  // ── Hawaii ────────────────────────────────────────────────────────────────
  HECO_HI: {
    id: 'HECO_HI', name: 'Hawaiian Electric (HECO)', state: 'HI',
    avgRate: 0.395, netMetering: true, tou: true,
  },
  // ── Tennessee ─────────────────────────────────────────────────────────────
  TVA_TN: {
    id: 'TVA_TN', name: 'Tennessee Valley Authority (TVA)', state: 'TN',
    avgRate: 0.118, netMetering: true, tou: false,
  },
  // ── Vermont ────────────────────────────────────────────────────────────────
  GREEN_MOUNTAIN_VT: {
    id: 'GREEN_MOUNTAIN_VT', name: 'Green Mountain Power', state: 'VT',
    avgRate: 0.249, netMetering: true, tou: false,
  },
  // ── Maine ──────────────────────────────────────────────────────────────────
  CMP_ME: {
    id: 'CMP_ME', name: 'Central Maine Power', state: 'ME',
    avgRate: 0.296, netMetering: true, tou: false,
  },
  // ── New Hampshire ──────────────────────────────────────────────────────────
  EVERSOURCE_NH: {
    id: 'EVERSOURCE_NH', name: 'Eversource Energy (NH)', state: 'NH',
    avgRate: 0.235, netMetering: true, tou: false,
  },
  // ── Rhode Island ───────────────────────────────────────────────────────────
  NATGRID_RI: {
    id: 'NATGRID_RI', name: 'National Grid Rhode Island', state: 'RI',
    avgRate: 0.313, netMetering: true, tou: false,
  },
  // ── New York (additional) ──────────────────────────────────────────────────
  NYSEG_NY: {
    id: 'NYSEG_NY', name: 'New York State Electric & Gas (NYSEG)', state: 'NY',
    avgRate: 0.196, netMetering: true, tou: false,
  },
  NIAGARA_MOHAWK_NY: {
    id: 'NIAGARA_MOHAWK_NY', name: 'Niagara Mohawk (National Grid NY)', state: 'NY',
    avgRate: 0.195, netMetering: true, tou: false,
  },
  CENTRAL_HUDSON_NY: {
    id: 'CENTRAL_HUDSON_NY', name: 'Central Hudson Gas & Electric', state: 'NY',
    avgRate: 0.214, netMetering: true, tou: false,
  },
  ORANGE_ROCKLAND_NY: {
    id: 'ORANGE_ROCKLAND_NY', name: 'Orange & Rockland Utilities', state: 'NY',
    avgRate: 0.222, netMetering: true, tou: false,
  },
  // ── Pennsylvania (additional) ──────────────────────────────────────────────
  PENELEC_PA: {
    id: 'PENELEC_PA', name: 'FirstEnergy / Penelec (Penn Power)', state: 'PA',
    avgRate: 0.158, netMetering: true, tou: false,
  },
  // ── West Virginia ──────────────────────────────────────────────────────────
  MON_POWER_WV: {
    id: 'MON_POWER_WV', name: 'Monongahela Power (FirstEnergy WV)', state: 'WV',
    avgRate: 0.124, netMetering: true, tou: false,
  },
  POTOMAC_EDISON_WV: {
    id: 'POTOMAC_EDISON_WV', name: 'Potomac Edison (FirstEnergy)', state: 'WV',
    avgRate: 0.130, netMetering: true, tou: false,
  },
  // ── Delaware / Maryland (additional) ──────────────────────────────────────
  DELMARVA_DE: {
    id: 'DELMARVA_DE', name: 'Delmarva Power (Pepco Holdings)', state: 'DE',
    avgRate: 0.155, netMetering: true, tou: false,
  },
  DELMARVA_MD: {
    id: 'DELMARVA_MD', name: 'Delmarva Power Maryland', state: 'MD',
    avgRate: 0.155, netMetering: true, tou: false,
  },
  CHOPTANK_MD: {
    id: 'CHOPTANK_MD', name: 'Choptank Electric Cooperative', state: 'MD',
    avgRate: 0.148, netMetering: true, tou: false,
  },
  // ── South Carolina ─────────────────────────────────────────────────────────
  DUKE_SC: {
    id: 'DUKE_SC', name: 'Duke Energy Carolinas (South Carolina)', state: 'SC',
    avgRate: 0.148, netMetering: true, tou: false,
  },
  // ── Illinois (co-ops + municipal) ─────────────────────────────────────────
  COLES_MOULTRIE_IL: {
    id: 'COLES_MOULTRIE_IL', name: 'Coles-Moultrie Electric Cooperative', state: 'IL',
    avgRate: 0.143, netMetering: true, tou: false,
  },
  NORRIS_ELECTRIC_IL: {
    id: 'NORRIS_ELECTRIC_IL', name: 'Norris Electric Cooperative', state: 'IL',
    avgRate: 0.143, netMetering: true, tou: false,
  },
  SHELBY_ELECTRIC_IL: {
    id: 'SHELBY_ELECTRIC_IL', name: 'Shelby Electric Cooperative', state: 'IL',
    avgRate: 0.143, netMetering: true, tou: false,
  },
  CORN_BELT_IL: {
    id: 'CORN_BELT_IL', name: 'Corn Belt Energy', state: 'IL',
    avgRate: 0.143, netMetering: true, tou: false,
  },
  SPOON_RIVER_IL: {
    id: 'SPOON_RIVER_IL', name: 'Spoon River Electric Cooperative', state: 'IL',
    avgRate: 0.143, netMetering: true, tou: false,
  },
  CWLP_IL: {
    id: 'CWLP_IL', name: 'City Water Light & Power (Springfield IL)', state: 'IL',
    avgRate: 0.152, netMetering: true, tou: false,
  },
  // ── Arkansas ────────────────────────────────────────────────────────────────
  ENTERGY_AR: {
    id: 'ENTERGY_AR', name: 'Entergy Arkansas', state: 'AR',
    avgRate: 0.133, netMetering: true, tou: false,
  },
  // ── Louisiana ───────────────────────────────────────────────────────────────
  ENTERGY_LA: {
    id: 'ENTERGY_LA', name: 'Entergy Louisiana', state: 'LA',
    avgRate: 0.124, netMetering: true, tou: false,
  },
  // ── Mississippi ─────────────────────────────────────────────────────────────
  ENTERGY_MS: {
    id: 'ENTERGY_MS', name: 'Entergy Mississippi', state: 'MS',
    avgRate: 0.128, netMetering: true, tou: false,
  },
  MISSISSIPPI_POWER: {
    id: 'MISSISSIPPI_POWER', name: 'Mississippi Power (Southern Company)', state: 'MS',
    avgRate: 0.135, netMetering: true, tou: false,
  },
  // ── Texas (additional) ──────────────────────────────────────────────────────
  ENTERGY_TX: {
    id: 'ENTERGY_TX', name: 'Entergy Texas', state: 'TX',
    avgRate: 0.142, netMetering: false, tou: false,
  },
  // ── Alabama ─────────────────────────────────────────────────────────────────
  ALABAMA_POWER: {
    id: 'ALABAMA_POWER', name: 'Alabama Power', state: 'AL',
    avgRate: 0.168, netMetering: true, tou: false,
  },
  // ── Kentucky ────────────────────────────────────────────────────────────────
  KENTUCKY_UTILITIES: {
    id: 'KENTUCKY_UTILITIES', name: 'Kentucky Utilities / LG&E', state: 'KY',
    avgRate: 0.137, netMetering: true, tou: false,
  },
  // ── Missouri ────────────────────────────────────────────────────────────────
  EVERGY_MO: {
    id: 'EVERGY_MO', name: 'Evergy (formerly KCP&L / Westar)', state: 'MO',
    avgRate: 0.133, netMetering: true, tou: false,
  },
  AMEREN_MO: {
    id: 'AMEREN_MO', name: 'Ameren Missouri (Union Electric)', state: 'MO',
    avgRate: 0.125, netMetering: true, tou: false,
  },
  // ── Indiana ─────────────────────────────────────────────────────────────────
  AEP_INDIANA: {
    id: 'AEP_INDIANA', name: 'Indiana Michigan Power (AEP)', state: 'IN',
    avgRate: 0.140, netMetering: true, tou: false,
  },
  // ── Wisconsin ───────────────────────────────────────────────────────────────
  WE_ENERGIES_WI: {
    id: 'WE_ENERGIES_WI', name: 'We Energies / WPS Wisconsin', state: 'WI',
    avgRate: 0.185, netMetering: true, tou: false,
  },
  ALLIANT_WI: {
    id: 'ALLIANT_WI', name: 'Alliant Energy (Wisconsin Power & Light)', state: 'WI',
    avgRate: 0.175, netMetering: true, tou: false,
  },
  // ── Oklahoma ────────────────────────────────────────────────────────────────
  OGE_OK: {
    id: 'OGE_OK', name: 'Oklahoma Gas & Electric (OG&E)', state: 'OK',
    avgRate: 0.121, netMetering: true, tou: false,
  },
  PSO_OK: {
    id: 'PSO_OK', name: 'Public Service Company of Oklahoma (AEP PSO)', state: 'OK',
    avgRate: 0.118, netMetering: true, tou: false,
  },
  // ── Nebraska ────────────────────────────────────────────────────────────────
  NPPD_NE: {
    id: 'NPPD_NE', name: 'Nebraska Public Power District (NPPD)', state: 'NE',
    avgRate: 0.108, netMetering: true, tou: false,
  },
  OPPD_NE: {
    id: 'OPPD_NE', name: 'Omaha Public Power District (OPPD)', state: 'NE',
    avgRate: 0.114, netMetering: true, tou: false,
  },
  // ── Idaho ───────────────────────────────────────────────────────────────────
  IDAHO_POWER: {
    id: 'IDAHO_POWER', name: 'Idaho Power', state: 'ID',
    avgRate: 0.125, netMetering: true, tou: false,
  },
  // ── Montana ─────────────────────────────────────────────────────────────────
  NORTHWESTERN_MT: {
    id: 'NORTHWESTERN_MT', name: 'NorthWestern Energy (Montana)', state: 'MT',
    avgRate: 0.118, netMetering: true, tou: false,
  },
  MDU_MT: {
    id: 'MDU_MT', name: 'Montana-Dakota Utilities (MDU)', state: 'MT',
    avgRate: 0.114, netMetering: true, tou: false,
  },
  // ── North Dakota ────────────────────────────────────────────────────────────
  OTTER_TAIL_ND: {
    id: 'OTTER_TAIL_ND', name: 'Otter Tail Power Company', state: 'ND',
    avgRate: 0.121, netMetering: true, tou: false,
  },
  // ── New Mexico ──────────────────────────────────────────────────────────────
  PNM_NM: {
    id: 'PNM_NM', name: 'Public Service Company of New Mexico (PNM)', state: 'NM',
    avgRate: 0.145, netMetering: true, tou: false,
  },
  // ── Utah ────────────────────────────────────────────────────────────────────
  ROCKMTN_POWER_UT: {
    id: 'ROCKMTN_POWER_UT', name: 'Rocky Mountain Power (PacifiCorp Utah)', state: 'UT',
    avgRate: 0.113, netMetering: true, tou: false,
  },
  // ── Wyoming ─────────────────────────────────────────────────────────────────
  PACIFICORP_WY: {
    id: 'PACIFICORP_WY', name: 'Rocky Mountain Power (Wyoming)', state: 'WY',
    avgRate: 0.104, netMetering: true, tou: false,
  },
  // ── Alaska ──────────────────────────────────────────────────────────────────
  CHUGACH_AK: {
    id: 'CHUGACH_AK', name: 'Chugach Electric Association (Alaska)', state: 'AK',
    avgRate: 0.228, netMetering: true, tou: false,
  },
};

// ─── Alias Map — all known name variants → canonical ID ───────────────────────
// Add new variants here as you discover them from bill parsing logs.

const ALIAS_MAP: Record<string, string> = {
  // ComEd / Commonwealth Edison (IL)
  'comed': 'COMED_IL',
  'com ed': 'COMED_IL',
  'commonwealth edison': 'COMED_IL',
  'commonwealth edison (comed)': 'COMED_IL',
  'comed - commonwealth edison': 'COMED_IL',
  'northern illinois gas': 'COMED_IL',

  // Ameren Illinois
  'ameren illinois': 'AMEREN_IL',
  'ameren': 'AMEREN_IL',
  'ameren il': 'AMEREN_IL',
  'ameren illinois electric': 'AMEREN_IL',

  // MidAmerican Energy (IA)
  'midamerican energy': 'MIDAMERICAN_IA',
  'mid-american energy': 'MIDAMERICAN_IA',
  'mid american energy': 'MIDAMERICAN_IA',
  'midamerican energy company': 'MIDAMERICAN_IA',
  'midamerican energy (ia)': 'MIDAMERICAN_IA',

  // Alliant Energy (IA)
  'alliant energy': 'ALLIANT_IA',
  'alliant energy (ipl)': 'ALLIANT_IA',
  'interstate power and light': 'ALLIANT_IA',
  'ipl': 'ALLIANT_IA',
  'alliant': 'ALLIANT_IA',

  // Milford Municipal Utilities (IA)
  'milford municipal utilities': 'MILFORD_IA',
  'milford municipal': 'MILFORD_IA',
  'city of milford utilities': 'MILFORD_IA',
  'milford utilities': 'MILFORD_IA',
  'milfordiautilities': 'MILFORD_IA',
  'milford ia': 'MILFORD_IA',

  // PG&E (CA)
  'pg&e': 'PGE_CA',
  'pge': 'PGE_CA',
  'pacific gas and electric': 'PGE_CA',
  'pacific gas & electric': 'PGE_CA',
  'pacific gas electric': 'PGE_CA',
  'pacific gas and electric company': 'PGE_CA',

  // SCE (CA)
  'sce': 'SCE_CA',
  'southern california edison': 'SCE_CA',
  'so cal edison': 'SCE_CA',
  'socal edison': 'SCE_CA',
  'southern california edison (sce)': 'SCE_CA',

  // SDG&E (CA)
  'sdg&e': 'SDGE_CA',
  'sdge': 'SDGE_CA',
  'san diego gas and electric': 'SDGE_CA',
  'san diego gas & electric': 'SDGE_CA',
  'san diego gas electric': 'SDGE_CA',

  // LADWP (CA)
  'ladwp': 'LADWP_CA',
  'los angeles department of water and power': 'LADWP_CA',
  'los angeles department of water & power': 'LADWP_CA',
  'la department of water and power': 'LADWP_CA',
  'city of los angeles department of water and power': 'LADWP_CA',

  // SMUD (CA)
  'smud': 'SMUD_CA',
  'sacramento municipal utility district': 'SMUD_CA',
  'sacramento municipal utility': 'SMUD_CA',

  // Oncor (TX)
  'oncor': 'ONCOR_TX',
  'oncor electric': 'ONCOR_TX',
  'oncor electric delivery': 'ONCOR_TX',
  'oncor electric delivery company': 'ONCOR_TX',

  // CenterPoint (TX)
  'centerpoint': 'CENTERPOINT_TX',
  'centerpoint energy': 'CENTERPOINT_TX',
  'centerpoint energy houston electric': 'CENTERPOINT_TX',
  'centre point energy': 'CENTERPOINT_TX',

  // AEP Texas
  'aep texas': 'AEP_TX',
  'aep texas central': 'AEP_TX',
  'aep texas north': 'AEP_TX',
  'american electric power texas': 'AEP_TX',

  // FPL (FL)
  'fpl': 'FPL_FL',
  'florida power and light': 'FPL_FL',
  'florida power & light': 'FPL_FL',
  'florida power light': 'FPL_FL',
  'florida power & light company': 'FPL_FL',
  'florida power and light company': 'FPL_FL',
  'nextera energy / fpl': 'FPL_FL',

  // Duke Energy Florida
  'duke energy florida': 'DUKE_FL',
  'duke florida': 'DUKE_FL',
  'progress energy florida': 'DUKE_FL',

  // Tampa Electric
  'teco': 'TECO_FL',
  'tampa electric': 'TECO_FL',
  'tampa electric company': 'TECO_FL',
  'teco energy': 'TECO_FL',

  // Con Ed (NY)
  'con ed': 'CONED_NY',
  'coned': 'CONED_NY',
  'con edison': 'CONED_NY',
  'consolidated edison': 'CONED_NY',
  'consolidated edison company': 'CONED_NY',
  'consolidated edison of new york': 'CONED_NY',

  // National Grid NY
  'national grid ny': 'NATIONALGRID_NY',
  'national grid new york': 'NATIONALGRID_NY',
  'national grid (ny)': 'NATIONALGRID_NY',
  'niagara mohawk': 'NIAGARA_MOHAWK_NY',
  'keyspan energy': 'NATIONALGRID_NY',

  // PSEG Long Island
  'pseg long island': 'PSEG_LI',
  'lipa': 'PSEG_LI',
  'long island power authority': 'PSEG_LI',
  'pseg li': 'PSEG_LI',

  // PSE&G (NJ)
  'pseg': 'PSEG_NJ',
  'pse&g': 'PSEG_NJ',
  'public service electric and gas': 'PSEG_NJ',
  'public service electric & gas': 'PSEG_NJ',
  'public service electric gas': 'PSEG_NJ',
  'pseg new jersey': 'PSEG_NJ',

  // JCP&L (NJ)
  'jcp&l': 'JCP_NJ',
  'jcpl': 'JCP_NJ',
  'jersey central power and light': 'JCP_NJ',
  'jersey central power & light': 'JCP_NJ',

  // Atlantic City Electric (NJ)
  'atlantic city electric': 'ACE_NJ',
  'ace': 'ACE_NJ',
  'atlantic city electric company': 'ACE_NJ',

  // Dominion Virginia
  'dominion energy': 'DOMINION_VA',
  'dominion energy virginia': 'DOMINION_VA',
  'dominion virginia power': 'DOMINION_VA',
  'virginia power': 'DOMINION_VA',
  'dominion': 'DOMINION_VA',
  'dominion energy (va)': 'DOMINION_VA',

  // Appalachian Power (VA)
  'appalachian power': 'APCo_VA',
  'aep appalachian power': 'APCo_VA',
  'appalachian power company': 'APCo_VA',
  'apco': 'APCo_VA',

  // Georgia Power
  'georgia power': 'GEORGIA_POWER',
  'georgia power company': 'GEORGIA_POWER',

  // Duke Energy Carolinas (NC)
  'duke energy carolinas': 'DUKE_NC',
  'duke energy (nc)': 'DUKE_NC',
  'duke energy north carolina': 'DUKE_NC',
  'duke carolinas': 'DUKE_NC',

  // Duke Energy Progress (NC)
  'duke energy progress': 'DEP_NC',
  'progress energy': 'DEP_NC',
  'progress energy carolinas': 'DEP_NC',

  // Dominion SC
  'dominion energy south carolina': 'DOMINION_SC',
  'sce&g': 'DOMINION_SC',
  'south carolina electric and gas': 'DOMINION_SC',
  'south carolina electric & gas': 'DOMINION_SC',

  // AEP Ohio
  'aep ohio': 'AEP_OH',
  'ohio power': 'AEP_OH',
  'columbus southern power': 'AEP_OH',
  'american electric power ohio': 'AEP_OH',

  // FirstEnergy Ohio
  'firstenergy': 'FIRSTENERGY_OH',
  'first energy': 'FIRSTENERGY_OH',
  'ohio edison': 'FIRSTENERGY_OH',
  'cleveland electric illuminating': 'FIRSTENERGY_OH',
  'toledo edison': 'FIRSTENERGY_OH',
  'the illuminating company': 'FIRSTENERGY_OH',

  // Duke Energy Ohio
  'duke energy ohio': 'DUKE_OH',
  'cinergy': 'DUKE_OH',
  'psi energy': 'DUKE_OH',

  // PECO (PA)
  'peco': 'PECO_PA',
  'peco energy': 'PECO_PA',
  'peco energy company': 'PECO_PA',
  'philadelphia electric company': 'PECO_PA',

  // PPL (PA)
  'ppl': 'PPL_PA',
  'ppl electric': 'PPL_PA',
  'ppl electric utilities': 'PPL_PA',
  'pennsylvania power and light': 'PPL_PA',

  // Eversource
  'eversource': 'EVERSOURCE_MA',
  'eversource energy': 'EVERSOURCE_MA',
  'eversource (ma)': 'EVERSOURCE_MA',
  'nstar': 'EVERSOURCE_MA',
  'northeast utilities': 'EVERSOURCE_MA',
  'western massachusetts electric': 'EVERSOURCE_MA',
  'eversource (ct)': 'EVERSOURCE_CT',
  'eversource connecticut': 'EVERSOURCE_CT',
  'eversource nh': 'EVERSOURCE_NH',

  // National Grid MA
  'national grid': 'NATIONALGRID_MA',
  'national grid ma': 'NATIONALGRID_MA',
  'national grid massachusetts': 'NATIONALGRID_MA',
  'keyspan energy delivery': 'NATIONALGRID_MA',
  'new england gas': 'NATIONALGRID_MA',

  // DTE Energy (MI)
  'dte': 'DTE_MI',
  'dte energy': 'DTE_MI',
  'detroit edison': 'DTE_MI',
  'the detroit edison company': 'DTE_MI',

  // Consumers Energy (MI)
  'consumers energy': 'CONSUMERS_MI',
  'consumers energy company': 'CONSUMERS_MI',
  'consumers power': 'CONSUMERS_MI',

  // Xcel Energy
  'xcel': 'XCEL_MN',
  'xcel energy': 'XCEL_MN',
  'xcel energy mn': 'XCEL_MN',
  'xcel energy minnesota': 'XCEL_MN',
  'northern states power': 'XCEL_MN',
  'nsp': 'XCEL_MN',
  'xcel energy co': 'XCEL_CO',
  'xcel energy colorado': 'XCEL_CO',
  'public service company of colorado': 'XCEL_CO',
  'psco': 'XCEL_CO',

  // APS (AZ)
  'aps': 'APS_AZ',
  'arizona public service': 'APS_AZ',
  'arizona public service company': 'APS_AZ',
  'arizona public service (aps)': 'APS_AZ',

  // SRP (AZ)
  'srp': 'SRP_AZ',
  'salt river project': 'SRP_AZ',
  'salt river project (srp)': 'SRP_AZ',

  // TEP (AZ)
  'tep': 'TEP_AZ',
  'tucson electric power': 'TEP_AZ',
  'tucson electric power (tep)': 'TEP_AZ',
  'tucson electric': 'TEP_AZ',

  // NV Energy
  'nv energy': 'NVE_NV',
  'nevada power': 'NVE_NV',
  'sierra pacific power': 'NVE_NV',
  'nvenergy': 'NVE_NV',

  // Puget Sound Energy (WA)
  'pse': 'PSE_WA',
  'puget sound energy': 'PSE_WA',
  'puget sound energy (pse)': 'PSE_WA',

  // Seattle City Light (WA)
  'seattle city light': 'SCL_WA',
  'city light': 'SCL_WA',
  'city of seattle light': 'SCL_WA',

  // Portland General Electric (OR)
  'portland general electric': 'PGE_OR',
  'portland general': 'PGE_OR',
  'pge (or)': 'PGE_OR',

  // Pacific Power (OR)
  'pacific power': 'PACIFICORP_OR',
  'pacificorp': 'PACIFICORP_OR',
  'rocky mountain power': 'PACIFICORP_OR',
  'utah power': 'PACIFICORP_OR',

  // BGE (MD)
  'bge': 'BGE_MD',
  'baltimore gas and electric': 'BGE_MD',
  'baltimore gas & electric': 'BGE_MD',
  'bge (md)': 'BGE_MD',

  // Pepco (MD)
  'pepco': 'PEPCO_MD',
  'potomac electric': 'PEPCO_MD',
  'potomac electric power': 'PEPCO_MD',

  // Hawaiian Electric
  'heco': 'HECO_HI',
  'hawaiian electric': 'HECO_HI',
  'hawaiian electric company': 'HECO_HI',
  'hawaii electric': 'HECO_HI',

  // TVA
  'tva': 'TVA_TN',
  'tennessee valley authority': 'TVA_TN',

  // Green Mountain Power (VT)
  'green mountain power': 'GREEN_MOUNTAIN_VT',
  'gmp': 'GREEN_MOUNTAIN_VT',
  'green mountain power vt': 'GREEN_MOUNTAIN_VT',
  'green mountain power vermont': 'GREEN_MOUNTAIN_VT',

  // Central Maine Power (ME)
  'central maine power': 'CMP_ME',
  'cmp': 'CMP_ME',
  'central maine power (cmp)': 'CMP_ME',
  'versant power': 'CMP_ME',

  // Eversource NH
  'eversource new hampshire': 'EVERSOURCE_NH',
  'eversource energy nh': 'EVERSOURCE_NH',
  'eversource energy new hampshire': 'EVERSOURCE_NH',
  'psnh': 'EVERSOURCE_NH',
  'public service of new hampshire': 'EVERSOURCE_NH',

  // National Grid RI
  'national grid ri': 'NATGRID_RI',
  'national grid rhode island': 'NATGRID_RI',
  'national grid (ri)': 'NATGRID_RI',
  'narragansett electric': 'NATGRID_RI',

  // NYSEG (NY)
  'nyseg': 'NYSEG_NY',
  'new york state electric and gas': 'NYSEG_NY',
  'new york state electric & gas': 'NYSEG_NY',
  'new york state electric gas': 'NYSEG_NY',
  'nyseg (ny)': 'NYSEG_NY',

  // Niagara Mohawk (NY)
  'niagara mohawk power': 'NIAGARA_MOHAWK_NY',
  'national grid upstate ny': 'NIAGARA_MOHAWK_NY',
  'niagara mohawk (national grid)': 'NIAGARA_MOHAWK_NY',

  // Central Hudson (NY)
  'central hudson': 'CENTRAL_HUDSON_NY',
  'central hudson gas and electric': 'CENTRAL_HUDSON_NY',
  'central hudson gas & electric': 'CENTRAL_HUDSON_NY',
  'central hudson gas electric': 'CENTRAL_HUDSON_NY',

  // Orange & Rockland (NY)
  'orange & rockland': 'ORANGE_ROCKLAND_NY',
  'orange and rockland': 'ORANGE_ROCKLAND_NY',
  'o&r': 'ORANGE_ROCKLAND_NY',
  'orange rockland utilities': 'ORANGE_ROCKLAND_NY',
  'orange & rockland utilities': 'ORANGE_ROCKLAND_NY',

  // Penelec / Penn Power (PA)
  'penelec': 'PENELEC_PA',
  'penn power': 'PENELEC_PA',
  'penelec (firstenergy)': 'PENELEC_PA',
  'west penn power': 'PENELEC_PA',
  'met-ed': 'PENELEC_PA',
  'metropolitan edison': 'PENELEC_PA',

  // Mon Power (WV)
  'mon power': 'MON_POWER_WV',
  'monongahela power': 'MON_POWER_WV',
  'monongahela power (firstenergy)': 'MON_POWER_WV',
  'allegheny power wv': 'MON_POWER_WV',

  // Potomac Edison (WV/MD)
  'potomac edison': 'POTOMAC_EDISON_WV',
  'potomac edison (firstenergy)': 'POTOMAC_EDISON_WV',
  'allegheny power': 'POTOMAC_EDISON_WV',

  // Delmarva Power (DE)
  'delmarva power': 'DELMARVA_DE',
  'delmarva power (pepco)': 'DELMARVA_DE',
  'pepco holdings delmarva': 'DELMARVA_DE',
  'delmarva power & light': 'DELMARVA_DE',

  // Delmarva Power MD
  'delmarva power maryland': 'DELMARVA_MD',
  'delmarva power md': 'DELMARVA_MD',
  'delmarva md': 'DELMARVA_MD',

  // Choptank Electric (MD)
  'choptank electric': 'CHOPTANK_MD',
  'choptank electric cooperative': 'CHOPTANK_MD',
  'choptank': 'CHOPTANK_MD',

  // Duke Energy SC
  'duke energy south carolina': 'DUKE_SC',
  'duke energy sc': 'DUKE_SC',
  'duke sc': 'DUKE_SC',
  'duke energy carolinas sc': 'DUKE_SC',

  // Coles-Moultrie (IL)
  'coles-moultrie electric': 'COLES_MOULTRIE_IL',
  'coles moultrie electric': 'COLES_MOULTRIE_IL',
  'coles-moultrie electric cooperative': 'COLES_MOULTRIE_IL',

  // Norris Electric (IL)
  'norris electric': 'NORRIS_ELECTRIC_IL',
  'norris electric cooperative': 'NORRIS_ELECTRIC_IL',
  'norris electric coop': 'NORRIS_ELECTRIC_IL',

  // Shelby Electric (IL)
  'shelby electric': 'SHELBY_ELECTRIC_IL',
  'shelby electric cooperative': 'SHELBY_ELECTRIC_IL',
  'shelby electric coop': 'SHELBY_ELECTRIC_IL',

  // Corn Belt Energy (IL)
  'corn belt energy': 'CORN_BELT_IL',
  'corn belt energy corporation': 'CORN_BELT_IL',
  'corn belt electric': 'CORN_BELT_IL',

  // Spoon River Electric (IL)
  'spoon river electric': 'SPOON_RIVER_IL',
  'spoon river electric cooperative': 'SPOON_RIVER_IL',

  // CWLP (IL)
  'cwlp': 'CWLP_IL',
  'city water light and power': 'CWLP_IL',
  'city water light & power': 'CWLP_IL',
  'springfield city light': 'CWLP_IL',
  'city of springfield electric': 'CWLP_IL',

  // Entergy Arkansas
  'entergy arkansas': 'ENTERGY_AR',
  'entergy ar': 'ENTERGY_AR',
  'entergy (ar)': 'ENTERGY_AR',

  // Entergy Louisiana
  'entergy louisiana': 'ENTERGY_LA',
  'entergy la': 'ENTERGY_LA',
  'entergy (la)': 'ENTERGY_LA',
  'cleco': 'ENTERGY_LA',

  // Entergy Mississippi
  'entergy mississippi': 'ENTERGY_MS',
  'entergy ms': 'ENTERGY_MS',
  'entergy (ms)': 'ENTERGY_MS',

  // Mississippi Power
  'mississippi power': 'MISSISSIPPI_POWER',
  'mississippi power company': 'MISSISSIPPI_POWER',
  'southern company mississippi': 'MISSISSIPPI_POWER',

  // Entergy Texas
  'entergy texas': 'ENTERGY_TX',
  'entergy tx': 'ENTERGY_TX',
  'entergy (tx)': 'ENTERGY_TX',

  // Alabama Power
  'alabama power': 'ALABAMA_POWER',
  'alabama power company': 'ALABAMA_POWER',
  'southern company alabama': 'ALABAMA_POWER',

  // Kentucky Utilities / LG&E
  'kentucky utilities': 'KENTUCKY_UTILITIES',
  'lge': 'KENTUCKY_UTILITIES',
  "lg&e": 'KENTUCKY_UTILITIES',
  'louisville gas and electric': 'KENTUCKY_UTILITIES',
  'louisville gas & electric': 'KENTUCKY_UTILITIES',
  'kentucky utilities (ku)': 'KENTUCKY_UTILITIES',
  'ku energy': 'KENTUCKY_UTILITIES',
  'ppl kentucky': 'KENTUCKY_UTILITIES',

  // Evergy (MO/KS)
  'evergy': 'EVERGY_MO',
  'kcpl': 'EVERGY_MO',
  'kansas city power and light': 'EVERGY_MO',
  'kansas city power & light': 'EVERGY_MO',
  'westar energy': 'EVERGY_MO',
  'evergy metro': 'EVERGY_MO',
  'evergy missouri west': 'EVERGY_MO',
  'evergy kansas central': 'EVERGY_MO',

  // Ameren Missouri
  'ameren missouri': 'AMEREN_MO',
  'ameren mo': 'AMEREN_MO',
  'union electric': 'AMEREN_MO',
  'ameren missouri (union electric)': 'AMEREN_MO',

  // AEP Indiana (Indiana Michigan Power)
  'indiana michigan power': 'AEP_INDIANA',
  'imp': 'AEP_INDIANA',
  'aep indiana': 'AEP_INDIANA',
  'aep (in)': 'AEP_INDIANA',
  'indiana michigan power (aep)': 'AEP_INDIANA',

  // We Energies / WPS (WI)
  'we energies': 'WE_ENERGIES_WI',
  'wisconsin electric': 'WE_ENERGIES_WI',
  'wisconsin electric power': 'WE_ENERGIES_WI',
  'wps': 'WE_ENERGIES_WI',
  'wisconsin public service': 'WE_ENERGIES_WI',
  'we energies (wi)': 'WE_ENERGIES_WI',

  // Alliant Energy WI
  'alliant energy wi': 'ALLIANT_WI',
  'alliant energy wisconsin': 'ALLIANT_WI',
  'wisconsin power and light': 'ALLIANT_WI',
  'wisconsin power & light': 'ALLIANT_WI',
  'wpl': 'ALLIANT_WI',
  'alliant wi': 'ALLIANT_WI',

  // OG&E (OK)
  'og&e': 'OGE_OK',
  'oge': 'OGE_OK',
  'oklahoma gas and electric': 'OGE_OK',
  'oklahoma gas & electric': 'OGE_OK',
  'oklahoma gas electric': 'OGE_OK',

  // PSO (OK)
  'pso': 'PSO_OK',
  'public service oklahoma': 'PSO_OK',
  'public service company of oklahoma': 'PSO_OK',
  'aep pso': 'PSO_OK',

  // NPPD (NE)
  'nppd': 'NPPD_NE',
  'nebraska public power district': 'NPPD_NE',
  'nppd (ne)': 'NPPD_NE',

  // OPPD (NE)
  'oppd': 'OPPD_NE',
  'omaha public power district': 'OPPD_NE',
  'oppd (ne)': 'OPPD_NE',

  // Idaho Power
  'idaho power': 'IDAHO_POWER',
  'idaho power company': 'IDAHO_POWER',
  'idaho power (id)': 'IDAHO_POWER',

  // NorthWestern Energy (MT)
  'northwestern energy': 'NORTHWESTERN_MT',
  'northwestern energy (mt)': 'NORTHWESTERN_MT',
  'northwestern energy montana': 'NORTHWESTERN_MT',
  'northwestern corporation': 'NORTHWESTERN_MT',

  // MDU (MT/ND)
  'montana-dakota utilities': 'MDU_MT',
  'montana dakota utilities': 'MDU_MT',
  'mdu': 'MDU_MT',
  'mdu resources': 'MDU_MT',

  // Otter Tail Power (ND/MN)
  'otter tail power': 'OTTER_TAIL_ND',
  'otter tail power company': 'OTTER_TAIL_ND',
  'otter tail': 'OTTER_TAIL_ND',

  // PNM (NM)
  'pnm': 'PNM_NM',
  'public service company of new mexico': 'PNM_NM',
  'pnm resources': 'PNM_NM',
  'pnm (nm)': 'PNM_NM',

  // Rocky Mountain Power (UT)
  'rocky mountain power ut': 'ROCKMTN_POWER_UT',
  'rocky mountain power utah': 'ROCKMTN_POWER_UT',
  'pacificorp utah': 'ROCKMTN_POWER_UT',
  'pacificorp (ut)': 'ROCKMTN_POWER_UT',

  // Rocky Mountain Power (WY)
  'rocky mountain power wy': 'PACIFICORP_WY',
  'rocky mountain power wyoming': 'PACIFICORP_WY',
  'pacificorp wyoming': 'PACIFICORP_WY',
  'pacificorp (wy)': 'PACIFICORP_WY',

  // Chugach Electric (AK)
  'chugach electric': 'CHUGACH_AK',
  'chugach electric association': 'CHUGACH_AK',
  'cea': 'CHUGACH_AK',
  'chugach': 'CHUGACH_AK',
};

// ─── Core normalizer function ──────────────────────────────────────────────────

/**
 * normalizeUtility — maps raw utility name → CanonicalUtility
 *
 * @param rawName    Raw utility name from Claude/OCR (e.g. "ComEd", "Commonwealth Edison")
 * @param stateHint  Optional 2-letter state code to resolve ambiguous names (e.g. "IL")
 * @returns CanonicalUtility if matched, null if unknown
 */
export function normalizeUtility(
  rawName: string | null | undefined,
  stateHint?: string | null,
): CanonicalUtility | null {
  if (!rawName || rawName.trim().length < 2) return null;

  // Step 1: Direct alias lookup (lowercase, trimmed)
  const key = rawName.toLowerCase().trim().replace(/\s+/g, ' ');
  const canonicalId = ALIAS_MAP[key];
  if (canonicalId) {
    const canon = CANONICAL_UTILITIES[canonicalId];
    if (canon) {
      // If state hint conflicts, log but still return (alias is authoritative)
      if (stateHint && canon.state !== stateHint.toUpperCase()) {
        console.warn(`[utilityNormalizer] State hint mismatch: alias=${canonicalId} state=${canon.state} hint=${stateHint}`);
      }
      console.log(`[utilityNormalizer] Matched "${rawName}" → ${canonicalId} (alias lookup)`);
      return canon;
    }
  }

  // Step 2: Partial/token match against canonical names
  // Remove noise words, check if cleaned tokens match any canonical name
  const cleanedInput = cleanForMatch(rawName);
  for (const [id, canon] of Object.entries(CANONICAL_UTILITIES)) {
    // State filter: skip if state hint provided and doesn't match
    if (stateHint && canon.state !== stateHint.toUpperCase()) continue;

    const cleanedCanon = cleanForMatch(canon.name);
    // Check if either string contains the other (handles abbreviations)
    if (
      cleanedInput.length >= 4 &&
      (cleanedCanon.includes(cleanedInput) || cleanedInput.includes(cleanedCanon))
    ) {
      console.log(`[utilityNormalizer] Matched "${rawName}" → ${id} (token match)`);
      return canon;
    }
  }

  // Step 3: Acronym match — check if rawName is an acronym of a canonical name
  // e.g. "FPL" matches "Florida Power & Light"
  const upper = rawName.toUpperCase().trim();
  if (upper.length >= 2 && upper.length <= 8 && /^[A-Z&]+$/.test(upper)) {
    for (const [id, canon] of Object.entries(CANONICAL_UTILITIES)) {
      if (stateHint && canon.state !== stateHint.toUpperCase()) continue;
      // Check acronym in canonical name or its parenthetical
      const parenMatch = canon.name.match(/\(([^)]+)\)/);
      if (parenMatch && parenMatch[1].toUpperCase() === upper) {
        console.log(`[utilityNormalizer] Matched "${rawName}" → ${id} (acronym match)`);
        return canon;
      }
    }
  }

  console.log(`[utilityNormalizer] No match for "${rawName}" stateHint=${stateHint ?? 'none'}`);
  return null;
}

/**
 * getCanonicalById — look up a canonical utility by its ID
 */
export function getCanonicalById(id: string): CanonicalUtility | null {
  return CANONICAL_UTILITIES[id] ?? null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const NOISE = new Set([
  'company', 'co', 'corp', 'corporation', 'inc', 'incorporated',
  'llc', 'ltd', 'limited', 'electric', 'electrical', 'electricity',
  'power', 'energy', 'utilities', 'utility', 'service', 'services',
  'light', 'lights', 'gas', 'and', 'the', 'of', '&', 'municipal',
]);

function cleanForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 1 && !NOISE.has(w))
    .join(' ');
}