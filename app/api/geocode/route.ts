export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

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
    if (!result.success || !result.location) {
      return NextResponse.json({ success: false, error: result.error || 'Not found' });
    }
    const loc = result.location;
    const short_name = buildShortName(loc.street, loc.city, loc.stateCode, loc.zip);
    return NextResponse.json({
      success: true,
      data: { lat: loc.lat, lng: loc.lng, short_name, display_name: short_name, address: loc },
    });
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

  // ── Reverse geocode: lat/lng → address ──────────────────────────────────────
  const latStr = params.get('lat');
  const lngStr = params.get('lng');
  if (latStr && lngStr) {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (!isFinite(lat) || !isFinite(lng)) {
      return NextResponse.json({ success: false, error: 'Invalid lat/lng' }, { status: 400 });
    }
    return reverseGeocode(lat, lng);
  }

  // ── Forward geocode / autocomplete ──────────────────────────────────────────
  const q = params.get('q') || params.get('address') || '';
  if (!q.trim()) {
    return NextResponse.json({ success: false, error: 'Query required' }, { status: 400 });
  }

  if (mode === 'autocomplete') {
    return autocomplete(q);
  }

  // Forward geocode (search) — use locationEngine, normalize response to { success, data }
  return forwardGeocode(q);
}

// ── Helper: build a clean short address string ──────────────────────────────
function buildShortName(street: string, city: string, stateCode: string, zip: string): string {
  const parts: string[] = [];
  if (street) parts.push(street);
  if (city) parts.push(city);
  if (stateCode && zip) parts.push(`${stateCode} ${zip}`);
  else if (stateCode) parts.push(stateCode);
  else if (zip) parts.push(zip);
  return parts.join(', ');
}

