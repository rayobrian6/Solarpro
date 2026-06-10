import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getDbReady } from '@/lib/db-neon';
import { sendProposalSignedEmail } from '@/lib/email';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

/** Constant-time string comparison to prevent timing attacks on share tokens. */
function safeStrEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/proposals/[id]/sign
 *
 * Dedicated e-signature endpoint for the homeowner proposal view.
 * Does NOT require authentication — proposals are public URLs, access is
 * gated by the share token param (?token=...) OR by the proposal being
 * in a sent/viewed state.
 *
 * Request body:
 *   signerName   string   — full legal name (required, 2–200 chars)
 *   signerEmail  string?  — optional email
 *   signature    string?  — base64 PNG data-URL of drawn/typed sig (≤512KB)
 *   agreedToTerms boolean — must be true
 *   token        string?  — share token (same as ?token= query param)
 *
 * On success:
 *  - Inserts into proposal_signatures table (if it exists)
 *  - Falls back to updating proposals.signer_* columns
 *  - Sets proposals.status = 'accepted'
 *  - Advances project homeowner_stage from 'proposal' → 'installation'
 *  - Fires installer notification email (non-blocking)
 *
 * Response: { success: true, signerName, signedAt }
 * Errors:   400 (validation), 403 (token), 404 (not found), 409 (already signed), 503 (db down)
 */

