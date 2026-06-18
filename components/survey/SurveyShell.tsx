// ============================================================================
// v47.437 - Survey V2: SurveyShell
//
// The outer wrapper for the survey flow. Renders:
//   - Top header bar: project name + save status
//   - Step progress bar (numbered pills + labels)
//   - Step content slot (children)
//   - Bottom nav bar: Back / Next (or Submit on last step)
//
// The shell is purely presentational - all state lives in the page.
// It receives the current draft and callbacks from the parent page.
//
// Pure ASCII, no Unicode.
// ============================================================================

import React from 'react';
import { SURVEY_STEPS } from '../../lib/survey/v2/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface SurveyShellProps {
  projectName: string;
  currentStep: number;
  completedSteps: number[];
  lastSavedAt: string | null;
  saving?: boolean;
  submitting?: boolean;
  canAdvance: boolean;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
  /** True when the survey was started from standalone-handoff (no pre-linked project) */
  standalone?: boolean;
  /** True once the field worker has picked a client or project in Step 1 */
  hasSelection?: boolean;
}

// ---------------------------------------------------------------------------
// SurveyShell
// ---------------------------------------------------------------------------
export function SurveyShell({
  projectName,
  currentStep,
  completedSteps,
  lastSavedAt,
  saving,
  submitting,
  canAdvance,
  onBack,
  onNext,
  onSubmit,
  children,
  standalone,
  hasSelection,
}: SurveyShellProps) {
  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === SURVEY_STEPS.length;
  const totalSteps = SURVEY_STEPS.length;

  // Format save timestamp
  function formatSavedAt(iso: string | null): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ================================================================
          TOP HEADER
      ================================================================ */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          {/* Left: project name */}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
              Site Survey
            </p>
            {standalone && !hasSelection ? (
              /* Amber prompt: nudges field worker to pick a client/project */
              <h1 className="text-sm font-bold text-amber-500 truncate flex items-center gap-1">
                Select a client or project
              </h1>
            ) : (
              <h1 className="text-sm font-bold text-gray-900 truncate">
                {projectName || 'Untitled Project'}
              </h1>
            )}
          </div>

          {/* Right: save status */}
          <div className="ml-3 shrink-0 text-right">
            {saving ? (
              <span className="text-[10px] text-cyan-500 font-medium animate-pulse">
                Saving...
              </span>
            ) : lastSavedAt ? (
              <span className="text-[10px] text-gray-400">
                Saved {formatSavedAt(lastSavedAt)}
              </span>
            ) : null}
          </div>
        </div>

        {/* ---- Progress bar ---- */}
        <ProgressBar
          currentStep={currentStep}
          completedSteps={completedSteps}
          totalSteps={totalSteps}
        />
      </header>

      {/* ================================================================
          STEP LABEL STRIP
      ================================================================ */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-lg mx-auto px-4 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-cyan-600">
              Step {currentStep} of {totalSteps}
            </span>
            <span className="text-gray-300 text-xs">|</span>
            <span className="text-xs font-semibold text-gray-700">
              {SURVEY_STEPS[currentStep - 1]?.label ?? ''}
            </span>
          </div>
        </div>
      </div>

      {/* ================================================================
          STEP CONTENT
      ================================================================ */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-5 space-y-4">
        {children}
      </main>

      {/* ================================================================
          BOTTOM NAV BAR
      ================================================================ */}
      <footer className="sticky bottom-0 z-20 bg-white border-t border-gray-200 shadow-[0_-1px_6px_rgba(0,0,0,0.06)]">
        <div className="max-w-lg mx-auto px-4 py-3 flex gap-3">
          {/* Back button */}
          {!isFirstStep ? (
            <button
              type="button"
              onClick={onBack}
              disabled={submitting}
              className="flex-1 py-3 rounded-xl border border-gray-300 text-sm font-semibold
                text-gray-600 hover:bg-gray-50 transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Back
            </button>
          ) : (
            <div className="flex-1" />
          )}

          {/* Next / Submit button */}
          {isLastStep ? (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canAdvance || submitting}
              className="flex-2 flex-grow-[2] py-3 rounded-xl bg-green-500 text-white text-sm font-bold
                hover:bg-green-600 transition-colors shadow-sm
                disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Survey'
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={onNext}
              disabled={!canAdvance || submitting}
              className="flex-2 flex-grow-[2] py-3 rounded-xl bg-cyan-500 text-white text-sm font-bold
                hover:bg-cyan-600 transition-colors shadow-sm
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar - segmented pill bar
// ---------------------------------------------------------------------------
interface ProgressBarProps {
  currentStep: number;
  completedSteps: number[];
  totalSteps: number;
}

function ProgressBar({ currentStep, completedSteps, totalSteps }: ProgressBarProps) {
  return (
    <div className="max-w-lg mx-auto px-4 pb-3 pt-1">
      <div className="flex gap-1 items-center">
        {SURVEY_STEPS.map((step) => {
          const isCompleted = completedSteps.includes(step.id);
          const isCurrent = step.id === currentStep;
          const isFuture = step.id > currentStep && !isCompleted;

          let pillClass = '';
          if (isCompleted) {
            pillClass = 'bg-cyan-500';
          } else if (isCurrent) {
            pillClass = 'bg-cyan-300';
          } else {
            pillClass = 'bg-gray-200';
          }

          return (
            <div key={step.id} className="flex-1 flex flex-col items-center gap-0.5">
              {/* Pill */}
              <div
                className={`h-1.5 w-full rounded-full transition-colors duration-300 ${pillClass}`}
              />
              {/* Short label (only on current) */}
              {isCurrent ? (
                <span className="text-[9px] font-semibold text-cyan-600 uppercase tracking-wide">
                  {step.shortLabel}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {/* Numeric progress */}
      <p className="text-[9px] text-gray-400 text-right mt-0.5">
        {completedSteps.length}/{totalSteps} complete
      </p>
    </div>
  );
}