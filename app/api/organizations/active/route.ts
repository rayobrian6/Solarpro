// ============================================================================
// /api/organizations/active
//
// Phase 1B — Organization Authority Foundation
//
// GET  — resolve and return the user's currently active organization context
// POST — set the user's active organization context (body: { organizationId })
//
// This route uses the server-authoritative active org context resolution
// from lib/organizations/context.ts. When the ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED
// flag is off, the route falls back to legacy behavior (returning the
// user's users.org_id).
//
// Feature flag: ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { rateLimitGuard } from '@/lib/rateLimitGuard';
import {
  resolveActiveOrg,
  setActiveOrg,
  clearActiveOrg,
  isOrgFeatureEnabled,
} from '@/lib/organizations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/organizations/active
 *
 * Returns the user's currently active organization context, resolved
 * server-side. The response includes the org ID, the user's role within
 * that org, and the source of the resolution (explicit context, primary
 * membership, or legacy fallback).
 */
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const resolved = await resolveActiveOrg(user.id);

    if (!resolved) {
      return NextResponse.json({
        success: true,
        activeOrg: null,
        message: 'No active organization context found',
      });
    }

    return NextResponse.json({
      success: true,
      activeOrg: {
        organizationId: resolved.organizationId,
        orgName: resolved.orgName,
        role: resolved.role,
        source: resolved.source,
      },
    });
  } catch (e) {
    return handleRouteDbError('[GET /api/organizations/active]', e);
  }
}

/**
 * POST /api/organizations/active
 *
 * Sets the user's active organization context. The user must be an active
 * member of the target org. This is a server-authoritative operation — the
 * client requests a context switch, but the server validates membership
 * before persisting.
 *
 * Body: { organizationId: string }
 *
 * When ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED is off, returns 501 indicating
 * the feature is not enabled (the context system is not yet active).
 */
export async function POST(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'standard');
  if (rlGuard.blocked) return rlGuard.response;

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Feature flag check — context switching requires the active org
  // context feature to be enabled.
  if (!isOrgFeatureEnabled('ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED')) {
    return NextResponse.json(
      { success: false, error: 'Active organization context switching is not enabled' },
      { status: 501 }
    );
  }

  try {
    const body = await req.json();
    const organizationId = body?.organizationId;

    if (!organizationId || !isValidUUID(organizationId)) {
      return NextResponse.json(
        { success: false, error: 'A valid organizationId is required' },
        { status: 400 }
      );
    }

    const result = await setActiveOrg(user.id, organizationId);

    if (!result.ok) {
      const errCode = (result as { ok: false; error: string }).error;
      const status =
        errCode === 'NOT_A_MEMBER' ? 403 :
        errCode === 'ORG_NOT_ACTIVE' ? 403 :
        errCode === 'INVALID_ID' ? 400 :
        errCode === 'FEATURE_DISABLED' ? 501 :
        400;

      const messages: Record<string, string> = {
        NOT_A_MEMBER: 'You are not a member of this organization',
        ORG_NOT_ACTIVE: 'This organization is not active',
        INVALID_ID: 'Invalid ID provided',
        FEATURE_DISABLED: 'This feature is not enabled',
      };

      return NextResponse.json(
        { success: false, error: messages[errCode] ?? errCode, code: errCode },
        { status }
      );
    }

    // Re-resolve to get the full context (with role and name)
    const resolved = await resolveActiveOrg(user.id);

    return NextResponse.json({
      success: true,
      activeOrg: resolved
        ? {
            organizationId: resolved.organizationId,
            orgName: resolved.orgName,
            role: resolved.role,
            source: resolved.source,
          }
        : null,
    });
  } catch (e) {
    return handleRouteDbError('[POST /api/organizations/active]', e);
  }
}

/**
 * DELETE /api/organizations/active
 *
 * Clears the user's active organization context. The next resolution
 * will fall back to the primary membership or legacy org_id.
 */
export async function DELETE(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'standard');
  if (rlGuard.blocked) return rlGuard.response;

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!isOrgFeatureEnabled('ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED')) {
    return NextResponse.json(
      { success: false, error: 'Active organization context switching is not enabled' },
      { status: 501 }
    );
  }

  try {
    await clearActiveOrg(user.id);
    return NextResponse.json({ success: true, message: 'Active organization context cleared' });
  } catch (e) {
    return handleRouteDbError('[DELETE /api/organizations/active]', e);
  }
}
