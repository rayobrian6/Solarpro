export const maxDuration = 30;
export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// ---------------------------------------------------------------------------
// POST /api/leads/public
// Public (no-auth) lead capture endpoint.
// Called from the /get-a-quote page by prospective homeowners.
//
// Rate-limited per IP: 5 submissions per 15 minutes.
// Writes to the `leads` table with user_id = NULL (unassigned).
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // Tight rate limit for public endpoint
  const rl = await checkRateLimit('public_lead', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many submissions. Please wait a few minutes and try again.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();

    const rawName    = typeof body?.name    === 'string' ? body.name.trim()    : '';
    const rawEmail   = typeof body?.email   === 'string' ? body.email.trim().toLowerCase() : '';
    const rawPhone   = typeof body?.phone   === 'string' ? body.phone.trim()   : '';
    const rawAddress = typeof body?.address === 'string' ? body.address.trim() : '';
    const rawMessage = typeof body?.message === 'string' ? body.message.trim() : '';

    // --- Validation ---
    if (!rawName || rawName.length < 2 || rawName.length > 200) {
      return NextResponse.json(
        { success: false, error: 'Please enter your full name.' },
        { status: 400 }
      );
    }
    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) || rawEmail.length > 254) {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }
    if (rawPhone && rawPhone.length > 30) {
      return NextResponse.json(
        { success: false, error: 'Phone number is too long.' },
        { status: 400 }
      );
    }
    if (rawAddress && rawAddress.length > 500) {
      return NextResponse.json(
        { success: false, error: 'Address is too long.' },
        { status: 400 }
      );
    }
    if (rawMessage && rawMessage.length > 2000) {
      return NextResponse.json(
        { success: false, error: 'Message is too long (max 2000 characters).' },
        { status: 400 }
      );
    }

    // Build notes from message + basic source tag
    const notes = [
      rawMessage ? `Message: ${rawMessage}` : null,
      'Source: public lead form (/get-a-quote)',
    ].filter(Boolean).join('\n');

    const sql = await getDbReady();

    // Insert with user_id = NULL (unassigned — admin will claim/assign)
    const rows = await sql`
      INSERT INTO leads (user_id, name, phone, email, address, notes, status)
      VALUES (
        NULL,
        ${rawName},
        ${rawPhone || null},
        ${rawEmail},
        ${rawAddress || null},
        ${notes},
        'new'
      )
      RETURNING id
    `;

    return NextResponse.json(
      { success: true, leadId: rows[0]?.id ?? null },
      { status: 201 }
    );
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/leads/public]', err);
  }
}

// ---------------------------------------------------------------------------
// OPTIONS — CORS preflight (in case form is embedded on external pages)
// ---------------------------------------------------------------------------
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}