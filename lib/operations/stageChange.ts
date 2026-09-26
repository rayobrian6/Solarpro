/**
 * lib/operations/stageChange.ts
 *
 * THE ONE PLACE A PIPELINE STAGE IS WRITTEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * A stage change is not one column. It is:
 *
 *   1. `projects.project_status`  — the 13-stage ops pipeline the installer sees
 *   2. `projects.status`          — the legacy 5-value column older views read
 *   3. `projects.contract_signed_at` / `actual_completion` — the dated facts
 *   4. a `project_activity` row   — WHO moved it, WHEN, and FROM WHERE
 *   5. `project_tasks`            — the checklist the new stage implies
 *
 * Every surface that changed a stage did (1) and (2) and stopped. The activity
 * row was left to each caller to remember, and four of the five forgot — so
 * "who moved this to Permit Approved, and when" was unanswerable for the
 * MAJORITY of transitions, and the one caller that did write a row invented its
 * `from_stage` as the literal `'contract_signed'` rather than reading it.
 *
 * So the row is written HERE, by the writer that already knows the previous
 * stage because it read the row it is about to update. A caller cannot forget
 * something it does not do.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 WHAT THIS FILE DELIBERATELY DOES **NOT** DO
 * ─────────────────────────────────────────────────────────────────────────────
 * It does not advance the CUSTOMER-facing stage (`projects.homeowner_stage` and
 * the `project_micro_stages` log). That pair stays at each route's own call
 * site, and that is not an oversight:
 *
 *   • `tests/pipelineAdvancesTheCustomerView.test.ts` and
 *     `tests/stageEntryIsNotAnOutcome.test.ts` both assert, on the source of
 *     `app/api/projects/update-status/route.ts` and
 *     `app/api/projects/transition/route.ts`, that those two routes themselves
 *     ask the shared stage→micro resolver and guard on its answer. Moving the
 *     calls in here would leave those guards green against files that no longer
 *     contain the behaviour — or red — and a guard satisfied by the wrong file
 *     is worse than no guard.
 *
 *   • A stage ENTRY is not the stage's OUTCOME. Which stages may record a
 *     customer-visible milestone is a per-pair judgement that lives in
 *     `lib/operations/pipelineMicroStage.ts` and is enumerated, by file, in
 *     `tests/stageEntryIsNotAnOutcome.test.ts`. A new writer inheriting that
 *     decision implicitly is exactly how `installation` once came to tell a
 *     customer they had signed a contract.
 *
 * A caller outside those two routes therefore needs BOTH halves. `NON_ROUTE_
 * CALLER_NOTE` below says so in one place so nobody has to rediscover it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO NEW STATE MACHINE
 * ─────────────────────────────────────────────────────────────────────────────
 * This is a WRITER, not a second pipeline. The stage vocabulary is still
 * `PROJECT_PIPELINE`; the decision vocabulary is still `DEAL_TRANSITIONS`; the
 * stage→legacy-status map is still the single copy in `lib/deals/transitions.ts`
 * (`stageToSimpleStatus`), imported rather than re-typed — `update-status` used
 * to carry a second, identical copy of that table.
 */

import { getDbReady } from '@/lib/db-neon';
import { STAGE_LABELS, isValidStage, type PipelineStage } from './pipeline';
import { stageToSimpleStatus } from '@/lib/deals/transitions';
import { generateTasksForStage } from './generateTasksForStage';

/**
 * Read this before calling `applyStageChange` from anywhere that is not
 * `app/api/projects/update-status` or `app/api/projects/transition`.
 *
 * Those two routes perform the customer-facing half at their own call sites.
 * Any other caller must do it too, immediately after this function returns, or
 * the homeowner portal will go on saying whatever it last said.
 */
export const NON_ROUTE_CALLER_NOTE =
  'applyStageChange writes the internal pipeline only. A caller outside ' +
  'app/api/projects/update-status and app/api/projects/transition must also ' +
  'advance the customer view (lib/homeownerStageSync + lib/microStage, guarded ' +
  'by lib/operations/pipelineMicroStage) or the homeowner portal will not move.';

