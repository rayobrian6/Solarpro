// ============================================================================
// v47.438 - Survey V2: Step 4 - Obstructions & Layout Constraints
//
// Uses ObstructionMap for the interactive roof diagram + obstruction logger.
// Also captures setback notes and estimated usable roof percentage.
//
// Phase 4A: Satellite obstruction detection pre-fill.
// When lat/lng are available, the satellite analysis API is called
// and detected obstructions are shown with ConfidenceBadge.
// The user can accept (keep) or dismiss each detected obstruction.
//
// Phase 4B: Usable roof area computed from obstructions + geometry.
// ComputedField shows the satellite-computed usable area with
// confidence badge and derivation.
//
// Maps to CAD engine: obstruction coordinates, setback compliance,
// usable array area calculation.
//
// Pure ASCII, no Unicode.
// ============================================================================

import React, { useMemo, useCallback, useEffect } from 'react';
import type { SurveyObstructions, SurveySiteOverview, Obstruction } from '../../lib/survey/v2/types';
import type { DetectedObstruction } from '../../lib/satellite/types';
import { detectedToSurveyObstruction, mapConfidence } from '../../lib/satellite/types';
import { computeUsableRoofArea } from '../../lib/satellite/areaComputer';
import { StepCard, StepField, StepTextArea } from './ui/StepCard';
import { ObstructionMap } from './ui/ObstructionMap';
import { ConfidenceBadge } from '@/components/recommend/ConfidenceBadge';
import { ComputedField } from '@/components/recommend/ComputedField';
import { useSatelliteAnalysis } from '@/hooks/useSatelliteAnalysis';

// ---- Satellite obstruction chip (accept/dismiss) ----
interface SatelliteObstructionChipProps {
  detected: DetectedObstruction;
  onAccept: (obstruction: Obstruction) => void;
  onDismiss: () => void;
  /** Whether this obstruction is already accepted into the survey data */
  alreadyAccepted: boolean;
}

