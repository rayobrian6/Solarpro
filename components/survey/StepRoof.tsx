// ============================================================================
// v47.438 - Survey V2: Step 2 - Roof & Mounting Conditions
//
// Captures roof material, pitch, rafter spacing, condition, age,
// attic access, and mounting notes.
//
// All fields map directly to CAD engine inputs for panel layout and
// mounting hardware selection.
//
// Phase 4A/4C: Satellite roof material + pitch detection pre-fill.
// When lat/lng are available, satellite analysis suggests roof material
// and pitch with ConfidenceBadge. User can accept or override.
//
// Pure ASCII, no Unicode.
// ============================================================================

import React, { useMemo } from 'react';
import type { SurveyRoofConditions, SurveySiteOverview, SurveyPhoto } from '../../lib/survey/v2/types';
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
import { useSatelliteAnalysis } from '@/hooks/useSatelliteAnalysis';
import { usePhotoExtraction } from '@/hooks/usePhotoExtraction';
import { mapConfidence } from '@/lib/satellite/types';

interface StepRoofProps {
  data: SurveyRoofConditions;
  onChange: (data: SurveyRoofConditions) => void;
  disabled?: boolean;
  /** Site overview for latitude-based tilt fallback + satellite analysis */
  siteOverview?: SurveySiteOverview;
  /** Uploaded photos for photo-based extraction */
  photos?: SurveyPhoto[];
}

