/**
 * lib/solardog/actionRegistry.ts
 *
 * Registry of all executable actions SolarDog can trigger.
 *
 * Each action has:
 * - key: unique identifier returned in the response schema
 * - label: human-readable label for UI buttons
 * - description: what the action does (for LLM context)
 * - category: grouping for the system prompt
 * - requiresProject: whether a projectId is needed
 */

export interface AgentAction {
  key:              string;
  label:            string;
  description:      string;
  category:         ActionCategory;
  requiresProject?: boolean;
}

export type ActionCategory =
  | 'navigation'
  | 'engineering'
  | 'design'
  | 'proposal'
  | 'project'
  | 'system'
  | 'guided';

export const ACTION_REGISTRY: AgentAction[] = [
  // ── Navigation ──────────────────────────────────────────────────────────
  {
    key:         'navigate',
    label:       'Navigate',
    description: 'Navigate to a route — route resolved by frontend from response.route field',
    category:    'navigation',
  },
  {
    key:         'open_dashboard',
    label:       'Go to Dashboard',
    description: 'Navigate to /dashboard (command center)',
    category:    'navigation',
  },
  {
    key:         'open_projects',
    label:       'View Projects',
    description: 'Navigate to /projects list',
    category:    'navigation',
  },
  {
    key:         'open_engineering',
    label:       'Open Engineering',
    description: 'Navigate to /engineering (string sizing, NEC, BOM)',
    category:    'navigation',
    requiresProject: true,
  },
  {
    key:         'open_bom',
    label:       'Open BOM',
    description: 'Navigate to /engineering?tab=bom (bill of materials)',
    category:    'navigation',
    requiresProject: true,
  },
  {
    key:         'open_design',
    label:       'Open Design',
    description: 'Navigate to /design (roof layout)',
    category:    'navigation',
    requiresProject: true,
  },
  {
    key:         'open_proposals',
    label:       'Open Proposals',
    description: 'Navigate to /proposals',
    category:    'navigation',
  },
  {
    key:         'open_clients',
    label:       'Open Clients',
    description: 'Navigate to /clients',
    category:    'navigation',
  },
  {
    key:         'open_hardware',
    label:       'Hardware Catalog',
    description: 'Navigate to /hardware (panels, inverters, batteries)',
    category:    'navigation',
  },
  {
    key:         'open_analytics',
    label:       'Open Analytics',
    description: 'Navigate to /analytics',
    category:    'navigation',
  },
  {
    key:         'open_settings',
    label:       'Open Settings',
    description: 'Navigate to /settings',
    category:    'navigation',
  },
  {
    key:         'open_permit',
    label:       'Permit Package',
    description: 'Navigate to /engineering/permit (SLD, permit docs)',
    category:    'navigation',
  },
  {
    key:         'new_project',
    label:       'Create New Project',
    description: 'Navigate to /projects/new to create a new project',
    category:    'project',
  },

  // ── Engineering actions ─────────────────────────────────────────────────
  {
    key:         'run_string_sizing',
    label:       'Run String Sizing',
    description: 'Trigger string sizing calculation for current project',
    category:    'engineering',
    requiresProject: true,
  },
  {
    key:         'run_wire_sizing',
    label:       'Run Wire Sizing',
    description: 'Trigger wire sizing / ampacity check',
    category:    'engineering',
    requiresProject: true,
  },
  {
    key:         'run_nec_validation',
    label:       'Run NEC Check',
    description: 'Validate system against NEC 690 rules',
    category:    'engineering',
    requiresProject: true,
  },
  {
    key:         'auto_fix_string',
    label:       'Auto-Fix Strings',
    description: 'Automatically correct string configuration to pass NEC',
    category:    'engineering',
    requiresProject: true,
  },
  {
    key:         'auto_fix_wire',
    label:       'Auto-Fix Wire',
    description: 'Automatically correct wire gauge to pass ampacity check',
    category:    'engineering',
    requiresProject: true,
  },
  {
    key:         'generate_bom',
    label:       'Generate BOM',
    description: 'Generate full bill of materials for current project',
    category:    'engineering',
    requiresProject: true,
  },
  {
    key:         'generate_sld',
    label:       'Generate SLD',
    description: 'Generate single-line diagram for permit package',
    category:    'engineering',
    requiresProject: true,
  },

  // ── Design actions ──────────────────────────────────────────────────────
  {
    key:         'open_roof_tool',
    label:       'Open Roof Tool',
    description: 'Open the design/roof layout tool',
    category:    'design',
    requiresProject: true,
  },
  {
    key:         'auto_layout',
    label:       'Auto Layout',
    description: 'Automatically place panels on roof planes',
    category:    'design',
    requiresProject: true,
  },

  // ── Proposal actions ────────────────────────────────────────────────────
  {
    key:         'generate_proposal',
    label:       'Generate Proposal',
    description: 'Generate a branded customer proposal with production and financials',
    category:    'proposal',
    requiresProject: true,
  },

  // ── Project actions ─────────────────────────────────────────────────────
  {
    key:         'flag_review',
    label:       'Flag for Review',
    description: 'Flag current project for engineering review',
    category:    'project',
    requiresProject: true,
  },

  // ── Guided mode ─────────────────────────────────────────────────────────
  {
    key:         'start_guided_design',
    label:       'Guide Me Through Design',
    description: 'Start step-by-step guided workflow to build a system from scratch',
    category:    'guided',
  },
  {
    key:         'start_guided_engineering',
    label:       'Guide Engineering',
    description: 'Walk through engineering step-by-step: strings → wires → NEC → BOM',
    category:    'guided',
    requiresProject: true,
  },
  {
    key:         'start_guided_proposal',
    label:       'Guide Proposal Flow',
    description: 'Walk through creating a complete proposal from scratch',
    category:    'guided',
  },
];

/** Lookup by key */
export function getAction(key: string): AgentAction | undefined {
  return ACTION_REGISTRY.find(a => a.key === key);
}

/** Get all actions in a category */
export function getActionsByCategory(category: ActionCategory): AgentAction[] {
  return ACTION_REGISTRY.filter(a => a.category === category);
}

/**
 * Build a compact list for the system prompt.
 * Groups actions by category for readability.
 */
export function buildActionList(): string {
  const categories: ActionCategory[] = [
    'navigation', 'engineering', 'design', 'proposal', 'project', 'guided',
  ];
  return categories.map(cat => {
    const actions = getActionsByCategory(cat);
    if (!actions.length) return '';
    const lines = actions.map(a => `  "${a.key}" — ${a.description}`).join('\n');
    return `${cat.toUpperCase()}:\n${lines}`;
  }).filter(Boolean).join('\n\n');
}