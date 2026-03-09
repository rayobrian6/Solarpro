/**
 * lib/locationEngine.ts
 * National Location Engine — resolves full location metadata from any US address.
 * Uses Census Bureau Geocoding API (free, no key required) with Google Maps fallback.
 */

// ── Title case helper ────────────────────────────────────────────────────────
function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

export interface LocationData {
  // Raw input
  rawAddress: string;
  // Resolved components
  street: string;
  city: string;
  county: string;
  state: string;       // full name e.g. "California"
  stateCode: string;   // 2-letter e.g. "CA"
  zip: string;
  country: string;
  // Coordinates
  lat: number;
  lng: number;
  // Derived
  fips: string;        // FIPS state+county code
  censusTract?: string;
  // Meta
  resolvedAt: string;
  source: 'census' | 'google' | 'nominatim' | 'manual';
  confidence: 'high' | 'medium' | 'low';
}

export interface GeocodeResult {
  success: boolean;
  location?: LocationData;
  error?: string;
}

// ── State name ↔ code lookup ──────────────────────────────────────────────────
export const STATE_CODES: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

export const STATE_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_CODES).map(([name, code]) => [code, name])
);

// ── FIPS state codes ──────────────────────────────────────────────────────────
export const STATE_FIPS: Record<string, string> = {
  'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09','DE':'10',
  'FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18','IA':'19','KS':'20',
  'KY':'21','LA':'22','ME':'23','MD':'24','MA':'25','MI':'26','MN':'27','MS':'28',
  'MO':'29','MT':'30','NE':'31','NV':'32','NH':'33','NJ':'34','NM':'35','NY':'36',
  'NC':'37','ND':'38','OH':'39','OK':'40','OR':'41','PA':'42','RI':'44','SC':'45',
  'SD':'46','TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53','WV':'54',
  'WI':'55','WY':'56','DC':'11',
};

