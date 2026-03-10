import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';
import { upsertLayout, upsertProduction, getProjectById } from '@/lib/db-neon';
import type { EngineeringSeed } from '@/types';

// ─── State-based production factors (kWh/kW/year) ────────────────────────────
const STATE_PRODUCTION_FACTORS: Record<string, number> = {
  AK: 900,  AL: 1350, AR: 1350, AZ: 1700, CA: 1550, CO: 1500,
  CT: 1150, DC: 1200, DE: 1200, FL: 1450, GA: 1350, HI: 1600,
  IA: 1250, ID: 1350, IL: 1200, IN: 1200, KS: 1400, KY: 1250,
  LA: 1400, MA: 1150, MD: 1200, ME: 1100, MI: 1150, MN: 1200,
  MO: 1300, MS: 1400, MT: 1350, NC: 1350, ND: 1250, NE: 1350,
  NH: 1100, NJ: 1200, NM: 1700, NV: 1700, NY: 1100, OH: 1150,
  OK: 1450, OR: 1250, PA: 1150, RI: 1150, SC: 1350, SD: 1300,
  TN: 1300, TX: 1500, UT: 1600, VA: 1250, VT: 1100, WA: 1150,
  WI: 1200, WV: 1150, WY: 1400,
};

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  panelWatts: 440,
  inverterType: 'micro' as const,
  inverterModel: 'Enphase IQ8+',
  systemType: 'roof' as const,
  pricePerWattLow: 2.80,
  pricePerWattHigh: 3.80,
  defaultProductionFactor: 1350,
  performanceRatio: 0.80,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractStateCode(address: string): string | null {
  if (!address) return null;
  // Match "CA", "TX", etc. at end of address or before zip
  const m = address.match(/\b([A-Z]{2})\b(?:\s+\d{5})?(?:\s*$|,)/);
  return m ? m[1] : null;
}

function getProductionFactor(stateCode: string | null): number {
  if (!stateCode) return DEFAULTS.defaultProductionFactor;
  return STATE_PRODUCTION_FACTORS[stateCode.toUpperCase()] ?? DEFAULTS.defaultProductionFactor;
}

// Monthly distribution by production factor tier
function buildMonthlyProduction(annualKwh: number, stateCode: string | null): number[] {
  const state = stateCode?.toUpperCase() ?? '';
  // Desert/Southwest states
  const desertStates = ['AZ', 'NM', 'NV', 'CA', 'TX', 'FL', 'HI'];
  // Northern states
  const northernStates = ['AK', 'ME', 'VT', 'NH', 'MN', 'WI', 'MI', 'NY', 'WA', 'OR'];

  let multipliers: number[];
  if (desertStates.includes(state)) {
    multipliers = [0.70, 0.80, 1.00, 1.10, 1.18, 1.22, 1.18, 1.15, 1.05, 0.90, 0.72, 0.65];
  } else if (northernStates.includes(state)) {
    multipliers = [0.50, 0.62, 0.85, 1.05, 1.20, 1.25, 1.22, 1.15, 0.95, 0.75, 0.52, 0.44];
  } else {
    // Default mid-latitude
    multipliers = [0.60, 0.72, 0.92, 1.08, 1.18, 1.22, 1.20, 1.12, 0.98, 0.82, 0.62, 0.54];
  }

  const total = multipliers.reduce((a, b) => a + b, 0);
  return multipliers.map(m => Math.round((annualKwh * m) / total));
}

