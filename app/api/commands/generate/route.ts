export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { generateActionsForProjects } from '@/lib/commands/generateActions';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

/**
 * POST /api/commands/generate — Recalculate auto-generated actions for all user projects.
 * 
 * Duplicate prevention: only inserts actions where no pending action
 * of the same type+project already exists.
 * 
 * Body: { project_id?: string } — optional, limit to single project
 */
export async function POST(req: NextRequest) {
  try {
        const rl = await checkRateLimit('commands', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const projectFilter = body?.project_id;

    const sql = await getDbReady();

    // Fetch projects with relevant data.
    // 🚨 `last_stage_change_at` is REQUIRED by the follow-up rules, not optional.
    // They used to measure staleness from `updated_at`, which 20+ unrelated writers
    // bump — so rule 4 (permit_submitted + daysStale >= 5) never fired for an
    // actively-edited project and the AHJ chase-up command was never created. Without
    // this sub-select lib/operations/stageClock.ts can only resolve to 'last_activity',
    // and the rules then correctly refuse the event phrasing — so the command still
    // appears, but with weaker wording and yellow rather than red urgency. Supplying
    // it is what restores the real stage clock.
    // Derived from project_activity until the stage_changed_at column exists
    // (NEEDS RAY — a migration). Kept in sync with LAST_STAGE_CHANGE_SQL.
    const projects = projectFilter
      ? await sql`
          SELECT p.id, p.name, p.status, p.project_status, p.updated_at,
                 p.install_date, p.crew_assigned, p.contract_signed_at,
                 p.contract_value, c.name AS client_name,
                 (SELECT MAX(a.created_at) FROM project_activity a
                    WHERE a.project_id = p.id
                      AND (a.type = 'stage_change' OR a.metadata->>'to_stage' IS NOT NULL)
                 ) AS last_stage_change_at
          FROM projects p
          LEFT JOIN clients c ON c.id = p.client_id
          WHERE p.user_id = ${user.id} AND p.id = ${projectFilter}
            AND p.deleted_at IS NULL
        `
      : await sql`
          SELECT p.id, p.name, p.status, p.project_status, p.updated_at,
                 p.install_date, p.crew_assigned, p.contract_signed_at,
                 p.contract_value, c.name AS client_name,
                 (SELECT MAX(a.created_at) FROM project_activity a
                    WHERE a.project_id = p.id
                      AND (a.type = 'stage_change' OR a.metadata->>'to_stage' IS NOT NULL)
                 ) AS last_stage_change_at
          FROM projects p
          LEFT JOIN clients c ON c.id = p.client_id
          WHERE p.user_id = ${user.id}
            AND p.deleted_at IS NULL
            AND COALESCE(p.project_status, p.status) NOT IN ('complete', 'installed')
        `;

    // Generate actions from current project state
    const generated = generateActionsForProjects(
      projects.map((p: any) => ({
        id: p.id,
        name: p.name,
        client_name: p.client_name,
        project_status: p.project_status || p.status || 'lead',
        status: p.status,
        updated_at: p.updated_at,
        // The stage clock. `updated_at` stays as "last touched" and is labelled that
        // way; this is what makes a stall claim a stall claim.
        last_stage_change_at: p.last_stage_change_at,
        install_date: p.install_date,
        crew_assigned: p.crew_assigned,
        contract_signed_at: p.contract_signed_at,
        contract_value: p.contract_value ? Number(p.contract_value) : undefined,
      }))
    );

    if (generated.length === 0) {
      return NextResponse.json({ created: 0, message: 'No actions needed' });
    }

    // Fetch existing pending auto-generated actions to prevent duplicates
    const existing = await sql`
      SELECT project_id, type
      FROM command_center_actions
      WHERE user_id = ${user.id}
        AND status = 'pending'
        AND auto_generated = true
    `;

    const existingSet = new Set(
      existing.map((e: any) => `${e.project_id}::${e.type}`)
    );

    // Filter out duplicates
    const toInsert = generated.filter(
      a => !existingSet.has(`${a.project_id}::${a.type}`)
    );

    if (toInsert.length === 0) {
      return NextResponse.json({ created: 0, message: 'All actions already exist' });
    }

    // Batch insert
    let created = 0;
    for (const a of toInsert) {
      try {
        await sql`
          INSERT INTO command_center_actions
            (project_id, user_id, title, description, type, priority, due_date, auto_generated)
          VALUES
            (${a.project_id}, ${user.id}, ${a.title}, ${a.description},
             ${a.type}, ${a.priority}, ${a.due_date || null}, true)
        `;
        created++;
      } catch (e: unknown) {
        // Skip individual insert failures (e.g. FK violations for deleted projects)
        console.warn(`[commands/generate] Skip insert for ${a.project_id}: ${(e as Error).message}`);
      }
    }

    return NextResponse.json({ created, total_generated: generated.length, duplicates_skipped: generated.length - toInsert.length });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/commands/generate]', error);
  }
}