// app/api/privacy/export-data/route.ts
// GDPR/CCPA Right-to-Access and Right-to-Delete endpoints
// Supports POL-SEC-007 (Data Retention & Disposal) and SOC 2 P1.1 (Privacy)

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbWithRetry } from '@/lib/db-ready';
import { writeAuditLog, auditCompliance } from '@/lib/auditLog';
import { getClientIp } from '@/lib/rateLimiter';
import { checkRateLimit } from '@/lib/rateLimiter';

// ─── GET /api/privacy/export-data ────────────────────────────────────────────
// Right-to-Access: Export all data associated with the authenticated user.
// Returns a JSON object containing all user data from all relevant tables.
export async function GET(req: NextRequest) {
  // Rate limit: 5 exports per hour per user
  const ip = getClientIp(req);
  const rl = await checkRateLimit('delete-account', ip); // Reuse tight limit
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const user = await getUserFromRequest(req);
  if (!user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const sql = await getDbWithRetry();

    // Collect all data associated with this user
    const [userRow, projects, clients, proposals, activityLog] = await Promise.all([
      sql`SELECT id, name, email, role, company, created_at, updated_at FROM users WHERE id = ${user.id}`,
      sql`SELECT * FROM projects WHERE user_id = ${user.id} OR created_by = ${user.id}`,
      sql`SELECT * FROM clients WHERE user_id = ${user.id}`,
      sql`SELECT * FROM proposals WHERE user_id = ${user.id}`,
      sql`SELECT * FROM activity_log WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 500`,
    ]);

    const exportData = {
      export_date: new Date().toISOString(),
      user: userRow[0] ?? null,
      projects: projects ?? [],
      clients: clients ?? [],
      proposals: proposals ?? [],
      recent_activity: activityLog ?? [],
      data_controller: 'SolarPro',
      retention_policy: 'See https://solarpro.com/privacy for data retention details',
    };

    // Audit log the export
    await auditCompliance(
      'data_export_request',
      `User ${user.email} exported their personal data`,
      {
        actor_id: user.id,
        actor_email: user.email,
        ip_address: ip,
        request_path: '/api/privacy/export-data',
      },
      'user',
      user.id,
      { export_format: 'json', tables_included: ['users', 'projects', 'clients', 'proposals', 'activity_log'] },
    );

    return NextResponse.json(exportData, {
      headers: {
        'Content-Disposition': `attachment; filename="solarpro-data-export-${user.id}.json"`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[DATA_EXPORT_ERROR]', msg);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}

// ─── DELETE /api/privacy/export-data ─────────────────────────────────────────
// Right-to-Delete: Request deletion of all user data.
// Marks the user for deletion (30-day grace period per POL-SEC-007).
// Actual deletion is performed by a cron job after the grace period.
export async function DELETE(req: NextRequest) {
  // Rate limit: 3 deletion requests per hour
  const ip = getClientIp(req);
  const rl = await checkRateLimit('delete-account', ip);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const user = await getUserFromRequest(req);
  if (!user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const sql = await getDbWithRetry();

    // Check for financial retention obligations
    const hasFinancialRecords = await sql`
      SELECT COUNT(*) as cnt FROM invoices WHERE user_id = ${user.id}
    `;
    const financialCount = Number((hasFinancialRecords[0] as any)?.cnt ?? 0);

    if (financialCount > 0) {
      // Financial records must be retained for 7 years per POL-SEC-007
      // Mark user for partial deletion: PII removed, financial records retained
      await sql`
        UPDATE users SET
          data_deletion_requested_at = NOW(),
          name = 'DELETED_USER_${user.id.substring(0, 8)}',
          email = 'deleted-${user.id.substring(0, 8)}@solarpro.invalid'
        WHERE id = ${user.id}
      `;

      await auditCompliance(
        'data_deletion_request',
        `User ${user.email} requested data deletion. Financial records retained for 7-year compliance. PII anonymized.`,
        {
          actor_id: user.id,
          actor_email: user.email,
          ip_address: ip,
          request_path: '/api/privacy/export-data',
        },
        'user',
        user.id,
        { deletion_type: 'partial', reason: 'financial_retention_obligation', financial_records_count: financialCount },
      );

      return NextResponse.json({
        status: 'partial_deletion_scheduled',
        message: 'Your personal data has been anonymized. Financial records are retained for 7 years per legal requirements. Full deletion will occur after the retention period.',
        deletion_date: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // No financial obligations — schedule full deletion in 30 days
    await sql`
      UPDATE users SET
        data_deletion_requested_at = NOW()
      WHERE id = ${user.id}
    `;

    await auditCompliance(
      'data_deletion_request',
      `User ${user.email} requested full data deletion. 30-day grace period started.`,
      {
        actor_id: user.id,
        actor_email: user.email,
        ip_address: ip,
        request_path: '/api/privacy/export-data',
      },
      'user',
      user.id,
      { deletion_type: 'full', grace_period_days: 30 },
    );

    return NextResponse.json({
      status: 'deletion_scheduled',
      message: 'Your data deletion has been scheduled. You have 30 days to cancel this request by contacting support. After 30 days, all your data will be permanently deleted.',
      deletion_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancel_url: '/api/privacy/cancel-deletion',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[DATA_DELETION_ERROR]', msg);
    return NextResponse.json({ error: 'Deletion request failed' }, { status: 500 });
  }
}
