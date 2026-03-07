import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDb } from '@/lib/auth';

export async function PUT(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const body = await req.json();
    const { name, email, company, phone } = body;

    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: 'Name is required.' }, { status: 400 });
    }
    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Valid email is required.' }, { status: 400 });
    }

    const sql = getDb();

    // Check email uniqueness (allow same email for same user)
    const existing = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase().trim()} AND id != ${user.id} LIMIT 1
    `;
    if (existing.length > 0) {
      return NextResponse.json({ success: false, error: 'That email is already in use.' }, { status: 409 });
    }

    await sql`
      UPDATE users SET
        name       = ${name.trim()},
        email      = ${email.toLowerCase().trim()},
        company    = ${company?.trim() || null},
        phone      = ${phone?.trim() || null},
        updated_at = NOW()
      WHERE id = ${user.id}
    `;

    return NextResponse.json({ success: true, message: 'Profile updated.' });
  } catch (error: any) {
    console.error('Settings profile error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update profile.' }, { status: 500 });
  }
}