// ============================================================================
// v47.437 - Survey V2: Step 2 - Roof & Mounting Conditions
//
// Captures roof material, pitch, rafter spacing, condition, age,
// attic access, and mounting notes.
//
// All fields map directly to CAD engine inputs for panel layout and
// mounting hardware selection.
//
// Pure ASCII, no Unicode.
// ============================================================================

import React, { useMemo } from 'react';
import type { SurveyRoofConditions, SurveySiteOverview } from '../../lib/survey/v2/types';
import { StepCard, StepField, StepInput, StepTextArea, StepToggle } from './ui/StepCard';
import {
  ChipGroup,
  ROOF_MATERIAL_OPTIONS,
  ROOF_PITCH_OPTIONS,
  RAFTER_SPACING_OPTIONS,
  ROOF_CONDITION_OPTIONS,
} from './ui/ChipGroup';
import { ConfidenceBadge } from '@/components/recommend/ConfidenceBadge';
import { computeTilt } from '@/lib/survey/prefillComputations';

interface StepRoofProps {
  data: SurveyRoofConditions;
  onChange: (data: SurveyRoofConditions) => void;
  disabled?: boolean;
  /** Site overview for latitude-based tilt fallback */
  siteOverview?: SurveySiteOverview;
}

export function StepRoof({ data, onChange, disabled, siteOverview }: StepRoofProps) {
  function set<K extends keyof SurveyRoofConditions>(
    key: K,
    value: SurveyRoofConditions[K],
  ) {
    onChange({ ...data, [key]: value });
  }

  // G1: Compute tilt prefill from roof pitch + latitude fallback
  const tiltPrefill = useMemo(() => {
    return computeTilt({
      roofPitch: data.roofPitch || undefined,
      lat: siteOverview?.latitude ?? undefined,
    });
  }, [data.roofPitch, siteOverview?.latitude]);

  return (
    <div className="space-y-4">
      {/* ---- Material ---- */}
      <StepCard
        title="Roof Material"
        subtitle="Select the primary roof material for the install area"
      >
        <StepField label="Material Type" required>
          <ChipGroup
            options={ROOF_MATERIAL_OPTIONS}
            value={data.roofMaterial}
            onChange={(v) =>
              set('roofMaterial', v as SurveyRoofConditions['roofMaterial'])
            }
            columns={3}
            disabled={disabled}
          />
        </StepField>
      </StepCard>

      {/* ---- Pitch + Rafter ---- */}
      <StepCard
        title="Roof Pitch & Framing"
        subtitle="Pitch determines panel angle; framing determines mounting hardware"
      >
        <StepField
          label="Roof Pitch"
          required
          hint="Estimate if unknown — steeper pitch needs more mounting hardware"
        >
          <ChipGroup
            options={ROOF_PITCH_OPTIONS}
            value={data.roofPitch}
            onChange={(v) =>
              set('roofPitch', v as SurveyRoofConditions['roofPitch'])
            }
            columns={3}
            disabled={disabled}
          />
          {/* G1: Tilt angle prefill from roof pitch + latitude fallback */}
          {tiltPrefill && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
              <span>Computed tilt:</span>
              <span className="font-semibold text-slate-700">{tiltPrefill.tilt}deg</span>
              <ConfidenceBadge
                confidence={tiltPrefill.confidence}
                source={tiltPrefill.source}
                size="xs"
              />
              <span className="text-slate-400">-- {tiltPrefill.derivation}</span>
            </div>
          )}
        </StepField>

        <StepField
          label="Rafter Spacing"
          required
          hint={'Standard is 24" apart for most residential roofs'}
        >
          <ChipGroup
            options={RAFTER_SPACING_OPTIONS}
            value={data.rafterSpacing}
            onChange={(v) =>
              set('rafterSpacing', v as SurveyRoofConditions['rafterSpacing'])
            }
            columns={3}
            disabled={disabled}
          />
        </StepField>
      </StepCard>

      {/* ---- Condition ---- */}
      <StepCard
        title="Roof Condition"
        subtitle="Condition affects permitting and installation risk"
      >
        <StepField label="Overall Condition" required>
          <ChipGroup
            options={ROOF_CONDITION_OPTIONS}
            value={data.roofCondition}
            onChange={(v) =>
              set('roofCondition', v as SurveyRoofConditions['roofCondition'])
            }
            columns={3}
            disabled={disabled}
          />
        </StepField>

        <StepField
          label="Estimated Roof Age (years)"
          hint="Leave blank if unknown"
        >
          <StepInput
            value={data.roofAgeYears != null ? String(data.roofAgeYears) : ''}
            onChange={(v) => {
              const n = parseInt(v, 10);
              set('roofAgeYears', isNaN(n) ? null : n);
            }}
            placeholder="e.g. 8"
            type="number"
            disabled={disabled}
          />
        </StepField>

        {/* Condition warning for poor roofs */}
        {data.roofCondition === 'poor' && (
          <div className="mt-1 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <p className="text-xs font-semibold text-red-700">
              Flagged: Poor condition
            </p>
            <p className="text-xs text-red-500 mt-0.5">
              Customer may need a re-roof before installation.
              Note details in Mounting Notes below.
            </p>
          </div>
        )}
      </StepCard>

      {/* ---- Attic Access ---- */}
      <StepCard
        title="Attic Access"
        subtitle="Required for wire runs and rafter verification on some jobs"
      >
        <StepField
          label="Attic access available?"
          hint="Will the installer be able to access the attic?"
        >
          <StepToggle
            value={data.atticAccess}
            onChange={(v) => set('atticAccess', v)}
            labelYes="Yes - accessible"
            labelNo="No - not accessible"
            disabled={disabled}
          />
        </StepField>
      </StepCard>

      {/* ---- Notes ---- */}
      <StepCard title="Mounting Notes">
        <StepField
          label="Notes"
          hint="Unusual materials, damaged areas, special considerations for the CAD team"
        >
          <StepTextArea
            value={data.mountingNotes}
            onChange={(v) => set('mountingNotes', v)}
            placeholder="e.g. Section of south face has soft spots, ridge cap needs replacement..."
            rows={4}
            disabled={disabled}
          />
        </StepField>
      </StepCard>
    </div>
  );
}