/**
 * lib/deals/transitions.ts
 *
 * DEAL TRANSITION MAP — the single source of truth for every valid
 * stage-change decision in SolarPro.
 *
 * RULES:
 *  1. No UI component may mutate project stage directly.
 *  2. Every change must come from a user-selected DealDecision.
 *  3. Every transition is logged to project_activity.
 *  4. DB status column only supports: lead | design | proposal | approved | installed
 *     We store the richer ops stage in project_status (13 stages).
 *     The transition map targets project_status stages.
 */

import type { PipelineStage } from '@/lib/operations/pipeline';

// ─── Decision Action Types ────────────────────────────────────────────────────

export type DealDecisionAction =
  // Lead stage
  | 'site_assessment_scheduled'
  | 'not_qualified'
  | 'needs_more_info'
  // Design stage
  | 'design_complete'
  | 'design_needs_revision'
  | 'client_unresponsive'
  // Proposal stage
  | 'proposal_accepted'
  | 'proposal_rejected'
  | 'needs_follow_up'
  | 'no_response'
  | 'contract_signed'
  // Approved / Contract Signed stage
  | 'engineering_started'
  | 'install_delayed'
  | 'schedule_install'
  // Engineering stage
  | 'permit_ready'
  | 'engineering_revision'
  // Permit stages
  | 'permit_submitted'
  | 'permit_approved'
  | 'permit_rejected'
  // Install stages
  | 'installation_started'
  | 'installation_complete'
  | 'inspection_passed'
  | 'inspection_failed'
  | 'pto_received'
  // Universal
  | 'mark_complete'
  | 'reopen';

// ─── What a transition produces ───────────────────────────────────────────────

export interface TransitionResult {
  /** New ops pipeline stage */
  newStage: PipelineStage;
  /** Human-readable title for activity log */
  activityTitle: string;
  /** Activity type (matches project_activity.type) */
  activityType: 'stage_change' | 'follow_up' | 'schedule' | 'note';
  /** Whether this closes the deal (no further actions) */
  terminal?: boolean;
  /** Whether this stalls the deal (urgency flag) */
  stalls?: boolean;
  /** Optional next recommended action label */
  nextAction?: string;
}

// ─── Decision Option shown in the UI ─────────────────────────────────────────

export interface DecisionOption {
  action: DealDecisionAction;
  label: string;
  description: string;
  /** Tailwind/hex color for this option's button */
  color: string;
  /** Icon name (lucide) */
  icon: string;
  /** If true, requires a notes field before proceeding */
  requiresNotes?: boolean;
  /** If true, requires a date input */
  requiresDate?: boolean;
  /** danger = red, warning = amber, success = green, info = blue, neutral = slate */
  variant: 'danger' | 'warning' | 'success' | 'info' | 'neutral';
}

// ─── Stage → available decisions ─────────────────────────────────────────────

export type DecisionStage =
  | 'lead'
  | 'site_assessment'
  | 'design_complete'
  | 'proposal_sent'
  | 'contract_signed'
  | 'engineering'
  | 'permit_submitted'
  | 'permit_approved'
  | 'install_scheduled'
  | 'installation'
  | 'inspection'
  | 'pto'
  | 'complete';

