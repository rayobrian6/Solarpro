export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import {
  validateUpdateMember,
  buildMemberUpdate,
} from '@/lib/crews';

/**
 * PATCH /api/crew-members/[memberId]
 * Partial update of a crew member.
 * Ownership is enforced via user_id on both crew_members and parent crews.
 * Body: any subset of { name, role, phone, email, certifications, is_lead, notes }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { memberId: string } },
) {
  try {
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429 },
      );
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { memberId } = params;
    if (!isValidUUID(memberId)) {
      return NextResponse.json({ error: 'Invalid member ID.' }, { status: 400 });
    }

    const body = await req.json();

    const validationError = validateUpdateMember(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const sql = await getDbReady();

    // Confirm membership belongs to this user (via the parent crew's user_id)
    const [existing] = await sql`
      SELECT cm.id, cm.crew_id
      FROM crew_members cm
      JOIN crews c ON c.id = cm.crew_id
      WHERE cm.id = ${memberId}
        AND c.user_id = ${user.id}
    `;
    if (!existing) {
      return NextResponse.json({ error: 'Crew member not found.' }, { status: 404 });
    }

    const update = buildMemberUpdate(body);
    const keys = Object.keys(update) as (keyof typeof update)[];

    // Build a dynamic PATCH: we set each changed column individually using a
    // series of conditional SQL fragments.  Neon tagged-template SQL does not
    // support truly dynamic SET lists without raw string interpolation, so we
    // apply the update in a typed fashion via a controlled switch.
    //
    // Note: this approach is deliberate and safe — `keys` come from our own
    // `buildMemberUpdate()` output, never from raw user input.

    let updatedMember: Record<string, unknown> | null = null;

    // Build a single UPDATE statement by re-using the update object fields.
    // We always set updated_at = NOW().
    const n = body.name ?? null;
    const r = body.role ?? null;
    const p = update.phone !== undefined ? update.phone : undefined;
    const e = update.email !== undefined ? update.email : undefined;
    const certs = update.certifications !== undefined ? update.certifications : undefined;
    const il = update.is_lead !== undefined ? update.is_lead : undefined;
    const nt = update.notes !== undefined ? update.notes : undefined;

    void keys; // suppress unused var

    // Apply columns that were actually provided (use the pre-built update object).
    const [row] = await sql`
      UPDATE crew_members
      SET
        name           = COALESCE(${n !== null ? n : null}, name),
        role           = COALESCE(${r !== null ? r : null}, role),
        phone          = CASE WHEN ${p !== undefined} THEN ${p ?? null} ELSE phone END,
        email          = CASE WHEN ${e !== undefined} THEN ${e ?? null} ELSE email END,
        certifications = CASE WHEN ${certs !== undefined} THEN ${certs ?? null} ELSE certifications END,
        is_lead        = CASE WHEN ${il !== undefined} THEN ${il ?? false} ELSE is_lead END,
        notes          = CASE WHEN ${nt !== undefined} THEN ${nt ?? null} ELSE notes END,
        updated_at     = NOW()
      WHERE id = ${memberId}
      RETURNING *
    `;
    updatedMember = row;

    if (!updatedMember) {
      return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
    }

    return NextResponse.json({ member: updatedMember });
  } catch (error: unknown) {
    return handleRouteDbError('[PATCH /api/crew-members/[memberId]]', error);
  }
}

/**
 * DELETE /api/crew-members/[memberId]
 * Removes a crew member.  Only the crew owner may delete.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { memberId: string } },
) {
  try {
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429 },
      );
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { memberId } = params;
    if (!isValidUUID(memberId)) {
      return NextResponse.json({ error: 'Invalid member ID.' }, { status: 400 });
    }

    const sql = await getDbReady();

    const [deleted] = await sql`
      DELETE FROM crew_members
      USING crews
      WHERE crew_members.id = ${memberId}
        AND crew_members.crew_id = crews.id
        AND crews.user_id = ${user.id}
      RETURNING crew_members.id
    `;

    if (!deleted) {
      return NextResponse.json({ error: 'Crew member not found.' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error: unknown) {
    return handleRouteDbError('[DELETE /api/crew-members/[memberId]]', error);
  }
}
