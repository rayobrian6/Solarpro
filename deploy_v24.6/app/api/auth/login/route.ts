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

    // Find user by email
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

    // Verify password
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    // Create session token
    const sessionUser: SessionUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      company: user.company || undefined,
      role: user.role || 'user',
    };

    const token = signToken(sessionUser);
    const cookieHeader = makeSessionCookie(token);

    return NextResponse.json(
      { success: true, data: { user: sessionUser } },
      {
        status: 200,
        headers: { 'Set-Cookie': cookieHeader },
      }
    );

  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, error: 'Login failed. Please try again.' },
      { status: 500 }
    );
  }
}