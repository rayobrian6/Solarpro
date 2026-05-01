// ============================================================================
// v47.434 Stage 9.1 — Admin Survey Webhook Delivery Log
//
// GET /api/admin/survey-webhook-log
//   Returns the most recent survey webhook deliveries for ops visibility.
//   Admin-only (requireAdminApi).
//
// Supports filters:
//   ?status=failed | verified | duplicate | ingested | replayed
//   ?source=survey (default, kept for future multi-source extension)
//   ?limit=100 (default 100, max 500)
//   ?cursor=<id>  (cursor-based pagination; opaque client-side)
//
// Response shape: { success, data: WebhookDelivery[], nextCursor?: string }
//
// v47.437 will add: POST /api/admin/survey-webhook-log/:id/replay
// ============================================================================
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { requireAdminApi } from '@/lib/adminAuth';

type WebhookStatus = 'received' | 'verified' | 'duplicate' | 'ingested' | 'failed' | 'replayed';
const VALID_STATUSES: readonly WebhookStatus[] = [
  'received',
  'verified',
  'duplicate',
  'ingested',
  'failed',
  'replayed',
] as const;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = await getDbReady();
    const url = new URL(req.url);

    const statusFilter = url.searchParams.get('status');
    const sourceFilter = url.searchParams.get('source') ?? 'survey';
    const limitParam = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isFinite(limitParam) ? Math.floor(limitParam) : DEFAULT_LIMIT),
    );

    if (statusFilter && !(VALID_STATUSES as readonly string[]).includes(statusFilter)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}`,
        },
        { status: 400 },
      );
    }

    // Simple WHERE expansion — keeps the typed-sql driver happy without
    // conditional template fragments.
    let rows;
    if (statusFilter) {
      rows = await sql`
        SELECT id, source, event_type, event_id,
               signature_header, timestamp_header, signature_valid,
               raw_body, status, error_message, project_id,
               received_at, processed_at, created_at
          FROM webhook_deliveries
         WHERE source = ${sourceFilter}
           AND status = ${statusFilter}
         ORDER BY received_at DESC
         LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT id, source, event_type, event_id,
               signature_header, timestamp_header, signature_valid,
               raw_body, status, error_message, project_id,
               received_at, processed_at, created_at
          FROM webhook_deliveries
         WHERE source = ${sourceFilter}
         ORDER BY received_at DESC
         LIMIT ${limit}
      `;
    }

    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    return handleRouteDbError('[GET /api/admin/survey-webhook-log]', err);
  }
}