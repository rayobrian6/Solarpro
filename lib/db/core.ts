/**
 * lib/db/core.ts
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
import { hydrateBillData } from '@/lib/bill/hydrateBillData';

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
    // Non-fatal for monitoring — config errors are deployment issues, not production bugs
    import('@/lib/monitoring').then(({ captureMessage }) => {
      captureMessage(`DB_CONFIG_ERROR at ${routeLabel}`, {
        code:  '[DB_CONFIG_ERROR]',
        route: routeLabel,
        level: 'fatal',
        extra: { message: (error as Error).message },
      });
    }).catch(() => {});
    return NextResponse.json(
      { success: false, error: 'Database not configured. Please contact your administrator.', code: 'DB_CONFIG_ERROR' },
      { status: 503 }
    );
  }

  // All other errors (connection refused, timeout, cold-start wake-up) → DB_STARTING
  // Transient errors are warning-level (not page-1 alerts) — they resolve on retry
  const msg = error instanceof Error ? (error as Error).message : String(error);
  const isTransient = !msg.toLowerCase().includes('password authentication failed');
  console.error(`${routeLabel} DB_STARTING:`, error);
  import('@/lib/monitoring').then(({ monitorDbError }) => {
    monitorDbError(routeLabel, error, { isTransient });
  }).catch(() => {});
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
export function assertUUID(value: unknown, fieldName: string): string {
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
export function parseDbFloat(val: unknown): number | undefined {
  if (val === null || val === undefined) return undefined;
  const n = typeof val === 'number' ? val : parseFloat(val as string);
  return isFinite(n) ? n : undefined;
}

export function rowToClient(row: Record<string, unknown>): Client {
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

export function rowToProject(row: Record<string, unknown>): Project {
  const rawBillData = row.bill_data as Record<string, unknown> | undefined;
  // Delegate all bill_data hydration to shared helper (see lib/bill/hydrateBillData.ts)
  const {
    billAnalysis,
    utilityName,
    utilityRatePerKwh,
    stateCode,
    city,
  } = hydrateBillData(rawBillData, row);

  // Canonical selected equipment (migration 101) — the design's chosen panel /
  // inverter / mounting / battery. Highest precedence: reaches BOTH getProjectById
  // (plain SELECT *) and the list path. The legacy production/proposal snapshot
  // hydration in enrichProjectRow remains a fallback (guarded by `if (!base.X)`),
  // so pre-migration projects behave exactly as before.
  let selEq: Record<string, unknown> | null = null;
  if (row.selected_equipment) {
    if (typeof row.selected_equipment === 'string') {
      try { selEq = JSON.parse(row.selected_equipment as string); } catch { selEq = null; }
    } else {
      selEq = row.selected_equipment as Record<string, unknown>;
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
    // Canonical design equipment (see selEq above). Undefined when the column is
    // absent/empty → enrichProjectRow's legacy snapshot sources fill it in.
    selectedPanel: (selEq?.panel as import('@/types').SolarPanel | undefined) ?? undefined,
    selectedInverter: (selEq?.inverter as import('@/types').Inverter | undefined) ?? undefined,
    selectedMounting: (selEq?.mounting as import('@/types').MountingSystem | undefined) ?? undefined,
    selectedBatteries: (selEq?.batteries as import('@/types').Battery[] | undefined) ?? undefined,
    batteryCount: typeof selEq?.batteryCount === 'number' ? (selEq.batteryCount as number) : undefined,
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
    monitoringPlatform: (row.monitoring_platform as import('@/types').Project['monitoringPlatform']) ?? null,
    monitoringUrl: (row.monitoring_url as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function rowToLayout(row: Record<string, unknown>): Layout {
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
    designElectrical: (row.design_electrical as Layout['designElectrical']) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

