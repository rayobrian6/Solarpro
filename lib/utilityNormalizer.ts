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
  'niagara mohawk': 'NATIONALGRID_NY',
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
  'eversource nh': 'EVERSOURCE_MA',

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