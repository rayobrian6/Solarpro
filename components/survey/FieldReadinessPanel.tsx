// ============================================================================
// Survey V2: Field Readiness Panel (step 6)
//
// Renders the Engineering Requirement Registry verdict on the phone, before
// the crew leaves. It computes nothing: it POSTs the captured photos to
// /api/survey/readiness and renders what the one engine returned.
//
// HONESTY RULES ENFORCED IN THIS COMPONENT:
//   - While loading, and on any error, the panel renders UNKNOWN. It never
//     renders "ready to leave" from an absent or failed answer.
//   - An item the server marked `unknown` renders as UNKNOWN with its reason.
//   - Every number shown comes from the response. Nothing is derived here.
//
// Pure ASCII, no Unicode.
// ============================================================================

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { SurveyPhoto } from '../../lib/survey/v2/types';
import type {
  FieldReadinessItem,
  FieldSurveyReadiness,
} from '../../lib/survey/v2/fieldReadiness';

interface FieldReadinessPanelProps {
  surveyToken: string;
  photos: SurveyPhoto[];
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; readiness: FieldSurveyReadiness };

const BAND_TITLES: Record<FieldReadinessItem['band'], string> = {
  blocking: 'Blocking - engineering cannot start',
  review_required: 'Review required - engineering will flag this',
  informational: 'Informational',
};

function statusLabel(status: FieldReadinessItem['status']): string {
  switch (status) {
    case 'satisfied': return 'OK';
    case 'partially_satisfied': return 'PARTIAL';
    case 'insufficient_metadata': return 'INCOMPLETE';
    case 'missing': return 'MISSING';
    case 'inactive': return 'INACTIVE';
    default: return 'UNKNOWN';
  }
}

function statusClass(status: FieldReadinessItem['status']): string {
  if (status === 'satisfied') return 'bg-green-100 text-green-700';
  if (status === 'missing') return 'bg-red-100 text-red-700';
  if (status === 'unknown') return 'bg-gray-200 text-gray-600';
  return 'bg-orange-100 text-orange-700';
}

export function FieldReadinessPanel({ surveyToken, photos }: FieldReadinessPanelProps) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' });

  const photoKey = photos.map(photo => `${photo.category}:${photo.id}`).sort().join('|');

  const check = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const res = await fetch('/api/survey/readiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: surveyToken, photos }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !(body as { ok?: boolean }).ok) {
        const message =
          (body as { error?: string }).error ?? `Readiness check failed (${res.status})`;
        setState({ phase: 'error', message });
        return;
      }
      setState({
        phase: 'ready',
        readiness: (body as { readiness: FieldSurveyReadiness }).readiness,
      });
    } catch {
      setState({ phase: 'error', message: 'Could not reach the readiness check.' });
    }
    // photoKey is the real dependency; `photos` is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyToken, photoKey]);

  useEffect(() => {
    void check();
  }, [check]);

  // ---- Loading / error: UNKNOWN, never all-clear -------------------------
  if (state.phase !== 'ready') {
    const isError = state.phase === 'error';
    return (
      <div className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 space-y-2">
        <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">
          Engineering Requirements
        </p>
        <p className="text-sm font-semibold text-gray-700">
          {isError ? 'UNKNOWN - readiness could not be checked' : 'Checking engineering requirements...'}
        </p>
        <p className="text-xs text-gray-500">
          {isError
            ? `${state.message} Do not treat this as all-clear.`
            : 'Do not leave the site until this check reports a result.'}
        </p>
        {isError ? (
          <button
            type="button"
            onClick={() => void check()}
            className="text-xs font-semibold text-cyan-600 hover:text-cyan-800"
          >
            Retry check
          </button>
        ) : null}
      </div>
    );
  }

  const { readiness } = state;
  const gatingOutstanding =
    readiness.outstandingCounts.blocking + readiness.outstandingCounts.review_required;

  const bands: FieldReadinessItem['band'][] = ['blocking', 'review_required', 'informational'];

  return (
    <div className="space-y-3">
      {/* ---- Verdict ---- */}
      <div
        className={`rounded-xl border px-4 py-3 ${
          readiness.readyToLeave
            ? 'bg-green-50 border-green-200'
            : readiness.readiness === 'blocked'
              ? 'bg-red-50 border-red-200'
              : 'bg-orange-50 border-orange-200'
        }`}
      >
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          Engineering Requirements
        </p>
        <p
          className={`text-sm font-bold mt-0.5 ${
            readiness.readyToLeave
              ? 'text-green-700'
              : readiness.readiness === 'blocked'
                ? 'text-red-700'
                : 'text-orange-700'
          }`}
        >
          {readiness.readyToLeave
            ? 'Nothing outstanding - safe to leave the site.'
            : `Do not leave yet - ${gatingOutstanding} outstanding.`}
        </p>
        <div className="flex gap-3 mt-2">
          <CountChip label="Blocking" count={readiness.outstandingCounts.blocking} tone="red" />
          <CountChip
            label="Review"
            count={readiness.outstandingCounts.review_required}
            tone="orange"
          />
          <CountChip
            label="Info"
            count={readiness.outstandingCounts.informational}
            tone="gray"
          />
        </div>
      </div>

      {/* ---- Bands ---- */}
      {bands.map(band => {
        const items = readiness.items.filter(item => item.band === band);
        if (items.length === 0) return null;
        const open = items.filter(item => item.status !== 'satisfied');
        return (
          <div key={band} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h4 className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">
                {BAND_TITLES[band]}
              </h4>
              <span className="text-[11px] font-bold text-gray-500">{open.length}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {items.map(item => (
                <RequirementRow key={item.requirementId} item={item} />
              ))}
            </div>
          </div>
        );
      })}

      {/* ---- What this verdict does not cover ---- */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          What this check does not cover
        </p>
        {readiness.coverage.limitations.map(limitation => (
          <p key={limitation} className="text-[11px] text-gray-500">
            {limitation}
          </p>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CountChip
// ---------------------------------------------------------------------------
function CountChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'red' | 'orange' | 'gray';
}) {
  const toneClass =
    count === 0
      ? 'bg-gray-100 text-gray-500'
      : tone === 'red'
        ? 'bg-red-100 text-red-700'
        : tone === 'orange'
          ? 'bg-orange-100 text-orange-700'
          : 'bg-gray-200 text-gray-700';
  return (
    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${toneClass}`}>
      {label} {count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RequirementRow
// ---------------------------------------------------------------------------
function RequirementRow({ item }: { item: FieldReadinessItem }) {
  return (
    <div className="px-4 py-2.5 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-gray-800">{item.humanLabel}</span>
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${statusClass(item.status)}`}
        >
          {statusLabel(item.status)}
        </span>
      </div>
      {item.status !== 'satisfied' ? (
        <>
          <p className="text-[11px] text-gray-600">{item.detail}</p>
          {item.movementZoneLabel && item.capturableInField ? (
            <p className="text-[11px] text-cyan-700">
              Walk back to: <span className="font-semibold">{item.movementZoneLabel}</span>
            </p>
          ) : null}
          {item.technicianInstruction && item.capturableInField ? (
            <p className="text-[10px] text-gray-400">{item.technicianInstruction}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