// ─── POST /api/engineering/preliminary ────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();
    const {
      projectId,
      annualKwh,
      monthlyKwh,
      electricityRate,
      utilityName,
      stateCode: bodyStateCode,
      address,
    } = body;

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'projectId is required' }, { status: 400 });
    }

    // Verify project belongs to user
    const project = await getProjectById(projectId, user.id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // ─── 1. Resolve usage data ─────────────────────────────────────────────
    const annualUsage: number = annualKwh
      || (monthlyKwh ? monthlyKwh * 12 : 0)
      || 12000; // fallback default

    const monthlyUsage: number = monthlyKwh
      || Math.round(annualUsage / 12);

    // ─── 2. Resolve location ───────────────────────────────────────────────
    const stateCode: string | null =
      bodyStateCode
      || extractStateCode(address || project.address || '')
      || null;

    // ─── 3. System sizing ──────────────────────────────────────────────────
    // Standard sizing: offset 100% of usage
    // Typical system efficiency: 78% (performance ratio × inverter efficiency)
    const productionFactor = getProductionFactor(stateCode);
    // systemKw = annualUsage / productionFactor
    const systemKw = Math.round((annualUsage / productionFactor) * 10) / 10;
    const panelCount = Math.ceil((systemKw * 1000) / DEFAULTS.panelWatts);
    const actualSystemKw = Math.round((panelCount * DEFAULTS.panelWatts) / 100) / 10;

    // ─── 4. Production estimate ────────────────────────────────────────────
    const annualProductionKwh = Math.round(actualSystemKw * productionFactor);
    const monthlyProductionKwh = buildMonthlyProduction(annualProductionKwh, stateCode);
    const co2TonsPerYear = Math.round(annualProductionKwh * 0.000709 * 10) / 10;

    // ─── 5. Pricing estimate ───────────────────────────────────────────────
    const systemWatts = actualSystemKw * 1000;
    const costLow = Math.round(systemWatts * DEFAULTS.pricePerWattLow / 100) * 100;
    const costHigh = Math.round(systemWatts * DEFAULTS.pricePerWattHigh / 100) * 100;

    // ─── 6. Build engineering seed ─────────────────────────────────────────
    const engineeringSeed: EngineeringSeed = {
      annual_kwh: annualUsage,
      monthly_kwh: monthlyUsage,
      electricity_rate: electricityRate ?? null,
      utility: utilityName || '',
      system_kw: actualSystemKw,
      panel_watt: DEFAULTS.panelWatts,
      panel_count: panelCount,
      inverter_type: DEFAULTS.inverterType,
      inverter_model: DEFAULTS.inverterModel,
      system_type: DEFAULTS.systemType,
      production_factor: productionFactor,
      annual_production_kwh: annualProductionKwh,
      cost_low: costLow,
      cost_high: costHigh,
      state_code: stateCode,
      generated_at: new Date().toISOString(),
    };

    // ─── 7. Save seed to project ───────────────────────────────────────────
    const sql = getDb();
    try {
      await sql`
        UPDATE projects
        SET engineering_seed = ${JSON.stringify(engineeringSeed)}::jsonb,
            updated_at = NOW()
        WHERE id = ${projectId}
          AND user_id = ${user.id}
      `;
    } catch (seedErr) {
      // Column may not exist yet — migration hasn't run
      console.warn('[preliminary] Could not save engineering_seed (run migration):', seedErr);
    }

    // ─── 8. Upsert synthetic layout ────────────────────────────────────────
    await upsertLayout({
      projectId,
      userId: user.id,
      systemType: DEFAULTS.systemType,
      panels: [],                    // no panel coordinates — just sizing
      totalPanels: panelCount,
      systemSizeKw: actualSystemKw,
      mapCenter: { lat: 0, lng: 0 },
      mapZoom: 18,
    });

    // ─── 9. Upsert synthetic production ───────────────────────────────────
    const productionResult = {
      id: `prod-prelim-${Date.now()}`,
      projectId,
      layoutId: '',
      annualProductionKwh,
      monthlyProductionKwh,
      performanceRatio: DEFAULTS.performanceRatio,
      specificYield: Math.round(annualProductionKwh / actualSystemKw),
      co2OffsetTons: co2TonsPerYear,
      treesEquivalent: Math.round(co2TonsPerYear * 1000 / 21),
      offsetPercentage: Math.min(Math.round((annualProductionKwh / annualUsage) * 100), 100),
      capacityFactor: Math.round((annualProductionKwh / (actualSystemKw * 8760)) * 100) / 100,
      calculatedAt: new Date().toISOString(),
    };

    const costEstimate = {
      systemSizeKw: actualSystemKw,
      grossCost: costHigh,
      laborCost: Math.round(costHigh * 0.25),
      equipmentCost: Math.round(costHigh * 0.55),
      fixedCosts: 2000,
      totalBeforeCredit: costHigh,
      taxCredit: Math.round(costHigh * 0.30),
      netCost: Math.round(costHigh * 0.70),
      annualSavings: Math.round(annualProductionKwh * (electricityRate ?? 0.13)),
      paybackYears: Math.round((costHigh * 0.70) / Math.round(annualProductionKwh * (electricityRate ?? 0.13)) * 10) / 10,
      lifetimeSavings: Math.round(annualProductionKwh * (electricityRate ?? 0.13) * 25),
      roi: Math.round(((annualProductionKwh * (electricityRate ?? 0.13) * 25 - costHigh * 0.70) / (costHigh * 0.70)) * 100),
    };

    await upsertProduction({
      projectId,
      userId: user.id,
      production: productionResult,
      costEstimate,
      systemSizeKw: actualSystemKw,
      panelCount,
    });

    // ─── 10. Return seed + summary ─────────────────────────────────────────
    return NextResponse.json({
      success: true,
      data: {
        engineeringSeed,
        systemKw: actualSystemKw,
        panelCount,
        annualProductionKwh,
        costLow,
        costHigh,
        productionFactor,
        stateCode,
        summary: `${actualSystemKw} kW system · ${panelCount} panels · ${annualProductionKwh.toLocaleString()} kWh/yr`,
      },
    });

  } catch (error: unknown) {
    console.error('[POST /api/engineering/preliminary]', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}