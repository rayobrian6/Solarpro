import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const sql = await getDbReady();
    const rows = await sql`SELECT * FROM utility_policies ORDER BY state, utility_name`;
    return NextResponse.json({ success: true, utilities: rows });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/utilities/route.ts]', e);
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });
  }

  try {
    const sql = await getDbReady();
    const b = await req.json();

    // SECURITY: field length caps — prevent oversized DB writes
    if (b.utility_name   && typeof b.utility_name   === 'string' && b.utility_name.length   > 200) return NextResponse.json({ success: false, error: 'utility_name too long (max 200).'   }, { status: 400 });
    if (b.state          && typeof b.state          === 'string' && b.state.length          > 10)  return NextResponse.json({ success: false, error: 'state too long (max 10).'           }, { status: 400 });
    if (b.country        && typeof b.country        === 'string' && b.country.length        > 10)  return NextResponse.json({ success: false, error: 'country too long (max 10).'         }, { status: 400 });
    if (b.rate_structure && typeof b.rate_structure === 'string' && b.rate_structure.length > 100) return NextResponse.json({ success: false, error: 'rate_structure too long (max 100).' }, { status: 400 });
    if (b.notes          && typeof b.notes          === 'string' && b.notes.length          > 2000) return NextResponse.json({ success: false, error: 'notes too long (max 2000).'         }, { status: 400 });

    const rows = await sql`
      INSERT INTO utility_policies
        (utility_name, state, country, net_metering, interconnection_limit_kw, buyback_rate, rate_structure, notes)
      VALUES
        (${b.utility_name}, ${b.state}, ${b.country ?? 'US'},
         ${b.net_metering ?? true}, ${b.interconnection_limit_kw ?? null},
         ${b.buyback_rate ?? null}, ${b.rate_structure ?? null}, ${b.notes ?? null})
      RETURNING *
    `;
    return NextResponse.json({ success: true, utility: rows[0] });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/utilities/route.ts]', e);
  }
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });
  }

  try {
    const sql = await getDbReady();
    const b = await req.json();
    if (!b.id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });

    // SECURITY: UUID validation for id
    if (!isValidUUID(b.id)) return NextResponse.json({ success: false, error: 'Invalid id format.' }, { status: 400 });

    // SECURITY: field length caps
    if (b.utility_name   && typeof b.utility_name   === 'string' && b.utility_name.length   > 200) return NextResponse.json({ success: false, error: 'utility_name too long (max 200).'   }, { status: 400 });
    if (b.state          && typeof b.state          === 'string' && b.state.length          > 10)  return NextResponse.json({ success: false, error: 'state too long (max 10).'           }, { status: 400 });
    if (b.country        && typeof b.country        === 'string' && b.country.length        > 10)  return NextResponse.json({ success: false, error: 'country too long (max 10).'         }, { status: 400 });
    if (b.rate_structure && typeof b.rate_structure === 'string' && b.rate_structure.length > 100) return NextResponse.json({ success: false, error: 'rate_structure too long (max 100).' }, { status: 400 });
    if (b.notes          && typeof b.notes          === 'string' && b.notes.length          > 2000) return NextResponse.json({ success: false, error: 'notes too long (max 2000).'         }, { status: 400 });

    await sql`
      UPDATE utility_policies SET
        utility_name             = COALESCE(${b.utility_name             ?? null}, utility_name),
        state                    = COALESCE(${b.state                    ?? null}, state),
        country                  = COALESCE(${b.country                  ?? null}, country),
        net_metering             = COALESCE(${b.net_metering             ?? null}, net_metering),
        interconnection_limit_kw = COALESCE(${b.interconnection_limit_kw ?? null}, interconnection_limit_kw),
        buyback_rate             = COALESCE(${b.buyback_rate             ?? null}, buyback_rate),
        rate_structure           = COALESCE(${b.rate_structure           ?? null}, rate_structure),
        notes                    = COALESCE(${b.notes                    ?? null}, notes),
        updated_at               = NOW()
      WHERE id = ${b.id}
    `;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/utilities/route.ts]', e);
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });
  }

  try {
    const sql = await getDbReady();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });

    // SECURITY: UUID validation for id
    if (!isValidUUID(id)) return NextResponse.json({ success: false, error: 'Invalid id format.' }, { status: 400 });

    await sql`DELETE FROM utility_policies WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/utilities/route.ts]', e);
  }
}