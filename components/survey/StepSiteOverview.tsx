// ============================================================================
// v47.437 - Survey V2: Step 1 - Site Overview
//
// Captures project name, site address, GPS coords, structure type,
// stories count, inspector name, and access notes.
//
// Pre-filled from JWT claims via buildInitialDraft().
// Pure ASCII, no Unicode.
// ============================================================================

import React from 'react';
import type { SurveySiteOverview } from '../../lib/survey/v2/types';
import { StepCard, StepField, StepInput, StepTextArea } from './ui/StepCard';
import {
  ChipGroup,
  STRUCTURE_TYPE_OPTIONS,
  STORIES_OPTIONS,
} from './ui/ChipGroup';

interface StepSiteOverviewProps {
  data: SurveySiteOverview;
  onChange: (data: SurveySiteOverview) => void;
  disabled?: boolean;
}

export function StepSiteOverview({ data, onChange, disabled }: StepSiteOverviewProps) {
  function set<K extends keyof SurveySiteOverview>(
    key: K,
    value: SurveySiteOverview[K],
  ) {
    onChange({ ...data, [key]: value });
  }

  return (
    <div className="space-y-4">
      {/* ---- Project Info ---- */}
      <StepCard title="Project Info">
        <StepField label="Project Name" required>
          <StepInput
            value={data.projectName}
            onChange={(v) => set('projectName', v)}
            placeholder="e.g. Smith Residence"
            disabled={disabled}
          />
        </StepField>

        <StepField
          label="Site Address"
          required
          hint="Street address where the survey is being conducted"
        >
          <StepInput
            value={data.siteAddress}
            onChange={(v) => set('siteAddress', v)}
            placeholder="123 Main St, City, ST 00000"
            disabled={disabled}
          />
        </StepField>
      </StepCard>

      {/* ---- Structure ---- */}
      <StepCard title="Structure">
        <StepField label="Structure Type" required>
          <ChipGroup
            options={STRUCTURE_TYPE_OPTIONS}
            value={data.structureType}
            onChange={(v) =>
              set('structureType', v as SurveySiteOverview['structureType'])
            }
            columns={3}
            disabled={disabled}
          />
        </StepField>

        <StepField label="Number of Stories" required>
          <ChipGroup
            options={STORIES_OPTIONS}
            value={data.stories}
            onChange={(v) => set('stories', v as SurveySiteOverview['stories'])}
            columns={3}
            disabled={disabled}
          />
        </StepField>
      </StepCard>

      {/* ---- GPS (read-only if pre-filled) ---- */}
      <StepCard
        title="GPS Coordinates"
        subtitle="Pre-filled from handoff token when available"
      >
        <div className="grid grid-cols-2 gap-3">
          <StepField label="Latitude">
            <StepInput
              value={data.latitude != null ? String(data.latitude) : ''}
              onChange={(v) => {
                const n = parseFloat(v);
                set('latitude', isNaN(n) ? null : n);
              }}
              placeholder="e.g. 34.0522"
              type="number"
              disabled={disabled}
            />
          </StepField>
          <StepField label="Longitude">
            <StepInput
              value={data.longitude != null ? String(data.longitude) : ''}
              onChange={(v) => {
                const n = parseFloat(v);
                set('longitude', isNaN(n) ? null : n);
              }}
              placeholder="e.g. -118.2437"
              type="number"
              disabled={disabled}
            />
          </StepField>
        </div>

        {/* GPS status indicator */}
        {data.latitude != null && data.longitude != null ? (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            <span className="text-xs text-green-600 font-medium">
              GPS locked ({data.latitude.toFixed(4)}, {data.longitude.toFixed(4)})
            </span>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
            <span className="text-xs text-gray-400">No GPS - enter manually if needed</span>
          </div>
        )}
      </StepCard>

      {/* ---- Inspector + Notes ---- */}
      <StepCard title="Inspector">
        <StepField label="Inspector Name" required>
          <StepInput
            value={data.inspectorName}
            onChange={(v) => set('inspectorName', v)}
            placeholder="Your name"
            disabled={disabled}
          />
        </StepField>

        <StepField
          label="Access Notes"
          hint="Gate codes, dogs, parking instructions, etc."
        >
          <StepTextArea
            value={data.accessNotes}
            onChange={(v) => set('accessNotes', v)}
            placeholder="e.g. Gate code #1234, beware of dog in backyard"
            rows={3}
            disabled={disabled}
          />
        </StepField>
      </StepCard>
    </div>
  );
}