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

import React from 'react';
import type { SurveyElectricalService } from '../../lib/survey/v2/types';
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

interface StepElectricalProps {
  data: SurveyElectricalService;
  onChange: (data: SurveyElectricalService) => void;
  disabled?: boolean;
}

export function StepElectrical({ data, onChange, disabled }: StepElectricalProps) {
  function set<K extends keyof SurveyElectricalService>(
    key: K,
    value: SurveyElectricalService[K],
  ) {
    onChange({ ...data, [key]: value });
  }

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
        subtitle="Identify the main electrical service panel"
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

        {/* Dangerous panel warning */}
        {isDangerousPanel && (
          <div className="mt-1 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <p className="text-xs font-semibold text-red-700">
              Flagged: Known problematic panel brand
            </p>
            <p className="text-xs text-red-500 mt-0.5">
              {data.panelBrand === 'federal_pacific'
                ? 'Federal Pacific (Stab-Lok) panels have known fire hazard issues.'
                : 'Zinsco panels have known fire hazard issues.'}
              {' '}Panel replacement may be required. Discuss with the customer.
            </p>
          </div>
        )}

        <StepField
          label="Panel Rating (Amps)"
          required
          hint="Locate on the main breaker label inside the panel"
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

        {/* 120% rule warning */}
        {needsUpgradeFlag && (
          <div className="mt-1 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
            <p className="text-xs font-semibold text-orange-700">
              Flagged: May need panel upgrade
            </p>
            <p className="text-xs text-orange-500 mt-0.5">
              100A panel with no available slots - interconnection may require
              a load-side tap, supply-side connection, or panel upgrade.
              Confirm with engineering.
            </p>
          </div>
        )}
      </StepCard>

      {/* ---- Meter + Service ---- */}
      <StepCard
        title="Meter & Service Entrance"
        subtitle="Used for NEM/interconnection permit plan set"
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