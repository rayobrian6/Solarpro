/**
 * POST /api/admin/prospects/work/dossier
 * The Reading Room button. Delegates to the shared engine (dossierBatch).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { dossierBatch } from "@/lib/network/prospectWork";

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  try {
    const r = await dossierBatch(apiKey, 6);
    return NextResponse.json({ success: true, ...r, ...(r.processed === 0 ? { note: "Every qualified lead already has a dossier" } : {}) });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Dossier job failed", message: (e as Error).message }, { status: 500 });
  }
}
