/**
 * Admin endpoint for the contractor-acquisition floor.
 *
 *   GET  /api/admin/prospects            → { stats, prospects }  (admin session)
 *   POST /api/admin/prospects            → batch upsert (the robots write here)
 *
 * The POST accepts EITHER an admin session cookie OR an `x-ingest-key` header
 * matching env PROSPECT_INGEST_KEY — so the acquisition robots / a future
 * durable pipeline can push discoveries without a browser session.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import {
  upsertProspects,
  listProspects,
  getProspectStats,
  type InstallerProspectInput,
  type ProspectStage,
} from "@/lib/network/installerProspects";

function ingestKeyOk(req: NextRequest): boolean {
  const expected = process.env.PROSPECT_INGEST_KEY;
  if (!expected) return false;
  return req.headers.get("x-ingest-key") === expected;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const state = searchParams.get("state") || undefined;
    const stage = (searchParams.get("stage") as ProspectStage) || undefined;
    const search = searchParams.get("q") || undefined;

    const [stats, prospects] = await Promise.all([
      getProspectStats(),
      listProspects({ state, stage, search, limit: 500 }),
    ]);

    return NextResponse.json({ success: true, stats, prospects });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "List failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin && !ingestKeyOk(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      prospects?: InstallerProspectInput[];
    };
    const prospects = Array.isArray(body.prospects) ? body.prospects : [];
    if (prospects.length === 0) {
      return NextResponse.json(
        { success: false, error: "No prospects in payload" },
        { status: 400 },
      );
    }
    if (prospects.length > 1000) {
      return NextResponse.json(
        { success: false, error: "Max 1000 prospects per request" },
        { status: 400 },
      );
    }

    const result = await upsertProspects(prospects);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "Ingest failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
