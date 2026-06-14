// ============================================================================
// v47.437 - Survey V2: Step 3 - Electrical Service
//
// Captures main panel brand, rating, available breaker slots, meter socket
// type, interconnection point, service entrance type, sub-panel info,
// and electrical notes.
//
// All fields map to electrical sizing engine inputs for:
//   - Interconnection breaker sizing (120% rule)
//   - Load calculations and permit plan sets
//   - Sub-panel and supply-side tap assessments
//
// Pure ASCII, no Unicode.
// ============================================================================

import React, { useMemo } from 'react';
import type { SurveyElectricalService, SurveySiteOverview } from '../../lib/survey/v2/types';
import { StepCard, StepField, StepTextArea, StepToggle } from './ui/StepCard';
import {
  ChipGroup,
  PANEL_RATING_OPTIONS,
  PANEL_BRAND_OPTIONS,
  BREAKER_SLOT_OPTIONS,
  METER_SOCKET_OPTIONS,
  INTERCONNECTION_OPTIONS,
  SERVICE_ENTRANCE_OPTIONS,
} from './ui/ChipGroup';
import { ConfidenceBadge } from '@/components/recommend/ConfidenceBadge';
import { RecommendationCard, type RecommendationValue } from '@/components/recommend/RecommendationCard';
import { computeDefaultPanelRating, computeInterconnection } from '@/lib/survey/prefillComputations';

interface StepElectricalProps {
  data: SurveyElectricalService;
  onChange: (data: SurveyElectricalService) => void;
  disabled?: boolean;
  /** Site overview for structure type (residential vs commercial) */
  siteOverview?: SurveySiteOverview;
}

