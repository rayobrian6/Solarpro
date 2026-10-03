'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EXISTING ELECTRICAL SERVICE — the left-column card, where the old Main Service Panel card was.
//
// Ray (System Config UX correction V3): "The existing System Config sections must become smarter and
// absorb the engineering questions that naturally belong there." The service questions the five-card
// questionnaire used to ask above the grid are asked HERE, compactly:
//
//   Service rating [400 A ▼]   Electrical system [120/240 V split phase ▼]
//   Distribution  (One 400 A main panel) (Two 200 A main panels) (Other / custom)   ← only when asked
//   MSP #1  Main [200 ▼]  Bus [200 ▼]  [Eaton]                                       ← one row per panel
//   Available fault current [   ] kA from the utility
//   ☑ Existing service equipment · [Eaton] · Field verification 5 items required [Verify]
//
// A plain 200 A / one-MSP house shows one compact panel row and NO multi-panel controls: the
// interview does not ask a 200 A service how it is split. A panel whose NEC 705.12(B) check FAILS
// (the engine's verdict, read — never recomputed) offers the 120% remedies — derate this panel's main,
// or upgrade its busbar — as edits of THAT panel, not as a way to connect.
//
// Every write goes through `systemConfigAnswers.ts` into `apply` — the page's one write path, which
// also mirrors the first panel's main / bus / manufacturer into the legacy config. A writer's refusal
// is shown here, in the card, and never written.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useId, useMemo, useState } from 'react';
import { Shield } from 'lucide-react';
import type { InterviewItem, SystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import type { PanelBoard, ServiceTopology } from '@/lib/electrical/serviceTopology';
import { SERVICE_PHASES, servicePhaseInfo } from '@/lib/electrical/serviceTopology';
import {
  answerServiceRating, answerElectricalSystem, answerDistribution, answerPanel,
  answerAvailableFaultCurrent, answerExistingService,
} from '@/lib/electrical/systemConfigAnswers';
import {
  BUSBAR_RATINGS, MAIN_BREAKER_RATINGS, SERVICE_RATINGS, busbarRemedies, existingNeedField,
  panelBusbarCheck, serviceCardLayout, withRecorded, type ExistingServiceField,
} from '@/lib/electrical/systemConfigServiceCard';
import {
  ProvenanceChip, SystemConfigModal, type ApplyAnswer, type ItemEditorContext,
} from '@/components/engineering/systemConfig/ItemEditor';
import { ExistingServiceVerifyForm } from '@/components/engineering/systemConfig/cards/ExistingServiceVerifyForm';

export interface ExistingElectricalServiceCardProps extends ItemEditorContext {
  /** The LIVE interview — relevance, answers and provenance are read from it, never re-derived. */
  interview: Pick<SystemConfigInterview, 'sections' | 'evaluation'>;
  /** The page's write error (the PUT failed). */
  error?: string | null;
  /**
   * The state of the page's read of the service graph. While it is loading or has FAILED, a null
   * graph is not "no service yet": answering the rating would build a fresh graph over one that could
   * not be read. Nothing is written until the read settles.
   */
  graphRead?: 'loading' | 'absent' | 'failed' | 'loaded';
}

const box = 'rounded bg-slate-800 px-1.5 py-1 text-xs text-slate-100 border border-slate-700 disabled:opacity-50';
const NEEDS = 'ring-1 ring-sky-400/70';
const asks = (i: InterviewItem | null) => i?.state === 'needs-answer';

export function ExistingElectricalServiceCard(props: ExistingElectricalServiceCardProps) {
  const { interview, topology: t, graphRead } = props;
  const layout = useMemo(() => serviceCardLayout(interview, t), [interview, t]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const verifyTitleId = useId();

  const unread = graphRead === 'loading' || graphRead === 'failed';
  const locked = props.busy || unread;
  // The card's own apply: a refusal is shown in the card; an accepted answer takes the page's path.
  // 🚨 Never over a graph that has not been read (or is being re-read): the answer would be computed
  // from a graph that is not the stored one, and the PUT would replace the stored one with it.
  const apply: ApplyAnswer = async r => {
    if (unread) return false;
    if (r.ok === false) { setRefusal(r.refused); return false; }
    setRefusal(null);
    return props.apply(r);
  };

  const ex = t?.service.existingEquipment ?? null;
  const needFields = layout.existingNeeds
    .map(i => existingNeedField(i.id)).filter((f): f is ExistingServiceField => f !== null);
  const checks = interview.evaluation?.checks ?? null;
  const notice = (
    <>
      {refusal ? (
        <div data-testid="svc-refusal" className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">{refusal}</div>
      ) : null}
      {props.error ? (
        <div data-testid="svc-error" className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{props.error}</div>
      ) : null}
    </>
  );

  return (
    <div data-testid="svc-card">
      <h3 className="text-sm font-extrabold text-slate-100 mb-3 flex items-center gap-2 tracking-tight">
        <Shield size={14} className="text-amber-400" /> Existing Electrical Service
        <span className="ml-1 text-[10px] font-normal text-slate-500 normal-case tracking-normal">NEC 705.12(B) per panel</span>
      </h3>
      {verifyOpen ? null : notice}

      {/* ── Rating · electrical system ── */}
      <div className="grid grid-cols-2 gap-3">
        <div data-state={layout.rating?.state}>
          <label className="eng-label flex items-center gap-1.5">
            Service rating <ProvenanceChip compact source={layout.rating?.source} />
          </label>
          <select data-testid="svc-rating" className={`eng-select ${asks(layout.rating) ? NEEDS : ''}`} disabled={locked}
                  value={t?.service.ratedAmps ?? ''}
                  onChange={e => { const a = Number(e.target.value); if (a > 0) void apply(answerServiceRating(t, a)); }}>
            <option value="">Choose…</option>
            {withRecorded(SERVICE_RATINGS, t?.service.ratedAmps).map(a => <option key={a} value={a}>{a} A</option>)}
          </select>
        </div>
        {t && layout.system ? (
          <div data-state={layout.system.state}>
            <label className="eng-label flex items-center gap-1.5">
              Electrical system <ProvenanceChip compact source={layout.system.source} />
            </label>
            <select data-testid="svc-system" className="eng-select" disabled={locked} value={String(t.service.phase)}
                    onChange={e => void apply(answerElectricalSystem(t, e.target.value))}>
              {SERVICE_PHASES.map(ph => <option key={ph} value={ph}>{servicePhaseInfo(ph).label}</option>)}
            </select>
            {/* A system that is not split phase says what it is — no separate commercial workflow. */}
            {!servicePhaseInfo(t.service.phase).residentialSplitPhase ? (
              <div data-testid="svc-system-descriptor" className="mt-1 text-[10px] text-slate-400">
                {t.service.phase === 'custom'
                  ? layout.system.why ?? 'Not a system SolarPro models.'
                  : [servicePhaseInfo(t.service.phase).phaseCount === 3 ? '3φ' : null,
                    servicePhaseInfo(t.service.phase).wires].filter(Boolean).join(' · ')}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {!t ? (
        <div data-testid={unread ? 'svc-unread' : 'svc-start'} className="mt-2 text-[11px] text-slate-400">
          {graphRead === 'failed'
            ? 'The service could not be read. Nothing is written here until it can be — reload to try again.'
            : graphRead === 'loading'
              ? 'Reading the service…'
              : 'Enter the service rating — the panels, the fault current and the existing equipment follow.'}
        </div>
      ) : null}

      {/* ── Distribution — only when the interview asks it (a service large enough to be split) ── */}
      {t && layout.distribution?.options ? (
        <div data-testid="svc-distribution" data-state={layout.distribution.state} className="mt-3">
          <div className="eng-label flex items-center gap-1.5">
            {layout.distribution.question.replace(/\?$/, '')}
            <ProvenanceChip compact source={layout.distribution.source} />
          </div>
          <div className={`flex flex-wrap gap-1 rounded ${asks(layout.distribution) ? NEEDS : ''}`}>
            {layout.distribution.options.map(o => {
              const on = layout.distribution?.value === o.value;
              return (
                <button key={o.value} type="button" data-testid={`svc-distribution-${o.value}`} aria-pressed={on}
                        disabled={locked}
                        className={`rounded border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${on
                          ? 'border-sky-400 bg-sky-500/15 text-sky-100' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
                        onClick={() => { if (!on) void apply(answerDistribution(t, o.value as Parameters<typeof answerDistribution>[1])); }}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ── Panels: one row each; one compact row on a one-MSP service ── */}
      {t && layout.panels.length > 0 ? (
        <div data-testid="svc-panels" data-multi={layout.multiPanel ? 'true' : 'false'} className="mt-3 space-y-1.5">
          {layout.panels.map(({ panel, item }) => (
            <PanelRow key={panel.id} t={t} panel={panel} item={item} locked={locked} apply={apply}
                      check={panelBusbarCheck(t, checks, panel.id)} />
          ))}
        </div>
      ) : null}

      {/* ── Available fault current ── */}
      {t && layout.faultCurrent ? (
        <FaultCurrentRow t={t} item={layout.faultCurrent} locked={locked} apply={apply} />
      ) : null}

      {/* ── Existing service equipment ── */}
      {t && layout.existing ? (
        <div data-testid="svc-existing-line" data-state={layout.existing.state}
             className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-slate-700/40 bg-slate-900/50 p-2 text-[11px] text-slate-300">
          <label className="flex items-center gap-1.5 font-semibold text-slate-200">
            <input type="checkbox" data-testid="svc-existing" checked={ex !== null} disabled={locked}
                   onChange={e => void apply(answerExistingService(t, { existing: e.target.checked }))} />
            Existing service equipment
          </label>
          {ex ? (
            <>
              <span className="text-slate-600">·</span>
              <input data-testid="svc-existing-mfr" key={ex.manufacturer ?? ''} className={`w-24 ${box}`}
                     placeholder="Manufacturer" defaultValue={ex.manufacturer ?? ''} disabled={locked}
                     onBlur={e => {
                       if ((e.target.value.trim() || null) !== (ex.manufacturer ?? null)) {
                         void apply(answerExistingService(t, { existing: true, manufacturer: e.target.value }));
                       }
                     }} />
              <span className="text-slate-600">·</span>
              <span data-testid="svc-existing-status" className={needFields.length > 0 || !ex.verified ? 'text-amber-300' : 'text-emerald-300'}>
                {needFields.length > 0
                  ? `Field verification ${needFields.length} item${needFields.length === 1 ? '' : 's'} required`
                  : ex.verified ? 'Field verified' : 'Field verification required'}
              </span>
              <button type="button" data-testid="svc-verify" disabled={locked} onClick={() => setVerifyOpen(true)}
                      className="ml-auto rounded bg-sky-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-40">
                Verify
              </button>
            </>
          ) : (
            <span data-testid="svc-existing-new" className="text-slate-500">— no: new equipment, engineered by SolarPro</span>
          )}
        </div>
      ) : null}

      {t && ex ? (
        <SystemConfigModal open={verifyOpen} onClose={() => setVerifyOpen(false)} titleId={verifyTitleId} testid="svc-verify-dialog">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Existing Electrical Service · Field verification</div>
                <h2 id={verifyTitleId} className="mt-0.5 text-sm font-extrabold text-slate-100">
                  Verify the existing service equipment{ex.manufacturer ? ` — ${ex.manufacturer}` : ''}
                </h2>
                <p className="mt-1 text-[11px] text-slate-400">
                  Read off the equipment on site, never assumed. SolarPro connects to existing equipment; it does not
                  replace or price it.
                </p>
              </div>
              <button type="button" data-testid="svc-verify-close" aria-label="Close" onClick={() => setVerifyOpen(false)}
                      className="rounded px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-slate-800 hover:text-slate-200">×</button>
            </div>
            {notice}
            <ExistingServiceVerifyForm t={t} apply={apply} busy={locked} needed={needFields}
                                       onSaved={() => setVerifyOpen(false)} />
          </div>
        </SystemConfigModal>
      ) : null}
    </div>
  );
}

// ── One panelboard ──────────────────────────────────────────────────────────

function PanelRow({ t, panel: p, item, locked, apply, check }: {
  t: ServiceTopology; panel: PanelBoard; item: InterviewItem | null; locked: boolean; apply: ApplyAnswer;
  check: ReturnType<typeof panelBusbarCheck>;
}) {
  const remedies = busbarRemedies(p, check);
  const missing = item?.state === 'needs-answer';
  return (
    <div data-testid={`svc-panel-${p.id}`} data-state={item?.state}>
      <div className="grid grid-cols-[minmax(3.5rem,auto)_1fr_1fr_1.2fr] items-center gap-1.5 text-[11px] text-slate-400">
        <span className="truncate font-bold text-slate-200" title={p.label}>{p.label}</span>
        <label className="flex items-center gap-1">Main
          <select data-testid={`svc-panel-main-${p.id}`} className={`w-full ${box} ${missing && p.mainBreakerA == null ? NEEDS : ''}`}
                  disabled={locked} value={p.mainBreakerA ?? ''}
                  onChange={e => void apply(answerPanel(t, p.id, { mainBreakerA: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">—</option>
            {withRecorded(MAIN_BREAKER_RATINGS, p.mainBreakerA).map(a => <option key={a} value={a}>{a} A</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Bus
          <select data-testid={`svc-panel-bus-${p.id}`} className={`w-full ${box} ${missing && p.busbarRatingA == null ? NEEDS : ''}`}
                  disabled={locked} value={p.busbarRatingA ?? ''}
                  onChange={e => void apply(answerPanel(t, p.id, { busbarRatingA: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">—</option>
            {withRecorded(BUSBAR_RATINGS, p.busbarRatingA).map(a => <option key={a} value={a}>{a} A</option>)}
          </select>
        </label>
        <input data-testid={`svc-panel-mfr-${p.id}`} key={p.manufacturer ?? ''} aria-label={`${p.label} manufacturer`}
               className={`w-full ${box}`} disabled={locked} defaultValue={p.manufacturer ?? ''} placeholder="Manufacturer"
               onBlur={e => {
                 if ((e.target.value.trim() || null) !== (p.manufacturer ?? null)) {
                   void apply(answerPanel(t, p.id, { manufacturer: e.target.value }));
                 }
               }} />
      </div>
      {remedies && check ? (
        <div data-testid={`svc-panel-busbar-fail-${p.id}`}
             className="mt-1 rounded border border-rose-500/40 bg-rose-500/10 p-1.5 text-[11px] text-rose-200">
          <div><span className="font-bold">120% rule FAILS</span> — {check.detail}
            {check.citation ? <span className="text-rose-300/70"> ({check.citation})</span> : null}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-300">
            <span className="text-slate-400">Remedy:</span>
            {remedies.derateMain.length > 0 ? (
              <label className="flex items-center gap-1">Derate main to
                <select data-testid={`svc-remedy-derate-${p.id}`} className={box} disabled={locked} value=""
                        onChange={e => { const a = Number(e.target.value); if (a > 0) void apply(answerPanel(t, p.id, { mainBreakerA: a })); }}>
                  <option value="">Choose…</option>
                  {remedies.derateMain.map(r => <option key={r.amps} value={r.amps}>{r.amps} A — allows {r.allowsA} A</option>)}
                </select>
              </label>
            ) : null}
            {remedies.upgradeBus.length > 0 ? (
              <label className="flex items-center gap-1">Upgrade busbar to
                <select data-testid={`svc-remedy-bus-${p.id}`} className={box} disabled={locked} value=""
                        onChange={e => { const a = Number(e.target.value); if (a > 0) void apply(answerPanel(t, p.id, { busbarRatingA: a })); }}>
                  <option value="">Choose…</option>
                  {remedies.upgradeBus.map(r => <option key={r.amps} value={r.amps}>{r.amps} A — allows {r.allowsA} A</option>)}
                </select>
              </label>
            ) : null}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">A derated main must still carry the calculated load.</div>
        </div>
      ) : null}
    </div>
  );
}

// ── Available fault current ─────────────────────────────────────────────────

function FaultCurrentRow({ t, item, locked, apply }: {
  t: ServiceTopology; item: InterviewItem; locked: boolean; apply: ApplyAnswer;
}) {
  const afc = t.service.availableFaultCurrentA;
  return (
    <div data-testid="svc-fault-current-row" data-state={item.state}
         className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
      <span className="font-semibold text-slate-300">Available fault current</span>
      <input type="number" min={0} step={0.5} data-testid="svc-fault-current" key={afc ?? 'none'}
             className={`w-20 ${box}`} disabled={locked} placeholder="kA"
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
      <ProvenanceChip compact source={item.source} />
    </div>
  );
}

export default ExistingElectricalServiceCard;
