/**
 * lib/utilityDetector.ts
 * National Utility Detection — finds electric utility provider from lat/lng
 * using NREL URDB API with comprehensive state-level fallback data.
 */

export interface UtilityInfo {
  utilityId: string;
  utilityName: string;
  state: string;
  serviceTerritory?: string;
  // Rate data
  avgRatePerKwh: number;       // $/kWh residential average
  commercialRatePerKwh: number;
  // Rate plans available
  hasResidentialRate: boolean;
  hasCommercialRate: boolean;
  hasTouRate: boolean;
  hasTieredRate: boolean;
  hasDemandCharge: boolean;
  // Net metering
  netMeteringEligible: boolean;
  netMeteringPolicy: string;
  netMeteringMaxKw: number;
  exportCompensationRate: number; // $/kWh for exported energy
  // Interconnection
  interconnectionMaxKw: number;
  interconnectionProcess: string;
  // Source
  urdbRateId?: string;
  source: 'urdb' | 'state_fallback' | 'manual';
  detectedAt: string;
}

export interface UtilityDetectResult {
  success: boolean;
  utility?: UtilityInfo;
  alternatives?: UtilityInfo[];
  error?: string;
}

// ── State-level fallback utility data (all 50 states) ────────────────────────
// Average residential rates from EIA 2024 data
export const STATE_UTILITY_FALLBACK: Record<string, {
  avgRate: number;
  commercialRate: number;
  netMetering: boolean;
  netMeteringPolicy: string;
  netMeteringMaxKw: number;
  exportRate: number;
  interconnectionMaxKw: number;
  majorUtilities: string[];
}> = {
  AL: { avgRate: 0.134, commercialRate: 0.118, netMetering: true,  netMeteringPolicy: 'Avoided cost compensation', netMeteringMaxKw: 25,   exportRate: 0.04,  interconnectionMaxKw: 25,   majorUtilities: ['Alabama Power', 'TVA'] },
  AK: { avgRate: 0.228, commercialRate: 0.195, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 25,   exportRate: 0.228, interconnectionMaxKw: 25,   majorUtilities: ['Chugach Electric', 'Golden Valley Electric'] },
  AZ: { avgRate: 0.128, commercialRate: 0.109, netMetering: true,  netMeteringPolicy: 'Excess energy at avoided cost', netMeteringMaxKw: 125,  exportRate: 0.076, interconnectionMaxKw: 125,  majorUtilities: ['APS', 'SRP', 'TEP', 'UNS Electric'] },
  AR: { avgRate: 0.108, commercialRate: 0.092, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 25,   exportRate: 0.108, interconnectionMaxKw: 25,   majorUtilities: ['Entergy Arkansas', 'SWEPCO'] },
  CA: { avgRate: 0.298, commercialRate: 0.241, netMetering: true,  netMeteringPolicy: 'NEM 3.0 — export at avoided cost', netMeteringMaxKw: 1000, exportRate: 0.08,  interconnectionMaxKw: 1000, majorUtilities: ['PG&E', 'SCE', 'SDG&E', 'LADWP', 'SMUD'] },
  CO: { avgRate: 0.138, commercialRate: 0.112, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 120,  exportRate: 0.138, interconnectionMaxKw: 120,  majorUtilities: ['Xcel Energy', 'Black Hills Energy', 'Holy Cross Energy'] },
  CT: { avgRate: 0.248, commercialRate: 0.198, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 2000, exportRate: 0.248, interconnectionMaxKw: 2000, majorUtilities: ['Eversource', 'UI'] },
  DE: { avgRate: 0.138, commercialRate: 0.118, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 25,   exportRate: 0.138, interconnectionMaxKw: 25,   majorUtilities: ['Delmarva Power', 'Delaware Electric Coop'] },
  FL: { avgRate: 0.138, commercialRate: 0.112, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 2000, exportRate: 0.138, interconnectionMaxKw: 2000, majorUtilities: ['FPL', 'Duke Energy Florida', 'Tampa Electric', 'Gulf Power'] },
  GA: { avgRate: 0.128, commercialRate: 0.108, netMetering: true,  netMeteringPolicy: 'Avoided cost compensation', netMeteringMaxKw: 10,   exportRate: 0.04,  interconnectionMaxKw: 10,   majorUtilities: ['Georgia Power', 'Cobb EMC', 'Sawnee EMC'] },
  HI: { avgRate: 0.388, commercialRate: 0.318, netMetering: true,  netMeteringPolicy: 'Customer Self-Supply (CSS)', netMeteringMaxKw: 100,  exportRate: 0.10,  interconnectionMaxKw: 100,  majorUtilities: ['Hawaiian Electric', 'KIUC', 'HELCO'] },
  ID: { avgRate: 0.098, commercialRate: 0.082, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 25,   exportRate: 0.098, interconnectionMaxKw: 25,   majorUtilities: ['Idaho Power', 'Rocky Mountain Power', 'Avista'] },
  IL: { avgRate: 0.148, commercialRate: 0.122, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 2000, exportRate: 0.148, interconnectionMaxKw: 2000, majorUtilities: ['ComEd', 'Ameren Illinois'] },
  IN: { avgRate: 0.128, commercialRate: 0.108, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 1000, exportRate: 0.128, interconnectionMaxKw: 1000, majorUtilities: ['Duke Energy Indiana', 'AES Indiana', 'NIPSCO'] },
  IA: { avgRate: 0.118, commercialRate: 0.098, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 500,  exportRate: 0.118, interconnectionMaxKw: 500,  majorUtilities: ['MidAmerican Energy', 'Alliant Energy'] },
  KS: { avgRate: 0.128, commercialRate: 0.108, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 25,   exportRate: 0.128, interconnectionMaxKw: 25,   majorUtilities: ['Evergy', 'Westar Energy'] },
  KY: { avgRate: 0.118, commercialRate: 0.098, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 30,   exportRate: 0.118, interconnectionMaxKw: 30,   majorUtilities: ['LG&E', 'KU', 'Duke Energy Kentucky'] },
  LA: { avgRate: 0.108, commercialRate: 0.092, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 25,   exportRate: 0.108, interconnectionMaxKw: 25,   majorUtilities: ['Entergy Louisiana', 'Cleco', 'SWEPCO'] },
  ME: { avgRate: 0.198, commercialRate: 0.162, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 660,  exportRate: 0.198, interconnectionMaxKw: 660,  majorUtilities: ['Central Maine Power', 'Versant Power'] },
  MD: { avgRate: 0.148, commercialRate: 0.122, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 2000, exportRate: 0.148, interconnectionMaxKw: 2000, majorUtilities: ['BGE', 'Pepco', 'Delmarva Power', 'Potomac Edison'] },
  MA: { avgRate: 0.248, commercialRate: 0.198, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 2000, exportRate: 0.248, interconnectionMaxKw: 2000, majorUtilities: ['Eversource', 'National Grid', 'Unitil'] },
  MI: { avgRate: 0.178, commercialRate: 0.148, netMetering: true,  netMeteringPolicy: 'Inflow/Outflow billing', netMeteringMaxKw: 150,  exportRate: 0.09,  interconnectionMaxKw: 150,  majorUtilities: ['DTE Energy', 'Consumers Energy', 'UPPCO'] },
  MN: { avgRate: 0.138, commercialRate: 0.112, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 40,   exportRate: 0.138, interconnectionMaxKw: 40,   majorUtilities: ['Xcel Energy', 'Minnesota Power', 'Great Plains Energy'] },
  MS: { avgRate: 0.118, commercialRate: 0.098, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 20,   exportRate: 0.118, interconnectionMaxKw: 20,   majorUtilities: ['Entergy Mississippi', 'Mississippi Power'] },
  MO: { avgRate: 0.118, commercialRate: 0.098, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 100,  exportRate: 0.118, interconnectionMaxKw: 100,  majorUtilities: ['Ameren Missouri', 'Evergy Missouri'] },
  MT: { avgRate: 0.118, commercialRate: 0.098, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 50,   exportRate: 0.118, interconnectionMaxKw: 50,   majorUtilities: ['NorthWestern Energy', 'Montana-Dakota Utilities'] },
  NE: { avgRate: 0.108, commercialRate: 0.092, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 25,   exportRate: 0.108, interconnectionMaxKw: 25,   majorUtilities: ['OPPD', 'LES', 'NPPD'] },
  NV: { avgRate: 0.118, commercialRate: 0.098, netMetering: true,  netMeteringPolicy: 'Net metering 3.0', netMeteringMaxKw: 150,  exportRate: 0.075, interconnectionMaxKw: 150,  majorUtilities: ['NV Energy', 'Valley Electric'] },
  NH: { avgRate: 0.228, commercialRate: 0.188, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 1000, exportRate: 0.228, interconnectionMaxKw: 1000, majorUtilities: ['Eversource NH', 'Unitil', 'NH Electric Coop'] },
  NJ: { avgRate: 0.178, commercialRate: 0.148, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 2000, exportRate: 0.178, interconnectionMaxKw: 2000, majorUtilities: ['PSE&G', 'JCP&L', 'Atlantic City Electric', 'Rockland Electric'] },
  NM: { avgRate: 0.138, commercialRate: 0.112, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 80,   exportRate: 0.138, interconnectionMaxKw: 80,   majorUtilities: ['PNM', 'El Paso Electric', 'Xcel Energy NM'] },
  NY: { avgRate: 0.218, commercialRate: 0.178, netMetering: true,  netMeteringPolicy: 'Value of Distributed Energy Resources (VDER)', netMeteringMaxKw: 2000, exportRate: 0.12,  interconnectionMaxKw: 2000, majorUtilities: ['Con Edison', 'National Grid NY', 'NYSEG', 'RG&E', 'Central Hudson', 'O&R'] },
  NC: { avgRate: 0.118, commercialRate: 0.098, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 1000, exportRate: 0.118, interconnectionMaxKw: 1000, majorUtilities: ['Duke Energy Carolinas', 'Duke Energy Progress', 'Dominion Energy NC'] },
  ND: { avgRate: 0.108, commercialRate: 0.092, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 100,  exportRate: 0.108, interconnectionMaxKw: 100,  majorUtilities: ['Xcel Energy ND', 'Montana-Dakota Utilities', 'Otter Tail Power'] },
  OH: { avgRate: 0.128, commercialRate: 0.108, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 2000, exportRate: 0.128, interconnectionMaxKw: 2000, majorUtilities: ['AEP Ohio', 'FirstEnergy', 'Duke Energy Ohio', 'Dayton Power & Light'] },
  OK: { avgRate: 0.108, commercialRate: 0.092, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 100,  exportRate: 0.108, interconnectionMaxKw: 100,  majorUtilities: ['OG&E', 'PSO', 'OEC'] },
  OR: { avgRate: 0.128, commercialRate: 0.108, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 25,   exportRate: 0.128, interconnectionMaxKw: 25,   majorUtilities: ['PacifiCorp', 'Portland General Electric', 'Pacific Power'] },
  PA: { avgRate: 0.148, commercialRate: 0.122, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 50,   exportRate: 0.148, interconnectionMaxKw: 50,   majorUtilities: ['PECO', 'PPL', 'Duquesne Light', 'Met-Ed', 'Penelec'] },
  RI: { avgRate: 0.248, commercialRate: 0.198, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 5000, exportRate: 0.248, interconnectionMaxKw: 5000, majorUtilities: ['National Grid RI'] },
  SC: { avgRate: 0.138, commercialRate: 0.112, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 20,   exportRate: 0.138, interconnectionMaxKw: 20,   majorUtilities: ['Duke Energy SC', 'Dominion Energy SC', 'SCE&G'] },
  SD: { avgRate: 0.118, commercialRate: 0.098, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 100,  exportRate: 0.118, interconnectionMaxKw: 100,  majorUtilities: ['Xcel Energy SD', 'Montana-Dakota Utilities', 'Black Hills Energy SD'] },
  TN: { avgRate: 0.118, commercialRate: 0.098, netMetering: true,  netMeteringPolicy: 'TVA Generation Partners', netMeteringMaxKw: 50,   exportRate: 0.04,  interconnectionMaxKw: 50,   majorUtilities: ['TVA', 'Memphis Light Gas & Water'] },
  TX: { avgRate: 0.128, commercialRate: 0.108, netMetering: false, netMeteringPolicy: 'No statewide mandate — varies by utility', netMeteringMaxKw: 0,    exportRate: 0.03,  interconnectionMaxKw: 50,   majorUtilities: ['Oncor', 'CenterPoint', 'AEP Texas', 'TNMP', 'Sharyland'] },
  UT: { avgRate: 0.108, commercialRate: 0.092, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 25,   exportRate: 0.108, interconnectionMaxKw: 25,   majorUtilities: ['Rocky Mountain Power', 'Dixie Power'] },
  VT: { avgRate: 0.198, commercialRate: 0.162, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 500,  exportRate: 0.198, interconnectionMaxKw: 500,  majorUtilities: ['Green Mountain Power', 'Burlington Electric'] },
  VA: { avgRate: 0.128, commercialRate: 0.108, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 1000, exportRate: 0.128, interconnectionMaxKw: 1000, majorUtilities: ['Dominion Energy VA', 'Appalachian Power', 'Rappahannock Electric'] },
  WA: { avgRate: 0.108, commercialRate: 0.092, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 100,  exportRate: 0.108, interconnectionMaxKw: 100,  majorUtilities: ['Puget Sound Energy', 'Seattle City Light', 'Pacific Power WA'] },
  WV: { avgRate: 0.118, commercialRate: 0.098, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 25,   exportRate: 0.118, interconnectionMaxKw: 25,   majorUtilities: ['Appalachian Power', 'Monongalia Power', 'Wheeling Power'] },
  WI: { avgRate: 0.178, commercialRate: 0.148, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 20,   exportRate: 0.178, interconnectionMaxKw: 20,   majorUtilities: ['We Energies', 'WPS', 'Alliant Energy WI', 'Madison Gas & Electric'] },
  WY: { avgRate: 0.108, commercialRate: 0.092, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 25,   exportRate: 0.108, interconnectionMaxKw: 25,   majorUtilities: ['Rocky Mountain Power', 'Black Hills Energy WY'] },
  DC: { avgRate: 0.168, commercialRate: 0.138, netMetering: true,  netMeteringPolicy: 'Net metering at retail rate', netMeteringMaxKw: 1000, exportRate: 0.168, interconnectionMaxKw: 1000, majorUtilities: ['Pepco'] },
};

