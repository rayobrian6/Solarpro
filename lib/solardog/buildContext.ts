/**
 * lib/solardog/buildContext.ts
 *
 * Builds the CONTEXT_JSON payload injected into every LLM request as a second system message.
 *
 * Structure:
 *   - currentPage          — what page the user is on
 *   - systemSummary        — DC/AC kW, ratio, panel count (from engineeringState)
 *   - stringLayout         — per-string panel counts (if available)
 *   - visibleWarnings      — warnings currently shown on screen
 *   - visibleErrors        — errors currently shown
 *   - complianceStatus     — pass | fail | pending | null
 *   - recommendedSystem    — engine suggestion (from engineeringState)
 *   - currentConfig        — user's current config (from engineeringState)
 *   - controlMode          — auto | guided | manual
 *   - uiMap                — UI_MAP section for current page (actions + panels)
 *   - workflow             — most relevant workflow for current state
 *   - recentEvents         — UI events fired since last message (button clicks, etc.)
 *   - projectContext       — name, id, size
 *
 * v61.16 — Context Injection Layer
 */

import { getUISection, formatUIMapForPrompt } from './uiMap';
import { detectRelevantWorkflow, formatWorkflowForPrompt } from './workflow';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UIEvent {
  actionId:  string;        // matches UIAction.id / ACTION_REGISTRY key
  page:      string;
  timestamp: string;        // ISO
  result?:   string;        // optional: 'success' | 'error' | 'cancelled'
  detail?:   Record<string, unknown>;
}

export interface ContextPayload {
  currentPage:        string;
  currentRoute?:      string;
  activeTab?:         string;

  // Project
  projectId?:         string | null;
  projectName?:       string | null;
  systemSizeKw?:      number | null;

  // Engineering live state
  systemSummary?: {
    dcKw:          number;
    acKw:          number;
    dcAcRatio:     number;
    panelCount:    number;
    stringCount:   number;
    topology:      string;
    inverterModel: string;
  } | null;
  controlMode?:       string | null;
  displayMode?:       string | null;
  panelCountSource?:  string | null;
  panelCountMismatch?: boolean;
  sizingAutoApply?:   boolean;
  userHasEditedInverters?: boolean;
  complianceStatus?:  string | null;

  // Screen state
  visibleWarnings?:   string[];
  visibleErrors?:     string[];
  visibleButtons?:    string[];
  visibleCards?:      string[];
  visibleCounts?:     Record<string, number>;
  selectedEquipment?: Record<string, string>;

  // UI Map (what buttons exist on this page)
  uiMap?:             string;   // formatted text for prompt injection

  // Workflow (relevant steps for current state)
  workflow?:          string;   // formatted text for prompt injection
  relevantWorkflowId?: string;

  // Recent UI events (button clicks, actions fired)
  recentEvents?:      UIEvent[];
}

// ─── engineeringState shape (mirrors AssistantRequest context.engineeringState) ─
interface EngineeringState {
  controlMode:            string;
  sizingAutoApply:        boolean;
  userHasEditedInverters: boolean;
  displayMode:            string;
  panelCountSource:       string;
  panelCount:             number;
  panelCountMismatch:     boolean;
  systemKwDc:             number;
  systemKwAc:             number;
  topology:               string;
  inverterModel:          string;
  stringCount:            number;
  complianceStatus:       string | null;
}