export const STAGE_DECISIONS: Record<DecisionStage, DecisionOption[]> = {
  lead: [
    {
      action: 'site_assessment_scheduled',
      label: 'Schedule Site Assessment',
      description: 'Site visit booked — move to assessment phase',
      color: '#3B82F6',
      icon: 'MapPin',
      requiresDate: true,
      variant: 'info',
    },
    {
      action: 'design_complete',
      label: 'Design Ready',
      description: 'System design is complete, skip to design stage',
      color: '#22C55E',
      icon: 'PenTool',
      variant: 'success',
    },
    {
      action: 'needs_more_info',
      label: 'Needs More Info',
      description: 'Waiting on client data — stay in lead stage',
      color: '#F59E0B',
      icon: 'Clock',
      requiresNotes: true,
      variant: 'warning',
    },
    {
      action: 'not_qualified',
      label: 'Not Qualified',
      description: 'Client does not qualify — mark as lost',
      color: '#EF4444',
      icon: 'XCircle',
      requiresNotes: true,
      variant: 'danger',
    },
  ],

  site_assessment: [
    {
      action: 'design_complete',
      label: 'Design Complete',
      description: 'Site assessed — system designed and ready',
      color: '#22C55E',
      icon: 'CheckCircle',
      variant: 'success',
    },
    {
      action: 'design_needs_revision',
      label: 'Revision Needed',
      description: 'Design needs adjustment before proceeding',
      color: '#F59E0B',
      icon: 'RefreshCw',
      requiresNotes: true,
      variant: 'warning',
    },
    {
      action: 'client_unresponsive',
      label: 'Client Unresponsive',
      description: 'No response from client — flag for follow-up',
      color: '#94A3B8',
      icon: 'PhoneOff',
      variant: 'neutral',
    },
  ],

  design_complete: [
    {
      action: 'contract_signed',
      label: 'Proposal Sent & Signed',
      description: 'Client signed — move directly to contract',
      color: '#22C55E',
      icon: 'FileCheck',
      variant: 'success',
    },
    {
      action: 'needs_follow_up',
      label: 'Send Proposal / Follow Up',
      description: 'Proposal sent — waiting on client decision',
      color: '#F59E0B',
      icon: 'Send',
      variant: 'warning',
    },
    {
      action: 'client_unresponsive',
      label: 'Client Unresponsive',
      description: 'No response — flag for follow-up',
      color: '#94A3B8',
      icon: 'PhoneOff',
      variant: 'neutral',
    },
  ],

  proposal_sent: [
    {
      action: 'contract_signed',
      label: 'Contract Signed ✓',
      description: 'Client approved — contract executed',
      color: '#22C55E',
      icon: 'FileCheck',
      variant: 'success',
    },
    {
      action: 'proposal_accepted',
      label: 'Proposal Accepted',
      description: 'Client said yes — awaiting contract',
      color: '#3B82F6',
      icon: 'ThumbsUp',
      variant: 'info',
    },
    {
      action: 'needs_follow_up',
      label: 'Needs Follow-Up',
      description: 'Call/email client to push decision',
      color: '#F59E0B',
      icon: 'Phone',
      requiresDate: true,
      variant: 'warning',
    },
    {
      action: 'no_response',
      label: 'No Response',
      description: 'Client not responding — stay in proposal',
      color: '#94A3B8',
      icon: 'PhoneOff',
      variant: 'neutral',
    },
    {
      action: 'proposal_rejected',
      label: 'Proposal Rejected',
      description: 'Client declined — mark as lost',
      color: '#EF4444',
      icon: 'XCircle',
      requiresNotes: true,
      variant: 'danger',
    },
  ],

  contract_signed: [
    {
      action: 'engineering_started',
      label: 'Start Engineering',
      description: 'Begin plan set and permit package',
      color: '#6366F1',
      icon: 'Wrench',
      variant: 'info',
    },
    {
      action: 'schedule_install',
      label: 'Schedule Install',
      description: 'Book the installation date',
      color: '#3B82F6',
      icon: 'Calendar',
      requiresDate: true,
      variant: 'info',
    },
    {
      action: 'install_delayed',
      label: 'Install Delayed',
      description: 'Project delayed — log reason',
      color: '#F59E0B',
      icon: 'AlertTriangle',
      requiresNotes: true,
      variant: 'warning',
    },
  ],

  engineering: [
    {
      action: 'permit_ready',
      label: 'Ready to Submit Permit',
      description: 'Plan set complete — submit to AHJ',
      color: '#22C55E',
      icon: 'FileText',
      variant: 'success',
    },
    {
      action: 'engineering_revision',
      label: 'Revision Required',
      description: 'Engineering needs changes before permit',
      color: '#F59E0B',
      icon: 'RefreshCw',
      requiresNotes: true,
      variant: 'warning',
    },
  ],

  permit_submitted: [
    {
      action: 'permit_approved',
      label: 'Permit Approved ✓',
      description: 'AHJ approved — move to install scheduling',
      color: '#22C55E',
      icon: 'Shield',
      variant: 'success',
    },
    {
      action: 'permit_rejected',
      label: 'Permit Rejected',
      description: 'AHJ requested changes — log reason',
      color: '#EF4444',
      icon: 'AlertTriangle',
      requiresNotes: true,
      variant: 'danger',
    },
  ],

  permit_approved: [
    {
      action: 'schedule_install',
      label: 'Schedule Installation',
      description: 'Permit in hand — book the install date',
      color: '#3B82F6',
      icon: 'Calendar',
      requiresDate: true,
      variant: 'info',
    },
  ],

  install_scheduled: [
    {
      action: 'installation_started',
      label: 'Installation Started',
      description: 'Crew on site — installation underway',
      color: '#F97316',
      icon: 'Truck',
      variant: 'warning',
    },
    {
      action: 'install_delayed',
      label: 'Installation Delayed',
      description: 'Log reason for delay',
      color: '#F59E0B',
      icon: 'AlertTriangle',
      requiresNotes: true,
      variant: 'warning',
    },
  ],

  installation: [
    {
      action: 'installation_complete',
      label: 'Installation Complete',
      description: 'System installed — ready for inspection',
      color: '#22C55E',
      icon: 'CheckCircle',
      variant: 'success',
    },
  ],

  inspection: [
    {
      action: 'inspection_passed',
      label: 'Inspection Passed ✓',
      description: 'System approved — submit for PTO',
      color: '#22C55E',
      icon: 'CheckCircle',
      variant: 'success',
    },
    {
      action: 'inspection_failed',
      label: 'Inspection Failed',
      description: 'Log issues — rebook inspection',
      color: '#EF4444',
      icon: 'AlertTriangle',
      requiresNotes: true,
      variant: 'danger',
    },
  ],

  pto: [
    {
      action: 'pto_received',
      label: 'PTO Received ✓',
      description: 'Utility approved — system live!',
      color: '#22C55E',
      icon: 'Zap',
      variant: 'success',
    },
  ],

  complete: [
    {
      action: 'reopen',
      label: 'Reopen Project',
      description: 'Move back to active pipeline',
      color: '#64748B',
      icon: 'RotateCcw',
      requiresNotes: true,
      variant: 'neutral',
    },
  ],
};

