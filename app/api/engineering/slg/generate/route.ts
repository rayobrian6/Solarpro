import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { generateDynamicSLG } from '@/lib/engineering-automation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const {
      projectId,
      inverterACOutput,
      moduleCount,
      arrayTilt = 20,
      systemCapacityKw,
    } = body;

    if (!projectId || !inverterACOutput || !moduleCount || !systemCapacityKw) {
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

    const slg = await generateDynamicSLG(
      projectId,
      inverterACOutput,
      moduleCount,
      arrayTilt,
      systemCapacityKw
    );

    return NextResponse.json({ success: true, data: { slg } });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/engineering/slg/generate]', error);
  }
}