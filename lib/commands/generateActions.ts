/**
 * lib/commands/generateActions.ts
 *
 * Pure logic to auto-generate CommandActions from project state.
 * No DB calls — takes project data in, returns actions out.
 * The API layer handles persistence and duplicate prevention.
 */

import type { CommandAction, CommandActionType, CommandPriority } from './types';
// 🚨 THE CLOCK, AND WHAT THE NUMBER MEANS. Every rule below used to read
// `now - updated_at` and then describe the result as a stage EVENT — "Proposal
// sent 7d ago" for a row that had merely not been touched in 7 days. 20+
// unrelated writers bump `updated_at`, so rule 4 (permit_submitted + >= 5 days)
// never fired at all for an actively-edited project: the AHJ chase-up command
// was never created for the projects most likely to be worked on.
import { resolveStageAge, describeStageAge, type StageAge } from '@/lib/operations/stageClock';

interface ProjectForGeneration {
  id: string;
  name: string;
  client_name?: string;
  project_status: string;
  status?: string;           // legacy 5-stage status
  updated_at?: string;
  /**
   * When the project last CHANGED STAGE. Either the future
   * `projects.stage_changed_at` column or a value the caller derived from the
   * most recent stage-change record (see `LAST_STAGE_CHANGE_SQL`).
   *
   * 🚨 When absent, the rules below fall back to `updated_at` AND STOP CLAIMING
   * THE NUMBER IS ABOUT THE STAGE. They do not go silent — a follow-up that
   * never appears is the worse failure — they say "no activity for 7d" instead
   * of "proposal sent 7d ago".
   */
  stage_changed_at?: string;
  last_stage_change_at?: string;
  install_date?: string;
  crew_assigned?: string;
  contract_signed_at?: string;
  contract_value?: number;
}

