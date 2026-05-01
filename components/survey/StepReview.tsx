// ============================================================================
// v47.437 - Survey V2: Step 6 - Review & Submit
//
// Read-only summary of all collected data. Each section has an "Edit" button
// that navigates back to that step. The Submit button is at the bottom of
// SurveyShell - this component only shows the review content.
//
// Pure ASCII, no Unicode.
// ============================================================================

import React from 'react';
import type { SurveyV2Draft } from '../../lib/survey/v2/types';
import { REQUIRED_PHOTO_CATEGORIES } from '../../lib/survey/v2/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface StepReviewProps {
  draft: SurveyV2Draft;
  onEditStep: (step: number) => void;
  submitError?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function labelOrEmpty(val: string | null | undefined, fallback = '-'): string {
  if (!val) return fallback;
  return val.replace(/_/g, ' ');
}

function boolLabel(val: boolean | null): string {
  if (val === true) return 'Yes';
  if (val === false) return 'No';
  return '-';
}

// ---------------------------------------------------------------------------
// ReviewSection - a card with title and optional edit button
// ---------------------------------------------------------------------------
interface ReviewSectionProps {
  title: string;
  step: number;
  onEdit: (step: number) => void;
  children: React.ReactNode;
  hasIssue?: boolean;
}

function ReviewSection({ title, step, onEdit, children, hasIssue }: ReviewSectionProps) {
  return (
    <div
      className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
        hasIssue ? 'border-orange-300' : 'border-gray-200'
      }`}
    >
      <div
        className={`px-4 py-3 border-b flex items-center justify-between ${
          hasIssue ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-100'
        }`}
      >
        <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">
          {title}
        </h3>
        <button
          type="button"
          onClick={() => onEdit(step)}
          className="text-xs font-semibold text-cyan-600 hover:text-cyan-800 transition-colors"
        >
          Edit
        </button>
      </div>
      <div className="px-4 py-4 space-y-2">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewRow - a single field row
// ---------------------------------------------------------------------------
interface ReviewRowProps {
  label: string;
  value: string;
  flag?: 'warn' | 'error' | 'ok';
}

function ReviewRow({ label, value, flag }: ReviewRowProps) {
  let valueClass = 'text-gray-800';
  if (flag === 'warn') valueClass = 'text-orange-600 font-semibold';
  if (flag === 'error') valueClass = 'text-red-600 font-semibold';
  if (flag === 'ok') valueClass = 'text-green-600 font-semibold';

  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-gray-400 min-w-[120px] shrink-0 pt-0.5">{label}</span>
      <span className={`text-xs ${valueClass} flex-1`}>{value || '-'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepReview
// ---------------------------------------------------------------------------
export function StepReview({ draft, onEditStep, submitError }: StepReviewProps) {
  const { siteOverview, roofConditions, electricalService, obstructions, photos } = draft;

  // ---- Photo completeness check ----
  const capturedRequired = REQUIRED_PHOTO_CATEGORIES.filter((cat) =>
    photos.photos.some((p) => p.category === cat),
  );
  const missingRequired = REQUIRED_PHOTO_CATEGORIES.filter(
    (cat) => !photos.photos.some((p) => p.category === cat),
  );
  const photosOk = missingRequired.length === 0;

  // ---- Electrical flags ----
  const isDangerousPanel =
    electricalService.panelBrand === 'federal_pacific' ||
    electricalService.panelBrand === 'zinsco';
  const isRoofPoor = roofConditions.roofCondition === 'poor';

  return (
    <div className="space-y-4">
      {/* ---- Submit error ---- */}
      {submitError && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm font-semibold text-red-700">Submission Failed</p>
          <p className="text-xs text-red-500 mt-0.5">{submitError}</p>
        </div>
      )}

      {/* ---- Flags summary ---- */}
      {(isDangerousPanel || isRoofPoor || !photosOk) && (
        <div className="rounded-xl bg-orange-50 border border-orange-200 px-4 py-3 space-y-1">
          <p className="text-xs font-bold text-orange-700 uppercase tracking-wide">
            Review Flags
          </p>
          {isRoofPoor && (
            <p className="text-xs text-orange-600">
              Roof condition flagged as Poor - re-roof may be needed
            </p>
          )}
          {isDangerousPanel && (
            <p className="text-xs text-orange-600">
              Panel brand ({labelOrEmpty(electricalService.panelBrand)}) has known hazard issues
            </p>
          )}
          {!photosOk && (
            <p className="text-xs text-orange-600">
              Missing required photos: {missingRequired.map((c) => c.replace(/_/g, ' ')).join(', ')}
            </p>
          )}
        </div>
      )}

      {/* ---- Step 1: Site Overview ---- */}
      <ReviewSection title="1. Site Overview" step={1} onEdit={onEditStep}>
        <ReviewRow label="Project Name" value={siteOverview.projectName} />
        <ReviewRow label="Site Address" value={siteOverview.siteAddress} />
        <ReviewRow
          label="Structure"
          value={`${labelOrEmpty(siteOverview.structureType)}, ${siteOverview.stories ? siteOverview.stories + ' stories' : '-'}`}
        />
        <ReviewRow label="Inspector" value={siteOverview.inspectorName} />
        {siteOverview.latitude != null && siteOverview.longitude != null && (
          <ReviewRow
            label="GPS"
            value={`${siteOverview.latitude.toFixed(4)}, ${siteOverview.longitude.toFixed(4)}`}
            flag="ok"
          />
        )}
        {siteOverview.accessNotes && (
          <ReviewRow label="Access Notes" value={siteOverview.accessNotes} />
        )}
      </ReviewSection>

      {/* ---- Step 2: Roof ---- */}
      <ReviewSection
        title="2. Roof & Mounting"
        step={2}
        onEdit={onEditStep}
        hasIssue={isRoofPoor}
      >
        <ReviewRow label="Material" value={labelOrEmpty(roofConditions.roofMaterial)} />
        <ReviewRow label="Pitch" value={labelOrEmpty(roofConditions.roofPitch)} />
        <ReviewRow
          label="Rafter Spacing"
          value={
            roofConditions.rafterSpacing
              ? roofConditions.rafterSpacing + '" OC'
              : '-'
          }
        />
        <ReviewRow
          label="Condition"
          value={labelOrEmpty(roofConditions.roofCondition)}
          flag={
            roofConditions.roofCondition === 'poor'
              ? 'error'
              : roofConditions.roofCondition === 'fair'
              ? 'warn'
              : roofConditions.roofCondition === 'good'
              ? 'ok'
              : undefined
          }
        />
        {roofConditions.roofAgeYears != null && (
          <ReviewRow label="Age" value={`${roofConditions.roofAgeYears} years`} />
        )}
        <ReviewRow label="Attic Access" value={boolLabel(roofConditions.atticAccess)} />
        {roofConditions.mountingNotes && (
          <ReviewRow label="Notes" value={roofConditions.mountingNotes} />
        )}
      </ReviewSection>

      {/* ---- Step 3: Electrical ---- */}
      <ReviewSection
        title="3. Electrical Service"
        step={3}
        onEdit={onEditStep}
        hasIssue={isDangerousPanel}
      >
        <ReviewRow
          label="Panel Brand"
          value={labelOrEmpty(electricalService.panelBrand)}
          flag={isDangerousPanel ? 'error' : undefined}
        />
        <ReviewRow
          label="Panel Rating"
          value={
            electricalService.panelRating
              ? electricalService.panelRating + 'A'
              : '-'
          }
        />
        <ReviewRow
          label="Breaker Slots"
          value={labelOrEmpty(electricalService.availableBreakerSlots)}
          flag={
            electricalService.availableBreakerSlots === '0'
              ? 'warn'
              : electricalService.availableBreakerSlots === '5+'
              ? 'ok'
              : undefined
          }
        />
        <ReviewRow
          label="Meter Socket"
          value={labelOrEmpty(electricalService.meterSocketType)}
        />
        <ReviewRow
          label="Service Entrance"
          value={labelOrEmpty(electricalService.serviceEntrance)}
        />
        <ReviewRow
          label="Interconnection"
          value={labelOrEmpty(electricalService.interconnectionPoint)}
        />
        {electricalService.hasSubPanel === true && (
          <ReviewRow
            label="Sub Panel"
            value={
              electricalService.subPanelRating
                ? electricalService.subPanelRating + 'A'
                : 'Yes (unrated)'
            }
          />
        )}
        {electricalService.electricalNotes && (
          <ReviewRow label="Notes" value={electricalService.electricalNotes} />
        )}
      </ReviewSection>

      {/* ---- Step 4: Obstructions ---- */}
      <ReviewSection title="4. Obstructions" step={4} onEdit={onEditStep}>
        {obstructions.obstructions.length === 0 ? (
          <ReviewRow label="Obstructions" value="None logged" flag="ok" />
        ) : (
          <>
            <ReviewRow
              label="Count"
              value={`${obstructions.obstructions.length} obstruction(s)`}
              flag="warn"
            />
            {obstructions.obstructions.map((ob) => (
              <ReviewRow
                key={ob.id}
                label={ob.location}
                value={`${ob.type.replace(/_/g, ' ')}${ob.notes ? ' - ' + ob.notes : ''}`}
              />
            ))}
          </>
        )}
        {obstructions.estimatedUsableRoofPct != null && (
          <ReviewRow
            label="Usable Roof"
            value={`${obstructions.estimatedUsableRoofPct}%`}
            flag={
              obstructions.estimatedUsableRoofPct >= 70
                ? 'ok'
                : obstructions.estimatedUsableRoofPct >= 40
                ? 'warn'
                : 'error'
            }
          />
        )}
        {obstructions.setbackNotes && (
          <ReviewRow label="Setback Notes" value={obstructions.setbackNotes} />
        )}
      </ReviewSection>

      {/* ---- Step 5: Photos ---- */}
      <ReviewSection
        title="5. Photos"
        step={5}
        onEdit={onEditStep}
        hasIssue={!photosOk}
      >
        <ReviewRow
          label="Total Photos"
          value={String(photos.photos.length)}
          flag={photos.photos.length > 0 ? 'ok' : 'warn'}
        />
        <ReviewRow
          label="Required"
          value={`${capturedRequired.length}/${REQUIRED_PHOTO_CATEGORIES.length}`}
          flag={photosOk ? 'ok' : 'error'}
        />
        {missingRequired.length > 0 && (
          <ReviewRow
            label="Missing"
            value={missingRequired.map((c) => c.replace(/_/g, ' ')).join(', ')}
            flag="error"
          />
        )}
      </ReviewSection>

      {/* ---- Submit readiness ---- */}
      <div
        className={`rounded-xl border px-4 py-3 ${
          photosOk
            ? 'bg-green-50 border-green-200'
            : 'bg-orange-50 border-orange-200'
        }`}
      >
        {photosOk ? (
          <p className="text-sm font-semibold text-green-700">
            Ready to submit. Tap Submit Survey below.
          </p>
        ) : (
          <p className="text-sm font-semibold text-orange-700">
            Complete all required photos before submitting.
          </p>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Survey data is saved locally and will be uploaded on submit.
        </p>
      </div>
    </div>
  );
}