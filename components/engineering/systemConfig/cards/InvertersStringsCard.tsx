'use client';

// ═══════════════════════════════════════════════════════════════════════════
// INVERTERS & STRINGS — the PV decisions, asked in the card that owns them.
//
// Ray (System Config UX correction V3): "Engineering complexity should increase the intelligence of
// the controls, not the vertical length of the page." This card answers three interview items and no
// others (`homeOf` → 'inverters'):
//
//   · equipment.pv-inverter — "PV inverter: None — DC coupled to storage" is a recorded decision and
//     is stated as one; a chosen inverter is the card's own fleet rows below, unchanged.
//   · behavior.pv-connection — "PV connection [DC coupled to <storage> ▼ | Through an external PV
//     inverter]", only where the interview asks it, written through the architecture decision route
//     (`onRecordCoupling` → the page's `resolveElectricalArchitecture`).
//   · behavior.pv-landing — on a DC-coupled job with no PV inverter, ONE compact block:
//       PV STRINGS · 37 modules · 5 strings (9/9/9/8/2) · DC coupled to Tesla Powerwall 3
//       String assignment · Not assigned · Recommended assignment available [Review]
//     [Review] opens the String assignment dialog (`StringAssignmentEditor`): "String i → unit #k"
//     rows and "Recommended assignment available [Accept] [Edit]". Nothing is written until a click.
//
// Every write goes through `apply` (the page's one write path) or `onRecordCoupling`; nothing here
// holds engineering state.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useId, useMemo, useState } from 'react';
import type { SolarCoupling } from '@/lib/electrical/serviceTopology';
import type { EquipmentDecision, SystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { findInterviewItem } from '@/lib/electrical/systemConfigPlacement';
import { invertingUnits, recommendStringAssignment, unitDisplayLabels } from '@/lib/electrical/storageStringAssignment';
import {
  ProvenanceChip, SystemConfigModal, type ApplyAnswer, type ItemEditorContext,
} from '@/components/engineering/systemConfig/ItemEditor';
import { StringAssignmentEditor } from '@/components/engineering/systemConfig/StringAssignmentEditor';

export interface InvertersStringsDecisionsProps extends ItemEditorContext {
  interview: Pick<SystemConfigInterview, 'sections'>;
  /** The PV coupling the project records (the canonical model's), null ⇒ not recorded. */
  coupling: SolarCoupling | null;
  /** The PV inverter decision the interview was built from. */
  pvInverterState: EquipmentDecision;
  /** The architecture route's error, when recording the PV connection failed. */
  connectionError?: string | null;
}

const box = 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-100 border border-slate-700';

/** The PV connection option, in the card's words: "DC coupled to <storage>". */
function connectionLabel(value: string, label: string, storageLabel: string | null): string {
  if (value === 'dc-coupled-storage') return `DC coupled to ${storageLabel ?? 'the batteries'}`;
  if (value === 'ac-coupled-inverter') return 'Through an external PV inverter';
  return label;
}

export function InvertersStringsDecisions(props: InvertersStringsDecisionsProps) {
  const { interview, topology: t, pvArray, derivedStrings, equipment, busy, coupling, pvInverterState } = props;
  const inverterItem = findInterviewItem(interview, 'equipment.pv-inverter');
  const connectionItem = findInterviewItem(interview, 'behavior.pv-connection');
  const landingItem = findInterviewItem(interview, 'behavior.pv-landing');
  const storageLabel = equipment.storageLabel;

  const hasPv = (pvArray.moduleCount ?? 0) > 0;
  // The strings block exists where the PV lands on the batteries' own inputs and there is no PV inverter.
  const dcCoupledNoInverter = hasPv && coupling === 'dc-coupled-storage'
    && pvInverterState !== 'SELECTED' && pvInverterState !== 'CONFLICT';
  // A chosen inverter is stated by the fleet rows below; only an undecided / None / conflicting one here.
  const showInverterLine = !!inverterItem && hasPv && pvInverterState !== 'SELECTED';

  const units = useMemo(() => invertingUnits(t), [t]);
  const unitLabels = useMemo(() => unitDisplayLabels(t), [t]);
  const watts = pvArray.module?.watts ?? null;
  const rec = useMemo(() => recommendStringAssignment({ strings: derivedStrings, moduleWatts: watts, units }),
    [derivedStrings, watts, units]);
  // `behavior.pv-landing` is asked with more than one unit; with one, the unit's own record is the answer.
  const recordedKw = units.reduce((s, u) => s + (u.pvDcStcKw ?? 0), 0);
  const carrying = units.filter(u => (u.pvDcStcKw ?? 0) > 0).length;
  const assigned = landingItem ? landingItem.state === 'answered'
    : units.length > 0 && units.every(u => u.pvDcStcKw !== null && u.pvDcStcKw !== undefined)
      && pvArray.dcStcKw !== null && Math.abs(recordedKw - pvArray.dcStcKw) < 0.01;

  const [reviewOpen, setReviewOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const titleId = useId();
  const closeReview = () => { setReviewOpen(false); setRefusal(null); };
  // A refusal is shown in the dialog and never written; a successful write closes it.
  const applyInDialog: ApplyAnswer = async r => {
    if (r.ok === false) { setRefusal(r.refused); return false; }
    setRefusal(null);
    const ok = await props.apply(r);
    if (ok) setReviewOpen(false);
    return ok;
  };

  if (!showInverterLine && !connectionItem && !dcCoupledNoInverter) return null;

  return (
    <div data-testid="inv-decisions" className="mb-4 space-y-2">
      {showInverterLine ? (
        <div data-testid="inv-pv-inverter" data-state={inverterItem!.state}
             className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">PV inverter</span>
          <span className={inverterItem!.state === 'answered' ? 'text-slate-200'
            : inverterItem!.state === 'fails' ? 'text-rose-300' : 'text-amber-200'}>
            {inverterItem!.answer ?? 'Not chosen'}
          </span>
          <ProvenanceChip source={inverterItem!.source} compact />
          {inverterItem!.state === 'needs-answer' && inverterItem!.why ? (
            <span className="w-full text-[10px] text-slate-500">{inverterItem!.why}</span>
          ) : null}
        </div>
      ) : null}

      {connectionItem ? (
        <div data-testid="inv-pv-connection" data-state={connectionItem.state} className="space-y-0.5">
          <label className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">PV connection</span>
            {connectionItem.options ? (
              <select data-testid="inv-pv-connection-select" className={box}
                      disabled={busy || !t || !props.onRecordCoupling}
                      value={connectionItem.value ?? ''}
                      onChange={e => {
                        const v = e.target.value;
                        if (v && v !== connectionItem.value && props.onRecordCoupling) {
                          void props.onRecordCoupling(v as SolarCoupling);
                        }
                      }}>
                {connectionItem.value ? null : <option value="">Choose…</option>}
                {connectionItem.options.map(o => (
                  <option key={o.value} value={o.value}>{connectionLabel(o.value, o.label, storageLabel)}</option>
                ))}
              </select>
            ) : (
              <span className="text-slate-200">
                {connectionItem.value ? connectionLabel(connectionItem.value, connectionItem.answer ?? '', storageLabel)
                  : connectionItem.answer ?? 'Not established'}
              </span>
            )}
            <ProvenanceChip source={connectionItem.source} compact />
          </label>
          {connectionItem.options && !t ? (
            <div className="text-[10px] text-slate-500">Set the existing service first — the PV connection is recorded on it.</div>
          ) : null}
          {props.connectionError ? (
            <div data-testid="inv-pv-connection-error" className="text-[10px] text-rose-300">{props.connectionError}</div>
          ) : null}
        </div>
      ) : null}

      {dcCoupledNoInverter ? (
        <div data-testid="inv-strings-summary" data-assigned={assigned ? 'true' : 'false'}
             className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-2.5 text-xs text-slate-300">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="font-black tracking-wide text-amber-300">PV STRINGS</span>
            <span className="text-slate-600">·</span>
            <span>{pvArray.moduleCount} modules</span>
            <span className="text-slate-600">·</span>
            <span data-testid="inv-strings-count">
              {derivedStrings.length > 0
                ? `${derivedStrings.length} string${derivedStrings.length === 1 ? '' : 's'} (${derivedStrings.join('/')})`
                : 'strings not derived yet'}
            </span>
            <span className="text-slate-600">·</span>
            <span>DC coupled to {storageLabel ?? 'the batteries'}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">String assignment</span>
            <span data-testid="inv-string-status" data-state={assigned ? 'answered' : 'needs-answer'}
                  title={units.map(u => `${unitLabels[u.id]}: ${u.pvDcStcKw == null ? 'not assigned' : `${u.pvDcStcKw.toFixed(2)} kW`}`).join(' · ')}
                  className={assigned ? 'text-slate-200' : 'text-amber-200'}>
              {assigned ? `Assigned — ${carrying} of ${units.length} unit${units.length === 1 ? '' : 's'} `
                + `${carrying === 1 ? 'carries' : 'carry'} PV` : 'Not assigned'}
            </span>
            <ProvenanceChip source={landingItem?.source ?? (assigned ? 'Installer entered' : 'Not established')} compact />
            {!assigned && rec.ok ? (
              <span data-testid="inv-string-recommended-hint" className="text-[10px] text-sky-300">Recommended assignment available</span>
            ) : null}
            {derivedStrings.length > 0 && units.length > 0 ? (
              <button type="button" data-testid="inv-string-review" disabled={busy}
                      className="ml-auto rounded border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-[11px] font-bold text-sky-200 hover:bg-sky-500/20 disabled:opacity-40"
                      onClick={() => { setRefusal(null); setReviewOpen(true); }}>
                Review
              </button>
            ) : (
              <span className="ml-auto text-[10px] text-slate-500">
                {units.length === 0 ? 'Add the storage on the Battery Storage card first.' : 'Waiting for the strings.'}
              </span>
            )}
          </div>
        </div>
      ) : null}

      {reviewOpen && t ? (
        <SystemConfigModal open onClose={closeReview} titleId={titleId} testid="inv-string-dialog">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Inverters & Strings</div>
                <h2 id={titleId} className="mt-0.5 text-sm font-extrabold text-slate-100">
                  String assignment — which {storageLabel ?? 'battery'} receives each PV string?
                </h2>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  A wiring decision: SolarPro recommends one inside each unit’s published PV inputs, and records
                  only what you accept or save.
                </div>
              </div>
              <button type="button" data-testid="inv-string-dialog-close" aria-label="Close"
                      className="rounded px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      onClick={closeReview}>×</button>
            </div>
            {refusal ? (
              <div data-testid="answer-refusal" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">{refusal}</div>
            ) : null}
            <StringAssignmentEditor t={t} pvArray={pvArray} strings={derivedStrings} apply={applyInDialog} busy={busy} />
          </div>
        </SystemConfigModal>
      ) : null}
    </div>
  );
}

export default InvertersStringsDecisions;
