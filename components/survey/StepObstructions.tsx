// ============================================================================
// v47.437 - Survey V2: Step 4 - Obstructions & Layout Constraints
//
// Uses ObstructionMap for the interactive roof diagram + obstruction logger.
// Also captures setback notes and estimated usable roof percentage.
//
// Maps to CAD engine: obstruction coordinates, setback compliance,
// usable array area calculation.
//
// Pure ASCII, no Unicode.
// ============================================================================

import React from 'react';
import type { SurveyObstructions } from '../../lib/survey/v2/types';
import { StepCard, StepField, StepTextArea } from './ui/StepCard';
import { ObstructionMap } from './ui/ObstructionMap';

interface StepObstructionsProps {
  data: SurveyObstructions;
  onChange: (data: SurveyObstructions) => void;
  disabled?: boolean;
}

export function StepObstructions({ data, onChange, disabled }: StepObstructionsProps) {
  function set<K extends keyof SurveyObstructions>(
    key: K,
    value: SurveyObstructions[K],
  ) {
    onChange({ ...data, [key]: value });
  }

  // Clamp usable roof pct to 0-100
  function handleUsablePct(raw: string) {
    const n = parseInt(raw, 10);
    if (isNaN(n)) {
      set('estimatedUsableRoofPct', null);
    } else {
      set('estimatedUsableRoofPct', Math.min(100, Math.max(0, n)));
    }
  }

  return (
    <div className="space-y-4">
      {/* ---- Obstruction map ---- */}
      <StepCard
        title="Obstruction Map"
        subtitle="Tap a roof zone to log an obstruction. All zones with items are flagged orange."
      >
        <ObstructionMap
          obstructions={data.obstructions}
          onChange={(obs) => set('obstructions', obs)}
          disabled={disabled}
        />
      </StepCard>

      {/* ---- Usable roof area ---- */}
      <StepCard
        title="Usable Roof Area"
        subtitle="Used by CAD engine to size the array footprint"
      >
        <StepField
          label="Estimated Usable Roof Area (%)"
          hint="Percentage of total roof area that is available for solar panels (0-100)"
        >
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={data.estimatedUsableRoofPct ?? 80}
                onChange={(e) => handleUsablePct(e.target.value)}
                disabled={disabled}
                className="w-full accent-cyan-500 disabled:opacity-50"
              />
            </div>
            <div className="w-16 shrink-0">
              <input
                type="number"
                min="0"
                max="100"
                value={
                  data.estimatedUsableRoofPct != null
                    ? String(data.estimatedUsableRoofPct)
                    : ''
                }
                onChange={(e) => handleUsablePct(e.target.value)}
                placeholder="auto"
                disabled={disabled}
                className="w-full text-center rounded-lg border border-gray-300 px-2 py-1.5
                  text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2
                  focus:ring-cyan-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
            <span className="text-sm font-semibold text-gray-500 shrink-0">%</span>
          </div>
          {/* QW-1c: Show contextual note when no value set yet */}
          {data.estimatedUsableRoofPct == null && (
            <p className="mt-1 text-xs text-slate-400 italic">
              Not yet estimated -- will default to ~80% (typical after standard fire setbacks). Adjust after mapping obstructions.
            </p>
          )}

          {/* Color-coded area label */}
          {data.estimatedUsableRoofPct != null && (
            <div className="mt-2">
              {data.estimatedUsableRoofPct >= 70 ? (
                <span className="text-xs font-medium text-green-600">
                  Good - sufficient area for most residential systems
                </span>
              ) : data.estimatedUsableRoofPct >= 40 ? (
                <span className="text-xs font-medium text-yellow-600">
                  Moderate - may limit system size
                </span>
              ) : (
                <span className="text-xs font-medium text-red-600">
                  Limited - significant obstructions present
                </span>
              )}
            </div>
          )}
        </StepField>
      </StepCard>

      {/* ---- Setback notes ---- */}
      <StepCard
        title="Setback Notes"
        subtitle="Fire access pathways, ridge setbacks, valley setbacks, hip setbacks"
      >
        <StepField
          label="Notes"
          hint="Describe any unusual setback requirements, AHJ-specific rules, or HOA restrictions"
        >
          <StepTextArea
            value={data.setbackNotes}
            onChange={(v) => set('setbackNotes', v)}
            placeholder="e.g. AHJ requires 3ft hip setback; HOA prohibits panels visible from street..."
            rows={4}
            disabled={disabled}
          />
        </StepField>
      </StepCard>

      {/* ---- Summary ---- */}
      {data.obstructions.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
          <p className="text-xs font-semibold text-orange-700 mb-1">
            Obstruction Summary
          </p>
          <ul className="space-y-0.5">
            {data.obstructions.map((ob) => (
              <li key={ob.id} className="text-xs text-orange-600">
                {ob.type.replace(/_/g, ' ')} - {ob.location}
                {ob.notes ? `: ${ob.notes}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}