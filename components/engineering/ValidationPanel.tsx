'use client';

// ════════════════════════════════════════════════════════════════════════════════
// ValidationPanel — Phase 14.2 — Actionable Resolution
// components/engineering/ValidationPanel.tsx
// ────────────────────────────────────────────────────────────────────────────────
// Renders the output of lib/system/validationEngine.validateSystem().
// Groups issues by severity, shows counts at the top, and displays each
// issue as a clickable card with its code, message, and (optional) fix hint.
//
// Phase 13.8.1 — Severity Normalization:
// Applies the UI severity mapping layer (lib/ui/severityMapper.ts) so that
// engine-decision codes (STRING_VOC_VOLTAGE_CLAMP, FEASIBILITY_*, etc.) are
// shown as informational blue rather than alarming yellow.
// Engine outputs are NEVER mutated — mapping is display-only.
//
// Phase 14.2 — Actionable Resolution:
// When a sizing-fixable error is present (DC_AC_RATIO_AC_EXCEEDS_DC, etc.)
// AND a sizingRecommendation is available, the panel shows a prominent
// "Apply Recommended Fix" button so the user gets a one-click solution
// instead of a dead-end error message.
// ════════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Wrench,
  Zap,
  Brain,
  BarChart3,
} from 'lucide-react';
import type {
  ValidationResult,
  ValidationIssue,
} from '../../lib/system/validationEngine';
import { mapIssueToUI, type MappedIssue, type UISeverity } from '../../lib/ui/severityMapper';
import type { SystemSizingResult } from '../../lib/system/sizingEngine';
import type { LayoutCandidate } from '../../lib/system/inverterCapabilities';

// ─── Sizing-fixable error codes ──────────────────────────────────────────────
// These are errors the sizing engine can definitively resolve. When one is
// present AND sizingRecommendation is non-null, we offer the Apply Fix button.
const SIZING_FIXABLE_CODES = new Set([
  'DC_AC_RATIO_AC_EXCEEDS_DC',
  'DC_AC_RATIO_LOW',
  'DC_AC_RATIO_BRAND_MIN',
  'DC_AC_RATIO_BRAND_MAX',
  'INVERTER_OVERSIZED',
  'INVERTER_COUNT_MISMATCH',
  'STRING_VOC_EXCEEDS_INVERTER_MAX',
  'MPPT_CURRENT_EXCEEDED',
]);

export interface ValidationPanelProps {
  /** The validation result from validateSystem(). If null/undefined, the panel is hidden. */
  result: ValidationResult | null | undefined;
  /** Whether to hide the panel entirely (e.g. before sizing runs for the first time). */
  hidden?: boolean;
  /** Optional click handler on an issue (for auto-fix / scroll-to-section). */
  onIssueClick?: (issue: ValidationIssue) => void;
  /**
   * The live compliance engine status (from /api/engineering/calculate).
   * When FAIL or WARNING, the "all checks passed" green banner is suppressed
   * even if the sizing-level validation has no issues -- prevents contradictory
   * "All checks passed" + "Electrical FAIL" appearing simultaneously.
   */
  complianceStatus?: 'PASS' | 'WARNING' | 'FAIL' | null;

  /**
   * Phase 14.2 — The sizing engine's current recommendation (always computed,
   * regardless of userHasEditedInverters). When a fixable error is present and
   * this is non-null, we show the "Apply Recommended Fix" action button.
   */
  sizingRecommendation?: SystemSizingResult | null;

  /**
   * Phase 14.2 — Callback fired when the user clicks "Apply Recommended Fix".
   * In page.tsx this calls applySizingRecommendation(sizingRecommendation).
   */
  onApplySizingFix?: (rec: SystemSizingResult) => void;

  /**
   * Phase 12 — The LayoutCandidate selected by the new layout solver brain.
   * When present, the panel shows a collapsible "Why this inverter?" section
   * with the selectionRationale and scoreBreakdown from the brain.
   * Pulled from sizingRecommendation.selectedLayoutCandidate in page.tsx.
   */
  selectedLayoutCandidate?: LayoutCandidate | null;
}

