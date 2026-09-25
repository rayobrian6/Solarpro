export const maxDuration = 15;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getDbReady, handleRouteDbError, isValidUUID } from "@/lib/db-neon";
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/network/opportunities/[id]/contact
 *
 * THE FIRST WRITER OF AN OUTCOME COLUMN IN THE NETWORK MARKETPLACE.
 *
 * 🚨 WHY THIS EXISTS. `opportunity_assignments` was designed with a full
 * outcome model — `first_contact_at`, `last_contact_at`, `contact_attempts`,
 * `proposal_at`, `close_status`, `lost_reason`, `dispute_filed_at` — and
 * migration 051 documents each one. **Not one of them had a writer anywhere in
 * app/ or lib/.** Every mutation on that table uses a static column list, and
 * none of the six contractor-facing Network mutations records an outcome. The
 * columns were only ever SELECTed.
 *
 * Everything downstream inherited that emptiness: the contractor_performance
 * producer computed response speed from a column that is always null, and
 * `contractor_profiles.avg_response_hours` — which the matching engine scores
 * a contractor on — has no source to be rolled up from.
 *
 * This closes the smallest honest link in that chain. When a contractor taps
 * the homeowner's phone number or email on a claimed lead, that is a real,
 * observable, unambiguous first contact, and it is the exact event
 * `first_contact_at` was defined to record: migration 044 describes
 * `avg_response_hours` as "avg hours from claim to first contact".
 *
 * 🚨 FIRST MEANS FIRST. The write is `COALESCE(first_contact_at, NOW())`, so a
 * second tap cannot move it. Overwriting on every click would quietly turn
 * "time to first contact" into "time to most recent contact" — a different
 * metric wearing the same name, and one that improves every time a contractor
 * chases a lead that is going badly.
 *
 * What this deliberately does NOT do: advance `status` to 'contacted'. That
 * value exists in the enum, but moving a claim through its lifecycle is a
 * product decision about what the stage means and who may reverse it, not a
 * side effect of tapping a phone number.
 */
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkRateLimit("standard", getClientIp(req));
  if (!rl.allowed)
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const { id } = params;
  if (!isValidUUID(id))
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  let channel = "unknown";
  try {
    const body = await req.json().catch(() => ({}));
    const raw = String((body as Record<string, unknown>)?.channel ?? "");
    if (raw === "phone" || raw === "email") channel = raw;
  } catch {
    /* body is optional — the timestamp is the point, not the channel */
  }

  try {
    const sql = await getDbReady();

    // 🚨 SCOPED TO THE CALLER'S OWN CLAIM, IN THE WHERE CLAUSE.
    //
    // A contractor may only stamp contact on an assignment they hold. Doing it
    // here rather than with a separate ownership SELECT means there is no
    // window between the check and the write, and a caller who does not hold
    // the claim updates zero rows rather than being told whose it is.
    const updated = await sql`
      UPDATE opportunity_assignments
         SET first_contact_at = COALESCE(first_contact_at, NOW()),
             last_contact_at  = NOW(),
             contact_attempts = COALESCE(contact_attempts, 0) + 1,
             updated_at       = NOW()
       WHERE opportunity_id = ${id}
         AND contractor_id  = ${user.id}
         AND status IN ('claimed','contacted','appointment','proposal','won')
      RETURNING first_contact_at, last_contact_at, contact_attempts
    `;

    if (!updated.length) {
      // Not an error worth shouting about: the contractor may have tapped a
      // number on a lead they have not claimed, or one already released.
      return NextResponse.json(
        { success: false, error: "No claimed assignment for this opportunity" },
        { status: 404 },
      );
    }

    const row = updated[0] as Record<string, unknown>;
    return NextResponse.json({
      success: true,
      channel,
      first_contact_at: row.first_contact_at,
      last_contact_at: row.last_contact_at,
      contact_attempts: row.contact_attempts,
    });
  } catch (error) {
    return handleRouteDbError(error, "POST /api/network/opportunities/[id]/contact");
  }
}