function SatelliteObstructionChip({
  detected,
  onAccept,
  onDismiss,
  alreadyAccepted,
}: SatelliteObstructionChipProps) {
  const typeLabel = detected.type.replace(/_/g, ' ');
  const locationLabel = detected.location.charAt(0).toUpperCase() + detected.location.slice(1);

  if (alreadyAccepted) {
    // Show as accepted -- part of the obstruction list
    return null;
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-cyan-800">
            {typeLabel}
          </span>
          <span className="text-[10px] text-cyan-600 bg-cyan-100 px-1.5 py-0.5 rounded-full">
            {locationLabel}
          </span>
          <ConfidenceBadge
            confidence={mapConfidence(detected.confidence)}
            source="satellite"
            detail={detected.derivation}
            size="xs"
          />
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onAccept(detectedToSurveyObstruction(detected))}
          className="px-2 py-1 text-[10px] font-semibold text-white bg-cyan-500 rounded
            hover:bg-cyan-600 transition-colors"
          title="Accept this detected obstruction"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-2 py-1 text-[10px] font-semibold text-gray-500 bg-gray-100 rounded
            hover:bg-gray-200 transition-colors"
          title="Dismiss this detected obstruction"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

// ---- Main StepObstructions component ----
interface StepObstructionsProps {
  data: SurveyObstructions;
  onChange: (data: SurveyObstructions) => void;
  disabled?: boolean;
  /** Site overview for latitude-based satellite analysis */
  siteOverview?: SurveySiteOverview;
}

export function StepObstructions({ data, onChange, disabled, siteOverview }: StepObstructionsProps) {
  // Phase 4A: Satellite obstruction detection
  const {
    result: satelliteResult,
    loading: satelliteLoading,
  } = useSatelliteAnalysis({
    latitude: siteOverview?.latitude ?? null,
    longitude: siteOverview?.longitude ?? null,
    structureType: siteOverview?.structureType || undefined,
    enabled: !disabled,
  });

  // Track which satellite obstructions have been dismissed
  const [dismissedIds, setDismissedIds] = React.useState<Set<string>>(new Set());

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

  // Phase 4A: Accept a satellite-detected obstruction
  const handleAcceptObstruction = useCallback(
    (obstruction: Obstruction) => {
      // Avoid duplicate type+location
      const exists = data.obstructions.some(
        (o) => o.type === obstruction.type && o.location === obstruction.location,
      );
      if (!exists) {
        onChange({ ...data, obstructions: [...data.obstructions, obstruction] });
      }
    },
    [data, onChange],
  );

  // Phase 4A: Dismiss a satellite-detected obstruction
  const handleDismissObstruction = useCallback(
    (detected: DetectedObstruction) => {
      const dismissKey = `${detected.type}:${detected.location}`;
      setDismissedIds((prev) => {
        const next = new Set(prev);
        next.add(dismissKey);
        return next;
      });
    },
    [],
  );

  // Phase 4A: Filter satellite obstructions to show only unaccepted + undismissed
  const pendingSatelliteObstructions = useMemo(() => {
    if (!satelliteResult?.obstructions?.obstructions) return [];
    return satelliteResult.obstructions.obstructions.filter((detected) => {
      const dismissKey = `${detected.type}:${detected.location}`;
      if (dismissedIds.has(dismissKey)) return false;
      // Check if already in survey data
      const alreadyAccepted = data.obstructions.some(
        (o) => o.type === detected.type && o.location === detected.location,
      );
      return !alreadyAccepted;
    });
  }, [satelliteResult?.obstructions?.obstructions, data.obstructions, dismissedIds]);

  // Phase 4B: Compute usable roof area from obstructions
  const usableAreaResult = useMemo(() => {
    return computeUsableRoofArea({
      obstructions: data.obstructions,
      structureType: siteOverview?.structureType || undefined,
      obstructionsSource: data.obstructions.some((o) => o.id.startsWith('sat_'))
        ? 'satellite'
        : 'survey',
    });
  }, [data.obstructions, siteOverview?.structureType]);

  // Phase 4B: Determine if satellite has a usable area suggestion
  const satelliteAreaComputed = useMemo(() => {
    if (!satelliteResult?.obstructions) return null;
    const sat = satelliteResult.obstructions;
    if (sat.usableAreaPct != null) {
      return {
        value: sat.usableAreaPct,
        confidence: sat.areaConfidence,
        source: sat.areaSource === 'satellite' ? 'satellite' as const : 'local_calc' as const,
        derivation: sat.areaDerivation,
      };
    }
    return null;
  }, [satelliteResult?.obstructions]);

  // Determine the computed value for ComputedField
  const areaComputed = useMemo(() => {
    // Priority: satellite suggestion > local calc > null
    if (satelliteAreaComputed) {
      return {
        value: satelliteAreaComputed.value,
        confidence: satelliteAreaComputed.confidence,
        source: satelliteAreaComputed.source,
        derivation: satelliteAreaComputed.derivation,
        unit: '%',
      };
    }
    // Local computation from current obstructions
    return {
      value: usableAreaResult.usablePct,
      confidence: usableAreaResult.confidence,
      source: usableAreaResult.source,
      derivation: usableAreaResult.derivation,
      unit: '%',
    };
  }, [satelliteAreaComputed, usableAreaResult]);

  // Auto-apply the computed/satellite usable-area estimate into the draft once,
  // so the value the UI shows ("auto-applied unless you override") actually gets
  // persisted. Without this, leaving step 4 untouched submitted
  // estimatedUsableRoofPct: null even though a percentage was displayed.
  // Mirrors the satellite auto-apply pattern in StepRoof/StepElectrical.
  useEffect(() => {
    if (disabled) return;
    if (data.estimatedUsableRoofPct != null) return;
    if (areaComputed.value == null) return;
    set('estimatedUsableRoofPct', Math.min(100, Math.max(0, Math.round(areaComputed.value))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaComputed.value, disabled]);

  // Whether the user has overridden the computed value
  const isAreaOverridden = data.estimatedUsableRoofPct != null &&
    data.estimatedUsableRoofPct !== areaComputed.value;

  return (
    <div className="space-y-4">
      {/* ---- Satellite detection banner ---- */}
      {satelliteLoading ? (
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-medium text-cyan-700">
              Analyzing satellite imagery for roof obstructions...
            </p>
          </div>
        </div>
      ) : null}

      {/* ---- Detected obstructions (accept/dismiss) ---- */}
      {pendingSatelliteObstructions.length > 0 ? (
        <StepCard
          title="Satellite Detection"
          subtitle="Obstructions detected from aerial imagery. Review and accept or dismiss each."
        >
          <div className="space-y-2">
            {pendingSatelliteObstructions.map((detected, i) => (
              <SatelliteObstructionChip
                key={`sat_${detected.type}_${detected.location}_${i}`}
                detected={detected}
                onAccept={handleAcceptObstruction}
                onDismiss={() => handleDismissObstruction(detected)}
                alreadyAccepted={false}
              />
            ))}
            <p className="text-[10px] text-slate-400 italic mt-1">
              Detected obstructions are suggestions. Accept the ones you confirm, dismiss the rest.
            </p>
          </div>
        </StepCard>
      ) : null}

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
        {/* Satellite detection result summary */}
        {satelliteResult?.obstructions && !satelliteLoading ? (
          <div className="mt-2 flex items-center gap-2">
            <ConfidenceBadge
              confidence={
                satelliteResult.obstructions.method === 'heuristic' ? 'low' : 'medium'
              }
              source="satellite"
              detail={`${satelliteResult.obstructions.obstructions.length} detected`}
              size="xs"
            />
            <span className="text-[10px] text-slate-400">
              Method: {satelliteResult.obstructions.method.replace(/_/g, ' ')}
            </span>
          </div>
        ) : null}
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
          <ComputedField
            label="Usable Roof Area"
            computed={areaComputed}
            value={data.estimatedUsableRoofPct ?? areaComputed.value}
            onChange={(v) => {
              const n = parseInt(v, 10);
              if (!isNaN(n)) {
                set('estimatedUsableRoofPct', Math.min(100, Math.max(0, n)));
              }
            }}
            type="number"
            placeholder="--"
            min={0}
            max={100}
            step={5}
            disabled={disabled}
            data-testid="usable-roof-pct"
          />

          {/* Color-coded area label */}
          {data.estimatedUsableRoofPct != null ? (
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
          ) : null}

          {/* Show satellite area estimate when user hasn't set a value yet */}
          {data.estimatedUsableRoofPct == null && satelliteAreaComputed ? (
            <p className="mt-1 text-xs text-cyan-600 italic">
              Satellite estimate: {satelliteAreaComputed.value}% usable.
              Value auto-applied unless you override.
            </p>
          ) : null}
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
      {data.obstructions.length > 0 ? (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
          <p className="text-xs font-semibold text-orange-700 mb-1">
            Obstruction Summary
          </p>
          <ul className="space-y-0.5">
            {data.obstructions.map((ob) => (
              <li key={ob.id} className="text-xs text-orange-600">
                {ob.type.replace(/_/g, ' ')} - {ob.location}
                {ob.notes ? `: ${ob.notes}` : ''}
                {ob.id.startsWith('sat_') ? (
                  <ConfidenceBadge
                    confidence="medium"
                    source="satellite"
                    size="xs"
                    className="ml-1"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
