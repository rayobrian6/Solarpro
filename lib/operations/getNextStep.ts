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
// 🚨 "5d stalled" was computed from `projects.updated_at`, which 20+ unrelated
// writers bump — so it was really "nothing has touched this row for 5d", printed
// on the card as an accusation about the deal. See lib/operations/stageClock.ts.
import {
  resolveStageAge,
  classifyStageAge,
  type StageAge,
  type StageClockSource,
} from './stageClock';

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
  /**
   * The clock the label and urgency came from, and what it measures.
   * 🚨 `age.measuresStage === false` means the number is "time since anything
   * touched this record", NOT time in stage. A caller that renders its own copy
   * of the number must read this before calling it a stall.
   */
  age: StageAge;
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
  /**
   * The clock. Historically this was `projects.updated_at` alone and still may
   * be — pass the whole row instead (`{ stage_changed_at, last_stage_change_at,
   * updated_at }`) and the number becomes a real stage clock with an honest
   * label. A bare timestamp is still accepted and is treated as a LAST-TOUCH
   * value, because that is what every existing caller passes.
   */
  updatedAt?: string | Date | StageClockSource | null,
  hasInstallDate?: boolean,
  hasCrew?: boolean,
): NextStep {
  const safeStage = (stage || 'lead') as PipelineStage;
  const cfg = STAGE_CONFIG[safeStage] || { action: 'Review project', button: 'Review' };

  const age = resolveStageAge(toClockSource(updatedAt));

  if (safeStage === 'complete') {
    return { label: 'Project complete ✓', buttonLabel: 'Done', urgency: 'green', urgent: false, age };
  }

  const daysInStage = age.days;
  // 🚨 `stalled` is a claim about the STAGE and needs a stage clock. On the
  // `updated_at` fallback `classifyStageAge` returns `quiet` instead — the
  // weaker claim the data actually supports — so the card can say "no activity"
  // without asserting the deal is stuck.
  const { stalled, quiet } = classifyStageAge(age, STALL_THRESHOLD_DAYS);
  const isStalled = stalled && safeStage !== 'lead';
  const isQuiet = quiet && safeStage !== 'lead';
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

  // Urgency determination.
  // A red card is the strongest signal on the board and it must not be raised by
  // a number that does not mean what the card says. `quiet` keeps the amber
  // "worth a look" state; only a measured stage stall goes red.
  let urgency: UrgencyLevel = 'blue';
  if (isStalled) {
    urgency = 'red';
  } else if (isPending || isQuiet) {
    urgency = 'yellow';
  }

  // Build label. 🚨 THE QUALIFIER IS PART OF THE FIX. "5d stalled" on an
  // `updated_at` number was a false statement about the deal; "5d no activity"
  // is a true statement about the record.
  const label = isStalled
    ? `${daysInStage}d in stage — ${action}`
    : isQuiet
      ? `${daysInStage}d no activity — ${action}`
      : action;

  return {
    label,
    buttonLabel: isStalled || isQuiet ? 'Resolve →' : button,
    urgency,
    urgent: isStalled,
    age,
  };
}

/** Accept a bare timestamp (every existing caller) or a whole row. */
function toClockSource(
  v?: string | Date | StageClockSource | null,
): StageClockSource | null {
  if (!v) return null;
  if (typeof v === 'string' || v instanceof Date) return { updated_at: v };
  return v;
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
  /** What `daysInStage` measures. See NextStep.age. */
  age: StageAge;
}

export function getActionItems(
  projects: Array<{
    id: string;
    name: string;
    client_name?: string;
    project_status: string;
    updated_at?: string;
    /** Preferred clock — see ProjectForGeneration / stageClock. */
    stage_changed_at?: string;
    last_stage_change_at?: string;
    install_date?: string;
    crew_assigned?: string;
  }>,
  limit = 5,
): ActionItem[] {
  const items: ActionItem[] = [];

  for (const p of projects) {
    if (p.project_status === 'complete') continue;

    // 🚨 THE WHOLE ROW, not just `updated_at`. Passing the row is what lets the
    // stage clock prefer a recorded stage change over the last-touch column.
    const step = getNextStep(
      p.project_status,
      p,
      !!p.install_date,
      !!p.crew_assigned,
    );

    items.push({
      projectId: p.id,
      projectName: p.name,
      clientName: p.client_name,
      action: step.label,
      buttonLabel: step.buttonLabel,
      urgency: step.urgency,
      // 🚨 ONE number, from the same resolution the label used. This used to be a
      // SECOND, independent `getDaysInStage(p.updated_at)` call, so a card could
      // in principle show a day count the label disagreed with.
      daysInStage: step.age.days,
      stage: p.project_status,
      age: step.age,
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