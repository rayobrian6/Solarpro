import { NextRequest, NextResponse } from 'next/server';
import {
  getDb, verifyPassword, signToken, makeSessionCookie, SessionUser
} from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email?.trim() || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required.' },
        { status: 400 }
      );
    }

    const sql = getDb();

    // Fetch user — role is fetched but NOT put in JWT
    const rows = await sql`
      SELECT id, name, email, password_hash, company, phone, role
      FROM users
      WHERE email = ${email.toLowerCase().trim()}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const user = rows[0];

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    // JWT contains ONLY identity — role is NOT included
    const sessionUser: SessionUser = {
      id:      user.id,
      name:    user.name,
      email:   user.email,
      company: user.company || undefined,
    };

    const token = signToken(sessionUser);
    const cookieHeader = makeSessionCookie(token);

    // Return role in response body for client UI use, but NOT in JWT
    return NextResponse.json(
      { success: true, data: { user: { ...sessionUser, role: user.role || 'user' } } },
      {
        status: 200,
        headers: { 'Set-Cookie': cookieHeader },
      }
    );

  } catch (error: any) {
    const msg = error?.message || String(error);
    // Surface DB config errors clearly in the terminal
    if (msg.includes('DATABASE_URL') || msg.includes('database') || msg.includes('neon')) {
      console.error('\n[/api/auth/login] DATABASE ERROR — auth will not work until fixed:');
      console.error(' ', msg);
      console.error('  -> Set DATABASE_URL in solarpro/.env.local and restart npm run dev\n');
      return NextResponse.json(
        { success: false, error: 'Database not configured. Check server console for instructions.' },
        { status: 503 }
      );
    }
    console.error('[/api/auth/login] Login error:', error);
    return NextResponse.json(
      { success: false, error: 'Login failed. Please try again.' },
      { status: 500 }
    );
  }
}