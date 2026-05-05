// ============================================================================
// lib/microStage.ts — Micro-Stage Engine (Internal Truth Layer)
//
// PURPOSE:
//   Track granular internal project progress via micro_stages.
//   Map micro_stages → homeowner_stage automatically.
//
//   micro_stage  = internal truth (granular, contractor-facing)
//   homeowner_stage = simplified grouping (portal-facing)
//
// PUBLIC API:
//   writeMicroStage(projectId, stage, createdBy?, metadata?)
//     → inserts micro_stage + auto-syncs homeowner_stage
//
//   resolveHomeownerStage(projectId)
//     → reads latest micro_stage, returns mapped homeowner_stage
//
//   MICRO_STAGES  — const array of all valid micro stage values
//   MicroStage    — TypeScript union type
// ============================================================================

import { getDbReady } from '@/lib/db-neon';
import { HOMEOWNER_STAGES, type HomeownerStage } from '@/lib/homeownerStageSync';

// ── Micro stage definitions ──────────────────────────────────────────────────

export const MICRO_STAGES = [
  // Request Received
  'lead_created',
  'project_created',
  // Under Review
  'bill_uploaded',
  'bill_parsed',
  'usage_calculated',
  'pre_design_complete',
  // Agreement Signed
  'proposal_generated',
  'contract_sent',
  'contract_viewed',
  'contract_signed',
  // Site Survey
  'survey_scheduled',
  'survey_started',
  'survey_photos_uploaded',
  'survey_submitted',
  'survey_reviewed',
  // Design & Engineering
  'layout_started',
  'layout_completed',
  'engineering_started',
  'engineering_completed',
  'sld_generated',
  'planset_generated',
  // Proposal & Approval
  'final_proposal_generated',
  'proposal_sent',
  'proposal_viewed',
  'proposal_approved',
  // Installation
  'permit_submitted',
  'permit_approved',
  'install_scheduled',
  'install_started',
  'install_completed',
  'inspection_passed',
  'pto_submitted',
  'pto_approved',
  // Completed
  'system_live',
  'monitoring_active',
] as const;

export type MicroStage = (typeof MICRO_STAGES)[number];

// ── Micro → Homeowner mapping ────────────────────────────────────────────────
//
// Each micro_stage maps to the homeowner_stage it represents.
// Rule: micro_stage = what is happening NOW → homeowner_stage = current phase

const MICRO_TO_HOMEOWNER: Record<MicroStage, HomeownerStage> = {
  // Request Received → lead_submitted
  lead_created:           'lead_submitted',
  project_created:        'lead_submitted',
  // Under Review
  bill_uploaded:          'under_review',
  bill_parsed:            'under_review',
  usage_calculated:       'under_review',
  pre_design_complete:    'under_review',
  // Agreement Signed → proposal (contract phase maps to proposal stage)
  proposal_generated:     'proposal',
  contract_sent:          'proposal',
  contract_viewed:        'proposal',
  contract_signed:        'proposal',
  // Site Survey
  survey_scheduled:       'site_survey',
  survey_started:         'site_survey',
  survey_photos_uploaded: 'site_survey',
  survey_submitted:       'site_survey',
  survey_reviewed:        'site_survey',
  // Design & Engineering
  layout_started:         'design',
  layout_completed:       'design',
  engineering_started:    'design',
  engineering_completed:  'design',
  sld_generated:          'design',
  planset_generated:      'design',
  // Proposal & Approval
  final_proposal_generated: 'proposal',
  proposal_sent:          'proposal',
  proposal_viewed:        'proposal',
  proposal_approved:      'proposal',
  // Installation
  permit_submitted:       'installation',
  permit_approved:        'installation',
  install_scheduled:      'installation',
  install_started:        'installation',
  install_completed:      'installation',
  inspection_passed:      'installation',
  pto_submitted:          'installation',
  pto_approved:           'installation',
  // Completed
  system_live:            'completed',
  monitoring_active:      'completed',
};

// ── DB row type ──────────────────────────────────────────────────────────────

interface MicroStageRow {
  id: string;
  project_id: string;
  micro_stage: string;
  created_at: string;
  created_by: string | null;
  metadata: Record<string, unknown> | null;
}