export function StepElectrical({ data, onChange, disabled, siteOverview }: StepElectricalProps) {
  function set<K extends keyof SurveyElectricalService>(
    key: K,
    value: SurveyElectricalService[K],
  ) {
    onChange({ ...data, [key]: value });
  }

  // G2: Default panel rating suggestion based on structure type
  const panelRatingPrefill = useMemo(() => {
    const systemType = siteOverview?.structureType || undefined;
    return computeDefaultPanelRating(systemType);
  }, [siteOverview?.structureType]);

  // G3: Interconnection point auto-computation from NEC 705.12
  const interconnectionPrefill = useMemo(() => {
    // Parse panel rating to numeric bus rating
    const ratingStr = data.panelRating as string;
    const busRating = ratingStr && ratingStr !== 'other' && ratingStr !== ''
      ? parseInt(ratingStr, 10)
      : undefined;
    // Main breaker is typically same as panel rating for residential
    const mainBreaker = busRating;
    // Parse available slots
    let availableSlots: number | undefined;
    if (data.availableBreakerSlots === '0') availableSlots = 0;
    else if (data.availableBreakerSlots === '1-2') availableSlots = 2;
    else if (data.availableBreakerSlots === '3-4') availableSlots = 4;
    else if (data.availableBreakerSlots === '5+') availableSlots = 6;

    return computeInterconnection({ busRating, mainBreaker, availableSlots });
  }, [data.panelRating, data.availableBreakerSlots]);

  // Map InterconnectionMethod to survey InterconnectionPoint chip value
  const necToSurveyMap: Record<string, string> = {
    'LOAD_SIDE': 'load_side',
    'SUPPLY_SIDE_TAP': 'supply_side',
    'MAIN_BREAKER_DERATE': 'main_panel',
    'PANEL_UPGRADE': 'main_panel',
  };

  // Build RecommendationValue for interconnection
  const interconnectionRecommendation: RecommendationValue | null = useMemo(() => {
    if (!interconnectionPrefill) return null;
    return {
      display: interconnectionPrefill.methodLabel,
      raw: necToSurveyMap[interconnectionPrefill.method] || interconnectionPrefill.method,
      confidence: interconnectionPrefill.confidence,
      source: interconnectionPrefill.source,
      unit: interconnectionPrefill.necReference,
    };
  }, [interconnectionPrefill]);

  // Flag dangerous panels
  const isDangerousPanel =
    data.panelBrand === 'federal_pacific' || data.panelBrand === 'zinsco';

  // 120% rule check: flag if panel is 100A with no slots
  const needsUpgradeFlag =
    data.panelRating === '100' && data.availableBreakerSlots === '0';

  return (
    <div className="space-y-4">
      {/* ---- Main Panel ---- */}
      <StepCard
        title="Main Panel"
        subtitle="Identify the main electrical service panel for solar connection"
      >
        <StepField label="Panel Brand" required>
          <ChipGroup
            options={PANEL_BRAND_OPTIONS}
            value={data.panelBrand}
            onChange={(v) =>
              set('panelBrand', v as SurveyElectricalService['panelBrand'])
            }
            columns={3}
            disabled={disabled}
          />
        </StepField>

        {/* Dangerous panel warning — actionable guidance */}
        {isDangerousPanel && (
          <div className="mt-1 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <p className="text-xs font-semibold text-red-700">
              Known hazard panel — must be replaced before solar
            </p>
            <p className="text-xs text-red-500 mt-0.5">
              {data.panelBrand === 'federal_pacific'
                ? 'Federal Pacific (Stab-Lok) panels have documented fire hazard failures and fail to trip breakers properly.'
                : 'Zinsco panels have documented fire hazard failures and aluminum bus bars that corrode and overheat.'}
              {' '}This panel must be replaced before solar can be installed. Homes built before 1990: check for Federal Pacific or Zinsco label on your panel. Discuss replacement with the customer.
            </p>
          </div>
        )}

        <StepField
          label="Panel Rating (Amps)"
          required
          hint="Estimated from building age — confirm at the panel"
        >
          <ChipGroup
            options={PANEL_RATING_OPTIONS}
            value={data.panelRating}
            onChange={(v) =>
              set('panelRating', v as SurveyElectricalService['panelRating'])
            }
            columns={4}
            disabled={disabled}
          />
          {/* G2: Default panel rating suggestion from ecosystem */}
          {!data.panelRating && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
              <span>Estimated:</span>
              <span className="font-semibold text-slate-700">{panelRatingPrefill.rating}A</span>
              <ConfidenceBadge
                confidence={panelRatingPrefill.confidence}
                source={panelRatingPrefill.source}
                size="xs"
              />
              <span className="text-slate-400">-- {panelRatingPrefill.derivation}</span>
            </div>
          )}
        </StepField>

        <StepField
          label="Available Breaker Slots"
          required
          hint="Count empty slots in the panel for the solar breaker"
        >
          <ChipGroup
            options={BREAKER_SLOT_OPTIONS}
            value={data.availableBreakerSlots}
            onChange={(v) =>
              set(
                'availableBreakerSlots',
                v as SurveyElectricalService['availableBreakerSlots'],
              )
            }
            columns={4}
            disabled={disabled}
          />
        </StepField>

        {/* 120% rule warning — plain language */}
        {needsUpgradeFlag && (
          <div className="mt-1 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
            <p className="text-xs font-semibold text-orange-700">
              Panel may need upgrade for solar
            </p>
            <p className="text-xs text-orange-500 mt-0.5">
              A 100A panel with no open breaker slots may not have enough room for the solar breaker
              under the 120% safety rule. Options include a load-side tap, supply-side connection,
              or upgrading to a 200A panel. Confirm with engineering.
            </p>
          </div>
        )}
      </StepCard>

      {/* ---- Meter + Service ---- */}
      <StepCard
        title="Meter & Service Entrance"
        subtitle="Used for utility interconnection and permit plan set"
      >
        <StepField label="Meter Socket Type" required>
          <ChipGroup
            options={METER_SOCKET_OPTIONS}
            value={data.meterSocketType}
            onChange={(v) =>
              set(
                'meterSocketType',
                v as SurveyElectricalService['meterSocketType'],
              )
            }
            columns={4}
            disabled={disabled}
          />
        </StepField>

        <StepField label="Service Entrance" required>
          <ChipGroup
            options={SERVICE_ENTRANCE_OPTIONS}
            value={data.serviceEntrance}
            onChange={(v) =>
              set(
                'serviceEntrance',
                v as SurveyElectricalService['serviceEntrance'],
              )
            }
            columns={2}
            disabled={disabled}
          />
        </StepField>

        <StepField label="Planned Interconnection Point" required>
          <ChipGroup
            options={INTERCONNECTION_OPTIONS}
            value={data.interconnectionPoint}
            onChange={(v) =>
              set(
                'interconnectionPoint',
                v as SurveyElectricalService['interconnectionPoint'],
              )
            }
            columns={2}
            disabled={disabled}
          />
          {/* G3: NEC 705.12 interconnection auto-computation recommendation */}
          {interconnectionRecommendation && (
            <div className="mt-2">
              <RecommendationCard
                title="NEC 705.12 Recommendation"
                currentDisplay={data.interconnectionPoint
                  ? INTERCONNECTION_OPTIONS.find(o => o.value === data.interconnectionPoint)?.label || data.interconnectionPoint
                  : 'Not selected'}
                currentRaw={data.interconnectionPoint || ''}
                recommended={interconnectionRecommendation}
                reason={`Based on your panel data, ${interconnectionPrefill.methodLabel} is the recommended connection method per electrical code (NEC 705.12)`}
                onApply={() => {
                  const mapped = necToSurveyMap[interconnectionPrefill.method];
                  if (mapped) {
                    set('interconnectionPoint', mapped as SurveyElectricalService['interconnectionPoint']);
                  }
                }}
                onDismiss={() => {}}
                derivation={interconnectionPrefill.derivation}
                necReference={interconnectionPrefill.necReference}
                variant="inline"
              />
            </div>
          )}
        </StepField>
      </StepCard>

      {/* ---- Sub Panel ---- */}
      <StepCard title="Sub Panel">
        <StepField label="Is there a sub panel on site?">
          <StepToggle
            value={data.hasSubPanel}
            onChange={(v) => set('hasSubPanel', v)}
            labelYes="Yes"
            labelNo="No"
            disabled={disabled}
          />
        </StepField>

        {data.hasSubPanel === true && (
          <StepField
            label="Sub Panel Rating (Amps)"
            hint="Select the sub panel amperage if interconnection may use it"
          >
            <ChipGroup
              options={PANEL_RATING_OPTIONS}
              value={data.subPanelRating}
              onChange={(v) =>
                set(
                  'subPanelRating',
                  v as SurveyElectricalService['subPanelRating'],
                )
              }
              columns={4}
              disabled={disabled}
            />
          </StepField>
        )}
      </StepCard>

      {/* ---- Notes ---- */}
      <StepCard title="Electrical Notes">
        <StepField
          label="Notes"
          hint="Any unusual wiring, meter issues, utility concerns, or special conditions"
        >
          <StepTextArea
            value={data.electricalNotes}
            onChange={(v) => set('electricalNotes', v)}
            placeholder="e.g. Panel is in a detached garage, utility meter on north wall, customer wants EV charger added..."
            rows={4}
            disabled={disabled}
          />
        </StepField>
      </StepCard>
    </div>
  );
}