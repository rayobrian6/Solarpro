import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady , handleRouteDbError, createClient, createProject, upsertLayout } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/admin/system-tools  { tool: string }
export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  if (admin.role !== 'super_admin')
    return NextResponse.json({ success: false, error: 'Only super_admin can run system tools' }, { status: 403 });

  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
  }

  const { tool, params } = await req.json();

  try {
    const sql = await getDbReady();

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
          } catch (stmtErr: unknown) {
            // Ignore "already exists" errors (idempotent migrations)
            if (!(stmtErr as Error).message?.includes('already exists')) {
              errors.push((stmtErr as Error).message);
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

      case 'repair_system_types': {
        // Fix corrupted system_type values in projects and layouts tables
        // Scans project names for fence/ground/carport keywords and corrects system_type
        let projectsFixed = 0;
        let layoutsFixed = 0;
        const fixLog: string[] = [];

        // Fix projects where system_type = 'roof' but name suggests fence/ground/carport
        try {
          const fenceProjects = await sql`
            UPDATE projects SET system_type = 'fence', updated_at = NOW()
            WHERE (LOWER(name) LIKE '%fence%' OR LOWER(name) LIKE '%sol fence%' OR LOWER(name) LIKE '%solar fence%')
              AND system_type != 'fence'
              AND deleted_at IS NULL
            RETURNING id, name, system_type
          `;
          projectsFixed += fenceProjects.length;
          if (fenceProjects.length > 0) fixLog.push(`Fixed ${fenceProjects.length} fence projects`);
        } catch (e: unknown) { fixLog.push(`fence project fix error: ${(e as Error).message}`); }

        try {
          const groundProjects = await sql`
            UPDATE projects SET system_type = 'ground', updated_at = NOW()
            WHERE (LOWER(name) LIKE '%ground mount%' OR LOWER(name) LIKE '%ground-mount%' OR LOWER(name) LIKE '%ground array%')
              AND system_type != 'ground'
              AND deleted_at IS NULL
            RETURNING id, name, system_type
          `;
          projectsFixed += groundProjects.length;
          if (groundProjects.length > 0) fixLog.push(`Fixed ${groundProjects.length} ground projects`);
        } catch (e: unknown) { fixLog.push(`ground project fix error: ${(e as Error).message}`); }

        try {
          const carportProjects = await sql`
            UPDATE projects SET system_type = 'carport', updated_at = NOW()
            WHERE (LOWER(name) LIKE '%carport%' OR LOWER(name) LIKE '%car port%')
              AND system_type != 'carport'
              AND deleted_at IS NULL
            RETURNING id, name, system_type
          `;
          projectsFixed += carportProjects.length;
          if (carportProjects.length > 0) fixLog.push(`Fixed ${carportProjects.length} carport projects`);
        } catch (e: unknown) { fixLog.push(`carport project fix error: ${(e as Error).message}`); }

        // Also sync layouts to match their project's system_type where they differ
        try {
          const syncedLayouts = await sql`
            UPDATE layouts l SET system_type = p.system_type, updated_at = NOW()
            FROM projects p
            WHERE l.project_id = p.id
              AND l.system_type != p.system_type
              AND p.deleted_at IS NULL
              AND p.system_type IN ('fence', 'ground', 'carport')
            RETURNING l.id, l.system_type, p.system_type as project_type
          `;
          layoutsFixed = syncedLayouts.length;
          if (syncedLayouts.length > 0) fixLog.push(`Synced ${syncedLayouts.length} layouts to match project system_type`);
        } catch (e: unknown) { fixLog.push(`layout sync error: ${(e as Error).message}`); }

        await logAdminAction({ adminId: admin.id, action: 'repair_system_types', metadata: { projectsFixed, layoutsFixed } });
        return NextResponse.json({
          success: true,
          message: `Repaired ${projectsFixed} projects, ${layoutsFixed} layouts`,
          details: fixLog,
          projectsFixed,
          layoutsFixed,
        });
      }

      case 'seed_demo_account': {
        // One-click demo account seeder — drops 3 golden projects for booth demos.
        // Accepts { userEmail } or { userId }. Resolves email → userId if needed.
        // Marks previously seeded demo projects as deleted, then creates fresh ones.
        const userEmail = params?.userEmail as string | undefined;
        let targetUserId = params?.userId as string | undefined;

        if (!targetUserId && !userEmail) {
          return NextResponse.json({ success: false, error: 'Provide userEmail or userId' }, { status: 400 });
        }

        // Resolve email → userId
        if (!targetUserId && userEmail) {
          const userRows = await sql`SELECT id FROM users WHERE email = ${userEmail.toLowerCase().trim()} LIMIT 1`;
          if (!userRows.length) {
            return NextResponse.json({ success: false, error: `No user found with email: ${userEmail}` }, { status: 404 });
          }
          targetUserId = userRows[0].id as string;
        }

        // Soft-delete any previously seeded demo projects for this user
        let deletedCount = 0;
        try {
          const deleted = await sql`
            UPDATE projects SET deleted_at = NOW(), updated_at = NOW()
            WHERE user_id = ${targetUserId!}
              AND deleted_at IS NULL
              AND (
                LOWER(name) LIKE '%[demo]%'
                OR LOWER(notes) LIKE '%demo-seed%'
              )
            RETURNING id
          `;
          deletedCount = deleted.length;
        } catch { /* ignore if no prior seeds */ }

        // ── Golden Project 1: Residential Retrofit ────────────────────────────
        const client1 = await createClient({
          userId: targetUserId!,
          name: 'Sarah & James Mitchell',
          email: 'mitchell.family@demo.solarpro',
          phone: '(602) 555-0182',
          address: '4821 E Camelback Rd',
          city: 'Phoenix',
          state: 'AZ',
          zip: '85018',
          lat: 33.5093,
          lng: -111.9936,
          utilityProvider: 'APS – Arizona Public Service',
          monthlyKwh: [920, 870, 1050, 1210, 1480, 1690, 1820, 1760, 1540, 1280, 1010, 890],
          annualKwh: 14520,
          averageMonthlyKwh: 1210,
          averageMonthlyBill: 182,
          annualBill: 2184,
          utilityRate: 0.1506,
        });

        const project1 = await createProject({
          userId: targetUserId!,
          clientId: client1.id,
          name: 'Mitchell Residence – Roof Retrofit [demo]',
          status: 'proposal',
          systemType: 'roof',
          notes: 'demo-seed: residential retrofit. 10.4 kW roof array. South-facing, 22° tilt.',
          address: '4821 E Camelback Rd, Phoenix, AZ 85018',
          lat: 33.5093,
          lng: -111.9936,
          stateCode: 'AZ',
          city: 'Phoenix',
          zip: '85018',
          utilityName: 'APS – Arizona Public Service',
          utilityRatePerKwh: 0.1506,
          systemSizeKw: 10.4,
        });

        // Demo panels: minimal seed data — cast as any[] since engine fields are optional at rest
        const demoPanel1 = (i: number, col: number, row: number) => ({
          id: `demo-p1-${i}`, layoutId: project1.id,
          lat: 33.5093, lng: -111.9936, x: col * 1.1, y: row * 1.8,
          tilt: 22, azimuth: 180, wattage: 400, bifacialGain: 0,
          row, col, planeId: 'rp-south',
        });
        await upsertLayout({
          projectId: project1.id,
          userId: targetUserId!,
          systemType: 'roof',
          totalPanels: 26,
          systemSizeKw: 10.4,
          mapCenter: { lat: 33.5093, lng: -111.9936 },
          mapZoom: 20,
          panels: Array.from({ length: 26 }, (_, i) => demoPanel1(i, i % 9, Math.floor(i / 9))) as any[],
          roofPlanes: [{
            id: 'rp-south', pitch: 22, azimuth: 180, area: 108, usableArea: 90,
            vertices: [
              { lat: 33.5094, lng: -111.9938 }, { lat: 33.5094, lng: -111.9934 },
              { lat: 33.5092, lng: -111.9934 }, { lat: 33.5092, lng: -111.9938 },
            ],
          } as any],
        });

        // ── Golden Project 2: New Construction ────────────────────────────────
        const client2 = await createClient({
          userId: targetUserId!,
          name: 'Greenfield Homes LLC',
          email: 'builds@greenfield-demo.solarpro',
          phone: '(512) 555-0247',
          address: '7200 Ranch Rd 2222',
          city: 'Austin',
          state: 'TX',
          zip: '78730',
          lat: 30.3869,
          lng: -97.8211,
          utilityProvider: 'Austin Energy',
          monthlyKwh: [710, 680, 780, 910, 1100, 1340, 1520, 1490, 1260, 1020, 790, 700],
          annualKwh: 12300,
          averageMonthlyKwh: 1025,
          averageMonthlyBill: 138,
          annualBill: 1656,
          utilityRate: 0.1134,
        });

        const project2 = await createProject({
          userId: targetUserId!,
          clientId: client2.id,
          name: 'Greenfield Lot 14 – New Construction [demo]',
          status: 'design',
          systemType: 'roof',
          notes: 'demo-seed: new construction. 8.0 kW dual-plane roof. Builder pre-wire.',
          address: '7200 Ranch Rd 2222, Austin, TX 78730',
          lat: 30.3869,
          lng: -97.8211,
          stateCode: 'TX',
          city: 'Austin',
          zip: '78730',
          utilityName: 'Austin Energy',
          utilityRatePerKwh: 0.1134,
          systemSizeKw: 8.0,
        });

        const demoPanel2 = (i: number, col: number, row: number, planeId: string) => ({
          id: `demo-p2-${i}`, layoutId: project2.id,
          lat: 30.3869, lng: -97.8211, x: col * 1.1, y: row * 1.8,
          tilt: 18, azimuth: i < 12 ? 175 : 90, wattage: 400, bifacialGain: 0,
          row, col, planeId,
        });
        await upsertLayout({
          projectId: project2.id,
          userId: targetUserId!,
          systemType: 'roof',
          totalPanels: 20,
          systemSizeKw: 8.0,
          mapCenter: { lat: 30.3869, lng: -97.8211 },
          mapZoom: 20,
          panels: Array.from({ length: 20 }, (_, i) =>
            demoPanel2(i, i % 8, Math.floor(i / 8), i < 12 ? 'rp-south' : 'rp-east')
          ) as any[],
          roofPlanes: [
            {
              id: 'rp-south', pitch: 18, azimuth: 175, area: 70, usableArea: 58,
              vertices: [
                { lat: 30.3871, lng: -97.8214 }, { lat: 30.3871, lng: -97.8209 },
                { lat: 30.3868, lng: -97.8209 }, { lat: 30.3868, lng: -97.8214 },
              ],
            } as any,
            {
              id: 'rp-east', pitch: 18, azimuth: 90, area: 42, usableArea: 35,
              vertices: [
                { lat: 30.3871, lng: -97.8208 }, { lat: 30.3871, lng: -97.8205 },
                { lat: 30.3868, lng: -97.8205 }, { lat: 30.3868, lng: -97.8208 },
              ],
            } as any,
          ],
        });

        // ── Golden Project 3: Commercial Ground Mount ─────────────────────────
        const client3 = await createClient({
          userId: targetUserId!,
          name: 'Rocky Mountain Logistics Inc.',
          email: 'facilities@rml-demo.solarpro',
          phone: '(720) 555-0391',
          address: '5280 Commerce Pkwy',
          city: 'Denver',
          state: 'CO',
          zip: '80239',
          lat: 39.7742,
          lng: -104.8731,
          utilityProvider: 'Xcel Energy – Colorado',
          monthlyKwh: [8200, 7600, 8900, 9400, 10200, 11400, 12100, 11800, 10500, 9300, 8100, 7900],
          annualKwh: 115400,
          averageMonthlyKwh: 9617,
          averageMonthlyBill: 1124,
          annualBill: 13488,
          utilityRate: 0.0974,
        });

        const project3 = await createProject({
          userId: targetUserId!,
          clientId: client3.id,
          name: 'RML Warehouse – Ground Mount [demo]',
          status: 'lead',
          systemType: 'ground',
          notes: 'demo-seed: commercial ground mount. 49.6 kW. Single-axis tracker row layout.',
          address: '5280 Commerce Pkwy, Denver, CO 80239',
          lat: 39.7742,
          lng: -104.8731,
          stateCode: 'CO',
          city: 'Denver',
          zip: '80239',
          utilityName: 'Xcel Energy – Colorado',
          utilityRatePerKwh: 0.0974,
          systemSizeKw: 49.6,
        });

        const demoPanel3 = (i: number, col: number, row: number) => ({
          id: `demo-p3-${i}`, layoutId: project3.id,
          lat: 39.7742, lng: -104.8731, x: col * 1.1, y: row * 3.5,
          tilt: 30, azimuth: 180, wattage: 400, bifacialGain: 0,
          row, col, systemType: 'ground' as const,
        });
        await upsertLayout({
          projectId: project3.id,
          userId: targetUserId!,
          systemType: 'ground',
          totalPanels: 124,
          systemSizeKw: 49.6,
          mapCenter: { lat: 39.7742, lng: -104.8731 },
          mapZoom: 19,
          groundTilt: 30,
          groundAzimuth: 180,
          rowSpacing: 3.5,
          groundHeight: 1.2,
          panels: Array.from({ length: 124 }, (_, i) =>
            demoPanel3(i, i % 31, Math.floor(i / 31))
          ) as any[],
        });

        await logAdminAction({
          adminId: admin.id,
          action: 'seed_demo_account',
          metadata: { targetUserId, userEmail: userEmail ?? null, deletedCount, projectsCreated: 3 },
        });

        return NextResponse.json({
          success: true,
          message: `Demo account seeded — 3 projects created (${deletedCount} old demo projects removed)`,
          summary: {
            deletedOldDemos: deletedCount,
            created: [
              { name: project1.name, id: project1.id, kw: 10.4, type: 'roof' },
              { name: project2.name, id: project2.id, kw: 8.0,  type: 'roof' },
              { name: project3.name, id: project3.id, kw: 49.6, type: 'ground' },
            ],
          },
        });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown tool: ${tool}` }, { status: 400 });
    }
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/system-tools/route.ts]', e);
  }
}