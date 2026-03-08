/**
 * lib/autoSizing.ts
 * Auto System Sizing — calculates recommended solar system size from consumption data.
 * Uses PVWatts API for production modeling with location-specific sun hours.
 */

export interface SizingInput {
  annualKwh: number;
  lat: number;
  lng: number;
  stateCode: string;
  offsetPercent?: number;      // default 100%
  tilt?: number;               // default 20°
  azimuth?: number;            // default 180° (south)
  systemLosses?: number;       // default 14%
  moduleType?: 0 | 1 | 2;     // 0=standard, 1=premium, 2=thin film
}

export interface SizingResult {
  success: boolean;
  // System size
  recommendedKw: number;
  minKw: number;               // 80% offset
  maxKw: number;               // 120% offset
  // Production estimates
  annualKwhProduction: number;
  specificYield: number;       // kWh/kWp/year
  capacityFactor: number;      // %
  // Monthly production
  monthlyProduction: number[]; // 12 months
  // Sun data
  peakSunHours: number;
  // Panel count estimates
  panelCount400w: number;
  panelCount430w: number;
  panelCount450w: number;
  // Financial quick estimate
  estimatedSystemCost: number;
  estimatedAnnualSavings: number;
  // Source
  source: 'pvwatts' | 'estimate';
  error?: string;
}

// ── Average sun hours by state (NREL data) ────────────────────────────────────
const STATE_SUN_HOURS: Record<string, number> = {
  AL: 4.7, AK: 3.2, AZ: 6.0, AR: 4.7, CA: 5.4, CO: 5.4, CT: 4.2, DE: 4.3,
  FL: 5.3, GA: 5.0, HI: 5.8, ID: 4.9, IL: 4.4, IN: 4.3, IA: 4.5, KS: 5.0,
  KY: 4.4, LA: 5.0, ME: 4.2, MD: 4.5, MA: 4.2, MI: 4.1, MN: 4.5, MS: 5.0,
  MO: 4.7, MT: 4.9, NE: 5.0, NV: 6.1, NH: 4.2, NJ: 4.4, NM: 6.1, NY: 4.1,
  NC: 4.8, ND: 4.8, OH: 4.1, OK: 5.2, OR: 4.5, PA: 4.2, RI: 4.2, SC: 5.0,
  SD: 5.0, TN: 4.7, TX: 5.3, UT: 5.6, VT: 4.0, VA: 4.6, WA: 4.0, WV: 4.2,
  WI: 4.3, WY: 5.3, DC: 4.4,
};

// ── Average electricity rates by state (EIA 2024) ─────────────────────────────
const STATE_RATES: Record<string, number> = {
  AL: 0.134, AK: 0.228, AZ: 0.128, AR: 0.108, CA: 0.298, CO: 0.138, CT: 0.248,
  DE: 0.138, FL: 0.138, GA: 0.128, HI: 0.388, ID: 0.098, IL: 0.148, IN: 0.128,
  IA: 0.118, KS: 0.128, KY: 0.118, LA: 0.108, ME: 0.198, MD: 0.148, MA: 0.248,
  MI: 0.178, MN: 0.138, MS: 0.118, MO: 0.118, MT: 0.118, NE: 0.108, NV: 0.118,
  NH: 0.228, NJ: 0.178, NM: 0.138, NY: 0.218, NC: 0.118, ND: 0.108, OH: 0.128,
  OK: 0.108, OR: 0.128, PA: 0.148, RI: 0.248, SC: 0.138, SD: 0.118, TN: 0.118,
  TX: 0.128, UT: 0.108, VT: 0.198, VA: 0.128, WA: 0.108, WV: 0.118, WI: 0.178,
  WY: 0.108, DC: 0.168,
};

// ── Monthly irradiance factors (normalized, sum = 12) ─────────────────────────
const MONTHLY_FACTORS = [0.72, 0.82, 0.95, 1.05, 1.12, 1.15, 1.13, 1.10, 1.02, 0.92, 0.75, 0.67];

