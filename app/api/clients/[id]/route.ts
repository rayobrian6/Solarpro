import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getClientById, updateClient, softDeleteClient , handleRouteDbError } from '@/lib/db-neon';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const client = await getClientById(id, user.id);
    if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    return NextResponse.json({ success: true, data: client });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/clien', err);
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const body = await req.json();

    // Validate if name/email are being updated
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length < 2)) {
      return NextResponse.json({ success: false, error: 'Name must be at least 2 characters' }, { status: 400 });
    }
    if (body.email !== undefined && (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) {
      return NextResponse.json({ success: false, error: 'Valid email address is required' }, { status: 400 });
    }

    const updated = await updateClient(id, user.id, body);
    if (!updated) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    return NextResponse.json({ success: true, data: updated });
  } catch (err: unknown) {
    return handleRouteDbError('[PUT /api/clien', err);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    // Soft delete — sets deleted_at, never removes data
    const deleted = await softDeleteClient(id, user.id);
    if (!deleted) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    return NextResponse.json({ success: true, message: 'Client deleted' });
  } catch (err: unknown) {
    return handleRouteDbError('[DELETE /api/clien', err);
  }
}