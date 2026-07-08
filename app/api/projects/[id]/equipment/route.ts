export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 20;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID, upsertSelectedEquipment, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Immediate canonical-equipment write from the Design Studio. Called the moment
 * the user picks a panel (and inverter/batteries), so the canonical
 * projects.selected_equipment store — the single source both pages read — is
 * updated without waiting on the debounced layout auto-save. The Design side
 * already holds the full @/types equipment objects, so we persist them directly
 * (no id-resolution that could silently no-op). Engineering reads canonical on
 * its next load.
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
    const { selectedPanel, selectedInverter, selectedBatteries, batteryCount } = body ?? {};

    const patch: Record<string, unknown> = { source: 'design', updatedAt: new Date().toISOString() };
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

    const wrote = await upsertSelectedEquipment(id, user.id, patch);
    if (!wrote) {
      return NextResponse.json({ success: false, error: 'Project not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, panelId: patch.panelId ?? null });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/projects/[id]/equipment]', error);
  }
}
