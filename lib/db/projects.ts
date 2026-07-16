/**
 * lib/db/projects.ts
 * Project and Layout DB operations — extracted from lib/db-neon.ts.
 *
 * Do not import directly. Import from '@/lib/db-neon' which re-exports
 * everything here, preserving all existing import paths.
 */

import { Project, Layout } from '@/types';
import { getDbReady, isValidUUID, assertUUID, rowToProject, rowToLayout } from './core';
import {
  assertMirrorInvariant,
  derivePrimaryKey,
  derivePrimaryMirror,
  deriveSelectedEquipmentFlatFromMirror,
  normalizeSubSystemMap,
  subSystemEntryCount,
  subSystemEntryFromFlatEquipmentPatch,
} from '@/lib/system/subSystemMirror';
import type { SubSystemEquipmentMap, SubSystemKey } from '@/lib/system/subSystemEquipment';

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
  // Store extended location fields — Project type already declares these
  if (data.stateCode) project.stateCode = data.stateCode;
  if (data.city) project.city = data.city;
  if (data.county) project.county = data.county;
  if (data.zip) project.zip = data.zip;
  if (data.utilityName) project.utilityName = data.utilityName;
  if (data.utilityRatePerKwh) project.utilityRatePerKwh = data.utilityRatePerKwh;
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
        monitoring_platform = ${merged.monitoringPlatform ?? current.monitoringPlatform ?? null},
        monitoring_url      = ${merged.monitoringUrl ?? current.monitoringUrl ?? null},
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
        monitoring_platform = ${merged.monitoringPlatform ?? current.monitoringPlatform ?? null},
        monitoring_url      = ${merged.monitoringUrl ?? current.monitoringUrl ?? null},
        updated_at    = NOW()
      WHERE id = ${id}
        AND user_id = ${userId}
        AND deleted_at IS NULL
      RETURNING *
    `;
  }
  return rows.length > 0 ? rowToProject(rows[0]) : null;
}

/**
 * Merge a canonical selected-equipment patch into projects.selected_equipment
 * (migration 101). Shallow JSONB merge — patch keys overwrite, untouched keys
 * (e.g. an unchanged battery when only the panel changed) are preserved.
 *
 * Self-heals the column with ADD COLUMN IF NOT EXISTS so a write works even
 * before the formal migration is run (same pattern as save-config). Returns
 * true when a row was updated. Callers pass a patch from
 * reconcileFromEngineeringConfig() (engineering) or build one from the resolved
 * design equipment (design) — see /api/production and /api/engineering/save-config.
 *
 * NOTE: kept AFTER updateProject so updateProject's is the first `UPDATE projects`
 * in this file (a source-scanning test in tests/solardog.test.ts relies on that).
 */
export async function upsertSelectedEquipment(
  projectId: string,
  userId: string,
  patch: Record<string, unknown> | null | undefined,
): Promise<boolean> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return false;
  if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) return false;
  const sql = await getDbReady();
  try {
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS selected_equipment JSONB`;
  } catch (alterErr: unknown) {
    console.warn('[upsertSelectedEquipment] ALTER TABLE warning (non-fatal):', (alterErr as Error)?.message);
  }

  // ── Wave 1b (§1.3/§1.4): read the stored envelope to route the write ──────
  // (schemaVersion guard + per-key deep merge). Read failure degrades to the
  // legacy shallow merge — never blocks the write.
  let stored: Record<string, unknown> | null = null;
  try {
    const cur = await sql`
      SELECT selected_equipment FROM projects
      WHERE id = ${projectId}
        AND user_id = ${userId}
        AND deleted_at IS NULL
      LIMIT 1
    `;
    if (cur.length === 0) return false; // project not found — same result as today's UPDATE miss
    const raw = cur[0].selected_equipment;
    stored = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown> | null);
  } catch (readErr: unknown) {
    console.warn('[upsertSelectedEquipment] envelope read failed (legacy shallow merge):', (readErr as Error)?.message);
  }

  const storedMap = normalizeSubSystemMap(stored?.subSystems);
  const storedVersion = typeof stored?.schemaVersion === 'number' ? (stored.schemaVersion as number) : 0;
  const patchVersion = typeof patch.schemaVersion === 'number' ? (patch.schemaVersion as number) : 0;
  const patchMap = normalizeSubSystemMap(patch.subSystems);

  // ── Path C: pure legacy (no v2 data anywhere) — byte-identical to today ───
  if (!patchMap && patchVersion < 2 && !(storedVersion >= 2 && storedMap)) {
    const patchJson = JSON.stringify(patch);
    const rows = await sql`
      UPDATE projects
      SET selected_equipment = COALESCE(selected_equipment, '{}'::jsonb) || ${patchJson}::jsonb
      WHERE id = ${projectId}
        AND user_id = ${userId}
        AND deleted_at IS NULL
      RETURNING id
    `;
    return rows.length > 0;
  }

  const nowIso = typeof patch.updatedAt === 'string' ? (patch.updatedAt as string) : new Date().toISOString();
  let flatPatch: Record<string, unknown> = { ...patch };
  delete flatPatch.subSystems;
  let mapPatch: SubSystemEquipmentMap = { ...(patchMap ?? {}) };

  if (!patchMap && patchVersion < 2 && storedVersion >= 2 && storedMap) {
    // ── Path B: LEGACY flat write against a v2 envelope — §1.3: "detected via
    // schemaVersion and re-mirrored, not interleaved". Fold the flat equipment
    // into the PRIMARY entry so the map stays the single source of truth.
    const primaryKey: SubSystemKey = derivePrimaryKey(storedMap) ?? 'roof';
    const entryPatch = subSystemEntryFromFlatEquipmentPatch(patch, primaryKey, nowIso);
    mapPatch = { [primaryKey]: { ...(storedMap[primaryKey] ?? {}), ...entryPatch } };
    console.warn('[upsertSelectedEquipment] RE-MIRRORED legacy-client write onto v2 envelope (contract §1.3)', {
      projectId, primaryKey, patchKeys: Object.keys(patch),
    });
  } else {
    // ── Path A: v2-aware write — stamp the envelope version.
    flatPatch.schemaVersion = Math.max(2, patchVersion);
  }

  // §1.4 single-writer flat mirror: with >1 entries in the MERGED map, the
  // top-level ids are always derived from the map (a fence write can never
  // flip the roof-primary flat mirror). I-5 asserts + repairs before persist.
  const mergedMap: SubSystemEquipmentMap = { ...(storedMap ?? {}), ...mapPatch };
  if (subSystemEntryCount(mergedMap) > 1) {
    const mirror = derivePrimaryMirror(mergedMap)!;
    const i5 = assertMirrorInvariant(
      {
        panelId: flatPatch.panelId as string | undefined,
        inverterId: flatPatch.inverterId as string | undefined,
        mountingId: flatPatch.mountingId as string | undefined,
        batteryId: flatPatch.batteryId as string | undefined,
      },
      mergedMap,
      'selected_equipment',
    );
    void i5; // violation already logged; repair = unconditional derivation below
    flatPatch = { ...flatPatch, ...deriveSelectedEquipmentFlatFromMirror(mirror) };
  }

  // ── Per-key deep merge (§1.3, I-4): jsonb_set on the subSystems block so a
  // patch touching only one key can never drop/overwrite another key's entry.
  const restJson = JSON.stringify(flatPatch);
  const subsJson = JSON.stringify(mapPatch);
  if (Object.keys(mapPatch).length === 0) {
    const rows = await sql`
      UPDATE projects
      SET selected_equipment = COALESCE(selected_equipment, '{}'::jsonb) || ${restJson}::jsonb
      WHERE id = ${projectId}
        AND user_id = ${userId}
        AND deleted_at IS NULL
      RETURNING id
    `;
    return rows.length > 0;
  }
  const rows = await sql`
    UPDATE projects
    SET selected_equipment = jsonb_set(
      COALESCE(selected_equipment, '{}'::jsonb) || ${restJson}::jsonb,
      '{subSystems}',
      COALESCE(selected_equipment -> 'subSystems', '{}'::jsonb) || ${subsJson}::jsonb
    )
    WHERE id = ${projectId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
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
  designElectrical?: Layout['designElectrical'];
}

// ── Coordinate-integrity guard (Ray, 2026-06-30) ────────────────────────────
// System-wide fix for corrupted layouts. A DB audit found many projects whose saved
// panel/roof geometry sits in a DIFFERENT CITY OR STATE than the project's address
// (e.g. an Illinois project carrying Connecticut panel coordinates) — geometry from
// another project getting persisted under the wrong project_id (stale design state on
// project-switch, copied templates, etc.). upsertLayout is the single chokepoint for
// every save path, so we validate here: if the incoming geometry's centroid is
// implausibly far from the project's geocoded address, refuse the write rather than
// corrupt the project. Threshold is deliberately large (5 km) so it ONLY catches
// cross-location contamination — a legitimately-placed array is always within ~200 m of
// its address, and even a poor geocode is rarely off by kilometers.
const _PHX = { lat: 33.4484, lng: -112.0740 };
function _isPhoenix(lat: number, lng: number): boolean {
  return Math.abs(lat - _PHX.lat) < 0.01 && Math.abs(lng - _PHX.lng) < 0.01;
}
function _coordCentroid(pts: Array<{ lat?: number; lng?: number }> | undefined): { lat: number; lng: number } | null {
  const v = (pts || []).filter(p => p && isFinite(Number(p.lat)) && isFinite(Number(p.lng)) && Math.abs(Number(p.lat)) > 0.001);
  if (!v.length) return null;
  return { lat: v.reduce((s, p) => s + Number(p.lat), 0) / v.length, lng: v.reduce((s, p) => s + Number(p.lng), 0) / v.length };
}
async function assertLayoutCoordsMatchProject(sql: any, data: UpsertLayoutData): Promise<void> {
  // Centroid of the incoming geometry — panels first, then roof-plane vertices.
  let ctr = _coordCentroid(data.panels as Array<{ lat?: number; lng?: number }>);
  if (!ctr && Array.isArray(data.roofPlanes)) {
    ctr = _coordCentroid((data.roofPlanes as Array<{ vertices?: Array<{ lat?: number; lng?: number }> }>).flatMap(rp => rp?.vertices || []));
  }
  if (!ctr || _isPhoenix(ctr.lat, ctr.lng)) return; // nothing to validate against
  const prows = await sql`SELECT lat, lng FROM projects WHERE id = ${data.projectId} LIMIT 1`;
  const plat = Number(prows[0]?.lat), plng = Number(prows[0]?.lng);
  // No trustworthy project geocode → can't validate; don't block.
  if (!isFinite(plat) || !isFinite(plng) || Math.abs(plat) < 0.001 || _isPhoenix(plat, plng)) return;
  const distKm = Math.hypot((ctr.lat - plat) * 111320, (ctr.lng - plng) * 111320 * Math.cos(ctr.lat * Math.PI / 180)) / 1000;
  if (distKm > 5) {
    console.error('[LAYOUT_COORDS_MISMATCH]', { projectId: data.projectId, distKm: distKm.toFixed(1), geometryCentroid: ctr, projectGeocode: { lat: plat, lng: plng } });
    throw new Error(
      `LAYOUT_COORDS_MISMATCH: design geometry is ${distKm.toFixed(1)} km from the project address — ` +
      `it appears to belong to a different project. Refusing to save to avoid corrupting this project. ` +
      `Re-locate the design on the correct address, then save.`,
    );
  }
}

export async function upsertLayout(data: UpsertLayoutData): Promise<Layout> {
  assertUUID(data.projectId, 'projectId');
  assertUUID(data.userId, 'userId');
  const sql = await getDbReady();
  // Block cross-project coordinate contamination before any write (see helper above).
  await assertLayoutCoordsMatchProject(sql, data);
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
    // ── Subsystem-wipe guard (2026-07-16) ─────────────────────────────────────
    // A studio reload bug saved Stowell's hybrid layout with its 48 roof +
    // 16 ground panels silently GONE (project_versions: 81 panels → {} →
    // 19 fence in three saves over 3 minutes). Same fail-loud doctrine as the
    // coords guard above: refuse any single save that makes an entire ≥4-panel
    // subsystem vanish. One-by-one deletion still works (the last save of a
    // shrinking subsystem sees <4 stored panels), and small arrays are exempt.
    try {
      const storedRows = await sql`
        SELECT p->>'systemType' AS st, COUNT(*)::int AS n
        FROM layouts, jsonb_array_elements(coalesce(panels, '[]'::jsonb)) p
        WHERE project_id = ${data.projectId} AND user_id = ${data.userId}
        GROUP BY 1
      `;
      const incoming = new Set((data.panels || []).map(p => ((p as { systemType?: string }).systemType ?? 'roof')));
      const wiped = storedRows.filter((r: { st: string | null; n: number }) =>
        (r.n ?? 0) >= 4 && !incoming.has(r.st ?? 'roof'));
      if (wiped.length > 0) {
        const desc = wiped.map((r: { st: string | null; n: number }) => `${r.st ?? 'roof'} (${r.n} panels)`).join(', ');
        console.error('[LAYOUT_SUBSYSTEM_WIPE_BLOCKED]', { projectId: data.projectId, wiped: desc, incomingCount: (data.panels || []).length });
        throw new Error(
          `LAYOUT_SUBSYSTEM_WIPE: this save would remove the entire ${desc} sub-system in one step — ` +
          `this is the signature of the reload data-loss bug, not a normal edit. ` +
          `Refusing to save. If you really are removing the whole array, delete its panels in the studio first ` +
          `(reduce it below 4 panels), then save.`,
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('LAYOUT_SUBSYSTEM_WIPE')) throw e;
      // census query failure must never block a legit save
      console.warn('[LAYOUT_SUBSYSTEM_WIPE_GUARD] census failed, skipping guard:', (e as Error)?.message);
    }
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
    return await applyDesignElectrical(sql, data, rowToLayout(rows[0]));
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
    return await applyDesignElectrical(sql, data, rowToLayout(rows[0]));
  }
}

// v63: Persist the Design Studio electrical handoff in a SEPARATE conditional
// write so the main layout save never depends on the design_electrical column
// existing. If migration 096 hasn't been run yet, the UPDATE throws "column does
// not exist" and we swallow it — the layout still saves, the handoff just isn't
// stored until the migration runs.
async function applyDesignElectrical(
  sql: any,
  data: UpsertLayoutData,
  saved: Layout,
): Promise<Layout> {
  if (!data.designElectrical) return saved;
  try {
    await sql`
      UPDATE layouts
      SET design_electrical = ${JSON.stringify(data.designElectrical)}::jsonb
      WHERE project_id = ${data.projectId} AND user_id = ${data.userId}
    `;
    saved.designElectrical = data.designElectrical;
  } catch (e) {
    console.warn('[upsertLayout] design_electrical not persisted (run migration 096):', (e as Error)?.message);
  }
  return saved;
}

// ============================================================