/** The activity `type` every stage move records. One value, so a reader can filter. */
export const STAGE_CHANGE_ACTIVITY_TYPE = 'stage_change';

export interface ApplyStageChangeInput {
  /** Project UUID. The caller is responsible for ownership/authorisation. */
  projectId: string;
  /** Target ops pipeline stage. */
  toStage: PipelineStage | string;
  /** Who did it. Null for a system-initiated move. */
  userId?: string | null;
  /**
   * Where the move came from — 'update-status', 'deal-decision',
   * 'proposal_signature', 'proposal_created', … Recorded in the activity
   * metadata so a timeline can say which surface moved the deal.
   */
  source: string;
  /**
   * The stage the project was in. Pass it when you have already SELECTed the
   * row (the route does, for its ownership check) so the read is not repeated.
   * 🚨 Omitting it makes this function read the row. NEVER pass a guess: the
   * whole point of the repair is that `from_stage` is observed, not asserted.
   */
  prevStage?: string | null;
  /** Free text recorded on the activity row. */
  notes?: string | null;
  /** Extra activity metadata (milestone toggles, decision action, …). */
  extraMetadata?: Record<string, unknown>;
  /** YYYY-MM-DD. Persisted to `projects.install_date` when given. */
  installDate?: string | null;
  /**
   * Override the activity row's `type`. Defaults to
   * `STAGE_CHANGE_ACTIVITY_TYPE`. The deal-decision machine classifies some of
   * its transitions as 'follow_up' / 'schedule' / 'note' and that classification
   * predates this writer, so it is preserved rather than flattened.
   * 🚨 Whatever the type, the row still carries `metadata.to_stage`, and
   * `lastStageChangeAt` matches on EITHER — see lib/operations/stageClock.ts.
   */
  activityType?: string | null;
  /** Override the activity row's human-readable title. */
  activityTitle?: string | null;
}

export interface ApplyStageChangeResult {
  /** The stage the project was ACTUALLY in, read from the row. */
  prevStage: string;
  /** The stage it is in now. */
  toStage: string;
  /** The legacy 5-value status written alongside it. */
  legacyStatus: string;
  /** False when the `project_status` column does not exist and we fell back. */
  usedOpsColumn: boolean;
  /** The activity row's id, or null when the write failed (non-fatal). */
  activityId: string | null;
  /** Tasks inserted for the new stage. */
  tasksGenerated: number;
  /** True when prevStage === toStage (a confirm, not a move). */
  sameStage: boolean;
}

/**
 * Apply a pipeline stage change: columns, audit row, tasks.
 *
 * Column writes are fatal (a stage change that did not persist must not report
 * success). The activity row and task generation are non-fatal, because
 * `project_activity` and `project_tasks` are created only by the inline DDL in
 * `app/api/migrate/route.ts`, which is locked behind MIGRATION-GOV-13 — on a
 * database built from the scanned migration set neither table exists, and a
 * stage change must not fail because its audit trail has nowhere to land.
 *
 * 🚨 That non-fatality is the reason the row was missing for so long without
 * anyone noticing, so the failure is logged loudly rather than swallowed.
 */
