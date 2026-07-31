export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { validateCreateCertification, CREW_LIMITS } from '@/lib/crews';

type Params = { memberId: string };

const MAX_CERTS_PER_MEMBER = CREW_LIMITS.MAX_CERTS_PER_MEMBER;

/** GET /api/crew-members/[memberId]/certifications — list a member's certs (soonest expiry first). */
export async function GET(req: NextRequest, props: { params: Promise<Params> }) {
  const params = await props.params;
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { memberId } = params;
    if (!isValidUUID(memberId)) return NextResponse.json({ error: 'Invalid member ID.' }, { status: 400 });

    const sql = await getDbReady();

    // Ownership: the member must belong to this user.
    const [member] = await sql`
      SELECT id FROM crew_members WHERE id = ${memberId} AND user_id = ${user.id}
    `;
    if (!member) return NextResponse.json({ error: 'Member not found.' }, { status: 404 });

    const certifications = await sql`
      SELECT id, member_id, user_id, name, issuer, issued_on, expires_on, file_url, notes, created_at, updated_at
      FROM member_certifications
      WHERE member_id = ${memberId} AND user_id = ${user.id}
      ORDER BY expires_on ASC NULLS LAST, name ASC
    `;

    return NextResponse.json({ certifications });
  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/crew-members/[memberId]/certifications]', error);
  }
}

/** POST /api/crew-members/[memberId]/certifications — add a cert to the vault. */
export async function POST(req: NextRequest, props: { params: Promise<Params> }) {
  const params = await props.params;
  try {
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { memberId } = params;
    if (!isValidUUID(memberId)) return NextResponse.json({ error: 'Invalid member ID.' }, { status: 400 });

    const body = await req.json();
    const validationError = validateCreateCertification(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const sql = await getDbReady();

    const [member] = await sql`
      SELECT id FROM crew_members WHERE id = ${memberId} AND user_id = ${user.id}
    `;
    if (!member) return NextResponse.json({ error: 'Member not found.' }, { status: 404 });

    const [countRow] = await sql`
      SELECT COUNT(*)::int AS cnt FROM member_certifications WHERE member_id = ${memberId}
    `;
    if ((countRow?.cnt ?? 0) >= MAX_CERTS_PER_MEMBER) {
      return NextResponse.json(
        { error: `Member has reached the maximum of ${MAX_CERTS_PER_MEMBER} certifications.` },
        { status: 422 },
      );
    }

    const [certification] = await sql`
      INSERT INTO member_certifications (member_id, user_id, name, issuer, issued_on, expires_on, file_url, notes)
      VALUES (
        ${memberId}, ${user.id}, ${String(body.name).trim()},
        ${body.issuer?.trim() || null}, ${body.issued_on || null}, ${body.expires_on || null},
        ${body.file_url || null}, ${body.notes?.trim() || null}
      )
      RETURNING id, member_id, user_id, name, issuer, issued_on, expires_on, file_url, notes, created_at, updated_at
    `;

    return NextResponse.json({ certification }, { status: 201 });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/crew-members/[memberId]/certifications]', error);
  }
}
