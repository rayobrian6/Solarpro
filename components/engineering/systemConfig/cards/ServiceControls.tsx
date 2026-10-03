'use client';

// ═══════════════════════════════════════════════════════════════════════════
// THE SERVICE CONTROLS — one set, wherever a service question is asked.
//
// Ray (System Config UX correction V3): [Answer Next] asks a question "rendered with the same editor
// its home card uses". The Existing Electrical Service card and the question dialog ([Answer Next],
// the guided strip, Review Engineering) both render THESE controls, so a service question offers the
// same ratings, keeps the same recorded value, refuses the same typo and asks the same confirmation
// wherever it is asked. Only the testids differ: `svc-*` in the card, `answer-*` in a dialog.
//
// Every write is one `systemConfigAnswers.ts` answer handed to `apply` — the page's one write path.
// A refusal goes to `apply` too, so whoever holds `apply` (the card, the dialog) shows it.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import type { InterviewItem } from '@/lib/electrical/systemConfigInterview';
import type { PanelBoard, ServiceTopology, TopologyCheck } from '@/lib/electrical/serviceTopology';
import { SERVICE_PHASES, servicePhaseInfo } from '@/lib/electrical/serviceTopology';
import {
  answerServiceRating, answerElectricalSystem, answerDistribution, answerPanel,
  answerAvailableFaultCurrent, answerExistingService, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import {
  BUSBAR_RATINGS, MAIN_BREAKER_RATINGS, SERVICE_RATINGS, busbarRemedies, existingRecordedFacts,
  panelRecordedFacts, withRecorded, withoutPresetPanelRatings,
} from '@/lib/electrical/systemConfigServiceCard';

type Apply = (r: AnswerResult) => Promise<boolean>;

/** Which testids a control carries: the card's (`svc-*`) or a dialog's (`answer-*`). */
export type ServiceControlIds = 'svc' | 'answer';

const IDS = {
  svc: {
    rating: 'svc-rating', system: 'svc-system', systemDescriptor: 'svc-system-descriptor',
    distribution: 'svc-distribution', panel: 'svc-panel', fault: 'svc-fault-current',
    existing: 'svc-existing', existingMfr: 'svc-existing-mfr', confirm: 'svc-confirm',
  },
  answer: {
    rating: 'answer-service-rating', system: 'answer-electrical-system', systemDescriptor: 'answer-system-descriptor',
    distribution: 'answer-distribution', panel: 'answer-panel', fault: 'answer-fault-current',
    existing: 'answer-existing-service', existingMfr: 'answer-existing-mfr', confirm: 'answer-confirm',
  },
} as const;

const box = 'rounded bg-slate-800 px-1.5 py-1 text-xs text-slate-100 border border-slate-700 disabled:opacity-50';
const NEEDS = 'ring-1 ring-sky-400/70';
const asks = (i: InterviewItem | null | undefined) => i?.state === 'needs-answer';

// ── A confirmation, inline ──────────────────────────────────────────────────

/** "This discards …  [Discard] [Keep]" — asked before an answer throws away what was recorded. */
export function ConfirmStrip({ testid, message, lost, confirmLabel, onConfirm, onCancel, disabled }: {
  testid: string; message: string; lost: string[]; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void; disabled?: boolean;
}) {
  return (
    <div data-testid={testid} role="group" aria-label={message}
         className="mt-1 basis-full rounded border border-amber-500/40 bg-amber-500/10 p-1.5 text-[11px] text-amber-100">
      <div className="font-semibold">{message}</div>
      {lost.length > 0 ? (
        <ul data-testid={`${testid}-lost`} className="mt-0.5 list-disc pl-4 text-amber-200/90">
          {lost.map(f => <li key={f}>{f}</li>)}
        </ul>
      ) : null}
      <div className="mt-1 flex gap-2">
        <button type="button" data-testid={`${testid}-yes`} disabled={disabled} onClick={onConfirm}
                className="rounded bg-amber-600 px-2 py-0.5 font-bold text-white hover:bg-amber-500 disabled:opacity-40">
          {confirmLabel}
        </button>
        <button type="button" data-testid={`${testid}-no`} onClick={onCancel}
                className="rounded border border-slate-600 px-2 py-0.5 font-bold text-slate-200 hover:bg-slate-800">
          Keep
        </button>
      </div>
    </div>
  );
}

// ── Service rating · electrical system ──────────────────────────────────────

/**
 * "What is the existing service rating?" — the select offers the recorded rating even when it is off
 * the ladder. On a graph that does not exist yet the rating builds it, WITHOUT preset panel ratings:
 * the main panel's main and bus are read off its label, never presumed from the service.
 */
export function ServiceRatingSelect({ t, item, ids, disabled, apply }: {
  t: ServiceTopology | null; item?: InterviewItem | null; ids: ServiceControlIds; disabled: boolean; apply: Apply;
}) {
  return (
    <select data-testid={IDS[ids].rating} className={`eng-select ${asks(item) ? NEEDS : ''}`} disabled={disabled}
            value={t?.service.ratedAmps ?? ''}
            onChange={e => {
              const a = Number(e.target.value);
              if (!(a > 0)) return;
              void apply(t ? answerServiceRating(t, a) : withoutPresetPanelRatings(answerServiceRating(null, a)));
            }}>
      <option value="">Choose…</option>
      {withRecorded(SERVICE_RATINGS, t?.service.ratedAmps).map(a => <option key={a} value={a}>{a} A</option>)}
    </select>
  );
}

/** "What is the electrical system?" — a system that is not split phase says what it is. */
export function ElectricalSystemSelect({ t, item, ids, disabled, apply }: {
  t: ServiceTopology; item?: InterviewItem | null; ids: ServiceControlIds; disabled: boolean; apply: Apply;
}) {
  const info = servicePhaseInfo(t.service.phase);
  return (
    <>
      <select data-testid={IDS[ids].system} className="eng-select" disabled={disabled} value={String(t.service.phase)}
              onChange={e => void apply(answerElectricalSystem(t, e.target.value))}>
        {SERVICE_PHASES.map(ph => <option key={ph} value={ph}>{servicePhaseInfo(ph).label}</option>)}
      </select>
      {/* No separate commercial workflow: the system states its own descriptor. */}
      {!info.residentialSplitPhase ? (
        <div data-testid={IDS[ids].systemDescriptor} className="mt-1 text-[10px] text-slate-400">
          {t.service.phase === 'custom'
            ? item?.why ?? 'Not a system SolarPro models.'
            : [info.phaseCount === 3 ? '3φ' : null, info.wires].filter(Boolean).join(' · ')}
        </div>
      ) : null}
    </>
  );
}

// ── Distribution ────────────────────────────────────────────────────────────

type DistributionPreset = Parameters<typeof answerDistribution>[1];

/**
 * "How is the N A service distributed?" — one button per preset. "Other / custom" is not offered
 * here: it builds no branch at all and this control has nothing to collect the branches with (a
 * recorded custom split is shown as what it is). A rebuild that would discard what the installer
 * recorded on the panels asks first, and builds the new panels without preset ratings.
 */
export function DistributionControl({ t, item, ids, disabled, apply }: {
  t: ServiceTopology; item: InterviewItem; ids: ServiceControlIds; disabled: boolean; apply: Apply;
}) {
  const [pending, setPending] = useState<DistributionPreset | null>(null);
  const options = (item.options ?? []).filter(o => o.value !== 'custom');
  const recordedShown = options.some(o => o.value === item.value);
  const build = (v: DistributionPreset) => withoutPresetPanelRatings(answerDistribution(t, v));
  const pick = (v: DistributionPreset) => {
    const r = build(v);
    // A refusal (backup systems on the service) is shown as it is — nothing to confirm.
    if (r.ok && panelRecordedFacts(t).length > 0) { setPending(v); return; }
    void apply(r);
  };
  const pendingLabel = pending ? options.find(o => o.value === pending)?.label ?? pending : '';
  return (
    <>
      <div className={`flex flex-wrap items-center gap-1 rounded ${asks(item) ? NEEDS : ''}`}>
        {!recordedShown && item.answer && item.state !== 'needs-answer' ? (
          <span data-testid={`${IDS[ids].distribution}-recorded`}
                className="rounded border border-dashed border-slate-600 px-2 py-1 text-[11px] text-slate-300">
            Recorded: {item.answer}
          </span>
        ) : null}
        {options.map(o => {
          const on = item.value === o.value;
          return (
            <button key={o.value} type="button" data-testid={`${IDS[ids].distribution}-${o.value}`} aria-pressed={on}
                    disabled={disabled}
                    className={`rounded border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${on
                      ? 'border-sky-400 bg-sky-500/15 text-sky-100' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
                    onClick={() => { if (!on) pick(o.value as DistributionPreset); }}>
              {o.label}
            </button>
          );
        })}
      </div>
      {item.state === 'fails' && item.why ? (
        <div data-testid={`${IDS[ids].distribution}-fails`} className="mt-1 text-[11px] text-rose-300">{item.why}</div>
      ) : null}
      {pending ? (
        <ConfirmStrip testid={`${IDS[ids].confirm}-distribution`} disabled={disabled}
                      message={`Rebuild the panels as "${pendingLabel}"? This discards what is recorded on them:`}
                      lost={panelRecordedFacts(t)} confirmLabel="Rebuild panels"
                      onCancel={() => setPending(null)}
                      onConfirm={() => { const v = pending; setPending(null); void apply(build(v)); }} />
      ) : null}
    </>
  );
}

// ── One panelboard ──────────────────────────────────────────────────────────

/**
 * One panelboard: Main / Bus / Manufacturer, with where its figures came from (`chip`). The ladders
 * always include the recorded rating, so a 175 A main never reads as blank. A failing NEC 705.12(B)
 * verdict (the engine's, read — never recomputed) lists the remedies as PROPOSED WORK: nothing here
 * writes a remedy as the panel's rating.
 */
export function PanelRow({ t, panel: p, item, ids, disabled, apply, check = null, chip, askSccr = false }: {
  t: ServiceTopology; panel: PanelBoard; item: InterviewItem | null; ids: ServiceControlIds; disabled: boolean;
  apply: Apply; check?: TopologyCheck | null; chip?: React.ReactNode;
  /** Asked for the panel's SCCR (the engine's fault-current chain names this panel). */
  askSccr?: boolean;
}) {
  const id = IDS[ids].panel;
  const remedies = busbarRemedies(p, check);
  const missing = item?.state === 'needs-answer';
  // 🚨 THE PANEL'S SCCR, OFF ITS LABEL — once the utility's fault current makes the chain need it (or a
  // figure is recorded). It was only ever editable in the Service Topology inspector's panel box.
  const showSccr = askSccr || t.service.availableFaultCurrentA != null || p.sccrA != null;
  const sccrNeeded = showSccr && p.sccrA == null && t.service.availableFaultCurrentA != null;
  return (
    <div data-testid={`${id}-${p.id}`} data-state={item?.state}>
      {/* Two lines so the card reads in the narrow left column: the panel and its maker, then its ratings. */}
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <span className="flex shrink-0 flex-col">
          <span className="font-bold text-slate-200" title={p.label}>{p.label}</span>
          {chip}
        </span>
        <input data-testid={`${id}-mfr-${p.id}`} key={p.manufacturer ?? ''} aria-label={`${p.label} manufacturer`}
               className={`min-w-0 flex-1 ${box}`} disabled={disabled} defaultValue={p.manufacturer ?? ''} placeholder="Manufacturer"
               onBlur={e => {
                 if ((e.target.value.trim() || null) !== (p.manufacturer ?? null)) {
                   void apply(answerPanel(t, p.id, { manufacturer: e.target.value }));
                 }
               }} />
      </div>
      <div className={`mt-1 grid ${showSccr ? 'grid-cols-3' : 'grid-cols-2'} items-center gap-1.5 text-[11px] text-slate-400`}>
        <label className="flex items-center gap-1">Main
          <select data-testid={`${id}-main-${p.id}`} className={`w-full ${box} ${missing && p.mainBreakerA == null ? NEEDS : ''}`}
                  disabled={disabled} value={p.mainBreakerA ?? ''}
                  onChange={e => void apply(answerPanel(t, p.id, { mainBreakerA: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">—</option>
            {withRecorded(MAIN_BREAKER_RATINGS, p.mainBreakerA).map(a => <option key={a} value={a}>{a} A</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Bus
          <select data-testid={`${id}-bus-${p.id}`} className={`w-full ${box} ${missing && p.busbarRatingA == null ? NEEDS : ''}`}
                  disabled={disabled} value={p.busbarRatingA ?? ''}
                  onChange={e => void apply(answerPanel(t, p.id, { busbarRatingA: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">—</option>
            {withRecorded(BUSBAR_RATINGS, p.busbarRatingA).map(a => <option key={a} value={a}>{a} A</option>)}
          </select>
        </label>
        {showSccr ? (
          <label className="flex items-center gap-1" title="Interrupting rating (SCCR) off the panel label, in kA">SCCR
            <input type="number" min={0} step={0.5} data-testid={`${id}-sccr-${p.id}`} key={p.sccrA ?? 'none'}
                   aria-label={`${p.label} SCCR (kA)`} placeholder="kA" disabled={disabled}
                   className={`w-full min-w-0 ${box} ${sccrNeeded ? NEEDS : ''}`}
                   defaultValue={p.sccrA != null ? p.sccrA / 1000 : ''}
                   onBlur={e => {
                     const el = e.currentTarget;
                     if (el.validity?.badInput) {
                       el.value = p.sccrA != null ? String(p.sccrA / 1000) : '';
                       void apply({ ok: false, refused: `${p.label} SCCR: enter the kiloamperes on the panel label, or leave it blank.` });
                       return;
                     }
                     const ka = el.value.trim() === '' ? null : Number(el.value);
                     const a = ka === null ? null : Math.round(ka * 1000);
                     if (a !== (p.sccrA ?? null)) void apply(answerPanel(t, p.id, { sccrA: a }));
                   }} />
          </label>
        ) : null}
      </div>
      {remedies && check ? (
        <div data-testid={`${id}-busbar-fail-${p.id}`}
             className="mt-1 rounded border border-rose-500/40 bg-rose-500/10 p-1.5 text-[11px] text-rose-200">
          <div><span className="font-bold">120% rule FAILS</span> — {check.detail}
            {check.citation ? <span className="text-rose-300/70"> ({check.citation})</span> : null}</div>
          <div className="mt-1 text-slate-300">
            <span className="font-semibold text-slate-200">Possible remedies</span>
            <span className="text-slate-400"> — proposed work, not recorded as this panel&apos;s rating:</span>
          </div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-slate-300">
            {remedies.derateMain.length > 0 ? (
              <li data-testid={`${ids}-remedy-derate-${p.id}`}>
                Derate the main breaker — {remedies.derateMain.map(r => `${r.amps} A allows ${r.allowsA} A`).join(' · ')}.
                {' '}Needs a replacement main breaker, and a load calculation showing the panel&apos;s calculated
                load fits the derated main.
              </li>
            ) : null}
            {remedies.upgradeBus.length > 0 ? (
              <li data-testid={`${ids}-remedy-bus-${p.id}`}>
                Upgrade the busbar — {remedies.upgradeBus.map(r => `${r.amps} A allows ${r.allowsA} A`).join(' · ')}.
                {' '}That is a replacement panelboard: its manufacturer, SCCR and field verification are the new
                panel&apos;s, not this one&apos;s.
              </li>
            ) : null}
          </ul>
          <div className="mt-0.5 text-[10px] text-slate-500">
            Once the work is done, record what is installed in Main / Bus above — the check re-runs on it.
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Available fault current ─────────────────────────────────────────────────

/** "Available fault current [ kA ] from the utility" — a typo is refused and the stored value restored. */
export function FaultCurrentRow({ t, item, ids, disabled, apply, chip }: {
  t: ServiceTopology; item: InterviewItem | null; ids: ServiceControlIds; disabled: boolean; apply: Apply;
  chip?: React.ReactNode;
}) {
  const afc = t.service.availableFaultCurrentA;
  return (
    <div data-testid={`${IDS[ids].fault}-row`} data-state={item?.state}
         className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
      <span className="font-semibold text-slate-300">Available fault current</span>
      <input type="number" min={0} step={0.5} data-testid={IDS[ids].fault} key={afc ?? 'none'}
             className={`w-20 ${box}`} disabled={disabled} placeholder="kA"
             defaultValue={afc !== null ? afc / 1000 : ''}
             onBlur={e => {
               const el = e.currentTarget;
               // Something typed that is not a number reads as '' — that is not a deliberate blank.
               if (el.validity?.badInput) {
                 el.value = afc !== null ? String(afc / 1000) : '';
                 void apply({ ok: false, refused: 'Available fault current: enter a number of kiloamperes from the utility, or leave it blank.' });
                 return;
               }
               const ka = el.value.trim() === '' ? null : Number(el.value);
               const amps = ka === null ? null : Math.round(ka * 1000);
               if (amps !== afc) void apply(answerAvailableFaultCurrent(t, amps));
             }} />
      <span>kA from the utility</span>
      {chip}
    </div>
  );
}

// ── Existing service equipment ──────────────────────────────────────────────

/**
 * "Existing service equipment" — the checkbox and, when it is existing, its manufacturer. Unchecking
 * it declares the equipment new, which discards everything read off it on site: when anything is
 * recorded, that is asked first. `children` follow the manufacturer (the card's status and [Verify]).
 */
export function ExistingServiceLine({ t, ids, disabled, apply, children }: {
  t: ServiceTopology; ids: ServiceControlIds; disabled: boolean; apply: Apply; children?: React.ReactNode;
}) {
  const ex = t.service.existingEquipment ?? null;
  const [confirming, setConfirming] = useState(false);
  const lost = existingRecordedFacts(ex);
  const markNew = () => { setConfirming(false); void apply(answerExistingService(t, { existing: false })); };
  return (
    <>
      <label className="flex items-center gap-1.5 font-semibold text-slate-200">
        <input type="checkbox" data-testid={IDS[ids].existing} checked={ex !== null} disabled={disabled}
               onChange={e => {
                 if (e.target.checked) { void apply(answerExistingService(t, { existing: true })); return; }
                 if (lost.length > 0) setConfirming(true); else markNew();
               }} />
        Existing service equipment
      </label>
      {ex ? (
        <>
          <span className="text-slate-600">·</span>
          <input data-testid={IDS[ids].existingMfr} key={ex.manufacturer ?? ''} className={`w-24 ${box}`}
                 placeholder="Manufacturer" defaultValue={ex.manufacturer ?? ''} disabled={disabled}
                 aria-label="Existing service equipment manufacturer"
                 onBlur={e => {
                   if ((e.target.value.trim() || null) !== (ex.manufacturer ?? null)) {
                     void apply(answerExistingService(t, { existing: true, manufacturer: e.target.value }));
                   }
                 }} />
          {children}
        </>
      ) : null}
      {confirming && ex ? (
        <ConfirmStrip testid={`${IDS[ids].confirm}-existing`} disabled={disabled}
                      message="Mark the service equipment as new? This discards what was read off it:"
                      lost={lost} confirmLabel="Discard and mark new"
                      onCancel={() => setConfirming(false)} onConfirm={markNew} />
      ) : null}
    </>
  );
}
