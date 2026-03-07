import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDb } from '@/lib/auth';
import { overrideAutoConfig } from '@/lib/engineering-automation';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
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
    const sql = getDb();
    const projectCheck = await sql`
      SELECT user_id FROM projects WHERE id = ${projectId}
    `;

    if (projectCheck.length === 0 || projectCheck[0].user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const result = await overrideAutoConfig(projectId, fieldName, overrideValue, reason || 'Manual override');

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Override error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to override auto-configuration' },
      { status: 500 }
    );
  }
}