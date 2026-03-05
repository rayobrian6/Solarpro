// ============================================================
// SOLAR PRODUCTION CALCULATION ENGINE
// Uses NREL PVWatts v8 API + local fallback calculations
// ============================================================
import type { ProductionResult, Layout, Client, PVWattsResponse } from '@/types';

const PVWATTS_API_KEY = process.env.PVWATTS_API_KEY || 'DEMO_KEY';
const PVWATTS_BASE_URL = 'https://developer.nrel.gov/api/pvwatts/v8.json';

// Monthly solar irradiance multipliers by climate zone (fallback)
const CLIMATE_MULTIPLIERS: Record<string, number[]> = {
  desert: [0.72, 0.82, 1.02, 1.12, 1.18, 1.22, 1.15, 1.12, 1.05, 0.92, 0.75, 0.68],
  mediterranean: [0.68, 0.78, 0.98, 1.10, 1.18, 1.22, 1.20, 1.15, 1.02, 0.88, 0.70, 0.62],
  continental: [0.55, 0.68, 0.88, 1.05, 1.18, 1.22, 1.20, 1.12, 0.95, 0.78, 0.58, 0.48],
  coastal: [0.62, 0.72, 0.90, 1.05, 1.12, 1.10, 1.08, 1.08, 1.00, 0.85, 0.68, 0.58],
};

// Azimuth correction factors (south=180° is optimal)
function azimuthFactor(azimuth: number): number {
  const deviation = Math.abs(azimuth - 180);
  if (deviation <= 15) return 1.00;
  if (deviation <= 30) return 0.98;
  if (deviation <= 45) return 0.94;
  if (deviation <= 60) return 0.88;
  if (deviation <= 90) return 0.78;
  return 0.65; // East or West facing
}

// Tilt correction factor (optimal tilt ≈ latitude)
function tiltFactor(tilt: number, lat: number): number {
  const optimalTilt = Math.abs(lat);
  const deviation = Math.abs(tilt - optimalTilt);
  if (deviation <= 5) return 1.00;
  if (deviation <= 10) return 0.99;
  if (deviation <= 20) return 0.97;
  if (deviation <= 30) return 0.93;
  if (deviation <= 45) return 0.87;
  if (tilt === 90) return 0.72; // Vertical (fence)
  return 0.80;
}

// Bifacial gain for vertical fence systems
function bifacialGainFactor(tilt: number, bifacialFactor: number, azimuth: number): number {
  if (tilt < 80) return 1.0; // Not vertical enough for bifacial benefit
  // East-West facing vertical panels get maximum bifacial gain
  const isEastWest = (azimuth >= 60 && azimuth <= 120) || (azimuth >= 240 && azimuth <= 300);
  if (isEastWest) return bifacialFactor; // Full bifacial gain
  return 1.0 + (bifacialFactor - 1.0) * 0.5; // Partial gain for other orientations
}

// Determine climate zone from coordinates
function getClimateZone(lat: number, lng: number): string {
  // Southwest US (desert)
  if (lat >= 25 && lat <= 40 && lng >= -120 && lng <= -100) return 'desert';
  // California coast
  if (lat >= 32 && lat <= 42 && lng >= -125 && lng <= -118) return 'mediterranean';
  // Pacific Northwest / Northeast
  if (lat >= 40) return 'continental';
  return 'mediterranean';
}

// ─── PVWatts API Call ─────────────────────────────────────────
export async function fetchPVWatts(params: {
  lat: number;
  lng: number;
  systemSizeKw: number;
  tilt: number;
  azimuth: number;
  losses?: number;
  arrayType?: number; // 0=fixed open rack, 1=fixed roof, 2=1-axis, 4=2-axis
}): Promise<PVWattsResponse | null> {
  try {
    // Guard: validate all required numeric params before calling API
    if (
      params.lat == null || params.lng == null ||
      params.systemSizeKw == null || params.systemSizeKw <= 0 ||
      params.tilt == null || params.azimuth == null ||
      isNaN(params.lat) || isNaN(params.lng) ||
      isNaN(params.systemSizeKw) || isNaN(params.tilt) || isNaN(params.azimuth)
    ) {
      console.warn('PVWatts: invalid params, skipping API call', params);
      return null;
    }
    const url = new URL(PVWATTS_BASE_URL);
    url.searchParams.set('api_key', PVWATTS_API_KEY);
    url.searchParams.set('lat', params.lat.toString());
    url.searchParams.set('lon', params.lng.toString());
    url.searchParams.set('system_capacity', params.systemSizeKw.toString());
    url.searchParams.set('tilt', params.tilt.toString());
    url.searchParams.set('azimuth', params.azimuth.toString());
    url.searchParams.set('losses', (params.losses ?? 14).toString());
    url.searchParams.set('array_type', (params.arrayType ?? 1).toString());
    url.searchParams.set('module_type', '1'); // Premium
    url.searchParams.set('timeframe', 'monthly');

    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error(`PVWatts API error: ${response.status}`);
    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`PVWatts returned non-JSON response`);
    }

    if (data.errors && data.errors.length > 0) {
      console.warn('PVWatts errors:', data.errors);
      return null;
    }

    return {
      ac_annual: data.outputs.ac_annual,
      ac_monthly: data.outputs.ac_monthly,
      solrad_annual: data.outputs.solrad_annual,
      solrad_monthly: data.outputs.solrad_monthly,
      capacity_factor: data.outputs.capacity_factor,
    };
  } catch (err) {
    console.warn('PVWatts API unavailable, using local calculation:', err);
    return null;
  }
}

