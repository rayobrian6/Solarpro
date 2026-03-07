import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  getDb, hashPassword, signToken, makeSessionCookie, SessionUser
} from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, password, company, phone } = body;

    // Validate
    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: 'Full name is required.' }, { status: 400 });
    }
    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Valid email is required.' }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
    }

    const sql = getDb();

    // Check if email already exists
    const existing = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase().trim()} LIMIT 1
    `;
    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: 'An account with this email already exists.' },
        { status: 409 }
      );
    }

    // Hash password and create user
    const hashedPassword = await hashPassword(password);
    const userId = uuidv4();

    await sql`
      INSERT INTO users (id, name, email, password_hash, company, phone, role, email_verified)
      VALUES (
        ${userId},
        ${name.trim()},
        ${email.toLowerCase().trim()},
        ${hashedPassword},
        ${company?.trim() || null},
        ${phone?.trim() || null},
        'user',
        false
      )
    `;

    // Create session token
    const sessionUser: SessionUser = {
      id: userId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      company: company?.trim() || undefined,
      role: 'user',
    };

    const token = signToken(sessionUser);
    const cookieHeader = makeSessionCookie(token);

    return NextResponse.json(
      { success: true, data: { user: sessionUser } },
      {
        status: 201,
        headers: { 'Set-Cookie': cookieHeader },
      }
    );

  } catch (error: any) {
    console.error('Register error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create account. Please try again.' },
      { status: 500 }
    );
  }
}