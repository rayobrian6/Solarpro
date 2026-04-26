/**
 * lib/operations/generateTasksForStage.ts
 * 
 * Automation engine — generates predefined tasks when a project enters a new stage.
 * v47.350: Initial implementation
 * 
 * Behavior:
 * - Deletes existing tasks for that stage (avoid duplicates)
 * - Inserts predefined tasks based on TASK_MAP
 */

import { getDbReady } from '@/lib/db-neon';
import { TASK_MAP, type PipelineStage } from './pipeline';

/**
 * Generate tasks for a given project + stage.
 * Idempotent: clears existing tasks for the stage first.
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

  // Delete existing tasks for this project+stage to avoid duplicates
  await sql`
    DELETE FROM project_tasks
    WHERE project_id = ${projectId}
      AND stage = ${stage}
  `;

  // Insert new tasks
  let inserted = 0;
  for (const title of tasks) {
    await sql`
      INSERT INTO project_tasks (project_id, title, status, stage)
      VALUES (${projectId}, ${title}, 'pending', ${stage})
    `;
    inserted++;
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