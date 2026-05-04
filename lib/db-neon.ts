/**
 * lib/db-neon.ts
 * Persistent database layer using Neon PostgreSQL.
 *
 * CRITICAL NOTE ON NEON TAGGED TEMPLATE SQL:
 * Neon's sql`` tagged template automatically parameterizes all ${value} interpolations.
 * They become $1, $2, ... placeholders in the final query.
 * DO NOT append ::uuid after interpolated values — e.g. ${userId}::uuid is WRONG.
 * The ::uuid cast must only appear in static SQL parts, not after parameters.
 * Postgres infers UUID type from the column definition automatically.
 *
 * CORRECT:   WHERE user_id = ${userId}
 * INCORRECT: WHERE user_id = ${userId}::uuid  ← causes "invalid input syntax for type uuid"
 */

import { neon } from '@neondatabase/serverless';
import { DbConfigError, getDbWithRetry as _getDbWithRetry } from '@/lib/db-ready';
import { Client, Project, Layout } from '@/types';
import { validateAndCorrectUtilityRate } from '@/lib/utility-rules';

// v47.9: Module-level startup log — appears once per Vercel function instance cold start.
// Searchable in Vercel function logs to trace deployment startup sequence.
console.log('[SERVER_INSTANCE_STARTED] db-neon.ts module loaded');
console.log(`[ENVIRONMENT_LOADED] DATABASE_URL present: ${!!process.env.DATABASE_URL} NODE_ENV: ${process.env.NODE_ENV} VERCEL_ENV: ${process.env.VERCEL_ENV || 'local'}`);

// ============================================================
// PRICING CONFIG TYPE
// ============================================================
export type PricingMode = 'per_panel' | 'per_watt' | 'cost_plus';

export interface DbPricingConfig {
  id: string;
  // Pricing mode
  pricingMode: PricingMode;
  // Per-watt pricing
  pricePerWatt: number;
  laborCostPerWatt: number;
  equipmentCostPerWatt: number;
  roofPricePerWatt: number | null;
  groundPricePerWatt: number | null;
  fencePricePerWatt: number | null;
  carportPricePerWatt: number | null;
  // Per-panel pricing
  roofPricePerPanel: number | null;
  groundPricePerPanel: number | null;
  fencePricePerPanel: number | null;
  defaultPanelWattage: number;
  // Cost-plus pricing
  materialCostPerPanel: number;
  laborCostPerPanel: number;
  overheadPercent: number;
  marginPercent: number;
  // Shared financial settings
  fixedCost: number;
  profitMargin: number;
  utilityEscalation: number;
  systemLife: number;
  // ITC — commercial vs residential
  isCommercial: boolean;
  itcRateCommercial: number;
  itcRateResidential: number;
  updatedAt: string;
}

/**
 * Synchronous DB getter — throws DbConfigError (non-retryable) if DATABASE_URL
 * is missing, otherwise returns a Neon SQL executor.
 *
 * NOTE: For routes that run immediately after a Vercel deployment (cold start),
 * prefer getDbReady() which retries on transient Neon wake-up errors.
 */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url || url === 'YOUR_NEON_DATABASE_URL_HERE') {
    console.error(
      '\n[db-neon:getDb] DATABASE_URL is not configured.\n' +
      '  -> Add DATABASE_URL to your Vercel project environment variables.\n' +
      '  -> Get it from: https://console.neon.tech -> your project -> Connection string\n'
    );
    throw new DbConfigError('DATABASE_URL is not set. Add it to your Vercel environment variables.');
  }
  return neon(url);
}

/**
 * Async DB getter with cold-start retry (up to 3x, exponential backoff 1s/2s/4s).
 * Use this for any route that may run immediately after a Vercel deployment.
 */
export async function getDbReady() {
  return _getDbWithRetry();
}

export { DbConfigError } from '@/lib/db-ready';

// ============================================================
// ROUTE ERROR HANDLER — cold-start resilient 503 responses
// ============================================================

/**
 * handleRouteDbError — standardized DB error handler for all API routes.
 *
 * Maps DbConfigError → 503 DB_CONFIG_ERROR (genuine misconfiguration)
 * Maps all other DB errors → 503 DB_STARTING (transient Neon cold start)
 *
 * CRITICAL: Never return 500 for DB errors — UserContext treats 500 as
 * transient and retries, but 503+code tells the frontend exactly what happened.
 *
 * Usage in route catch blocks:
 *   } catch (error: unknown) {
 *     return handleRouteDbError('[GET /api/proposals]', error);
 *   }
 */
export function handleRouteDbError(
  routeLabel: string,
  error: unknown
): import('next/server').NextResponse {
  const { NextResponse } = require('next/server');

  if (error instanceof DbConfigError) {
    console.error(`${routeLabel} DB_CONFIG_ERROR:`, (error as Error).message);
    return NextResponse.json(
      { success: false, error: 'Database not configured. Please contact your administrator.', code: 'DB_CONFIG_ERROR' },
      { status: 503 }
    );
  }

  // All other errors (connection refused, timeout, cold-start wake-up) → DB_STARTING
  console.error(`${routeLabel} DB_STARTING:`, error);
  return NextResponse.json(
    { success: false, error: 'Service temporarily unavailable. Please try again in a moment.', code: 'DB_STARTING' },
    {
      status: 503,
      headers: { 'Retry-After': '3' },
    }
  );
}

// ============================================================
// UUID VALIDATION — prevents "invalid input syntax for type uuid"
// ============================================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true if the string is a valid UUID.
 */
export function isValidUUID(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s.trim());
}

/**
 * Throws a clear error if the value is not a valid UUID.
 */
function assertUUID(value: unknown, fieldName: string): string {
  if (!isValidUUID(value)) {
    throw new Error(`Invalid ${fieldName}: "${value}" is not a valid UUID`);
  }
  return (value as string).trim();
}

// ============================================================
// TYPE HELPERS
// ============================================================

/**
 * Parse a PostgreSQL numeric/decimal column that arrives as a string in JSON.
 * Postgres.js / Neon return NUMERIC/DECIMAL as strings to preserve precision.
 * TypeScript `as number` is compile-time only -- it does NOT coerce at runtime.
 * Without this helper, hasValidCoords() fails because typeof 8.707\ === \string\,
 * causing the map to fall back to Phoenix default coords and geocode needlessly.
 */
function parseDbFloat(val: unknown): number | undefined {
  if (val === null || val === undefined) return undefined;
  const n = typeof val === 'number' ? val : parseFloat(val as string);
  return isFinite(n) ? n : undefined;
}

