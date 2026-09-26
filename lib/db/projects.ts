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
import { isSubSystemKey } from '@/lib/system/subSystemEquipment';
import { computeNameplateKw } from '@/lib/system/nameplate';
import { getPanelById } from '@/lib/equipment-db';
import {
  parseAuthorization,
  authorizesSubsystemRemoval,
  parseDeletionLedger,
  ledgerHasAuthority,
  ledgerCovers,
  type DeletionLedger,
} from '@/lib/design/deletionAuthority';
// 🚨 THE ONE DEFINITION OF "SAME PROPERTY", used on the server for the same
// reason it is used in the studio: a site key is a rounded coordinate, and one
// house routinely mints two or three spellings of itself metres apart.
import { sitesAreSameProperty } from '@/lib/design/siteDesignModel';

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
  if (rows.length > 0) {
    // P0-11 (mirror side): a map-bearing equipment write just landed — re-align
    // the stored design_electrical mirror's panelIds so the stale mirror can
    // never win a later backfill against the map. Non-fatal by design.
    await syncDesignElectricalPanelIds(sql, projectId, userId, mergedMap);
  }
  return rows.length > 0;
}

// ── P0-11 (mirror side) — design_electrical is DERIVED, the map is truth ────
// The DATA-AUTHORITY-AUDIT found layouts.design_electrical contradicting the
// subSystems equipment map on EVERY sub (all three subs cloned rec-405 while
// the map said 405/580/440) — and the permit route uses the mirror as a
// BACKFILL SOURCE, so a stale mirror can win over engineering truth. Fix per
// the register: regenerate the mirror's EQUIPMENT IDS from the map whenever
// the map is written. Only panelIds are touched (equipment is the map's
// domain); string composition/geometry stays design-owned. Idempotent: an
// aligned mirror is a no-op. Contradictions are console.warn-audited.
async function syncDesignElectricalPanelIds(
  sql: any,
  projectId: string,
  userId: string,
  map: SubSystemEquipmentMap,
): Promise<void> {
  try {
    const rows = await sql`
      SELECT id, design_electrical FROM layouts
      WHERE project_id = ${projectId} AND user_id = ${userId}
        AND design_electrical IS NOT NULL
    `;
    for (const row of rows) {
      const raw = row.design_electrical;
      const de = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!de || typeof de !== 'object') continue;
      const changes: string[] = [];

      // Per-sub blocks: de.subSystems is an ARRAY of {key, panelId, ...} blocks.
      if (Array.isArray(de.subSystems)) {
        de.subSystems = de.subSystems.map((b: any) => {
          if (!b || !isSubSystemKey(b.key)) return b;
          const authoritative = map[b.key as SubSystemKey]?.panelId;
          if (authoritative && b.panelId && b.panelId !== authoritative) {
            changes.push(`subSystems[${b.key}].panelId ${b.panelId} → ${authoritative}`);
            return { ...b, panelId: authoritative };
          }
          return b;
        });
      }

      // Flat mirror panelId follows the PRIMARY sub (§1.4 single-writer mirror).
      const primaryKey = derivePrimaryKey(map);
      const primaryPanelId = primaryKey ? map[primaryKey]?.panelId : undefined;
      if (primaryPanelId && typeof de.panelId === 'string' && de.panelId && de.panelId !== primaryPanelId) {
        changes.push(`panelId ${de.panelId} → ${primaryPanelId}`);
        de.panelId = primaryPanelId;
      }

      if (changes.length === 0) continue;
      console.warn(
        '[design_electrical-mirror] P0-11 recompute-if-contradicts: mirror panelIds re-aligned to subSystems map',
        '| project:', projectId, '| layout:', String(row.id).slice(0, 8),
        '|', changes.join('; '),
      );
      await sql`
        UPDATE layouts
        SET design_electrical = ${JSON.stringify(de)}::jsonb
        WHERE id = ${row.id} AND user_id = ${userId}
      `;
    }
  } catch (e) {
    // Mirror alignment must never block the equipment write (pre-mig-096 DBs
    // lack the column entirely).
    console.warn('[design_electrical-mirror] sync skipped (non-fatal):', (e as Error)?.message);
  }
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
  obstructions?: Layout['obstructions'];
  measurements?: Layout['measurements'];
  /** Migration 123 — every OTHER property this project has designed at.
   *  `undefined` means KEEP WHAT IS STORED, exactly like the two above. */
  siteArchives?: Layout['siteArchives'];
  /**
   * THE USER DELIBERATELY DELETED SOMETHING, AND THIS SAYS WHAT.
   *
   * 🚨 IT IS NOT PERSISTED. It is a one-shot authorization that travels with
   * the save it authorises and is consumed by the sub-system-wipe guard below.
   * Minted by the canonical destructive operation in the studio
   * (lib/design/deletionAuthority.ts), never by a generic save path — which is
   * the whole point: a payload that merely contains zero panels is the
   * signature of the July reload data-loss bug, and a payload that contains
   * zero panels AND names the property and the sub-systems a person chose to
   * remove is a decision. The guard has to be able to tell them apart, and
   * before this it could not.
   */
  destructive?: unknown;
  /**
   * THE VERSION OF THE ROW THIS EDIT WAS COMPUTED AGAINST.
   *
   * 🚨 THE DESIGN IS ONE ROW AND EVERY WRITE USED TO BE LAST-WRITE-WINS.
   *
   * `layouts` holds one row per (project_id, user_id) — the CODE makes it one
   * row; migration 001 declares only two separate indexes, no UNIQUE
   * constraint. Nothing in a save said which state of that row the edit was
   * based on, so two tabs, a laptop and a phone, or one tab waking from sleep
   * each wrote the whole row over the other's work, and both were told "Saved".
   *
   * Send the `updatedAt` you read (`Layout.updatedAt`, which every read path
   * already returns) and this save is refused with `LAYOUT_STALE_WRITE` — a
   * 409 with a refusal badge, via `handleRouteDbError` — if the stored row has
   * moved on. The refusal happens BEFORE the first write, so nothing of the
   * losing edit reaches the database and nothing of the winner's is disturbed.
   *
   * 🚨 OPT-IN, DELIBERATELY. Omit it and the behaviour is byte-for-byte what it
   * was. Four of the eight callers — the admin repair tools,
   * /api/engineering/preliminary and the version-restore route — have no
   * client-held version to state, and making this mandatory would refuse saves
   * nobody could fix. Turning it on for a caller is a decision made at that
   * caller, and `tests/layoutConcurrency.postgres.test.ts` pins both halves.
   *
   * An UNREADABLE value is refused, never ignored: silently dropping a token a
   * client meant to send would return the whole product to last-write-wins
   * while everything reported that concurrency control was on.
   */
  expectedUpdatedAt?: string | number | Date | null;
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
  // 🚨 "NOTHING TO VALIDATE AGAINST" AND "NOTHING IS ANYWHERE" ARE NOT THE SAME.
  //
  // `_coordCentroid` drops any point with |lat| <= 0.001, so an array in which
  // EVERY panel is at (0, 0) yields `null` and this guard — the one whose whole
  // job is to stop one project's geometry landing on another — returned without
  // looking at anything. `/api/engineering/preliminary` sends exactly that:
  // `generateSyntheticPanels` emits `lat: 0, lng: 0` for every panel, and
  // `panels` is the one column in the UPDATE with no COALESCE, so a preliminary
  // calculation REPLACED a real design with unplaced scaffold panels. The
  // sub-system guard does not catch it either — the synthetic panels are
  // systemType 'roof', so 'roof' is present in `incoming` and nothing looks
  // wiped.
  //
  // Unplaced geometry is refused only when it would destroy placed geometry, so
  // a brand-new project (the route's actual purpose) still works.
  // 🚨 ASK ABOUT THE PANELS, NOT ABOUT THE COMBINED CENTROID.
  // The first version of this guard tested `!ctr`, and `ctr` falls back to the
  // ROOF-PLANE vertices when the panels yield nothing — so a payload carrying
  // unplaced panels alongside real roof geometry produced a centroid, and the
  // guard was skipped exactly when half the payload was unplaced.
  const suppliedPanels = Array.isArray(data.panels) ? data.panels.length : 0;
  const panelCentroid  = _coordCentroid(data.panels as Array<{ lat?: number; lng?: number }>);
  if (suppliedPanels > 0 && !panelCentroid) {
    // 🚨 jsonb_array_elements ERRORS on a non-array, and a lateral join is
    // evaluated before WHERE, so the array-ness is decided inside the call.
    // And `lat` is accepted as a number OR a numeric string, because
    // `_coordCentroid` above accepts both (`Number(p.lat)`): a stricter test
    // here would count a stored string coordinate as unplaced and quietly
    // disarm the guard on exactly the rows it protects.
    const placed = await sql`
      SELECT COUNT(*)::int AS n
      FROM layouts l,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(l.panels) = 'array' THEN l.panels ELSE '[]'::jsonb END
           ) p
      WHERE l.project_id = ${data.projectId} AND l.user_id = ${data.userId}
        AND (CASE
               WHEN jsonb_typeof(p->'lat') = 'number' THEN abs((p->>'lat')::double precision)
               WHEN jsonb_typeof(p->'lat') = 'string'
                    AND (p->>'lat') ~ '^[[:space:]]*-?[0-9]+([.][0-9]+)?[[:space:]]*$'
                    THEN abs((p->>'lat')::double precision)
               ELSE 0
             END) > 0.001
    `;
    const n = Number(placed[0]?.n ?? 0);
    if (n > 0) {
      console.error('[LAYOUT_COORDS_UNPLACED]', { projectId: data.projectId, incoming: suppliedPanels, storedPlaced: n });
      throw new Error(
        `LAYOUT_COORDS_UNPLACED: this save carries ${suppliedPanels} panel(s) with no map position, ` +
        `and the project already holds ${n} placed panel(s). Writing it would replace a real design with ` +
        `unplaced ones. Nothing has been written.`,
      );
    }
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

// ── Nameplate authority (DATA-AUTHORITY-AUDIT P0-7 / P0-6 data side) ────────
// upsertLayout is the single chokepoint every save path funnels through
// (design studio, production, preliminary, version restore, system-tools), so
// the ONE nameplate rule lives here: when the project carries a per-subsystem
// equipment map, layouts.system_size_kw is computed from the map's panelIds
// via equipment-db — the caller-supplied kW (client stamp math) is only a
// fallback for map-less projects (byte-identical legacy behavior for those).
// Contradictions are console.warn-audited, never silently absorbed.
async function resolveNameplateSizeKw(
  sql: any,
  data: UpsertLayoutData,
): Promise<number | undefined> {
  try {
    const rows = await sql`
      SELECT engineering_config -> 'subSystems' AS eng_subs,
             selected_equipment -> 'subSystems' AS sel_subs
      FROM projects
      WHERE id = ${data.projectId} AND user_id = ${data.userId}
      LIMIT 1
    `;
    if (rows.length === 0) return undefined;
    // engineering_config.subSystems is the doctrine owner; selected_equipment's
    // mirror fills per-key gaps (they are kept in sync by upsertSelectedEquipment).
    const eng = normalizeSubSystemMap(rows[0].eng_subs);
    const sel = normalizeSubSystemMap(rows[0].sel_subs);
    if (!eng && !sel) return undefined; // map-less project → legacy passthrough
    const map: SubSystemEquipmentMap = { ...(sel ?? {}), ...(eng ?? {}) };
    const np = computeNameplateKw(
      (data.panels ?? []) as Array<{ systemType?: string; placementType?: string; wattage?: number }>,
      map,
      getPanelById,
    );
    if (
      typeof data.systemSizeKw === 'number' &&
      Math.abs(np.totalKw - data.systemSizeKw) > 0.005
    ) {
      console.warn(
        '[nameplate] recompute-if-contradicts: layout save kW',
        data.systemSizeKw, '→', np.totalKw,
        '| per-sub:', np.subs.map(s => `${s.key} ${s.count}×${s.watts}W (${s.wattsSource})`).join(', '),
        '| project:', data.projectId,
      );
    }
    return np.totalKw;
  } catch (e) {
    // The nameplate resolution must never block a save — fall back to caller value.
    console.warn('[nameplate] resolution failed, using caller systemSizeKw:', (e as Error)?.message);
    return undefined;
  }
}

/**
 * Does `layouts.site_archives` exist yet (migration 123)?
 *
 * Cached per process after the first TRUE answer — a column cannot disappear,
 * and this is on the layout save path. A FALSE answer is deliberately NOT
 * cached: a deployment that starts before the operator runs the migration must
 * notice when it lands, rather than staying in the degraded mode until the next
 * cold start. The probe is one `information_schema` lookup.
 *
 * Fails CLOSED. If the probe itself errors we report "absent", which keeps the
 * subsystem-wipe guard at full strength — the safe direction, because the cost
 * of a false "absent" is a refused save the user retries, and the cost of a
 * false "present" is a deleted layout.
 */
let _siteArchivesColumnPresent = false;
async function layoutsHasSiteArchives(sql: any): Promise<boolean> {
  if (_siteArchivesColumnPresent) return true;
  try {
    const rows = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'layouts' AND column_name = 'site_archives'
      LIMIT 1
    `;
    _siteArchivesColumnPresent = rows.length > 0;
    return _siteArchivesColumnPresent;
  } catch (e) {
    console.warn('[upsertLayout] could not probe for layouts.site_archives — treating it as absent:', (e as Error)?.message);
    return false;
  }
}

/** Test seam: forget the cached probe result. */
export function __resetSiteArchivesProbeForTests(): void {
  _siteArchivesColumnPresent = false;
}

// ── THE DELETION AUTHORITY HAS TO SURVIVE THE SAVE THAT CARRIES IT ──────────
//
// 🚨 A DESTRUCTIVE SAVE MAY NOT REPORT SUCCESS UNLESS THE LEDGER PERSISTED.
//
// The tombstone ledger has no column of its own. It rides inside
// `site_archives`, which `applyDesignEntities` writes in a SEPARATE statement
// from the one that removes the geometry — and that statement's only error
// handler was a `console.warn`. So the two halves of one decision came apart:
//
//     UPDATE layouts SET panels = '[]', roof_planes = '[]'   -- committed
//     UPDATE layouts SET site_archives = …                   -- threw, swallowed
//     upsertLayout returned normally, the route answered 200, the studio said
//     "Saved", and the row was left with no geometry and no record of why.
//
// That last state is not merely lossy, it is ACTIVELY WRONG: `lifecycleFor`
// reads a property with no faces and no tombstones as `untouched`, which is the
// one lifecycle that PERMITS automatic re-acquisition. Lane A then re-injected
// the roof the installer had deliberately deleted — the exact resurrection the
// whole deletion model exists to close, reached through the save that was
// supposed to record the decision.
//
// The pre-check that already guards this column (`LAYOUT_ARCHIVE_UNSTORABLE`)
// did not cover it. It inspected `sites[*].{panels,roofPlanes,obstructions,
// measurements}` only, on the stated grounds that "an archive with no entities
// round-trips identically whether it is stored or not" — TRUE of entity
// bundles, FALSE of the ledger, which sits at the top of the same object beside
// `sites` and is typically the ONLY thing a single-property project puts there.

/** The tombstones this save is carrying, normalized. Never null. */
function incomingLedger(data: UpsertLayoutData): DeletionLedger {
  return parseDeletionLedger(
    (data.siteArchives as { deletions?: unknown } | null | undefined)?.deletions,
  );
}

function ledgerDetail(led: DeletionLedger): string {
  return Object.entries(led.sites).map(([k, s]) => {
    const parts: string[] = [];
    if (s.faceIds?.length) parts.push(`${s.faceIds.length} deleted roof face(s)`);
    if (s.sectionIds?.length) parts.push(`${s.sectionIds.length} deleted section(s)`);
    if (s.obstructionIds?.length) parts.push(`${s.obstructionIds.length} deleted obstruction(s)`);
    if (s.clearedAt) parts.push('a cleared property');
    return `${k} (${parts.join(', ')})`;
  }).join('; ');
}

/**
 * Refuse, before anything is written, a save whose deletion record cannot be
 * stored at all.
 *
 * Fails CLOSED and fails EARLY: on a deployment that has not run migration 123
 * the column does not exist, so no ordering of statements can make this save
 * honest. Nothing is written, the route answers 409, and the studio shows its
 * permanent refusal badge with the operator's next action in it.
 */
async function assertDeletionLedgerStorable(sql: any, data: UpsertLayoutData): Promise<void> {
  const led = incomingLedger(data);
  if (!ledgerHasAuthority(led)) return;   // nothing to lose
  if (await layoutsHasSiteArchives(sql)) return;
  const detail = ledgerDetail(led);
  console.error('[LAYOUT_ARCHIVE_UNSTORABLE]', { projectId: data.projectId, deletions: detail });
  throw new Error(
    `LAYOUT_ARCHIVE_UNSTORABLE: this save carries a deletion record — ${detail} — and the ` +
    `layouts.site_archives column does not exist, so what you deleted would be removed from the ` +
    `design with no record that you meant it, and put back automatically on the next load. ` +
    `Run migration 123 (Admin → System Tools → Migrations). Nothing has been written.`,
  );
}

/**
 * Write the ledger FIRST and prove it landed, before the statement that
 * removes the geometry it explains.
 *
 * 🚨 ORDER IS THE DIFFERENCE BETWEEN A FAILED SAVE AND A DESTROYED DESIGN.
 * Reporting the failure afterwards is necessary but not sufficient: by then the
 * faces are already gone from the row with nothing to say why, so a user who
 * closes the tab on the error message still loses the argument with Lane A on
 * the next load. Written here, a ledger that cannot be stored costs nothing —
 * the geometry is still on disk and the user is told to retry.
 *
 * It is deliberately placed AFTER the sub-system-wipe guard, which reads
 * `site_archives ->> 'activeSiteKey'` out of the row to recognise a property
 * change. Writing the column before that read would answer the guard's question
 * with this save's own claim and disarm it.
 *
 * `RETURNING` is what makes this a proof rather than an assumption: an UPDATE
 * that matches no row raises nothing and reports success.
 */
async function persistDeletionLedgerFirst(
  sql: any,
  data: UpsertLayoutData,
  /** The row version this request owns, from `claimLayoutForWrite`. Null when
   *  the caller opted out of concurrency control. */
  version: string | null,
): Promise<void> {
  const led = incomingLedger(data);
  if (!ledgerHasAuthority(led)) return;
  let stored: DeletionLedger | null = null;
  try {
    // 🚨 THE PRECONDITION RIDES ON THIS STATEMENT TOO, and it has to.
    //
    // This is the FIRST thing a destructive save writes. A stale save that got
    // this far would stamp ITS archive — including its deletion ledger — onto
    // the row belonging to whoever won, and then be refused by the main write.
    // A refusal that still mutates the winner's row is just a quieter way of
    // losing their work. Conditioning it means the stale save writes nothing
    // at all and is refused here instead.
    const rows = await sql`
      UPDATE layouts
      SET site_archives = ${JSON.stringify(data.siteArchives)}::jsonb
      WHERE project_id = ${data.projectId} AND user_id = ${data.userId}
        AND (${version}::timestamptz IS NULL
             OR date_trunc('milliseconds', updated_at)
                = date_trunc('milliseconds', ${version}::timestamptz))
      RETURNING site_archives -> 'deletions' AS deletions, updated_at
    `;
    // No row yet (this save creates the layout) is not a failure — there is no
    // geometry to protect, and `applyDesignEntities` writes the column after the
    // INSERT, where the verification below catches anything that goes wrong.
    // With a version in hand it means something else entirely: the caller is in
    // the UPDATE branch, so the row exists, so the precondition is what failed.
    if (rows.length === 0) {
      if (version !== null) await refuseStaleWrite(sql, data, version);
      return;
    }
    stored = parseDeletionLedger(rows[0]?.deletions);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('LAYOUT_')) throw e;
    console.error('[LAYOUT_ARCHIVE_UNSTORABLE] deletion ledger write failed before the layout write:',
      (e as Error)?.message);
    throw new Error(
      `LAYOUT_ARCHIVE_UNSTORABLE: the record of what you deleted could not be written ` +
      `(${(e as Error)?.message}), so this save was stopped before it removed anything. ` +
      `Nothing has been written — your design is unchanged. Try again.`,
    );
  }
  if (!ledgerCovers(stored, led)) {
    console.error('[LAYOUT_ARCHIVE_UNSTORABLE] deletion ledger did not read back:',
      { projectId: data.projectId, sent: ledgerDetail(led) });
    throw new Error(
      `LAYOUT_ARCHIVE_UNSTORABLE: the record of what you deleted did not survive the write, ` +
      `so this save was stopped before it removed anything. Nothing has been written — ` +
      `your design is unchanged. Try again.`,
    );
  }
}

// ── OPTIMISTIC CONCURRENCY ──────────────────────────────────────────────────
//
// 🚨 TWO TABS, ONE ROW, AND THE SECOND ONE USED TO WIN SILENTLY.
//
// The whole design is one row keyed (project_id, user_id) — the code makes it
// one row; migration 001 declares two ordinary indexes and no UNIQUE
// constraint. Every write was `UPDATE layouts SET … WHERE project_id = … AND
// user_id = …`, with nothing stating which version of the row the edit was
// computed against. Two tabs, a laptop and a phone, or one tab waking from
// sleep each replaced the other's work, and both were told "Saved".
//
// THE TOKEN IS `updated_at`, and it is free: a BEFORE UPDATE trigger
// (`update_layouts_updated_at`, migration 001) already advances it on every
// write, `rowToLayout` already returns it as `Layout.updatedAt`, and every read
// path already hands it to the client. No column, no migration, nothing for an
// operator to run before this works.
//
// 🚨 …AND THAT TRIGGER IS ALSO THE TRAP. ONE logical save issues up to SIX
// UPDATE statements against this row — the ledger pre-write, the main write,
// design_electrical, site_archives, obstructions, measurements — and the
// trigger bumps `updated_at` on every one. A precondition pinned to the
// CLIENT's token on each statement conflicts with the save's own earlier
// statement and refuses every save in the product, for ever, with a full green
// test suite. So the client's token is checked exactly ONCE, by a CLAIM, and
// each later statement is conditioned on what the previous one RETURNED.
//
// 🚨 MILLISECOND GRANULARITY, ON PURPOSE. `timestamptz` keeps microseconds;
// the value that reaches a browser has been through a JS `Date`, which keeps
// milliseconds. Comparing the raw values would be a guard that can never match
// — every save refused, always. Both sides are truncated to milliseconds so the
// round trip is lossless whatever the driver does with the column.

/** The token as a comparable ISO string, or null for "no token supplied". */
function normalizeVersion(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * The version this save states it was computed against.
 *
 * 🚨 AN UNREADABLE TOKEN IS A REFUSAL, NEVER A SHRUG. Dropping a value the
 * caller meant as a precondition would return the product to last-write-wins
 * while every log line said concurrency control was on — the exact shape of a
 * guard that cannot fire. Absent is absent; present-but-unreadable is refused.
 */
function requestedVersion(data: UpsertLayoutData): string | null {
  const raw = data.expectedUpdatedAt;
  if (raw === undefined || raw === null || raw === '') return null;
  const v = normalizeVersion(raw);
  if (v === null) {
    console.error('[LAYOUT_STALE_WRITE] unreadable version token', { projectId: data.projectId, token: String(raw) });
    throw new Error(
      `LAYOUT_STALE_WRITE: this save states the design version it was based on, but that ` +
      `value is not a readable timestamp, so it is impossible to tell whether it would ` +
      `overwrite someone else's work. Nothing has been written. Reload the design and try again.`,
    );
  }
  return v;
}

/** How many panels this save carries, phrased for a human. */
function incomingPanelPhrase(data: UpsertLayoutData): string {
  if (data.panels == null) return 'does not restate the panels';
  return `carries ${data.panels.length} panel(s)`;
}

/**
 * Refuse, and say enough that the user can decide what to do.
 *
 * 🚨 A REFUSAL MUST NEVER READ LIKE A DATA LOSS. Nothing has been written when
 * this fires — the claim is the first write of the save and it is conditional —
 * so BOTH copies still exist: the stored one on the server, the user's in the
 * tab (and in localStorage, which DesignStudio writes before it POSTs). The
 * message says so, states what each one holds so the user can judge which they
 * want, and names the way out. A 409 that just says "conflict" is how somebody
 * closes the tab and loses the only copy of their edit.
 */
async function refuseStaleWrite(sql: any, data: UpsertLayoutData, expected: string): Promise<never> {
  let storedPanels = 'an unknown number of';
  let storedAt = 'a later time';
  try {
    const rows = await sql`
      SELECT jsonb_array_length(coalesce(panels, '[]'::jsonb)) AS n, updated_at
      FROM layouts WHERE project_id = ${data.projectId} AND user_id = ${data.userId} LIMIT 1
    `;
    if (rows.length === 0) {
      console.error('[LAYOUT_STALE_WRITE] the row this save was based on no longer exists',
        { projectId: data.projectId, expected });
      throw new Error(
        `LAYOUT_STALE_WRITE: the saved design this edit was based on no longer exists — it was ` +
        `deleted or reset while you had it open. This save ${incomingPanelPhrase(data)} and would ` +
        `re-create it without that decision. Nothing has been written, and your edits are still ` +
        `in this tab. Reload the project to see its current state before saving again.`,
      );
    }
    storedPanels = String(rows[0].n ?? 0);
    storedAt = normalizeVersion(rows[0].updated_at) ?? storedAt;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('LAYOUT_')) throw e;
    console.warn('[LAYOUT_STALE_WRITE] could not describe the stored version:', (e as Error)?.message);
  }
  console.error('[LAYOUT_STALE_WRITE]', { projectId: data.projectId, expected, storedAt, storedPanels });
  throw new Error(
    `LAYOUT_STALE_WRITE: this design was saved somewhere else — another tab, another device, or ` +
    `an older copy of this page — while you had it open. The saved design has ${storedPanels} ` +
    `panel(s) and was last written at ${storedAt}; this save ${incomingPanelPhrase(data)} and was ` +
    `based on the version from ${expected}. Nothing has been written, so neither copy is lost: ` +
    `the saved design is untouched and your edits are still in this tab. Reload the design to see ` +
    `what was saved, then re-apply your change.`,
  );
}

/**
 * Take ownership of the row, atomically, before anything is written.
 *
 * 🚨 READ-THEN-WRITE IS NOT A CONCURRENCY CHECK. Comparing a SELECT to the
 * token and then writing leaves the whole gap between them open — which is the
 * exact window the defect lives in. This is one statement: Postgres locks the
 * row, re-evaluates the WHERE against the committed value, and at most one of
 * two racing writers matches. The loser sees zero rows and is refused.
 *
 * The statement changes no data. Its only effect is the trigger's bump of
 * `updated_at`, which is what makes the winner's claim exclusive: any other
 * writer holding the same token now fails its own claim. It is placed AFTER
 * every read-only guard so a save refused for a coordinate mismatch or a
 * sub-system wipe does not move the version and force an innocent second tab
 * to reload for nothing.
 */
async function claimLayoutForWrite(
  sql: any,
  data: UpsertLayoutData,
  expected: string,
): Promise<string> {
  const rows = await sql`
    UPDATE layouts
    SET updated_at = NOW()
    WHERE project_id = ${data.projectId} AND user_id = ${data.userId}
      AND date_trunc('milliseconds', updated_at)
          = date_trunc('milliseconds', ${expected}::timestamptz)
    RETURNING updated_at
  `;
  if (rows.length === 0) await refuseStaleWrite(sql, data, expected);
  // The trigger sets NEW.updated_at = NOW() whatever the statement asks for, so
  // this is the value on disk — and the version every later statement in this
  // save must match, not the one the client sent.
  return normalizeVersion(rows[0]?.updated_at) ?? expected;
}

/**
 * Tell the caller the version the row ACTUALLY ended up with.
 *
 * 🚨 THE RETURNED `updatedAt` WAS A MID-SAVE VALUE, AND IT WOULD HAVE WEDGED
 * THE STUDIO ON ITS SECOND AUTOSAVE.
 *
 * `upsertLayout` builds its return value from the main UPDATE's `RETURNING *`,
 * and then `applyDesignElectrical` and `applyDesignEntities` write the row up
 * to four more times — design_electrical, site_archives, obstructions,
 * measurements — each bumping `updated_at` through the trigger. So the value
 * handed back named an instant the row had already left behind.
 *
 * That was harmless while nobody read it. It stops being harmless the moment a
 * client uses it as its next precondition, which is the obvious thing to do
 * (take the new version out of the save response rather than re-fetching): the
 * very next save would be refused as stale, by this save. Correcting it here
 * means one truth about the row instead of two, for every caller.
 */
async function withCurrentVersion(sql: any, data: UpsertLayoutData, saved: Layout): Promise<Layout> {
  try {
    const rows = await sql`
      SELECT updated_at FROM layouts
      WHERE project_id = ${data.projectId} AND user_id = ${data.userId} LIMIT 1
    `;
    const v = rows[0]?.updated_at;
    if (v) saved.updatedAt = (v instanceof Date ? v.toISOString() : String(v)) as Layout['updatedAt'];
  } catch (e) {
    // Never fail a save that already succeeded over reporting its version. The
    // caller keeps the mid-save value, which is exactly what it had before.
    console.warn('[upsertLayout] could not re-read the saved version:', (e as Error)?.message);
  }
  return saved;
}

export async function upsertLayout(data: UpsertLayoutData): Promise<Layout> {
  assertUUID(data.projectId, 'projectId');
  assertUUID(data.userId, 'userId');
  // The version this save states it was computed against, if any. Validated
  // before a connection is opened — an unreadable token is a client bug and
  // there is nothing useful to do with the database until it is fixed.
  const expectedVersion = requestedVersion(data);
  const sql = await getDbReady();
  // Block cross-project coordinate contamination before any write (see helper above).
  await assertLayoutCoordsMatchProject(sql, data);
  // 🚨 REFUSE A SAVE THAT WOULD SILENTLY DISCARD AN ARCHIVED PROPERTY.
  //
  // `applyDesignEntities` writes `site_archives` (migration 123) inside a
  // try/catch whose only handler is a console.warn. On a deployment that has not
  // run 123 the UPDATE throws "column does not exist", is swallowed, upsertLayout
  // returns normally and the route answers **HTTP 200**. The studio branches on
  // `res.ok` alone and shows "saved".
  //
  // The subsystem-wipe guard below does NOT cover this. It compares systemType
  // BUCKET MEMBERSHIP, so it only fires when the incoming array has no panels of
  // a stored type at all. Place ONE panel at the new property and 'roof' is in
  // `incoming`, the guard passes, and `panels = ${panelsJson}::jsonb` — with no
  // COALESCE, unlike roof_planes and map_center on the adjacent lines — replaces
  // the previous property's 52 with the 1. The archive that was supposed to be
  // holding those 52 was dropped a moment earlier, silently.
  //
  // So the check is here, BEFORE any write, and outside the guard's try/catch
  // (which re-throws only LAYOUT_SUBSYSTEM_WIPE and swallows everything else —
  // a refusal raised in there would be discarded).
  //
  // It refuses only when something would actually be LOST. An archive with no
  // entities round-trips identically whether it is stored or not, so an empty one
  // is allowed through and a single-property project keeps working normally on a
  // pre-123 deployment. Only the case this exists for — real archived work that
  // cannot be persisted — fails closed.
  if (data.siteArchives !== undefined && !(await layoutsHasSiteArchives(sql))) {
    const sites = (data.siteArchives as { sites?: Record<string, Record<string, unknown>> } | null)?.sites;
    const lossy = sites && typeof sites === 'object'
      ? Object.entries(sites).filter(([, bundle]) =>
          !!bundle && ['panels', 'roofPlanes', 'obstructions', 'measurements']
            .some(k => Array.isArray(bundle[k]) && (bundle[k] as unknown[]).length > 0))
      : [];
    if (lossy.length > 0) {
      const detail = lossy.map(([k, b]) => {
        const counts = ['panels', 'roofPlanes', 'obstructions', 'measurements']
          .map(f => [f, Array.isArray(b[f]) ? (b[f] as unknown[]).length : 0] as const)
          .filter(([, n]) => n > 0).map(([f, n]) => `${n} ${f}`).join(', ');
        return `${k} (${counts})`;
      }).join('; ');
      console.error('[LAYOUT_ARCHIVE_UNSTORABLE]', { projectId: data.projectId, detail });
      throw new Error(
        `LAYOUT_ARCHIVE_UNSTORABLE: this save carries another property's design — ${detail} — ` +
        `and the layouts.site_archives column does not exist, so it would be discarded without trace. ` +
        `Run migration 123 (Admin → System Tools → Migrations). Nothing has been written.`,
      );
    }
  }
  // 🚨 AND THE SAME QUESTION FOR THE DELETION LEDGER, which the check above
  // cannot answer. It counts ENTITIES in archived bundles; the ledger is a
  // DECISION at the top of the same column, and a project can carry every
  // tombstone it owns with `sites: {}`. See `assertDeletionLedgerStorable`.
  await assertDeletionLedgerStorable(sql, data);
  // Nameplate authority (P0-7): map-carrying projects get the equipment-db kW.
  const nameplateKw = await resolveNameplateSizeKw(sql, data);
  const sizeKw = nameplateKw ?? data.systemSizeKw ?? 0;
  // 🚨 ABSENCE KEEPS — INCLUDING FOR THE MOST VALUABLE COLUMN IN THE ROW.
  // This was `JSON.stringify(data.panels || [])`, so a caller that did not send
  // panels wrote `[]` and DELETED THE DESIGN, while every neighbouring column
  // — roof_planes, map_center, fence_line, obstructions, measurements and the
  // four scalars — had already been given the opposite rule. Proven against
  // real PostgreSQL in tests/siteDesignRoute.postgres.test.ts: three placed
  // panels, one save omitting `panels`, zero panels left.
  //
  // An explicit `[]` is a DECISION and still clears; only genuine absence keeps,
  // exactly as for roofPlanes below. Judging a deliberate clear is the
  // sub-system wipe guard's job, not this line's.
  const panelsJson = data.panels == null ? null : JSON.stringify(data.panels);
  const roofPlanesJson = data.roofPlanes ? JSON.stringify(data.roofPlanes) : null;
  const fenceLineJson = data.fenceLine ? JSON.stringify(data.fenceLine) : null;
  const mapCenterJson = data.mapCenter ? JSON.stringify(data.mapCenter) : null;

  // Check if layout exists for this project
  // 🚨 `updated_at` comes back with it, because that is the version token. It
  // costs nothing here and it is what lets a stale save be named as stale
  // BEFORE the sub-system-wipe guard runs — a stale wipe is a stale save, and
  // telling the user their tab is out of date is the actionable diagnosis.
  const existing = await sql`
    SELECT id, updated_at FROM layouts
    WHERE project_id = ${data.projectId}
      AND user_id = ${data.userId}
    LIMIT 1
  `;

  // 🚨 THE CHEAP HALF OF THE CONCURRENCY CHECK, and it is only half.
  //
  // This read cannot be the mechanism — the row can move between this SELECT
  // and the write, which is the very race being closed — but it is free (the
  // SELECT was already happening), it fires before the guards do any work, and
  // it produces the honest refusal rather than a wipe refusal for a save whose
  // real problem is that the tab is out of date. The atomic CLAIM below is what
  // actually makes it safe.
  if (expectedVersion !== null) {
    const storedVersion = normalizeVersion(existing[0]?.updated_at);
    if (existing.length === 0 || storedVersion !== expectedVersion) {
      await refuseStaleWrite(sql, data, expectedVersion);
    }
  }

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
      // 🚨 ARCHIVED IS NOT WIPED (migration 123). Changing property moves the
      // previous property's panels out of `panels` and into `site_archives` in
      // ONE save, which looks exactly like a whole sub-system vanishing. It is
      // not: the panels are in the same payload, in the column that holds other
      // properties. Counting only `data.panels` here would make this guard
      // REFUSE every legitimate address change — and refusing the save is worse
      // than the bug it guards, because the archive would then never reach the
      // database at all and the next save really would lose it.
      //
      // When no archive is present this is byte-for-byte the original check, so
      // the Stowell reload defect (81 panels → {} → 19 in three saves) is caught
      // exactly as before.
      // 🚨 …BUT ONLY IF THE ARCHIVE CAN ACTUALLY BE STORED.
      //
      // This guard is the ONLY thing standing between a property change and a
      // destroyed layout, and relaxing it on the strength of a payload field is
      // safe exactly as long as that field reaches the database. On a
      // deployment where migration 123 has not run, `site_archives` does not
      // exist: `applyDesignEntities` catches the missing column, warns, and the
      // archive is silently dropped — while this guard, having counted the
      // archived panels as present, has already let `panels: []` through. The
      // net effect would be the guard DISARMING ITSELF and deleting the very
      // layout it exists to protect, which is strictly worse than the bug.
      //
      // So the column is probed. Absent, the check is byte-for-byte the
      // original one: the destructive save is refused, the studio shows its
      // save-failed badge, and nothing is lost. Present, archived panels count.
      const archiveIsStorable = await layoutsHasSiteArchives(sql);
      const archivedPanels: Array<{ systemType?: string }> = [];
      const arch = archiveIsStorable
        ? (data.siteArchives as { activeSiteKey?: string; sites?: Record<string, { panels?: unknown }> } | undefined)
        : undefined;
      // 🚨 AND ONLY WHILE THE PROPERTY IS ACTUALLY CHANGING.
      //
      // The relaxation had no bound in TIME. An archive is never evicted, so
      // once a project had archived a >=4-panel property, EVERY later save of
      // that project with `panels: []` passed the guard — for ever, including
      // the reload bug the guard was built for in July (Stowell: 81 panels ->
      // {} -> 19 in three saves). The guard had disarmed itself permanently.
      //
      // A property change is identifiable: the save carries a DIFFERENT
      // PROPERTY than the row currently stores. Only then may archived panels
      // count as present. A save at the same property that empties the array is
      // an ordinary wipe and is refused exactly as before.
      //
      // 🚨 AND "DIFFERENT PROPERTY" IS NOT "DIFFERENT STRING". This read
      // `storedKey !== arch.activeSiteKey`, so any change in the key counted as a
      // property change — including a change that is not one.
      //
      // A site key is DERIVED FROM COORDINATES, and those coordinates drift.
      // `nearestSamePropertyKey` in lib/design/siteDesignModel.ts exists for
      // exactly that reason: a user returning to a property the archive
      // genuinely held missed it, because the key had been re-derived from a
      // slightly different coordinate. So re-picking the SAME HOUSE — a fresh
      // geocode, a Pick House click a metre off the last one — minted a new key,
      // and this guard read it as a property change and stood down. A
      // `panels: []` save at the property the user was still standing on then
      // went through, which is precisely the defect the guard exists to refuse.
      //
      // `sitesAreSameProperty` is the one authority on the question: identical,
      // or within SITE_MATCH_RADIUS_M. Using it narrows the relaxation to what
      // was always intended without touching the direction that matters more —
      // a genuine address change must still be accepted, because refusing it
      // means the archive never reaches the database and the NEXT save loses it
      // for real. Both directions are pinned in
      // tests/wipeGuardSurvivesKeyDrift.postgres.test.ts.
      let switchingProperty = false;
      if (arch && typeof arch.activeSiteKey === 'string') {
        try {
          const cur = await sql`
            SELECT site_archives ->> 'activeSiteKey' AS k
            FROM layouts WHERE project_id = ${data.projectId} AND user_id = ${data.userId} LIMIT 1
          `;
          const storedKey = cur[0]?.k ?? null;
          // No stored key yet (first archive on this row) also counts: there is
          // nothing to contradict, and refusing it would block the very first
          // property change a project ever makes.
          //
          // That branch is REDUNDANT TODAY and kept on purpose.
          // `sitesAreSameProperty` returns false for a null argument, so the
          // negation below already yields true — a mutation removing this
          // clause is behaviourally identical and no test can catch it. It stays
          // because the intent should not depend on a helper's null handling
          // continuing to answer that way: if `sitesAreSameProperty` ever
          // treated a missing key as "same", dropping this would silently block
          // every project's first property change and the archive would never be
          // stored.
          switchingProperty =
            storedKey === null || !sitesAreSameProperty(storedKey, arch.activeSiteKey);
        } catch {
          // Cannot tell — assume NOT switching, which keeps the guard strict.
          switchingProperty = false;
        }
      }
      if (switchingProperty && arch?.sites && typeof arch.sites === 'object') {
        for (const bundle of Object.values(arch.sites)) {
          if (Array.isArray(bundle?.panels)) archivedPanels.push(...(bundle.panels as Array<{ systemType?: string }>));
        }
      }
      // 🚨 ABSENCE IS NOT A WIPE, AND THIS GUARD SAID IT WAS.
      //
      // `data.panels || []` treats an OMITTED panel list exactly like an empty
      // one, so any save that simply did not mention panels was read as
      // removing every sub-system and refused with LAYOUT_SUBSYSTEM_WIPE. That
      // made the write's own "absence keeps" rule — the COALESCE below —
      // unreachable for every project with four or more panels, which is every
      // real design: the guard threw before the write could keep anything.
      //
      // The two halves have to agree. A save that says nothing about panels
      // removes nothing, so there is nothing for this guard to protect.
      // A save that says `[]` is a decision and is judged exactly as before.
      const incoming = new Set([...(data.panels ?? []), ...archivedPanels]
        .map(p => ((p as { systemType?: string }).systemType ?? 'roof')));
      const allWiped = data.panels == null ? [] : storedRows.filter((r: { st: string | null; n: number }) =>
        (r.n ?? 0) >= 4 && !incoming.has(r.st ?? 'roof'));
      // 🚨 AN AUTHORISED DELETION IS NOT A WIPE, AND THIS IS THE ONLY THING
      // THAT DISTINGUISHES THEM.
      //
      // The guard's whole value is that it cannot be talked out of refusing —
      // so it is not asked to trust a boolean. It is handed the authorization
      // the destructive operation minted, and that authorization has to NAME
      // the property and NAME each sub-system it removed. A save that empties
      // the roof array while holding an authorization for the roof at this
      // property goes through; the same save holding an authorization minted at
      // the house next door, or one that mentions only the ground mount, is
      // refused exactly as before — and so is every save that carries none,
      // which is every save the reload bug has ever produced.
      //
      // Nothing about this is persisted. The authorization exists for the
      // length of one request.
      const auth = parseAuthorization(data.destructive);
      const authSiteKey = (data.siteArchives as { activeSiteKey?: string } | null | undefined)?.activeSiteKey ?? '';
      // 🚨 MATCHED BY PROPERTY, NOT BY SPELLING. The authorization names the key
      // the LEDGER is filed under and the payload names `state.activeSiteKey`;
      // after A → B → A those are two spellings of one house, metres apart, and
      // an exact comparison deadlocked the deliberate deletion for ever. The
      // binding is not weakened — the house next door is 15 m away and is still
      // refused. See `authorizesSubsystemRemoval`.
      const authorised = allWiped.filter((r: { st: string | null }) =>
        authorizesSubsystemRemoval(auth, authSiteKey, r.st ?? 'roof', sitesAreSameProperty));
      const wiped = allWiped.filter((r: { st: string | null }) =>
        !authorizesSubsystemRemoval(auth, authSiteKey, r.st ?? 'roof', sitesAreSameProperty));
      if (authorised.length > 0) {
        console.warn('[LAYOUT_SUBSYSTEM_WIPE_AUTHORISED]', {
          projectId: data.projectId,
          op: auth?.op,
          siteKey: authSiteKey,
          removed: authorised.map((r: { st: string | null; n: number }) => `${r.st ?? 'roof'} (${r.n})`).join(', '),
        });
      }
      if (wiped.length > 0) {
        const desc = wiped.map((r: { st: string | null; n: number }) => `${r.st ?? 'roof'} (${r.n} panels)`).join(', ');
        console.error('[LAYOUT_SUBSYSTEM_WIPE_BLOCKED]', { projectId: data.projectId, wiped: desc, incomingCount: (data.panels || []).length, hadAuthorization: !!auth, authOp: auth?.op ?? null });
        throw new Error(
          `LAYOUT_SUBSYSTEM_WIPE: this save would remove the entire ${desc} sub-system in one step — ` +
          `this is the signature of the reload data-loss bug, not a normal edit. ` +
          `Refusing to save. If you really are removing the whole array, do it with a delete control in the ` +
          `studio — Clear Panels, Clear Custom Building or Start Over — which records the decision and lets ` +
          `this save through.`,
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('LAYOUT_SUBSYSTEM_WIPE')) throw e;
      // census query failure must never block a legit save
      console.warn('[LAYOUT_SUBSYSTEM_WIPE_GUARD] census failed, skipping guard:', (e as Error)?.message);
    }
    // 🚨 CLAIM THE ROW BEFORE THE FIRST WRITE, NOT AFTER IT.
    //
    // Every guard above this line is read-only, so a save refused by any of
    // them has written nothing and has not moved the version — an innocent
    // second tab is not forced to reload because someone else's save was
    // rejected. Everything BELOW this line writes, so the claim goes exactly
    // here: it is the last moment at which "nothing has been written" is still
    // true, and the first at which it would stop being true.
    //
    // `version` is what this request now OWNS — the value the claim's own write
    // left on the row, never the client's token. The distinction is the whole
    // difference between working and refusing every save for ever: this save is
    // about to write the row several more times, and the client's token is
    // already out of date by the line below. See `claimLayoutForWrite`.
    const version: string | null = expectedVersion === null
      ? null
      : await claimLayoutForWrite(sql, data, expectedVersion);
    // 🚨 THE DELETION RECORD GOES DOWN BEFORE THE STATEMENT THAT REMOVES THE
    // GEOMETRY IT EXPLAINS — and after the guard above, which reads the stored
    // `activeSiteKey` out of this very column. See `persistDeletionLedgerFirst`.
    await persistDeletionLedgerFirst(sql, data, version);
    //
    // 🚨 AND THE WRITES FROM HERE ON ARE DELIBERATELY UNCONDITIONAL.
    //
    // The obvious next move — pin the main write to what the ledger returned —
    // is WRONG, and quietly so. The ledger has already been written by then, so
    // a refusal at the main write would leave the row holding TOMBSTONES FOR
    // FACES THAT ARE STILL THERE. `admitAfterHydrate` filters the active bundle
    // against that ledger on the next load, so those faces would vanish from
    // the user's screen — a refusal causing exactly the data loss the refusal
    // exists to prevent, and a subtler one, because nothing reports it.
    //
    // The claim is the mechanism and it has already done its job: no other
    // writer holding a version token can be in flight, because their claim
    // would have failed against the version this one advanced. What remains is
    // an opt-out writer (the admin repair tools, /api/engineering/preliminary,
    // the version-restore route) landing in the microseconds between the two
    // statements — and against those, this save winning is exactly today's
    // behaviour, with the ledger and the geometry still in step.
    // UPDATE existing layout
    // 🚨 roof_planes AND map_center USE COALESCE: `undefined` MEANS KEEP STORED,
    // exactly as it does for obstructions, measurements and site_archives.
    //
    // They used to be written unconditionally, so `undefined` meant SET NULL —
    // a roof-destroying default. Any caller that does not happen to send
    // roofPlanes wiped the geometry, and `/api/engineering/preliminary`
    // (reached from the bill-upload modal) sends neither it nor mapCenter. So
    // uploading a bill deleted the roof of a designed project. After migration
    // 123 it was worse: the active roof was destroyed while site_archives kept
    // naming it, leaving that design neither active nor archived — the one
    // thing the ownership model forbids.
    //
    // Nulling map_center also disables the legacy multi-site repair in
    // rowToLayout, which falls back to it to decide which property a row is at.
    //
    // A DELIBERATE CLEAR STILL WORKS. The studio sends `[]`, which is not
    // undefined, so COALESCE keeps the empty array. Only absence is ignored.
    const rows = await sql`
      UPDATE layouts SET
        system_type         = ${data.systemType || 'roof'},
        panels              = COALESCE(${panelsJson}::jsonb, panels),
        roof_planes         = COALESCE(${roofPlanesJson}::jsonb, roof_planes),
        -- ABSENCE KEEPS. These seven were the uneven half of a doctrine the two
        -- lines around them already follow. See the note above upsertLayout.
        --
        -- fence_line was written unconditionally, and fenceLineJson is null
        -- whenever data.fenceLine is absent -- so ANY save that did not carry a
        -- fence SET THE STORED FENCE TO NULL. Unconditional, destructive, and
        -- reachable from a read-only production CALCULATION
        -- (app/api/production/route.ts), which sends no fence at all.
        --
        -- The four scalars were worse than silent: the 20 / 180 / 1.5 / 0.6
        -- fallbacks replaced a value the user had set with a FABRICATED default
        -- whenever a caller omitted it. Absence became a confident wrong answer.
        --
        -- An explicit empty array still clears a fence: [] is truthy, so it
        -- serialises to '[]' and writes. Only genuine absence keeps.
        ground_tilt         = COALESCE(${data.groundTilt ?? null}::double precision, ground_tilt),
        ground_azimuth      = COALESCE(${data.groundAzimuth ?? null}::double precision, ground_azimuth),
        row_spacing         = COALESCE(${data.rowSpacing ?? null}::double precision, row_spacing),
        ground_height       = COALESCE(${data.groundHeight ?? null}::double precision, ground_height),
        fence_azimuth       = COALESCE(${data.fenceAzimuth ?? null}::double precision, fence_azimuth),
        fence_height        = COALESCE(${data.fenceHeight ?? null}::double precision, fence_height),
        fence_line          = COALESCE(${fenceLineJson}::jsonb, fence_line),
        -- The same rule, applied to the last four that did not follow it.
        -- A '?? false' turned an omitted flag into a deliberate "no"; '?? 0'
        -- turned an omitted count into "this design has no panels"; and
        -- map_zoom was written unconditionally, so any save that did not carry
        -- it NULLED the stored zoom. total_panels and system_size_kw are
        -- DERIVED from panels, so if the panels are kept these must be too —
        -- otherwise a save that omits everything leaves 3 panels beside a
        -- stored count of 0.
        bifacial_optimized  = COALESCE(${data.bifacialOptimized ?? null}::boolean, bifacial_optimized),
        total_panels        = COALESCE(${data.totalPanels ?? null}::integer, total_panels),
        system_size_kw      = COALESCE(${data.systemSizeKw === undefined && nameplateKw == null ? null : sizeKw}::double precision, system_size_kw),
        map_center          = COALESCE(${mapCenterJson}::jsonb, map_center),
        map_zoom            = COALESCE(${data.mapZoom ?? null}::integer, map_zoom),
        updated_at          = NOW()
      WHERE project_id = ${data.projectId}
        AND user_id = ${data.userId}
      RETURNING *
    `;
    return await withCurrentVersion(sql, data,
      await applyDesignElectrical(sql, data, rowToLayout(rows[0])));
  } else {
    // INSERT new layout.
    //
    // 🚨 A VERSION TOKEN CANNOT REACH HERE. `expectedVersion` means "I read a
    // row and this was its version"; no row exists, so the row it read is gone
    // and the pre-check above has already refused with LAYOUT_STALE_WRITE
    // rather than quietly re-creating what someone deleted. A first-ever save
    // sends no token and lands here exactly as it always did.
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
        ${panelsJson ?? '[]'}::jsonb,
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
        ${sizeKw},
        ${mapCenterJson}::jsonb,
        ${data.mapZoom ?? null}
      )
      RETURNING *
    `;
    return await withCurrentVersion(sql, data,
      await applyDesignElectrical(sql, data, rowToLayout(rows[0])));
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
  // 🚨 THIS EARLY RETURN USED TO SKIP applyDesignEntities TOO.
  //
  // It read `if (!data.designElectrical) return saved;` and returned BEFORE the
  // tail call below, so obstructions, measurements and site archives were
  // persisted ONLY when the save also carried an electrical design. DesignStudio
  // builds that as `panelList.length > 0 ? buildDesignElectrical() : undefined`,
  // so the consequences were:
  //
  //   • a design with NO PANELS YET never stored its obstructions or
  //     measurements — trace a roof, place a vent, reload, the vent is gone.
  //     Migration 122 shipped, the column existed, the route accepted the
  //     field, this function wrote it, and it still never ran.
  //   • worse, the save that follows a PROPERTY CHANGE sends `panels: []` — so
  //     `designElectrical` is undefined and the site archive was dropped on the
  //     floor, silently, in exactly the case migration 123 exists for.
  //
  // Nothing announced either one: the request returned 200 and the row simply
  // kept its old value. The two writes are independent and are now sequenced
  // as such — a design with no electrical still has design entities.
  if (data.designElectrical) {
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
  }
  return applyDesignEntities(sql, data, saved);
}

/**
 * Migration 122 — obstructions + measurements.
 *
 * Written the same way design_electrical is: a SEPARATE conditional write, so
 * the main layout save never depends on these columns existing. Before
 * migration 122 the UPDATE throws "column does not exist", we swallow it, and
 * the layout still saves — the design entities simply are not stored yet.
 *
 * 🚨 Sends the arrays even when EMPTY. `?? existing` semantics elsewhere in
 * this file mean an absent value is read as KEEP WHAT IS STORED, so deleting
 * the last obstruction has to be expressible. An empty array is a statement;
 * `undefined` is a question.
 */
async function applyDesignEntities(
  sql: any,
  data: UpsertLayoutData,
  saved: Layout,
): Promise<Layout> {
  if (data.obstructions === undefined && data.measurements === undefined && data.siteArchives === undefined) return saved;
  try {
    // Migration 123. Written here for the same reason as the two below: a
    // deployment that has not run 123 yet must still save the layout, and the
    // archives simply are not stored until it does.
    //
    // 🚨 An EMPTY archive is a statement — "this project is down to one
    // property" — and has to be expressible, so `{sites:{}}` is written, not
    // skipped. Only `undefined` means keep what is stored.
    //
    // 🚨 …EXCEPT WHEN IT CARRIES A DELETION RECORD, WHICH MAY NOT BE SKIPPED.
    //
    // "The layout still saves, the archives simply are not stored yet" is a
    // reasonable trade for a bundle of entities that is also sitting in the
    // active columns. It is not a reasonable trade for the tombstone ledger:
    // the geometry the ledger explains has ALREADY been removed by the write
    // above, so swallowing this error leaves a property with no faces and no
    // record of why — which `lifecycleFor` reads as `untouched`, the one state
    // that lets Lane A put the deleted roof straight back. The user was told
    // "Saved". A destructive save that cannot record the decision is a failed
    // save, and it has to say so.
    //
    // `RETURNING` rather than a bare UPDATE because an UPDATE that matched no
    // row raises nothing: "the statement did not throw" is not the same fact as
    // "the decision is on disk".
    if (data.siteArchives !== undefined) {
      const led = incomingLedger(data);
      const mustPersist = ledgerHasAuthority(led);
      try {
        const rows = await sql`
          UPDATE layouts
          SET site_archives = ${JSON.stringify(data.siteArchives)}::jsonb
          WHERE project_id = ${data.projectId} AND user_id = ${data.userId}
          RETURNING site_archives -> 'deletions' AS deletions
        `;
        if (mustPersist && !ledgerCovers(parseDeletionLedger(rows[0]?.deletions), led)) {
          throw new Error(rows.length === 0
            ? 'the layout row could not be found'
            : 'the deletion record did not read back');
        }
        saved.siteArchives = data.siteArchives;
      } catch (e) {
        if (mustPersist) {
          console.error('[LAYOUT_ARCHIVE_UNSTORABLE] deletion ledger not persisted:',
            { projectId: data.projectId, sent: ledgerDetail(led), reason: (e as Error)?.message });
          throw new Error(
            `LAYOUT_ARCHIVE_UNSTORABLE: the record of what you deleted could not be saved ` +
            `(${(e as Error)?.message}). The deletion is NOT recorded, so it has not been saved — ` +
            `do not close this design until a save succeeds.`,
          );
        }
        console.warn('[upsertLayout] site_archives not persisted (run migration 123):', (e as Error)?.message);
      }
    }
    if (data.obstructions !== undefined) {
      await sql`
        UPDATE layouts
        SET obstructions = ${JSON.stringify(data.obstructions)}::jsonb
        WHERE project_id = ${data.projectId} AND user_id = ${data.userId}
      `;
      saved.obstructions = data.obstructions;
    }
    if (data.measurements !== undefined) {
      await sql`
        UPDATE layouts
        SET measurements = ${JSON.stringify(data.measurements)}::jsonb
        WHERE project_id = ${data.projectId} AND user_id = ${data.userId}
      `;
      saved.measurements = data.measurements;
    }
  } catch (e) {
    // 🚨 A DELIBERATE REFUSAL IS NOT A MISSING COLUMN, and this catch is wide
    // enough to swallow one. Same rule the sub-system-wipe guard already
    // follows: re-throw the refusal, absorb everything else. Without this line
    // the throw above would land here and become a warning — the very shape of
    // the defect it exists to close.
    if (e instanceof Error && e.message.startsWith('LAYOUT_')) throw e;
    console.warn('[upsertLayout] obstructions/measurements not persisted (run migration 122):', (e as Error)?.message);
  }
  return saved;
}

// ============================================================
