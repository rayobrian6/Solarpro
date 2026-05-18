import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';

export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';
export const maxDuration = 30; // bumped from 15 — getDbReady cold-start headroom

/**
 * GET /api/proposals/[id]/signature
 *
 * Returns the signature status for a given proposal.
 * Public endpoint — no auth required. Returns safe, redacted data only.
 *
 * Response (unsigned):
 *   { signed: false }
 *
 * Response (signed):
 *   { signed: true, signerName: "John Smith", signedAt: "2024-01-15T10:30:00Z" }
 *
 * Note: IP address and raw signature image are never returned in this response
 * to protect homeowner privacy. Installer can access full data via admin API.
 *
 * Errors: 404 (not found), 503 (db down)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Missing proposal ID' }, { status: 400 });
  }

  let sql: Awaited<ReturnType<typeof getDbReady>>;
  try {
    sql = await getDbReady();
  } catch {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }

  try {
    const rows = await sql`
      SELECT id, status, signed_at, signer_name
      FROM proposals
      WHERE id = ${id}
      LIMIT 1
    `;

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    const p = rows[0];
    const isSigned = !!p.signed_at || p.status === 'accepted';

    if (isSigned) {
      return NextResponse.json({
        signed:     true,
        signerName: p.signer_name ?? null,
        signedAt:   p.signed_at   ?? null,
      });
    }

    return NextResponse.json({ signed: false });
  } catch (err) {
    console.error('[signature/route GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
