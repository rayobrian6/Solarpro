import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectById, getProjectVersions } from '@/lib/db-neon';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const project = await getProjectById(params.id, user.id);
    if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    const versions = await getProjectVersions(params.id, user.id);
    return NextResponse.json({ success: true, data: versions });
  } catch (err) {
    console.error('[GET /api/projects/[id]/versions]', err);
    return NextResponse.json({ success: false, error: 'Failed to fetch versions' }, { status: 500 });
  }
}