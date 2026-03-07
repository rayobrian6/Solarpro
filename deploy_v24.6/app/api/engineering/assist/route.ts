import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDb } from '@/lib/auth';
import { runEngineeringAssist } from '@/lib/engineering-automation';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();

    // Verify user has access to this project
    const sql = getDb();
    const projectCheck = await sql`
      SELECT user_id FROM projects WHERE id = ${body.projectId}
    `;

    if (projectCheck.length === 0 || projectCheck[0].user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const result = await runEngineeringAssist(body.projectId, body);

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Engineering assist error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to run engineering assist' },
      { status: 500 }
    );
  }
}