// ── URDB API lookup ───────────────────────────────────────────────────────────
async function lookupUrdb(lat: number, lng: number, stateCode: string): Promise<UtilityInfo | null> {
  const apiKey = process.env.NREL_API_KEY || 'DEMO_KEY';
  try {
    const url = `https://developer.nrel.gov/api/utility_rates/v3.json?api_key=${apiKey}&lat=${lat}&lon=${lng}&radius=0&limit=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const outputs = data?.outputs;
    if (!outputs) return null;

    const utilityName = outputs.utility_name || outputs.company_id || 'Unknown Utility';
    const avgRate = parseFloat(outputs.residential || outputs.commercial || '0.13');
    const commercialRate = parseFloat(outputs.commercial || outputs.residential || '0.11');

    const fallback = STATE_UTILITY_FALLBACK[stateCode];

    return {
      utilityId: String(outputs.utility_id || outputs.company_id || ''),
      utilityName,
      state: stateCode,
      serviceTerritory: outputs.county || '',
      avgRatePerKwh: avgRate || fallback?.avgRate || 0.13,
      commercialRatePerKwh: commercialRate || fallback?.commercialRate || 0.11,
      hasResidentialRate: true,
      hasCommercialRate: true,
      hasTouRate: false,
      hasTieredRate: stateCode === 'CA' || stateCode === 'NY',
      hasDemandCharge: false,
      netMeteringEligible: fallback?.netMetering ?? true,
      netMeteringPolicy: fallback?.netMeteringPolicy || 'Net metering at retail rate',
      netMeteringMaxKw: fallback?.netMeteringMaxKw || 25,
      exportCompensationRate: fallback?.exportRate || avgRate,
      interconnectionMaxKw: fallback?.interconnectionMaxKw || 25,
      interconnectionProcess: 'Standard interconnection application',
      urdbRateId: String(outputs.utility_id || ''),
      source: 'urdb',
      detectedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── Main detect function ──────────────────────────────────────────────────────
export async function detectUtility(
  lat: number,
  lng: number,
  stateCode: string,
  city?: string,
): Promise<UtilityDetectResult> {
  // 1. Try URDB API
  const urdbResult = await lookupUrdb(lat, lng, stateCode);
  if (urdbResult) {
    return { success: true, utility: urdbResult };
  }

  // 2. Fall back to state-level data
  const fallback = STATE_UTILITY_FALLBACK[stateCode];
  if (!fallback) {
    return { success: false, error: `No utility data for state: ${stateCode}` };
  }

  const utilityName = fallback.majorUtilities[0] || `${stateCode} Electric Utility`;

  return {
    success: true,
    utility: {
      utilityId: `state_${stateCode}`,
      utilityName,
      state: stateCode,
      avgRatePerKwh: fallback.avgRate,
      commercialRatePerKwh: fallback.commercialRate,
      hasResidentialRate: true,
      hasCommercialRate: true,
      hasTouRate: ['CA', 'NY', 'MA', 'CT', 'NJ', 'IL'].includes(stateCode),
      hasTieredRate: ['CA', 'NY', 'HI', 'MA'].includes(stateCode),
      hasDemandCharge: false,
      netMeteringEligible: fallback.netMetering,
      netMeteringPolicy: fallback.netMeteringPolicy,
      netMeteringMaxKw: fallback.netMeteringMaxKw,
      exportCompensationRate: fallback.exportRate,
      interconnectionMaxKw: fallback.interconnectionMaxKw,
      interconnectionProcess: 'Standard interconnection application',
      source: 'state_fallback',
      detectedAt: new Date().toISOString(),
    },
    alternatives: fallback.majorUtilities.slice(1).map((name, i) => ({
      utilityId: `state_${stateCode}_${i + 1}`,
      utilityName: name,
      state: stateCode,
      avgRatePerKwh: fallback.avgRate,
      commercialRatePerKwh: fallback.commercialRate,
      hasResidentialRate: true,
      hasCommercialRate: true,
      hasTouRate: false,
      hasTieredRate: false,
      hasDemandCharge: false,
      netMeteringEligible: fallback.netMetering,
      netMeteringPolicy: fallback.netMeteringPolicy,
      netMeteringMaxKw: fallback.netMeteringMaxKw,
      exportCompensationRate: fallback.exportRate,
      interconnectionMaxKw: fallback.interconnectionMaxKw,
      interconnectionProcess: 'Standard interconnection application',
      source: 'state_fallback' as const,
      detectedAt: new Date().toISOString(),
    })),
  };
}

// ── Get rate summary for display ─────────────────────────────────────────────
export function getUtilityRateSummary(utility: UtilityInfo): string {
  const parts: string[] = [];
  if (utility.hasTieredRate) parts.push('Tiered');
  if (utility.hasTouRate) parts.push('TOU');
  if (utility.hasDemandCharge) parts.push('Demand');
  if (!parts.length) parts.push('Flat Rate');
  return parts.join(' + ');
}
// ── National utility list by state (for dropdowns) ────────────────────────────
export interface UtilityOption {
  id: string;
  name: string;
  avgRatePerKwh: number;
  netMeteringEligible: boolean;
  netMeteringPolicy: string;
  netMeteringMaxKw: number;
  exportRate: number;
  interconnectionMaxKw: number;
}

export function getUtilitiesByStateNational(stateCode: string): UtilityOption[] {
  const fallback = STATE_UTILITY_FALLBACK[stateCode];
  if (!fallback) return [];
  return fallback.majorUtilities.map((name, i) => ({
    id: `${stateCode.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`,
    name,
    avgRatePerKwh: fallback.avgRate,
    netMeteringEligible: fallback.netMetering,
    netMeteringPolicy: fallback.netMeteringPolicy,
    netMeteringMaxKw: fallback.netMeteringMaxKw,
    exportRate: fallback.exportRate,
    interconnectionMaxKw: fallback.interconnectionMaxKw,
  }));
}
