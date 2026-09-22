// app/api/projects/[id]/combiner-selection/route.ts
//
// THE PROJECT-SELECTED COMBINER ENDPOINT.
//
// GET     what is selected, what the inverter declares, and what may be chosen.
// POST    select a combiner.
// DELETE  clear the selection — the question reopens; it does NOT revert to a
//         recommendation.
//
// THIS ROUTE VALIDATES NOTHING ABOUT COMBINERS. Every rule — that a selection
// must name who made it and why, that a device the inverter's own declaration
// excludes needs stated authority, that an absent declaration is "not stated"
// rather than "not compatible", that a re-selection supersedes rather than
// overwrites — lives in `lib/combinerSelection/service`, which is pure and
// tested. The route authenticates, authorises, reads, calls the planner, and
// persists what the planner returned. A rule that lives in a handler is a rule
// the next handler forgets.
//
// NO MIGRATION IS INVOLVED. The selection is persisted into the existing
// `projects.selected_equipment` JSONB (migration 101) through its existing
// merge-patch writer — the same slot and the same mechanism D12 Rail Selection
// used, so there is one way to record an equipment decision rather than two.

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import {
  COMBINER_SELECTION_KEY,
  combinerSelectionPatch,
  planCombinerClear,
  planCombinerSelection,
  readCombinerSelection,
  type CombinerDeviceFacts,
} from '@/lib/combinerSelection/service';
import { getBosDevice, listCombiners } from '@/lib/equipment/integratedBos';
import { combinerCompatibilityFor } from '@/lib/equipment/combinerCompatibility';
import { readProjectEquipmentStores } from '@/lib/reconciliation/reconcile';
import { getProjectById, upsertSelectedEquipment } from '@/lib/db/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const bad = (error: string, code: string, status: number) =>
  NextResponse.json({ success: false, error, code }, { status });

/** The catalogue reader the pure planner needs. It never invents a model number. */
const lookupDevice = (id: string): CombinerDeviceFacts | null => {
  const d = getBosDevice(id);
  if (!d) return null;
  return {
    id: d.id,
    manufacturer: d.brand,
    model: d.model,
    // `partNumber` is the ordering SKU. Enphase is explicit that the MODEL
    // NUMBER is what goes on an interconnection application, and the catalogue
    // does not currently distinguish them — so this stays null rather than
    // printing an ordering SKU on a permit under the wrong heading.
    modelNumber: null,
  };
};

