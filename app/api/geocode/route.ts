import { NextRequest, NextResponse } from 'next/server';

// Server-side geocoding proxy
// Primary: US Census Geocoder (excellent for US addresses, even small towns)
// Fallback: Nominatim/OpenStreetMap (good for landmarks, cities, international)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  const mode = searchParams.get('mode') || 'search'; // 'search' or 'autocomplete'

  if (!q || !q.trim()) {
    return NextResponse.json({ success: false, error: 'Query required' }, { status: 400 });
  }

  const query = q.trim();

  try {
    if (mode === 'autocomplete') {
      const results = await autocomplete(query);
      return NextResponse.json({ success: true, data: results });
    } else {
      const result = await geocodeSingle(query);
      if (result) {
        return NextResponse.json({ success: true, data: result });
      } else {
        return NextResponse.json({ success: false, error: 'Address not found' });
      }
    }
  } catch (e: any) {
    console.error('Geocoding error:', e);
    return NextResponse.json({ success: false, error: e.message || 'Geocoding failed' }, { status: 500 });
  }
}

// ─── Census Geocoder ────────────────────────────────────────────────────────

async function censusGeocode(address: string): Promise<{ lat: number; lng: number; matchedAddress: string } | null> {
  try {
    const encoded = encodeURIComponent(address);
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encoded}&benchmark=Public_AR_Current&format=json`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'SolarProDesign/1.0' },
      next: { revalidate: 300 },
    });

    if (!res.ok) return null;

    const data = await res.json();
    const matches = data?.result?.addressMatches;

    if (matches && matches.length > 0) {
      const match = matches[0];
      const components = match.addressComponents;
      const matchedAddress = match.matchedAddress;

      return {
        lat: match.coordinates.y,
        lng: match.coordinates.x,
        matchedAddress,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Nominatim Geocoder ─────────────────────────────────────────────────────

async function nominatimGeocode(address: string, limit = 1): Promise<any[]> {
  try {
    const encoded = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=${limit}&addressdetails=1&countrycodes=us`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SolarProDesign/1.0 (solar-platform)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ─── Single geocode (search mode) ──────────────────────────────────────────

async function geocodeSingle(query: string) {
  // 1. Try Census first (best for US street addresses)
  const census = await censusGeocode(query);
  if (census) {
    const parsed = parseCensusAddress(census.matchedAddress);
    return {
      lat: census.lat,
      lng: census.lng,
      display_name: census.matchedAddress,
      address: parsed,
    };
  }

  // 2. Fallback to Nominatim
  const nominatim = await nominatimGeocode(query, 1);
  if (nominatim.length > 0) {
    const item = nominatim[0];
    return {
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      display_name: item.display_name,
      address: item.address,
    };
  }

  return null;
}

// ─── Autocomplete (returns multiple suggestions) ────────────────────────────

async function autocomplete(query: string) {
  const results: any[] = [];
  const seen = new Set<string>();

  // Run Census and Nominatim in parallel
  const [censusResult, nominatimResults] = await Promise.all([
    censusGeocode(query),
    nominatimGeocode(query, 5),
  ]);

  // Add Census result first (most accurate for US addresses)
  if (censusResult) {
    const key = `${censusResult.lat.toFixed(4)},${censusResult.lng.toFixed(4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      const parsed = parseCensusAddress(censusResult.matchedAddress);
      results.push({
        display_name: censusResult.matchedAddress,
        short_name: formatCensusShortName(censusResult.matchedAddress),
        lat: censusResult.lat,
        lng: censusResult.lng,
        address: parsed,
        source: 'census',
      });
    }
  }

  // Add Nominatim results
  for (const item of nominatimResults) {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({
        display_name: item.display_name,
        short_name: formatNominatimShortName(item),
        lat,
        lng,
        address: item.address,
        source: 'nominatim',
      });
    }
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Parse "1010 FRANKLIN ST, POCAHONTAS, IL, 62275" into address object
function parseCensusAddress(matchedAddress: string) {
  const parts = matchedAddress.split(',').map(s => s.trim());
  // Format: "STREET, CITY, STATE, ZIP"
  return {
    road: parts[0] || '',
    city: parts[1] || '',
    state: parts[2] || '',
    postcode: parts[3] || '',
    country: 'United States',
    country_code: 'us',
  };
}

// Format Census matched address for display in dropdown
// Input: "1010 FRANKLIN ST, POCAHONTAS, IL, 62275"
// Output: "1010 Franklin St, Pocahontas, IL 62275"
function formatCensusShortName(matchedAddress: string): string {
  const parts = matchedAddress.split(',').map(s => s.trim());
  if (parts.length >= 4) {
    const street = toTitleCase(parts[0]);
    const city = toTitleCase(parts[1]);
    const state = parts[2].toUpperCase();
    const zip = parts[3];
    return `${street}, ${city}, ${state} ${zip}`;
  }
  return toTitleCase(matchedAddress);
}

function formatNominatimShortName(item: any): string {
  const a = item.address || {};
  const parts: string[] = [];

  if (a.house_number && a.road) {
    parts.push(`${a.house_number} ${a.road}`);
  } else if (a.road) {
    parts.push(a.road);
  }

  const city = a.city || a.town || a.village || a.hamlet || a.suburb;
  if (city) parts.push(city);
  if (a.state) parts.push(a.state);
  if (a.postcode) parts.push(a.postcode);

  return parts.length > 0 ? parts.join(', ') : item.display_name;
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}