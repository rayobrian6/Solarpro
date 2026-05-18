/**
 * lib/db/production.ts
 * Production results and project-with-details DB operations — extracted from lib/db-neon.ts.
 */

import { getDbReady, isValidUUID, assertUUID, rowToLayout, parseDbFloat } from './core';

// ============================================================
// PRODUCTION — save/load calculated production results
// ============================================================

export async function upsertProduction(data: {
  projectId: string;
  userId: string;
  production: import('@/types').ProductionResult;
  costEstimate: import('@/types').CostEstimate;
  selectedPanel?: import('@/types').SolarPanel | null;
  selectedInverter?: import('@/types').Inverter | null;
  systemSizeKw?: number;
  panelCount?: number;
}): Promise<void> {
  if (!isValidUUID(data.projectId) || !isValidUUID(data.userId)) return;
  const sql = await getDbReady();
  const dataJson = JSON.stringify({
    production: data.production,
    costEstimate: data.costEstimate,
    selectedPanel: data.selectedPanel ?? null,
    selectedInverter: data.selectedInverter ?? null,
    savedAt: new Date().toISOString(),
  });
  const sizeKw = data.systemSizeKw ?? 0;
  const panelCount = data.panelCount ?? 0;
  try {
    // Try upsert with data_json column (requires migration 003)
    await sql`
      INSERT INTO productions (
        project_id, user_id,
        annual_production_kwh, monthly_production,
        system_size_kw, panel_count,
        performance_ratio, specific_yield, co2_offset_kg,
        data_json
      )
      VALUES (
        ${data.projectId}, ${data.userId},
        ${data.production.annualProductionKwh},
        ${JSON.stringify(data.production.monthlyProductionKwh)}::jsonb,
        ${sizeKw},
        ${panelCount},
        ${data.production.performanceRatio ?? 0.8},
        ${data.production.specificYield ?? 0},
        ${(data.production.co2OffsetTons ?? 0) * 1000},
        ${dataJson}::jsonb
      )
      ON CONFLICT (project_id)
      DO UPDATE SET
        annual_production_kwh = EXCLUDED.annual_production_kwh,
        monthly_production    = EXCLUDED.monthly_production,
        system_size_kw        = EXCLUDED.system_size_kw,
        panel_count           = EXCLUDED.panel_count,
        performance_ratio     = EXCLUDED.performance_ratio,
        specific_yield        = EXCLUDED.specific_yield,
        co2_offset_kg         = EXCLUDED.co2_offset_kg,
        data_json             = EXCLUDED.data_json,
        calculated_at         = NOW()
    `;
  } catch {
    // Fallback: basic upsert without data_json (migration not yet run)
    try {
      await sql`
        INSERT INTO productions (
          project_id, user_id,
          annual_production_kwh, monthly_production,
          system_size_kw, panel_count,
          performance_ratio, specific_yield, co2_offset_kg
        )
        VALUES (
          ${data.projectId}, ${data.userId},
          ${data.production.annualProductionKwh},
          ${JSON.stringify(data.production.monthlyProductionKwh)}::jsonb,
          ${sizeKw},
          ${panelCount},
          ${data.production.performanceRatio ?? 0.8},
          ${data.production.specificYield ?? 0},
          ${(data.production.co2OffsetTons ?? 0) * 1000}
        )
        ON CONFLICT (project_id)
        DO UPDATE SET
          annual_production_kwh = EXCLUDED.annual_production_kwh,
          monthly_production    = EXCLUDED.monthly_production,
          system_size_kw        = EXCLUDED.system_size_kw,
          panel_count           = EXCLUDED.panel_count,
          performance_ratio     = EXCLUDED.performance_ratio,
          specific_yield        = EXCLUDED.specific_yield,
          co2_offset_kg         = EXCLUDED.co2_offset_kg,
          calculated_at         = NOW()
      `;
    } catch {
      // If no unique constraint yet, just insert (ignore duplicate)
      try {
        await sql`
          INSERT INTO productions (
            project_id, user_id,
            annual_production_kwh, monthly_production,
            system_size_kw, panel_count,
            performance_ratio, specific_yield, co2_offset_kg
          )
          VALUES (
            ${data.projectId}, ${data.userId},
            ${data.production.annualProductionKwh},
            ${JSON.stringify(data.production.monthlyProductionKwh)}::jsonb,
            ${sizeKw}, ${panelCount},
            ${data.production.performanceRatio ?? 0.8},
            ${data.production.specificYield ?? 0},
            ${(data.production.co2OffsetTons ?? 0) * 1000}
          )
        `;
      } catch { /* best effort */ }
    }
  }
}