// ─── Local Fallback Calculation ───────────────────────────────
export function calculateProductionLocal(params: {
  lat: number;
  lng: number;
  systemSizeKw: number;
  tilt: number;
  azimuth: number;
  losses?: number;
  bifacialFactor?: number;
}): PVWattsResponse {
  const { lat, lng, systemSizeKw, tilt, azimuth, losses = 14, bifacialFactor = 1.0 } = params;

  // Base irradiance (kWh/m²/day) by latitude
  const baseIrradiance = Math.max(3.5, 6.5 - Math.abs(lat - 25) * 0.04);

  // Climate zone multipliers
  const zone = getClimateZone(lat, lng);
  const monthlyMultipliers = CLIMATE_MULTIPLIERS[zone] || CLIMATE_MULTIPLIERS.mediterranean;

  // Correction factors
  const azFactor = azimuthFactor(azimuth);
  const tiltFactor_ = tiltFactor(tilt, lat);
  const bifacialGain = bifacialGainFactor(tilt, bifacialFactor, azimuth);
  const systemLossFactor = 1 - losses / 100;

  // Days per month
  const daysPerMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Calculate monthly AC production
  const ac_monthly = monthlyMultipliers.map((mult, i) => {
    const dailyProduction = systemSizeKw * baseIrradiance * mult * azFactor * tiltFactor_ * bifacialGain * systemLossFactor;
    return Math.round(dailyProduction * daysPerMonth[i]);
  });

  const ac_annual = ac_monthly.reduce((sum, v) => sum + v, 0);

  // Solar radiation (kWh/m²/day)
  const solrad_monthly = monthlyMultipliers.map(m => parseFloat((baseIrradiance * m).toFixed(2)));
  const solrad_annual = parseFloat((solrad_monthly.reduce((s, v) => s + v, 0) / 12).toFixed(2));

  const capacity_factor = parseFloat(((ac_annual / (systemSizeKw * 8760)) * 100).toFixed(1));

  return { ac_annual, ac_monthly, solrad_annual, solrad_monthly, capacity_factor };
}

