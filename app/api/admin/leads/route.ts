export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// ---------------------------------------------------------------------------
// GET /api/admin/leads?search=&status=&page=&limit=
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search  = (searchParams.get('search') || '').slice(0, 200);
  const status  = searchParams.get('status') || 'all';
  const page    = Math.max(1, parseInt(searchParams.get('page')  || '1'));
  const limit   = Math.min(100, parseInt(searchParams.get('limit') || '50'));
  const offset  = (page - 1) * limit;

  try {
    const sql = await getDbReady();
    const pattern = `%${search}%`;

    const [rows, countRows] = await Promise.all([
      status !== 'all'
        ? sql`
            SELECT l.*,
                   u.name AS owner_name, u.email AS owner_email,
                   p.name AS project_name
              FROM leads l
              LEFT JOIN users u ON u.id = l.user_id
              LEFT JOIN projects p ON p.id = l.converted_project_id
             WHERE l.status = ${status}
               AND (l.name    ILIKE ${pattern}
                    OR l.email   ILIKE ${pattern}
                    OR l.address ILIKE ${pattern}
                    OR l.phone   ILIKE ${pattern})
             ORDER BY l.created_at DESC
             LIMIT ${limit} OFFSET ${offset}
          `
        : sql`
            SELECT l.*,
                   u.name AS owner_name, u.email AS owner_email,
                   p.name AS project_name
              FROM leads l
              LEFT JOIN users u ON u.id = l.user_id
              LEFT JOIN projects p ON p.id = l.converted_project_id
             WHERE (l.name    ILIKE ${pattern}
                    OR l.email   ILIKE ${pattern}
                    OR l.address ILIKE ${pattern}
                    OR l.phone   ILIKE ${pattern})
             ORDER BY l.created_at DESC
             LIMIT ${limit} OFFSET ${offset}
          `,
      status !== 'all'
        ? sql`
            SELECT COUNT(*) AS total FROM leads l
             WHERE l.status = ${status}
               AND (l.name    ILIKE ${pattern}
                    OR l.email   ILIKE ${pattern}
                    OR l.address ILIKE ${pattern}
                    OR l.phone   ILIKE ${pattern})
          `
        : sql`
            SELECT COUNT(*) AS total FROM leads l
             WHERE (l.name    ILIKE ${pattern}
                    OR l.email   ILIKE ${pattern}
                    OR l.address ILIKE ${pattern}
                    OR l.phone   ILIKE ${pattern})
          `,
    ]);

    return NextResponse.json({
      success: true,
      leads: rows,
      total: parseInt(String(countRows[0]?.total ?? '0')),
      page,
      limit,
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/admin/leads]', err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/leads — create a new lead (admin creates on behalf of user)
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { userId, name, phone, email, address, notes, status, lead_source } = body;

    // userId is optional for inline lead creation (not yet tied to a system user)
    if (userId && typeof userId !== 'string') {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ success: false, error: 'name must be at least 2 characters' }, { status: 400 });
    }

    const validStatuses = ['new', 'contacted', 'qualified', 'converted', 'closed'];
    const leadStatus = validStatuses.includes(status) ? status : 'new';

    const validSources = ['referral', 'website', 'door_knock', 'phone', 'social_media', 'paid_ad', 'trade_show', 'partner', 'other'];
    const leadSource = validSources.includes(lead_source) ? lead_source : null;

    const sql = await getDbReady();

    // Try insert. If user_id NOT NULL constraint fails, run migration and retry.
    let rows;
    try {
      rows = await sql`
        INSERT INTO leads (user_id, name, phone, email, address, notes, status, lead_source)
        VALUES (
          ${userId || null},
          ${name.trim()},
          ${phone || null},
          ${email ? email.trim().toLowerCase() : null},
          ${address || null},
          ${notes || null},
          ${leadStatus},
          ${leadSource}
        )
        RETURNING *
      `;
    } catch (insertErr: any) {
      // Check if error is about user_id NOT NULL constraint
      if (insertErr?.code === '23502' && insertErr?.column === 'user_id') {
        // Run migration to make user_id nullable
        try {
          await sql`ALTER TABLE leads ALTER COLUMN user_id DROP NOT NULL`;
          // Retry insert
          rows = await sql`
            INSERT INTO leads (user_id, name, phone, email, address, notes, status, lead_source)
            VALUES (
              ${userId || null},
              ${name.trim()},
              ${phone || null},
              ${email ? email.trim().toLowerCase() : null},
              ${address || null},
              ${notes || null},
              ${leadStatus},
              ${leadSource}
            )
            RETURNING *
          `;
        } catch (migrateErr: unknown) {
          return handleRouteDbError('[POST /api/admin/leads] migrate', migrateErr);
        }
      } else {
        // Some other error
        throw insertErr;
      }
    }

    return NextResponse.json({ success: true, lead: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/admin/leads]', err);
  }
}