function rowToClient(row: Record<string, unknown>): Client {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    email: row.email as string,
    phone: (row.phone as string) || '',
    address: (row.address as string) || '',
    city: (row.city as string) || '',
    state: (row.state as string) || '',
    zip: (row.zip as string) || '',
    lat: parseDbFloat(row.lat),
    lng: parseDbFloat(row.lng),
    utilityProvider: (row.utility_provider as string) || '',
    monthlyKwh: (row.monthly_kwh as number[]) || [],
    annualKwh: (row.annual_kwh as number) || 0,
    averageMonthlyKwh: (row.average_monthly_kwh as number) || 0,
    averageMonthlyBill: (row.average_monthly_bill as number) || 0,
    annualBill: (row.annual_bill as number) || 0,
    utilityRate: (row.utility_rate as number) || 0.13,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToProject(row: Record<string, unknown>): Project {
  // Hydrate bill_data JSONB into typed BillAnalysis + utility fields
  const rawBillData = row.bill_data as Record<string, unknown> | undefined;
  let billAnalysis: import('@/types').BillAnalysis | undefined;
  let utilityName: string | undefined;
  let utilityRatePerKwh: number | undefined;
  let stateCode: string | undefined;
  // FIX v47.8: city was never hydrated from bill_data -- added _city hydration
  let city: string | undefined;

  if (rawBillData) {
    // bill_data may have been saved with billAnalysis nested or flat
    if (rawBillData._billAnalysis) {
      // New format: bill_data._billAnalysis = BillAnalysis object
      billAnalysis = rawBillData._billAnalysis as import('@/types').BillAnalysis;
      utilityName = (rawBillData._utilityName as string) || undefined;
      utilityRatePerKwh = (rawBillData._utilityRatePerKwh as number) || undefined;
      stateCode = (rawBillData._stateCode as string) || undefined;
      // FIX v47.8: hydrate city from bill_data._city (stored by handleBillComplete)
      city = (rawBillData._city as string) || undefined;
    } else if (rawBillData.monthlyKwh || rawBillData.annualKwh || rawBillData.estimatedAnnualKwh
               || rawBillData.monthlyUsageHistory || rawBillData.utilityProvider
               || rawBillData.electricityRate) {
      // Flat format: bill_data contains raw OCR fields (from provision or legacy save).
      // Synthesize a BillAnalysis so BillTab can render without crashing.
      // Also triggered on utilityProvider/electricityRate alone so rate lookup works
      // even when kWh fields were not extracted.
      // Priority for monthly array: monthlyUsageHistory[] > monthlyKwh[] > fill from annual
      const rawHistory = rawBillData.monthlyUsageHistory;
      const rawMonthly = rawBillData.monthlyKwh;
      const monthlyKwhArray: number[] = Array.isArray(rawHistory) && (rawHistory as number[]).length >= 3
        ? (rawHistory as number[]).slice(0, 12)
        : Array.isArray(rawMonthly)
          ? (rawMonthly as number[])
          : (() => {
              const annKwh = ((rawBillData.annualKwh as number) || 0)
                || ((rawBillData.estimatedAnnualKwh as number) || 0)
                || (typeof rawBillData.monthlyKwh === 'number' ? (rawBillData.monthlyKwh as number) * 12 : 0);
              const avg = Math.round(annKwh / 12);
              return Array(12).fill(avg > 0 ? avg : 0);
            })();
      const annualKwh = ((rawBillData.annualKwh as number) || 0)
        || ((rawBillData.estimatedAnnualKwh as number) || 0)
        || monthlyKwhArray.reduce((a: number, b: number) => a + b, 0);
      const avgMonthlyKwh = Math.round(annualKwh / 12);
      // Rate: validate against utility DB to always get retail rate, not supply-only component
      const _utilityNameForRate = (rawBillData.utilityProvider as string) || (row.utility_name as string) || null;
      const _rawRate = ((rawBillData.electricityRate as number) > 0 ? (rawBillData.electricityRate as number) : null)
        ?? ((row.utility_rate_per_kwh as number) > 0 ? (row.utility_rate_per_kwh as number) : null);
      const _rateValidation = validateAndCorrectUtilityRate(_rawRate, _utilityNameForRate);
      const utilityRate = _rateValidation.rate;
      const avgMonthlyBill = ((rawBillData.estimatedMonthlyBill as number) || 0)
        || ((rawBillData.totalAmount as number) || 0)
        || Math.round(avgMonthlyKwh * utilityRate * 100) / 100;
      const monthlyKwhSafe = monthlyKwhArray.length > 0 ? monthlyKwhArray : [0];
      const peakKwh = Math.max(...monthlyKwhSafe);
      const peakMonth = monthlyKwhSafe.indexOf(peakKwh);
      // Also hydrate top-level utility fields from flat data
      utilityName = _utilityNameForRate || undefined;
      utilityRatePerKwh = utilityRate;
      stateCode = (rawBillData.stateCode as string) || (row.state_code as string) || undefined;
      city = (rawBillData.city as string) || (row.city as string) || undefined;
      billAnalysis = {
        monthlyKwh: monthlyKwhArray,
        annualKwh,
        averageMonthlyKwh: avgMonthlyKwh,
        averageMonthlyBill: avgMonthlyBill,
        annualBill: avgMonthlyBill * 12,
        utilityRate,
        peakMonthKwh: peakKwh,
        peakMonth: peakMonth >= 0 ? peakMonth : 0,
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
    name: row.name as string,
    status: (row.status as Project['status']) || 'lead',
    systemType: ((row.system_type as Project['systemType']) || 'roof') as Project['systemType'], // FIX v47.218: explicit fallback so updateProject merge never gets undefined
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
    // FIX v47.8: city hydrated from bill_data._city; also fall back to projects.city column
    city: city || (rawBillData?.city as string) || undefined,
    // FIX v47.394: county and zip come from bill_data JSONB (no dedicated DB columns).
    // Read both the _prefixed form (new format) and the flat form (legacy OCR).
    county: (rawBillData?._county as string)
      || (rawBillData?.county as string)
      || undefined,
    zip: (rawBillData?._zip as string)
      || (rawBillData?.zip as string)
      || undefined,
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

function rowToLayout(row: Record<string, unknown>): Layout {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    systemType: ((row.system_type as Layout['systemType']) || (() => { if (!row.system_type) console.warn('[rowToLayout] system_type missing from DB row — defaulting to roof. id:', row.id); return 'roof' as Layout['systemType']; })()) as Layout['systemType'],
    panels: (row.panels as Layout['panels']) || [],
    roofPlanes: row.roof_planes as Layout['roofPlanes'],
    groundTilt: row.ground_tilt as number | undefined,
    groundAzimuth: row.ground_azimuth as number | undefined,
    rowSpacing: row.row_spacing as number | undefined,
    groundHeight: row.ground_height as number | undefined,
    fenceAzimuth: row.fence_azimuth as number | undefined,
    fenceHeight: row.fence_height as number | undefined,
    fenceLine: row.fence_line as Layout['fenceLine'],
    bifacialOptimized: (row.bifacial_optimized as boolean) || false,
    totalPanels: (row.total_panels as number) || 0,
    systemSizeKw: (row.system_size_kw as number) || 0,
    mapCenter: (row.map_center as Layout['mapCenter']) || { lat: 0, lng: 0 },
    mapZoom: (row.map_zoom as number) || 18,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ============================================================
// CLIENTS
// ============================================================

export async function getClientsByUser(userId: string): Promise<Client[]> {
  assertUUID(userId, 'userId');
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM clients
    WHERE user_id = ${userId}
      AND deleted_at IS NULL
    ORDER BY created_at DESC
  `;
  return rows.map(rowToClient);
}

export async function getClientById(id: string, userId: string): Promise<Client | null> {
  if (!isValidUUID(id) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM clients
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows.length > 0 ? rowToClient(rows[0]) : null;
}

export async function createClient(data: {
  userId: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  utilityProvider?: string;
  monthlyKwh?: number[];
  annualKwh?: number;
  averageMonthlyKwh?: number;
  averageMonthlyBill?: number;
  annualBill?: number;
  utilityRate?: number;
}): Promise<Client> {
  assertUUID(data.userId, 'userId');
  const sql = await getDbReady();
  const monthlyKwhJson = JSON.stringify(data.monthlyKwh || []);
  const rows = await sql`
    INSERT INTO clients (
      user_id, name, email, phone, address, city, state, zip,
      lat, lng, utility_provider, monthly_kwh,
      annual_kwh, average_monthly_kwh, average_monthly_bill,
      annual_bill, utility_rate
    ) VALUES (
      ${data.userId},
      ${data.name},
      ${data.email},
      ${data.phone || ''},
      ${data.address || ''},
      ${data.city || ''},
      ${data.state || ''},
      ${data.zip || ''},
      ${data.lat ?? null},
      ${data.lng ?? null},
      ${data.utilityProvider || ''},
      ${monthlyKwhJson}::jsonb,
      ${data.annualKwh || 0},
      ${data.averageMonthlyKwh || 0},
      ${data.averageMonthlyBill || 0},
      ${data.annualBill || 0},
      ${data.utilityRate || 0.13}
    )
    RETURNING *
  `;
  return rowToClient(rows[0]);
}

export async function updateClient(
  id: string,
  userId: string,
  data: Partial<Omit<Client, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>
): Promise<Client | null> {
  if (!isValidUUID(id) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();
  const current = await getClientById(id, userId);
  if (!current) return null;

  const merged = { ...current, ...data };
  const monthlyKwhJson = JSON.stringify(merged.monthlyKwh || []);

  const rows = await sql`
    UPDATE clients SET
      name                = ${merged.name},
      email               = ${merged.email},
      phone               = ${merged.phone || ''},
      address             = ${merged.address || ''},
      city                = ${merged.city || ''},
      state               = ${merged.state || ''},
      zip                 = ${merged.zip || ''},
      lat                 = ${merged.lat ?? null},
      lng                 = ${merged.lng ?? null},
      utility_provider    = ${merged.utilityProvider || ''},
      monthly_kwh         = ${monthlyKwhJson}::jsonb,
      annual_kwh          = ${merged.annualKwh || 0},
      average_monthly_kwh = ${merged.averageMonthlyKwh || 0},
      average_monthly_bill= ${merged.averageMonthlyBill || 0},
      annual_bill         = ${merged.annualBill || 0},
      utility_rate        = ${merged.utilityRate || 0.13},
      updated_at          = NOW()
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    RETURNING *
  `;
  return rows.length > 0 ? rowToClient(rows[0]) : null;
}

export async function softDeleteClient(id: string, userId: string): Promise<boolean> {
  if (!isValidUUID(id) || !isValidUUID(userId)) return false;
  const sql = await getDbReady();
  const rows = await sql`
    UPDATE clients
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

// ============================================================
// PROJECTS
// ============================================================

// ── Enrichment helper: hydrate costEstimate + layout from JOINed rows ──────
// Priority chain for costEstimate:
//   1. productions.data_json.costEstimate  (design-time calculation)
//   2. proposals.data_json.project.costEstimate  (proposal snapshot)
// This ensures projects that skipped the production flow but have proposals
// still show real $ values on the dashboard.
function enrichProjectRow(row: Record<string, unknown>): Project {
  const base = rowToProject(row);

  // ─── Source 1: productions.data_json ─────────────────────────────────
  let prodDj = row._prod_data_json as Record<string, unknown> | null;
  if (typeof prodDj === 'string') {
    try { prodDj = JSON.parse(prodDj); } catch { prodDj = null; }
  }
  if (prodDj && typeof prodDj === 'object') {
    if (!base.costEstimate && prodDj.costEstimate) {
      base.costEstimate = prodDj.costEstimate as import('@/types').CostEstimate;
    }
    if (!base.production && prodDj.production) {
      base.production = prodDj.production as import('@/types').ProductionResult;
    }
    if (!base.selectedPanel && prodDj.selectedPanel) {
      base.selectedPanel = prodDj.selectedPanel as import('@/types').SolarPanel;
    }
    if (!base.selectedInverter && prodDj.selectedInverter) {
      base.selectedInverter = prodDj.selectedInverter as import('@/types').Inverter;
    }
  }

  // ─── Source 2: proposals.data_json.project (snapshot fallback) ───────
  // Only used when productions didn't provide costEstimate / production / layout
  let propDj = row._prop_data_json as Record<string, unknown> | null;
  if (typeof propDj === 'string') {
    try { propDj = JSON.parse(propDj); } catch { propDj = null; }
  }
  if (propDj && typeof propDj === 'object') {
    // The proposal snapshot stores the full project under propDj.project
    let snapshotProject = propDj.project as Record<string, unknown> | null;
    if (typeof snapshotProject === 'string') {
      try { snapshotProject = JSON.parse(snapshotProject); } catch { snapshotProject = null; }
    }
    if (snapshotProject && typeof snapshotProject === 'object') {
      if (!base.costEstimate && snapshotProject.costEstimate) {
        base.costEstimate = snapshotProject.costEstimate as import('@/types').CostEstimate;
      }
      if (!base.production && snapshotProject.production) {
        base.production = snapshotProject.production as import('@/types').ProductionResult;
      }
      if (!base.selectedPanel && snapshotProject.selectedPanel) {
        base.selectedPanel = snapshotProject.selectedPanel as import('@/types').SolarPanel;
      }
      if (!base.selectedInverter && snapshotProject.selectedInverter) {
        base.selectedInverter = snapshotProject.selectedInverter as import('@/types').Inverter;
      }
      // Also recover layout from snapshot if not already set and no layout from layouts table
      if (!base.layout && snapshotProject.layout) {
        base.layout = snapshotProject.layout as import('@/types').Layout;
      }
    }
  }

  // ─── Source 3: layouts table (direct JOIN) ───────────────────────────
  if (!base.layout && row._lo_id) {
    try {
      base.layout = rowToLayout({
        id: row._lo_id,
        project_id: row._lo_project_id,
        system_type: row._lo_system_type,
        panels: row._lo_panels,
        roof_planes: row._lo_roof_planes,
        ground_tilt: row._lo_ground_tilt,
        ground_azimuth: row._lo_ground_azimuth,
        row_spacing: row._lo_row_spacing,
        ground_height: row._lo_ground_height,
        fence_azimuth: row._lo_fence_azimuth,
        fence_height: row._lo_fence_height,
        fence_line: row._lo_fence_line,
        bifacial_optimized: row._lo_bifacial_optimized,
        total_panels: row._lo_total_panels,
        system_size_kw: row._lo_system_size_kw,
        map_center: row._lo_map_center,
        map_zoom: row._lo_map_zoom,
        created_at: row._lo_created_at,
        updated_at: row._lo_updated_at,
      });
    } catch {
      // Layout enrichment failed — non-fatal
    }
  }

  return base;
}

export async function getProjectsByUser(userId: string): Promise<Project[]> {
  assertUUID(userId, 'userId');
  const sql = await getDbReady();

  // FIX: LEFT JOIN productions + layouts + proposals so list API returns costEstimate + layout.
  // Without this, dashboard pipeline metrics are always $0 and system kW is always 0.
  // The proposals JOIN is critical: projects can reach proposal/approved status WITHOUT
  // going through the production calculation flow (via direct PATCH), so productions may
  // have NO rows — but the proposal snapshot always contains the full project with costEstimate.
  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
      SELECT p.*,
             prod.data_json AS _prod_data_json,
             prop.data_json AS _prop_data_json,
             lo.id AS _lo_id, lo.project_id AS _lo_project_id,
             lo.system_type AS _lo_system_type,
             NULL::jsonb AS _lo_panels, NULL::jsonb AS _lo_roof_planes,
             lo.ground_tilt AS _lo_ground_tilt, lo.ground_azimuth AS _lo_ground_azimuth,
             lo.row_spacing AS _lo_row_spacing, lo.ground_height AS _lo_ground_height,
             lo.fence_azimuth AS _lo_fence_azimuth, lo.fence_height AS _lo_fence_height,
             lo.fence_line AS _lo_fence_line, lo.bifacial_optimized AS _lo_bifacial_optimized,
             lo.total_panels AS _lo_total_panels, lo.system_size_kw AS _lo_system_size_kw,
             lo.map_center AS _lo_map_center, lo.map_zoom AS _lo_map_zoom,
             lo.created_at AS _lo_created_at, lo.updated_at AS _lo_updated_at
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT data_json FROM productions pr
        WHERE pr.project_id = p.id
        ORDER BY pr.calculated_at DESC LIMIT 1
      ) prod ON true
      LEFT JOIN LATERAL (
        SELECT * FROM proposals pr2
        WHERE pr2.project_id = p.id AND pr2.user_id = ${userId}
        ORDER BY pr2.created_at DESC LIMIT 1
      ) prop ON true
      LEFT JOIN LATERAL (
        SELECT * FROM layouts l2
        WHERE l2.project_id = p.id AND l2.user_id = ${userId}
        ORDER BY l2.updated_at DESC LIMIT 1
      ) lo ON true
      WHERE p.user_id = ${userId}
        AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC
    `;
  } catch (joinErr) {
    // Fallback: if JOIN fails (e.g. tables/columns missing), use simple query
    console.warn('[getProjectsByUser] Enriched query failed, falling back:', (joinErr as Error)?.message);
    rows = await sql`
      SELECT * FROM projects
      WHERE user_id = ${userId}
        AND deleted_at IS NULL
      ORDER BY updated_at DESC
    `;
    return rows.map(rowToProject);
  }

  return rows.map(enrichProjectRow);
}

export async function getProjectsByClient(clientId: string, userId: string): Promise<Project[]> {
  if (!isValidUUID(clientId) || !isValidUUID(userId)) return [];
  const sql = await getDbReady();

  // FIX: Same enrichment as getProjectsByUser (productions + proposals + layouts)
  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
      SELECT p.*,
             prod.data_json AS _prod_data_json,
             prop.data_json AS _prop_data_json,
             lo.id AS _lo_id, lo.project_id AS _lo_project_id,
             lo.system_type AS _lo_system_type,
             NULL::jsonb AS _lo_panels, NULL::jsonb AS _lo_roof_planes,
             lo.ground_tilt AS _lo_ground_tilt, lo.ground_azimuth AS _lo_ground_azimuth,
             lo.row_spacing AS _lo_row_spacing, lo.ground_height AS _lo_ground_height,
             lo.fence_azimuth AS _lo_fence_azimuth, lo.fence_height AS _lo_fence_height,
             lo.fence_line AS _lo_fence_line, lo.bifacial_optimized AS _lo_bifacial_optimized,
             lo.total_panels AS _lo_total_panels, lo.system_size_kw AS _lo_system_size_kw,
             lo.map_center AS _lo_map_center, lo.map_zoom AS _lo_map_zoom,
             lo.created_at AS _lo_created_at, lo.updated_at AS _lo_updated_at
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT data_json FROM productions pr
        WHERE pr.project_id = p.id
        ORDER BY pr.calculated_at DESC LIMIT 1
      ) prod ON true
      LEFT JOIN LATERAL (
        SELECT * FROM proposals pr2
        WHERE pr2.project_id = p.id AND pr2.user_id = ${userId}
        ORDER BY pr2.created_at DESC LIMIT 1
      ) prop ON true
      LEFT JOIN LATERAL (
        SELECT * FROM layouts l2
        WHERE l2.project_id = p.id AND l2.user_id = ${userId}
        ORDER BY l2.updated_at DESC LIMIT 1
      ) lo ON true
      WHERE p.client_id = ${clientId}
        AND p.user_id = ${userId}
        AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC
    `;
  } catch {
    rows = await sql`
      SELECT * FROM projects
      WHERE client_id = ${clientId}
        AND user_id = ${userId}
        AND deleted_at IS NULL
      ORDER BY updated_at DESC
    `;
    return rows.map(rowToProject);
  }

  return rows.map(enrichProjectRow);
}

export async function getProjectById(id: string, userId: string): Promise<Project | null> {
  if (!isValidUUID(id) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM projects
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows.length > 0 ? rowToProject(rows[0]) : null;
}

export async function createProject(data: {
  userId: string;
  clientId?: string;
  name: string;
  status?: Project['status'];
  systemType?: Project['systemType'];
  notes?: string;
  address?: string;
  lat?: number;
  lng?: number;
  stateCode?: string;
  city?: string;
  county?: string;
  zip?: string;
  utilityName?: string;
  utilityRatePerKwh?: number;
  systemSizeKw?: number;
  billData?: Record<string, unknown>;
}): Promise<Project> {
  assertUUID(data.userId, 'userId');
  // clientId must be a valid UUID or null — never pass a non-UUID string
  const clientId = isValidUUID(data.clientId) ? data.clientId : null;
  // Sanitize billData to remove null bytes / invalid Unicode that breaks PostgreSQL JSONB
  const sanitizeBillData = (obj: unknown): unknown => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return obj.replace(/\u0000/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeBillData);
    if (typeof obj === 'object') {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) r[k] = sanitizeBillData(v);
      return r;
    }
    return obj;
  };
  const billDataJson = data.billData ? JSON.stringify(sanitizeBillData(data.billData)) : null;
  const sql = await getDbReady();

  // Try INSERT with bill_data + system_size_kw columns first.
  // If those columns don't exist yet (migration not run on live DB), fall back to base INSERT.
  let rows: any[];
  try {
    rows = await sql`
      INSERT INTO projects (
        user_id, client_id, name, status, system_type, notes, address, lat, lng, system_size_kw, bill_data
      ) VALUES (
        ${data.userId},
        ${clientId},
        ${data.name},
        ${data.status || 'lead'},
        ${data.systemType || 'roof'},
        ${data.notes || ''},
        ${data.address || ''},
        ${data.lat ?? null},
        ${data.lng ?? null},
        ${data.systemSizeKw ?? null},
        ${billDataJson}::jsonb
      )
      RETURNING *
    `;
  } catch (insertErr: unknown) {
    // If the error is about missing columns, fall back to base INSERT without them
    const msg = ((insertErr as Error)?.message || '').toLowerCase();
    if (msg.includes('column') && (msg.includes('bill_data') || msg.includes('system_size_kw'))) {
      console.warn('[createProject] bill_data/system_size_kw columns missing — using base INSERT. Run /api/migrate to add them.');
      rows = await sql`
        INSERT INTO projects (
          user_id, client_id, name, status, system_type, notes, address, lat, lng
        ) VALUES (
          ${data.userId},
          ${clientId},
          ${data.name},
          ${data.status || 'lead'},
          ${data.systemType || 'roof'},
          ${data.notes || ''},
          ${data.address || ''},
          ${data.lat ?? null},
          ${data.lng ?? null}
        )
        RETURNING *
      `;
    } else {
      throw insertErr;
    }
  }

  const project = rowToProject(rows[0]);
  // Store extended location fields in notes metadata (JSON suffix) if DB columns not yet migrated
  // These are passed through to the returned project object for immediate use
  if (data.stateCode) (project as any).stateCode = data.stateCode;
  if (data.city) (project as any).city = data.city;
  if (data.county) (project as any).county = data.county;
  if (data.zip) (project as any).zip = data.zip;
  if (data.utilityName) (project as any).utilityName = data.utilityName;
  if (data.utilityRatePerKwh) (project as any).utilityRatePerKwh = data.utilityRatePerKwh;
  return project;
}

export async function updateProject(
  id: string,
  userId: string,
  data: Partial<Omit<Project, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>
): Promise<Project | null> {
  if (!isValidUUID(id) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();
  const current = await getProjectById(id, userId);
  if (!current) return null;

  const merged = { ...current, ...data };
  // clientId must be a valid UUID or null
  const clientId = isValidUUID(merged.clientId) ? merged.clientId : null;

  // Serialize bill_data JSONB — preserve existing if not provided in update
  const billDataJson: string | null = ('billData' in data && data.billData !== undefined)
    ? JSON.stringify(data.billData)
    : (current.billData ? JSON.stringify(current.billData) : null);

  // postgres.js does not support conditional fragment expressions inside a template literal.
  // Use two separate queries: one with bill_data update, one without.
  let rows: Record<string, unknown>[];
  if (billDataJson !== null) {
    rows = await sql`
      UPDATE projects SET
        name          = ${merged.name},
        client_id     = ${clientId},
        status        = ${merged.status || 'lead'},
        system_type   = ${merged.systemType || current.systemType || 'roof'},
        notes         = ${merged.notes || ''},
        address       = ${merged.address || ''},
        lat           = ${merged.lat ?? null},
        lng           = ${merged.lng ?? null},
        system_size_kw= ${merged.systemSizeKw ?? null},
        no_itc        = ${merged.noItc ?? false},
        control_mode  = ${(merged.controlMode ?? current.controlMode ?? 'guided')},
        system_config_locks = ${merged.systemConfigLocks ? JSON.stringify(merged.systemConfigLocks) : (current.systemConfigLocks ? JSON.stringify(current.systemConfigLocks) : null)}::jsonb,
        bill_data     = ${billDataJson}::jsonb,
        updated_at    = NOW()
      WHERE id = ${id}
        AND user_id = ${userId}
        AND deleted_at IS NULL
      RETURNING *
    `;
  } else {
    rows = await sql`
      UPDATE projects SET
        name          = ${merged.name},
        client_id     = ${clientId},
        status        = ${merged.status || 'lead'},
        system_type   = ${merged.systemType || current.systemType || 'roof'},
        notes         = ${merged.notes || ''},
        address       = ${merged.address || ''},
        lat           = ${merged.lat ?? null},
        lng           = ${merged.lng ?? null},
        system_size_kw= ${merged.systemSizeKw ?? null},
        no_itc        = ${merged.noItc ?? false},
        control_mode  = ${(merged.controlMode ?? current.controlMode ?? 'guided')},
        system_config_locks = ${merged.systemConfigLocks ? JSON.stringify(merged.systemConfigLocks) : (current.systemConfigLocks ? JSON.stringify(current.systemConfigLocks) : null)}::jsonb,
        updated_at    = NOW()
      WHERE id = ${id}
        AND user_id = ${userId}
        AND deleted_at IS NULL
      RETURNING *
    `;
  }
  return rows.length > 0 ? rowToProject(rows[0]) : null;
}

export async function softDeleteProject(id: string, userId: string): Promise<boolean> {
  if (!isValidUUID(id) || !isValidUUID(userId)) return false;
  const sql = await getDbReady();
  const rows = await sql`
    UPDATE projects
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export async function bulkSoftDeleteProjects(ids: string[], userId: string): Promise<string[]> {
  if (!isValidUUID(userId)) return [];
  const validIds = ids.filter(isValidUUID);
  if (validIds.length === 0) return [];
  const sql = await getDbReady();
  // Use ordinary function call syntax so we can pass the array param directly.
  // Neon serializes a JS string[] as a Postgres text array for ANY().
  const rows = await sql(
    `UPDATE projects
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1::uuid[])
       AND user_id = $2
       AND deleted_at IS NULL
     RETURNING id`,
    [validIds, userId]
  );
  return rows.map((r: Record<string, unknown>) => r.id as string);
}

// ============================================================
// LAYOUTS
// ============================================================

export async function getLayoutByProject(projectId: string, userId: string): Promise<Layout | null> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();
  // FIX v47.318: JOIN with projects to get authoritative system_type fallback.
  // If layouts.system_type is NULL, use projects.system_type so that
  // rowToLayout never incorrectly defaults to 'roof' for fence/ground projects.
  const rows = await sql`
    SELECT l.*,
           COALESCE(l.system_type, p.system_type) AS system_type
    FROM layouts l
    JOIN projects p ON p.id = l.project_id AND p.user_id = l.user_id
    WHERE l.project_id = ${projectId}
      AND l.user_id = ${userId}
    ORDER BY l.updated_at DESC
    LIMIT 1
  `;
  return rows.length > 0 ? rowToLayout(rows[0]) : null;
}

export interface UpsertLayoutData {
  projectId: string;
  userId: string;
  systemType?: Layout['systemType'];
  panels: Layout['panels'];
  roofPlanes?: Layout['roofPlanes'];
  groundTilt?: number;
  groundAzimuth?: number;
  rowSpacing?: number;
  groundHeight?: number;
  fenceAzimuth?: number;
  fenceHeight?: number;
  fenceLine?: Layout['fenceLine'];
  bifacialOptimized?: boolean;
  totalPanels?: number;
  systemSizeKw?: number;
  mapCenter?: Layout['mapCenter'];
  mapZoom?: number;
}

export async function upsertLayout(data: UpsertLayoutData): Promise<Layout> {
  assertUUID(data.projectId, 'projectId');
  assertUUID(data.userId, 'userId');
  const sql = await getDbReady();
  const panelsJson = JSON.stringify(data.panels || []);
  const roofPlanesJson = data.roofPlanes ? JSON.stringify(data.roofPlanes) : null;
  const fenceLineJson = data.fenceLine ? JSON.stringify(data.fenceLine) : null;
  const mapCenterJson = data.mapCenter ? JSON.stringify(data.mapCenter) : null;

  // Check if layout exists for this project
  const existing = await sql`
    SELECT id FROM layouts
    WHERE project_id = ${data.projectId}
      AND user_id = ${data.userId}
    LIMIT 1
  `;

  if (existing.length > 0) {
    // UPDATE existing layout
    const rows = await sql`
      UPDATE layouts SET
        system_type         = ${data.systemType || 'roof'},
        panels              = ${panelsJson}::jsonb,
        roof_planes         = ${roofPlanesJson}::jsonb,
        ground_tilt         = ${data.groundTilt ?? 20},
        ground_azimuth      = ${data.groundAzimuth ?? 180},
        row_spacing         = ${data.rowSpacing ?? 1.5},
        ground_height       = ${data.groundHeight ?? 0.6},
        fence_azimuth       = ${data.fenceAzimuth ?? null},
        fence_height        = ${data.fenceHeight ?? null},
        fence_line          = ${fenceLineJson}::jsonb,
        bifacial_optimized  = ${data.bifacialOptimized ?? false},
        total_panels        = ${data.totalPanels ?? 0},
        system_size_kw      = ${data.systemSizeKw ?? 0},
        map_center          = ${mapCenterJson}::jsonb,
        map_zoom            = ${data.mapZoom ?? null},
        updated_at          = NOW()
      WHERE project_id = ${data.projectId}
        AND user_id = ${data.userId}
      RETURNING *
    `;
    return rowToLayout(rows[0]);
  } else {
    // INSERT new layout
    const rows = await sql`
      INSERT INTO layouts (
        project_id, user_id, system_type, panels, roof_planes,
        ground_tilt, ground_azimuth, row_spacing, ground_height,
        fence_azimuth, fence_height, fence_line,
        bifacial_optimized, total_panels, system_size_kw,
        map_center, map_zoom
      ) VALUES (
        ${data.projectId},
        ${data.userId},
        ${data.systemType || 'roof'},
        ${panelsJson}::jsonb,
        ${roofPlanesJson}::jsonb,
        ${data.groundTilt ?? 20},
        ${data.groundAzimuth ?? 180},
        ${data.rowSpacing ?? 1.5},
        ${data.groundHeight ?? 0.6},
        ${data.fenceAzimuth ?? null},
        ${data.fenceHeight ?? null},
        ${fenceLineJson}::jsonb,
        ${data.bifacialOptimized ?? false},
        ${data.totalPanels ?? 0},
        ${data.systemSizeKw ?? 0},
        ${mapCenterJson}::jsonb,
        ${data.mapZoom ?? null}
      )
      RETURNING *
    `;
    return rowToLayout(rows[0]);
  }
}

// ============================================================
// PROJECT VERSIONS
// ============================================================

export interface ProjectVersion {
  id: string;
  projectId: string;
  userId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
  panelsCount: number;
  systemSizeKw: number;
  changeSummary: string;
  createdAt: string;
}

export async function saveProjectVersion(data: {
  projectId: string;
  userId: string;
  snapshot: Record<string, unknown>;
  panelsCount?: number;
  systemSizeKw?: number;
  changeSummary?: string;
}): Promise<ProjectVersion> {
  assertUUID(data.projectId, 'projectId');
  assertUUID(data.userId, 'userId');
  const sql = await getDbReady();

  // PERF FIX: Compute next version number atomically inside the INSERT using a subquery.
  // Eliminates the extra SELECT round-trip that previously doubled latency on every save.
  const snapshotJson = JSON.stringify(data.snapshot);
  const rows = await sql`
    INSERT INTO project_versions (
      project_id, user_id, version_number, snapshot,
      panels_count, system_size_kw, change_summary
    )
    SELECT
      ${data.projectId},
      ${data.userId},
      COALESCE((SELECT MAX(version_number) FROM project_versions WHERE project_id = ${data.projectId}), 0) + 1,
      ${snapshotJson}::jsonb,
      ${data.panelsCount ?? 0},
      ${data.systemSizeKw ?? 0},
      ${data.changeSummary || ''}
    RETURNING *
  `;

  const row = rows[0];
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    versionNumber: row.version_number as number,
    snapshot: row.snapshot as Record<string, unknown>,
    panelsCount: row.panels_count as number,
    systemSizeKw: row.system_size_kw as number,
    changeSummary: row.change_summary as string,
    createdAt: row.created_at as string,
  };
}

// PERF FIX: Returns version metadata only — no snapshot JSON blob.
// The version list panel only needs id/number/summary/counts to render the list.
// Snapshot is only fetched when user actually clicks "restore" (getProjectVersion).
export async function getProjectVersions(projectId: string, userId: string): Promise<ProjectVersion[]> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return [];
  const sql = await getDbReady();
  const rows = await sql`
    SELECT id, project_id, user_id, version_number,
           panels_count, system_size_kw, change_summary, created_at
    FROM project_versions
    WHERE project_id = ${projectId}
      AND user_id = ${userId}
    ORDER BY version_number DESC
    LIMIT 50
  `;
  return rows.map(row => ({
    id: row.id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    versionNumber: row.version_number as number,
    snapshot: {} as Record<string, unknown>,  // not loaded in list — fetch via getProjectVersion
    panelsCount: row.panels_count as number,
    systemSizeKw: row.system_size_kw as number,
    changeSummary: row.change_summary as string,
    createdAt: row.created_at as string,
  }));
}

export async function getProjectVersion(
  projectId: string,
  versionId: string,
  userId: string
): Promise<ProjectVersion | null> {
  if (!isValidUUID(projectId) || !isValidUUID(versionId) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM project_versions
    WHERE id = ${versionId}
      AND project_id = ${projectId}
      AND user_id = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    versionNumber: row.version_number as number,
    snapshot: row.snapshot as Record<string, unknown>,
    panelsCount: row.panels_count as number,
    systemSizeKw: row.system_size_kw as number,
    changeSummary: row.change_summary as string,
    createdAt: row.created_at as string,
  };
}

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
// BILLS — persistent bill storage per project
// ============================================================

export interface DbBill {
  id: string;
  projectId: string;
  userId: string;
  utilityName: string | null;
  monthlyKwh: number | null;
  annualKwh: number | null;
  electricRate: number | null;
  fileUrl: string | null;
  parsedJson: Record<string, unknown> | null;
  createdAt: string;
}

function rowToBill(row: Record<string, unknown>): DbBill {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    utilityName: (row.utility_name as string) || null,
    monthlyKwh: (row.monthly_kwh as number) || null,
    annualKwh: (row.annual_kwh as number) || null,
    electricRate: (row.electric_rate as number) || null,
    fileUrl: (row.file_url as string) || null,
    parsedJson: (row.parsed_json as Record<string, unknown>) || null,
    createdAt: row.created_at as string,
  };
}

export async function saveBill(data: {
  projectId: string;
  userId: string;
  utilityName?: string | null;
  monthlyKwh?: number | null;
  annualKwh?: number | null;
  electricRate?: number | null;
  fileUrl?: string | null;
  parsedJson?: Record<string, unknown> | null;
}): Promise<DbBill | null> {
  if (!isValidUUID(data.projectId) || !isValidUUID(data.userId)) return null;
  try {
    const sql = await getDbReady();
    const parsedJsonStr = data.parsedJson
      ? JSON.stringify(data.parsedJson).replace(/\u0000/g, '')
      : null;
    // Neon tagged template: pass JSON as a string, cast to JSONB in the static part
    const rows = parsedJsonStr
      ? await sql`
          INSERT INTO bills (
            project_id, user_id, utility_name,
            monthly_kwh, annual_kwh, electric_rate,
            file_url, parsed_json
          ) VALUES (
            ${data.projectId},
            ${data.userId},
            ${data.utilityName ?? null},
            ${data.monthlyKwh ?? null},
            ${data.annualKwh ?? null},
            ${data.electricRate ?? null},
            ${data.fileUrl ?? null},
            ${parsedJsonStr}::jsonb
          )
          RETURNING *
        `
      : await sql`
          INSERT INTO bills (
            project_id, user_id, utility_name,
            monthly_kwh, annual_kwh, electric_rate,
            file_url, parsed_json
          ) VALUES (
            ${data.projectId},
            ${data.userId},
            ${data.utilityName ?? null},
            ${data.monthlyKwh ?? null},
            ${data.annualKwh ?? null},
            ${data.electricRate ?? null},
            ${data.fileUrl ?? null},
            NULL
          )
          RETURNING *
        `;
    return rows.length > 0 ? rowToBill(rows[0]) : null;
  } catch (e) {
    console.warn('[saveBill] failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getBillsByProject(projectId: string, userId: string): Promise<DbBill[]> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return [];
  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT * FROM bills
      WHERE project_id = ${projectId}
        AND user_id = ${userId}
      ORDER BY created_at DESC
    `;
    return rows.map(r => rowToBill(r as Record<string, unknown>));
  } catch (e) {
    console.warn('[getBillsByProject] failed:', e instanceof Error ? e.message : e);
    return [];
  }
}

// ============================================================
// PRICING CONFIG — Single-row upsert pattern
// ============================================================

function rowToPricingConfig(row: Record<string, unknown>): DbPricingConfig {
  return {
    id:                   row.id as string,
    pricingMode:          (row.pricing_mode as PricingMode) || 'per_panel',
    // Per-watt
    pricePerWatt:         (row.price_per_watt as number) || 3.10,
    laborCostPerWatt:     (row.labor_cost_per_watt as number) || 0.75,
    equipmentCostPerWatt: (row.equipment_cost_per_watt as number) || 0.55,
    roofPricePerWatt:     (row.roof_price_per_watt as number | null) ?? null,
    groundPricePerWatt:   (row.ground_price_per_watt as number | null) ?? null,
    fencePricePerWatt:    (row.fence_price_per_watt as number | null) ?? null,
    carportPricePerWatt:  (row.carport_price_per_watt as number | null) ?? null,
    // Per-panel
    roofPricePerPanel:    (row.roof_price_per_panel as number | null) ?? null,
    groundPricePerPanel:  (row.ground_price_per_panel as number | null) ?? null,
    fencePricePerPanel:   (row.fence_price_per_panel as number | null) ?? null,
    defaultPanelWattage:  (row.default_panel_wattage as number) || 440,
    // Cost-plus
    materialCostPerPanel: (row.material_cost_per_panel as number) || 350,
    laborCostPerPanel:    (row.labor_cost_per_panel as number) || 200,
    overheadPercent:      (row.overhead_percent as number) || 15,
    marginPercent:        (row.margin_percent as number) || 25,
    // Shared
    fixedCost:            (row.fixed_cost as number) || 2000,
    profitMargin:         (row.profit_margin as number) || 40,
    utilityEscalation:    (row.utility_escalation as number) || 3,
    systemLife:           (row.system_life as number) || 25,
    // ITC
    isCommercial:         (row.is_commercial as boolean) || false,
    itcRateCommercial:    (row.itc_rate_commercial as number) ?? 30,
    itcRateResidential:   (row.itc_rate_residential as number) ?? 30,
    updatedAt:            row.updated_at as string,
  };
}

/**
 * Get the active pricing config row.
 * Returns null if the table doesn't exist yet (migration not run).
 */
export async function getPricingConfig(): Promise<DbPricingConfig | null> {
  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT * FROM pricing_config ORDER BY updated_at DESC LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rowToPricingConfig(rows[0] as Record<string, unknown>);
  } catch (err) {
    // Table may not exist yet — return null gracefully
    console.warn('[getPricingConfig] pricing_config table not ready:', err);
    return null;
  }
}

/**
 * Upsert pricing config — always keeps exactly one row.
 * If a row exists, updates it. If not, inserts one.
 */
export async function upsertPricingConfig(data: Partial<Omit<DbPricingConfig, 'id' | 'updatedAt'>>): Promise<DbPricingConfig> {
  const sql = await getDbReady();

  // Check if a row exists
  const existing = await sql`SELECT id FROM pricing_config LIMIT 1`;

  if (existing.length > 0) {
    const id = existing[0].id as string;
    const rows = await sql`
      UPDATE pricing_config SET
        pricing_mode             = COALESCE(${data.pricingMode ?? null}, pricing_mode),
        price_per_watt           = COALESCE(${data.pricePerWatt ?? null}, price_per_watt),
        labor_cost_per_watt      = COALESCE(${data.laborCostPerWatt ?? null}, labor_cost_per_watt),
        equipment_cost_per_watt  = COALESCE(${data.equipmentCostPerWatt ?? null}, equipment_cost_per_watt),
        fixed_cost               = COALESCE(${data.fixedCost ?? null}, fixed_cost),
        profit_margin            = COALESCE(${data.profitMargin ?? null}, profit_margin),
        utility_escalation       = COALESCE(${data.utilityEscalation ?? null}, utility_escalation),
        system_life              = COALESCE(${data.systemLife ?? null}, system_life),
        roof_price_per_watt      = COALESCE(${data.roofPricePerWatt ?? null}, roof_price_per_watt),
        ground_price_per_watt    = COALESCE(${data.groundPricePerWatt ?? null}, ground_price_per_watt),
        fence_price_per_watt     = COALESCE(${data.fencePricePerWatt ?? null}, fence_price_per_watt),
        carport_price_per_watt   = COALESCE(${data.carportPricePerWatt ?? null}, carport_price_per_watt),
        roof_price_per_panel     = COALESCE(${data.roofPricePerPanel ?? null}, roof_price_per_panel),
        ground_price_per_panel   = COALESCE(${data.groundPricePerPanel ?? null}, ground_price_per_panel),
        fence_price_per_panel    = COALESCE(${data.fencePricePerPanel ?? null}, fence_price_per_panel),
        default_panel_wattage    = COALESCE(${data.defaultPanelWattage ?? null}, default_panel_wattage),
        material_cost_per_panel  = COALESCE(${data.materialCostPerPanel ?? null}, material_cost_per_panel),
        labor_cost_per_panel     = COALESCE(${data.laborCostPerPanel ?? null}, labor_cost_per_panel),
        overhead_percent         = COALESCE(${data.overheadPercent ?? null}, overhead_percent),
        margin_percent           = COALESCE(${data.marginPercent ?? null}, margin_percent),
        is_commercial            = COALESCE(${data.isCommercial ?? null}, is_commercial),
        itc_rate_commercial      = COALESCE(${data.itcRateCommercial ?? null}, itc_rate_commercial),
        itc_rate_residential     = COALESCE(${data.itcRateResidential ?? null}, itc_rate_residential),
        updated_at               = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    return rowToPricingConfig(rows[0] as Record<string, unknown>);
  } else {
    // Insert default row with provided values
    const rows = await sql`
      INSERT INTO pricing_config (
        pricing_mode,
        price_per_watt, labor_cost_per_watt, equipment_cost_per_watt,
        fixed_cost, profit_margin, utility_escalation, system_life,
        roof_price_per_watt, ground_price_per_watt, fence_price_per_watt, carport_price_per_watt,
        roof_price_per_panel, ground_price_per_panel, fence_price_per_panel, default_panel_wattage,
        material_cost_per_panel, labor_cost_per_panel, overhead_percent, margin_percent,
        is_commercial, itc_rate_commercial, itc_rate_residential
      ) VALUES (
        ${data.pricingMode ?? 'per_panel'},
        ${data.pricePerWatt ?? 3.10},
        ${data.laborCostPerWatt ?? 0.75},
        ${data.equipmentCostPerWatt ?? 0.55},
        ${data.fixedCost ?? 2000},
        ${data.profitMargin ?? 40},
        ${data.utilityEscalation ?? 3},
        ${data.systemLife ?? 25},
        ${data.roofPricePerWatt ?? 3.10},
        ${data.groundPricePerWatt ?? 2.35},
        ${data.fencePricePerWatt ?? 4.25},
        ${data.carportPricePerWatt ?? 3.75},
        ${data.roofPricePerPanel ?? 1364},
        ${data.groundPricePerPanel ?? 1034},
        ${data.fencePricePerPanel ?? 1870},
        ${data.defaultPanelWattage ?? 440},
        ${data.materialCostPerPanel ?? 350},
        ${data.laborCostPerPanel ?? 200},
        ${data.overheadPercent ?? 15},
        ${data.marginPercent ?? 25},
        ${data.isCommercial ?? false},
        ${data.itcRateCommercial ?? 30},
        ${data.itcRateResidential ?? 30}
      )
      RETURNING *
    `;
    return rowToPricingConfig(rows[0] as Record<string, unknown>);
  }
}
// ============================================================================
// project_physical_data — engineering read helper
//
// Called by all engineering report generators before falling back to
// hardcoded defaults. Returns null if the project has no physical data
// record yet (pre-survey or manual-entry-only project).
// ============================================================================

import type { ProjectPhysicalData } from '@/lib/engineering/types';

export async function getProjectPhysicalData(
  projectId: string,
): Promise<ProjectPhysicalData | null> {
  const sql = await getDbReady();

  const rows = await sql`
    SELECT
      roof_material,
      roof_pitch,
      rafter_spacing_in,
      roof_condition,
      roof_age_years,
      attic_access,
      panel_brand,
      panel_rating_amps,
      available_breaker_slots,
      meter_socket_type,
      interconnection_point,
      service_entrance_type,
      has_sub_panel,
      sub_panel_rating_amps,
      obstructions,
      usable_roof_pct,
      inspector_name,
      surveyed_at,
      structure_type,
      stories
    FROM project_physical_data
    WHERE project_id = ${projectId}
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const r = rows[0] as Record<string, unknown>;

  return {
    roof_material:           (r.roof_material           as string  | null) ?? null,
    roof_pitch:              (r.roof_pitch               as string  | null) ?? null,
    rafter_spacing_in:       (r.rafter_spacing_in        as number  | null) ?? null,
    roof_condition:          (r.roof_condition           as string  | null) ?? null,
    roof_age_years:          (r.roof_age_years           as number  | null) ?? null,
    attic_access:            (r.attic_access             as boolean | null) ?? null,
    panel_brand:             (r.panel_brand              as string  | null) ?? null,
    panel_rating_amps:       (r.panel_rating_amps        as number  | null) ?? null,
    available_breaker_slots: (r.available_breaker_slots  as string  | null) ?? null,
    meter_socket_type:       (r.meter_socket_type        as string  | null) ?? null,
    interconnection_point:   (r.interconnection_point    as string  | null) ?? null,
    service_entrance_type:   (r.service_entrance_type    as string  | null) ?? null,
    has_sub_panel:           (r.has_sub_panel            as boolean | null) ?? null,
    sub_panel_rating_amps:   (r.sub_panel_rating_amps    as number  | null) ?? null,
    obstructions:            Array.isArray(r.obstructions) ? r.obstructions : [],
    usable_roof_pct:         (r.usable_roof_pct          as number  | null) ?? null,
    inspector_name:          (r.inspector_name           as string  | null) ?? null,
    surveyed_at:             r.surveyed_at ? String(r.surveyed_at) : null,
    structure_type:          (r.structure_type           as string  | null) ?? null,
    stories:                 (r.stories                  as string  | null) ?? null,
  };
}

// ─── SolarDog conversation memory ─────────────────────────────────────────────

export interface SolardogMessage {
  id:        string;
  userId:    string;
  projectId: string | null;
  page:      string;
  role:      'user' | 'assistant';
  content:   string;
  severity:  string | null;
  highlight: string | null;
  action:    string | null;
  createdAt: string;
}

/**
 * Save a single message turn to solardog_conversations.
 * Silently ignores errors so a DB hiccup never breaks the chat UI.
 */
export async function solardogSaveMessage(msg: {
  userId:    string;
  projectId: string | null;
  page:      string;
  role:      'user' | 'assistant';
  content:   string;
  severity?: string | null;
  highlight?: string | null;
  action?:   string | null;
}): Promise<void> {
  try {
    if (!isValidUUID(msg.userId)) return;
    const sql = await getDbReady();
    await sql`
      INSERT INTO solardog_conversations
        (user_id, project_id, page, role, content, severity, highlight, action)
      VALUES (
        ${msg.userId},
        ${msg.projectId && isValidUUID(msg.projectId) ? msg.projectId : null},
        ${msg.page || 'general'},
        ${msg.role},
        ${msg.content.substring(0, 4000)},
        ${msg.severity ?? null},
        ${msg.highlight ?? null},
        ${msg.action ?? null}
      )
    `;
  } catch (err) {
    // Non-fatal — table may not exist yet (pre-migration), just skip
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[SolarDog] solardogSaveMessage error:', err);
    } else {
      console.error('[SolarDog] solardogSaveMessage error:', (err as Error)?.message);
    }
  }
}

/**
 * Load the last N conversation turns for a user (optionally filtered by project).
 * Returns [] on any error so the assistant always has a fallback.
 */
export async function solardogGetHistory(
  userId:    string,
  limit:     number = 20,
  projectId: string | null = null,
): Promise<SolardogMessage[]> {
  try {
    if (!isValidUUID(userId)) return [];
    const sql = await getDbReady();
    let rows: Record<string, unknown>[];
    if (projectId && isValidUUID(projectId)) {
      rows = await sql`
        SELECT * FROM solardog_conversations
        WHERE user_id = ${userId}
          AND project_id = ${projectId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT * FROM solardog_conversations
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }
    return rows.reverse().map(r => ({
      id:        String(r.id),
      userId:    String(r.user_id),
      projectId: r.project_id ? String(r.project_id) : null,
      page:      String(r.page ?? 'general'),
      role:      (r.role as 'user' | 'assistant'),
      content:   String(r.content),
      severity:  r.severity ? String(r.severity) : null,
      highlight: r.highlight ? String(r.highlight) : null,
      action:    r.action ? String(r.action) : null,
      createdAt: String(r.created_at),
    }));
  } catch (err) {
    console.error('[SolarDog] solardogGetHistory error:', (err as Error)?.message ?? err);
    return [];
  }
}

// ============================================================
// SOLARDOG SITE ALIASES — learned navigation mappings
// ============================================================

export interface SiteAlias {
  id:        string;
  userId:    string;
  phrase:    string;
  route:     string;
  label:     string;
  createdAt: string;
}

/**
 * Save a learned alias.
 * Creates the site_aliases table if it doesn't exist (auto-migration).
 * Upserts on (user_id, phrase) — same phrase from same user updates the route.
 */
export async function solardogSaveAlias(
  userId: string,
  phrase: string,
  route:  string,
  label:  string,
): Promise<void> {
  try {
    if (!isValidUUID(userId)) return;
    const sql = await getDbReady();

    // NOTE: site_aliases table is created by migration 018_site_aliases.sql
    // The previous runtime CREATE TABLE IF NOT EXISTS has been moved to the migration.
    await sql`
      INSERT INTO site_aliases (user_id, phrase, route, label)
      VALUES (${userId}, ${phrase.toLowerCase().trim().substring(0, 200)}, ${route.substring(0, 500)}, ${label.substring(0, 200)})
      ON CONFLICT (user_id, phrase)
      DO UPDATE SET route = EXCLUDED.route, label = EXCLUDED.label, created_at = NOW()
    `;
  } catch (err) {
    console.error('[SolarDog] solardogSaveAlias error:', (err as Error)?.message ?? err);
  }
}

/**
 * Load all learned aliases for a user.
 * Returns [] on any error — never breaks the assistant.
 */
export async function solardogGetAliases(userId: string): Promise<SiteAlias[]> {
  try {
    if (!isValidUUID(userId)) return [];
    const sql = await getDbReady();
    const rows = await sql`
      SELECT id, user_id, phrase, route, label, created_at
      FROM site_aliases
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 200
    ` as Record<string, unknown>[];
    return rows.map(r => ({
      id:        String(r.id),
      userId:    String(r.user_id),
      phrase:    String(r.phrase),
      route:     String(r.route),
      label:     String(r.label ?? ''),
      createdAt: String(r.created_at),
    }));
  } catch (err) {
    // Table may not exist yet — silent fail
    const msg = (err as Error)?.message ?? '';
    if (!msg.includes('does not exist')) {
      console.error('[SolarDog] solardogGetAliases error:', msg);
    }
    return [];
  }
}

/**
 * Delete a specific learned alias for a user.
 */
export async function solardogDeleteAlias(userId: string, phrase: string): Promise<void> {
  try {
    if (!isValidUUID(userId)) return;
    const sql = await getDbReady();
    await sql`
      DELETE FROM site_aliases
      WHERE user_id = ${userId} AND phrase = ${phrase.toLowerCase().trim()}
    `;
  } catch (err) {
    console.error('[SolarDog] solardogDeleteAlias error:', (err as Error)?.message ?? err);
  }
}

// ─── SolarPro Knowledge Base ─────────────────────────────────────────────────

export interface KnowledgeItem {
  id?:             string;
  userId?:         string | null;
  /** v11: added 'equipment' as a first-class type */
  type:            'page' | 'button' | 'workflow' | 'equipment' | 'equipment_brand' | 'feature' | 'route' | 'warning' | 'action' | 'preference';
  key:             string;
  label:           string;
  description:     string;
  route?:          string | null;
  aliases:         string[];
  /** v11: ordered steps for workflow items */
  steps:           string[];
  relatedActions:  string[];
  metadata:        Record<string, unknown>;
  isGlobal:        boolean;
  createdAt?:      string;
  updatedAt?:      string;
}

/**
 * Upsert a knowledge item (insert or update on type+key conflict).
 * Pass userId=null for global items (shared across all users).
 */
export async function solardogKnowledgeUpsert(
  userId:  string | null,
  item:    Omit<KnowledgeItem, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<void> {
  try {
    if (userId && !isValidUUID(userId)) return;
    const sql = await getDbReady();
    // Normalize type: 'equipment' is stored as 'equipment_brand' in DB (CHECK constraint compat)
    // steps[] are stored in metadata.steps since the DB column doesn't exist yet pre-025
    const dbType = (item.type === 'equipment' ? 'equipment_brand' : item.type) as string;
    const meta = { ...item.metadata, steps: item.steps ?? [], itemType: item.type };
    await sql`
      INSERT INTO solarpro_knowledge_items
        (user_id, type, key, label, description, route, aliases, related_actions, metadata, is_global)
      VALUES (
        ${userId ?? null},
        ${dbType},
        ${item.key.toLowerCase().trim()},
        ${item.label},
        ${item.description},
        ${item.route ?? null},
        ${item.aliases as string[]},
        ${item.relatedActions as string[]},
        ${JSON.stringify(meta)},
        ${item.isGlobal ?? false}
      )
      ON CONFLICT (user_id, type, key) DO UPDATE SET
        label           = EXCLUDED.label,
        description     = EXCLUDED.description,
        route           = EXCLUDED.route,
        aliases         = EXCLUDED.aliases,
        related_actions = EXCLUDED.related_actions,
        metadata        = EXCLUDED.metadata,
        is_global       = EXCLUDED.is_global,
        updated_at      = NOW()
    `;
  } catch (err) {
    console.error('[SolarDog] solardogKnowledgeUpsert error:', (err as Error)?.message ?? err);
  }
}

/** Map a raw DB row to a KnowledgeItem, extracting steps from metadata */
function mapKnowledgeRow(r: Record<string, unknown>): KnowledgeItem {
  const meta = (r.metadata as Record<string, unknown>) ?? {};
  const steps = Array.isArray(meta.steps) ? (meta.steps as string[]) : [];
  // Restore 'equipment' type from metadata.itemType if stored as equipment_brand
  const rawType = r.type as string;
  const itemType = (meta.itemType as string | undefined) ?? rawType;
  const type = (['page','button','workflow','equipment','equipment_brand','feature','route','warning','action','preference'].includes(itemType)
    ? itemType
    : rawType) as KnowledgeItem['type'];
  return {
    id:             r.id as string,
    userId:         r.user_id as string | null,
    type,
    key:            r.key as string,
    label:          r.label as string,
    description:    r.description as string,
    route:          r.route as string | null,
    aliases:        (r.aliases as string[]) ?? [],
    steps,
    relatedActions: (r.related_actions as string[]) ?? [],
    metadata:       meta,
    isGlobal:       r.is_global as boolean,
    createdAt:      r.created_at as string,
    updatedAt:      r.updated_at as string,
  };
}

/**
 * Get all knowledge items visible to a user (their own + global items).
 */
export async function solardogKnowledgeGet(
  userId: string,
  type?:  KnowledgeItem['type'],
): Promise<KnowledgeItem[]> {
  try {
    if (!isValidUUID(userId)) return [];
    const sql = await getDbReady();
    const rows = type
      ? await sql`
          SELECT * FROM solarpro_knowledge_items
          WHERE (user_id = ${userId} OR is_global = TRUE)
            AND type = ${type}
          ORDER BY label ASC
        `
      : await sql`
          SELECT * FROM solarpro_knowledge_items
          WHERE (user_id = ${userId} OR is_global = TRUE)
          ORDER BY type ASC, label ASC
        `;
    return rows.map(r => mapKnowledgeRow(r));
  } catch (err) {
    console.error('[SolarDog] solardogKnowledgeGet error:', (err as Error)?.message ?? err);
    return [];
  }
}

/**
 * Full-text search across knowledge items (label, description, aliases, key, steps).
 * Returns up to `limit` items sorted by relevance (label match first).
 */
export async function solardogKnowledgeSearch(
  userId: string,
  query:  string,
  limit = 10,
): Promise<KnowledgeItem[]> {
  try {
    if (!isValidUUID(userId)) return [];
    const sql = await getDbReady();
    const q = `%${query.toLowerCase().trim()}%`;
    const rows = await sql`
      SELECT * FROM solarpro_knowledge_items
      WHERE (user_id = ${userId} OR is_global = TRUE)
        AND (
          LOWER(label)       LIKE ${q} OR
          LOWER(description) LIKE ${q} OR
          LOWER(key)         LIKE ${q} OR
          EXISTS (
            SELECT 1 FROM unnest(aliases) AS a
            WHERE LOWER(a) LIKE ${q}
          )
        )
      ORDER BY
        CASE WHEN LOWER(label) LIKE ${q} THEN 0 ELSE 1 END,
        label ASC
      LIMIT ${limit}
    `;
    return rows.map(r => mapKnowledgeRow(r));
  } catch (err) {
    console.error('[SolarDog] solardogKnowledgeSearch error:', (err as Error)?.message ?? err);
    return [];
  }
}

/**
 * Delete a specific knowledge item by type+key for a user.
 */
export async function solardogKnowledgeDelete(
  userId: string,
  type:   KnowledgeItem['type'],
  key:    string,
): Promise<void> {
  try {
    if (!isValidUUID(userId)) return;
    const sql = await getDbReady();
    await sql`
      DELETE FROM solarpro_knowledge_items
      WHERE user_id = ${userId}
        AND type    = ${type}
        AND key     = ${key.toLowerCase().trim()}
    `;
  } catch (err) {
    console.error('[SolarDog] solardogKnowledgeDelete error:', (err as Error)?.message ?? err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// v11: SolarPro Platform Knowledge Seed
// Seeds global knowledge items (pages, buttons, workflows, equipment) once.
// All items are is_global=TRUE and user_id=NULL so every user sees them.
// Idempotent: uses ON CONFLICT DO UPDATE so safe to re-run.
// ─────────────────────────────────────────────────────────────────────────────

// Seed data and SeedKnowledgeItem type — imported from pure data module
export type { SeedKnowledgeItem } from './solardog/knowledgeSeed';
import { SOLARPRO_KNOWLEDGE_SEED } from './solardog/knowledgeSeed';
export { SOLARPRO_KNOWLEDGE_SEED };

/**
 * Check if global knowledge base has already been seeded.
 * Returns true if at least one global item exists.
 */
export async function solardogKnowledgeSeeded(): Promise<boolean> {
  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT 1 FROM solarpro_knowledge_items
      WHERE is_global = TRUE
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Seed the global SolarPro knowledge base.
 * Idempotent — uses ON CONFLICT DO UPDATE so safe to call multiple times.
 * Seeds all items as global (user_id = NULL, is_global = TRUE).
 */
export async function solardogSeedKnowledge(): Promise<{ seeded: number; errors: string[] }> {
  const errors: string[] = [];
  let seeded = 0;
  for (const item of SOLARPRO_KNOWLEDGE_SEED) {
    try {
      await solardogKnowledgeUpsert(null, { ...item, isGlobal: true });
      seeded++;
    } catch (e) {
      errors.push(`${item.key}: ${(e as Error).message}`);
    }
  }
  return { seeded, errors };
}

// ============================================================================
// SITE SURVEYS — Field Data Layer
// ============================================================================

export interface SiteSurvey {
  id: string;
  clientId: string;
  projectId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'completed' | 'reviewed';
  source: 'project_handoff' | 'standalone';
  addressSnapshot: string | null;
  surveyData: Record<string, unknown> | null;
  inspectorName: string | null;
  notes: string | null;
  externalSurveyId: string | null;
  deliveryId: string | null;
  // joined fields (optional, populated by detail queries)
  clientName?: string;
  projectName?: string;
  fileCount?: number;
}

export interface SiteSurveyFile {
  id: string;
  surveyId: string;
  fileUrl: string;
  fileType: 'photo' | 'document';
  label: string | null;
  filename: string | null;
  mimeType: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------
function rowToSiteSurvey(row: Record<string, unknown>): SiteSurvey {
  return {
    id:               row.id as string,
    clientId:         row.client_id as string,
    projectId:        (row.project_id as string | null) ?? null,
    createdBy:        row.created_by as string,
    createdAt:        row.created_at as string,
    updatedAt:        row.updated_at as string,
    status:           row.status as SiteSurvey['status'],
    source:           row.source as SiteSurvey['source'],
    addressSnapshot:  (row.address_snapshot as string | null) ?? null,
    surveyData:       (row.survey_data as Record<string, unknown> | null) ?? null,
    inspectorName:    (row.inspector_name as string | null) ?? null,
    notes:            (row.notes as string | null) ?? null,
    externalSurveyId: (row.external_survey_id as string | null) ?? null,
    deliveryId:       (row.delivery_id as string | null) ?? null,
    clientName:       (row.client_name as string | undefined) ?? undefined,
    projectName:      (row.project_name as string | undefined) ?? undefined,
    fileCount:        row.file_count !== undefined ? Number(row.file_count) : undefined,
  };
}

function rowToSiteSurveyFile(row: Record<string, unknown>): SiteSurveyFile {
  return {
    id:        row.id as string,
    surveyId:  row.survey_id as string,
    fileUrl:   row.file_url as string,
    fileType:  row.file_type as SiteSurveyFile['fileType'],
    label:     (row.label as string | null) ?? null,
    filename:  (row.filename as string | null) ?? null,
    mimeType:  (row.mime_type as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// getSiteSurveysByProject
// ---------------------------------------------------------------------------
export async function getSiteSurveysByProject(
  projectId: string,
  userId: string,
): Promise<SiteSurvey[]> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT
      ss.*,
      c.name  AS client_name,
      COUNT(ssf.id)::int AS file_count
    FROM site_surveys ss
    JOIN clients c ON c.id = ss.client_id AND c.user_id = ${userId}
    LEFT JOIN site_survey_files ssf ON ssf.survey_id = ss.id
    WHERE ss.project_id = ${projectId}
    GROUP BY ss.id, c.name
    ORDER BY ss.created_at DESC
  `;
  return (rows as Record<string, unknown>[]).map(rowToSiteSurvey);
}

// ---------------------------------------------------------------------------
// getSiteSurveysByClient
// ---------------------------------------------------------------------------
export async function getSiteSurveysByClient(
  clientId: string,
  userId: string,
): Promise<SiteSurvey[]> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT
      ss.*,
      c.name  AS client_name,
      p.name  AS project_name,
      COUNT(ssf.id)::int AS file_count
    FROM site_surveys ss
    JOIN clients c ON c.id = ss.client_id AND c.user_id = ${userId} AND c.id = ${clientId}
    LEFT JOIN projects p ON p.id = ss.project_id
    LEFT JOIN site_survey_files ssf ON ssf.survey_id = ss.id
    GROUP BY ss.id, c.name, p.name
    ORDER BY ss.created_at DESC
  `;
  return (rows as Record<string, unknown>[]).map(rowToSiteSurvey);
}

// ---------------------------------------------------------------------------
// getSiteSurveyById
// ---------------------------------------------------------------------------
export async function getSiteSurveyById(
  surveyId: string,
  userId: string,
): Promise<SiteSurvey | null> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT
      ss.*,
      c.name AS client_name,
      p.name AS project_name,
      COUNT(ssf.id)::int AS file_count
    FROM site_surveys ss
    JOIN clients c ON c.id = ss.client_id AND c.user_id = ${userId}
    LEFT JOIN projects p ON p.id = ss.project_id
    LEFT JOIN site_survey_files ssf ON ssf.survey_id = ss.id
    WHERE ss.id = ${surveyId}
    GROUP BY ss.id, c.name, p.name
    LIMIT 1
  `;
  if (!rows.length) return null;
  return rowToSiteSurvey(rows[0] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// createSiteSurvey
// ---------------------------------------------------------------------------
export async function createSiteSurvey(data: {
  clientId: string;
  projectId?: string | null;
  createdBy: string;
  status?: SiteSurvey['status'];
  source: SiteSurvey['source'];
  addressSnapshot?: string | null;
  surveyData?: Record<string, unknown> | null;
  inspectorName?: string | null;
  notes?: string | null;
  externalSurveyId?: string | null;
  deliveryId?: string | null;
}): Promise<SiteSurvey> {
  const sql = await getDbReady();
  const rows = await sql`
    INSERT INTO site_surveys (
      client_id, project_id, created_by,
      status, source,
      address_snapshot, survey_data,
      inspector_name, notes,
      external_survey_id, delivery_id
    ) VALUES (
      ${data.clientId},
      ${data.projectId ?? null},
      ${data.createdBy},
      ${data.status ?? 'completed'},
      ${data.source},
      ${data.addressSnapshot ?? null},
      ${data.surveyData ? JSON.stringify(data.surveyData) : null},
      ${data.inspectorName ?? null},
      ${data.notes ?? null},
      ${data.externalSurveyId ?? null},
      ${data.deliveryId ?? null}
    )
    ON CONFLICT DO NOTHING
    RETURNING *
  `;
  if (!rows.length) {
    // Row already exists (rare race) — fetch it
    const existing = await sql`
      SELECT * FROM site_surveys
      WHERE external_survey_id = ${data.externalSurveyId ?? ''}
      LIMIT 1
    `;
    return rowToSiteSurvey(existing[0] as Record<string, unknown>);
  }
  return rowToSiteSurvey(rows[0] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// updateSiteSurvey
// ---------------------------------------------------------------------------
export async function updateSiteSurvey(
  surveyId: string,
  userId: string,
  updates: Partial<Pick<SiteSurvey,
    'projectId' | 'status' | 'addressSnapshot' | 'surveyData' | 'notes' | 'inspectorName'
  >>,
): Promise<SiteSurvey | null> {
  const sql = await getDbReady();
  // Security: verify ownership via client join
  const rows = await sql`
    UPDATE site_surveys ss
    SET
      project_id       = COALESCE(${updates.projectId ?? null}, ss.project_id),
      status           = COALESCE(${updates.status ?? null}::site_survey_status, ss.status),
      address_snapshot = COALESCE(${updates.addressSnapshot ?? null}, ss.address_snapshot),
      survey_data      = COALESCE(${updates.surveyData ? JSON.stringify(updates.surveyData) : null}::jsonb, ss.survey_data),
      notes            = COALESCE(${updates.notes ?? null}, ss.notes),
      inspector_name   = COALESCE(${updates.inspectorName ?? null}, ss.inspector_name),
      updated_at       = NOW()
    FROM clients c
    WHERE ss.id = ${surveyId}
      AND ss.client_id = c.id
      AND c.user_id = ${userId}
    RETURNING ss.*
  `;
  if (!rows.length) return null;
  return rowToSiteSurvey(rows[0] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// getSiteSurveyFiles
// ---------------------------------------------------------------------------
export async function getSiteSurveyFiles(surveyId: string): Promise<SiteSurveyFile[]> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM site_survey_files
    WHERE survey_id = ${surveyId}
    ORDER BY label NULLS LAST, created_at ASC
  `;
  return (rows as Record<string, unknown>[]).map(rowToSiteSurveyFile);
}

// ---------------------------------------------------------------------------
// addSiteSurveyFile
// ---------------------------------------------------------------------------
export async function addSiteSurveyFile(data: {
  surveyId: string;
  fileUrl: string;
  fileType?: SiteSurveyFile['fileType'];
  label?: string | null;
  filename?: string | null;
  mimeType?: string | null;
}): Promise<SiteSurveyFile> {
  const sql = await getDbReady();
  const rows = await sql`
    INSERT INTO site_survey_files (
      survey_id, file_url, file_type, label, filename, mime_type
    ) VALUES (
      ${data.surveyId},
      ${data.fileUrl},
      ${data.fileType ?? 'photo'},
      ${data.label ?? null},
      ${data.filename ?? null},
      ${data.mimeType ?? null}
    )
    RETURNING *
  `;
  return rowToSiteSurveyFile(rows[0] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// bulkAddSiteSurveyFiles — for ingest pipeline (batch insert)
// ---------------------------------------------------------------------------
export async function bulkAddSiteSurveyFiles(
  files: Array<{
    surveyId: string;
    fileUrl: string;
    fileType?: SiteSurveyFile['fileType'];
    label?: string | null;
    filename?: string | null;
    mimeType?: string | null;
  }>,
): Promise<number> {
  if (!files.length) return 0;
  const sql = await getDbReady();
  let inserted = 0;
  for (const f of files) {
    await sql`
      INSERT INTO site_survey_files (survey_id, file_url, file_type, label, filename, mime_type)
      VALUES (
        ${f.surveyId}, ${f.fileUrl},
        ${f.fileType ?? 'photo'},
        ${f.label ?? null}, ${f.filename ?? null}, ${f.mimeType ?? null}
      )
      ON CONFLICT DO NOTHING
    `;
    inserted++;
  }
  return inserted;
}
