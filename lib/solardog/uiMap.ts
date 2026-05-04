/**
 * lib/solardog/uiMap.ts
 *
 * Canonical UI Map — every button, panel, and section SolarDog can "see" and reference.
 *
 * This is the ground-truth about what exists in the UI and what it does.
 * Injected into CONTEXT_JSON on every request so the LLM can:
 *   - Explain what buttons do (by id)
 *   - Suggest actions with the correct id (matched by frontend executor)
 *   - Reference panels and sections accurately
 *
 * v61.16 — Context Injection Layer
 */

export interface UIAction {
  id:          string;   // matches ACTION_REGISTRY key + CustomEvent detail.action
  label:       string;   // human-readable label shown in UI
  description: string;   // what it does (for LLM)
  whenToUse:   string;   // guidance for LLM on when to suggest this
  effect:      string;   // what happens after execution
  requiresProject?: boolean;
  requiresValid?:   boolean;  // needs compliance to pass first
}

export interface UIPanel {
  id:          string;
  label:       string;
  description: string;  // what it shows / contains
}

export interface UISection {
  actions: UIAction[];
  panels:  UIPanel[];
}

export const UI_MAP: Record<string, UISection> = {

  // ─── Engineering page ────────────────────────────────────────────────────
  engineering: {
    actions: [
      {
        id:          'apply_recommended',
        label:       'Apply Recommended Configuration',
        description: 'Syncs the current system config to the engine\'s validated recommendation (inverter, string count, panel count)',
        whenToUse:   'When a system mismatch is shown — currentConfig disagrees with recommendedSystem',
        effect:      'Overwrites currentConfig with recommendedSystem. Mismatch warning clears.',
        requiresProject: true,
      },
      {
        id:          'auto_fix_string',
        label:       'Auto-Fix Strings',
        description: 'Automatically corrects string configuration (panels per string, string count) to pass NEC 690 voltage/current rules',
        whenToUse:   'When STRING_VOC_VOLTAGE_CLAMP, STRING_VOC_EXCEEDS_INVERTER, or MPPT range warnings are present',
        effect:      'Adjusts panels-per-string and string count within inverter MPPT constraints',
        requiresProject: true,
      },
      {
        id:          'auto_fix_wire',
        label:       'Auto-Fix Wire',
        description: 'Automatically corrects wire gauge to satisfy NEC 690.8 125% rule and 310.16 ampacity tables',
        whenToUse:   'When WIRE_UNDERSIZED or AMPACITY_FAIL warnings are present',
        effect:      'Upsizes wire gauge to minimum passing size, recalculates conduit fill',
        requiresProject: true,
      },
      {
        id:          'run_string_sizing',
        label:       'Run String Sizing',
        description: 'Triggers the string sizing engine — calculates optimal panels-per-string, string count, and validates Voc/Vmp against inverter limits',
        whenToUse:   'At the start of engineering, or after changing panels or inverter',
        effect:      'Produces a sizing recommendation with string layout and compliance status',
        requiresProject: true,
      },
      {
        id:          'run_wire_sizing',
        label:       'Run Wire Sizing',
        description: 'Calculates wire gauge, conduit size, OCPD rating, and run lengths for all circuits',
        whenToUse:   'After string sizing is complete, or after changing panel/string layout',
        effect:      'Produces wire schedule with gauge, conduit fill %, and NEC pass/fail per circuit',
        requiresProject: true,
      },
      {
        id:          'run_nec_validation',
        label:       'Run NEC Check',
        description: 'Validates the full system against NEC 690 rules: voltage limits, current sizing, conduit fill, OCPD ratings',
        whenToUse:   'After string and wire sizing are complete, or anytime to check compliance status',
        effect:      'Returns pass/fail per rule with specific violation details',
        requiresProject: true,
      },
      {
        id:          'generate_bom',
        label:       'Generate BOM',
        description: 'Creates a complete bill of materials: all panels, inverters, wire, conduit, combiners, disconnects, and mounting hardware',
        whenToUse:   'After system passes NEC validation — complianceStatus should be "pass"',
        effect:      'Outputs a line-item equipment list with quantities and cost estimates',
        requiresProject: true,
        requiresValid:   true,
      },
      {
        id:          'generate_sld',
        label:       'Generate SLD',
        description: 'Creates a single-line diagram suitable for permit submission',
        whenToUse:   'After system passes compliance — use for permit package',
        effect:      'Generates a PDF single-line diagram with string layout, wire schedule, and equipment callouts',
        requiresProject: true,
        requiresValid:   true,
      },
      {
        id:          'generate_planset',
        label:       'Generate Plan Set',
        description: 'Creates a full permit-ready plan set: site plan, roof plan, SLD, equipment specs, labels',
        whenToUse:   'After all compliance checks pass — final step before permit submission',
        effect:      'Outputs multi-page PDF plan set ready for AHJ submission',
        requiresProject: true,
        requiresValid:   true,
      },
      {
        id:          'generate_proposal',
        label:       'Generate Proposal',
        description: 'Creates a branded customer proposal with system production, savings, ITC 30%, and payback analysis',
        whenToUse:   'After system design is complete — for customer presentation',
        effect:      'Outputs a branded PDF proposal with financials and production estimates',
        requiresProject: true,
      },
      {
        id:          'flag_review',
        label:       'Flag for Review',
        description: 'Flags the current project for engineering review by a senior engineer or QC team',
        whenToUse:   'When system has unresolved issues or needs a second opinion',
        effect:      'Adds a review flag to the project visible in the dashboard pipeline',
        requiresProject: true,
      },
    ],
    panels: [
      {
        id:          'system_validation',
        label:       'System Validation',
        description: 'Shows pass/fail status for all NEC checks. Lists warnings (yellow) and errors (red) with rule codes and descriptions. Green check = passing.',
      },
      {
        id:          'inverters_strings',
        label:       'Inverters & Strings',
        description: 'Configure inverter model, quantity, MPPT inputs, and string layout. Shows panels-per-string and validates against inverter voltage/current limits.',
      },
      {
        id:          'electrical_sizing',
        label:       'Electrical Sizing',
        description: 'Wire gauge selection, conduit sizing, OCPD ratings, and circuit run lengths. NEC 690.8 and 310.16 compliance shown per circuit.',
      },
      {
        id:          'control_mode_banner',
        label:       'Control Mode Banner',
        description: 'Shows the current control mode (Auto / Guided / Manual) and field lock icons. Click to switch modes. Lock icons toggle per-field overrides.',
      },
      {
        id:          'system_mismatch_card',
        label:       'System Mismatch Card',
        description: 'Appears when currentConfig disagrees with recommendedSystem. Shows "Apply Recommended Configuration" button to sync them.',
      },
      {
        id:          'bom_tab',
        label:       'BOM Tab',
        description: 'Bill of materials table — all equipment, quantities, and estimated cost. Accessible via ?tab=bom on engineering page.',
      },
    ],
  },

  // ─── Design page ─────────────────────────────────────────────────────────
  design: {
    actions: [
      {
        id:          'auto_layout',
        label:       'Auto Layout',
        description: 'Automatically places panels on detected roof planes using optimal spacing and orientation',
        whenToUse:   'When roof planes are detected and user wants a fast starting layout',
        effect:      'Places panels with setbacks, spacing, and orientation auto-calculated',
        requiresProject: true,
      },
      {
        id:          'open_roof_tool',
        label:       'Open Roof Tool',
        description: 'Opens the 2D/3D roof layout tool for manual panel placement',
        whenToUse:   'When user wants to manually place or adjust panels',
        effect:      'Opens interactive roof design canvas',
        requiresProject: true,
      },
    ],
    panels: [
      {
        id:          'roof_canvas',
        label:       'Roof Canvas',
        description: 'Interactive 2D/3D canvas for placing panels on detected roof planes. Supports manual drag-and-drop and auto-layout.',
      },
      {
        id:          'panel_count_summary',
        label:       'Panel Count Summary',
        description: 'Shows total panel count from CAD layout. This is the authoritative panel count used by the engineering engine.',
      },
    ],
  },

  // ─── Projects page ───────────────────────────────────────────────────────
  projects: {
    actions: [
      {
        id:          'new_project',
        label:       'Create New Project',
        description: 'Opens the new project wizard to create a solar project from scratch',
        whenToUse:   'When user wants to start a new job or add a new client',
        effect:      'Navigates to /projects/new with creation form',
      },
    ],
    panels: [
      {
        id:          'project_pipeline',
        label:       'Project Pipeline',
        description: 'Kanban-style pipeline showing all projects by status: Lead, Design, Engineering, Proposal, Install, Complete.',
      },
      {
        id:          'project_table',
        label:       'Project Table',
        description: 'Tabular list of all projects with sortable columns: name, status, system size, address, created date.',
      },
    ],
  },

  // ─── Dashboard ────────────────────────────────────────────────────────────
  dashboard: {
    actions: [],
    panels: [
      {
        id:          'pipeline_stats',
        label:       'Pipeline Stats',
        description: 'Summary cards showing active projects by stage, total pipeline value, and recent activity.',
      },
      {
        id:          'quick_actions',
        label:       'Quick Actions',
        description: 'Fast-access buttons: New Project, Go to Engineering, View Proposals.',
      },
    ],
  },

  // ─── Proposals page ──────────────────────────────────────────────────────
  proposals: {
    actions: [
      {
        id:          'generate_proposal',
        label:       'Generate Proposal',
        description: 'Creates a branded customer proposal PDF with production, savings, and financials',
        whenToUse:   'After system design is complete and production estimates are loaded',
        effect:      'Outputs PDF proposal with ITC 30%, payback period, and net cost',
        requiresProject: true,
      },
    ],
    panels: [
      {
        id:          'proposal_preview',
        label:       'Proposal Preview',
        description: 'Live preview of the proposal PDF showing production data, financial summary, and branding.',
      },
    ],
  },
};

/**
 * Get the UI map for a specific page — returns the section or null.
 */
export function getUISection(page: string): UISection | null {
  return UI_MAP[page] ?? null;
}

/**
 * Build a compact string summary of UI actions for a page (for system prompt injection).
 */
export function formatUIMapForPrompt(page: string): string {
  const section = UI_MAP[page];
  if (!section) return `No UI map available for page: ${page}`;

  const actionLines = section.actions.map(a =>
    `  [${a.id}] "${a.label}" — ${a.description}\n` +
    `    When: ${a.whenToUse}\n` +
    `    Effect: ${a.effect}`
  ).join('\n');

  const panelLines = section.panels.map(p =>
    `  [${p.id}] "${p.label}" — ${p.description}`
  ).join('\n');

  return [
    `UI ACTIONS on ${page}:`,
    actionLines || '  (none)',
    '',
    `UI PANELS on ${page}:`,
    panelLines || '  (none)',
  ].join('\n');
}