/** Everything every verb needs, resolved once. */
async function load(req: NextRequest, id: string) {
  const user = getUserFromRequest(req);
  if (!user) return { err: bad('Authentication required', 'UNAUTHENTICATED', 401) };
  const project = await getProjectById(id, user.id);
  if (!project) return { err: bad('No access to this project.', 'FORBIDDEN', 403) };
  const stores = await readProjectEquipmentStores(id);
  const selectedEquipment = stores?.selectedEquipment ?? null;
  // The inverter the selection is validated AGAINST. A selection is only valid
  // for the system it was made for, so this is recorded on the record too.
  const inverterId =
    (selectedEquipment?.inverterId as string | undefined)
    ?? ((project as { inverterId?: string } | null)?.inverterId)
    ?? null;
  return {
    user,
    inverterId,
    declaredCompatibleIds: combinerCompatibilityFor(undefined, undefined, inverterId ?? undefined) ?? null,
    current: readCombinerSelection(selectedEquipment),
  };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const rl = await checkRateLimit('engineering', getClientIp(req));
  if (!rl.allowed) return bad('Too many requests.', 'RATE_LIMITED', 429);
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return bad('Invalid project ID format.', 'BAD_PROJECT_ID', 400);

  try {
    const l = await load(req, id);
    if ('err' in l) return l.err;
    return NextResponse.json({
      success: true,
      key: COMBINER_SELECTION_KEY,
      selected: l.current?.active ?? null,
      history: l.current?.superseded ?? [],
      inverterId: l.inverterId,
      // Stated explicitly so a panel can show "the catalogue does not say"
      // rather than rendering an empty list as "nothing is compatible".
      declaredCompatibleIds: l.declaredCompatibleIds,
      declarationPresent: Array.isArray(l.declaredCompatibleIds) && l.declaredCompatibleIds.length > 0,
      candidates: listCombiners().map(d => ({ id: d.id, brand: d.brand, model: d.model })),
    });
  } catch (err: unknown) {
    return bad(err instanceof Error ? err.message : 'Failed to read the combiner selection.',
      'COMBINER_SELECTION_READ_FAILED', 500);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const rl = await checkRateLimit('engineering', getClientIp(req));
  if (!rl.allowed) return bad('Too many requests.', 'RATE_LIMITED', 429);
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return bad('Invalid project ID format.', 'BAD_PROJECT_ID', 400);

  try {
    const l = await load(req, id);
    if ('err' in l) return l.err;

    const body = await req.json().catch(() => ({})) as {
      combinerDeviceId?: string;
      basis?: string;
      compatibilityOverride?: { reason?: string; authority?: string } | null;
    };

    const outcome = planCombinerSelection({
      deviceId: String(body.combinerDeviceId ?? ''),
      lookupDevice,
      inverterId: l.inverterId,
      declaredCompatibleIds: l.declaredCompatibleIds,
      actor: { id: l.user.id, kind: 'user' },
      atIso: new Date().toISOString(),
      basis: String(body.basis ?? ''),
      compatibilityOverride: body.compatibilityOverride
        ? { reason: String(body.compatibilityOverride.reason ?? ''), authority: String(body.compatibilityOverride.authority ?? '') }
        : null,
      current: l.current,
    });

    if (!outcome.ok) {
      // 409, not 400: the request was well formed and the SYSTEM declined it.
      // The refusals are returned in full — an operator who fixes one field and
      // is refused again for another has been told half the truth twice.
      return NextResponse.json(
        { success: false, code: 'COMBINER_SELECTION_REFUSED', refusals: outcome.refusals },
        { status: 409 },
      );
    }

    const written = await upsertSelectedEquipment(id, l.user.id, combinerSelectionPatch(outcome.next!));
    if (!written) return bad('The selection could not be persisted.', 'COMBINER_SELECTION_WRITE_FAILED', 500);

    return NextResponse.json({ success: true, selected: outcome.next!.active, history: outcome.next!.superseded });
  } catch (err: unknown) {
    return bad(err instanceof Error ? err.message : 'Failed to record the combiner selection.',
      'COMBINER_SELECTION_WRITE_FAILED', 500);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const rl = await checkRateLimit('engineering', getClientIp(req));
  if (!rl.allowed) return bad('Too many requests.', 'RATE_LIMITED', 429);
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return bad('Invalid project ID format.', 'BAD_PROJECT_ID', 400);

  try {
    const l = await load(req, id);
    if ('err' in l) return l.err;
    const body = await req.json().catch(() => ({})) as { reason?: string };

    const outcome = planCombinerClear({
      actor: { id: l.user.id, kind: 'user' },
      atIso: new Date().toISOString(),
      reason: String(body.reason ?? ''),
      current: l.current,
    });
    if (!outcome.ok) {
      return NextResponse.json(
        { success: false, code: 'COMBINER_CLEAR_REFUSED', refusals: outcome.refusals },
        { status: 409 },
      );
    }

    const written = await upsertSelectedEquipment(id, l.user.id, combinerSelectionPatch(outcome.next!));
    if (!written) return bad('The selection could not be cleared.', 'COMBINER_SELECTION_WRITE_FAILED', 500);
    return NextResponse.json({ success: true, selected: null, history: outcome.next!.superseded });
  } catch (err: unknown) {
    return bad(err instanceof Error ? err.message : 'Failed to clear the combiner selection.',
      'COMBINER_SELECTION_WRITE_FAILED', 500);
  }
}