// ── Forward geocode ──────────────────────────────────────────────────────────
async function forwardGeocode(address: string): Promise<NextResponse> {
  try {
    const result = await geocodeAddress(address);
    if (!result.success || !result.location) {
      return NextResponse.json({ success: false, error: result.error || 'Address not found' });
    }
    const loc = result.location;
    // Build a proper street address including house number
    // Census returns streetName without house number in some cases — reconstruct from raw
    const streetWithNum = loc.street || '';
    // Try to recover house number from rawAddress if street doesn't include it
    const houseNumMatch = loc.rawAddress?.match(/^\s*(\d+[-\d]*)\s+/);
    const houseNum = houseNumMatch ? houseNumMatch[1] : '';
    const fullStreet = (houseNum && !streetWithNum.startsWith(houseNum))
      ? `${houseNum} ${streetWithNum}`.trim()
      : streetWithNum;
    const short_name = buildShortName(fullStreet, loc.city, loc.stateCode, loc.zip);
    return NextResponse.json({
      success: true,
      data: {
        lat: loc.lat,
        lng: loc.lng,
        short_name,
        display_name: short_name,
        address: loc,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ── Autocomplete suggestions ─────────────────────────────────────────────────
// Uses Google Maps Places API if available, then Census, then Nominatim
async function autocomplete(q: string): Promise<NextResponse> {
  // 1. Try Google Maps Geocoding API (most accurate for US addresses)
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    try {
      const encoded = encodeURIComponent(q);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${googleKey}&components=country:US&language=en`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'OK' && data.results?.length) {
          const suggestions = data.results.slice(0, 5).map((item: any) => {
            const comps = item.address_components || [];
            const get = (type: string) => comps.find((c: any) => c.types.includes(type));
            const streetNum = get('street_number')?.long_name || '';
            const route = get('route')?.long_name || '';
            const city = get('locality')?.long_name || get('sublocality')?.long_name || get('administrative_area_level_3')?.long_name || '';
            const stateCode = get('administrative_area_level_1')?.short_name || '';
            const zip = get('postal_code')?.long_name || '';
            const street = [streetNum, route].filter(Boolean).join(' ');
            const short_name = buildShortName(street, city, stateCode, zip);
            return {
              short_name,
              display_name: item.formatted_address || short_name,
              lat: item.geometry.location.lat,
              lng: item.geometry.location.lng,
            };
          });
          return NextResponse.json({ success: true, data: suggestions });
        }
      }
    } catch { /* fall through */ }
  }

  // 2. Try Census Bureau geocoder (free, accurate for US addresses)
  try {
    const encoded = encodeURIComponent(q);
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encoded}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      const matches = data?.result?.addressMatches;
      if (matches?.length) {
        const suggestions = matches.slice(0, 5).map((match: any) => {
          const a = match.addressComponents || {};
          const coords = match.coordinates || {};
          // Census returns streetName without house number — reconstruct from matchedAddress
          const matched = match.matchedAddress || '';
          // matchedAddress format: "1010 FRANKLIN ST, POCAHONTAS, IL, 62275"
          const parts = matched.split(',').map((s: string) => s.trim());
          const street = parts[0] || [a.fromAddress?.split('-')[0], a.streetName, a.suffixType].filter(Boolean).join(' ');
          const city = parts[1] || a.city || '';
          const stateCode = parts[2] || a.state || '';
          const zip = parts[3] || a.zip || '';
          const short_name = buildShortName(
            toTitleCase(street),
            toTitleCase(city),
            stateCode.trim(),
            zip.trim()
          );
          return {
            short_name,
            display_name: short_name,
            lat: coords.y || 0,
            lng: coords.x || 0,
          };
        }).filter((s: any) => s.lat !== 0 && s.lng !== 0);
        if (suggestions.length > 0) {
          return NextResponse.json({ success: true, data: suggestions });
        }
      }
    }
  } catch { /* fall through */ }

  // 3. Fallback: Nominatim (OpenStreetMap)
  try {
    const encoded = encodeURIComponent(q + ', USA');
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=5&countrycodes=us`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SolarPro/35.0 (solar design app)' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.length) {
        const suggestions = data.map((item: any) => {
          const a = item.address || {};
          const streetPart = a.house_number && a.road
            ? `${a.house_number} ${a.road}`
            : (a.road || '');
          const cityPart = a.city || a.town || a.village || a.hamlet || a.county || '';
          const stateCode = a['ISO3166-2-lvl4']?.replace('US-', '') || '';
          const zip = a.postcode || '';
          const short_name = buildShortName(streetPart, cityPart, stateCode, zip);
          return {
            short_name: short_name || item.display_name,
            display_name: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
          };
        });
        return NextResponse.json({ success: true, data: suggestions });
      }
    }
  } catch { /* fall through */ }

  return NextResponse.json({ success: true, data: [] });
}

// ── Reverse geocode ──────────────────────────────────────────────────────────
async function reverseGeocode(lat: number, lng: number): Promise<NextResponse> {
  // 1. Try Google Maps reverse geocode if key available
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleKey}&language=en&result_type=street_address|premise`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'OK' && data.results?.length) {
          const result = data.results[0];
          const comps = result.address_components || [];
          const get = (type: string) => comps.find((c: any) => c.types.includes(type));
          const streetNum = get('street_number')?.long_name || '';
          const route = get('route')?.long_name || '';
          const city = get('locality')?.long_name || get('sublocality')?.long_name || get('administrative_area_level_3')?.long_name || '';
          const stateCode = get('administrative_area_level_1')?.short_name || '';
          const zip = get('postal_code')?.long_name || '';
          const street = [streetNum, route].filter(Boolean).join(' ');
          const short_name = buildShortName(street, city, stateCode, zip);
          return NextResponse.json({
            success: true,
            data: { lat, lng, short_name, display_name: result.formatted_address || short_name, address: comps },
          });
        }
      }
    } catch { /* fall through */ }
  }

  // 2. Nominatim reverse geocode
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SolarPro/35.0 (solar design app)' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error) {
        const a = data.address || {};
        const streetPart = a.house_number && a.road
          ? `${a.house_number} ${a.road}`
          : (a.road || '');
        const cityPart = a.city || a.town || a.village || a.hamlet || a.county || '';
        const stateCode = a['ISO3166-2-lvl4']?.replace('US-', '') || '';
        const zip = a.postcode || '';
        const short_name = buildShortName(streetPart, cityPart, stateCode, zip)
          || data.display_name
          || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        return NextResponse.json({
          success: true,
          data: { lat, lng, short_name, display_name: data.display_name || short_name, address: a },
        });
      }
    }
  } catch { /* fall through */ }

  // 3. Final fallback: coords as address
  return NextResponse.json({
    success: true,
    data: {
      lat, lng,
      short_name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      display_name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      address: {},
    },
  });
}

// ── Title case helper ────────────────────────────────────────────────────────
function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}