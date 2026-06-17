/**
 * POST /api/admin/prospects/work/qualify
 * The Assay Room button. Delegates to the shared engine (qualifyAll).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { qualifyAll } from "@/lib/network/prospectWork";

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const r = await qualifyAll();
    return NextResponse.json({ success: true, ...r });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Vetting failed", message: (e as Error).message }, { status: 500 });
  }
}
