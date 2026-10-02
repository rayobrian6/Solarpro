// ═══════════════════════════════════════════════════════════════════════════
// GET / PUT /api/projects/[id]/service-topology
//
// The project's service graph, read and written whole.
//
// 🚨 WHOLE, NOT PATCHED. A service topology is a graph whose parts refer to each other — a domain
// names a branch and a panel, an expansion names its host — so a partial update is a way to leave
// it referring to something that is no longer there. The client sends the graph it has; the server
// shape-checks it and stores it. `parseServiceTopology` is the same check the read uses, so a graph
// that could not be read back is never written in the first place.
//
// The GET also returns the ENGINEERING, computed server-side from the stored graph, so a caller
// cannot show a conclusion that disagrees with what was saved.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import {
  readServiceTopology, writeServiceTopology, parseServiceTopology,
} from '@/lib/db/serviceTopology';
import { evaluateServiceTopology } from '@/lib/electrical/serviceTopology';
import { equipmentQuantities } from '@/lib/electrical/topologyEquipment';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID.' }, { status: 400 });
    }
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const stored = await readServiceTopology(id, user.id);
    if (!stored) {
      // Not an error: this project simply has no service topology yet. The UI says so plainly
      // rather than rendering an empty service with zeros in it.
      return NextResponse.json({ success: true, available: false, topology: null });
    }

    const evaluation = evaluateServiceTopology(stored.topology);
    return NextResponse.json({
      success: true,
      available: true,
      schemaVersion: stored.schemaVersion,
      updatedAt: stored.updatedAt,
      topology: stored.topology,
      // Computed here, from the stored graph, so the screen and the store cannot drift.
      evaluation: {
        overall: evaluation.overall,
        checks: evaluation.checks,
        bonding: evaluation.bonding,
        storageSummary: evaluation.storageSummary,
      },
      // The same instance counts the BOM and pricing consume.
      equipmentQuantities: equipmentQuantities(stored.topology),
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/projects/[id]/service-topology]', err);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID.' }, { status: 400 });
    }
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const incoming = (body as { topology?: unknown } | null)?.topology;

    // 🚨 SHAPE-CHECKED BEFORE IT IS STORED, BY THE SAME FUNCTION THE READ USES. A graph that would
    // not survive a reload must not be accepted — otherwise "save succeeded" and "reload lost two
    // MSPs" are both true at once, which is the exact failure this slice exists to stop.
    // 🚨 'as-sent': THE CHECK MUST NOT ALTER WHAT IT IS CHECKING. An 'active' read refreshes
    // manufacturer facts from the catalogue, which is right for loading a project and wrong here —
    // validating a payload and then storing something the caller never submitted is a different act
    // from validating it. The refresh reaches this graph the next time it is LOADED.
    const checked = parseServiceTopology(
      { topology: incoming, schemaVersion: 1, updatedAt: '' }, 'as-sent');
    if (!checked) {
      return NextResponse.json({
        success: false,
        error: 'This is not a usable service topology. A service needs an aggregate rating, and '
          + 'every backup domain needs its gateway.',
      }, { status: 400 });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 🚨 A SUBMITTED COUPLING IS A DECISION, AND IT HAS TO SAY SO.
    //
    // `solarCoupling` lives on the graph, and until now NOTHING recorded who put it there. That made
    // a designer's answer in the wizard byte-identical to the value
    // `persistElectricalCanonicalization` wrote from a derivation — which is how Ray's project came
    // to assert `ac-coupled-inverter` as though he had stated it, and why the model now re-tests a
    // recorded coupling that carries no decision.
    //
    // So the human half of that pair records itself. Written only when the coupling actually ARRIVES
    // or CHANGES: re-saving a topology for an unrelated edit must not manufacture a decision the
    // designer did not make on this request.
    // ═════════════════════════════════════════════════════════════════════════
    const _before = await readServiceTopology(id, user.id, 'as-issued');
    const _couplingChanged =
      !!checked.topology.solarCoupling
      && checked.topology.solarCoupling !== (_before?.topology.solarCoupling ?? null);

    const ok = await writeServiceTopology(id, user.id, checked.topology);
    if (!ok) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    if (_couplingChanged) {
      try {
        const { provenanceRecord } = await import('@/lib/electrical/equipmentProvenance');
        const { readProjectEquipmentStores } = await import('@/lib/reconciliation/reconcile');
        const { upsertSelectedEquipment } = await import('@/lib/db/projects');
        const _stores = await readProjectEquipmentStores(id);
        const _priorProv = _stores?.selectedEquipment
          && typeof _stores.selectedEquipment.provenance === 'object'
          && _stores.selectedEquipment.provenance
            ? _stores.selectedEquipment.provenance as Record<string, unknown>
            : {};
        await upsertSelectedEquipment(id, user.id, {
          provenance: {
            ..._priorProv,
            architecture: provenanceRecord(
              'USER_SELECTED', 'service-topology-wizard',
              `The designer recorded the PV coupling as '${checked.topology.solarCoupling}' in the `
                + 'service topology.',
              new Date(),
            ),
          },
        });
        console.log(`[service-topology] coupling recorded by the designer: `
          + `${checked.topology.solarCoupling} (project ${id})`);
      } catch (e) {
        // Non-fatal: the graph write already succeeded, and a missing provenance record makes the
        // model ASK rather than assume — which is the safe direction for this failure.
        console.warn('[service-topology] could not record architecture provenance (non-fatal):',
          (e as Error)?.message);
      }
    }

    const evaluation = evaluateServiceTopology(checked.topology);
    return NextResponse.json({
      success: true,
      topology: checked.topology,
      evaluation: { overall: evaluation.overall, checks: evaluation.checks },
      equipmentQuantities: equipmentQuantities(checked.topology),
    });
  } catch (err: unknown) {
    return handleRouteDbError('[PUT /api/projects/[id]/service-topology]', err);
  }
}
