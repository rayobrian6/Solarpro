// ============================================================================
// lib/homeownerStageSync.ts — Auto-advance homeowner_stage on pipeline events
//
// PURPOSE:
//   When a contractor/admin completes internal pipeline work, this module
//   automatically advances projects.homeowner_stage to reflect real progress.
//
// RULES:
//   - Only advances forward (no backward movement without force=true)
//   - Writes directly to projects.homeowner_stage
//   - Logs every change to project_homeowner_stage_history
//   - Never throws — all errors are caught and logged (non-fatal)
//   - Called from /api/projects/transition after a successful stage change
//
// MAPPING:
//   Internal pipeline stage → homeowner_stage
//   site_assessment         → site_survey      (survey underway)
//   design_complete         → design           (design done)
//   proposal_sent           → proposal         (proposal ready)
//   install_scheduled       → installation     (install booked)
//   inspection              → installation     (install done, inspecting)
//   pto                     → installation     (awaiting PTO)
//   complete                → completed        (project done)
// ============================================================================

import { getDbReady } from '@/lib/db-neon';

const HOMEOWNER_STAGES = [
  'lead_submitted',
  'under_review',
  'site_survey',
  'design',
  'proposal',
  'installation',
  'completed',
] as const;

type HomeownerStage = (typeof HOMEOWNER_STAGES)[number];

// Maps internal pipeline stages to homeowner_stage values
const PIPELINE_TO_HOMEOWNER: Record<string, HomeownerStage> = {
  site_assessment:  'site_survey',
  design_complete:  'design',
  proposal_sent:    'proposal',
  contract_signed:  'proposal',
  install_scheduled: 'installation',
  installation:     'installation',
  inspection:       'installation',
  pto:              'installation',
  complete:         'completed',
};

/**
 * syncHomeownerStage — called after a successful internal pipeline transition.
 *
 * Checks if the new internal stage maps to a homeowner_stage advancement,
 * and if so, updates the project and logs to history.
 *
 * @param projectId   UUID of the project
 * @param newPipelineStage  The new internal pipeline stage (from DEAL_TRANSITIONS)
 * @param changedBy   Admin/user UUID for history log (nullable)
 */
export async function syncHomeownerStage(
  projectId: string,
  newPipelineStage: string,
  changedBy: string | null = null,
): Promise<void> {
  const targetHomeownerStage = PIPELINE_TO_HOMEOWNER[newPipelineStage];
  if (!targetHomeownerStage) {
    // No mapping for this pipeline stage — nothing to do
    return;
  }

  try {
    const sql = await getDbReady();

    // Read current homeowner_stage
    const rows = await sql`
      SELECT homeowner_stage FROM projects WHERE id = ${projectId} LIMIT 1
    `;
    if (rows.length === 0) return;

    const currentStage = rows[0].homeowner_stage as HomeownerStage | null;

    // Only advance forward
    const currentIdx = currentStage ? HOMEOWNER_STAGES.indexOf(currentStage) : -1;
    const targetIdx  = HOMEOWNER_STAGES.indexOf(targetHomeownerStage);

    if (targetIdx <= currentIdx) {
      // Already at or ahead of target — skip
      return;
    }

    // Advance homeowner_stage
    await sql`
      UPDATE projects
      SET homeowner_stage = ${targetHomeownerStage},
          updated_at      = NOW()
      WHERE id = ${projectId}
    `;

    // Log to history
    const note = `Auto-advanced from internal pipeline stage: ${newPipelineStage}`;
    await sql`
      INSERT INTO project_homeowner_stage_history
        (project_id, stage, changed_by, note)
      VALUES
        (${projectId}, ${targetHomeownerStage}, ${changedBy}, ${note})
    `;

    if (process.env.NODE_ENV === 'development') {
      console.debug(
        `[syncHomeownerStage] project=${projectId} ` +
        `${currentStage ?? 'null'} → ${targetHomeownerStage} ` +
        `(pipeline: ${newPipelineStage})`,
      );
    }
  } catch (err) {
    // Non-fatal — log and continue
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[syncHomeownerStage] WARN: Failed to sync for project=${projectId}: ${msg}`,
    );
  }
}