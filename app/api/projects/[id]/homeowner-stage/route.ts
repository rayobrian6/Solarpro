/**
 * GET  /api/projects/[id]/homeowner-stage  — returns current stage for installer's project
 * PATCH /api/projects/[id]/homeowner-stage — set stage; writes history + micro-stage
 *
 * Access: project must belong to the authenticated user (installer).
 * Never called by the portal (portal is read-only; stages advance automatically
 * on share/sign, or manually here by the installer).
 */

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
// The canonical micro-stage vocabulary. Imported as a VALUE as well as a type:
// the type makes a misspelling in STAGE_MICRO_MAP a compile error, and the array
// is what the write below is actually gated on at runtime. A type erases to
// nothing, and `project_micro_stages.micro_stage` is TEXT with no CHECK, so
// without the array there is no guard on the INSERT at all.
import { MICRO_STAGES, type MicroStage } from '@/lib/microStage';

const HOMEOWNER_STAGES = [
  'lead_submitted',
  'under_review',
  'site_survey',
  'design',
  'proposal',
  'installation',
  'completed',
] as const;

type HomeownerStage = typeof HOMEOWNER_STAGES[number];

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const { id: projectId } = await params;
  if (!isValidUUID(projectId)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT homeowner_stage
      FROM   projects
      WHERE  id      = ${projectId}
        AND  user_id = ${user.id}
        AND  deleted_at IS NULL
      LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Project not found or access denied' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      stage: (rows[0].homeowner_stage as string | null) ?? null,
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/projects/[id]/homeowner-stage]', err);
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const { id: projectId } = await params;
  if (!isValidUUID(projectId)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
  }

  let body: { stage?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const stage = body?.stage as HomeownerStage | undefined;
  if (!stage || !(HOMEOWNER_STAGES as readonly string[]).includes(stage)) {
    return NextResponse.json(
      { success: false, error: `Invalid stage. Must be one of: ${HOMEOWNER_STAGES.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const sql = await getDbReady();

    // Verify project belongs to this user
    const rows = await sql`
      SELECT id, homeowner_stage
      FROM projects
      WHERE id = ${projectId}
        AND user_id = ${user.id}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Project not found or access denied' },
        { status: 404 }
      );
    }

    const previousStage = rows[0].homeowner_stage as string | null;

    // Update homeowner_stage
    await sql`
      UPDATE projects
      SET homeowner_stage = ${stage},
          updated_at      = NOW()
      WHERE id = ${projectId}
        AND user_id = ${user.id}
    `;

    // Write stage history row
    try {
      await sql`
        INSERT INTO project_homeowner_stage_history (project_id, stage, changed_by, note)
        VALUES (${projectId}, ${stage}, ${user.id}, ${body.note ?? null})
      `;
    } catch {
      // Table may not exist — non-fatal
    }

    // Write micro-stage event (stage_advanced for generic stage changes)
    // Also write specific milestone micro-stages for meaningful transitions
    /**
     * 🚨 TYPED AS `MicroStage`, BECAUSE IT WAS TYPED AS `string` AND WRONG.
     *
     * The `completed` entry read `installation_complete` — which is a
     * DealDecisionAction name (lib/deals/transitions.ts), not a micro-stage at
     * all. The real value is `install_completed` (lib/microStage.ts). Three
     * things conspired to make that invisible:
     *
     *   - the map's value type was `string`, so tsc had nothing to check it
     *     against;
     *   - the INSERT below is raw, bypassing `writeMicroStage`'s typed
     *     signature;
     *   - `project_micro_stages.micro_stage` is TEXT with no CHECK constraint,
     *     so the database accepted it too.
     *
     * And `ON CONFLICT ... DO UPDATE` means the junk row, once written, is
     * permanent for that project. So every project that reached `completed`
     * through this route carries a micro-stage no consumer recognises, and the
     * completion milestone it was meant to record never appeared.
     *
     * Typing the map made a misspelling a compile error rather than a row. It is
     * NOT a guard on the write: a type erases at build time, and the INSERT below
     * interpolates whatever this map holds. So the value is additionally taken
     * FROM `MICRO_STAGES` at runtime — the lookup returns an element of the
     * canonical array or nothing, which makes a name the vocabulary does not
     * contain unwritable rather than merely discouraged.
     */
    const STAGE_MICRO_MAP: Partial<Record<HomeownerStage, MicroStage>> = {
      proposal:      'proposal_sent',
      installation:  'contract_signed',
      completed:     'install_completed',
    };
    const mapped = STAGE_MICRO_MAP[stage];
    // 🚨 The value written is the one the authority hands back, not the one this
    // file asked for. `find` on MICRO_STAGES is deliberate rather than a boolean
    // `includes` test: what reaches the INSERT is then literally a member of the
    // canonical array, so there is no second variable a later edit could pass
    // instead.
    const microKey = mapped
      ? MICRO_STAGES.find(candidate => candidate === mapped)
      : undefined;
    if (mapped && !microKey) {
      // Unreachable while the map type-checks — which is the point. If it ever
      // does happen it is a code defect, the stage change the installer asked
      // for still stands, and NOTHING goes into a table whose UNIQUE constraint
      // would make the bad row permanent.
      console.error(
        '[homeowner-stage] REFUSED non-canonical micro-stage: project=%s stage=%s value=%s',
        projectId, stage, mapped
      );
    }
    if (microKey) {
      try {
        await sql`
          INSERT INTO project_micro_stages (project_id, micro_stage)
          VALUES (${projectId}, ${microKey})
          ON CONFLICT (project_id, micro_stage) DO UPDATE SET created_at = NOW()
        `;
      } catch {
        // Non-fatal
      }
    }

    console.log(
      '[homeowner-stage] project=%s user=%s %s → %s',
      projectId, user.id, previousStage ?? 'null', stage
    );

    return NextResponse.json({
      success:       true,
      stage,
      previousStage: previousStage ?? null,
    });
  } catch (err: unknown) {
    return handleRouteDbError('[PATCH /api/projects/[id]/homeowner-stage]', err);
  }
}