export function StepRoof({ data, onChange, disabled, siteOverview, photos = [] }: StepRoofProps) {
  function set<K extends keyof SurveyRoofConditions>(
    key: K,
    value: SurveyRoofConditions[K],
  ) {
    onChange({ ...data, [key]: value });
  }

  // Phase 4A/4C: Satellite roof analysis
  const {
    result: satelliteResult,
    loading: satelliteLoading,
  } = useSatelliteAnalysis({
    latitude: siteOverview?.latitude ?? null,
    longitude: siteOverview?.longitude ?? null,
    structureType: siteOverview?.structureType || undefined,
    enabled: !disabled,
  });

  // G1: Compute tilt prefill from roof pitch + latitude fallback
  const tiltPrefill = useMemo(() => {
    return computeTilt({
      roofPitch: data.roofPitch || undefined,
      lat: siteOverview?.latitude ?? undefined,
    });
  }, [data.roofPitch, siteOverview?.latitude]);

  // Phase 4C: Satellite material suggestion
  const satelliteMaterial = satelliteResult?.roof?.material ?? null;
  const satellitePitch = satelliteResult?.roof?.pitch ?? null;

  // Whether satellite suggestion matches current selection
  const materialMatchesSatellite = satelliteMaterial != null &&
    data.roofMaterial === satelliteMaterial.material;
  const pitchMatchesSatellite = satellitePitch != null &&
    data.roofPitch === satellitePitch.pitch;

  // Phase 4C: Auto-apply satellite material if no user selection yet
  React.useEffect(() => {
    if (satelliteMaterial && !data.roofMaterial && !disabled) {
      set('roofMaterial', satelliteMaterial.material);
    }
    // Only run as satellite result first arrives and material is empty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satelliteMaterial?.material]);

  React.useEffect(() => {
    if (satellitePitch && !data.roofPitch && !disabled) {
      set('roofPitch', satellitePitch.pitch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satellitePitch?.pitch]);

  // Phase 4E: Photo extraction for roof condition
  const {
    result: photoResult,
    loading: photoLoading,
  } = usePhotoExtraction({
    photos,
    structureType: siteOverview?.structureType || undefined,
    latitude: siteOverview?.latitude ?? null,
    longitude: siteOverview?.longitude ?? null,
    roofAgeYears: data.roofAgeYears,
    roofMaterial: data.roofMaterial || undefined,
    enabled: !disabled,
  });

  const photoRoofCondition = photoResult?.roofCondition ?? null;

  // Phase 4E: Auto-apply photo-extracted roof condition if no user selection yet
  React.useEffect(() => {
    if (photoRoofCondition && !data.roofCondition && !disabled) {
      set('roofCondition', photoRoofCondition.condition);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoRoofCondition?.condition]);

  return (
    <div className="space-y-4">
      {/* ---- Satellite + Photo detection banner ---- */}
      {(satelliteLoading || photoLoading) && (
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-medium text-cyan-700">
              {satelliteLoading && photoLoading
                ? 'Analyzing satellite imagery and roof photos...'
                : satelliteLoading
                  ? 'Analyzing satellite imagery for roof conditions...'
                  : 'Analyzing roof photos for condition assessment...'}
            </p>
          </div>
        </div>
      )}

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
          {/* Phase 4C: Satellite material suggestion */}
          {satelliteMaterial && !satelliteLoading && (
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              {materialMatchesSatellite ? (
                <>
                  <span className="text-cyan-600">Detected from satellite:</span>
                  <span className="font-semibold text-cyan-800">
                    {ROOF_MATERIAL_OPTIONS.find(o => o.value === satelliteMaterial.material)?.label ?? satelliteMaterial.material}
                  </span>
                  <ConfidenceBadge
                    confidence={mapConfidence(satelliteMaterial.confidence)}
                    source="satellite"
                    detail={satelliteMaterial.derivation}
                    size="xs"
                  />
                </>
              ) : (
                <>
                  <span className="text-slate-400">Satellite suggested:</span>
                  <span className="text-slate-500 line-through">
                    {ROOF_MATERIAL_OPTIONS.find(o => o.value === satelliteMaterial.material)?.label ?? satelliteMaterial.material}
                  </span>
                  <ConfidenceBadge
                    confidence={mapConfidence(satelliteMaterial.confidence)}
                    source="satellite"
                    detail={satelliteMaterial.derivation}
                    size="xs"
                    overridden={!materialMatchesSatellite && !!data.roofMaterial}
                  />
                </>
              )}
            </div>
          )}
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
          hint="Estimate if unknown -- steeper pitch needs more mounting hardware"
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
          {/* Phase 4C: Satellite pitch suggestion */}
          {satellitePitch && !satelliteLoading && (
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              {pitchMatchesSatellite ? (
                <>
                  <span className="text-cyan-600">Detected from satellite:</span>
                  <span className="font-semibold text-cyan-800">
                    {ROOF_PITCH_OPTIONS.find(o => o.value === satellitePitch.pitch)?.label ?? satellitePitch.pitch}
                  </span>
                  <ConfidenceBadge
                    confidence={mapConfidence(satellitePitch.confidence)}
                    source="satellite"
                    detail={satellitePitch.derivation}
                    size="xs"
                  />
                </>
              ) : (
                <>
                  <span className="text-slate-400">Satellite suggested:</span>
                  <span className="text-slate-500 line-through">
                    {ROOF_PITCH_OPTIONS.find(o => o.value === satellitePitch.pitch)?.label ?? satellitePitch.pitch}
                  </span>
                  <ConfidenceBadge
                    confidence={mapConfidence(satellitePitch.confidence)}
                    source="satellite"
                    detail={satellitePitch.derivation}
                    size="xs"
                    overridden={!pitchMatchesSatellite && !!data.roofPitch}
                  />
                </>
              )}
            </div>
          )}
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
          {/* Phase 4E: Photo-extracted roof condition suggestion */}
          {photoRoofCondition && !photoLoading && (
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              {data.roofCondition === photoRoofCondition.condition ? (
                <>
                  <span className="text-cyan-600">Detected from roof photo:</span>
                  <span className="font-semibold text-cyan-800">
                    {ROOF_CONDITION_OPTIONS.find(o => o.value === photoRoofCondition.condition)?.label ?? photoRoofCondition.condition}
                  </span>
                  <ConfidenceBadge
                    confidence={mapConfidence(photoRoofCondition.confidence)}
                    source="satellite"
                    detail={photoRoofCondition.derivation}
                    size="xs"
                  />
                </>
              ) : (
                <>
                  <span className="text-slate-400">Photo suggested:</span>
                  <span className="text-slate-500 line-through">
                    {ROOF_CONDITION_OPTIONS.find(o => o.value === photoRoofCondition.condition)?.label ?? photoRoofCondition.condition}
                  </span>
                  <ConfidenceBadge
                    confidence={mapConfidence(photoRoofCondition.confidence)}
                    source="satellite"
                    detail={photoRoofCondition.derivation}
                    size="xs"
                    overridden={data.roofCondition !== photoRoofCondition.condition && !!data.roofCondition}
                  />
                </>
              )}
            </div>
          )}
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