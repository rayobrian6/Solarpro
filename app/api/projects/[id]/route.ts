import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectById, getProjectWithDetails, updateProject, softDeleteProject, handleRouteDbError } from '@/lib/db-neon';

type RouteContext = { params: Promise<{id: string}> };


export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    // Use getProjectWithDetails to include layout, production, costEstimate, client
    const project = await getProjectWithDetails(id, user.id);
    if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    return NextResponse.json({ success: true, data: project });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/projects/[id]]', err);
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const body = await req.json();
    const updated = await updateProject(id, user.id, body);
    if (!updated) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    return NextResponse.json({ success: true, data: updated });
  } catch (err: unknown) {
    return handleRouteDbError('[PUT /api/projects/[id]]', err);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    // Soft delete — sets deleted_at, never removes data
    const deleted = await softDeleteProject(id, user.id);
    if (!deleted) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    return NextResponse.json({ success: true, message: 'Project deleted' });
  } catch (err: unknown) {
    return handleRouteDbError('[DELETE /api/projects/[id]]', err);
  }
}