/**
 * lib/operations/pipeline.ts
 * 
 * Operations Pipeline — canonical stages, task map, and types.
 * v47.350: Initial implementation
 */

// ─── Pipeline Stages (ordered) ──────────────────────────────────────────────
export const PROJECT_PIPELINE = [
  'lead',
  'site_assessment',
  'design_complete',
  'proposal_sent',
  'contract_signed',
  'engineering',
  'permit_submitted',
  'permit_approved',
  'install_scheduled',
  'installation',
  'inspection',
  'pto',
  'complete',
] as const;

export type PipelineStage = typeof PROJECT_PIPELINE[number];

// ─── Stage Display Labels ───────────────────────────────────────────────────
export const STAGE_LABELS: Record<PipelineStage, string> = {
  lead:              'Lead',
  site_assessment:   'Site Assessment',
  design_complete:   'Design Complete',
  proposal_sent:     'Proposal Sent',
  contract_signed:   'Contract Signed',
  engineering:       'Engineering',
  permit_submitted:  'Permit Submitted',
  permit_approved:   'Permit Approved',
  install_scheduled: 'Install Scheduled',
  installation:      'Installation',
  inspection:        'Inspection',
  pto:               'PTO',
  complete:          'Complete',
};

// ─── Stage Colors (for UI badges) ───────────────────────────────────────────
export const STAGE_COLORS: Record<PipelineStage, string> = {
  lead:              'bg-slate-500',
  site_assessment:   'bg-slate-500',
  design_complete:   'bg-blue-500',
  proposal_sent:     'bg-indigo-500',
  contract_signed:   'bg-purple-500',
  engineering:       'bg-blue-600',
  permit_submitted:  'bg-amber-500',
  permit_approved:   'bg-amber-600',
  install_scheduled: 'bg-orange-500',
  installation:      'bg-orange-600',
  inspection:        'bg-teal-500',
  pto:               'bg-emerald-500',
  complete:          'bg-green-600',
};

// ─── Kanban Board Columns (subset of pipeline for Operations view) ──────────
export const KANBAN_STAGES: PipelineStage[] = [
  'lead',
  'site_assessment',
  'design_complete',
  'proposal_sent',
  'contract_signed',
  'engineering',
  'permit_submitted',
  'permit_approved',
  'install_scheduled',
  'installation',
  'inspection',
  'pto',
  'complete',
];

// Phase groupings for visual separators on the kanban board
export interface StagePhase {
  label: string;
  stages: PipelineStage[];
  color: string;
}

export const STAGE_PHASES: StagePhase[] = [
  {
    label: 'Sales',
    stages: ['lead', 'site_assessment', 'design_complete', 'proposal_sent'],
    color: 'var(--text-muted)',
  },
  {
    label: 'Pre-Install',
    stages: ['contract_signed', 'engineering', 'permit_submitted', 'permit_approved'],
    color: '#3b82f6',
  },
  {
    label: 'Installation',
    stages: ['install_scheduled', 'installation', 'inspection', 'pto'],
    color: '#f97316',
  },
  {
    label: 'Done',
    stages: ['complete'],
    color: '#22c55e',
  },
];

// ─── Task Map — auto-generated tasks per stage ──────────────────────────────
export const TASK_MAP: Partial<Record<PipelineStage, string[]>> = {
  contract_signed: [
    'Verify contract documents',
    'Collect initial payment',
    'Confirm system design',
  ],

  engineering: [
    'Generate plan set',
    'Validate system design',
    'Prepare permit package',
  ],

  permit_submitted: [
    'Submit permit to AHJ',
    'Upload planset',
    'Track permit status',
  ],

  install_scheduled: [
    'Assign crew',
    'Confirm material delivery',
    'Schedule install date',
  ],

  installation: [
    'Site preparation',
    'Install racking',
    'Install panels',
    'Electrical connections',
    'System commissioning',
  ],

  inspection: [
    'Schedule inspection',
    'Prepare documentation',
    'Pass inspection',
  ],

  pto: [
    'Submit interconnection',
    'Coordinate with utility',
    'Confirm PTO approval',
  ],
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'completed';
  stage: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ProjectMilestone {
  id: string;
  project_id: string;
  name: string;
  due_date: string | null;
  status: 'pending' | 'completed';
  created_at: string;
}

export interface OperationsData {
  project_status: PipelineStage;
  contract_signed_at: string | null;
  install_date: string | null;
  estimated_completion: string | null;
  actual_completion: string | null;
  crew_assigned: string | null;
  labor_hours: number;
  labor_cost: number;
  material_cost: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Get the index of a stage in the pipeline (for ordering / comparison) */
export function stageIndex(stage: string): number {
  const idx = PROJECT_PIPELINE.indexOf(stage as PipelineStage);
  return idx >= 0 ? idx : -1;
}

/** Get the next stage after the current one, or null if complete */
export function nextStage(current: string): PipelineStage | null {
  const idx = stageIndex(current);
  if (idx < 0 || idx >= PROJECT_PIPELINE.length - 1) return null;
  return PROJECT_PIPELINE[idx + 1];
}

/** Check if a string is a valid pipeline stage */
export function isValidStage(stage: string): stage is PipelineStage {
  return PROJECT_PIPELINE.includes(stage as PipelineStage);
}