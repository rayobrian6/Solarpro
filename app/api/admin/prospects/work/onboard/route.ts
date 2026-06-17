/**
 * POST /api/admin/prospects/work/onboard
 *
 * The Counting House's batch job: grabs the highest-quality `qualified` prospect
 * that has an email and onboards it into a real contractor `users` row (trial),
 * marking it signed_up. One lead per click — onboarding creates an account, so it
 * stays deliberate. Returns who was onboarded.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDbReady } from "@/lib/db-neon";
import { requireAdminApi } from "@/lib/adminAuth";

const PLACEHOLDER_HASH = "$2a$12$placeholder_hash_change_on_first_login";

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT id, company_name, email, phone
      FROM installer_prospects
      WHERE stage = 'qualified' AND email IS NOT NULL
      ORDER BY quality_score DESC NULLS LAST
      LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ success: true, onboarded: 0, note: "No qualified lead with an email to onboard" });
    }
    const p = rows[0] as { id: string; company_name: string; email: string; phone: string | null };

    const userRows = await sql`
      INSERT INTO users (name, email, password_hash, company, phone, role, plan, subscription_status)
      VALUES (${p.company_name}, ${p.email}, ${PLACEHOLDER_HASH}, ${p.company_name}, ${p.phone}, 'user', 'contractor', 'trialing')
      ON CONFLICT (email) DO UPDATE SET plan = 'contractor', updated_at = NOW()
      RETURNING id
    `;
    const userId = (userRows[0] as { id: string }).id;

    await sql`
      UPDATE installer_prospects SET stage = 'signed_up', converted_user_id = ${userId}, updated_at = NOW()
      WHERE id = ${p.id}
    `;

    return NextResponse.json({ success: true, onboarded: 1, company: p.company_name });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Onboard failed", message: (e as Error).message }, { status: 500 });
  }
}
