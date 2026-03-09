import { NextRequest, NextResponse } from 'next/server';
import { geocodeAddress } from '@/lib/locationEngine';

// POST /api/geocode — resolve full location metadata from address
export async function POST(req: NextRequest) {
  try {
    const { address } = await req.json();
    if (!address?.trim()) {
      return NextResponse.json({ success: false, error: 'Address required' }, { status: 400 });
    }
    const result = await geocodeAddress(address);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// GET /api/geocode
//   ?address=...              forward geocode (address to lat/lng)
//   ?q=...&mode=search        forward geocode (alias)
//   ?q=...&mode=autocomplete  autocomplete suggestions
//   ?lat=...&lng=...          reverse geocode (lat/lng to address)
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get('mode') || 'search';

  // Reverse geocode: lat/lng -> address
  const latStr = params.get('lat');
  const lngStr = params.get('lng');
  if (latStr && lngStr) {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (!isFinite(lat) || !isFinite(lng)) {
      return NextResponse.json({ success: false, error: 'Invalid lat/lng' }, { status: 400 });
    }
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SolarPro/1.0 (solar design app)' },
      });
      if (!res.ok) throw new Error(`Nominatim reverse error: ${res.status}`);
      const data = await res.json();
      if (!data || data.error) {
        return NextResponse.json({ success: false, error: data?.error || 'No result' });
      }
      const a = data.address || {};
      const streetPart = a.house_number && a.road
        ? `${a.house_number} ${a.road}`
        : (a.road || '');
      const cityPart = a.city || a.town || a.village || a.county || '';
      const parts = [streetPart, cityPart, a.state || '', a.postcode || ''].filter(Boolean);
      const displayName = parts.join(', ') || data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      return NextResponse.json({
        success: true,
        data: {
          lat,
          lng,
          short_name: displayName,
          display_name: data.display_name || displayName,
          address: a,
        },
      });
    } catch (err: any) {
      // Fallback: return coords as address string
      return NextResponse.json({
        success: true,
        data: {
          lat,
          lng,
          short_name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          display_name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          address: {},
        },
      });
    }
  }

  // Autocomplete suggestions
  const q = params.get('q') || params.get('address') || '';
  if (!q.trim()) {
    return NextResponse.json({ success: false, error: 'Query required' }, { status: 400 });
  }

  if (mode === 'autocomplete') {
    try {
      const encoded = encodeURIComponent(q);
      const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=5&countrycodes=us`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SolarPro/1.0 (solar design app)' },
      });
      if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
      const data = await res.json();
      if (!data?.length) {
        return NextResponse.json({ success: true, data: [] });
      }
      const suggestions = data.map((item: any) => {
        const a = item.address || {};
        const streetPart = a.house_number && a.road
          ? `${a.house_number} ${a.road}`
          : (a.road || '');
        const cityPart = a.city || a.town || a.village || a.county || '';
        const parts = [streetPart, cityPart, a.state || ''].filter(Boolean);
        return {
          short_name: parts.join(', ') || item.display_name,
          display_name: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
        };
      });
      return NextResponse.json({ success: true, data: suggestions });
    } catch (err: any) {
      return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
  }

  // Forward geocode (search)
  const result = await geocodeAddress(q);
  return NextResponse.json(result);
}