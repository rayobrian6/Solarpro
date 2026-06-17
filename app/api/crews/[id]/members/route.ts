export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import {
  validateCreateMember,
  sanitiseCreateMember,
  CREW_LIMITS,
} from '@/lib/crews';

/**
 * GET /api/crews/[id]/members
 * Returns all members of a crew, ordered by is_lead DESC, name ASC.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id: crewId } = params;
    if (!isValidUUID(crewId)) {
      return NextResponse.json({ error: 'Invalid crew ID.' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify ownership of the crew
    const [crew] = await sql`
      SELECT id, name, color FROM crews
      WHERE id = ${crewId} AND user_id = ${user.id}
    `;
    if (!crew) {
      return NextResponse.json({ error: 'Crew not found.' }, { status: 404 });
    }

    const members = await sql`
      SELECT
        id, crew_id, user_id,
        name, role, member_type, company, trade,
        phone, email, certifications,
        is_lead, notes,
        created_at, updated_at
      FROM crew_members
      WHERE crew_id = ${crewId}
      ORDER BY is_lead DESC, name ASC
    `;

    return NextResponse.json({
      crew: { id: crew.id, name: crew.name, color: crew.color },
      members,
    });
  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/crews/[id]/members]', error);
  }
}

/**
 * POST /api/crews/[id]/members
 * Adds a new member to the crew.
 * Body: { name, role?, phone?, email?, certifications?, is_lead?, notes? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
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

    const { id: crewId } = params;
    if (!isValidUUID(crewId)) {
      return NextResponse.json({ error: 'Invalid crew ID.' }, { status: 400 });
    }

    const body = await req.json();

    // Validate
    const validationError = validateCreateMember(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify crew ownership
    const [crew] = await sql`
      SELECT id FROM crews WHERE id = ${crewId} AND user_id = ${user.id}
    `;
    if (!crew) {
      return NextResponse.json({ error: 'Crew not found.' }, { status: 404 });
    }

    // Check member cap per crew
    const [countRow] = await sql`
      SELECT COUNT(*)::int AS cnt FROM crew_members WHERE crew_id = ${crewId}
    `;
    if ((countRow?.cnt ?? 0) >= CREW_LIMITS.MAX_MEMBERS_PER_CREW) {
      return NextResponse.json(
        { error: `Crew has reached the maximum of ${CREW_LIMITS.MAX_MEMBERS_PER_CREW} members.` },
        { status: 422 },
      );
    }

    const s = sanitiseCreateMember(body);

    const [member] = await sql`
      INSERT INTO crew_members (
        crew_id, user_id, name, role, member_type, company, trade,
        phone, email, certifications,
        is_lead, notes
      )
      VALUES (
        ${crewId}, ${user.id}, ${s.name}, ${s.role}, ${s.member_type}, ${s.company}, ${s.trade},
        ${s.phone}, ${s.email}, ${s.certifications},
        ${s.is_lead}, ${s.notes}
      )
      RETURNING *
    `;

    return NextResponse.json({ member }, { status: 201 });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/crews/[id]/members]', error);
  }
}