export async function applyStageChange(
  input: ApplyStageChangeInput,
): Promise<ApplyStageChangeResult> {
  const { projectId, source, userId = null, notes = null, extraMetadata, installDate = null } = input;
  const toStage = String(input.toStage);

  if (!isValidStage(toStage)) {
    throw new Error(`applyStageChange: not a pipeline stage: ${toStage}`);
  }

  const sql = await getDbReady();

  // ── 1. The stage it is in NOW, observed ────────────────────────────────────
  //
  // 🚨 READ, NEVER ASSUMED. `components/commands/EngineeringReviewModal.tsx`
  // logged `from_stage: 'contract_signed'` as a literal, so a project moved to
  // engineering from anywhere else recorded a transition that never happened.
  let prevStage: string;
  if (input.prevStage !== undefined && input.prevStage !== null) {
    prevStage = String(input.prevStage);
  } else {
    let row: Record<string, unknown> | undefined;
    try {
      const rows = await sql`
        SELECT project_status, status FROM projects WHERE id = ${projectId}
      `;
      row = rows[0];
    } catch {
      // `project_status` may not exist — the legacy column still answers.
      const rows = await sql`SELECT status FROM projects WHERE id = ${projectId}`;
      row = rows[0];
    }
    prevStage = String(row?.project_status || row?.status || 'lead');
  }

  const legacyStatus = stageToSimpleStatus(toStage as PipelineStage);
  const sameStage = prevStage === toStage;

  // ── 2. The columns ─────────────────────────────────────────────────────────
  let usedOpsColumn = false;
  try {
    if (toStage === 'contract_signed') {
      await sql`
        UPDATE projects
        SET project_status = ${toStage},
            status = ${legacyStatus},
            contract_signed_at = COALESCE(contract_signed_at, NOW()),
            updated_at = NOW()
        WHERE id = ${projectId}
      `;
    } else if (toStage === 'complete') {
      await sql`
        UPDATE projects
        SET project_status = ${toStage},
            status = ${legacyStatus},
            actual_completion = NOW(),
            updated_at = NOW()
        WHERE id = ${projectId}
      `;
    } else if (installDate) {
      await sql`
        UPDATE projects
        SET project_status = ${toStage},
            status = ${legacyStatus},
            install_date = ${installDate},
            updated_at = NOW()
        WHERE id = ${projectId}
      `;
    } else {
      await sql`
        UPDATE projects
        SET project_status = ${toStage},
            status = ${legacyStatus},
            updated_at = NOW()
        WHERE id = ${projectId}
      `;
    }
    usedOpsColumn = true;
  } catch (opsErr) {
    // `project_status` column does not exist — write the legacy column only.
    console.warn('[applyStageChange] project_status column missing, using legacy status:', opsErr);
    await sql`
      UPDATE projects
      SET status = ${legacyStatus},
          updated_at = NOW()
      WHERE id = ${projectId}
    `;
  }

  // ── 3. The audit row — the whole reason this function exists ───────────────
  const activityTitle = input.activityTitle
    || (sameStage ? `Stage confirmed: ${label(toStage)}` : `Moved to ${label(toStage)}`);
  const activityType = input.activityType || STAGE_CHANGE_ACTIVITY_TYPE;

  const metadata: Record<string, unknown> = {
    source,
    from_stage: prevStage,
    to_stage: toStage,
    ...(installDate ? { install_date: installDate } : {}),
    ...(notes ? { notes } : {}),
    ...(extraMetadata ?? {}),
  };

  let activityId: string | null = null;
  try {
    const rows = await sql`
      INSERT INTO project_activity
        (project_id, user_id, type, title, details, metadata)
      VALUES
        (${projectId}, ${userId}, ${activityType},
         ${activityTitle}, ${notes || null}, ${JSON.stringify(metadata)})
      RETURNING id
    `;
    activityId = (rows[0]?.id as string | undefined) ?? null;
  } catch (logErr) {
    // Non-fatal — see the docblock. Logged at error level, not warn: a stage
    // change with no audit row is the defect this file was written to end.
    console.error('[applyStageChange] ACTIVITY ROW NOT WRITTEN:', logErr);
  }

  // ── 4. The new stage's checklist (additive, never destructive) ─────────────
  let tasksGenerated = 0;
  try {
    const res = await generateTasksForStage(projectId, toStage as PipelineStage);
    tasksGenerated = res.inserted;
  } catch (taskErr) {
    console.warn('[applyStageChange] task generation failed:', taskErr);
  }

  return { prevStage, toStage, legacyStatus, usedOpsColumn, activityId, tasksGenerated, sameStage };
}

function label(stage: string): string {
  return (STAGE_LABELS as Record<string, string>)[stage] ?? stage.replace(/_/g, ' ');
}
