/**
 * lib/operations/generateTasksForStage.ts
 * 
 * Automation engine — generates predefined tasks when a project enters a new stage.
 * v47.350: Initial implementation
 * 
 * Behavior:
 * - Inserts the predefined tasks from TASK_MAP that are not already present
 * - Never removes or resets a task that already exists
 */

import { getDbReady } from '@/lib/db-neon';
import { TASK_MAP, type PipelineStage } from './pipeline';

/**
 * Generate tasks for a given project + stage.
 *
 * Idempotent and ADDITIVE: inserts only the titles that are not already there,
 * and never touches a row that is.
 *
 * 🚨 THIS USED TO OPEN WITH `DELETE FROM project_tasks WHERE project_id = ...
 * AND stage = ...` and then re-insert the whole TASK_MAP as 'pending'. It was
 * idempotent in the sense the author meant — running it twice left no duplicate
 * rows — but not in the sense that matters, because running it twice destroyed
 * everything that had happened in between.
 *
 * `project_tasks` is where the crew's work is recorded. `status` and
 * `completed_at` are written by a human ticking a box in
 * `PATCH /api/projects/[id]/tasks`, and the GET on that route reports a
 * completion percentage from them. Deleting a row deletes the fact that the
 * work was done, with no tombstone and no activity-log entry — the transition
 * log records the stage change, never the erasure.
 *
 * And re-entry is one click away. Neither caller constrains the move:
 * `transition/route.ts` gates on `isValidStage`, which only asks whether the
 * string is in the enum, so installation -> inspection -> installation is
 * accepted — exactly what a failed inspection looks like — and
 * `update-status/route.ts` has no same-stage check, so re-selecting the stage a
 * project is already in wiped its checklist. Both callers treat a failure here
 * as non-fatal, so it was silent either way.
 *
 * A title dropped from TASK_MAP leaves its existing rows alone rather than
 * removing them: a completed task is a record of work, and retiring it from the
 * template is not a reason to deny it happened.
 */
export async function generateTasksForStage(
  projectId: string,
  stage: PipelineStage
): Promise<{ inserted: number }> {
  const tasks = TASK_MAP[stage];
  if (!tasks || tasks.length === 0) {
    return { inserted: 0 };
  }

  const sql = await getDbReady();

  // Insert each predefined task only if this project+stage does not already
  // have one by that title. Expressed as a single conditional INSERT rather
  // than a read followed by a write, so the check and the insert cannot be
  // separated by a concurrent generation for the same project.
  let inserted = 0;
  for (const title of tasks) {
    const rows = await sql`
      INSERT INTO project_tasks (project_id, title, status, stage)
      SELECT ${projectId}, ${title}, 'pending', ${stage}
      WHERE NOT EXISTS (
        SELECT 1 FROM project_tasks
        WHERE project_id = ${projectId}
          AND stage      = ${stage}
          AND title      = ${title}
      )
      RETURNING id
    `;
    if (rows.length > 0) inserted++;
  }

  return { inserted };
}

/**
 * Check if all tasks in a given stage are completed.
 * Returns { allComplete, total, completed }
 */
export async function checkStageCompletion(
  projectId: string,
  stage: string
): Promise<{ allComplete: boolean; total: number; completed: number }> {
  const sql = await getDbReady();

  const rows = await sql`
    SELECT status FROM project_tasks
    WHERE project_id = ${projectId}
      AND stage = ${stage}
  `;

  const total = rows.length;
  const completed = rows.filter((r: any) => r.status === 'completed').length;

  return {
    allComplete: total > 0 && completed === total,
    total,
    completed,
  };
}