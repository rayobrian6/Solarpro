/**
 * POST /api/admin/prospects/work/enrich   body: { limit?: number }
 * The Copying Room button. Delegates to the shared engine (enrichBatch).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { enrichBatch } from "@/lib/network/prospectWork";
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export async function POST(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'admin');
  if (rlGuard.blocked) return rlGuard.response;

  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  let limit = 5;
  try { limit = Math.min(Math.max(((await req.json()) as { limit?: number }).limit ?? 5, 1), 8); } catch { /* */ }
  try {
    const r = await enrichBatch(apiKey, limit);
    return NextResponse.json({ success: true, ...r, ...(r.processed === 0 ? { note: "No raw leads need enriching" } : {}) });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Enrichment failed", message: (e as Error).message }, { status: 500 });
  }
}
