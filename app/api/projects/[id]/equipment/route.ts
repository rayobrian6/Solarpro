export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 20;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID, upsertSelectedEquipment, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { SUB_SYSTEM_KEYS, isSubSystemKey, type SubSystemKey } from '@/lib/system/subSystemEquipment';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Immediate canonical-equipment write from the Design Studio. Called the moment
 * the user picks a panel (and inverter/batteries), so the canonical
 * projects.selected_equipment store — the single source both pages read — is
 * updated without waiting on the debounced layout auto-save. The Design side
 * already holds the full @/types equipment objects, so we persist them directly
 * (no id-resolution that could silently no-op). Engineering reads canonical on
 * its next load.
 *
 * Wave 4A (contract §1.3): when the pick carries a per-sub scope — `subSystem`
 * (the active zone's key) + `presentKeys` (the distinct keys stamped on the
 * placed panels, membership authority §1.1) spanning >1 system type — the
 * write becomes a v2 envelope: `subSystems: { [key]: entry }` + schemaVersion
 * 2, deep-merged per key by upsertSelectedEquipment (I-4: a fence pick can
 * never clobber the roof entry). Flat fields ride along ONLY when the scoped
 * key IS the primary (first present in roof > ground > fence, §1.4) — a
 * non-primary pick must not move the flat mirror (the engineering page's
 * canonical-panel reconcile re-pins the PRIMARY sub's strings from it).
 * Un-scoped / single-type picks keep the legacy flat write byte-identical.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });
    }
    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID.' }, { status: 400 });
    }
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { selectedPanel, selectedInverter, selectedBatteries, batteryCount, subSystem, presentKeys } = body ?? {};

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { source: 'design', updatedAt: nowIso };
    if (selectedPanel && typeof selectedPanel === 'object' && (selectedPanel as { id?: string }).id) {
      patch.panelId = (selectedPanel as { id: string }).id;
      patch.panel = selectedPanel;
    }
    if (selectedInverter && typeof selectedInverter === 'object' && (selectedInverter as { id?: string }).id) {
      patch.inverterId = (selectedInverter as { id: string }).id;
      patch.inverter = selectedInverter;
    }
    if (Array.isArray(selectedBatteries)) {
      patch.batteries = selectedBatteries;
      if (typeof batteryCount === 'number') patch.batteryCount = batteryCount;
    }

    if (!patch.panel && !patch.inverter && !patch.batteries) {
      return NextResponse.json({ success: false, error: 'No equipment provided.' }, { status: 400 });
    }

    // ── Wave 4A per-sub scope (§1.3) ─────────────────────────────────────────
    const scopeKey: SubSystemKey | null = isSubSystemKey(subSystem) ? subSystem : null;
    const stampKeys: SubSystemKey[] = Array.isArray(presentKeys) ? presentKeys.filter(isSubSystemKey) : [];
    const scopedHybrid = scopeKey !== null && new Set([...stampKeys, scopeKey]).size > 1;

    let write: Record<string, unknown> = patch;
    if (scopedHybrid) {
      const primaryKey = SUB_SYSTEM_KEYS.find(k => k === scopeKey || stampKeys.includes(k))!;
      const entry: Record<string, unknown> = { key: scopeKey, source: 'design', updatedAt: nowIso };
      if (typeof patch.panelId === 'string') entry.panelId = patch.panelId;
      if (typeof patch.inverterId === 'string') {
        entry.inverterId = patch.inverterId;
        const t = (selectedInverter as { type?: string })?.type;
        entry.topology = t === 'micro' || t === 'optimizer' ? t : 'string';
      }
      const bat0 = Array.isArray(selectedBatteries) ? (selectedBatteries[0] as { id?: string } | undefined) : undefined;
      if (bat0?.id) {
        entry.batteryId = bat0.id;
        if (typeof batteryCount === 'number') entry.batteryCount = batteryCount;
      }
      write = { source: 'design', updatedAt: nowIso, schemaVersion: 2, subSystems: { [scopeKey]: entry } };
      if (scopeKey === primaryKey) {
        // Primary pick: the flat mirror moves WITH the map entry (fresh full-
        // record snapshots; upsert's I-5 derivation keeps the ids honest).
        for (const k of ['panelId', 'panel', 'inverterId', 'inverter', 'batteries', 'batteryCount'] as const) {
          if (k in patch) write[k] = patch[k];
        }
      }
      console.log('[POST /equipment] per-sub scoped write', { projectId: id, subSystem: scopeKey, primaryKey, flat: scopeKey === primaryKey });
    }

    const wrote = await upsertSelectedEquipment(id, user.id, write);
    if (!wrote) {
      return NextResponse.json({ success: false, error: 'Project not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, panelId: patch.panelId ?? null });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/projects/[id]/equipment]', error);
  }
}
