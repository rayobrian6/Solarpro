/**
 * POST /api/admin/prospects/work/qualify
 *
 * The Assay Room's real work. Scores every `enriched` prospect on contactability +
 * credibility (license, rating, reviews, completeness), promotes the worthy to
 * `qualified`, and bins the uncontactable to `rejected`. Deterministic — no LLM,
 * no cost, instant. Returns how many were vetted.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { listProspects, applyWorkUpdate, scoreRow } from "@/lib/network/installerProspects";

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  try {
    const batch = await listProspects({ stage: "enriched", limit: 400 });
    let qualified = 0;
    let rejected = 0;

    for (const p of batch) {
      const score = scoreRow(p);
      const contactable = !!(p.phone || p.email);
      const findable = contactable || !!p.website;
      if (!findable) {
        await applyWorkUpdate(p.id, { stage: "rejected", qualityScore: score, notes: "Auto-vet: no contact details found" });
        rejected++;
      } else {
        await applyWorkUpdate(p.id, { stage: "qualified", qualityScore: score });
        qualified++;
      }
    }

    return NextResponse.json({ success: true, processed: batch.length, qualified, rejected });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Vetting failed", message: (e as Error).message }, { status: 500 });
  }
}
