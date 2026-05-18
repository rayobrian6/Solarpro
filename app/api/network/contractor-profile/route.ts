export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// ---------------------------------------------------------------------------
// GET /api/network/contractor-profile
// Returns the current user's contractor capability profile.
// Creates a blank one if it doesn't exist yet.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbReady();

    // Upsert a blank profile on first access so the UI always has something to render
    const rows = await sql`
      INSERT INTO contractor_profiles (user_id)
      VALUES (${user.id})
      ON CONFLICT (user_id) DO NOTHING
      RETURNING *
    `;

    const profile = rows.length > 0
      ? rows[0]
      : (await sql`SELECT * FROM contractor_profiles WHERE user_id = ${user.id} LIMIT 1`)[0];

    return NextResponse.json({ success: true, profile });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/network/contractor-profile]', err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/network/contractor-profile
// Update capability profile fields.
// ---------------------------------------------------------------------------
const VALID_ECOSYSTEMS = ['enphase', 'solaredge', 'tesla', 'franklin', 'sungrow', 'goodwe', 'generac', 'sol-ark', 'ecoflow', 'other'];
const VALID_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];

export async function PATCH(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  try {
    const body = await req.json();

    const {
      battery_certified,
      commercial_capable,
      roofing_capable,
      steep_roof_capable,
      ev_charger_capable,
      generator_capable,
      service_states,
      service_zips,
      travel_radius_miles,
      equipment_ecosystems,
      min_project_kw,
      max_project_kw,
      network_active,
    } = body;

    // Validate arrays
    const cleanStates: string[] = Array.isArray(service_states)
      ? service_states.filter((s: unknown) => typeof s === 'string' && VALID_STATES.includes(s.toUpperCase())).map((s: string) => s.toUpperCase())
      : [];

    const cleanEcosystems: string[] = Array.isArray(equipment_ecosystems)
      ? equipment_ecosystems.filter((e: unknown) => typeof e === 'string' && VALID_ECOSYSTEMS.includes(e.toLowerCase())).map((e: string) => e.toLowerCase())
      : [];

    const cleanZips: string[] = Array.isArray(service_zips)
      ? service_zips.filter((z: unknown) => typeof z === 'string' && /^\d{5}$/.test(z)).slice(0, 200)
      : [];

    // Neon tagged template doesn't support .array() — pass arrays as JSON and cast in SQL
    const statesJson = JSON.stringify(cleanStates);
    const zipsJson = JSON.stringify(cleanZips);
    const ecosystemsJson = JSON.stringify(cleanEcosystems);

    const sql = await getDbReady();

    const [updated] = await sql`
      INSERT INTO contractor_profiles (
        user_id,
        battery_certified, commercial_capable, roofing_capable,
        steep_roof_capable, ev_charger_capable, generator_capable,
        service_states, service_zips, travel_radius_miles,
        equipment_ecosystems, min_project_kw, max_project_kw,
        network_active, profile_complete, updated_at
      )
      VALUES (
        ${user.id},
        ${battery_certified ?? false}, ${commercial_capable ?? false}, ${roofing_capable ?? false},
        ${steep_roof_capable ?? false}, ${ev_charger_capable ?? false}, ${generator_capable ?? false},
        (SELECT ARRAY(SELECT json_array_elements_text(${statesJson}::json))),
        (SELECT ARRAY(SELECT json_array_elements_text(${zipsJson}::json))),
        ${travel_radius_miles ?? 50},
        (SELECT ARRAY(SELECT json_array_elements_text(${ecosystemsJson}::json))),
        ${min_project_kw ?? null},
        ${max_project_kw ?? null},
        ${network_active ?? true},
        ${cleanStates.length > 0},
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        battery_certified    = EXCLUDED.battery_certified,
        commercial_capable   = EXCLUDED.commercial_capable,
        roofing_capable      = EXCLUDED.roofing_capable,
        steep_roof_capable   = EXCLUDED.steep_roof_capable,
        ev_charger_capable   = EXCLUDED.ev_charger_capable,
        generator_capable    = EXCLUDED.generator_capable,
        service_states       = EXCLUDED.service_states,
        service_zips         = EXCLUDED.service_zips,
        travel_radius_miles  = EXCLUDED.travel_radius_miles,
        equipment_ecosystems = EXCLUDED.equipment_ecosystems,
        min_project_kw       = EXCLUDED.min_project_kw,
        max_project_kw       = EXCLUDED.max_project_kw,
        network_active       = EXCLUDED.network_active,
        profile_complete     = EXCLUDED.profile_complete,
        updated_at           = EXCLUDED.updated_at
      RETURNING *
    `;

    return NextResponse.json({ success: true, profile: updated });
  } catch (err: unknown) {
    return handleRouteDbError('[PATCH /api/network/contractor-profile]', err);
  }
}