interface GeneratedAction {
  project_id: string;
  title: string;
  description: string;
  type: CommandActionType;
  priority: CommandPriority;
  due_date?: string;
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Generate actions for a single project based on its current state.
 * Returns an array of actions that SHOULD exist. The API layer
 * compares against existing actions to prevent duplicates.
 */
export function generateActionsForProject(project: ProjectForGeneration): GeneratedAction[] {
  const actions: GeneratedAction[] = [];
  const stage = project.project_status || project.status || 'lead';
  // 🚨 `age.basis` says whether this number is time-in-stage or merely
  // time-since-anything-touched-the-row, and `describe()` is the only thing that
  // turns it into words. A sentence naming a stage event may only be produced
  // when the clock actually measured that stage.
  const age: StageAge = resolveStageAge(project);
  const daysStale = age.days;
  const describe = (event: string) => describeStageAge(age, event);
  const name = project.client_name || project.name;

  // ─── Rule 1: Proposal sent + no update in 3 days → follow_up ───
  if (stage === 'proposal_sent' && daysStale >= 3) {
    actions.push({
      project_id: project.id,
      title: `Follow up with ${name}`,
      description: `${describe('Proposal sent')}${age.measuresStage ? ' with no response' : ''}. Follow up to close the deal.`,
      type: 'follow_up',
      priority: daysStale >= 7 ? 'critical' : daysStale >= 5 ? 'high' : 'medium',
      due_date: addDays(0), // due today
    });
  }

  // ─── Rule 2: Approved / Contract signed + no install scheduled → schedule_install ───
  if ((stage === 'contract_signed' || stage === 'permit_approved') && !project.install_date) {
    actions.push({
      project_id: project.id,
      title: `Schedule install for ${name}`,
      description: `Contract signed but no installation date set. Schedule to keep the project moving.`,
      type: 'schedule_install',
      priority: 'high',
      due_date: addDays(1),
    });
  }

  // ─── Rule 3: Contract signed → engineering_review ───
  if (stage === 'contract_signed' && daysStale >= 1) {
    actions.push({
      project_id: project.id,
      title: `Start engineering for ${name}`,
      description: `Contract signed. Begin engineering review and plan set generation.`,
      type: 'engineering_review',
      priority: 'high',
      due_date: addDays(0),
    });
  }

  // ─── Rule 4: Permit submitted + no update in 5 days → permit_followup ───
  if (stage === 'permit_submitted' && daysStale >= 5) {
    actions.push({
      project_id: project.id,
      title: `Follow up on permit for ${name}`,
      description: `${describe('Permit submitted')}. Check with AHJ for status update.`,
      type: 'permit_followup',
      priority: daysStale >= 10 ? 'critical' : 'high',
      due_date: addDays(0),
    });
  }

  // ─── Rule 5: Install scheduled + date passed → inspection ───
  if (stage === 'installation' || (stage === 'install_scheduled' && project.install_date)) {
    const installDate = project.install_date ? new Date(project.install_date) : null;
    if (installDate && installDate.getTime() < Date.now()) {
      actions.push({
        project_id: project.id,
        title: `Schedule inspection for ${name}`,
        description: `Installation date has passed. Schedule final inspection.`,
        type: 'inspection',
        priority: 'high',
        due_date: addDays(1),
      });
    }
  }

  // ─── Rule 6: Design complete + stale → follow_up to send proposal ───
  if (stage === 'design_complete' && daysStale >= 3) {
    actions.push({
      project_id: project.id,
      title: `Send proposal to ${name}`,
      description: `${describe('Design completed')} and no proposal sent. Prepare and send proposal.`,
      type: 'follow_up',
      priority: daysStale >= 7 ? 'high' : 'medium',
      due_date: addDays(0),
    });
  }

  // ─── Rule 7: Site assessment stale → follow_up ───
  if (stage === 'site_assessment' && daysStale >= 5) {
    actions.push({
      project_id: project.id,
      title: `Complete site assessment for ${name}`,
      description: `${describe('Site assessment started')} and still open. Schedule or complete the assessment.`,
      type: 'follow_up',
      priority: 'medium',
      due_date: addDays(0),
    });
  }

  // ─── Legacy 5-stage fallback ───
  // Many projects still use the legacy 5-stage status (lead/design/proposal/approved/installed)
  // without a separate project_status. These won't match the 13-stage rules above,
  // so we handle them explicitly here.
  const legacyStages = ['lead', 'design', 'proposal', 'approved', 'installed'];
  if (legacyStages.includes(stage) && actions.length === 0) {
    if (stage === 'proposal' && daysStale >= 3) {
      actions.push({
        project_id: project.id,
        title: `Follow up with ${name}`,
        description: `${describe('Reached proposal stage')}. Follow up to close.`,
        type: 'follow_up',
        priority: daysStale >= 7 ? 'critical' : 'high',
        due_date: addDays(0),
      });
    }
    if (stage === 'proposal' && daysStale < 3) {
      // Still worth a gentle nudge if in proposal stage
      actions.push({
        project_id: project.id,
        title: `Follow up with ${name}`,
        description: `Proposal stage — follow up to move toward close.`,
        type: 'follow_up',
        priority: 'medium',
        due_date: addDays(3 - daysStale),
      });
    }
    if (stage === 'approved' && !project.install_date) {
      actions.push({
        project_id: project.id,
        title: `Schedule install for ${name}`,
        description: `Project approved but no install date. Schedule installation.`,
        type: 'schedule_install',
        priority: 'high',
        due_date: addDays(1),
      });
    }
    if (stage === 'approved' && project.install_date) {
      const installDate = project.install_date ? new Date(project.install_date) : null;
      if (installDate && installDate.getTime() < Date.now()) {
        actions.push({
          project_id: project.id,
          title: `Schedule inspection for ${name}`,
          description: `Installation date has passed. Schedule final inspection.`,
          type: 'inspection',
          priority: 'high',
          due_date: addDays(1),
        });
      }
    }
    if (stage === 'design' && daysStale >= 3) {
      actions.push({
        project_id: project.id,
        title: `Complete design for ${name}`,
        description: `${describe('Reached design stage')}. Finish system design and prepare proposal.`,
        type: 'follow_up',
        priority: daysStale >= 7 ? 'high' : 'medium',
        due_date: addDays(0),
      });
    }
    if (stage === 'lead' && daysStale >= 3) {
      actions.push({
        project_id: project.id,
        title: `Advance ${name} from lead`,
        description: `${describe('Created as a lead')}. Upload bill or start design to move forward.`,
        type: 'follow_up',
        priority: daysStale >= 7 ? 'high' : 'medium',
        due_date: addDays(0),
      });
    }
  }

  return actions;
}

/**
 * Generate actions for multiple projects.
 * Returns flat array of all generated actions.
 */
export function generateActionsForProjects(projects: ProjectForGeneration[]): GeneratedAction[] {
  return projects.flatMap(p => generateActionsForProject(p));
}