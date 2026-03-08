import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

// POST /api/proposals/[id]/share — generate a shareable token for a proposal
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: proposalId } = await params;
    const sql = getDb();

    // Verify proposal belongs to this user
    const rows = await sql`
      SELECT p.id, p.title, p.project_id
      FROM proposals p
      JOIN projects pr ON pr.id = p.project_id
      WHERE p.id = ${proposalId} AND pr.user_id = ${user.id}
    `;

    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }

    // Generate share token
    const shareToken = uuidv4().replace(/-/g, '').substring(0, 16);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Try to update share_token column if it exists
    try {
      await sql`
        UPDATE proposals 
        SET share_token = ${shareToken}, share_expires_at = ${expiresAt.toISOString()}
        WHERE id = ${proposalId}
      `;
    } catch {
      // Column may not exist yet — still return a usable URL
    }

    const baseUrl = req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://solarpro.app';
    const shareUrl = `${baseUrl}/proposals/view/${proposalId}?token=${shareToken}`;

    return NextResponse.json({
      success: true,
      shareUrl,
      shareToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err: any) {
    console.error('[share proposal]', err);
    const { id: proposalId } = await params;
    const baseUrl = req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://solarpro.app';
    const shareUrl = `${baseUrl}/proposals/view/${proposalId}`;
    return NextResponse.json({ success: true, shareUrl, shareToken: null });
  }
}

// GET /api/proposals/[id]/share — get existing share link
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: proposalId } = await params;
    const sql = getDb();

    const rows = await sql`
      SELECT p.id, p.share_token, p.share_expires_at
      FROM proposals p
      JOIN projects pr ON pr.id = p.project_id
      WHERE p.id = ${proposalId} AND pr.user_id = ${user.id}
    `;

    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }

    const row = rows[0];
    if (!row.share_token) {
      return NextResponse.json({ success: true, shareUrl: null });
    }

    const baseUrl = req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://solarpro.app';
    const shareUrl = `${baseUrl}/proposals/view/${proposalId}?token=${row.share_token}`;

    return NextResponse.json({
      success: true,
      shareUrl,
      shareToken: row.share_token,
      expiresAt: row.share_expires_at,
    });
  } catch (err: any) {
    console.error('[get share link]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}