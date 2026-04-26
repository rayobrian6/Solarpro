/**
 * lib/commands/types.ts
 *
 * Shared types for the Command Center execution engine.
 * These types map 1:1 to the database tables created in Migration 017.
 */

// ═══════════════════════════════════════════════════════════
// COMMAND ACTIONS
// ═══════════════════════════════════════════════════════════

export type CommandActionType =
  | 'follow_up'
  | 'schedule_install'
  | 'engineering_review'
  | 'permit_followup'
  | 'inspection'
  | 'custom';

export type CommandPriority = 'low' | 'medium' | 'high' | 'critical';
export type CommandStatus = 'pending' | 'completed';

export interface CommandAction {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  description?: string | null;
  type: CommandActionType;
  priority: CommandPriority;
  status: CommandStatus;
  due_date?: string | null;
  created_at: string;
  completed_at?: string | null;
  auto_generated: boolean;
  /** Populated via JOIN */
  project_name?: string;
  client_name?: string;
  project_status?: string;
}

// ═══════════════════════════════════════════════════════════
// PROJECT SCHEDULE
// ═══════════════════════════════════════════════════════════

export type ScheduleType =
  | 'install'
  | 'site_visit'
  | 'inspection'
  | 'follow_up'
  | 'custom';

export interface ProjectScheduleItem {
  id: string;
  project_id: string;
  user_id: string;
  type: ScheduleType;
  date: string;
  crew_id?: string | null;
  notes?: string | null;
  created_at: string;
  /** Populated via JOIN */
  project_name?: string;
  client_name?: string;
  crew_name?: string;
  crew_color?: string;
}

// ═══════════════════════════════════════════════════════════
// CREWS
// ═══════════════════════════════════════════════════════════

export interface Crew {
  id: string;
  user_id: string;
  name: string;
  color?: string | null;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════════════════════

export type ActivityType =
  | 'stage_change'
  | 'follow_up'
  | 'schedule'
  | 'crew_assign'
  | 'action_complete'
  | 'note'
  | 'custom';

export interface ProjectActivity {
  id: string;
  project_id: string;
  user_id: string;
  type: ActivityType;
  title: string;
  details?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  /** Populated via JOIN */
  project_name?: string;
}

// ═══════════════════════════════════════════════════════════
// FOLLOW-UP MODAL
// ═══════════════════════════════════════════════════════════

export type FollowUpOutcome =
  | 'no_answer'
  | 'interested'
  | 'not_interested'
  | 'scheduled_next_step';

export interface FollowUpPayload {
  command_id: string;
  project_id: string;
  notes: string;
  outcome: FollowUpOutcome;
  next_follow_up_date?: string | null;
}

// ═══════════════════════════════════════════════════════════
// SCHEDULE INSTALL MODAL
// ═══════════════════════════════════════════════════════════

export interface ScheduleInstallPayload {
  command_id?: string;
  project_id: string;
  install_date: string;
  crew_id?: string;
  duration_days?: number;
  notes?: string;
}

// ═══════════════════════════════════════════════════════════
// ENGINEERING REVIEW MODAL
// ═══════════════════════════════════════════════════════════

export interface EngineeringReviewPayload {
  command_id?: string;
  project_id: string;
  notes?: string;
}