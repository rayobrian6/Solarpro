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
import { siteKeyFromCoords } from '@/lib/siteIdentity';

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

/**
 * Parse the canonical projects.selected_equipment JSONB (migration 101) into the
 * app-level equipment fields. Single source of hydration so every read path
 * (rowToProject AND getProjectWithDetails) reflects the design's chosen panel /
 * inverter / mounting / battery identically — a hand-rolled second copy in
 * getProjectWithDetails is exactly what let an Engineering panel change fail to
 * surface. Returns all-undefined when the column is absent/empty (pre-migration
 * projects behave as before; callers fall back to the legacy snapshot).
 */
export function hydrateCanonicalEquipment(row: Record<string, unknown>): {
  selectedPanel?: import('@/types').SolarPanel;
  selectedInverter?: import('@/types').Inverter;
  selectedMounting?: import('@/types').MountingSystem;
  selectedBatteries?: import('@/types').Battery[];
  batteryCount?: number;
  selectedEquipmentSubSystems?: import('@/lib/system/subSystemEquipment').SubSystemEquipmentMap;
} {
  const raw = row.selected_equipment;
  let selEq: Record<string, unknown> | null = null;
  if (raw) {
    if (typeof raw === 'string') {
      try { selEq = JSON.parse(raw); } catch { selEq = null; }
    } else if (typeof raw === 'object') {
      selEq = raw as Record<string, unknown>;
    }
  }
  if (!selEq) return {};
  // Wave 1b (contract §1.3): pass the per-subsystem map through when present
  // and non-empty ({} = absent, Wave-1a rule) — computeDesignVersionId's §1.6
  // degenerate-map hash rule reads it off Project.selectedEquipmentSubSystems.
  const subs = selEq.subSystems;
  const hasSubs = !!subs && typeof subs === 'object' && !Array.isArray(subs) && Object.keys(subs).length > 0;
  return {
    selectedPanel: (selEq.panel as import('@/types').SolarPanel | undefined) ?? undefined,
    selectedInverter: (selEq.inverter as import('@/types').Inverter | undefined) ?? undefined,
    selectedMounting: (selEq.mounting as import('@/types').MountingSystem | undefined) ?? undefined,
    selectedBatteries: (selEq.batteries as import('@/types').Battery[] | undefined) ?? undefined,
    batteryCount: typeof selEq.batteryCount === 'number' ? (selEq.batteryCount as number) : undefined,
    selectedEquipmentSubSystems: hasSubs
      ? subs as import('@/lib/system/subSystemEquipment').SubSystemEquipmentMap
      : undefined,
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

  const canonEq = hydrateCanonicalEquipment(row);

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
    // Canonical design equipment (migration 101, highest precedence). Undefined
    // when the column is absent/empty → enrichProjectRow's legacy snapshot sources
    // fill it in.
    selectedPanel: canonEq.selectedPanel,
    selectedInverter: canonEq.selectedInverter,
    selectedMounting: canonEq.selectedMounting,
    selectedBatteries: canonEq.selectedBatteries,
    batteryCount: canonEq.batteryCount,
    selectedEquipmentSubSystems: canonEq.selectedEquipmentSubSystems,
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

/**
 * 🚨 ONE PROPERTY PER ROW — the read-time repair for rows written before
 * migration 123.
 *
 * Between the site-ownership commit and migration 123, Design Studio merged
 * EVERY visited property's roof planes into `roof_planes` and stamped each with
 * a `siteKey`. That kept the data, but this function is what hands
 * `layout.roofPlanes` to lib/pvwatts.ts (`roofPlanes[0].pitch` IS the array
 * tilt), lib/multiArrayEngine.ts, /api/production, the sync pipeline and the
 * permit CAD path — none of which filter, and none of which could, because the
 * array carried no statement of which property it described. One live row held
 * 13 planes from three properties.
 *
 * Rows written from migration 123 onwards never need this: the studio sends the
 * active property's planes only. It fires solely when a row is GENUINELY
 * AMBIGUOUS — more than one distinct siteKey present — so a single-site row
 * whose map_center has drifted a metre keeps its whole roof.
 *
 * The active key is resolved by `siteKeyFromCoords`, the same and only
 * implementation the studio uses. There is no second definition of "which
 * property is this".
 */
function activeSitePlanes(row: Record<string, unknown>): Layout['roofPlanes'] {
  const planes = row.roof_planes as (Layout['roofPlanes'] & Array<{ siteKey?: string }>) | null | undefined;
  if (!Array.isArray(planes) || planes.length === 0) return planes ?? undefined;
  const keys = new Set<string>();
  for (const p of planes) { const k = (p as { siteKey?: string })?.siteKey; if (k) keys.add(k); }
  if (keys.size < 2) return planes; // unambiguous — nothing to decide

  // Prefer the key the row states; fall back to deriving it from the stored
  // map centre, which is where the project actually is.
  const stored = row.site_archives as { activeSiteKey?: unknown } | null | undefined;
  let activeKey = (stored && typeof stored === 'object' && typeof stored.activeSiteKey === 'string')
    ? stored.activeSiteKey : '';
  if (!activeKey) {
    const mc = row.map_center as { lat?: unknown; lng?: unknown } | null | undefined;
    activeKey = siteKeyFromCoords(
      typeof mc?.lat === 'number' ? mc.lat : null,
      typeof mc?.lng === 'number' ? mc.lng : null,
      row.project_id as string | undefined,
    );
  }
  // Still unresolved: we cannot prove which property owns which plane. Return
  // everything rather than silently deleting a roof from an engineering input —
  // a visible wrong answer beats an invisible missing one, and the studio
  // repairs the row on first open.
  if (!activeKey) {
    console.warn('[rowToLayout] roof_planes span multiple sites and no active key could be resolved — layout:', row.id);
    return planes;
  }
  const mine = planes.filter(p => { const k = (p as { siteKey?: string })?.siteKey; return !k || k === activeKey; });

  // 🚨 FILTERING TO NOTHING IS NEVER THE RIGHT ANSWER.
  //
  // If NO plane matches the active key, the row is not "a multi-site row we can
  // repair" — it is a row whose active key disagrees with every plane it holds,
  // and the honest conclusion is that we do not know which is right. Returning
  // [] hands lib/pvwatts.ts an empty array to read `roofPlanes[0].pitch` off,
  // and logs the total loss of the roof as a "repair".
  //
  // The version-restore route produced exactly this: it overwrites roof_planes
  // from a snapshot while leaving site_archives (and its activeSiteKey) naming
  // a different property, so every restored plane was filtered out. That route
  // is fixed to carry the archive with it — this is the backstop for every
  // caller that has not been thought of, and for rows already in that state.
  //
  // Same doctrine as the unresolved-key branch above: a visible wrong answer
  // beats an invisible missing one.
  if (mine.length === 0) {
    console.warn('[rowToLayout] active site key matches NO stored plane — keeping all of them rather than returning an empty roof. layout:', row.id,
      { total: planes.length, activeKey, sites: [...keys] });
    return planes;
  }

  console.warn('[rowToLayout] multi-site roof_planes repaired on read — layout:', row.id,
    { total: planes.length, active: mine.length, sites: [...keys] });
  return mine as Layout['roofPlanes'];
}

export function rowToLayout(row: Record<string, unknown>): Layout {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    systemType: ((row.system_type as Layout['systemType']) || (() => { if (!row.system_type) console.warn('[rowToLayout] system_type missing from DB row — defaulting to roof. id:', row.id); return 'roof' as Layout['systemType']; })()) as Layout['systemType'],
    panels: (row.panels as Layout['panels']) || [],
    roofPlanes: activeSitePlanes(row),
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
    // Migration 122. Absent on a row written before it ran, which reads as
    // undefined rather than throwing — the same tolerance design_electrical has.
    obstructions: (row.obstructions as Layout['obstructions']) ?? undefined,
    measurements: (row.measurements as Layout['measurements']) ?? undefined,
    // Migration 123. Same tolerance as the two above — absent on a row written
    // before it ran. 🚨 Returned, but NOT for engineering: see the field's doc
    // on Layout. It is here so the studio can restore a property the user
    // returns to, and for nothing else.
    siteArchives: (row.site_archives as Layout['siteArchives']) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

