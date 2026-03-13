export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import db from '@/lib/db';

/**
 * POST /api/equipment/save
 * Save user equipment to their account database
 * 
 * Payload: { userId, equipmentType, data }
 * equipmentType: 'panel' | 'inverter' | 'mounting' | 'battery'
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, equipmentType, data } = body;
    
    // For now, save to local db (file-based)
    // In production, this would save to user-specific tables in Neon PostgreSQL
    
    if (!equipmentType || !data) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing equipmentType or data' 
      }, { status: 400 });
    }
    
    let savedItem;
    
    switch (equipmentType) {
      case 'panel':
        savedItem = db.savePanel(data);
        break;
      case 'inverter':
        savedItem = db.saveInverter ? db.saveInverter(data) : null;
        break;
      case 'mounting':
        savedItem = db.saveMounting ? db.saveMounting(data) : null;
        break;
      case 'battery':
        savedItem = db.saveBattery ? db.saveBattery(data) : null;
        break;
      default:
        return NextResponse.json({ 
          success: false, 
          error: `Unknown equipment type: ${equipmentType}` 
        }, { status: 400 });
    }
    
    if (!savedItem) {
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to save equipment' 
      }, { status: 500 });
    }
    
    // In production, you would also save to user_equipment_* tables
    // Example:
    // await neonClient.query(`
    //   INSERT INTO user_equipment_panels (user_id, manufacturer, model, wattage, ...)
    //   VALUES ($1, $2, $3, $4, ...)
    // `, [userId, data.manufacturer, data.model, data.wattage, ...]);
    
    return NextResponse.json({ 
      success: true, 
      data: savedItem,
      message: `${equipmentType} saved successfully`
    }, { status: 201 });
    
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/e', err);
  }
}