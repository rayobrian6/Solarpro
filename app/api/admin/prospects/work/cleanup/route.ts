/**
 * POST /api/admin/prospects/work/cleanup
 *
 * The Records Room's work. Tidies the ledger so the sales call sheet is clean:
 * normalizes phone numbers to (XXX) XXX-XXXX and ensures websites have an https://
 * scheme. Deterministic, instant, no LLM. Returns how many rows it fixed.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { listProspects, applyWorkUpdate } from "@/lib/network/installerProspects";

function normPhone(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return raw.trim();
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
function normSite(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  try {
    const all = await listProspects({ limit: 1000 });
    let fixed = 0;
    for (const p of all) {
      const phone = normPhone(p.phone);
      const website = normSite(p.website);
      const phoneChanged = phone && phone !== p.phone;
      const siteChanged = website && website !== p.website;
      if (phoneChanged || siteChanged) {
        await applyWorkUpdate(p.id, { phone: phoneChanged ? phone : null, website: siteChanged ? website : null });
        fixed++;
      }
    }
    return NextResponse.json({ success: true, scanned: all.length, fixed });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Cleanup failed", message: (e as Error).message }, { status: 500 });
  }
}
