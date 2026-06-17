/**
 * POST /api/admin/prospects/pipeline/tick
 *
 * One automatic pass of the whole pipeline: enrich a few raw leads, vet every
 * enriched lead, draft dossiers for a few qualified leads. Bounded per tick so
 * cost stays in check; once the backlog drains, ticks become cheap no-ops.
 *
 * Auth: admin session, OR a scheduler via `authorization: Bearer ${CRON_SECRET}`
 * / `x-pipeline-key: ${PROSPECT_INGEST_KEY}`. Lead-prep only — no contact, no accounts.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { enrichBatch, qualifyAll, dossierBatch } from "@/lib/network/prospectWork";

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  const cronOk = !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  const keyOk = !!process.env.PROSPECT_INGEST_KEY && req.headers.get("x-pipeline-key") === process.env.PROSPECT_INGEST_KEY;
  if (!admin && !cronOk && !keyOk) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  try {
    const enriched = apiKey ? await enrichBatch(apiKey, 3) : { processed: 0, enriched: 0 };
    const vetted = await qualifyAll();
    const dossiers = apiKey ? await dossierBatch(apiKey, 4) : { processed: 0, written: 0 };
    return NextResponse.json({
      success: true,
      enriched: enriched.enriched,
      qualified: vetted.qualified,
      rejected: vetted.rejected,
      dossiers: dossiers.written,
      moved: enriched.enriched + vetted.qualified + vetted.rejected + dossiers.written,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Tick failed", message: (e as Error).message }, { status: 500 });
  }
}