export function ValidationPanel({
  result,
  hidden = false,
  onIssueClick,
  complianceStatus,
  sizingRecommendation,
  onApplySizingFix,
  selectedLayoutCandidate,
}: ValidationPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    errors: true,
    warnings: true,
    info: false,
  });

  // Phase 13.8.1 — Apply severity mapping layer.
  // Re-bucket all issues by their UI severity (not engine severity).
  const { uiErrors, uiWarnings, uiInfo } = useMemo(() => {
    if (!result) return { uiErrors: [], uiWarnings: [], uiInfo: [] };

    const allRaw: ValidationIssue[] = [
      ...result.errors,
      ...result.warnings,
      ...result.info,
    ];

    const mapped = allRaw.map(issue => ({
      mapped: mapIssueToUI(issue),
      original: issue,
    }));

    return {
      uiErrors:   mapped.filter(m => m.mapped.severity === 'error'),
      uiWarnings: mapped.filter(m => m.mapped.severity === 'warning'),
      uiInfo:     mapped.filter(m => m.mapped.severity === 'info'),
    };
  }, [result]);

  // Phase 14.2 — Derive fix availability.
  // A fix is available when:
  //   1. At least one UI error has a sizing-fixable code
  //   2. sizingRecommendation is non-null
  //   3. onApplySizingFix callback is provided
  const fixableErrorCodes = useMemo(
    () => uiErrors.filter(e => SIZING_FIXABLE_CODES.has(e.mapped.code)).map(e => e.mapped.code),
    [uiErrors],
  );
  const hasFixableError = fixableErrorCodes.length > 0;
  const canOfferFix = hasFixableError && sizingRecommendation != null && typeof onApplySizingFix === 'function';

  // Build human-readable description of what the fix will apply.
  const fixDescription = useMemo(() => {
    if (!sizingRecommendation) return '';
    const { inverterModels, inverterCount, brand } = sizingRecommendation;
    if (!inverterModels.length) return '';

    // Compute what DC/AC ratio will be after the fix.
    const totalAcKw = inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0);
    const panelCount = sizingRecommendation.input?.panelCount ?? 0;
    const panelWattage = sizingRecommendation.input?.panelWattage ?? 400;
    const dcKw = (panelCount * panelWattage) / 1000;
    const newRatio = dcKw > 0 && totalAcKw > 0 ? (dcKw / totalAcKw) : null;

    // Format inverter description using a readable label derived from equipmentDbId.
    // e.g. "se-11400h" → "SE11400H", "se-7600h" → "SE7600H", "iq8plus" → "IQ8Plus"
    const fmtId = (id: string) =>
      id.replace(/^[a-z]+-/, '').replace(/-/g, '').toUpperCase();
    const invDesc = inverterModels
      .map(m => `${m.qty}×${fmtId(m.equipmentDbId)}`)
      .join(' + ');

    const ratioText = newRatio != null
      ? ` — DC/AC ratio will be ${newRatio.toFixed(2)}`
      : '';

    return `Switch to ${invDesc}${ratioText}`;
  }, [sizingRecommendation]);

  const hasAny = uiErrors.length + uiWarnings.length + uiInfo.length > 0;

  if (hidden || !result) return null;

  // v57.5 — Compliance engine status overrides validation-only isClean/isPassing.
  // If compliance ran and found FAILs or WARNINGs, we MUST NOT show a green banner.
  const complianceIsClear = complianceStatus == null || complianceStatus === 'PASS';

  // Clean system — show compact success banner ONLY when compliance also agrees.
  if (result.isClean && complianceIsClear) {
    return (
      <div
        className="card p-3 border-2 border-emerald-500/30 bg-emerald-500/5 flex items-center gap-2"
        data-testid="validation-panel-clean"
      >
        <CheckCircle2 size={16} className="text-emerald-400" />
        <span className="text-sm text-emerald-200 font-semibold">
          System validation: all checks passed
        </span>
      </div>
    );
  }

  // Phase 14.1 — The "System Valid" green banner may only fire when:
  //   • isPassing is true (no engine errors)
  //   • No UI errors (none were re-bucketed up from engine)
  //   • No UI warnings (a warning means the system has a real advisory issue)
  //   • At least one info message exists (explains automatic decisions)
  //   • Compliance engine also shows PASS (no live calc failures)
  // If there are any warnings OR compliance failed, do NOT show green.
  const showValidBanner =
    result.isPassing &&
    uiErrors.length === 0 &&
    uiWarnings.length === 0 &&
    uiInfo.length > 0 &&
    complianceIsClear;

  const toggle = (section: string) =>
    setExpandedSections(s => ({ ...s, [section]: !s[section] }));

  // v57.5 — Derive effective border color considering compliance status
  const effectiveFail = uiErrors.length > 0 || complianceStatus === 'FAIL';
  const effectiveWarn = !effectiveFail && (uiWarnings.length > 0 || complianceStatus === 'WARNING');

  return (
    <div
      className={`card p-4 border-2 ${
        effectiveFail
          ? 'border-red-500/40 bg-red-500/5'
          : effectiveWarn
            ? 'border-amber-500/40 bg-amber-500/5'
            : 'border-sky-500/30 bg-sky-500/5'
      }`}
      data-testid="validation-panel"
      data-passing={result.isPassing}
    >
      {/* v57.5 — Compliance engine failure notice (shown when validation is clean but compliance ran and found issues) */}
      {result.isClean && !complianceIsClear && (
        <div
          className={`mb-3 px-3 py-2 rounded border flex items-start gap-2 ${
            complianceStatus === 'FAIL'
              ? 'border-red-500/40 bg-red-500/10'
              : 'border-amber-500/40 bg-amber-500/10'
          }`}
          data-testid="validation-compliance-conflict"
        >
          <AlertTriangle
            size={14}
            className={`flex-shrink-0 mt-0.5 ${complianceStatus === 'FAIL' ? 'text-red-400' : 'text-amber-400'}`}
          />
          <span className={`text-xs font-semibold ${complianceStatus === 'FAIL' ? 'text-red-200' : 'text-amber-200'}`}>
            Compliance check returned{' '}
            <span className="font-bold">{complianceStatus}</span>
            {' '}— review the Compliance tab for details before proceeding.
          </span>
        </div>
      )}

      {/* Phase 13.8.1 — System Valid banner (shows when passing but has advisories) */}
      {showValidBanner && (
        <div
          className="mb-3 px-3 py-2 rounded border border-emerald-500/40 bg-emerald-500/10 flex items-center gap-2"
          data-testid="validation-system-valid-banner"
        >
          <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
          <span className="text-xs text-emerald-200 font-semibold">
            System is valid and meets electrical requirements
          </span>
        </div>
      )}

      {/* Header: counts by UI severity */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {uiErrors.length > 0 ? (
            <AlertCircle size={16} className="text-red-400" />
          ) : uiWarnings.length > 0 ? (
            <AlertTriangle size={16} className="text-amber-400" />
          ) : (
            <Info size={16} className="text-sky-400" />
          )}
          <h4 className="text-sm font-bold text-white">
            System Validation
          </h4>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {uiErrors.length > 0 && (
            <span
              className="text-red-300 font-semibold"
              data-testid="validation-error-count"
            >
              {uiErrors.length} error{uiErrors.length === 1 ? '' : 's'}
            </span>
          )}
          {uiWarnings.length > 0 && (
            <span
              className="text-amber-300 font-semibold"
              data-testid="validation-warning-count"
            >
              {uiWarnings.length} warning{uiWarnings.length === 1 ? '' : 's'}
            </span>
          )}
          {uiInfo.length > 0 && (
            <span
              className="text-sky-300 font-semibold"
              data-testid="validation-info-count"
            >
              {uiInfo.length} info
            </span>
          )}
        </div>
      </div>

      {/* Phase 14.2 — Actionable Fix Banner ─────────────────────────────────
          Shown when a sizing-fixable error is present AND the engine has a
          recommendation. This replaces the "screaming errors with no solution"
          UX with a one-click resolution path.
      ──────────────────────────────────────────────────────────────────────── */}
      {canOfferFix && sizingRecommendation && (
        <div
          className="mb-3 px-3 py-3 rounded border border-emerald-500/50 bg-emerald-500/10 flex flex-col gap-2"
          data-testid="validation-fix-banner"
        >
          <div className="flex items-start gap-2">
            <Zap size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-emerald-200 mb-0.5">
                Recommended fix available
              </div>
              {fixDescription && (
                <div className="text-[11px] text-emerald-300/80 leading-snug">
                  {fixDescription}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onApplySizingFix!(sizingRecommendation)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold transition-colors"
            data-testid="validation-apply-fix-btn"
          >
            <Wrench size={13} />
            Apply Recommended Configuration
          </button>
        </div>
      )}

      {/* Downstream-block hint when errors exist — only shown when no fix is available (to avoid redundancy) */}
      {uiErrors.length > 0 && !canOfferFix && (
        <div className="mb-3 px-3 py-2 rounded border border-red-500/40 bg-red-500/10 text-xs text-red-200">
          <span className="font-bold">Blocking:</span> permit export and plan-set
          generation are disabled while errors are present.
        </div>
      )}

      {/* When fix IS available, show a softer blocking notice below the fix button */}
      {uiErrors.length > 0 && canOfferFix && (
        <div className="mb-3 px-3 py-2 rounded border border-red-500/30 bg-red-500/5 text-xs text-red-300">
          <span className="font-semibold">Blocking</span> — apply the fix above to enable permit export.
        </div>
      )}

      {/* Issue sections — rendered by UI severity (not engine severity) */}
      {hasAny && (
        <div className="space-y-3">
          {uiErrors.length > 0 && (
            <IssueSectionMapped
              title="Errors"
              severity="error"
              items={uiErrors}
              isExpanded={expandedSections.errors}
              onToggle={() => toggle('errors')}
              onIssueClick={onIssueClick}
            />
          )}
          {uiWarnings.length > 0 && (
            <IssueSectionMapped
              title="Warnings"
              severity="warning"
              items={uiWarnings}
              isExpanded={expandedSections.warnings}
              onToggle={() => toggle('warnings')}
              onIssueClick={onIssueClick}
            />
          )}
          {uiInfo.length > 0 && (
            <IssueSectionMapped
              title="Info"
              severity="info"
              items={uiInfo}
              isExpanded={expandedSections.info}
              onToggle={() => toggle('info')}
              onIssueClick={onIssueClick}
            />
          )}
        </div>
      )}

      {/* Phase 12 — Engine Recommendation Panel */}
      {selectedLayoutCandidate && (
        <EngineRecommendationPanel candidate={selectedLayoutCandidate} />
      )}
    </div>
  );
}

// ─── Subcomponent: Phase 12 — Engine Recommendation ("Why this inverter?") ─────

interface EngineRecommendationPanelProps {
  candidate: LayoutCandidate;
}

function EngineRecommendationPanel({ candidate }: EngineRecommendationPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const { selectionRationale, scoreBreakdown, dcAcRatio, inverterQty, totalAcKw, totalDcKw, profile } = candidate;
  const sb = scoreBreakdown;

  // Topology badge
  const topologyLabel =
    profile.topology === 'optimizer' ? 'DC Optimizer' :
    profile.topology === 'micro'     ? 'Microinverter' :
    profile.topology === 'string'    ? 'String' :
    profile.topology === 'hybrid'    ? 'Hybrid' :
    profile.topology;

  const topologyColor =
    profile.topology === 'optimizer' ? 'bg-violet-500/20 text-violet-300 border-violet-500/30' :
    profile.topology === 'micro'     ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' :
    profile.topology === 'string'    ? 'bg-sky-500/20 text-sky-300 border-sky-500/30' :
    'bg-slate-500/20 text-slate-300 border-slate-500/30';

  return (
    <div
      className="mt-3 rounded border border-sky-500/30 bg-sky-500/5"
      data-testid="engine-recommendation-panel"
    >
      {/* Header — always visible, click to expand */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-sky-500/10 transition rounded"
        data-testid="engine-recommendation-toggle"
      >
        <div className="flex items-center gap-2">
          <Brain size={13} className="text-sky-400 flex-shrink-0" />
          <span className="text-xs font-bold text-sky-200">
            Engine Recommendation
          </span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${topologyColor}`}>
            {topologyLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {sb && (
            <span className="text-[11px] text-sky-300/70 font-mono">
              score {sb.total.toFixed(0)}
            </span>
          )}
          {expanded ? <ChevronDown size={12} className="text-sky-400" /> : <ChevronRight size={12} className="text-sky-400" />}
        </div>
      </button>

      {/* Collapsed summary — key stats always visible below header */}
      <div className="px-3 pb-2 flex items-center gap-3 flex-wrap">
        <span className="text-[11px] text-sky-300/80">
          <span className="font-semibold text-sky-200">{profile.modelName}</span>
          {inverterQty > 1 && (
            <span className="text-sky-400/70"> ×{inverterQty}</span>
          )}
        </span>
        <span className="text-[11px] text-slate-400">
          DC/AC <span className="text-white font-semibold">{dcAcRatio.toFixed(2)}</span>
        </span>
        <span className="text-[11px] text-slate-400">
          AC <span className="text-white font-semibold">{totalAcKw.toFixed(1)} kW</span>
        </span>
        <span className="text-[11px] text-slate-400">
          DC <span className="text-white font-semibold">{totalDcKw.toFixed(1)} kW</span>
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-sky-500/20 pt-2">

          {/* Rationale text */}
          {selectionRationale && (
            <div
              className="text-[11px] text-sky-100/80 leading-relaxed"
              data-testid="engine-recommendation-rationale"
            >
              {selectionRationale}
            </div>
          )}

          {/* Score breakdown */}
          {sb && (
            <div data-testid="engine-recommendation-scores">
              <div className="flex items-center gap-1.5 mb-1.5">
                <BarChart3 size={11} className="text-sky-400" />
                <span className="text-[10px] font-bold text-sky-300 uppercase tracking-wide">
                  Score Breakdown
                </span>
                <span className="text-[10px] text-slate-400 ml-auto">
                  Total: <span className="text-white font-bold">{sb.total.toFixed(0)}</span> / 100
                </span>
              </div>
              <div className="space-y-1">
                <ScoreBar label="DC/AC Ratio" value={sb.dcAcRatioScore} max={40} color="bg-emerald-500" />
                <ScoreBar label="Simplicity"  value={sb.simplicityScore}   max={25} color="bg-sky-500" />
                <ScoreBar label="Str Balance" value={sb.stringBalanceScore} max={20} color="bg-violet-500" />
                <ScoreBar label="Economic"    value={sb.economicScore}      max={15} color="bg-amber-500" />
                {sb.penalty < 0 && (
                  <div className="flex items-center justify-between text-[10px] mt-0.5">
                    <span className="text-red-400/80">Penalties</span>
                    <span className="text-red-400 font-mono">{sb.penalty.toFixed(0)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Subcomponent: score bar for breakdown display ────────────────────────────

interface ScoreBarProps {
  label: string;
  value: number;
  max: number;
  color: string;
}

function ScoreBar({ label, value, max, color }: ScoreBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-400 w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-700/60">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-slate-300 font-mono w-8 text-right flex-shrink-0">
        {value.toFixed(0)}/{max}
      </span>
    </div>
  );
}

// ─── Subcomponent: collapsible section per UI severity ────────────────────────

interface IssueSectionMappedProps {
  title: string;
  severity: UISeverity;
  items: Array<{ mapped: MappedIssue; original: ValidationIssue }>;
  isExpanded: boolean;
  onToggle: () => void;
  onIssueClick?: (issue: ValidationIssue) => void;
}

function IssueSectionMapped({
  title,
  severity,
  items,
  isExpanded,
  onToggle,
  onIssueClick,
}: IssueSectionMappedProps) {
  const color =
    severity === 'error'
      ? { border: 'border-red-500/30', bg: 'bg-red-500/10', text: 'text-red-300' }
      : severity === 'warning'
        ? { border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-300' }
        : { border: 'border-sky-500/30', bg: 'bg-sky-500/10', text: 'text-sky-200' };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 text-left text-xs text-slate-300 hover:text-white transition"
        data-testid={`validation-section-toggle-${severity}`}
      >
        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-semibold uppercase tracking-wide">
          {title} ({items.length})
        </span>
      </button>

      {isExpanded && (
        <div className="space-y-1 ml-4" data-testid={`validation-issues-${severity}`}>
          {items.map(({ mapped, original }, i) => (
            <IssueCard
              key={`${mapped.code}-${i}`}
              mapped={mapped}
              original={original}
              color={color}
              onClick={onIssueClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Subcomponent: single issue card ─────────────────────────────────────────

interface IssueCardProps {
  mapped: MappedIssue;
  original: ValidationIssue;
  color: { border: string; bg: string; text: string };
  onClick?: (issue: ValidationIssue) => void;
}

function IssueCard({ mapped, original, color, onClick }: IssueCardProps) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      className={`px-3 py-2 rounded border ${color.border} ${color.bg} text-xs ${
        clickable ? 'cursor-pointer hover:brightness-125 transition' : ''
      }`}
      onClick={clickable ? () => onClick?.(original) : undefined}
      data-testid={`validation-issue-${mapped.code}`}
      data-severity={mapped.severity}
      data-engine-severity={mapped.engineSeverity}
    >
      <div className="flex items-start gap-2">
        <span
          className={`font-mono text-[10px] ${color.text} opacity-80 flex-shrink-0 mt-0.5`}
        >
          {mapped.code}
        </span>
        <div className="flex-1 min-w-0">
          <div className={`${color.text} leading-snug`}>{mapped.message}</div>
          {original.recommendation && (
            <div className="mt-1 text-slate-400 text-[11px] italic">
              → {original.recommendation}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}