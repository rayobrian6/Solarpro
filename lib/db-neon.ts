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
import { Client, Project, Layout } from '@/types';

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

const DATABASE_URL = process.env.DATABASE_URL!;

export function getDb() {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
  return neon(DATABASE_URL);
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
    lat: row.lat as number | undefined,
    lng: row.lng as number | undefined,
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
  return {
    id: row.id as string,
    userId: row.user_id as string,
    clientId: row.client_id as string | undefined,
    name: row.name as string,
    status: (row.status as Project['status']) || 'lead',
    systemType: (row.system_type as Project['systemType']) || 'roof',
    notes: (row.notes as string) || '',
    address: (row.address as string) || '',
    lat: row.lat as number | undefined,
    lng: row.lng as number | undefined,
    systemSizeKw: row.system_size_kw as number | undefined,
    billData: row.bill_data as Record<string, unknown> | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToLayout(row: Record<string, unknown>): Layout {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    systemType: (row.system_type as Layout['systemType']) || 'roof',
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
  const sql = getDb();
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
  const sql = getDb();
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
  const sql = getDb();
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
  const sql = getDb();
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
  const sql = getDb();
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

export async function getProjectsByUser(userId: string): Promise<Project[]> {
  assertUUID(userId, 'userId');
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM projects
    WHERE user_id = ${userId}
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
  `;
  return rows.map(rowToProject);
}

export async function getProjectsByClient(clientId: string, userId: string): Promise<Project[]> {
  if (!isValidUUID(clientId) || !isValidUUID(userId)) return [];
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM projects
    WHERE client_id = ${clientId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
  `;
  return rows.map(rowToProject);
}

export async function getProjectById(id: string, userId: string): Promise<Project | null> {
  if (!isValidUUID(id) || !isValidUUID(userId)) return null;
  const sql = getDb();
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
  const billDataJson = data.billData ? JSON.stringify(data.billData) : null;
  const sql = getDb();
  const rows = await sql`
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
  const sql = getDb();
  const current = await getProjectById(id, userId);
  if (!current) return null;

  const merged = { ...current, ...data };
  // clientId must be a valid UUID or null
  const clientId = isValidUUID(merged.clientId) ? merged.clientId : null;

  const rows = await sql`
    UPDATE projects SET
      name          = ${merged.name},
      client_id     = ${clientId},
      status        = ${merged.status || 'lead'},
      system_type   = ${merged.systemType || 'roof'},
      notes         = ${merged.notes || ''},
      address       = ${merged.address || ''},
      lat           = ${merged.lat ?? null},
      lng           = ${merged.lng ?? null},
      system_size_kw= ${merged.systemSizeKw ?? null},
      updated_at    = NOW()
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    RETURNING *
  `;
  return rows.length > 0 ? rowToProject(rows[0]) : null;
}

export async function softDeleteProject(id: string, userId: string): Promise<boolean> {
  if (!isValidUUID(id) || !isValidUUID(userId)) return false;
  const sql = getDb();
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

// ============================================================
// LAYOUTS
// ============================================================

export async function getLayoutByProject(projectId: string, userId: string): Promise<Layout | null> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return null;
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM layouts
    WHERE project_id = ${projectId}
      AND user_id = ${userId}
    ORDER BY updated_at DESC
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
  const sql = getDb();
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
  const sql = getDb();

  // Get next version number
  const versionResult = await sql`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
    FROM project_versions
    WHERE project_id = ${data.projectId}
  `;
  const nextVersion = versionResult[0].next_version as number;

  const snapshotJson = JSON.stringify(data.snapshot);
  const rows = await sql`
    INSERT INTO project_versions (
      project_id, user_id, version_number, snapshot,
      panels_count, system_size_kw, change_summary
    ) VALUES (
      ${data.projectId},
      ${data.userId},
      ${nextVersion},
      ${snapshotJson}::jsonb,
      ${data.panelsCount ?? 0},
      ${data.systemSizeKw ?? 0},
      ${data.changeSummary || ''}
    )
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

export async function getProjectVersions(projectId: string, userId: string): Promise<ProjectVersion[]> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return [];
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM project_versions
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
    snapshot: row.snapshot as Record<string, unknown>,
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
  const sql = getDb();
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
  const sql = getDb();
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
  const sql = getDb();

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

  return {
    id: row.id as string,
    userId: row.user_id as string,
    clientId: row.client_id as string | undefined,
    client,
    name: row.name as string,
    status: (row.status as import('@/types').Project['status']) || 'lead',
    systemType: (row.system_type as import('@/types').Project['systemType']) || 'roof',
    notes: (row.notes as string) || '',
    address: (row.address as string) || '',
    lat: row.lat as number | undefined,
    lng: row.lng as number | undefined,
    systemSizeKw: row.system_size_kw as number | undefined,
    layout,
    production,
    costEstimate,
    selectedPanel,
    selectedInverter,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
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
    itcRateResidential:   (row.itc_rate_residential as number) ?? 0,
    updatedAt:            row.updated_at as string,
  };
}

/**
 * Get the active pricing config row.
 * Returns null if the table doesn't exist yet (migration not run).
 */
export async function getPricingConfig(): Promise<DbPricingConfig | null> {
  try {
    const sql = getDb();
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
  const sql = getDb();

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
        ${data.itcRateResidential ?? 0}
      )
      RETURNING *
    `;
    return rowToPricingConfig(rows[0] as Record<string, unknown>);
  }
}