export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';
import db from '@/lib/db';
import type { SolarPanel, Inverter, MountingSystem, Battery } from '@/types';

/**
 * POST /api/equipment/save
 * Save user equipment to their account database.
 *
 * Payload: { equipmentType, data }
 * equipmentType: 'panel' | 'inverter' | 'mounting' | 'battery'
 *
 * userId is derived from the authenticated session — never from the request body.
 */
export async function POST(req: NextRequest) {
  try {
    // Require authenticated session — userId comes from session, not body
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as Record<string, unknown>;
    // Destructure only equipmentType and data — userId is intentionally excluded from body
    const { equipmentType, data } = body;

    if (!equipmentType || !data) {
      return NextResponse.json({
        success: false,
        error: 'Missing equipmentType or data',
      }, { status: 400 });
    }

    // userId from authenticated session (not from body)
    const userId = user.id;

    let savedItem;

    switch (equipmentType) {
      case 'panel':
        savedItem = db.savePanel(data as Omit<SolarPanel, 'id'>);
        break;
      case 'inverter':
        savedItem = db.saveInverter ? db.saveInverter(data as Omit<Inverter, 'id'>) : null;
        break;
      case 'mounting':
        savedItem = db.saveMounting ? db.saveMounting(data as Omit<MountingSystem, 'id'>) : null;
        break;
      case 'battery':
        savedItem = db.saveBattery ? db.saveBattery(data as Omit<Battery, 'id'>) : null;
        break;
      default:
        return NextResponse.json({
          success: false,
          error: `Unknown equipment type: ${equipmentType}`,
        }, { status: 400 });
    }

    if (!savedItem) {
      return NextResponse.json({
        success: false,
        error: 'Failed to save equipment',
      }, { status: 500 });
    }

    // TODO: When Neon migration is complete, also persist to user_equipment_* tables:
    // await sql`
    //   INSERT INTO user_equipment_panels (user_id, manufacturer, model, wattage, ...)
    //   VALUES (${userId}, ${data.manufacturer}, ${data.model}, ${data.wattage}, ...)
    // `;

    console.log(`[EQUIPMENT_SAVE] userId=${userId} type=${equipmentType} saved successfully`);

    return NextResponse.json({
      success: true,
      data: savedItem,
      message: `${equipmentType} saved successfully`,
    }, { status: 201 });

  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/equipment/save]', err);
  }
}