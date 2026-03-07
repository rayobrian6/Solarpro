import { NextRequest, NextResponse } from 'next/server';
import {
  SOLAR_PANELS, STRING_INVERTERS, MICROINVERTERS, OPTIMIZERS,
  RACKING_SYSTEMS, CONDUCTORS, CONDUITS
} from '@/lib/equipment-db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const manufacturer = searchParams.get('manufacturer');
    const search = searchParams.get('search')?.toLowerCase();

    let data: any[] = [];

    switch (category) {
      case 'solar_panel':
        data = SOLAR_PANELS;
        break;
      case 'string_inverter':
        data = STRING_INVERTERS;
        break;
      case 'microinverter':
        data = MICROINVERTERS;
        break;
      case 'optimizer':
        data = OPTIMIZERS;
        break;
      case 'racking':
        data = RACKING_SYSTEMS;
        break;
      case 'conductor':
        data = CONDUCTORS;
        break;
      case 'conduit':
        data = CONDUITS;
        break;
      default:
        // Return all categories with counts
        return NextResponse.json({
          success: true,
          categories: [
            { id: 'solar_panel', label: 'Solar Panels', count: SOLAR_PANELS.length },
            { id: 'string_inverter', label: 'String Inverters', count: STRING_INVERTERS.length },
            { id: 'microinverter', label: 'Microinverters', count: MICROINVERTERS.length },
            { id: 'optimizer', label: 'Optimizers', count: OPTIMIZERS.length },
            { id: 'racking', label: 'Racking Systems', count: RACKING_SYSTEMS.length },
            { id: 'conductor', label: 'Conductors', count: CONDUCTORS.length },
            { id: 'conduit', label: 'Conduit', count: CONDUITS.length },
          ],
          total: SOLAR_PANELS.length + STRING_INVERTERS.length + MICROINVERTERS.length +
                 OPTIMIZERS.length + RACKING_SYSTEMS.length + CONDUCTORS.length + CONDUITS.length,
        });
    }

    // Filter by manufacturer
    if (manufacturer) {
      data = data.filter((item: any) =>
        item.manufacturer?.toLowerCase().includes(manufacturer.toLowerCase())
      );
    }

    // Filter by search term
    if (search) {
      data = data.filter((item: any) =>
        item.manufacturer?.toLowerCase().includes(search) ||
        item.model?.toLowerCase().includes(search) ||
        item.id?.toLowerCase().includes(search)
      );
    }

    return NextResponse.json({ success: true, data, count: data.length });

  } catch (error: any) {
    console.error('Equipment API error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}