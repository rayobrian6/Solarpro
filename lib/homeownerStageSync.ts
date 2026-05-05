// ============================================================================
// lib/homeownerStageSync.ts — Auto-advance homeowner_stage on pipeline events
//
// PURPOSE:
//   When a contractor/admin completes internal pipeline work, this module
//   automatically advances projects.homeowner_stage to reflect real progress.
//
// RULES:
//   - Event = completed work → homeowner_stage = NEXT step in process
//   - Only advances forward (no backward movement)
//   - Writes directly to projects.homeowner_stage
//   - Logs every change to project_homeowner_stage_history
//   - Retries once on DB failure before logging ERROR (non-blocking)
//   - Called from /api/projects/transition after a successful stage change
//
// MAPPING (event = what just FINISHED → stage = what happens NEXT):
//   site_assessment    → design           (survey done → design starts)
//   design_complete    → proposal         (design done → proposal stage)
//   proposal_sent      → proposal         (proposal ready for client)
//   contract_signed    → proposal         (still in proposal phase)
//   install_scheduled  → installation     (booked → installation stage)
//   installation       → installation     (in progress)
//   inspection         → installation     (post-install check)
//   pto                → installation     (awaiting utility approval)
//   complete           → completed        (project done)
// ============================================================================

import { getDbReady } from '@/lib/db-neon';

export const HOMEOWNER_STAGES = [
  'lead_submitted',
  'under_review',
  'site_survey',
  'design',
  'proposal',
  'installation',
  'completed',
] as const;

export type HomeownerStage = (typeof HOMEOWNER_STAGES)[number];

// Maps internal pipeline stages → homeowner_stage (next step in process)
const PIPELINE_TO_HOMEOWNER: Record<string, HomeownerStage> = {
  site_assessment:   'design',       // survey completed → design starts
  design_complete:   'proposal',     // design done → proposal stage
  proposal_sent:     'proposal',     // proposal ready
  contract_signed:   'proposal',     // still proposal phase
  install_scheduled: 'installation', // booked → installation
  installation:      'installation', // in progress
  inspection:        'installation', // post-install check
  pto:               'installation', // awaiting PTO
  complete:          'completed',    // all done
};

/**
 * syncHomeownerStage — called after a successful internal pipeline transition.
 *
 * Checks if the new internal stage maps to a homeowner_stage advancement.
 * Retries once on failure. Logs ERROR with full stack trace if both attempts fail.
 *
 * @param projectId         UUID of the project
 * @param newPipelineStage  The new internal pipeline stage (from DEAL_TRANSITIONS)
 * @param changedBy         Admin/user UUID for history log (nullable)
 */
export async function syncHomeownerStage(
  projectId: string,
  newPipelineStage: string,
  changedBy: string | null = null,
): Promise<void> {
  const targetHomeownerStage = PIPELINE_TO_HOMEOWNER[newPipelineStage];
  if (!targetHomeownerStage) {
    // No homeowner mapping for this internal stage — nothing to do
    return;
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await _doSync(projectId, newPipelineStage, targetHomeownerStage, changedBy);
      return; // Success
    } catch (err) {
      lastError = err;
      if (attempt === 1) {
        // Wait 500ms before retry
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  // Both attempts failed — log ERROR with full context
  const msg   = lastError instanceof Error ? lastError.message : String(lastError);
  const stack = lastError instanceof Error ? (lastError.stack ?? '') : '';
  console.error(
    `[syncHomeownerStage] ERROR: Failed after 2 attempts ` +
    `project=${projectId} pipelineStage=${newPipelineStage} ` +
    `targetStage=${targetHomeownerStage}\n` +
    `Message: ${msg}\n` +
    `Stack: ${stack}`,
  );
}

async function _doSync(
  projectId: string,
  newPipelineStage: string,
  targetHomeownerStage: HomeownerStage,
  changedBy: string | null,
): Promise<void> {
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
    if (process.env.NODE_ENV === 'development') {
      console.debug(
        `[syncHomeownerStage] Skip: project=${projectId} ` +
        `current=${currentStage} already >= target=${targetHomeownerStage}`,
      );
    }
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
  const note = `Auto-advanced via pipeline event: ${newPipelineStage}`;
  await sql`
    INSERT INTO project_homeowner_stage_history
      (project_id, stage, changed_by, note)
    VALUES
      (${projectId}, ${targetHomeownerStage}, ${changedBy}, ${note})
  `;

  console.log(
    `[syncHomeownerStage] Advanced project=${projectId} ` +
    `${currentStage ?? 'null'} → ${targetHomeownerStage} ` +
    `(pipeline: ${newPipelineStage})`,
  );
}