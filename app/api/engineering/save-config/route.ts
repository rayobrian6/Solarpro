export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID, getProjectById, getLayoutByProject, upsertSelectedEquipment } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { reconcileFromEngineeringConfig } from '@/lib/system/selectedEquipment';
import {
  finalizeConfigEnvelope,
  normalizeSubSystemMap,
  renormalizeStaleConfigWrite,
} from '@/lib/system/subSystemMirror';
import { classifyPanel } from '@/lib/permit/utils/subSystems';
import type { LegacyScalarConfig, SubSystemKey } from '@/lib/system/subSystemEquipment';

const MAX_CONFIG_BYTES = 256 * 1024;
// Contract §3 Wave 1 / risk #10: payload-size alert threshold — panelCoordinates-
// heavy configs already run near the 256KB ceiling; log loudly before they hit it.
const ALERT_CONFIG_BYTES = 200 * 1024;

export async function POST(req: NextRequest) {
  try {
    // ── Rate limit ────────────────────────────────────────────────────────────
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    const user = getUserFromRequest(req);
    if (!user) {
      console.error('[save-config] FAIL: no user session');
      return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    const rawBody = await req.text();
    if (rawBody.length > MAX_CONFIG_BYTES) {
      console.error('[save-config] FAIL: payload too large', rawBody.length);
      return NextResponse.json({ success: false, error: 'Config payload too large (max 256 KB).' }, { status: 413 });
    }

    let body: { projectId?: unknown; config?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error('[save-config] FAIL: invalid JSON');
      return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const { projectId, config } = body;

    if (!projectId || typeof projectId !== 'string' || !isValidUUID(projectId)) {
      console.error('[save-config] FAIL: invalid projectId', projectId);
      return NextResponse.json({ success: false, error: 'Invalid or missing projectId.' }, { status: 400 });
    }

    if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config as object).length === 0) {
      console.error('[save-config] FAIL: invalid config', typeof config);
      return NextResponse.json({ success: false, error: 'Config must be a non-empty object.' }, { status: 400 });
    }

    // ── Wave 1b (§1.3): old-client write protection + v2 envelope ────────────
    // Load the stored project up front — we need the stored engineering_config
    // schemaVersion BEFORE persisting (also reused by the write-back below, so
    // the legacy path still issues the same number of queries).
    let project: Awaited<ReturnType<typeof getProjectById>> = null;
    try {
      project = await getProjectById(projectId, user.id);
    } catch (loadErr: unknown) {
      // Non-fatal: without the stored config we can't guard — behave legacy.
      console.warn('[save-config] project preload failed (schema guard skipped):', (loadErr as Error)?.message);
    }

    let effectiveConfig = config as Record<string, unknown>;
    const storedCfg = project?.engineeringConfig as Record<string, unknown> | undefined;
    const storedVersion = typeof storedCfg?.schemaVersion === 'number' ? (storedCfg.schemaVersion as number) : 0;
    const incomingVersion = typeof effectiveConfig.schemaVersion === 'number' ? (effectiveConfig.schemaVersion as number) : 0;
    const incomingHasMap = !!normalizeSubSystemMap(effectiveConfig.subSystems);

    // RE-NORMALIZATION TRIGGER (exact): stored schemaVersion >= 2 AND incoming
    // schemaVersion < 2 (or absent) AND the incoming payload carries no
    // subSystems map of its own (a payload WITH a map is v2-aware regardless
    // of a missing stamp — finalizeConfigEnvelope stamps it below).
    if (storedVersion >= 2 && incomingVersion < 2 && !incomingHasMap) {
      let panelStampKeys: SubSystemKey[] = [];
      let cadSystemType: string | null = null;
      try {
        const layout = await getLayoutByProject(projectId, user.id);
        cadSystemType = (layout?.systemType as string | undefined) ?? null;
        panelStampKeys = Array.from(new Set(
          ((layout?.panels ?? []) as unknown as Array<Record<string, unknown>>).map(p => classifyPanel(p)),
        ));
      } catch (layoutErr: unknown) {
        console.warn('[save-config] layout stamp load failed (re-tagging from stored config only):', (layoutErr as Error)?.message);
      }
      const renorm = renormalizeStaleConfigWrite(
        effectiveConfig as LegacyScalarConfig & Record<string, unknown>,
        {
          storedConfig: storedCfg as LegacyScalarConfig & Record<string, unknown>,
          panelStampKeys,
          cadSystemType,
        },
      );
      effectiveConfig = renorm.config;
      console.error('[save-config] RE-NORMALIZED stale-schema client write (old-client whitelist protection, contract §1.3)', {
        projectId,
        userId: user.id,
        incomingVersion,
        storedVersion,
        retaggedInverters: renorm.retaggedInverters,
        primaryKey: renorm.primaryKey,
        preservedKeys: renorm.preservedKeys,
      });
    }

    // v2 finalization: schemaVersion stamp + §1.4 single-writer mirror scalars
    // + I-5 assert/repair. Legacy payloads (no map) pass through UNCHANGED by
    // reference — the persisted bytes are identical to today's.
    const finalized = finalizeConfigEnvelope(effectiveConfig);
    effectiveConfig = finalized.config;
    if (finalized.i5 && !finalized.i5.ok) {
      console.error('[save-config] I-5 mirror drift repaired before persist', {
        projectId, driftFields: finalized.i5.driftFields,
      });
    }

    const configJson = JSON.stringify(effectiveConfig);
    if (configJson.length > ALERT_CONFIG_BYTES) {
      // Contract Wave-1 payload-size logging (256KB ceiling, alert at 200KB).
      console.warn('[save-config] LARGE engineering_config payload', {
        projectId, configBytes: configJson.length, limitBytes: MAX_CONFIG_BYTES,
      });
    }
    console.info('[save-config] attempting save', { projectId, userId: user.id, configBytes: configJson.length });

    // ── Ensure column exists, then save ──────────────────────────────────────
    const sql = await getDbReady();

    // Always ensure columns exist (idempotent, fast no-op if already there)
    try {
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_config JSONB`;
      await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_updated_at TIMESTAMPTZ`;
    } catch (alterErr: unknown) {
      console.warn('[save-config] ALTER TABLE warning (non-fatal):', (alterErr as Error)?.message);
    }

    // Save
    const result = await sql`
      UPDATE projects
      SET
        engineering_config     = ${configJson}::jsonb,
        engineering_updated_at = NOW()
      WHERE id      = ${projectId}
        AND user_id = ${user.id}
        AND deleted_at IS NULL
      RETURNING id, engineering_updated_at
    `;

    if (result.length === 0) {
      console.error('[save-config] FAIL: project not found or ownership mismatch', { projectId, userId: user.id });
      return NextResponse.json({ success: false, error: 'Project not found.' }, { status: 404 });
    }

    // ── Full-duplex write-back: Engineering → Design ──────────────────────────
    // If the engineer changed the panel / inverter / mounting / battery, flow the
    // resolved equipment back into the canonical projects.selected_equipment store
    // so the design record (and the next engineering rebuild) agree — no more
    // "reverted to the stale panel". Non-fatal: a write-back failure never fails
    // the config save.
    try {
      if (!project) project = await getProjectById(projectId, user.id);
      const patch = reconcileFromEngineeringConfig(
        effectiveConfig,
        project,
        new Date().toISOString(),
      );
      if (patch) {
        const wrote = await upsertSelectedEquipment(projectId, user.id, patch as Record<string, unknown>);
        console.info('[save-config] equipment write-back', {
          projectId, wrote, changed: Object.keys(patch).filter(k => k !== 'source' && k !== 'updatedAt'),
        });
      }
    } catch (wbErr: unknown) {
      console.warn('[save-config] equipment write-back skipped (non-fatal):', (wbErr as Error)?.message);
    }

    console.info('[save-config] SUCCESS', { projectId, savedAt: result[0].engineering_updated_at });
    return NextResponse.json({ success: true, savedAt: result[0].engineering_updated_at });

  } catch (err: unknown) {
    console.error('[save-config] UNHANDLED ERROR:', (err as Error)?.message, err);
    return handleRouteDbError('[POST /api/engineering/save-config]', err);
  }
}