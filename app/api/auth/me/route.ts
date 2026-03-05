import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDb } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const sql = getDb();
    const rows = await sql`
      SELECT id, name, email, company, phone, role, email_verified, created_at
      FROM users WHERE id = ${user.id} LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const dbUser = rows[0];
    return NextResponse.json({
      success: true,
      data: {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        company: dbUser.company,
        phone: dbUser.phone,
        role: dbUser.role,
        emailVerified: dbUser.email_verified,
        createdAt: dbUser.created_at,
      }
    });

  } catch (error: any) {
    console.error('Auth me error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get user' }, { status: 500 });
  }
}