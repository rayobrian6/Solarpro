/**
 * POST /api/admin/prospects/[id]/convert
 *
 * The Counting House's job: graduate a prospect into a REAL contractor account.
 * Creates (or upgrades) a `users` row with plan='contractor' on a trial, then
 * marks the prospect signed_up + links converted_user_id. This is the bridge from
 * the supply-side prospect pool into a paying-capable platform account.
 *
 * Requires an email (users.email is UNIQUE NOT NULL). Idempotent on email.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDbReady } from "@/lib/db-neon";
import { requireAdminApi } from "@/lib/adminAuth";

// Placeholder hash — same convention as the migration-006 free-pass seeds; the
// contractor sets a real password on first login / via reset.
const PLACEHOLDER_HASH = "$2a$12$placeholder_hash_change_on_first_login";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT id, company_name, email, phone, stage, converted_user_id
      FROM installer_prospects WHERE id = ${params.id} LIMIT 1
    `;
    if (rows.length === 0) return NextResponse.json({ success: false, error: "Prospect not found" }, { status: 404 });
    const p = rows[0] as { company_name: string; email: string | null; phone: string | null };

    if (!p.email) {
      return NextResponse.json({ success: false, error: "This prospect has no email — enrich it first so they can be onboarded." }, { status: 400 });
    }

    const userRows = await sql`
      INSERT INTO users (name, email, password_hash, company, phone, role, plan, subscription_status)
      VALUES (${p.company_name}, ${p.email}, ${PLACEHOLDER_HASH}, ${p.company_name}, ${p.phone}, 'user', 'contractor', 'trialing')
      ON CONFLICT (email) DO UPDATE SET plan = 'contractor', updated_at = NOW()
      RETURNING id
    `;
    const userId = (userRows[0] as { id: string }).id;

    await sql`
      UPDATE installer_prospects
      SET stage = 'signed_up', converted_user_id = ${userId}, updated_at = NOW()
      WHERE id = ${params.id}
    `;

    return NextResponse.json({ success: true, userId, company: p.company_name });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Conversion failed", message: (e as Error).message }, { status: 500 });
  }
}
