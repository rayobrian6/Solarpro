export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

type Params = { memberId: string; certId: string };

/** DELETE /api/crew-members/[memberId]/certifications/[certId] — remove a cert from the vault. */
export async function DELETE(req: NextRequest, props: { params: Promise<Params> }) {
  const params = await props.params;
  try {
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { memberId, certId } = params;
    if (!isValidUUID(memberId)) return NextResponse.json({ error: 'Invalid member ID.' }, { status: 400 });
    if (!isValidUUID(certId))   return NextResponse.json({ error: 'Invalid certification ID.' }, { status: 400 });

    const sql = await getDbReady();

    // Ownership enforced by user_id on the row.
    const [deleted] = await sql`
      DELETE FROM member_certifications
      WHERE id = ${certId} AND member_id = ${memberId} AND user_id = ${user.id}
      RETURNING id
    `;
    if (!deleted) return NextResponse.json({ error: 'Certification not found.' }, { status: 404 });

    return NextResponse.json({ deleted: true });
  } catch (error: unknown) {
    return handleRouteDbError('[DELETE /api/crew-members/[memberId]/certifications/[certId]]', error);
  }
}
