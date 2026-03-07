import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDb } from '@/lib/auth';
import { autoConfigureProject } from '@/lib/engineering-automation';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const {
      projectId,
      address,
      inverterACOutput,
      dcStringCurrent,
      runLengthFeet,
      conduitType = 'schedule40_pvc',
      conductorType = 'THHN',
      arrayType = 'roof',
    } = body;

    if (!projectId || !address || !inverterACOutput || !dcStringCurrent || !runLengthFeet) {
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

    const result = await autoConfigureProject(
      projectId,
      address,
      inverterACOutput,
      dcStringCurrent,
      runLengthFeet,
      conduitType,
      conductorType,
      arrayType
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Auto-configure error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to auto-configure project' },
      { status: 500 }
    );
  }
}