// ── Census Bureau Geocoder ────────────────────────────────────────────────────
async function geocodeCensus(address: string): Promise<GeocodeResult> {
  try {
    const encoded = encodeURIComponent(address);
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encoded}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Census API ${res.status}`);
    const data = await res.json();
    const matches = data?.result?.addressMatches;
    if (!matches?.length) return { success: false, error: 'No census match' };

    const match = matches[0];
    const coords = match.coordinates;
    const addrComp = match.addressComponents;
    // matchedAddress format: "1010 FRANKLIN ST, POCAHONTAS, IL, 62275"
    // Use it to extract house number since addressComponents doesn't include it
    const matchedParts = (match.matchedAddress || '').split(',').map((s: string) => s.trim());
    const matchedStreet = matchedParts[0] || '';
    const matchedCity = matchedParts[1] || '';

    const stateCode = addrComp?.state || '';
    const stateName = STATE_NAMES[stateCode] || stateCode;
    const fipsState = STATE_FIPS[stateCode] || '';

    const streetFromMatched = matchedStreet
      ? toTitleCase(matchedStreet)
      : `${addrComp?.streetName || ''} ${addrComp?.suffixType || ''}`.trim();
    const cityFromMatched = matchedCity
      ? toTitleCase(matchedCity)
      : (addrComp?.city || '');

    return {
      success: true,
      location: {
        rawAddress: address,
        street: streetFromMatched,
        city: cityFromMatched,
        county: '',
        state: stateName,
        stateCode,
        zip: addrComp?.zip || '',
        country: 'US',
        lat: coords?.y || 0,
        lng: coords?.x || 0,
        fips: fipsState,
        resolvedAt: new Date().toISOString(),
        source: 'census',
        confidence: 'high',
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Census Geocoder with Geographies (adds county + FIPS) ────────────────────
async function geocodeCensusWithGeo(address: string): Promise<GeocodeResult> {
  try {
    const encoded = encodeURIComponent(address);
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encoded}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Census Geo API ${res.status}`);
    const data = await res.json();
    const matches = data?.result?.addressMatches;
    if (!matches?.length) return { success: false, error: 'No census geo match' };

    const match = matches[0];
    const coords = match.coordinates;
    const addrComp = match.addressComponents;
    const geos = match.geographies;
    const county = geos?.Counties?.[0];
    const tract = geos?.['Census Tracts']?.[0];

    // matchedAddress format: "1010 FRANKLIN ST, POCAHONTAS, IL, 62275"
    const matchedParts = (match.matchedAddress || '').split(',').map((s: string) => s.trim());
    const matchedStreet = matchedParts[0] || '';
    const matchedCity = matchedParts[1] || '';

    const stateCode = addrComp?.state || '';
    const stateName = STATE_NAMES[stateCode] || stateCode;
    const fipsState = STATE_FIPS[stateCode] || '';
    const fipsCounty = county?.COUNTY || '';
    const fips = fipsState + fipsCounty;

    const streetFromMatched = matchedStreet ? toTitleCase(matchedStreet) : (addrComp?.streetName || '') + ' ' + (addrComp?.suffixType || '');
    const cityFromMatched = matchedCity ? toTitleCase(matchedCity) : (addrComp?.city || '');

    return {
      success: true,
      location: {
        rawAddress: address,
        street: streetFromMatched.trim(),
        city: cityFromMatched,
        county: county?.NAME || '',
        state: stateName,
        stateCode,
        zip: addrComp?.zip || '',
        country: 'US',
        lat: coords?.y || 0,
        lng: coords?.x || 0,
        fips,
        censusTract: tract?.NAME,
        resolvedAt: new Date().toISOString(),
        source: 'census',
        confidence: 'high',
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Nominatim (OpenStreetMap) fallback ────────────────────────────────────────
async function geocodeNominatim(address: string): Promise<GeocodeResult> {
  try {
    const encoded = encodeURIComponent(address + ', USA');
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=1&countrycodes=us`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SolarPro/29.0 (solarpro.app)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const data = await res.json();
    if (!data?.length) return { success: false, error: 'No nominatim match' };

    const r = data[0];
    const addr = r.address || {};
    const stateCode = STATE_CODES[addr.state] || addr['ISO3166-2-lvl4']?.replace('US-', '') || '';
    const stateName = addr.state || STATE_NAMES[stateCode] || stateCode;
    const fipsState = STATE_FIPS[stateCode] || '';

    return {
      success: true,
      location: {
        rawAddress: address,
        street: [addr.house_number, addr.road].filter(Boolean).join(' '),
        city: addr.city || addr.town || addr.village || addr.hamlet || '',
        county: (addr.county || '').replace(' County', ''),
        state: stateName,
        stateCode,
        zip: addr.postcode || '',
        country: 'US',
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        fips: fipsState,
        resolvedAt: new Date().toISOString(),
        source: 'nominatim',
        confidence: 'medium',
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Google Maps Geocoder (if API key available) ───────────────────────────────
async function geocodeGoogle(address: string): Promise<GeocodeResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { success: false, error: 'No Google Maps API key' };

  try {
    const encoded = encodeURIComponent(address);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${apiKey}&components=country:US`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Google Maps ${res.status}`);
    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.length) {
      return { success: false, error: `Google: ${data.status}` };
    }

    const result = data.results[0];
    const comps = result.address_components || [];
    const get = (type: string) => comps.find((c: any) => c.types.includes(type));

    const streetNum = get('street_number')?.long_name || '';
    const route = get('route')?.long_name || '';
    const city = get('locality')?.long_name || get('sublocality')?.long_name || '';
    const county = (get('administrative_area_level_2')?.long_name || '').replace(' County', '');
    const stateComp = get('administrative_area_level_1');
    const stateName = stateComp?.long_name || '';
    const stateCode = stateComp?.short_name || '';
    const zip = get('postal_code')?.long_name || '';
    const loc = result.geometry.location;
    const fipsState = STATE_FIPS[stateCode] || '';

    return {
      success: true,
      location: {
        rawAddress: address,
        street: [streetNum, route].filter(Boolean).join(' '),
        city,
        county,
        state: stateName,
        stateCode,
        zip,
        country: 'US',
        lat: loc.lat,
        lng: loc.lng,
        fips: fipsState,
        resolvedAt: new Date().toISOString(),
        source: 'google',
        confidence: 'high',
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Main geocode function — tries all sources in order ───────────────────────
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  if (!address?.trim()) return { success: false, error: 'No address provided' };

  // 1. Try Google Maps first (most accurate) if key available
  if (process.env.GOOGLE_MAPS_API_KEY) {
    const google = await geocodeGoogle(address);
    if (google.success) return google;
  }

  // 2. Try Census Bureau with geographies (free, accurate, adds county + FIPS)
  const censusGeo = await geocodeCensusWithGeo(address);
  if (censusGeo.success) return censusGeo;

  // 3. Try Census Bureau basic
  const census = await geocodeCensus(address);
  if (census.success) return census;

  // 4. Fallback to Nominatim
  const nominatim = await geocodeNominatim(address);
  if (nominatim.success) return nominatim;

  return { success: false, error: 'Could not geocode address with any provider' };
}

// ── Parse address string into components ─────────────────────────────────────
export function parseAddressComponents(address: string): {
  street: string; city: string; state: string; zip: string;
} {
  // Try to parse "123 Main St, City, ST 12345" format
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1].trim();
    const stateZip = lastPart.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    return {
      street: parts[0] || '',
      city: parts[1] || '',
      state: stateZip ? stateZip[1] : parts[parts.length - 1],
      zip: stateZip ? stateZip[2] : '',
    };
  }
  return { street: address, city: '', state: '', zip: '' };
}

// ── Extract state code from address string ────────────────────────────────────
export function extractStateCode(address: string): string | null {
  // Match "CA", "TX", etc. in address
  const match = address.match(/\b([A-Z]{2})\b(?:\s+\d{5})?/g);
  if (!match) return null;
  for (const m of match) {
    const code = m.trim().substring(0, 2);
    if (STATE_NAMES[code]) return code;
  }
  return null;
}