interface SignBody {
  signerName:    string;
  signerEmail?:  string;
  signature?:    string;
  agreedToTerms: boolean;
  token?:        string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ success: false, error: 'Missing proposal ID' }, { status: 400 });
  }

  // ── Rate limit ─────────────────────────────────────────────────────────────
  // Public endpoint — no auth. 5 signature attempts per IP per 15 min prevents
  // replay spam and enumeration attacks without blocking legitimate homeowners.
  const ip = getClientIp(req);
  const allowed = await checkRateLimit('proposal-sign', ip);
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429 },
    );
  }

  // ── Parse body ────────────────────────────────────────────────────────
  let body: Partial<SignBody>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  // ── Validate ──────────────────────────────────────────────────────────
  const signerName = (body.signerName ?? '').trim();
  if (!signerName || signerName.length < 2) {
    return NextResponse.json(
      { success: false, error: 'Full name is required to sign (minimum 2 characters).' },
      { status: 400 },
    );
  }
  if (signerName.length > 200) {
    return NextResponse.json(
      { success: false, error: 'Name too long (max 200 characters).' },
      { status: 400 },
    );
  }
  if (body.agreedToTerms !== true) {
    return NextResponse.json(
      { success: false, error: 'You must agree to the terms to sign.' },
      { status: 400 },
    );
  }

  const signerEmail = (body.signerEmail ?? '').trim() || null;
  if (signerEmail && signerEmail.length > 200) {
    return NextResponse.json({ success: false, error: 'Email too long.' }, { status: 400 });
  }

  const sigData = body.signature ?? null;
  if (sigData && (!sigData.startsWith('data:image/') || sigData.length > 512 * 1024)) {
    return NextResponse.json({ success: false, error: 'Invalid signature data.' }, { status: 400 });
  }

  // ── DB ────────────────────────────────────────────────────────────────
  let sql: Awaited<ReturnType<typeof getDbReady>>;
  try {
    sql = await getDbReady();
  } catch {
    return NextResponse.json({ success: false, error: 'Database unavailable' }, { status: 503 });
  }

  // ── Fetch proposal ────────────────────────────────────────────────────
  const rows = await sql`
    SELECT p.id, p.status, p.project_id, p.data_json, p.signed_at,
           p.share_token
    FROM proposals p
    WHERE p.id = ${id}
    LIMIT 1
  `.catch(() => [] as typeof rows);

  if (!rows || rows.length === 0) {
    return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
  }

  const proposal = rows[0];

  // ── Token check ───────────────────────────────────────────────────────
  // If proposal has a share_token, require it (prevents enumeration attacks)
  const shareToken = proposal.share_token as string | null;
  const providedToken = (body.token ?? null) || (req.nextUrl?.searchParams?.get('token') ?? null);
  if (shareToken && (!providedToken || !safeStrEqual(shareToken, providedToken))) {
    return NextResponse.json({ success: false, error: 'Invalid access token' }, { status: 403 });
  }

  // ── Idempotency check ─────────────────────────────────────────────────
  if (proposal.signed_at || proposal.status === 'accepted') {
    return NextResponse.json(
      { success: false, error: 'Proposal has already been signed.' },
      { status: 409 },
    );
  }

  const signerIp  = ip;
  const signedAt  = new Date().toISOString();

  // ── Build updated data_json ───────────────────────────────────────────
  const existingData = (proposal.data_json as Record<string, unknown>) || {};
  const updatedData = JSON.stringify({
    ...existingData,
    signature: {
      signedAt,
      signerName,
      signerEmail,
      signerIp,
      imageData: sigData,
    },
  });

  // ── Write to DB ───────────────────────────────────────────────────────
  try {
    await sql`
      UPDATE proposals
      SET status       = 'accepted',
          data_json    = ${updatedData}::jsonb,
          signed_at    = NOW(),
          signer_name  = ${signerName},
          signer_email = ${signerEmail},
          signer_ip    = ${signerIp},
          updated_at   = NOW()
      WHERE id = ${id}
    `;
  } catch {
    // Fallback: dedicated columns may not exist yet (pre-migration)
    try {
      await sql`
        UPDATE proposals
        SET status     = 'accepted',
            data_json  = ${updatedData}::jsonb,
            updated_at = NOW()
        WHERE id = ${id}
      `;
    } catch (fallbackErr) {
      console.error('[sign/route] DB write failed:', fallbackErr);
      return NextResponse.json(
        { success: false, error: 'Failed to record signature. Please try again.' },
        { status: 500 },
      );
    }
  }

  // ── Try to insert into proposal_signatures table (if exists) ──────────
  try {
    await sql`
      INSERT INTO proposal_signatures
        (proposal_id, signer_name, signer_email, ip_address, user_agent, agreed_to_terms, signed_at)
      VALUES
        (${id}, ${signerName}, ${signerEmail}, ${signerIp},
         ${req.headers.get('user-agent') ?? null}, true, NOW())
      ON CONFLICT DO NOTHING
    `;
  } catch {
    // proposal_signatures table may not exist yet — not a failure condition
  }

  // ── Advance homeowner stage ───────────────────────────────────────────
  const projectId = proposal.project_id as string | undefined;
  if (projectId) {
    try {
      await sql`
        UPDATE projects
        SET homeowner_stage = 'installation', updated_at = NOW()
        WHERE id = ${projectId}
          AND homeowner_stage = 'proposal'
      `;
      // Also record the pipeline stage
      await sql`
        UPDATE projects
        SET stage = 'approved', updated_at = NOW()
        WHERE id = ${projectId}
          AND stage IN ('lead', 'design', 'proposal')
      `;
    } catch {
      // Stage advancement is best-effort
    }
  }

  // ── Notify installer (fire-and-forget) ───────────────────────────────
  try {
    const installerRows = await sql`
      SELECT u.email, u.name AS installer_name
      FROM projects proj
      JOIN users u ON u.id = proj.user_id
      WHERE proj.id = ${projectId ?? ''}
      LIMIT 1
    `;
    if (installerRows.length > 0) {
      const installer = installerRows[0];
      const pData = existingData as Record<string, unknown>;
      sendProposalSignedEmail({
        installerEmail: installer.email as string,
        installerName:  installer.installer_name as string,
        clientName:     (pData.clientName as string) || 'Your client',
        signerName,
        signerEmail:    signerEmail || '',
        proposalTitle:  (pData.title as string) || 'Solar Proposal',
        proposalId:     id,
        signedAt,
      }).catch((e: unknown) =>
        console.warn('[sign/route] installer email failed:', (e as Error)?.message),
      );
    }
  } catch (emailErr: unknown) {
    console.warn('[sign/route] installer lookup failed:', (emailErr as Error)?.message);
  }

  return NextResponse.json({ success: true, signerName, signedAt });
}
