// app/api/projects/[id]/rail-selection/route.ts
// D12 — THE RAIL SELECTION ENDPOINT.
//
// GET     the derived verdict: the span-screened shortlist, the mount's own
//         compatibility statement, and the selection in force (if any).
// POST    pin a rail.
// DELETE  retire the pinned rail.
//
// THIS ROUTE VALIDATES NOTHING ABOUT RAILS. Every rule — that a rail must be one
// the mount's own compatibility statement admits, that a short span needs stated
// authority, that a pin needs a reason, that a re-pin supersedes rather than
// overwrites — lives in `lib/railSelection/service`, which is pure and tested.
// The route authenticates, authorises, reads, calls the planner, and persists
// what the planner returned. A rule that lives in a handler is a rule the next
// handler forgets.
//
// NO MIGRATION IS INVOLVED. The selection is persisted into the existing
// `projects.selected_equipment` JSONB (migration 101) through its existing
// merge-patch writer, which matters because applying a migration is blocked on
// the unrotated credential and this is not.

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { productionAuthorizationSource } from '@/lib/fieldMeasurement/capabilities';
import { resolveRailSelectionActor, railActorCan } from '@/lib/railSelection/capabilities';
import {
  planRailPin, planRailUnpin, readRailSelection, railSelectionPatch,
} from '@/lib/railSelection/service';
import { deriveRailSelection } from '@/lib/permit/snapshot/resolution/railSelection';
import { readProjectEquipmentStores } from '@/lib/reconciliation/reconcile';
import { upsertSelectedEquipment } from '@/lib/db/projects';
import { getProjectById } from '@/lib/db/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const bad = (error: string, code: string, status: number) =>
  NextResponse.json({ success: false, error, code }, { status });

/** Everything both verbs need, resolved once. */
async function load(req: NextRequest, id: string) {
  const user = getUserFromRequest(req);
  if (!user) return { err: bad('Authentication required', 'UNAUTHENTICATED', 401) };
  const actor = await resolveRailSelectionActor(user.id, id, productionAuthorizationSource);
  if (!actor.projectAccess) {
    // The BASIS is returned, not just a 403: "you cannot do this" without a
    // reason is what sends an operator to support instead of to their admin.
    return { err: NextResponse.json(
      { success: false, error: 'No access to this project.', code: 'FORBIDDEN', accessBasis: actor.accessBasis },
      { status: 403 }) };
  }
  const stores = await readProjectEquipmentStores(id);
  const project = await getProjectById(id, user.id);
  const mountingSystemId =
    (project as { mountingSystemId?: string } | null)?.mountingSystemId
    ?? ((stores?.selectedEquipment as Record<string, unknown> | null)?.mountingId as string | undefined)
    ?? null;
  const verdict = deriveRailSelection({
    mountingSystemId,
    project: (project ?? {}) as Record<string, unknown>,
    selectedEquipment: stores?.selectedEquipment ?? null,
  });
  return {
    user, actor, verdict, mountingSystemId,
    current: readRailSelection(stores?.selectedEquipment ?? null),
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
      state: l.verdict.state,
      mountingSystemId: l.mountingSystemId,
      compatibilityStatement: l.verdict.compatibilityStatement,
      requiredSpanIn: l.verdict.requiredSpanIn,
      candidates: l.verdict.candidates,
      eligibleCandidateCount: l.verdict.eligibleCandidateCount,
      pinned: l.verdict.pinned,
      basis: l.verdict.basis,
      operatorAction: l.verdict.operatorAction,
      // Stated so a panel never implies an orderable SKU exists.
      partNumberAvailability: l.verdict.partNumberAvailability,
      probes: l.verdict.probes,
      history: l.current?.superseded ?? [],
      // Hiding an action the actor cannot perform is a courtesy; the write path
      // re-authorises regardless of what the panel rendered.
      capabilities: [...l.actor.capabilities],
      accessBasis: l.actor.accessBasis,
    });
  } catch (err: unknown) {
    return bad(err instanceof Error ? err.message : 'Failed to read the rail selection.', 'RAIL_SELECTION_READ_FAILED', 500);
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
    if (!railActorCan(l.actor, 'rail.selection.pin')) {
      return NextResponse.json({
        success: false, code: 'CAPABILITY_NOT_HELD',
        error: 'Pinning the rail closes a release requirement and requires admin-or-above in this project\'s organization.',
        accessBasis: l.actor.accessBasis, orgRole: l.actor.orgRole,
      }, { status: 403 });
    }

    const body = await req.json().catch(() => ({})) as {
      railSystemId?: string; basis?: string;
      spanOverride?: { reason?: string; authority?: string } | null;
    };
    if (!body.railSystemId) return bad('railSystemId is required.', 'RAIL_SYSTEM_ID_REQUIRED', 400);

    const outcome = planRailPin({
      verdict: l.verdict,
      mountingSystemId: l.mountingSystemId,
      railSystemId: body.railSystemId,
      actor: { id: l.user.id, kind: 'user' },
      atIso: new Date().toISOString(),
      basis: body.basis ?? '',
      spanOverride: body.spanOverride?.authority?.trim()
        ? { reason: body.spanOverride.reason ?? '', authority: body.spanOverride.authority }
        : null,
      current: l.current,
    });
    if (!outcome.ok || !outcome.next) {
      // 422, not 400: the request was well-formed and the DOMAIN refused it.
      return NextResponse.json({ success: false, code: 'RAIL_PIN_REFUSED', refusals: outcome.refusals }, { status: 422 });
    }

    const wrote = await upsertSelectedEquipment(id, l.user.id, railSelectionPatch(outcome.next));
    if (!wrote) return bad('The rail selection could not be persisted.', 'RAIL_PIN_NOT_PERSISTED', 500);

    return NextResponse.json({ success: true, pinned: outcome.next.active, superseded: outcome.next.superseded });
  } catch (err: unknown) {
    return bad(err instanceof Error ? err.message : 'Failed to pin the rail.', 'RAIL_PIN_FAILED', 500);
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
    if (!railActorCan(l.actor, 'rail.selection.unpin')) {
      return NextResponse.json({
        success: false, code: 'CAPABILITY_NOT_HELD',
        error: 'Retiring the rail selection requires admin-or-above in this project\'s organization.',
        accessBasis: l.actor.accessBasis, orgRole: l.actor.orgRole,
      }, { status: 403 });
    }
    const reason = new URL(req.url).searchParams.get('reason') ?? '';
    const outcome = planRailUnpin({
      current: l.current,
      actor: { id: l.user.id, kind: 'user' },
      atIso: new Date().toISOString(),
      reason,
    });
    if (!outcome.ok || !outcome.next) {
      return NextResponse.json({ success: false, code: 'RAIL_UNPIN_REFUSED', refusals: outcome.refusals }, { status: 422 });
    }
    const wrote = await upsertSelectedEquipment(id, l.user.id, railSelectionPatch(outcome.next));
    if (!wrote) return bad('The retirement could not be persisted.', 'RAIL_UNPIN_NOT_PERSISTED', 500);
    return NextResponse.json({ success: true, superseded: outcome.next.superseded });
  } catch (err: unknown) {
    return bad(err instanceof Error ? err.message : 'Failed to retire the rail selection.', 'RAIL_UNPIN_FAILED', 500);
  }
}
