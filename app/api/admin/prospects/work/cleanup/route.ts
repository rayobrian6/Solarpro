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
import { rateLimitGuard } from '@/lib/rateLimitGuard';

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
  const rlGuard = await rateLimitGuard(req, 'admin');
  if (rlGuard.blocked) return rlGuard.response;

  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  try {
    // Bulk cleanup via SQL — normalizes phone format and website scheme in two UPDATEs
    // instead of N+1 individual round-trips. Far more efficient at scale.
    const { getDbReady } = await import("@/lib/db-neon");
    const sql = await getDbReady();

    // Fix phones: raw digits of length 10 or 11 (leading 1) → (XXX) XXX-XXXX
    const phoneRows = await sql`
      UPDATE installer_prospects
      SET phone = '(' || SUBSTRING(REGEXP_REPLACE(phone, '\D', '', 'g'), 1, 3) || ') '
                   || SUBSTRING(REGEXP_REPLACE(phone, '\D', '', 'g'), 4, 3) || '-'
                   || SUBSTRING(REGEXP_REPLACE(phone, '\D', '', 'g'), 7, 4),
          updated_at = NOW()
      WHERE phone IS NOT NULL
        AND LENGTH(REGEXP_REPLACE(phone, '\D', '', 'g')) IN (10, 11)
        AND phone !~ '\(\d{3}\) \d{3}-\d{4}'
      RETURNING id
    `;

    // Fix websites: missing https:// prefix
    const siteRows = await sql`
      UPDATE installer_prospects
      SET website = 'https://' || website, updated_at = NOW()
      WHERE website IS NOT NULL
        AND website !~ '^https?://'
        AND LENGTH(TRIM(website)) > 0
      RETURNING id
    `;

    const scanned = await sql`SELECT COUNT(*)::int AS n FROM installer_prospects`;
    const fixed = phoneRows.length + siteRows.length;
    return NextResponse.json({ success: true, scanned: (scanned[0] as { n: number }).n, fixed });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Cleanup failed", message: (e as Error).message }, { status: 500 });
  }
}
