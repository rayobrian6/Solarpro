import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

// GET with secret param — easy to use from browser address bar
// Usage: /api/admin/set-roles?secret=YOUR_MIGRATE_SECRET
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');

  // If no secret, just show current roles
  if (!secret) {
    try {
      const sql = getDb();
      const rows = await sql`
        SELECT email, role FROM users
        WHERE email IN ('raymond.obrian@yahoo.com', 'carpenterjames88@gmail.com', 'cody@underthesun.solutions')
        ORDER BY email
      `;
      return NextResponse.json({ 
        success: true, 
        roles: rows,
        usage: 'Add ?secret=YOUR_MIGRATE_SECRET to this URL to update roles'
      });
    } catch (err: any) {
      return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
  }

  // Verify secret
  const migrateSecret = process.env.MIGRATE_SECRET;
  if (!migrateSecret || secret !== migrateSecret) {
    return NextResponse.json({ success: false, error: 'Invalid secret' }, { status: 403 });
  }

  try {
    const sql = getDb();

    const r1 = await sql`
      UPDATE users SET role = 'super_admin'
      WHERE email = 'raymond.obrian@yahoo.com'
      RETURNING id, email, role
    `;
    const r2 = await sql`
      UPDATE users SET role = 'admin'
      WHERE email = 'carpenterjames88@gmail.com'
      RETURNING id, email, role
    `;
    const r3 = await sql`
      UPDATE users SET role = 'admin'
      WHERE email = 'cody@underthesun.solutions'
      RETURNING id, email, role
    `;

    return NextResponse.json({
      success: true,
      updated: {
        raymond: r1[0] ?? 'not found',
        james:   r2[0] ?? 'not found',
        cody:    r3[0] ?? 'not found',
      },
      nextStep: 'Log out and log back in, then go to /admin',
    });

  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}