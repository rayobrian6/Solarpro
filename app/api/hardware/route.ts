import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

// Hardware/equipment data is static registry data — kept in db.ts (equipment registry)
// This is NOT user data and does not need Neon persistence

export async function GET(req: NextRequest) {
  try {
    const panels = db.getPanels();
    const inverters = db.getInverters();
    const mountings = db.getMountings();
    const batteries = db.getBatteries ? db.getBatteries() : [];
    return NextResponse.json({ 
      success: true, 
      data: { panels, inverters, mountings, batteries } 
    });
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
    
    if (type === 'inverter') {
      const inverter = db.saveInverter(data);
      return NextResponse.json({ success: true, data: inverter }, { status: 201 });
    }
    
    if (type === 'mounting') {
      const mounting = db.saveMounting ? db.saveMounting(data) : null;
      if (mounting) {
        return NextResponse.json({ success: true, data: mounting }, { status: 201 });
      }
    }
    
    if (type === 'battery') {
      const battery = db.saveBattery ? db.saveBattery(data) : null;
      if (battery) {
        return NextResponse.json({ success: true, data: battery }, { status: 201 });
      }
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
    
    if (type === 'inverter') {
      const updated = db.updateInverter ? db.updateInverter(id, data) : null;
      if (updated) {
        return NextResponse.json({ success: true, data: updated });
      }
    }
    
    if (type === 'mounting') {
      const updated = db.updateMounting ? db.updateMounting(id, data) : null;
      if (updated) {
        return NextResponse.json({ success: true, data: updated });
      }
    }
    
    if (type === 'battery') {
      const updated = db.updateBattery ? db.updateBattery(id, data) : null;
      if (updated) {
        return NextResponse.json({ success: true, data: updated });
      }
    }
    
    return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
  } catch (err) {
    console.error('[PUT /api/hardware]', err);
    return NextResponse.json({ success: false, error: 'Failed to update hardware' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, id } = body;
    
    if (type === 'panel') {
      const deleted = db.deletePanel ? db.deletePanel(id) : false;
      return NextResponse.json({ success: deleted });
    }
    
    if (type === 'inverter') {
      const deleted = db.deleteInverter ? db.deleteInverter(id) : false;
      return NextResponse.json({ success: deleted });
    }
    
    if (type === 'mounting') {
      const deleted = db.deleteMounting ? db.deleteMounting(id) : false;
      return NextResponse.json({ success: deleted });
    }
    
    if (type === 'battery') {
      const deleted = db.deleteBattery ? db.deleteBattery(id) : false;
      return NextResponse.json({ success: deleted });
    }
    
    return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
  } catch (err) {
    console.error('[DELETE /api/hardware]', err);
    return NextResponse.json({ success: false, error: 'Failed to delete hardware' }, { status: 500 });
  }
}