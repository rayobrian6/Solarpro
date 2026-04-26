/**
 * lib/geocode.ts
 * Server-side geocoding utility — shared between API routes.
 * Primary: US Census Geocoder (best for US street addresses)
 * Fallback: Nominatim/OpenStreetMap
 *
 * Used by:
 *  - app/api/geocode/route.ts (public geocoding endpoint)
 *  - app/api/projects/route.ts (auto-geocode on project creation)
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

// ─── Census Geocoder ──────────────────────────────────────────────────────────

async function censusGeocode(address: string): Promise<{ lat: number; lng: number; matchedAddress: string } | null> {
  try {
    const encoded = encodeURIComponent(address);
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encoded}&benchmark=Public_AR_Current&format=json`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'SolarProDesign/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const matches = data?.result?.addressMatches;

    if (matches && matches.length > 0) {
      const match = matches[0];
      return {
        lat: parseFloat(match.coordinates.y),
        lng: parseFloat(match.coordinates.x),
        matchedAddress: match.matchedAddress,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Nominatim Fallback ───────────────────────────────────────────────────────

async function nominatimGeocode(query: string): Promise<{ lat: number; lng: number; displayName: string } | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&addressdetails=1`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'SolarProDesign/1.0 (solar design platform)' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        displayName: data[0].display_name,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Main geocode function ────────────────────────────────────────────────────

/**
 * Geocode an address string to lat/lng.
 * Returns null if geocoding fails — never throws.
 * Tries Census first (best for US), falls back to Nominatim.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!address || !address.trim()) return null;

  try {
    // 1. Try Census first (best for US street addresses)
    const census = await censusGeocode(address);
    if (census && isFinite(census.lat) && isFinite(census.lng)) {
      return {
        lat: census.lat,
        lng: census.lng,
        displayName: census.matchedAddress,
      };
    }

    // 2. Fallback to Nominatim
    const nominatim = await nominatimGeocode(address);
    if (nominatim && isFinite(nominatim.lat) && isFinite(nominatim.lng)) {
      return nominatim;
    }

    return null;
  } catch {
    return null;
  }
}