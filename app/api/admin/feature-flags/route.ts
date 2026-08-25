/**
 * /api/admin/feature-flags — runtime toggle store for app feature flags.
 *
 * GET   — list all flags (super_admin only)
 * PUT   — { key, enabled, description? } upsert a flag (super_admin only)
 *
 * Every successful PUT is written to the hash-chained audit log as
 * `feature_flag_toggle` (category: 'config').
 *
 * Resolution in the layout: DB row → env var → off. The env var
 * SOLARDOG_ENABLED is the deploy default; this endpoint is the runtime override.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { handleRouteDbError } from '@/lib/db-neon';
import { listFeatureFlags, setFeatureFlag, featureFlagsTableExists } from '@/lib/db/featureFlags';
import { writeAuditLog } from '@/lib/auditLog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const admin = await requireAdminApi(_req);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const tableExists = await featureFlagsTableExists();
    if (!tableExists) {
      return NextResponse.json({
        success: false,
        error: 'app_feature_flags table missing — run migration 121',
        migrationRequired: '121_app_feature_flags.sql',
      }, { status: 503 });
    }

    const flags = await listFeatureFlags();
    return NextResponse.json({ success: true, flags });
  } catch (e) {
    return handleRouteDbError('[app/api/admin/feature-flags/route.ts] GET', e);
  }
}

// ─── PUT ────────────────────────────────────────────────────────────────────

const VALID_KEY = /^solardog_enabled$|^[a-z][a-z0-9_]{2,63}$/;

export async function PUT(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: { key?: unknown; enabled?: unknown; description?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key || !VALID_KEY.test(key)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid flag key. Must match /^[a-z][a-z0-9_]{2,63}$/ (or be exactly "solardog_enabled").',
    }, { status: 400 });
  }

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({
      success: false,
      error: 'Missing or non-boolean "enabled" field.',
    }, { status: 400 });
  }

  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim().slice(0, 280)
    : undefined;

  try {
    const tableExists = await featureFlagsTableExists();
    if (!tableExists) {
      return NextResponse.json({
        success: false,
        error: 'app_feature_flags table missing — run migration 121',
        migrationRequired: '121_app_feature_flags.sql',
      }, { status: 503 });
    }

    const updated = await setFeatureFlag(key, body.enabled, admin.id, description);

    // Audit log — every flip is recorded. category='config', action='feature_flag_toggle'.
    // writeAuditLog sets timestamp automatically (it's omitted from the input type).
    await writeAuditLog({
      category:                        'config',
      action:                          'feature_flag_toggle',
      actor_id:                        admin.id,
      actor_email:                     admin.email,
      actor_role:                      admin.role,
      target_type:                     'feature_flag',
      target_id:                       key,
      description:                     `Feature flag '${key}' set to ${body.enabled} by ${admin.email}`,
      metadata: {
        flag_key:        key,
        enabled:         body.enabled,
        description_set: description !== undefined,
        source:          'admin_api',
      },
      ip_address:                      req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip'),
      user_agent:                      req.headers.get('user-agent'),
      request_path:                    '/api/admin/feature-flags',
      actor_organization_id:           null,
      resource_owner_organization_id:  null,
    });

    return NextResponse.json({ success: true, flag: updated });
  } catch (e) {
    return handleRouteDbError('[app/api/admin/feature-flags/route.ts] PUT', e);
  }
}
