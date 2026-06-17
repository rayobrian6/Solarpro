export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { validateUpdateMember, buildMemberUpdate } from '@/lib/crews';

type Params = { id: string; memberId: string };

/**
 * DELETE /api/crews/[id]/members/[memberId]
 * Removes a member from a crew. Ownership is verified via crew.user_id.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Params },
) {
  try {
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id: crewId, memberId } = params;

    if (!isValidUUID(crewId))   return NextResponse.json({ error: 'Invalid crew ID.'   }, { status: 400 });
    if (!isValidUUID(memberId)) return NextResponse.json({ error: 'Invalid member ID.' }, { status: 400 });

    const sql = await getDbReady();

    // Verify crew ownership before touching any member rows
    const [crew] = await sql`
      SELECT id FROM crews WHERE id = ${crewId} AND user_id = ${user.id}
    `;
    if (!crew) return NextResponse.json({ error: 'Crew not found.' }, { status: 404 });

    const [deleted] = await sql`
      DELETE FROM crew_members
      WHERE id = ${memberId} AND crew_id = ${crewId}
      RETURNING id
    `;
    if (!deleted) return NextResponse.json({ error: 'Member not found.' }, { status: 404 });

    return NextResponse.json({ deleted: true });
  } catch (error: unknown) {
    return handleRouteDbError('[DELETE /api/crews/[id]/members/[memberId]]', error);
  }
}

/**
 * PATCH /api/crews/[id]/members/[memberId]
 * Partial update for a crew member. All fields optional; at least one required.
 * Body: UpdateCrewMemberBody (name?, role?, phone?, email?, certifications?, is_lead?, notes?)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Params },
) {
  try {
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id: crewId, memberId } = params;

    if (!isValidUUID(crewId))   return NextResponse.json({ error: 'Invalid crew ID.'   }, { status: 400 });
    if (!isValidUUID(memberId)) return NextResponse.json({ error: 'Invalid member ID.' }, { status: 400 });

    const body = await req.json();

    const validationError = validateUpdateMember(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify crew ownership
    const [crew] = await sql`
      SELECT id FROM crews WHERE id = ${crewId} AND user_id = ${user.id}
    `;
    if (!crew) return NextResponse.json({ error: 'Crew not found.' }, { status: 404 });

    const updates = buildMemberUpdate(body);
    const keys = Object.keys(updates) as Array<keyof typeof updates>;

    if (keys.length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided.' }, { status: 400 });
    }

    // Build dynamic SET clause safely — use individual named params
    // We use a series of CASE statements to only update provided fields.
    const [member] = await sql`
      UPDATE crew_members SET
        name             = CASE WHEN ${updates.name         !== undefined}::bool THEN ${updates.name         ?? null} ELSE name             END,
        role             = CASE WHEN ${updates.role         !== undefined}::bool THEN ${updates.role         ?? null} ELSE role             END,
        member_type      = CASE WHEN ${updates.member_type  !== undefined}::bool THEN ${updates.member_type  ?? 'employee'} ELSE member_type END,
        company          = CASE WHEN ${updates.company      !== undefined}::bool THEN ${updates.company      ?? null} ELSE company          END,
        trade            = CASE WHEN ${updates.trade        !== undefined}::bool THEN ${updates.trade        ?? null} ELSE trade            END,
        phone            = CASE WHEN ${updates.phone        !== undefined}::bool THEN ${updates.phone        ?? null} ELSE phone            END,
        email            = CASE WHEN ${updates.email        !== undefined}::bool THEN ${updates.email        ?? null} ELSE email            END,
        certifications   = CASE WHEN ${updates.certifications !== undefined}::bool THEN ${updates.certifications ?? null} ELSE certifications END,
        is_lead          = CASE WHEN ${updates.is_lead      !== undefined}::bool THEN ${updates.is_lead      ?? false} ELSE is_lead         END,
        notes            = CASE WHEN ${updates.notes        !== undefined}::bool THEN ${updates.notes        ?? null} ELSE notes            END,
        updated_at       = NOW()
      WHERE id = ${memberId} AND crew_id = ${crewId}
      RETURNING *
    `;

    if (!member) return NextResponse.json({ error: 'Member not found.' }, { status: 404 });

    return NextResponse.json({ member });
  } catch (error: unknown) {
    return handleRouteDbError('[PATCH /api/crews/[id]/members/[memberId]]', error);
  }
}
