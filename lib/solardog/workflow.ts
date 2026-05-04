/**
 * lib/solardog/workflow.ts
 *
 * Workflow Graph — the canonical order of operations for every major flow in SolarPro.
 *
 * SolarDog uses these to:
 *   - Guide users step-by-step through complex processes
 *   - Know where the user is in a workflow from context
 *   - Suggest the correct next step automatically
 *   - Skip steps that are already complete (based on live context)
 *
 * v61.16 — Context Injection Layer
 */

export interface WorkflowStep {
  step:        number;
  id:          string;
  label:       string;
  description: string;
  /** Action key to execute this step (if automatable) */
  actionId?:   string;
  /** How to detect this step is already complete from context */
  doneWhen?:   string;
}

export interface Workflow {
  id:          string;
  label:       string;
  description: string;
  steps:       WorkflowStep[];
}

export const WORKFLOWS: Record<string, Workflow> = {

  // ─── Pass engineering / get to compliance ─────────────────────────────────
  pass_engineering: {
    id:          'pass_engineering',
    label:       'Get System to Pass',
    description: 'Step-by-step guide to take a system from warnings/errors to full NEC compliance and permit-ready outputs',
    steps: [
      {
        step:        1,
        id:          'check_warnings',
        label:       'Check Current Warnings',
        description: 'Open System Validation panel. Identify all active warnings and errors by NEC rule code.',
        doneWhen:    'visibleWarnings is populated OR complianceStatus is known',
      },
      {
        step:        2,
        id:          'resolve_mismatch',
        label:       'Resolve System Mismatch (if present)',
        description: 'If a system mismatch warning is shown, click "Apply Recommended Configuration" to sync currentConfig with the engine recommendation.',
        actionId:    'apply_recommended',
        doneWhen:    'panelCountMismatch = false AND no mismatch warning visible',
      },
      {
        step:        3,
        id:          'fix_string_sizing',
        label:       'Fix String Sizing',
        description: 'If STRING_VOC or MPPT warnings exist, run Auto-Fix Strings or manually adjust panels-per-string.',
        actionId:    'auto_fix_string',
        doneWhen:    'No STRING_VOC or MPPT warnings in validationResults',
      },
      {
        step:        4,
        id:          'fix_wire_sizing',
        label:       'Fix Wire Sizing',
        description: 'If WIRE_UNDERSIZED or AMPACITY warnings exist, run Auto-Fix Wire or manually select a larger gauge.',
        actionId:    'auto_fix_wire',
        doneWhen:    'No WIRE or AMPACITY warnings in validationResults',
      },
      {
        step:        5,
        id:          'run_nec_check',
        label:       'Run NEC Validation',
        description: 'Run the full NEC check to confirm all rules pass. Target: zero errors, zero warnings.',
        actionId:    'run_nec_validation',
        doneWhen:    'complianceStatus = "pass"',
      },
      {
        step:        6,
        id:          'generate_bom',
        label:       'Generate BOM',
        description: 'With compliance passing, generate the bill of materials for equipment procurement.',
        actionId:    'generate_bom',
        doneWhen:    'BOM exists for this project',
      },
      {
        step:        7,
        id:          'generate_permit_docs',
        label:       'Generate Permit Documents',
        description: 'Generate the SLD and plan set for AHJ permit submission.',
        actionId:    'generate_planset',
        doneWhen:    'Plan set PDF generated',
      },
    ],
  },

  // ─── New system design from scratch ──────────────────────────────────────
  new_system_design: {
    id:          'new_system_design',
    label:       'Design New System',
    description: 'Complete flow from creating a new project to a permit-ready design',
    steps: [
      {
        step:        1,
        id:          'create_project',
        label:       'Create Project',
        description: 'Go to Projects and create a new project with site address and customer info.',
        actionId:    'new_project',
        doneWhen:    'projectId is loaded',
      },
      {
        step:        2,
        id:          'roof_layout',
        label:       'Place Panels on Roof',
        description: 'Go to Design and place panels on the roof. Use Auto Layout for a fast starting point.',
        actionId:    'auto_layout',
        doneWhen:    'panelCount > 0 AND panelCountSource = "cad"',
      },
      {
        step:        3,
        id:          'run_string_sizing',
        label:       'Run String Sizing',
        description: 'Go to Engineering and run string sizing. The engine will select inverter, strings, and validate Voc/Vmp.',
        actionId:    'run_string_sizing',
        doneWhen:    'stringCount > 0 AND inverterModel is set',
      },
      {
        step:        4,
        id:          'resolve_mismatch',
        label:       'Apply Recommended Config (if needed)',
        description: 'If a mismatch is shown, apply the recommended configuration.',
        actionId:    'apply_recommended',
        doneWhen:    'panelCountMismatch = false',
      },
      {
        step:        5,
        id:          'run_wire_sizing',
        label:       'Run Wire Sizing',
        description: 'Size all conductors, conduit, and OCPDs for NEC 690.8 compliance.',
        actionId:    'run_wire_sizing',
        doneWhen:    'Wire schedule is populated',
      },
      {
        step:        6,
        id:          'validate',
        label:       'Validate (Zero Warnings)',
        description: 'Run NEC check. Fix any remaining warnings. Target: all green.',
        actionId:    'run_nec_validation',
        doneWhen:    'complianceStatus = "pass"',
      },
      {
        step:        7,
        id:          'generate_outputs',
        label:       'Generate BOM + SLD + Plan Set',
        description: 'With compliance passing: generate BOM, then SLD, then full plan set.',
        actionId:    'generate_planset',
        doneWhen:    'Plan set and BOM generated',
      },
      {
        step:        8,
        id:          'generate_proposal',
        label:       'Generate Customer Proposal',
        description: 'Create a branded proposal with production, savings, and ITC 30% for the customer.',
        actionId:    'generate_proposal',
        doneWhen:    'Proposal PDF generated',
      },
    ],
  },

  // ─── String sizing deep-dive ──────────────────────────────────────────────
  string_sizing: {
    id:          'string_sizing',
    label:       'String Sizing Walkthrough',
    description: 'Step-by-step guide to correctly size strings for NEC 690 compliance',
    steps: [
      {
        step:        1,
        id:          'get_panel_voc',
        label:       'Know Your Panel Voc',
        description: 'Find the panel\'s Voc (open-circuit voltage) from the datasheet. This is the STC value.',
        doneWhen:    'Panel model is selected',
      },
      {
        step:        2,
        id:          'apply_temp_correction',
        label:       'Apply Temperature Correction',
        description: 'Multiply Voc × temp correction factor for your design low temperature (NEC 690.7 / ASHRAE 2%). This gives corrected Voc.',
        doneWhen:    'Jurisdiction / design temp is set',
      },
      {
        step:        3,
        id:          'check_inverter_max_voltage',
        label:       'Check Inverter Max Input Voltage',
        description: 'Find the inverter\'s max DC input voltage (typically 600V or 1000V). String Voc corrected must stay below this.',
        doneWhen:    'Inverter model is selected',
      },
      {
        step:        4,
        id:          'calculate_max_panels',
        label:       'Calculate Max Panels Per String',
        description: 'Max panels = floor(inverter max Vdc / corrected Voc per panel). This is your upper limit.',
        doneWhen:    'String sizing calculation is run',
      },
      {
        step:        5,
        id:          'check_mppt_range',
        label:       'Check MPPT Operating Range',
        description: 'String Vmp at operating temperature must stay within the inverter\'s MPPT window (e.g. 200–480V). Verify both min and max.',
        doneWhen:    'No MPPT_RANGE warnings in validation',
      },
      {
        step:        6,
        id:          'validate_current',
        label:       'Validate String Current',
        description: 'String Isc × 1.25 must be ≤ inverter MPPT input current limit. Check NEC 690.8.',
        doneWhen:    'No current warnings in validation',
      },
      {
        step:        7,
        id:          'run_nec',
        label:       'Run NEC Validation',
        description: 'Run the NEC check. Confirm zero string voltage/current violations.',
        actionId:    'run_nec_validation',
        doneWhen:    'complianceStatus = "pass"',
      },
    ],
  },

  // ─── Proposal creation ────────────────────────────────────────────────────
  create_proposal: {
    id:          'create_proposal',
    label:       'Create Customer Proposal',
    description: 'Flow from engineering-complete system to a sent customer proposal',
    steps: [
      {
        step:        1,
        id:          'confirm_system',
        label:       'Confirm System is Valid',
        description: 'Verify engineering passes NEC check and system size is final.',
        doneWhen:    'complianceStatus = "pass"',
      },
      {
        step:        2,
        id:          'check_production',
        label:       'Confirm Production Estimate',
        description: 'Review annual kWh production estimate on the project. Should reflect panel count and location.',
        doneWhen:    'Production estimate is loaded',
      },
      {
        step:        3,
        id:          'review_financials',
        label:       'Review Financials',
        description: 'Check gross cost, ITC 30% credit, net cost, payback period, and 25-year savings.',
        doneWhen:    'Cost estimate is set on project',
      },
      {
        step:        4,
        id:          'add_branding',
        label:       'Confirm Company Branding',
        description: 'In Settings → Branding, ensure company logo, colors, and contact info are configured.',
        doneWhen:    'Branding is configured in settings',
      },
      {
        step:        5,
        id:          'generate_proposal',
        label:       'Generate Proposal PDF',
        description: 'Click "Generate Proposal" to create the branded PDF.',
        actionId:    'generate_proposal',
        doneWhen:    'Proposal PDF generated',
      },
      {
        step:        6,
        id:          'send_proposal',
        label:       'Send to Customer',
        description: 'Download or share the proposal PDF with the customer.',
        doneWhen:    'Proposal sent',
      },
    ],
  },
};

