/**
 * POST /api/admin/prospects/pipeline/tick
 *
 * The automatic heartbeat — runs ONLY the FREE deterministic work (vetting),
 * so it can tick forever at $0. The paid AI jobs (scout, enrich, dossier) are
 * deliberate, user-triggered actions, never auto-fired. This is the cost-safe
 * auto-pipeline: enriched leads flow to qualified on their own, no spend.
 *
 * Auth: admin session, OR a scheduler via `authorization: Bearer ${CRON_SECRET}`
 * / `x-pipeline-key: ${PROSPECT_INGEST_KEY}`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { qualifyAll } from "@/lib/network/prospectWork";

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  const cronOk = !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  const keyOk = !!process.env.PROSPECT_INGEST_KEY && req.headers.get("x-pipeline-key") === process.env.PROSPECT_INGEST_KEY;
  if (!admin && !cronOk && !keyOk) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const vetted = await qualifyAll(); // free, deterministic — no LLM
    return NextResponse.json({
      success: true,
      qualified: vetted.qualified,
      rejected: vetted.rejected,
      moved: vetted.qualified + vetted.rejected,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Tick failed", message: (e as Error).message }, { status: 500 });
  }
}
