/**
 * PATCH /api/admin/prospects/[id]
 * Advance a prospect through the pipeline (stage), add notes, or fix contact
 * fields from the floor. Admin session required.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { rateLimitGuard } from '@/lib/rateLimitGuard';
import {
  updateProspect,
  PROSPECT_STAGES,
  type UpdateProspectPatch,
  type ProspectStage,
} from "@/lib/network/installerProspects";

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as UpdateProspectPatch;
    if (body.stage && !PROSPECT_STAGES.includes(body.stage as ProspectStage)) {
      return NextResponse.json(
        { success: false, error: `Invalid stage: ${body.stage}` },
        { status: 400 },
      );
    }

    const updated = await updateProspect(params.id, {
      stage: body.stage,
      notes: body.notes,
      email: body.email,
      phone: body.phone,
      contactName: body.contactName,
    });
    if (!updated) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, prospect: updated });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "Update failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
