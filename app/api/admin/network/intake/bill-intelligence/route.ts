export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { ingestUtilityBillIntelligence } from "@/lib/intake/utilityBillIntelligence";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const requestBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const eventId =
    typeof requestBody.event_id === "string" ? requestBody.event_id.trim() : "";

  if (!eventId) {
    return NextResponse.json(
      { success: false, error: "event_id is required" },
      { status: 400 },
    );
  }

  const result = await ingestUtilityBillIntelligence({
    eventId,
    trigger: "operator_review",
  });

  if (!result.ok) {
    const reason = "reason" in result ? result.reason : "ingest_failed";
    const status = reason === "intake_not_found" ? 404 : 422;
    return NextResponse.json(
      {
        success: false,
        status: "skipped",
        reason,
      },
      { status },
    );
  }

  return NextResponse.json({
    success: true,
    status: "completed",
    projected: result.projected,
    opportunity_id: result.opportunity_id,
    intelligence: result.intelligence,
    parser_result: result.parser_result,
  });
}
