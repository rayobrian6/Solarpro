export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';

const GOOGLE_SOLAR_API_KEY = process.env.GOOGLE_SOLAR_API_KEY || 'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint');
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const quality = searchParams.get('quality') || 'HIGH';

  if (!endpoint || !lat || !lng) {
    return NextResponse.json(
      { error: 'Missing required parameters: endpoint, lat, lng' },
      { status: 400 }
    );
  }

  try {
    let url = '';

    if (endpoint === 'buildingInsights') {
      url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=${quality}&key=${GOOGLE_SOLAR_API_KEY}`;
    } else if (endpoint === 'dataLayers') {
      url = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=${quality}&key=${GOOGLE_SOLAR_API_KEY}`;
    } else {
      return NextResponse.json(
        { error: 'Invalid endpoint. Use: buildingInsights or dataLayers' },
        { status: 400 }
      );
    }

    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Google Solar API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error: unknown) {
    return handleRouteDbError('[S]', error);
  }
}