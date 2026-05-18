/**
 * lib/db/solardog.ts
 * SolarDog AI assistant DB operations (messages, aliases, knowledge, physical data)
 * — extracted from lib/db-neon.ts.
 */

import { getDbReady, isValidUUID, parseDbFloat } from './core';

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
 * Table is created by migration 018_site_aliases.sql.
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
export type { SeedKnowledgeItem } from '../solardog/knowledgeSeed';
import { SOLARPRO_KNOWLEDGE_SEED } from '../solardog/knowledgeSeed';
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

