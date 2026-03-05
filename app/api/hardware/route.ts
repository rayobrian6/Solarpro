import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

// Hardware/equipment data is static registry data — kept in db.ts (equipment registry)
// This is NOT user data and does not need Neon persistence

export async function GET(req: NextRequest) {
  try {
    const panels = db.getPanels();
    const inverters = db.getInverters();
    const mountings = db.getMountings();
    const batteries = db.getBatteries();
    const pricing = db.getPricing();
    return NextResponse.json({ success: true, data: { panels, inverters, mountings, batteries, pricing } });
  } catch (err) {
    console.error('[GET /api/hardware]', err);
    return NextResponse.json({ success: false, error: 'Failed to fetch hardware' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, data } = body;
    if (type === 'panel') {
      const panel = db.savePanel(data);
      return NextResponse.json({ success: true, data: panel }, { status: 201 });
    }
    return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
  } catch (err) {
    console.error('[POST /api/hardware]', err);
    return NextResponse.json({ success: false, error: 'Failed to save hardware' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, id, data } = body;
    if (type === 'panel') {
      const updated = db.updatePanel(id, data);
      return NextResponse.json({ success: true, data: updated });
    }
    if (type === 'pricing') {
      const updated = db.updatePricing(data);
      return NextResponse.json({ success: true, data: updated });
    }
    return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
  } catch (err) {
    console.error('[PUT /api/hardware]', err);
    return NextResponse.json({ success: false, error: 'Failed to update hardware' }, { status: 500 });
  }
}