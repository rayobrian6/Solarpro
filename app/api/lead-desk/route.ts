/**
 * GET /api/lead-desk?view=active|won|dead
 *
 * The sales rep's call list. Default returns the active board: qualified leads to
 * call + contacted leads in progress, best-first. Usable by admins and sales reps.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireDeskApi } from "@/lib/leadDeskAuth";
import { listProspects, getProspectStats } from "@/lib/network/installerProspects";

export async function GET(req: NextRequest) {
  const user = await requireDeskApi(req);
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  try {
    const view = new URL(req.url).searchParams.get("view") || "active";
    let leads;
    if (view === "won") leads = await listProspects({ stage: "signed_up", limit: 500 });
    else if (view === "dead") leads = await listProspects({ stage: "rejected", limit: 500 });
    else {
      const [qualified, contacted] = await Promise.all([
        listProspects({ stage: "qualified", limit: 500 }),
        listProspects({ stage: "contacted", limit: 500 }),
      ]);
      // contacted (in progress) first, then fresh qualified — both best-first
      leads = [...contacted, ...qualified];
    }
    const stats = await getProspectStats();
    return NextResponse.json({ success: true, leads, stats, you: { name: user.name, role: user.role } });
  } catch (e) {
    return NextResponse.json({ success: false, error: "List failed", message: (e as Error).message }, { status: 500 });
  }
}
