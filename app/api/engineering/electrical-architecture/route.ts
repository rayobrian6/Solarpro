export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 20;

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE ARCHITECTURE RESOLUTION ENDPOINT — one explicit decision, persisted once.
//
// GET  reports whether this project needs a decision, what the two answers are, and WHERE the
//      conflicting equipment came from. Everything the dialog needs, from the canonical model.
// POST records the answer.
//
// Ray: "After Ray resolves it once, persist the canonical architecture and provenance permanently."
//
// THE ROUTE DECIDES NOTHING. `planArchitectureResolution` is pure and tested; this handler
// authenticates, loads the canonical model through the ONE load path, calls the planner, and writes
// exactly the two patches it returned. A rule in a handler is a rule the next handler forgets.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { loadElectricalProject } from '@/lib/electrical/loadElectricalProject';
import { planArchitectureResolution } from '@/lib/electrical/architectureResolution';
import { readServiceTopology, writeServiceTopology } from '@/lib/db/serviceTopology';
import { upsertSelectedEquipment, getProjectById } from '@/lib/db/projects';
import { readProjectEquipmentStores } from '@/lib/reconciliation/reconcile';
import type { SolarCoupling } from '@/lib/electrical/serviceTopology';

const COUPLINGS: SolarCoupling[] = ['dc-coupled-storage', 'ac-coupled-inverter', 'storage-only'];

export async function GET(req: NextRequest) {
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get('projectId') ?? '';
  if (!isValidUUID(projectId)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID.' }, { status: 400 });
  }
  const loaded = await loadElectricalProject(projectId, user.id);
  if (!loaded) return NextResponse.json({ success: false, error: 'Project not found.' }, { status: 404 });

  const m = loaded.model;
  return NextResponse.json({
    success: true,
    resolutionRequired: m.architectureResolutionRequired,
    coupling: m.solarCoupling,
    couplingLabel: m.solarCouplingLabel,
    couplingProvenance: m.solarCouplingProvenance,
    choices: m.architectureChoices,
    // 🚨 THE CONFLICT IN THE OPERATOR'S WORDS, from the model — so the dialog cannot word it
    // differently from the sheet, the log or the inspector.
    conflicts: m.conflicts,
    externalInverter: m.hasExternalInverter
      ? { id: m.externalInverterId, origin: m.externalInverterOrigin }
      : null,
    revision: loaded.revision,
  });
}

export async function POST(req: NextRequest) {
  try {
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });

    const body = await req.json().catch(() => ({})) as { projectId?: string; coupling?: string };
    const projectId = String(body.projectId ?? '');
    if (!isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID.' }, { status: 400 });
    }
    const coupling = String(body.coupling ?? '') as SolarCoupling;
    if (!COUPLINGS.includes(coupling)) {
      return NextResponse.json({
        success: false, error: `coupling must be one of: ${COUPLINGS.join(', ')}`,
      }, { status: 400 });
    }
    // Ownership: the loader scopes by user_id, but a 404 from a missing project and a 404 from
    // someone else's project must read the same to the caller.
    const project = await getProjectById(projectId, user.id);
    if (!project) return NextResponse.json({ success: false, error: 'Project not found.' }, { status: 404 });

    const loaded = await loadElectricalProject(projectId, user.id);
    if (!loaded) return NextResponse.json({ success: false, error: 'Project not found.' }, { status: 404 });

    const planned = planArchitectureResolution(loaded.model, coupling, new Date());
    if (planned.ok === false) {
      return NextResponse.json({
        success: false, error: planned.message, refusal: planned.refusal,
      }, { status: 409 });
    }
    const { plan } = planned;

    // ── 1. RECORD THE COUPLING ON THE GRAPH ──────────────────────────────────
    //
    // Re-read rather than writing the loaded copy: between the load and here the row may have moved,
    // and the coupling is the only field this endpoint is entitled to set.
    //
    // 🚨 'as-issued' — THE UN-HYDRATED BYTES. The default read re-resolves manufacturer facts from
    // today's catalogue, so writing that copy back would bake the current 60 A OCPD and today's PV
    // input limits into a row that was authored at 50 A. The correction must keep reaching the
    // project through the READ, every time, and never by being frozen into the row — otherwise the
    // next catalogue change cannot reach it either, and the as-issued trace is gone for good.
    const stored = await readServiceTopology(projectId, user.id, 'as-issued');
    if (!stored) {
      return NextResponse.json({
        success: false,
        error: 'This project has no service topology, so there is no architecture to record. Build '
          + 'the service topology first.',
      }, { status: 409 });
    }
    const wrote = await writeServiceTopology(projectId, user.id, {
      ...stored.topology, solarCoupling: plan.coupling,
    });
    if (!wrote) {
      return NextResponse.json({ success: false, error: 'Could not record the architecture.' }, { status: 500 });
    }

    // ── 2. RETIRE OR CONFIRM THE EQUIPMENT ───────────────────────────────────
    //
    // 🚨 THE RETIRED RECORD CARRIES THE STORED OBJECT, read here because the planner is pure and the
    // row is the only place the full equipment object lives. Ray: "old history remains traceable" —
    // an id alone would not let anyone see WHAT was retired.
    const stores = await readProjectEquipmentStores(projectId);
    const se = stores?.selectedEquipment ?? null;
    const patch = { ...plan.equipmentPatch };
    if (patch.retiredInverter && typeof patch.retiredInverter === 'object') {
      const invRecord = se && typeof se.inverter === 'object' ? se.inverter : null;
      patch.retiredInverter = {
        ...(patch.retiredInverter as Record<string, unknown>),
        record: (invRecord as Record<string, unknown> | null) ?? null,
      };
      // Merge rather than replace: a project may already hold an earlier retirement, and losing it
      // would be exactly the destroyed history this slot exists to keep.
      const priorRetired = se && Array.isArray(se.retiredInverterHistory)
        ? se.retiredInverterHistory as unknown[] : [];
      patch.retiredInverterHistory = [...priorRetired, patch.retiredInverter];
    }
    // The provenance block merges shallowly, so carry forward the slots this decision does not set.
    const priorProv = se && typeof se.provenance === 'object' && se.provenance
      ? se.provenance as Record<string, unknown> : {};
    patch.provenance = { ...priorProv, ...(patch.provenance as Record<string, unknown>) };

    await upsertSelectedEquipment(projectId, user.id, patch);

    const after = await loadElectricalProject(projectId, user.id);
    console.log(`[electrical] ${plan.summary} (project ${projectId})`);

    return NextResponse.json({
      success: true,
      summary: plan.summary,
      coupling: plan.coupling,
      retiredExternalInverter: plan.retiredExternalInverter,
      // 🚨 THE STATE AFTER THE WRITE, read back through the SAME load path — so the caller does not
      // have to trust that the write did what the plan said.
      resolutionRequired: after?.model.architectureResolutionRequired ?? null,
      couplingAfter: after?.model.solarCoupling ?? null,
      revision: after?.revision ?? null,
    });
  } catch (err: unknown) {
    console.error('[electrical-architecture] POST failed:', (err as Error)?.message);
    return NextResponse.json({ success: false, error: 'Could not record the architecture.' }, { status: 500 });
  }
}
