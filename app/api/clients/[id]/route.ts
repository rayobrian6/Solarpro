import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getClientById, updateClient, softDeleteClient } from '@/lib/db-neon';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const client = await getClientById(params.id, user.id);
    if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    return NextResponse.json({ success: true, data: client });
  } catch (err) {
    console.error('[GET /api/clients/[id]]', err);
    return NextResponse.json({ success: false, error: 'Failed to fetch client' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
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

    const updated = await updateClient(params.id, user.id, body);
    if (!updated) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[PUT /api/clients/[id]]', err);
    return NextResponse.json({ success: false, error: 'Failed to update client' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    // Soft delete — sets deleted_at, never removes data
    const deleted = await softDeleteClient(params.id, user.id);
    if (!deleted) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    return NextResponse.json({ success: true, message: 'Client deleted' });
  } catch (err) {
    console.error('[DELETE /api/clients/[id]]', err);
    return NextResponse.json({ success: false, error: 'Failed to delete client' }, { status: 500 });
  }
}