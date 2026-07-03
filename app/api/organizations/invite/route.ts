// ============================================================================
// /api/organizations/invite
//
// POST — send invite to an email address
// DELETE — revoke a pending invite (body: { inviteId })
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { syncSeatsForOrg } from '@/lib/stripe';
import { sendEmail } from '@/lib/email';
import { getBaseUrl } from '@/lib/env';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'standard');
  if (rlGuard.blocked) return rlGuard.response;

  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const { email } = await req.json();
    if (!email?.trim()) return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 });
    const normalizedEmail = email.trim().toLowerCase();

    const sql = await getDbReady();

    // Verify caller is org owner
    const callerRow = await sql`SELECT org_id, org_role FROM users WHERE id = ${user.id} LIMIT 1`;
    if (!callerRow[0]?.org_id || callerRow[0].org_role !== 'owner') {
      return NextResponse.json({ success: false, error: 'Only the org owner can invite members' }, { status: 403 });
    }
    const orgId = callerRow[0].org_id as string;

    // Check if already a member
    const alreadyMember = await sql`SELECT id FROM users WHERE email = ${normalizedEmail} AND org_id = ${orgId} LIMIT 1`;
    if (alreadyMember.length > 0) {
      return NextResponse.json({ success: false, error: 'That user is already in your organization' }, { status: 409 });
    }

    // Check if pending invite already exists
    const existing = await sql`
      SELECT id FROM org_invites
       WHERE org_id = ${orgId} AND invited_email = ${normalizedEmail}
         AND accepted_at IS NULL AND expires_at > now()
       LIMIT 1
    `;
    if (existing.length > 0) {
      return NextResponse.json({ success: false, error: 'An active invite already exists for that email' }, { status: 409 });
    }

    // Create invite
    const inviteRows = await sql`
      INSERT INTO org_invites (org_id, invited_email, invited_by)
      VALUES (${orgId}, ${normalizedEmail}, ${user.id})
      RETURNING id, invited_email, token, expires_at
    `;
    const invite = inviteRows[0];

    const orgRow = await sql`SELECT name FROM organizations WHERE id = ${orgId} LIMIT 1`;
    const orgName = (orgRow[0]?.name as string) || 'their team';
    const inviter = user.name || 'A teammate';
    const base = getBaseUrl();

    // If the user already has an account, auto-accept the invite
    const existingUser = await sql`SELECT id FROM users WHERE email = ${normalizedEmail} AND org_id IS NULL LIMIT 1`;
    if (existingUser.length > 0) {
      await sql`
        UPDATE users SET org_id = ${orgId}, org_role = 'member'
         WHERE email = ${normalizedEmail}
      `;
      await sql`
        UPDATE org_invites SET accepted_at = now() WHERE id = ${invite.id}
      `;
      // Bill the new seat on the owner's subscription (no-op if seat billing not set up).
      const seatSync = await syncSeatsForOrg(orgId);
      // Notify the added teammate (non-fatal).
      sendEmail({
        to: normalizedEmail,
        subject: `You've been added to ${orgName} on SolarPro`,
        html: `<p>${inviter} added you to <strong>${orgName}</strong> on SolarPro.</p><p>Just log in with this email to access the team's workspace.</p><p><a href="${base}/auth/login">Log in to SolarPro</a></p>`,
        text: `${inviter} added you to ${orgName} on SolarPro. Log in with this email: ${base}/auth/login`,
      }).catch(() => {});
      return NextResponse.json({ success: true, autoAccepted: true, invite, seatSync });
    }

    // New email — send an invite to sign up (they auto-join on register with this email).
    sendEmail({
      to: normalizedEmail,
      subject: `${inviter} invited you to join ${orgName} on SolarPro`,
      html: `<p>${inviter} invited you to join <strong>${orgName}</strong> on SolarPro — the solar design & proposal platform.</p><p>Create your account with <strong>this email address</strong> and you'll join the team automatically:</p><p><a href="${base}/auth/register">Accept the invite & sign up</a></p>`,
      text: `${inviter} invited you to join ${orgName} on SolarPro. Sign up with this email to join: ${base}/auth/register`,
    }).catch(() => {});

    return NextResponse.json({ success: true, autoAccepted: false, invite });
  } catch (e) {
    return handleRouteDbError('[POST /api/organizations/invite]', e);
  }
}

export async function DELETE(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'standard');
  if (rlGuard.blocked) return rlGuard.response;

  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const { inviteId } = await req.json();
    if (!inviteId) return NextResponse.json({ success: false, error: 'inviteId required' }, { status: 400 });

    const sql = await getDbReady();

    // Verify caller is org owner
    const callerRow = await sql`SELECT org_id, org_role FROM users WHERE id = ${user.id} LIMIT 1`;
    if (!callerRow[0]?.org_id || callerRow[0].org_role !== 'owner') {
      return NextResponse.json({ success: false, error: 'Only the org owner can revoke invites' }, { status: 403 });
    }

    await sql`DELETE FROM org_invites WHERE id = ${inviteId} AND org_id = ${callerRow[0].org_id}`;
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteDbError('[DELETE /api/organizations/invite]', e);
  }
}
