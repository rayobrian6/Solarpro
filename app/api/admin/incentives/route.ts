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
    const rows = await sql`SELECT * FROM incentive_overrides ORDER BY created_at DESC`;
    return NextResponse.json({ success: true, incentives: rows });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/incentives/route.ts]', e);
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
    if (b.country      && typeof b.country      === 'string' && b.country.length      > 10)  return NextResponse.json({ success: false, error: 'country too long (max 10).'       }, { status: 400 });
    if (b.state        && typeof b.state        === 'string' && b.state.length        > 10)  return NextResponse.json({ success: false, error: 'state too long (max 10).'         }, { status: 400 });
    if (b.utility      && typeof b.utility      === 'string' && b.utility.length      > 200) return NextResponse.json({ success: false, error: 'utility too long (max 200).'      }, { status: 400 });
    if (b.program_name && typeof b.program_name === 'string' && b.program_name.length > 200) return NextResponse.json({ success: false, error: 'program_name too long (max 200).' }, { status: 400 });
    if (b.type         && typeof b.type         === 'string' && b.type.length         > 50)  return NextResponse.json({ success: false, error: 'type too long (max 50).'          }, { status: 400 });
    if (b.value_type   && typeof b.value_type   === 'string' && b.value_type.length   > 50)  return NextResponse.json({ success: false, error: 'value_type too long (max 50).'    }, { status: 400 });
    if (b.notes        && typeof b.notes        === 'string' && b.notes.length        > 2000) return NextResponse.json({ success: false, error: 'notes too long (max 2000).'       }, { status: 400 });

    // Required fields — these columns are NOT NULL; without this a missing field
    // either 500s on the insert or creates a meaningless override row.
    if (!b.program_name || typeof b.program_name !== 'string') return NextResponse.json({ success: false, error: 'program_name is required.' }, { status: 400 });
    if (!b.type || typeof b.type !== 'string') return NextResponse.json({ success: false, error: 'type is required.' }, { status: 400 });
    if (b.value == null || !Number.isFinite(Number(b.value))) return NextResponse.json({ success: false, error: 'value is required and must be a number.' }, { status: 400 });

    const rows = await sql`
      INSERT INTO incentive_overrides
        (country, state, utility, program_name, type, value, value_type, start_date, end_date, active, notes, created_by)
      VALUES
        (${b.country ?? 'US'}, ${b.state ?? null}, ${b.utility ?? null},
         ${b.program_name}, ${b.type}, ${b.value}, ${b.value_type ?? 'percent'},
         ${b.start_date ?? null}, ${b.end_date ?? null}, ${b.active ?? true},
         ${b.notes ?? null}, ${admin.email})
      RETURNING *
    `;
    return NextResponse.json({ success: true, incentive: rows[0] });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/incentives/route.ts]', e);
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
    if (b.country      && typeof b.country      === 'string' && b.country.length      > 10)  return NextResponse.json({ success: false, error: 'country too long (max 10).'       }, { status: 400 });
    if (b.state        && typeof b.state        === 'string' && b.state.length        > 10)  return NextResponse.json({ success: false, error: 'state too long (max 10).'         }, { status: 400 });
    if (b.utility      && typeof b.utility      === 'string' && b.utility.length      > 200) return NextResponse.json({ success: false, error: 'utility too long (max 200).'      }, { status: 400 });
    if (b.program_name && typeof b.program_name === 'string' && b.program_name.length > 200) return NextResponse.json({ success: false, error: 'program_name too long (max 200).' }, { status: 400 });
    if (b.type         && typeof b.type         === 'string' && b.type.length         > 50)  return NextResponse.json({ success: false, error: 'type too long (max 50).'          }, { status: 400 });
    if (b.value_type   && typeof b.value_type   === 'string' && b.value_type.length   > 50)  return NextResponse.json({ success: false, error: 'value_type too long (max 50).'    }, { status: 400 });
    if (b.notes        && typeof b.notes        === 'string' && b.notes.length        > 2000) return NextResponse.json({ success: false, error: 'notes too long (max 2000).'       }, { status: 400 });

    await sql`
      UPDATE incentive_overrides SET
        country      = COALESCE(${b.country      ?? null}, country),
        state        = COALESCE(${b.state        ?? null}, state),
        utility      = COALESCE(${b.utility      ?? null}, utility),
        program_name = COALESCE(${b.program_name ?? null}, program_name),
        type         = COALESCE(${b.type         ?? null}, type),
        value        = COALESCE(${b.value        ?? null}, value),
        value_type   = COALESCE(${b.value_type   ?? null}, value_type),
        start_date   = COALESCE(${b.start_date   ?? null}, start_date),
        end_date     = COALESCE(${b.end_date     ?? null}, end_date),
        active       = COALESCE(${b.active       ?? null}, active),
        notes        = COALESCE(${b.notes        ?? null}, notes),
        updated_at   = NOW()
      WHERE id = ${b.id}
    `;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/incentives/route.ts]', e);
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

    await sql`DELETE FROM incentive_overrides WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/incentives/route.ts]', e);
  }
}