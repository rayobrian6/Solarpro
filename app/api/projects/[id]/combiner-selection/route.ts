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
// names who made it, that ANY catalogue combiner is accepted on one pick with no
// reason and no authority (Ray, 2026-09-25), that compatibility is recorded as
// information and never refuses, that a re-selection supersedes rather than
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
import { getBosDevice, isSelectableCombiner, listCombiners } from '@/lib/equipment/integratedBos';
import { combinerCompatibilityFor, declaredCombinerPairing } from '@/lib/equipment/combinerCompatibility';
import { getMicroinverterById } from '@/lib/equipment-db';
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
    // `getBosDevice` also knows the bare IQ Gateway, the meter collar and the
    // generic AC combiner panels. POSTed here they used to be stored, and a bare
    // gateway then reached the SLD as the AC COMBINER holding the branch
    // breakers. The same set the GET offers as `candidates` — one answer. That
    // set includes 'enphase-iq-gateway-standalone' (the gateway in its own
    // enclosure plus the PV AC combiner panel), stored like any IQ Combiner.
    isSelectableCombiner: isSelectableCombiner(d.id),
  };
};

/** The first id that is a catalogue MICROINVERTER — combiners pair with
 *  micros. A string-inverter id (the Design Studio's 'se-7600h' default rides
 *  in `selected_equipment.inverterId` on micro jobs) is never used: it is how
 *  an IQ8+ job's card came to list SolarEdge optimizers. */
function firstMicroId(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c && getMicroinverterById(c)) return c;
  }
  return null;
}

const subInverterIds = (subs: unknown): unknown[] =>
  subs && typeof subs === 'object'
    ? Object.values(subs as Record<string, { inverterId?: unknown } | null>).map(s => s?.inverterId)
    : [];

/** Everything every verb needs, resolved once. */
async function load(req: NextRequest, id: string, clientInverterId?: string | null) {
  const user = getUserFromRequest(req);
  if (!user) return { err: bad('Authentication required', 'UNAUTHENTICATED', 401) };
  const project = await getProjectById(id, user.id);
  if (!project) return { err: bad('No access to this project.', 'FORBIDDEN', 403) };
  const stores = await readProjectEquipmentStores(id);
  const selectedEquipment = stores?.selectedEquipment ?? null;
  // The inverter the selection is recorded AGAINST: the micro the engineering
  // page says it is using first, then the stored sub-system and design picks.
  const inverterId = firstMicroId(
    clientInverterId,
    ...subInverterIds(stores?.engineeringSubSystems),
    ...subInverterIds(selectedEquipment?.subSystems),
    selectedEquipment?.inverterId,
    (project as { inverterId?: string } | null)?.inverterId,
  );
  return {
    user,
    inverterId,
    declaredCompatibleIds: combinerCompatibilityFor(undefined, undefined, inverterId ?? undefined) ?? null,
    pairing: declaredCombinerPairing(inverterId),
    current: readCombinerSelection(selectedEquipment),
  };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const rl = await checkRateLimit('engineering', getClientIp(req));
  if (!rl.allowed) return bad('Too many requests.', 'RATE_LIMITED', 429);
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return bad('Invalid project ID format.', 'BAD_PROJECT_ID', 400);

  try {
    const l = await load(req, id, req.nextUrl.searchParams.get('inverterId'));
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
      // Information for a quiet note beside the picker — never a gate.
      pairing: l.pairing,
      // `kind` lets the picker file the standalone-gateway topology
      // ('gateway_system') apart from the IQ Combiners ('integrated_combiner')
      // — they put different boxes on the wall — while it stays one pick in one
      // list. The bare IQ Gateway is not in listCombiners() and so is never offered.
      candidates: listCombiners().map(d => ({ id: d.id, brand: d.brand, model: d.model, kind: d.kind })),
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
    const body = await req.json().catch(() => ({})) as {
      combinerDeviceId?: string;
      inverterId?: string | null;
      basis?: string | null;
      compatibilityOverride?: { reason?: string; authority?: string } | null;
    };
    const l = await load(req, id, body.inverterId ?? null);
    if ('err' in l) return l.err;

    const outcome = planCombinerSelection({
      deviceId: String(body.combinerDeviceId ?? ''),
      lookupDevice,
      inverterId: l.inverterId,
      declaredCompatibleIds: l.declaredCompatibleIds,
      actor: { id: l.user.id, kind: 'user' },
      atIso: new Date().toISOString(),
      // Optional — the pick is never questioned (Ray, 2026-09-25).
      basis: body.basis ?? null,
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

    // Re-picking the device already in force: nothing to write.
    if (outcome.next !== l.current) {
      const written = await upsertSelectedEquipment(id, l.user.id, combinerSelectionPatch(outcome.next!));
      if (!written) return bad('The selection could not be persisted.', 'COMBINER_SELECTION_WRITE_FAILED', 500);
    }

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
