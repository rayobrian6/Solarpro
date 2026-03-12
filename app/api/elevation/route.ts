export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_API_KEY = 'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const locations = searchParams.get('locations'); // pipe-separated for grid

  try {
    let locStr: string;
    if (locations) {
      locStr = locations;
    } else if (lat && lng) {
      locStr = `${lat},${lng}`;
    } else {
      return NextResponse.json({ error: 'lat/lng or locations required' }, { status: 400 });
    }

    const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${encodeURIComponent(locStr)}&key=${GOOGLE_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    if (locations) {
      // Return full results array for grid
      return NextResponse.json({ results: data.results ?? [] });
    } else {
      // Return single elevation
      if (data.results?.[0]) {
        return NextResponse.json({ elevation: data.results[0].elevation });
      }
      return NextResponse.json({ elevation: 0 });
    }
  } catch (err: any) {
    return NextResponse.json({ elevation: 0, error: err.message }, { status: 500 });
  }
}