// ─── Main Production Calculator ───────────────────────────────
export async function calculateProduction(
  layout: Layout,
  client: Client
): Promise<Omit<ProductionResult, 'id' | 'calculatedAt'>> {
  const { systemType } = layout;
  const systemSizeKw = (layout.systemSizeKw && layout.systemSizeKw > 0) ? layout.systemSizeKw : 1.0;
  const lat = (client.lat && !isNaN(client.lat)) ? client.lat : 33.4484;
  const lng = (client.lng && !isNaN(client.lng)) ? client.lng : -112.0740;

  // Determine tilt and azimuth based on system type
  // Priority: actual panel data > roof planes > layout defaults
  let tilt = layout.groundTilt ?? 20;
  let azimuth = layout.groundAzimuth ?? 180;
  let bifacialFactor = 1.0;
  let arrayType = 1; // fixed roof mount

  // Extract from actual placed panels if available (most accurate)
  if (layout.panels && layout.panels.length > 0) {
    const panelTilts = layout.panels
      .map((p: any) => p.tilt ?? 0)
      .filter((t: number) => t > 0 && t < 90);
    const panelAzimuths = layout.panels
      .map((p: any) => p.azimuth ?? 0)
      .filter((a: number) => a > 0);
    
    if (panelTilts.length > 0) {
      tilt = panelTilts.reduce((a: number, b: number) => a + b, 0) / panelTilts.length;
    }
    if (panelAzimuths.length > 0) {
      azimuth = panelAzimuths.reduce((a: number, b: number) => a + b, 0) / panelAzimuths.length;
    }
    
    // Check if any panels are bifacial
    const bifacialPanels = layout.panels.filter((p: any) => p.bifacialGain && p.bifacialGain > 1.0);
    if (bifacialPanels.length > 0) {
      bifacialFactor = bifacialPanels.reduce((a: number, p: any) => a + (p.bifacialGain ?? 1.0), 0) / bifacialPanels.length;
    }
  }

  if (systemType === 'roof') {
    // Use panel data if available, otherwise roof planes
    if (!layout.panels || layout.panels.length === 0) {
      tilt = layout.roofPlanes?.[0]?.pitch ?? tilt;
      azimuth = layout.roofPlanes?.[0]?.azimuth ?? azimuth;
    }
    arrayType = 1;
  } else if (systemType === 'ground') {
    if (!layout.panels || layout.panels.length === 0) {
      tilt = layout.groundTilt ?? 25;
      azimuth = layout.groundAzimuth ?? 180;
    }
    arrayType = 0; // open rack
  } else if (systemType === 'fence') {
    tilt = 90; // Vertical
    if (!layout.panels || layout.panels.length === 0) {
      azimuth = layout.fenceAzimuth ?? 180;
    }
    bifacialFactor = layout.bifacialOptimized ? 1.20 : (bifacialFactor > 1.0 ? bifacialFactor : 1.10);
    arrayType = 0;
  }
  
  // Ensure valid values
  tilt = Math.max(0, Math.min(90, isNaN(tilt) ? 20 : tilt));
  azimuth = Math.max(0, Math.min(360, isNaN(azimuth) ? 180 : azimuth));

  // Try PVWatts API first, fall back to local
  let pvData = await fetchPVWatts({
    lat, lng, systemSizeKw, tilt, azimuth,
    losses: 14,
    arrayType,
  });

  if (!pvData) {
    pvData = calculateProductionLocal({
      lat, lng, systemSizeKw, tilt, azimuth,
      losses: 14,
      bifacialFactor,
    });
  } else if (systemType === 'fence' && bifacialFactor > 1.0) {
    // Apply bifacial gain on top of PVWatts result
    const gain = bifacialGainFactor(90, bifacialFactor, azimuth);
    pvData.ac_annual = Math.round(pvData.ac_annual * gain);
    pvData.ac_monthly = pvData.ac_monthly.map(v => Math.round(v * gain));
  }

  const annualProductionKwh = Math.round(pvData.ac_annual);
  const monthlyProductionKwh = pvData.ac_monthly.map(Math.round);
  const offsetPercentage = Math.min(100, Math.round((annualProductionKwh / client.annualKwh) * 100));
  const specificYield = Math.round(annualProductionKwh / systemSizeKw);
  const co2OffsetTons = parseFloat((annualProductionKwh * 0.000386).toFixed(2));
  const treesEquivalent = Math.round(co2OffsetTons * 16.5);

  return {
    projectId: layout.projectId,
    layoutId: layout.id,
    annualProductionKwh,
    monthlyProductionKwh,
    offsetPercentage,
    specificYield,
    performanceRatio: 0.80,
    capacityFactor: pvData.capacity_factor,
    co2OffsetTons,
    treesEquivalent,
    pvWattsData: pvData,
  };
}

// ─── Cost Calculator ──────────────────────────────────────────
export function calculateCost(
  systemSizeKw: number,
  annualProductionKwh: number,
  client: Client,
  pricing: {
    pricePerWatt: number;
    laborCostPerWatt: number;
    equipmentCostPerWatt: number;
    fixedCosts: number;
    profitMargin: number;
    taxCreditRate: number;
    utilityEscalationRate: number;
    systemLifeYears: number;
  }
) {
  const systemSizeW = systemSizeKw * 1000;
  const laborCost = systemSizeW * pricing.laborCostPerWatt;
  const equipmentCost = systemSizeW * pricing.equipmentCostPerWatt;
  const fixedCosts = pricing.fixedCosts;
  const baseCost = laborCost + equipmentCost + fixedCosts;
  const profitAmount = baseCost * (pricing.profitMargin / 100);
  const grossCost = baseCost + profitAmount;
  const taxCredit = grossCost * (pricing.taxCreditRate / 100);
  const netCost = grossCost - taxCredit;

  // Savings calculation with utility escalation
  const annualSavings = annualProductionKwh * client.utilityRate;
  let lifetimeSavings = 0;
  let rate = client.utilityRate;
  for (let y = 0; y < pricing.systemLifeYears; y++) {
    lifetimeSavings += annualProductionKwh * rate;
    rate *= (1 + pricing.utilityEscalationRate / 100);
  }

  const paybackYears = parseFloat((netCost / annualSavings).toFixed(1));
  const roi = parseFloat((((lifetimeSavings - netCost) / netCost) * 100).toFixed(1));

  return {
    systemSizeKw,
    grossCost: Math.round(grossCost),
    laborCost: Math.round(laborCost),
    equipmentCost: Math.round(equipmentCost),
    fixedCosts: Math.round(fixedCosts),
    totalBeforeCredit: Math.round(grossCost),
    taxCredit: Math.round(taxCredit),
    netCost: Math.round(netCost),
    annualSavings: Math.round(annualSavings),
    paybackYears,
    lifetimeSavings: Math.round(lifetimeSavings),
    roi,
  };
}