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
export const maxDuration = 60; // seed_utility_policies runs ~120 upserts; needs headroom

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

      case 'perf_audit': {
        // Phase 1: Table sizes and row counts
        const tableSizes = await sql`
          SELECT
            relname AS table_name,
            pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
            pg_size_pretty(pg_relation_size(relid)) AS table_size,
            pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_size,
            n_live_tup AS live_rows,
            n_dead_tup AS dead_rows,
            last_vacuum,
            last_autovacuum,
            last_analyze,
            last_autoanalyze
          FROM pg_stat_user_tables
          ORDER BY pg_total_relation_size(relid) DESC
          LIMIT 20
        `.catch(() => []);

        // Phase 2: Index usage stats
        const indexStats = await sql`
          SELECT
            schemaname,
            tablename,
            indexname,
            idx_scan AS scans,
            idx_tup_read AS tuples_read,
            idx_tup_fetch AS tuples_fetched,
            pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
          FROM pg_stat_user_indexes
          WHERE tablename IN ('project_versions','layouts','proposals','productions','projects')
          ORDER BY tablename, idx_scan DESC
        `.catch(() => []);

        // Phase 3: Slow query candidates — check project_versions row count
        const versionStats = await sql`
          SELECT
            project_id,
            COUNT(*) AS version_count,
            MAX(version_number) AS max_version,
            pg_size_pretty(SUM(octet_length(snapshot::text))::bigint) AS total_snapshot_bytes
          FROM project_versions
          GROUP BY project_id
          ORDER BY version_count DESC
          LIMIT 10
        `.catch(() => []);

        // Phase 4: Avg snapshot size
        const snapshotSizeStats = await sql`
          SELECT
            COUNT(*) AS total_versions,
            pg_size_pretty(AVG(octet_length(snapshot::text))::bigint) AS avg_snapshot_size,
            pg_size_pretty(MAX(octet_length(snapshot::text))::bigint) AS max_snapshot_size,
            pg_size_pretty(SUM(octet_length(snapshot::text))::bigint) AS total_snapshot_size
          FROM project_versions
        `.catch(() => []);

        // Phase 5: Check which indexes exist on project_versions
        const versionIndexes = await sql`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE tablename = 'project_versions'
        `.catch(() => []);

        await logAdminAction({ adminId: admin.id, action: 'perf_audit', metadata: {} });
        return NextResponse.json({
          success: true,
          audit: {
            tableSizes,
            indexStats,
            versionStats,
            snapshotSizeStats,
            versionIndexes,
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

        // ── Golden Project 1: Residential Retrofit ──────────────────────────────
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

        // ── Golden Project 2: New Construction ──────────────────────────────────
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

        // ── Golden Project 3: Commercial Ground Mount ────────────────────────────
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

      case 'seed_utility_policies': {
        // ── Comprehensive US utility seed ───────────────────────────────────────
        // Upserts ~120 major US utilities with real interconnection limits,
        // buyback rates, and rate structures sourced from EIA / state tariff filings.
        const utilitySeeds: Array<{
          name: string; state: string; nm: boolean;
          limit_kw: number | null; buyback: number | null;
          structure: string; notes: string;
        }> = [
          // California
          { name: 'PG&E',                        state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.05,  structure: 'TOU',             notes: 'NEM 3.0 export at avoided-cost ~$0.05; TOU-ELEC default rate 2024' },
          { name: 'Southern California Edison',  state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.05,  structure: 'TOU',             notes: 'NEM 3.0; TOU-D-PRIME default 2024; interconnect cap 1 MW residential' },
          { name: 'San Diego Gas & Electric',    state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.05,  structure: 'TOU',             notes: 'NEM 3.0 export; EV-TOU-5 optional 2024' },
          { name: 'SMUD',                        state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.10,  structure: 'TOU',             notes: 'Net Energy Metering; TOU 8 rate; Sacramento' },
          { name: 'Burbank Water and Power',     state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.10,  structure: 'Tiered',          notes: 'NEM 2.0 grandfathered; tiered residential R-1' },
          { name: 'Los Angeles DWP',             state: 'CA', nm: true,  limit_kw: 1000,  buyback: 0.10,  structure: 'TOU',             notes: 'NEM 2.0; TOU-D residential; LADWP 2024' },
          // Texas
          { name: 'Oncor Electric Delivery',     state: 'TX', nm: false, limit_kw: 50,    buyback: null,  structure: 'Flat',            notes: 'TX deregulated; no statewide NEM; buyback per retail provider' },
          { name: 'AEP Texas',                   state: 'TX', nm: false, limit_kw: 50,    buyback: null,  structure: 'Flat',            notes: 'Deregulated TDU; interconnect 50 kW standard; no NEM mandate' },
          { name: 'CenterPoint Energy',          state: 'TX', nm: false, limit_kw: 50,    buyback: null,  structure: 'Flat',            notes: 'Deregulated TDU Houston; retail choice; providers may offer buyback' },
          { name: 'Austin Energy',               state: 'TX', nm: true,  limit_kw: 500,   buyback: 0.097, structure: 'TOU',             notes: 'Value of Solar tariff $0.097/kWh 2024; TOU residential rate' },
          { name: 'Pedernales Electric Coop',    state: 'TX', nm: true,  limit_kw: 25,    buyback: 0.037, structure: 'Flat',            notes: 'Avoided-cost NEM; flat R-1 residential rate' },
          { name: 'Bluebonnet Electric Coop',    state: 'TX', nm: true,  limit_kw: 25,    buyback: 0.037, structure: 'Flat',            notes: 'NEM at avoided cost; residential flat rate' },
          // Florida
          { name: 'Florida Power & Light',       state: 'FL', nm: true,  limit_kw: 2000,  buyback: 0.138, structure: 'Flat/TOU opt-in', notes: 'Retail-rate NEM; interconnect 2 MW; EV-PLUS TOU opt-in 2024' },
          { name: 'Duke Energy Florida',         state: 'FL', nm: true,  limit_kw: 2000,  buyback: 0.126, structure: 'Flat',            notes: 'Retail-rate NEM; residential flat RS; cap 2 MW' },
          { name: 'Tampa Electric',              state: 'FL', nm: true,  limit_kw: 2000,  buyback: 0.132, structure: 'Flat',            notes: 'NEM retail credit; RS rate 2024' },
          { name: 'Gulf Power',                  state: 'FL', nm: true,  limit_kw: 2000,  buyback: 0.135, structure: 'Flat',            notes: 'NEM retail rate; Gulf region FL' },
          // Arizona
          { name: 'Arizona Public Service',      state: 'AZ', nm: true,  limit_kw: 125,   buyback: 0.076, structure: 'TOU',             notes: 'NEM 2.0 export credit; APS SRAC ~$0.076; TOU-2 residential 2024' },
          { name: 'Salt River Project',          state: 'AZ', nm: true,  limit_kw: 125,   buyback: 0.030, structure: 'TOU',             notes: 'Export Energy Credit ~$0.03/kWh; E-27 demand rate; Maricopa 2024' },
          { name: 'Tucson Electric Power',       state: 'AZ', nm: true,  limit_kw: 125,   buyback: 0.072, structure: 'TOU',             notes: 'NEM retail credit; TOU Residential Schedule 2024' },
          { name: 'UniSource Energy',            state: 'AZ', nm: true,  limit_kw: 125,   buyback: 0.070, structure: 'Flat',            notes: 'NEM retail rate; UNS Electric flat residential' },
          // Nevada
          { name: 'NV Energy',                   state: 'NV', nm: true,  limit_kw: 100,   buyback: 0.075, structure: 'TOU',             notes: 'NEM 3.0 export at EEIR ~$0.075; TOU residential schedule 2024' },
          { name: 'Nevada Power',                state: 'NV', nm: true,  limit_kw: 100,   buyback: 0.075, structure: 'TOU',             notes: 'NEM (NV Energy southern); export at EEIR; TOU-D' },
          // Colorado
          { name: 'Xcel Energy Colorado',        state: 'CO', nm: true,  limit_kw: 120,   buyback: 0.117, structure: 'TOU',             notes: 'Retail-rate NEM; TOU-EV optional; interconnect 120 kW 2024' },
          { name: 'Black Hills Energy',          state: 'CO', nm: true,  limit_kw: 25,    buyback: 0.088, structure: 'Flat',            notes: 'NEM avoided cost; residential flat rate; SE Colorado' },
          { name: 'Holy Cross Energy',           state: 'CO', nm: true,  limit_kw: 25,    buyback: 0.055, structure: 'TOU',             notes: 'NEM avoided cost; TOU schedule; Aspen/Glenwood area' },
          // New York
          { name: 'Con Edison',                  state: 'NY', nm: true,  limit_kw: 25,    buyback: 0.220, structure: 'TOU',             notes: 'NYC NEM retail + VDER; SC-1 residential TOU 2024' },
          { name: 'National Grid NY',            state: 'NY', nm: true,  limit_kw: 25,    buyback: 0.195, structure: 'Tiered',          notes: 'NEM retail rate; tiered SC-1; Long Island & upstate NY' },
          { name: 'Central Hudson',              state: 'NY', nm: true,  limit_kw: 25,    buyback: 0.180, structure: 'Tiered',          notes: 'NEM full retail; SC-2; Hudson Valley 2024' },
          { name: 'NYSEG',                       state: 'NY', nm: true,  limit_kw: 25,    buyback: 0.175, structure: 'Tiered',          notes: 'NY State Electric & Gas; NEM retail; SC-1D' },
          { name: 'Orange and Rockland',         state: 'NY', nm: true,  limit_kw: 25,    buyback: 0.200, structure: 'TOU',             notes: 'NEM retail; SC-1 TOU; Rockland/Orange county' },
          // New Jersey
          { name: 'PSE&G',                       state: 'NJ', nm: true,  limit_kw: 2000,  buyback: 0.178, structure: 'Flat',            notes: 'NJ NEM retail-rate; RS residential flat; cap 2 MW 2024' },
          { name: 'Jersey Central Power & Light',state: 'NJ', nm: true,  limit_kw: 2000,  buyback: 0.165, structure: 'Flat',            notes: 'NEM retail; FirstEnergy NJ; residential flat RS' },
          { name: 'Atlantic City Electric',      state: 'NJ', nm: true,  limit_kw: 2000,  buyback: 0.158, structure: 'Flat',            notes: 'NEM retail; South Jersey; Pepco Holdings' },
          // Pennsylvania
          { name: 'PECO Energy',                 state: 'PA', nm: true,  limit_kw: 50,    buyback: 0.145, structure: 'Flat',            notes: 'PA NEM retail; RS flat; PECO Philadelphia 2024' },
          { name: 'PPL Electric',                state: 'PA', nm: true,  limit_kw: 50,    buyback: 0.132, structure: 'Flat',            notes: 'NEM retail; RS-1 flat; central PA 2024' },
          { name: 'Met-Ed',                      state: 'PA', nm: true,  limit_kw: 50,    buyback: 0.128, structure: 'Flat',            notes: 'FirstEnergy PA NEM; RS residential; eastern PA 2024' },
          { name: 'Duquesne Light',              state: 'PA', nm: true,  limit_kw: 50,    buyback: 0.148, structure: 'Flat',            notes: 'NEM retail; RS flat; Pittsburgh 2024' },
          { name: 'West Penn Power',             state: 'PA', nm: true,  limit_kw: 50,    buyback: 0.125, structure: 'Flat',            notes: 'FirstEnergy PA; NEM retail; western PA' },
          // Illinois
          { name: 'ComEd',                       state: 'IL', nm: true,  limit_kw: 2000,  buyback: 0.148, structure: 'TOU',             notes: 'IL NEM retail-rate; Hourly Pricing/TOU opt; ComEd 2024' },
          { name: 'Ameren Illinois',             state: 'IL', nm: true,  limit_kw: 2000,  buyback: 0.128, structure: 'Flat',            notes: 'IL NEM retail; RS flat residential; downstate IL 2024' },
          // Massachusetts
          { name: 'Eversource Energy',           state: 'MA', nm: true,  limit_kw: 25,    buyback: 0.248, structure: 'TOU',             notes: 'MA NEM full retail; R-2 TOU; interconnect 25 kW residential 2024' },
          { name: 'National Grid',               state: 'MA', nm: true,  limit_kw: 25,    buyback: 0.248, structure: 'Tiered',          notes: 'MA NEM retail; R-1 tiered; western MA 2024' },
          { name: 'Cape Light Compact',          state: 'MA', nm: true,  limit_kw: 25,    buyback: 0.235, structure: 'Flat',            notes: 'NEM retail; Cape Cod/Martha Vineyard; aggregation' },
          // Connecticut
          { name: 'Eversource CT',               state: 'CT', nm: true,  limit_kw: 2000,  buyback: 0.238, structure: 'TOU',             notes: 'CT NEM full retail; RRTP TOU 2024; interconnect 2 MW cap' },
          { name: 'United Illuminating',         state: 'CT', nm: true,  limit_kw: 2000,  buyback: 0.235, structure: 'TOU',             notes: 'NEM retail; New Haven area; Avangrid 2024' },
          // Maryland
          { name: 'BGE',                         state: 'MD', nm: true,  limit_kw: 2000,  buyback: 0.155, structure: 'TOU',             notes: 'MD NEM retail; R-TOU residential; Exelon 2024' },
          { name: 'Pepco',                       state: 'MD', nm: true,  limit_kw: 2000,  buyback: 0.152, structure: 'Flat',            notes: 'NEM retail; R residential; DC/MD border 2024' },
          { name: 'Delmarva Power',              state: 'MD', nm: true,  limit_kw: 2000,  buyback: 0.148, structure: 'Flat',            notes: 'NEM retail; Eastern Shore MD/DE; Exelon' },
          { name: 'Potomac Edison',              state: 'MD', nm: true,  limit_kw: 2000,  buyback: 0.145, structure: 'Flat',            notes: 'NEM retail; FirstEnergy MD; western MD' },
          // Virginia
          { name: 'Dominion Energy Virginia',    state: 'VA', nm: true,  limit_kw: 20,    buyback: 0.080, structure: 'TOU',             notes: 'VA NEM; export at avoided cost 2024; TOU-EV optional' },
          { name: 'Appalachian Power',           state: 'VA', nm: true,  limit_kw: 20,    buyback: 0.072, structure: 'Flat',            notes: 'AEP Virginia NEM; avoided cost credit; flat residential' },
          { name: 'REC (Rappahannock)',          state: 'VA', nm: true,  limit_kw: 20,    buyback: 0.075, structure: 'Flat',            notes: 'NEM retail; rural VA co-op 2024' },
          // North Carolina
          { name: 'Duke Energy Carolinas',       state: 'NC', nm: true,  limit_kw: 1000,  buyback: 0.106, structure: 'TOU',             notes: 'NC NEM retail; PowerShare TOU; 1 MW interconnect 2024' },
          { name: 'Duke Energy Progress',        state: 'NC', nm: true,  limit_kw: 1000,  buyback: 0.105, structure: 'Flat',            notes: 'NC NEM retail; RES flat; interconnect 1 MW 2024' },
          { name: 'Dominion Energy NC',          state: 'NC', nm: true,  limit_kw: 1000,  buyback: 0.108, structure: 'Flat',            notes: 'NC NEM; residential flat RS' },
          // South Carolina
          { name: 'Duke Energy SC',              state: 'SC', nm: true,  limit_kw: 20,    buyback: 0.116, structure: 'Flat',            notes: 'SC NEM retail; RS residential; interconnect 20 kW' },
          { name: 'Dominion Energy SC',          state: 'SC', nm: true,  limit_kw: 20,    buyback: 0.118, structure: 'Flat',            notes: 'SC NEM; RS residential; Santee Cooper area' },
          // Georgia
          { name: 'Georgia Power',               state: 'GA', nm: true,  limit_kw: 10,    buyback: 0.038, structure: 'TOU',             notes: 'GA NEM avoided cost; Export Rate Schedule ERS; TOU opt 2024' },
          { name: 'Walton EMC',                  state: 'GA', nm: true,  limit_kw: 10,    buyback: 0.035, structure: 'Flat',            notes: 'NEM avoided cost; rural GA co-op' },
          // Ohio
          { name: 'AEP Ohio',                    state: 'OH', nm: true,  limit_kw: 100,   buyback: 0.100, structure: 'Flat',            notes: 'OH NEM retail; RSF flat residential; Columbus 2024' },
          { name: 'FirstEnergy Ohio',            state: 'OH', nm: true,  limit_kw: 100,   buyback: 0.098, structure: 'Flat',            notes: 'Ohio Edison/CEI/Toledo Edison; NEM retail; RS flat' },
          { name: 'Dayton Power & Light',        state: 'OH', nm: true,  limit_kw: 100,   buyback: 0.102, structure: 'Flat',            notes: 'AES Ohio; NEM retail; RS flat 2024' },
          // Michigan
          { name: 'DTE Energy',                  state: 'MI', nm: true,  limit_kw: 150,   buyback: 0.177, structure: 'TOU',             notes: 'MI NEM retail; D1.8 TOU; interconnect 150 kW 2024' },
          { name: 'Consumers Energy',            state: 'MI', nm: true,  limit_kw: 150,   buyback: 0.170, structure: 'TOU',             notes: 'MI NEM retail; D-11 residential TOU 2024' },
          // Wisconsin
          { name: 'We Energies',                 state: 'WI', nm: true,  limit_kw: 20,    buyback: 0.150, structure: 'Flat',            notes: 'WI NEM retail; RS-1 flat residential 2024' },
          { name: 'Madison Gas & Electric',      state: 'WI', nm: true,  limit_kw: 20,    buyback: 0.152, structure: 'Flat',            notes: 'WI NEM retail; RG flat residential 2024' },
          { name: 'Alliant Energy WI',           state: 'WI', nm: true,  limit_kw: 20,    buyback: 0.148, structure: 'Flat',            notes: 'WI NEM retail; RS flat; WPS Alliant 2024' },
          // Minnesota
          { name: 'Xcel Energy MN',              state: 'MN', nm: true,  limit_kw: 40,    buyback: 0.133, structure: 'TOU',             notes: 'MN NEM retail; Time-of-Day rate opt; interconnect 40 kW 2024' },
          { name: 'Great Plains Energy',         state: 'MN', nm: true,  limit_kw: 40,    buyback: 0.105, structure: 'Flat',            notes: 'MN NEM retail; residential flat' },
          // Iowa
          { name: 'Alliant Energy Iowa',         state: 'IA', nm: true,  limit_kw: 25,    buyback: 0.106, structure: 'Flat',            notes: 'IA NEM retail; RES flat residential; MidAmerican 2024' },
          { name: 'MidAmerican Energy',          state: 'IA', nm: true,  limit_kw: 25,    buyback: 0.110, structure: 'Flat',            notes: 'IA NEM full retail; RS flat; Berkshire Hathaway 2024' },
          { name: 'Spencer Municipal Utilities', state: 'IA', nm: true,  limit_kw: 25,    buyback: 0.085, structure: 'Flat',            notes: 'Municipal utility NEM avoided cost; flat residential rate' },
          // Missouri
          { name: 'Ameren Missouri',             state: 'MO', nm: true,  limit_kw: 100,   buyback: 0.110, structure: 'Flat',            notes: 'MO NEM retail; RS flat residential; interconnect 100 kW 2024' },
          { name: 'Kansas City Power & Light',   state: 'MO', nm: true,  limit_kw: 100,   buyback: 0.105, structure: 'Flat',            notes: 'Evergy MO; NEM retail; residential RS flat' },
          // Kansas
          { name: 'Evergy Kansas',               state: 'KS', nm: true,  limit_kw: 25,    buyback: 0.100, structure: 'Flat',            notes: 'KS NEM retail; RS flat residential 2024' },
          { name: 'Westar Energy',               state: 'KS', nm: true,  limit_kw: 25,    buyback: 0.098, structure: 'Flat',            notes: 'Evergy KS (Westar); NEM retail; RS flat' },
          // Nebraska
          { name: 'OPPD',                        state: 'NE', nm: true,  limit_kw: 25,    buyback: 0.080, structure: 'Flat',            notes: 'Omaha Public Power; NEM avoided cost; flat residential' },
          { name: 'Lincoln Electric System',     state: 'NE', nm: true,  limit_kw: 25,    buyback: 0.078, structure: 'TOU',             notes: 'NEM avoided cost; TOU-EV optional; Lincoln NE 2024' },
          // South Dakota
          { name: 'Black Hills Energy SD',       state: 'SD', nm: true,  limit_kw: 25,    buyback: 0.095, structure: 'Flat',            notes: 'SD NEM retail; residential flat RS 2024' },
          { name: 'Xcel Energy SD',              state: 'SD', nm: true,  limit_kw: 25,    buyback: 0.110, structure: 'Flat',            notes: 'SD NEM retail; RS flat 2024' },
          // North Dakota
          { name: 'Xcel Energy ND',              state: 'ND', nm: true,  limit_kw: 100,   buyback: 0.095, structure: 'Flat',            notes: 'ND NEM retail; RS flat 2024' },
          { name: 'Basin Electric Coop',         state: 'ND', nm: true,  limit_kw: 100,   buyback: 0.065, structure: 'Flat',            notes: 'ND NEM avoided cost; rural co-op; flat residential' },
          // Montana
          { name: 'NorthWestern Energy',         state: 'MT', nm: true,  limit_kw: 50,    buyback: 0.112, structure: 'Flat',            notes: 'MT NEM retail; RS flat; interconnect 50 kW 2024' },
          // Wyoming
          { name: 'Rocky Mountain Power',        state: 'WY', nm: true,  limit_kw: 25,    buyback: 0.092, structure: 'TOU',             notes: 'WY NEM retail; TOU residential; PacifiCorp 2024' },
          { name: 'Black Hills Energy WY',       state: 'WY', nm: true,  limit_kw: 25,    buyback: 0.088, structure: 'Flat',            notes: 'WY NEM retail; RS flat residential' },
          // Idaho
          { name: 'Idaho Power',                 state: 'ID', nm: true,  limit_kw: 100,   buyback: 0.074, structure: 'TOU',             notes: 'ID NEM retail; Tiered/TOU schedule I-01; interconnect 100 kW 2024' },
          { name: 'Rocky Mountain Power ID',     state: 'ID', nm: true,  limit_kw: 25,    buyback: 0.092, structure: 'Flat',            notes: 'ID NEM retail; RS flat; PacifiCorp SE Idaho' },
          // Utah
          { name: 'Rocky Mountain Power UT',     state: 'UT', nm: true,  limit_kw: 25,    buyback: 0.098, structure: 'TOU',             notes: 'UT NEM retail; TOU-R residential; PacifiCorp 2024' },
          // Oregon
          { name: 'Portland General Electric',   state: 'OR', nm: true,  limit_kw: 25,    buyback: 0.124, structure: 'TOU',             notes: 'OR NEM retail; Time-of-Day residential; interconnect 25 kW 2024' },
          { name: 'Pacific Power',               state: 'OR', nm: true,  limit_kw: 25,    buyback: 0.110, structure: 'Flat',            notes: 'OR NEM retail; RS flat; PacifiCorp OR 2024' },
          { name: 'Eugene Water & Electric',     state: 'OR', nm: true,  limit_kw: 25,    buyback: 0.098, structure: 'Flat',            notes: 'NEM retail; R flat; municipal utility Eugene OR' },
          // Washington
          { name: 'Puget Sound Energy',          state: 'WA', nm: true,  limit_kw: 100,   buyback: 0.112, structure: 'TOU',             notes: 'WA NEM retail; EV TOU optional; interconnect 100 kW 2024' },
          { name: 'Avista Utilities',            state: 'WA', nm: true,  limit_kw: 100,   buyback: 0.098, structure: 'Flat',            notes: 'WA NEM retail; Schedule 1 flat; Spokane area 2024' },
          { name: 'Snohomish PUD',               state: 'WA', nm: true,  limit_kw: 100,   buyback: 0.095, structure: 'Flat',            notes: 'WA NEM retail; Schedule 1 flat; Everett area' },
          // Hawaii
          { name: 'Hawaiian Electric',           state: 'HI', nm: false, limit_kw: 100,   buyback: 0.180, structure: 'TOU',             notes: 'SEM (Smart Export) rate; no NEM for new apps; TOU-EV; Oahu 2024' },
          { name: 'Maui Electric',               state: 'HI', nm: false, limit_kw: 100,   buyback: 0.165, structure: 'TOU',             notes: 'SEM export rate; TOU residential; Maui/Lanai 2024' },
          { name: 'Hawaii Electric Light',       state: 'HI', nm: false, limit_kw: 100,   buyback: 0.170, structure: 'TOU',             notes: 'Big Island; SEM export; TOU residential 2024' },
          // Alaska
          { name: 'Golden Valley Electric',      state: 'AK', nm: true,  limit_kw: 25,    buyback: 0.145, structure: 'Flat',            notes: 'AK NEM retail; flat residential; Fairbanks 2024' },
          { name: 'Chugach Electric',            state: 'AK', nm: true,  limit_kw: 25,    buyback: 0.185, structure: 'Flat',            notes: 'NEM retail; flat residential; Anchorage 2024' },
          // New Hampshire
          { name: 'Eversource NH',               state: 'NH', nm: true,  limit_kw: 100,   buyback: 0.235, structure: 'Flat',            notes: 'NH NEM full retail; RS flat; interconnect 100 kW 2024' },
          { name: 'Unitil',                      state: 'NH', nm: true,  limit_kw: 100,   buyback: 0.235, structure: 'Flat',            notes: 'NH NEM retail; G residential flat; Portsmouth/Concord 2024' },
          { name: 'New Hampshire Electric Coop', state: 'NH', nm: true,  limit_kw: 100,   buyback: 0.220, structure: 'Flat',            notes: 'NH NEM retail; flat residential; rural NH co-op' },
          // Maine
          { name: 'Central Maine Power',         state: 'ME', nm: true,  limit_kw: 100,   buyback: 0.265, structure: 'Flat',            notes: 'ME NEM retail; residential flat; interconnect 100 kW 2024' },
          { name: 'Versant Power',               state: 'ME', nm: true,  limit_kw: 100,   buyback: 0.272, structure: 'Flat',            notes: 'ME NEM retail; northern/eastern ME; interconnect 100 kW 2024' },
          // Vermont
          { name: 'Green Mountain Power',        state: 'VT', nm: true,  limit_kw: 500,   buyback: 0.215, structure: 'TOU',             notes: 'VT NEM retail; TOU-R residential; interconnect 500 kW 2024' },
          { name: 'Vermont Electric Coop',       state: 'VT', nm: true,  limit_kw: 500,   buyback: 0.200, structure: 'Flat',            notes: 'VT NEM retail; flat residential; northeast VT 2024' },
          { name: 'Washington Electric Coop',    state: 'VT', nm: true,  limit_kw: 500,   buyback: 0.195, structure: 'Flat',            notes: 'VT NEM retail; flat residential; central VT' },
          // Rhode Island
          { name: 'National Grid RI',            state: 'RI', nm: true,  limit_kw: 25,    buyback: 0.235, structure: 'Flat',            notes: 'RI NEM full retail; flat residential RS-1 2024' },
          // Delaware
          { name: 'Delmarva Power DE',           state: 'DE', nm: true,  limit_kw: 25,    buyback: 0.138, structure: 'Flat',            notes: 'DE NEM retail; RS flat; Exelon Delaware 2024' },
          { name: 'Delaware Electric Coop',      state: 'DE', nm: true,  limit_kw: 25,    buyback: 0.132, structure: 'Flat',            notes: 'DE NEM retail; flat residential; rural Delaware' },
          // Washington DC
          { name: 'Pepco DC',                    state: 'DC', nm: true,  limit_kw: 100,   buyback: 0.160, structure: 'TOU',             notes: 'DC NEM retail; R TOU; interconnect 100 kW; DC PSC 2024' },
          // Tennessee
          { name: 'Tennessee Valley Authority',  state: 'TN', nm: false, limit_kw: 10,    buyback: 0.035, structure: 'TOU',             notes: 'TVA Green Power Providers; avoided cost credit; TOU Green Power rate' },
          { name: 'Memphis Light Gas & Water',   state: 'TN', nm: false, limit_kw: 10,    buyback: 0.032, structure: 'Flat',            notes: 'TVA distributor; avoided cost buyback; flat residential' },
          // Kentucky
          { name: 'LGE/KU',                      state: 'KY', nm: true,  limit_kw: 45,    buyback: 0.098, structure: 'Flat',            notes: 'KY NEM retail (SB 100); RS flat; PPL/E.ON 2024' },
          { name: 'AEP Kentucky',                state: 'KY', nm: true,  limit_kw: 45,    buyback: 0.095, structure: 'Flat',            notes: 'KY NEM retail; residential flat' },
          // West Virginia
          { name: 'Appalachian Power WV',        state: 'WV', nm: true,  limit_kw: 25,    buyback: 0.072, structure: 'Flat',            notes: 'WV NEM avoided cost; AEP; flat residential 2024' },
          { name: 'Monongahela Power',           state: 'WV', nm: true,  limit_kw: 25,    buyback: 0.070, structure: 'Flat',            notes: 'WV NEM avoided cost; FirstEnergy WV; flat residential' },
          // Indiana
          { name: 'AES Indiana',                 state: 'IN', nm: true,  limit_kw: 1000,  buyback: 0.112, structure: 'TOU',             notes: 'IN NEM retail; TOU-D residential; Indianapolis Power & Light 2024' },
          { name: 'Duke Energy Indiana',         state: 'IN', nm: true,  limit_kw: 1000,  buyback: 0.108, structure: 'Flat',            notes: 'IN NEM retail; RS flat; interconnect 1 MW 2024' },
          { name: 'Indiana Michigan Power',      state: 'IN', nm: true,  limit_kw: 1000,  buyback: 0.100, structure: 'Flat',            notes: 'AEP Indiana; NEM retail; flat residential' },
          // Alabama
          { name: 'Alabama Power',               state: 'AL', nm: true,  limit_kw: 300,   buyback: 0.065, structure: 'Flat',            notes: 'AL NEM avoided cost; RS flat; Southern Company 2024' },
          { name: 'PowerSouth Energy',           state: 'AL', nm: true,  limit_kw: 25,    buyback: 0.055, structure: 'Flat',            notes: 'AL co-op; NEM avoided cost; flat residential' },
          // Mississippi
          { name: 'Entergy Mississippi',         state: 'MS', nm: true,  limit_kw: 300,   buyback: 0.092, structure: 'Flat',            notes: 'MS NEM retail; RS flat; interconnect 300 kW 2024' },
          { name: 'Singing River Electric',      state: 'MS', nm: true,  limit_kw: 25,    buyback: 0.070, structure: 'Flat',            notes: 'MS co-op; NEM avoided cost; flat residential' },
          // Louisiana
          { name: 'Entergy Louisiana',           state: 'LA', nm: true,  limit_kw: 300,   buyback: 0.095, structure: 'Flat',            notes: 'LA NEM retail; RS flat residential; interconnect 300 kW 2024' },
          { name: 'CLECO',                       state: 'LA', nm: true,  limit_kw: 25,    buyback: 0.090, structure: 'Flat',            notes: 'LA NEM retail; Rate 1 flat residential' },
          // Arkansas
          { name: 'Entergy Arkansas',            state: 'AR', nm: true,  limit_kw: 300,   buyback: 0.098, structure: 'Flat',            notes: 'AR NEM retail; RS flat; interconnect 300 kW 2024' },
          { name: 'Arkansas Valley Electric',    state: 'AR', nm: true,  limit_kw: 25,    buyback: 0.075, structure: 'Flat',            notes: 'AR co-op; NEM avoided cost; rural residential' },
          // Oklahoma
          { name: 'Oklahoma Gas & Electric',     state: 'OK', nm: true,  limit_kw: 25,    buyback: 0.082, structure: 'TOU',             notes: 'OK NEM avoided cost; Smart-Hours TOU residential; OG&E 2024' },
          { name: 'PSO (AEP Oklahoma)',          state: 'OK', nm: true,  limit_kw: 25,    buyback: 0.080, structure: 'Flat',            notes: 'OK NEM avoided cost; flat residential' },
          // New Mexico
          { name: 'PNM',                         state: 'NM', nm: true,  limit_kw: 80,    buyback: 0.130, structure: 'TOU',             notes: 'NM NEM retail; EV-TOU residential; interconnect 80 kW 2024' },
          { name: 'El Paso Electric',            state: 'NM', nm: true,  limit_kw: 80,    buyback: 0.118, structure: 'Flat',            notes: 'NM NEM retail; RS flat; NM/TX border 2024' },
        ];

        // PERF FIX: Replaced ~240 serial DB queries with batched parallel upserts.
        // Process utilities in batches of 20 concurrent upserts to stay within
        // Neon connection limits while still being much faster than sequential.
        let seedCount = 0;
        const seedLog: string[] = [];
        const BATCH_SIZE = 20;

        for (let i = 0; i < utilitySeeds.length; i += BATCH_SIZE) {
          const batch = utilitySeeds.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map(async (u) => {
              const updated = await sql`
                UPDATE utility_policies SET
                  net_metering             = ${u.nm},
                  interconnection_limit_kw = ${u.limit_kw},
                  buyback_rate             = ${u.buyback},
                  rate_structure           = ${u.structure},
                  notes                    = ${u.notes},
                  updated_at               = NOW()
                WHERE LOWER(TRIM(utility_name)) = LOWER(TRIM(${u.name}))
                  AND state = ${u.state}
                RETURNING id
              `;
              if (updated.length > 0) {
                return { action: 'updated', name: u.name, state: u.state };
              }
              await sql`
                INSERT INTO utility_policies
                  (utility_name, state, country, net_metering,
                   interconnection_limit_kw, buyback_rate, rate_structure, notes, source)
                VALUES
                  (${u.name}, ${u.state}, 'US', ${u.nm},
                   ${u.limit_kw}, ${u.buyback}, ${u.structure}, ${u.notes}, 'seeded')
                ON CONFLICT DO NOTHING
              `;
              return { action: 'inserted', name: u.name, state: u.state };
            })
          );

          for (const result of results) {
            if (result.status === 'fulfilled') {
              seedCount++;
              seedLog.push(`${result.value.action}: ${result.value.name} (${result.value.state})`);
            } else {
              seedLog.push(`FAILED: ${(result.reason as Error).message}`);
            }
          }
        }
        await logAdminAction({
          adminId: admin.id,
          action: 'seed_utility_policies',
          metadata: { seeded: seedCount, total: utilitySeeds.length },
        });
        return NextResponse.json({
          success: true,
          message: `✅ Utility policies seeded: ${seedCount}/${utilitySeeds.length} utilities upserted`,
          details: seedLog,
          seeded: seedCount,
          total: utilitySeeds.length,
        });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown tool: ${tool}` }, { status: 400 });
    }
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/system-tools/route.ts]', e);
  }
}