// ── PVWatts API call ──────────────────────────────────────────────────────────
async function callPvWatts(input: SizingInput, systemKw: number): Promise<{
  annualKwh: number;
  monthlyKwh: number[];
  specificYield: number;
} | null> {
  const apiKey = process.env.NREL_API_KEY || 'DEMO_KEY';
  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      lat: String(input.lat),
      lon: String(input.lng),
      system_capacity: String(systemKw),
      tilt: String(input.tilt ?? 20),
      azimuth: String(input.azimuth ?? 180),
      losses: String(input.systemLosses ?? 14),
      array_type: '1',
      module_type: String(input.moduleType ?? 1),
      timeframe: 'monthly',
    });
    const url = `https://developer.nrel.gov/api/pvwatts/v8.json?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    const outputs = data?.outputs;
    if (!outputs?.ac_monthly) return null;

    const monthlyKwh: number[] = outputs.ac_monthly;
    const annualKwh = outputs.ac_annual || monthlyKwh.reduce((s: number, v: number) => s + v, 0);
    const specificYield = annualKwh / systemKw;

    return { annualKwh, monthlyKwh, specificYield };
  } catch {
    return null;
  }
}

// ── Main sizing function ──────────────────────────────────────────────────────
export async function calculateSystemSize(input: SizingInput): Promise<SizingResult> {
  const offsetPercent = input.offsetPercent ?? 100;
  const targetKwh = input.annualKwh * (offsetPercent / 100);

  // Get sun hours for location
  const sunHours = STATE_SUN_HOURS[input.stateCode] || 4.5;
  const systemLosses = (input.systemLosses ?? 14) / 100;
  const systemEfficiency = 1 - systemLosses;

  // Initial estimate: kWh / (sunHours * 365 * efficiency)
  const kwhPerKwPerYear = sunHours * 365 * systemEfficiency;
  const initialKw = Math.max(1, targetKwh / kwhPerKwPerYear);
  const roundedKw = Math.round(initialKw * 10) / 10;

  // Try PVWatts for accurate production estimate
  const pvwatts = await callPvWatts(input, roundedKw);

  let annualKwhProduction: number;
  let monthlyProduction: number[];
  let specificYield: number;
  let source: 'pvwatts' | 'estimate';

  if (pvwatts) {
    annualKwhProduction = pvwatts.annualKwh;
    monthlyProduction = pvwatts.monthlyKwh;
    specificYield = pvwatts.specificYield;
    source = 'pvwatts';
  } else {
    // Fallback estimate
    annualKwhProduction = roundedKw * kwhPerKwPerYear;
    monthlyProduction = MONTHLY_FACTORS.map(f => Math.round(roundedKw * sunHours * 30.4 * systemEfficiency * f));
    specificYield = kwhPerKwPerYear;
    source = 'estimate';
  }

  // Recalculate recommended size based on actual production
  const actualKwPerKwh = annualKwhProduction / roundedKw;
  const recommendedKw = Math.round((targetKwh / actualKwPerKwh) * 10) / 10;

  // Panel counts
  const panelCount400w = Math.ceil(recommendedKw / 0.400);
  const panelCount430w = Math.ceil(recommendedKw / 0.430);
  const panelCount450w = Math.ceil(recommendedKw / 0.450);

  // Financial estimates
  const rate = STATE_RATES[input.stateCode] || 0.13;
  const estimatedAnnualSavings = Math.round(annualKwhProduction * rate);
  const costPerWatt = 2.85; // national average installed cost $/W
  const estimatedSystemCost = Math.round(recommendedKw * 1000 * costPerWatt);

  return {
    success: true,
    recommendedKw,
    minKw: Math.round(recommendedKw * 0.8 * 10) / 10,
    maxKw: Math.round(recommendedKw * 1.2 * 10) / 10,
    annualKwhProduction: Math.round(annualKwhProduction),
    specificYield: Math.round(specificYield),
    capacityFactor: Math.round((annualKwhProduction / (recommendedKw * 8760)) * 1000) / 10,
    monthlyProduction: monthlyProduction.map(v => Math.round(v)),
    peakSunHours: sunHours,
    panelCount400w,
    panelCount430w,
    panelCount450w,
    estimatedSystemCost,
    estimatedAnnualSavings,
    source,
  };
}