// ── resolveHomeownerStage ────────────────────────────────────────────────────

/**
 * resolveHomeownerStage — finds the latest micro_stage for a project
 * and returns the corresponding homeowner_stage.
 *
 * Returns null if no micro stages have been recorded yet.
 */
export async function resolveHomeownerStage(
  projectId: string,
): Promise<HomeownerStage | null> {
  const sql = await getDbReady();

  const rows = await sql`
    SELECT micro_stage
    FROM project_micro_stages
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
    LIMIT 1
  ` as MicroStageRow[];

  if (rows.length === 0) return null;

  const latest = rows[0].micro_stage as MicroStage;
  return MICRO_TO_HOMEOWNER[latest] ?? null;
}

// ── writeMicroStage ──────────────────────────────────────────────────────────

/**
 * writeMicroStage — inserts a micro_stage event and auto-syncs homeowner_stage.
 *
 * Steps:
 *   1. Insert into project_micro_stages
 *   2. Resolve new homeowner_stage from latest micro_stage
 *   3. If homeowner_stage advances forward → update projects + log history
 *
 * Forward-only: never moves homeowner_stage backward.
 * Never throws — all errors logged (retry once on failure).
 *
 * @param projectId  UUID of the project
 * @param stage      MicroStage value
 * @param createdBy  User/admin UUID (nullable)
 * @param metadata   Optional JSON payload for context
 */
export async function writeMicroStage(
  projectId: string,
  stage: MicroStage,
  createdBy: string | null = null,
  metadata: Record<string, unknown> | null = null,
): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await _doWriteMicroStage(projectId, stage, createdBy, metadata);
      return;
    } catch (err) {
      lastError = err;
      if (attempt === 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  const msg   = lastError instanceof Error ? lastError.message : String(lastError);
  const stack = lastError instanceof Error ? (lastError.stack ?? '') : '';
  console.error(
    `[writeMicroStage] ERROR: Failed after 2 attempts ` +
    `project=${projectId} stage=${stage}\n` +
    `Message: ${msg}\nStack: ${stack}`,
  );
}

async function _doWriteMicroStage(
  projectId: string,
  stage: MicroStage,
  createdBy: string | null,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  const sql = await getDbReady();

  // 1. Insert micro stage
  const metaJson = metadata ? JSON.stringify(metadata) : null;
  await sql`
    INSERT INTO project_micro_stages
      (project_id, micro_stage, created_by, metadata)
    VALUES
      (${projectId}, ${stage}, ${createdBy}, ${metaJson}::jsonb)
  `;

  // 2. Resolve target homeowner_stage
  const targetHomeownerStage = MICRO_TO_HOMEOWNER[stage];
  if (!targetHomeownerStage) return;

  // 3. Read current homeowner_stage
  const rows = await sql`
    SELECT homeowner_stage FROM projects WHERE id = ${projectId} LIMIT 1
  `;
  if (rows.length === 0) return;

  const currentStage = rows[0].homeowner_stage as HomeownerStage | null;
  const currentIdx   = currentStage ? HOMEOWNER_STAGES.indexOf(currentStage) : -1;
  const targetIdx    = HOMEOWNER_STAGES.indexOf(targetHomeownerStage);

  // 4. Forward-only update
  if (targetIdx <= currentIdx) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(
        `[writeMicroStage] Skip homeowner sync: project=${projectId} ` +
        `current=${currentStage} >= target=${targetHomeownerStage}`,
      );
    }
    return;
  }

  await sql`
    UPDATE projects
    SET homeowner_stage = ${targetHomeownerStage},
        updated_at      = NOW()
    WHERE id = ${projectId}
  `;

  await sql`
    INSERT INTO project_homeowner_stage_history
      (project_id, stage, changed_by, note)
    VALUES
      (${projectId}, ${targetHomeownerStage}, ${createdBy},
       ${'Auto-advanced via micro_stage: ' + stage})
  `;

  console.log(
    `[writeMicroStage] project=${projectId} micro=${stage} ` +
    `homeowner: ${currentStage ?? 'null'} → ${targetHomeownerStage}`,
  );
}