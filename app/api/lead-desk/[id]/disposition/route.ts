/**
 * POST /api/lead-desk/[id]/disposition   body: { action, note? }
 *
 * Records a sales call outcome on a lead. Maps the outcome to a pipeline stage so
 * the floor's downstream rooms light up: contacted (Post Room), signed_up
 * (Counting House), rejected (Catacombs). Usable by admins and the sales rep.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireDeskApi } from "@/lib/leadDeskAuth";
import { recordDisposition, type ProspectStage } from "@/lib/network/installerProspects";
import { rateLimitGuard } from '@/lib/rateLimitGuard';

const ACTION_STAGE: Record<string, ProspectStage> = {
  called: "contacted",
  interested: "contacted",
  callback: "contacted",
  not_interested: "rejected",
  sold: "signed_up",
};

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const rlGuard = await rateLimitGuard(req, 'standard');
  if (rlGuard.blocked) return rlGuard.response;

  const user = await requireDeskApi(req);
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await req.json()) as { action?: string; note?: string };
    const action = body.action || "";
    const stage = ACTION_STAGE[action];
    if (!stage) return NextResponse.json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });

    const ok = await recordDisposition(
      params.id,
      { at: new Date().toISOString(), by: user.name, action, note: body.note?.trim() || null },
      stage,
    );
    if (!ok) return NextResponse.json({ success: false, error: "Lead not found" }, { status: 404 });
    return NextResponse.json({ success: true, stage });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Disposition failed", message: (e as Error).message }, { status: 500 });
  }
}
