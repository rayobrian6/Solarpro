export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export async function PUT(req: NextRequest) {
  try {
        const rl = await checkRateLimit('settings', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

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

    // SECURITY: field length caps
    if (name.trim().length    > 200) return NextResponse.json({ success: false, error: 'Name too long.'         }, { status: 400 });
    if (email.trim().length   > 320) return NextResponse.json({ success: false, error: 'Email too long.'        }, { status: 400 });
    if (company && typeof company === 'string' && company.trim().length > 200) return NextResponse.json({ success: false, error: 'Company name too long.' }, { status: 400 });
    if (phone   && typeof phone   === 'string' && phone.trim().length   > 30)  return NextResponse.json({ success: false, error: 'Phone number too long.'}, { status: 400 });

    const sql = await getDbReady();

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
  } catch (error: unknown) {
    return handleRouteDbError('app/api/settings/profile/route.ts', error);
  }
}