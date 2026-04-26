/**
 * lib/operations/getNextStep.ts
 *
 * Derives the "next action" for a project based on its current pipeline stage.
 * Pure logic — no DB, no API calls.
 *
 * v47.350: Next Step Guidance Engine
 * v47.352: Enhanced with urgency levels, smart labels, button text
 */

import type { PipelineStage } from './pipeline';

export type UrgencyLevel = 'red' | 'yellow' | 'blue' | 'green';

export interface NextStep {
  /** Human-readable action text */
  label: string;
  /** Short button text for the primary action */
  buttonLabel: string;
  /** Urgency level for color coding */
  urgency: UrgencyLevel;
  /** Whether this is urgent (legacy compat) */
  urgent: boolean;
}

/** Stage → next action mapping with smart button labels */
const STAGE_CONFIG: Record<PipelineStage, { action: string; button: string }> = {
  lead:              { action: 'Qualify lead & schedule site assessment',  button: 'Qualify Lead' },
  site_assessment:   { action: 'Complete site assessment',                button: 'Complete Assessment' },
  design_complete:   { action: 'Send proposal to homeowner',             button: 'Send Proposal' },
  proposal_sent:     { action: 'Follow up on proposal',                  button: 'Follow Up' },
  contract_signed:   { action: 'Begin engineering review',               button: 'Start Engineering' },
  engineering:       { action: 'Generate plan set & permit package',     button: 'Finish Plans' },
  permit_submitted:  { action: 'Follow up with AHJ on permit',          button: 'Check Permit' },
  permit_approved:   { action: 'Schedule installation date',             button: 'Schedule Install' },
  install_scheduled: { action: 'Confirm crew & materials',              button: 'Confirm Ready' },
  installation:      { action: 'Complete installation & prep inspection', button: 'Complete Install' },
  inspection:        { action: 'Pass inspection',                        button: 'Pass Inspection' },
  pto:               { action: 'Submit interconnection / wait for PTO',  button: 'Finalize PTO' },
  complete:          { action: 'Project complete',                       button: 'Done' },
};

const STALL_THRESHOLD_DAYS = 5;
const URGENT_THRESHOLD_DAYS = 2;

/**
 * Get the next recommended action for a project.
 *
 * @param stage        Current pipeline stage
 * @param updatedAt    Last update timestamp (ISO string or Date)
 * @param hasInstallDate  Whether install_date is set
 * @param hasCrew      Whether crew_assigned is set
 * @returns            NextStep with label, buttonLabel, urgency, and urgency flag
 */
export function getNextStep(
  stage: string | undefined | null,
  updatedAt?: string | Date | null,
  hasInstallDate?: boolean,
  hasCrew?: boolean,
): NextStep {
  const safeStage = (stage || 'lead') as PipelineStage;
  const cfg = STAGE_CONFIG[safeStage] || { action: 'Review project', button: 'Review' };

  if (safeStage === 'complete') {
    return { label: 'Project complete ✓', buttonLabel: 'Done', urgency: 'green', urgent: false };
  }

  const daysInStage = getDaysInStage(updatedAt);
  const isStalled = daysInStage >= STALL_THRESHOLD_DAYS && safeStage !== 'lead';
  const isPending = daysInStage >= URGENT_THRESHOLD_DAYS && safeStage !== 'lead';

  // Context-aware overrides
  let action = cfg.action;
  let button = cfg.button;

  if (safeStage === 'install_scheduled' || safeStage === 'permit_approved') {
    if (!hasInstallDate) {
      action = 'Set install date';
      button = 'Schedule Install';
    } else if (!hasCrew) {
      action = 'Assign crew to project';
      button = 'Assign Crew';
    }
  }

  if (safeStage === 'installation' && !hasCrew) {
    action = 'Assign crew — installation pending';
    button = 'Assign Crew';
  }

  // Urgency determination
  let urgency: UrgencyLevel = 'blue';
  if (isStalled) {
    urgency = 'red';
  } else if (isPending) {
    urgency = 'yellow';
  }

  // Build label
  const label = isStalled
    ? `${daysInStage}d stalled — ${action}`
    : action;

  return {
    label,
    buttonLabel: isStalled ? 'Resolve →' : button,
    urgency,
    urgent: isStalled,
  };
}

/** Calculate days since a date */
function getDaysInStage(updatedAt?: string | Date | null): number {
  if (!updatedAt) return 0;
  try {
    const then = new Date(updatedAt).getTime();
    return Math.max(0, Math.floor((Date.now() - then) / 86400000));
  } catch {
    return 0;
  }
}

/**
 * Get a sorted list of actionable items across all projects.
 * Used for the ACTION REQUIRED strip.
 */
export interface ActionItem {
  projectId: string;
  projectName: string;
  clientName?: string;
  action: string;
  buttonLabel: string;
  urgency: UrgencyLevel;
  daysInStage: number;
  stage: string;
}

export function getActionItems(
  projects: Array<{
    id: string;
    name: string;
    client_name?: string;
    project_status: string;
    updated_at?: string;
    install_date?: string;
    crew_assigned?: string;
  }>,
  limit = 5,
): ActionItem[] {
  const items: ActionItem[] = [];

  for (const p of projects) {
    if (p.project_status === 'complete') continue;

    const step = getNextStep(
      p.project_status,
      p.updated_at,
      !!p.install_date,
      !!p.crew_assigned,
    );

    const days = getDaysInStage(p.updated_at);

    items.push({
      projectId: p.id,
      projectName: p.name,
      clientName: p.client_name,
      action: step.label,
      buttonLabel: step.buttonLabel,
      urgency: step.urgency,
      daysInStage: days,
      stage: p.project_status,
    });
  }

  // Sort: red first, then yellow, then blue; within same urgency, by days desc
  const urgencyOrder: Record<UrgencyLevel, number> = { red: 0, yellow: 1, blue: 2, green: 3 };

  items.sort((a, b) => {
    const ua = urgencyOrder[a.urgency];
    const ub = urgencyOrder[b.urgency];
    if (ua !== ub) return ua - ub;
    return b.daysInStage - a.daysInStage;
  });

  return items.slice(0, limit);
}