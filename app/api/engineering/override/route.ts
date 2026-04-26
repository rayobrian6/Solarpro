import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { overrideAutoConfig } from '@/lib/engineering-automation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    // v48.6: Rate limiting — 10 req / 30s per IP (protects heavy compute + external APIs)
    const { checkRateLimit, getClientIp } = await import('@/lib/rateLimiter');
    const _rl = await checkRateLimit('engineering', getClientIp(req));
    if (!_rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, fieldName, overrideValue, reason } = body;

    if (!projectId || !fieldName || !overrideValue) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify user has access to this project
    const sql = await getDbReady();
    const projectCheck = await sql`
      SELECT user_id FROM projects WHERE id = ${projectId}
    `;

    if (projectCheck.length === 0 || projectCheck[0].user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const result = await overrideAutoConfig(projectId, fieldName, overrideValue, reason || 'Manual override');

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/engineering/override]', error);
  }
}