// ============================================================
// PROJECT WITH DETAILS — joins layout + client + production
// ============================================================

export async function getProjectWithDetails(
  projectId: string,
  userId: string
): Promise<import('@/types').Project | null> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();

  // Fetch project, layout, client, and production in parallel
  const [projectRows, layoutRows, productionRows] = await Promise.all([
    sql`
      SELECT p.*, c.id as c_id, c.name as c_name, c.email as c_email,
             c.phone as c_phone, c.address as c_address, c.city as c_city,
             c.state as c_state, c.zip as c_zip,
             c.utility_provider as c_utility_provider,
             c.utility_rate as c_utility_rate,
             c.average_monthly_bill as c_avg_bill,
             c.annual_kwh as c_annual_kwh
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id AND c.user_id = ${userId}
      WHERE p.id = ${projectId} AND p.user_id = ${userId} AND p.deleted_at IS NULL
      LIMIT 1
    `,
    sql`
      SELECT * FROM layouts
      WHERE project_id = ${projectId} AND user_id = ${userId}
      ORDER BY updated_at DESC LIMIT 1
    `,
    sql`
      SELECT * FROM productions
      WHERE project_id = ${projectId} AND user_id = ${userId}
      ORDER BY calculated_at DESC LIMIT 1
    `,
  ]);

  if (projectRows.length === 0) return null;

  const row = projectRows[0];

  // Build client object if joined
  const client: import('@/types').Client | undefined = row.c_id ? {
    id: row.c_id as string,
    userId,
    name: row.c_name as string,
    email: row.c_email as string,
    phone: (row.c_phone as string) || '',
    address: (row.c_address as string) || '',
    city: (row.c_city as string) || '',
    state: (row.c_state as string) || '',
    zip: (row.c_zip as string) || '',
    utilityProvider: (row.c_utility_provider as string) || '',
    utilityRate: (row.c_utility_rate as number) || 0.13,
    averageMonthlyBill: (row.c_avg_bill as number) || 0,
    annualKwh: (row.c_annual_kwh as number) || 0,
    averageMonthlyKwh: 0,
    annualBill: 0,
    monthlyKwh: [],
    createdAt: '',
    updatedAt: '',
  } : undefined;

  // Build layout object if found
  const layout: import('@/types').Layout | undefined = layoutRows.length > 0
    ? rowToLayout(layoutRows[0])
    : undefined;

  // Build production + costEstimate from saved data_json or raw columns
  let production: import('@/types').ProductionResult | undefined;
  let costEstimate: import('@/types').CostEstimate | undefined;
  let selectedPanel: import('@/types').SolarPanel | undefined;
  let selectedInverter: import('@/types').Inverter | undefined;

  if (productionRows.length > 0) {
    const pr = productionRows[0];
    // Try to read from data_json first (full fidelity)
    const dj = pr.data_json as Record<string, unknown> | null;
    if (dj?.production) {
      production = dj.production as import('@/types').ProductionResult;
      costEstimate = dj.costEstimate as import('@/types').CostEstimate;
      selectedPanel = (dj.selectedPanel as import('@/types').SolarPanel) ?? undefined;
      selectedInverter = (dj.selectedInverter as import('@/types').Inverter) ?? undefined;
    } else {
      // Reconstruct from raw columns
      const monthly = (pr.monthly_production as number[]) || [];
      const co2Tons = ((pr.co2_offset_kg as number) || 0) / 1000;
      production = {
        id: pr.id as string,
        projectId: projectId,
        layoutId: '',
        annualProductionKwh: (pr.annual_production_kwh as number) || 0,
        monthlyProductionKwh: monthly,
        performanceRatio: (pr.performance_ratio as number) || 0.8,
        specificYield: (pr.specific_yield as number) || 0,
        co2OffsetTons: co2Tons,
        treesEquivalent: Math.round(co2Tons * 1000 / 21),
        offsetPercentage: 0,
        capacityFactor: 0,
        calculatedAt: pr.calculated_at as string,
      };
    }
  }

  // Hydrate bill_data JSONB into typed BillAnalysis + utility fields
  const rawBillData = row.bill_data as Record<string, unknown> | undefined;
  let billAnalysis: import('@/types').BillAnalysis | undefined;
  let utilityName: string | undefined;
  let utilityRatePerKwh: number | undefined;
  let stateCode: string | undefined;
  // FIX v47.8: city hydration from bill_data._city (matches rowToProject fix)
  let cityDetail: string | undefined;

  if (rawBillData) {
    if (rawBillData._billAnalysis) {
      billAnalysis = rawBillData._billAnalysis as import('@/types').BillAnalysis;
      utilityName = (rawBillData._utilityName as string) || undefined;
      utilityRatePerKwh = (rawBillData._utilityRatePerKwh as number) || undefined;
      stateCode = (rawBillData._stateCode as string) || undefined;
      // FIX v47.8: hydrate city from bill_data._city
      cityDetail = (rawBillData._city as string) || undefined;
    } else if (rawBillData.monthlyKwh || rawBillData.annualKwh || rawBillData.estimatedAnnualKwh
               || rawBillData.monthlyUsageHistory || rawBillData.utilityProvider
               || rawBillData.electricityRate) {
      // Flat format: synthesize BillAnalysis from raw OCR/provision fields
      // Also triggered on utilityProvider/electricityRate alone so rate lookup works
      // even when kWh fields were not extracted.
      // Priority for monthly array: monthlyUsageHistory[] > monthlyKwh[] > fill from annual
      const rawHistory2 = rawBillData.monthlyUsageHistory;
      const rawMonthly2 = rawBillData.monthlyKwh;
      const monthlyKwhArray2: number[] = Array.isArray(rawHistory2) && (rawHistory2 as number[]).length >= 3
        ? (rawHistory2 as number[]).slice(0, 12)
        : Array.isArray(rawMonthly2)
          ? (rawMonthly2 as number[])
          : (() => {
              const annKwh2 = ((rawBillData.annualKwh as number) || 0)
                || ((rawBillData.estimatedAnnualKwh as number) || 0)
                || (typeof rawBillData.monthlyKwh === 'number' ? (rawBillData.monthlyKwh as number) * 12 : 0);
              const avg2 = Math.round(annKwh2 / 12);
              return Array(12).fill(avg2 > 0 ? avg2 : 0);
            })();
      const annualKwh2 = ((rawBillData.annualKwh as number) || 0)
        || ((rawBillData.estimatedAnnualKwh as number) || 0)
        || monthlyKwhArray2.reduce((a: number, b: number) => a + b, 0);
      const avgMonthlyKwh2 = Math.round(annualKwh2 / 12);
      // Rate: validate against utility DB to always get retail rate, not supply-only component
      const _utilityNameForRate2 = (rawBillData.utilityProvider as string) || (row.utility_name as string) || null;
      const _rawRate2 = ((rawBillData.electricityRate as number) > 0 ? (rawBillData.electricityRate as number) : null)
        ?? ((row.utility_rate_per_kwh as number) > 0 ? (row.utility_rate_per_kwh as number) : null);
      const _rateValidation2 = validateAndCorrectUtilityRate(_rawRate2, _utilityNameForRate2);
      const utilityRate2 = _rateValidation2.rate;
      const avgMonthlyBill2 = ((rawBillData.estimatedMonthlyBill as number) || 0)
        || ((rawBillData.totalAmount as number) || 0)
        || Math.round(avgMonthlyKwh2 * utilityRate2 * 100) / 100;
      const monthlyKwhSafe2 = monthlyKwhArray2.length > 0 ? monthlyKwhArray2 : [0];
      const peakKwh2 = Math.max(...monthlyKwhSafe2);
      const peakMonth2 = monthlyKwhSafe2.indexOf(peakKwh2);
      // Also hydrate top-level utility fields from flat data
      utilityName = _utilityNameForRate2 || undefined;
      utilityRatePerKwh = utilityRate2;
      stateCode = (rawBillData.stateCode as string) || (row.state_code as string) || undefined;
      cityDetail = (rawBillData.city as string) || (row.city as string) || undefined;
      billAnalysis = {
        monthlyKwh: monthlyKwhArray2,
        annualKwh: annualKwh2,
        averageMonthlyKwh: avgMonthlyKwh2,
        averageMonthlyBill: avgMonthlyBill2,
        annualBill: avgMonthlyBill2 * 12,
        utilityRate: utilityRate2,
        peakMonthKwh: peakKwh2,
        peakMonth: peakMonth2 >= 0 ? peakMonth2 : 0,
        recommendedSystemKw: (rawBillData.systemSizeKw as number) || 0,
        recommendedPanelCount: 0,
        offsetTarget: 100,
      } as import('@/types').BillAnalysis;
    }
  }

  return {
    id: row.id as string,
    userId: row.user_id as string,
    clientId: row.client_id as string | undefined,
    client,
    name: row.name as string,
    status: (row.status as import('@/types').Project['status']) || 'lead',
    systemType: ((row.system_type as import('@/types').Project['systemType']) || 'roof') as import('@/types').Project['systemType'], // FIX v47.218: explicit fallback
    notes: (row.notes as string) || '',
    address: (row.address as string) || '',
    lat: parseDbFloat(row.lat),
    lng: parseDbFloat(row.lng),
    systemSizeKw: parseDbFloat(row.system_size_kw),
    billData: rawBillData,
    billAnalysis,
    utilityName,
    utilityRatePerKwh,
    stateCode,
    // FIX v47.8 + v47.394: city from bill_data._city; also flat bill_data.city fallback
    city: cityDetail || (rawBillData?.city as string) || undefined,
    // FIX v47.394: county and zip come from bill_data JSONB (no dedicated DB columns).
    // Read both the _prefixed form (new format) and the flat form (legacy OCR).
    county: (rawBillData?._county as string)
      || (rawBillData?.county as string)
      || undefined,
    zip: (rawBillData?._zip as string)
      || (rawBillData?.zip as string)
      || undefined,
    layout,
    production,
    costEstimate,
    selectedPanel,
    selectedInverter,
    engineeringSeed: row.engineering_seed
      ? (typeof row.engineering_seed === 'string'
          ? JSON.parse(row.engineering_seed)
          : row.engineering_seed) as import('@/types').EngineeringSeed
      : undefined,
    engineeringConfig: row.engineering_config
      ? (typeof row.engineering_config === 'string'
          ? JSON.parse(row.engineering_config)
          : row.engineering_config) as Record<string, unknown>
      : undefined,
    engineeringUpdatedAt: row.engineering_updated_at as string | undefined,
    noItc: (row.no_itc as boolean) || false,   // v47.243: suppress ITC display
    // v61: Control mode + field locks
    controlMode: ((row.control_mode as string) || 'guided') as import('@/types').ControlMode,
    systemConfigLocks: row.system_config_locks
      ? (typeof row.system_config_locks === 'string'
          ? JSON.parse(row.system_config_locks)
          : row.system_config_locks) as import('@/types').SystemConfigLocks
      : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ============================================================