/**
 * Get a workflow by id.
 */
export function getWorkflow(id: string): Workflow | null {
  return WORKFLOWS[id] ?? null;
}

/**
 * Detect which workflow is most relevant based on page + context.
 */
export function detectRelevantWorkflow(
  page: string,
  complianceStatus?: string | null,
  hasWarnings?: boolean,
): string | null {
  if (page === 'engineering') {
    if (complianceStatus === 'pass') return 'create_proposal';
    if (hasWarnings) return 'pass_engineering';
    return 'pass_engineering'; // default for engineering
  }
  if (page === 'design')    return 'new_system_design';
  if (page === 'proposals') return 'create_proposal';
  return null;
}

/**
 * Format a workflow as a numbered step list for the system prompt.
 */
export function formatWorkflowForPrompt(workflowId: string): string {
  const wf = WORKFLOWS[workflowId];
  if (!wf) return '';
  const steps = wf.steps.map(s =>
    `  Step ${s.step}: [${s.id}] ${s.label} — ${s.description}` +
    (s.actionId ? ` (action: ${s.actionId})` : '') +
    (s.doneWhen ? ` ✓ Done when: ${s.doneWhen}` : '')
  ).join('\n');
  return `WORKFLOW "${wf.id}" — ${wf.label}:\n${steps}`;
}

/**
 * Format all workflow IDs and labels as a compact menu.
 */
export function formatWorkflowMenu(): string {
  return Object.values(WORKFLOWS)
    .map(w => `  ${w.id}: ${w.label} — ${w.description}`)
    .join('\n');
}