// ─── Transition Map: action → result ─────────────────────────────────────────

export const DEAL_TRANSITIONS: Record<DealDecisionAction, TransitionResult> = {
  // Lead
  site_assessment_scheduled: {
    newStage: 'site_assessment',
    activityTitle: 'Site assessment scheduled',
    activityType: 'stage_change',
    nextAction: 'Conduct site assessment',
  },
  not_qualified: {
    newStage: 'lead',
    activityTitle: 'Lead marked not qualified',
    activityType: 'note',
    terminal: true,
    stalls: true,
  },
  needs_more_info: {
    newStage: 'lead',
    activityTitle: 'Waiting on client information',
    activityType: 'follow_up',
    stalls: true,
  },

  // Design
  design_complete: {
    newStage: 'design_complete',
    activityTitle: 'Design completed',
    activityType: 'stage_change',
    nextAction: 'Send proposal to client',
  },
  design_needs_revision: {
    newStage: 'site_assessment',
    activityTitle: 'Design revision required',
    activityType: 'note',
    stalls: true,
  },
  client_unresponsive: {
    newStage: 'lead',
    activityTitle: 'Client unresponsive — flagged for follow-up',
    activityType: 'follow_up',
    stalls: true,
    nextAction: 'Follow up with client',
  },

  // Proposal
  proposal_accepted: {
    newStage: 'proposal_sent',
    activityTitle: 'Proposal accepted — awaiting contract',
    activityType: 'stage_change',
    nextAction: 'Get contract signed',
  },
  proposal_rejected: {
    newStage: 'lead',
    activityTitle: 'Proposal rejected by client',
    activityType: 'note',
    terminal: true,
    stalls: true,
  },
  needs_follow_up: {
    newStage: 'proposal_sent',
    activityTitle: 'Follow-up scheduled',
    activityType: 'follow_up',
    nextAction: 'Call client',
  },
  no_response: {
    newStage: 'proposal_sent',
    activityTitle: 'No response from client',
    activityType: 'follow_up',
    stalls: true,
    nextAction: 'Retry follow-up',
  },
  contract_signed: {
    newStage: 'contract_signed',
    activityTitle: 'Contract signed — project approved',
    activityType: 'stage_change',
    nextAction: 'Start engineering',
  },

  // Contract / Approved
  engineering_started: {
    newStage: 'engineering',
    activityTitle: 'Engineering review started',
    activityType: 'stage_change',
    nextAction: 'Complete plan set',
  },
  schedule_install: {
    newStage: 'install_scheduled',
    activityTitle: 'Installation scheduled',
    activityType: 'schedule',
    nextAction: 'Confirm crew and materials',
  },
  install_delayed: {
    newStage: 'contract_signed',
    activityTitle: 'Installation delayed',
    activityType: 'note',
    stalls: true,
    nextAction: 'Reschedule installation',
  },

  // Engineering
  permit_ready: {
    newStage: 'permit_submitted',
    activityTitle: 'Permit package submitted to AHJ',
    activityType: 'stage_change',
    nextAction: 'Track permit status',
  },
  engineering_revision: {
    newStage: 'engineering',
    activityTitle: 'Engineering revision required',
    activityType: 'note',
    stalls: true,
  },

  // Permit
  permit_submitted: {
    newStage: 'permit_submitted',
    activityTitle: 'Permit submitted',
    activityType: 'stage_change',
    nextAction: 'Await AHJ decision',
  },
  permit_approved: {
    newStage: 'permit_approved',
    activityTitle: 'Permit approved by AHJ',
    activityType: 'stage_change',
    nextAction: 'Schedule installation',
  },
  permit_rejected: {
    newStage: 'engineering',
    activityTitle: 'Permit rejected — revisions required',
    activityType: 'note',
    stalls: true,
    nextAction: 'Address AHJ comments',
  },

  // Installation
  installation_started: {
    newStage: 'installation',
    activityTitle: 'Installation started',
    activityType: 'stage_change',
    nextAction: 'Complete installation',
  },
  installation_complete: {
    newStage: 'inspection',
    activityTitle: 'Installation complete — ready for inspection',
    activityType: 'stage_change',
    nextAction: 'Schedule inspection',
  },

  // Inspection
  inspection_passed: {
    newStage: 'pto',
    activityTitle: 'Inspection passed',
    activityType: 'stage_change',
    nextAction: 'Submit PTO to utility',
  },
  inspection_failed: {
    newStage: 'installation',
    activityTitle: 'Inspection failed — corrections needed',
    activityType: 'note',
    stalls: true,
    nextAction: 'Fix issues and reschedule',
  },

  // PTO
  pto_received: {
    newStage: 'complete',
    activityTitle: 'PTO received — system live!',
    activityType: 'stage_change',
    terminal: true,
    nextAction: 'Project complete',
  },

  // Universal
  mark_complete: {
    newStage: 'complete',
    activityTitle: 'Project marked complete',
    activityType: 'stage_change',
    terminal: true,
  },
  reopen: {
    newStage: 'engineering',
    activityTitle: 'Project reopened',
    activityType: 'note',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the decisions available for a given ops pipeline stage.
 * Falls back to an empty array for unknown stages.
 */
export function getDecisionsForStage(stage: string): DecisionOption[] {
  return STAGE_DECISIONS[stage as DecisionStage] ?? [];
}

/**
 * Get the transition result for a decision action.
 */
export function getTransition(action: DealDecisionAction): TransitionResult {
  return DEAL_TRANSITIONS[action];
}

/**
 * Maps a pipeline stage to its canonical simple status (for the DB status column).
 * The DB only accepts: lead | design | proposal | approved | installed
 */
export function stageToSimpleStatus(stage: PipelineStage): string {
  const MAP: Record<string, string> = {
    lead: 'lead',
    site_assessment: 'design',
    design_complete: 'design',
    proposal_sent: 'proposal',
    contract_signed: 'approved',
    engineering: 'approved',
    permit_submitted: 'approved',
    permit_approved: 'approved',
    install_scheduled: 'approved',
    installation: 'approved',
    inspection: 'approved',
    pto: 'approved',
    complete: 'installed',
  };
  return MAP[stage] ?? 'lead';
}

/** Variant → hex color */
export const VARIANT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  success: { bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.3)',   text: '#22C55E' },
  info:    { bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.3)',  text: '#3B82F6' },
  warning: { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.3)',  text: '#F59E0B' },
  danger:  { bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.3)',   text: '#EF4444' },
  neutral: { bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.3)', text: '#94A3B8' },
};