// ─── AssistantRequest context shape (subset we need) ─────────────────────────
interface IncomingContext {
  currentPage?:       string;
  currentRoute?:      string;
  activeTab?:         string;
  currentProjectId?:  string;
  currentProjectName?: string;
  projectName?:       string;
  systemSizeKw?:      number;
  visibleWarnings?:   string[];
  visibleErrors?:     string[];
  visibleButtons?:    string[];
  visibleCards?:      string[];
  visibleCounts?:     Record<string, number>;
  selectedEquipment?: Record<string, string>;
  engineeringState?:  EngineeringState;
  recentEvents?:      UIEvent[];
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build the full context payload for a single assistant request.
 *
 * @param page       — page name (engineering, design, projects, dashboard, etc.)
 * @param projectId  — resolved project ID (may be null)
 * @param ctx        — rich context from the request body
 */
export function buildContext(
  page: string,
  projectId: string | null,
  ctx: IncomingContext | undefined,
): ContextPayload {
  const c = ctx ?? {};

  // ── Engineering state ──────────────────────────────────────────────────
  const es = c.engineeringState ?? null;

  const systemSummary = es && es.systemKwDc > 0 ? {
    dcKw:          es.systemKwDc,
    acKw:          es.systemKwAc,
    dcAcRatio:     es.systemKwAc > 0 ? Math.round((es.systemKwDc / es.systemKwAc) * 100) / 100 : 0,
    panelCount:    es.panelCount,
    stringCount:   es.stringCount,
    topology:      es.topology,
    inverterModel: es.inverterModel,
  } : null;

  // ── Warnings / compliance ──────────────────────────────────────────────
  const visibleWarnings = c.visibleWarnings ?? [];
  const visibleErrors   = c.visibleErrors   ?? [];
  const complianceStatus = es?.complianceStatus ?? null;
  const hasWarnings = visibleWarnings.length > 0 || visibleErrors.length > 0
    || (complianceStatus != null && complianceStatus !== 'pass');

  // ── UI Map for current page ────────────────────────────────────────────
  const uiSection = getUISection(page);
  const uiMapStr  = uiSection ? formatUIMapForPrompt(page) : undefined;

  // ── Relevant workflow ──────────────────────────────────────────────────
  const relevantWorkflowId = detectRelevantWorkflow(page, complianceStatus, hasWarnings);
  const workflowStr = relevantWorkflowId ? formatWorkflowForPrompt(relevantWorkflowId) : undefined;

  // ── Assemble payload ───────────────────────────────────────────────────
  const payload: ContextPayload = {
    currentPage:   page,
    currentRoute:  c.currentRoute,
    activeTab:     c.activeTab,

    projectId:     projectId,
    projectName:   c.currentProjectName ?? c.projectName ?? null,
    systemSizeKw:  c.systemSizeKw ?? systemSummary?.dcKw ?? null,

    systemSummary,
    controlMode:           es?.controlMode           ?? null,
    displayMode:           es?.displayMode           ?? null,
    panelCountSource:      es?.panelCountSource      ?? null,
    panelCountMismatch:    es?.panelCountMismatch     ?? false,
    sizingAutoApply:       es?.sizingAutoApply        ?? false,
    userHasEditedInverters: es?.userHasEditedInverters ?? false,
    complianceStatus,

    visibleWarnings,
    visibleErrors,
    visibleButtons:    c.visibleButtons    ?? [],
    visibleCards:      c.visibleCards      ?? [],
    visibleCounts:     c.visibleCounts     ?? {},
    selectedEquipment: c.selectedEquipment ?? {},

    uiMap:              uiMapStr,
    workflow:           workflowStr,
    relevantWorkflowId: relevantWorkflowId ?? undefined,

    recentEvents: c.recentEvents ?? [],
  };

  // Strip undefined keys for clean JSON
  return JSON.parse(JSON.stringify(payload)) as ContextPayload;
}

/**
 * Format the context payload as a system message string for the LLM.
 * This goes in as a second system message: { role: "system", content: formatContextMessage(ctx) }
 */
export function formatContextMessage(ctx: ContextPayload): string {
  // Build a clean, readable CONTEXT_JSON block
  // The LLM is instructed to treat this as its primary source of truth
  const lines: string[] = [
    '════════════════════════════════════════════════════════════',
    'CONTEXT_JSON — PRIMARY SOURCE OF TRUTH',
    '════════════════════════════════════════════════════════════',
    'Use this data when answering questions about the current state.',
    'This is live data from the page. It overrides any assumptions.',
    '',
  ];

  // Page + project
  lines.push(`currentPage:      ${ctx.currentPage}`);
  if (ctx.currentRoute)   lines.push(`currentRoute:     ${ctx.currentRoute}`);
  if (ctx.activeTab)      lines.push(`activeTab:        ${ctx.activeTab}`);
  if (ctx.projectId)      lines.push(`projectId:        ${ctx.projectId}`);
  if (ctx.projectName)    lines.push(`projectName:      ${ctx.projectName}`);

  // System summary
  if (ctx.systemSummary) {
    const s = ctx.systemSummary;
    lines.push('');
    lines.push('SYSTEM SUMMARY:');
    lines.push(`  DC:           ${s.dcKw} kW`);
    lines.push(`  AC:           ${s.acKw} kW`);
    lines.push(`  DC/AC ratio:  ${s.dcAcRatio}`);
    lines.push(`  Panels:       ${s.panelCount}`);
    lines.push(`  Strings:      ${s.stringCount}`);
    lines.push(`  Topology:     ${s.topology}`);
    lines.push(`  Inverter:     ${s.inverterModel}`);
  }

  // Control + compliance
  if (ctx.controlMode || ctx.complianceStatus != null) {
    lines.push('');
    lines.push('ENGINEERING STATE:');
    if (ctx.controlMode)      lines.push(`  controlMode:         ${ctx.controlMode}`);
    if (ctx.displayMode)      lines.push(`  displayMode:         ${ctx.displayMode}`);
    if (ctx.panelCountSource) lines.push(`  panelCountSource:    ${ctx.panelCountSource}`);
    if (ctx.panelCountMismatch) lines.push(`  panelCountMismatch:  TRUE ⚠ CAD panel count disagrees with string config`);
    if (ctx.sizingAutoApply != null) lines.push(`  sizingAutoApply:     ${ctx.sizingAutoApply}`);
    if (ctx.userHasEditedInverters) lines.push(`  userHasEditedInverters: TRUE — engine auto-apply is blocked`);
    if (ctx.complianceStatus != null) lines.push(`  complianceStatus:    ${ctx.complianceStatus}`);
  }

  // Warnings + errors
  if ((ctx.visibleWarnings?.length ?? 0) > 0 || (ctx.visibleErrors?.length ?? 0) > 0) {
    lines.push('');
    lines.push('ACTIVE ISSUES:');
    (ctx.visibleWarnings ?? []).forEach(w => lines.push(`  ⚠ WARNING: ${w}`));
    (ctx.visibleErrors   ?? []).forEach(e => lines.push(`  ✖ ERROR:   ${e}`));
  } else if (ctx.currentPage === 'engineering') {
    lines.push('');
    lines.push('ACTIVE ISSUES: none reported — visibleWarnings not wired from this page yet');
  }

  // Selected equipment
  if (Object.keys(ctx.selectedEquipment ?? {}).length > 0) {
    lines.push('');
    lines.push('SELECTED EQUIPMENT:');
    Object.entries(ctx.selectedEquipment ?? {}).forEach(([k, v]) =>
      lines.push(`  ${k}: ${v}`)
    );
  }

  // Visible counts
  if (Object.keys(ctx.visibleCounts ?? {}).length > 0) {
    lines.push('');
    lines.push('VISIBLE COUNTS:');
    Object.entries(ctx.visibleCounts ?? {}).forEach(([k, v]) =>
      lines.push(`  ${k}: ${v}`)
    );
  }

  // Recent UI events
  if ((ctx.recentEvents?.length ?? 0) > 0) {
    lines.push('');
    lines.push('RECENT UI EVENTS (actions user clicked):');
    (ctx.recentEvents ?? []).forEach(ev => {
      const result = ev.result ? ` → ${ev.result}` : '';
      lines.push(`  [${ev.timestamp}] ${ev.actionId} on ${ev.page}${result}`);
    });
  }

  // UI Map
  if (ctx.uiMap) {
    lines.push('');
    lines.push('────────────────────────────────────────────────────────────');
    lines.push(ctx.uiMap);
  }

  // Workflow
  if (ctx.workflow) {
    lines.push('');
    lines.push('────────────────────────────────────────────────────────────');
    lines.push(ctx.workflow);
    if (ctx.relevantWorkflowId) {
      lines.push(`  → Suggest nextStep from this workflow when appropriate.`);
    }
  }

  lines.push('');
  lines.push('════════════════════════════════════════════════════════════');
  lines.push('CONTEXT RULES:');
  lines.push('  1. CONTEXT_JSON is your primary source of truth — use it before anything else.');
  lines.push('  2. Use uiMap action ids when suggesting actions in suggestedActions[].');
  lines.push('  3. Use workflow steps for nextStep field and guided mode.');
  lines.push('  4. If visibleWarnings is empty, say so — do NOT invent warnings.');
  lines.push('  5. If systemSummary is absent, say "I don\'t have live engineering state right now."');
  lines.push('  6. Your knowledge base is NOT empty — you know NEC, solar engineering, and this platform.');
  lines.push('════════════════════════════════════════════════════════════');

  return lines.join('\n');
}