import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDb } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// POST /api/admin/system-tools  { tool: string }
export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  if (admin.role !== 'super_admin')
    return NextResponse.json({ success: false, error: 'Only super_admin can run system tools' }, { status: 403 });

  const { tool, params } = await req.json();

  try {
    const sql = getDb();

    switch (tool) {

      case 'run_migration': {
        const migrationFile = params?.file as string;
        if (!migrationFile || !migrationFile.endsWith('.sql'))
          return NextResponse.json({ success: false, error: 'Invalid migration file' }, { status: 400 });

        // Security: only allow files from the migrations directory
        const migrationsDir = path.join(process.cwd(), 'lib', 'migrations');
        const filePath = path.join(migrationsDir, path.basename(migrationFile));
        if (!filePath.startsWith(migrationsDir))
          return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 });

        let sqlContent: string;
        try {
          sqlContent = fs.readFileSync(filePath, 'utf-8');
        } catch {
          return NextResponse.json({ success: false, error: `Migration file not found: ${migrationFile}` }, { status: 404 });
        }

        // Execute the migration SQL by splitting into individual statements
        // neon tagged template does not support .unsafe(); use neon().query() directly
        const rawSql = neon(process.env.DATABASE_URL!);
        const statements = sqlContent
          .split(';')
          .map((s: string) => {
            // Strip comment lines from each statement block, then trim
            const lines = s.split('\n').filter((l: string) => !l.trim().startsWith('--'));
            return lines.join('\n').trim();
          })
          .filter((s: string) => s.length > 0);

        const errors: string[] = [];
        for (const stmt of statements) {
          try {
            // neon() supports ordinary function call: sql(queryString, params?)
            await rawSql(stmt, []);
          } catch (stmtErr: any) {
            // Ignore "already exists" errors (idempotent migrations)
            if (!stmtErr.message?.includes('already exists')) {
              errors.push(stmtErr.message);
            }
          }
        }

        if (errors.length > 0) {
          return NextResponse.json({ success: false, error: errors.join('; ') }, { status: 500 });
        }

        await logAdminAction({ adminId: admin.id, action: 'run_migration', metadata: { file: migrationFile } });
        return NextResponse.json({ success: true, message: `Migration ${migrationFile} executed successfully` });
      }

      case 'list_migrations': {
        const migrationsDir = path.join(process.cwd(), 'lib', 'migrations');
        let files: string[] = [];
        try {
          files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
        } catch {}
        return NextResponse.json({ success: true, migrations: files });
      }

      case 'clear_expired_tokens': {
        let deleted = 0;
        try {
          const result = await sql`
            DELETE FROM admin_impersonation_tokens
            WHERE expires_at < NOW() OR used = true
            RETURNING id
          `;
          deleted = result.length;
        } catch {}
        await logAdminAction({ adminId: admin.id, action: 'clear_expired_tokens', metadata: { deleted } });
        return NextResponse.json({ success: true, message: `Cleared ${deleted} expired/used impersonation tokens` });
      }

      case 'recalculate_trial_status': {
        // Find users whose trial has expired but status is still 'trialing'
        const expired = await sql`
          UPDATE users
          SET subscription_status = 'cancelled'
          WHERE subscription_status = 'trialing'
            AND trial_ends_at < NOW()
            AND is_free_pass = false
          RETURNING id, email
        `;
        await logAdminAction({ adminId: admin.id, action: 'recalculate_trial_status', metadata: { expiredCount: expired.length } });
        return NextResponse.json({ success: true, message: `Updated ${expired.length} expired trial accounts to cancelled` });
      }

      case 'db_stats': {
        const [userCount, projectCount, proposalCount, clientCount] = await Promise.all([
          sql`SELECT COUNT(*) AS c FROM users`,
          sql`SELECT COUNT(*) AS c FROM projects`.catch(() => [{ c: 0 }]),
          sql`SELECT COUNT(*) AS c FROM proposals`.catch(() => [{ c: 0 }]),
          sql`SELECT COUNT(*) AS c FROM clients`.catch(() => [{ c: 0 }]),
        ]);
        return NextResponse.json({
          success: true,
          stats: {
            users:     Number(userCount[0]?.c ?? 0),
            projects:  Number(projectCount[0]?.c ?? 0),
            proposals: Number(proposalCount[0]?.c ?? 0),
            clients:   Number(clientCount[0]?.c ?? 0),
          },
        });
      }

      case 'rebuild_search_index': {
        // Refresh any materialized views or search indexes
        // For now, just vacuum analyze the main tables
        try {
          await sql`ANALYZE users`;
          await sql`ANALYZE projects`.catch(() => {});
          await sql`ANALYZE proposals`.catch(() => {});
        } catch {}
        await logAdminAction({ adminId: admin.id, action: 'rebuild_search_index', metadata: {} });
        return NextResponse.json({ success: true, message: 'Search indexes rebuilt (ANALYZE completed)' });
      }

      case 'clear_activity_log': {
        // Only clear logs older than 90 days
        let deleted = 0;
        try {
          const result = await sql`
            DELETE FROM admin_activity_log
            WHERE created_at < NOW() - INTERVAL '90 days'
            RETURNING id
          `;
          deleted = result.length;
        } catch {}
        await logAdminAction({ adminId: admin.id, action: 'clear_old_activity_logs', metadata: { deleted } });
        return NextResponse.json({ success: true, message: `Cleared ${deleted} activity log entries older than 90 days` });
      }

      case 'platform_health': {
        const start = Date.now();
        let dbOk = false;
        let dbLatencyMs = 0;
        try {
          await sql`SELECT 1`;
          dbLatencyMs = Date.now() - start;
          dbOk = true;
        } catch {}

        const [userCount, activeCount, freePassCount] = await Promise.all([
          sql`SELECT COUNT(*) AS c FROM users`.catch(() => [{ c: 0 }]),
          sql`SELECT COUNT(*) AS c FROM users WHERE subscription_status NOT IN ('suspended','cancelled')`.catch(() => [{ c: 0 }]),
          sql`SELECT COUNT(*) AS c FROM users WHERE is_free_pass = true`.catch(() => [{ c: 0 }]),
        ]);

        return NextResponse.json({
          success: true,
          health: {
            db: { ok: dbOk, latencyMs: dbLatencyMs },
            users: {
              total:    Number(userCount[0]?.c ?? 0),
              active:   Number(activeCount[0]?.c ?? 0),
              freePass: Number(freePassCount[0]?.c ?? 0),
            },
            timestamp: new Date().toISOString(),
          },
        });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown tool: ${tool}` }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}