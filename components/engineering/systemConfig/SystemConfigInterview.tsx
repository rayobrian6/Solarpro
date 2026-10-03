'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM CONFIG — THE INSTALLER'S INTERVIEW.
//
// Five cards, in the order an installer thinks:
//   1 PV Design           what SolarPro already knows from Design
//   2 Existing Service     what the building has
//   3 Equipment            what we are installing
//   4 Behavior & Connection how it works and where it connects
//   5 Engineering Result   what SolarPro concluded, and what blocks release
//
// The questions, their relevance and their answers come from `buildSystemConfigInterview` (pure,
// tested). Every edit goes through `lib/electrical/systemConfigAnswers.ts` into the service graph's
// one write path, or — for the PV coupling — through the architecture decision route that records
// who decided it. This component holds no engineering state of its own.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import type { ServiceTopology, SolarCoupling, BackupDomain } from '@/lib/electrical/serviceTopology';
import { SERVICE_PHASES, servicePhaseInfo } from '@/lib/electrical/serviceTopology';
import type { PvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import type {
  SystemConfigInterview as Interview, InterviewItem, InterviewSection, SectionId,
} from '@/lib/electrical/systemConfigInterview';
import {
  answerServiceRating, answerElectricalSystem, answerDistribution, answerPanel,
  answerStorageLanding, answerSystemsArrangement, answerInterconnection,
  answerIsolationRequired, answerIsolationArrangement, answerIsolationAccepted, answerPvLanding,
  answerAvailableFaultCurrent, answerExistingService, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { UtilityDisconnectsEditor } from '@/components/engineering/systemConfig/UtilityDisconnectsEditor';
import { SystemEquipmentEditor } from '@/components/engineering/systemConfig/SystemEquipmentEditor';
import { LoadAnalysisEditor } from '@/components/engineering/systemConfig/LoadAnalysisEditor';

const SERVICE_RATINGS = [100, 125, 150, 200, 225, 320, 400, 600, 800];
const PANEL_RATINGS = [100, 125, 150, 200, 225, 320, 400];
const SYSTEMS: Array<[string, string]> = SERVICE_PHASES.map(ph => [ph, servicePhaseInfo(ph).label]);

export interface SystemConfigInterviewProps {
  interview: Interview;
  topology: ServiceTopology | null;
  pvArray: PvArrayDesign;
  /** Panel counts of the strings the engine derived for this array, in order. */
  derivedStrings: number[];
  equipment: {
    gatewayProductId: string | null;
    storageProductId: string | null;
    storageLabel: string | null;
    totalUnits: number;
  };
  mode: 'auto' | 'guided' | 'manual';
  busy: boolean;
  error: string | null;
  onWrite: (next: ServiceTopology, what: string) => Promise<boolean>;
  onRecordCoupling: (coupling: SolarCoupling) => Promise<boolean>;
  /** The equipment pickers the page already has, rendered inside card 3. */
  equipmentSlot?: React.ReactNode;
}

const chip = (s: InterviewSection['status']) =>
  s === 'complete' ? { icon: '✓', cls: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10', word: 'Complete' }
    : s === 'fails' ? { icon: '✕', cls: 'border-rose-500/40 text-rose-300 bg-rose-500/10', word: 'Fails' }
      : s === 'needs-verification' ? { icon: '!', cls: 'border-amber-500/40 text-amber-300 bg-amber-500/10', word: 'Needs verification' }
        : { icon: '?', cls: 'border-sky-500/40 text-sky-300 bg-sky-500/10', word: 'Needs your answer' };

const box = 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-100 border border-slate-700';

export function SystemConfigInterview(props: SystemConfigInterviewProps) {
  const { interview, topology: t, mode, busy } = props;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [open, setOpen] = useState<Partial<Record<SectionId, boolean>>>({});

  /** True only when the answer was accepted AND the page's PUT succeeded — an editor clears what the
   *  installer typed on true alone, so a failed write never throws the answer away. */
  const apply = async (r: AnswerResult): Promise<boolean> => {
    if (r.ok === false) { setRefusal(r.refused); return false; }
    setRefusal(null);
    return props.onWrite(r.topology, r.did);
  };

  // One engineering state, three ways through it (the owners are the same in every mode):
  //   · MANUAL — every card open; the installer drives.
  //   · GUIDED — one question at a time: only the card holding the NEXT open question is open, and
  //     that question is marked. Answering it moves the interview on.
  //   · AUTO   — every card that still needs something is open; complete cards collapse.
  // The Engineering Result card is always open — it is what every answer is for.
  const next = interview.openQuestions[0] ?? null;
  const isOpen = (s: InterviewSection) =>
    open[s.id] ?? (mode === 'manual' || s.id === 'engineering'
      || (mode === 'guided' ? (next ? next.section === s.id : s.status !== 'complete') : s.status !== 'complete'));

  return (
    <div data-testid="system-config-interview" className="space-y-3">
      <ReleaseBanner interview={interview} />
      {refusal ? (
        <div data-testid="interview-refusal" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
          {refusal}
        </div>
      ) : null}
      {props.error ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{props.error}</div>
      ) : null}
      {interview.sections.map((s, i) => {
        const c = chip(s.status);
        const expanded = isOpen(s);
        return (
          <section key={s.id} data-testid={`interview-section-${s.id}`} data-status={s.status}
                   className="eng-panel">
            <button type="button" className="flex w-full items-center gap-2 text-left"
                    onClick={() => setOpen(o => ({ ...o, [s.id]: !expanded }))}>
              <span className="text-xs font-black text-slate-500">{i + 1}</span>
              <span className="text-sm font-extrabold tracking-tight text-slate-100">{s.title}</span>
              <span className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-bold ${c.cls}`}>
                {c.icon} {c.word}
              </span>
              <span className="ml-auto truncate text-[11px] text-slate-400" data-testid={`interview-summary-${s.id}`}>
                {s.summary}
              </span>
            </button>
            {expanded ? (
              <div className="mt-3 space-y-2">
                {s.id === 'equipment' && props.equipmentSlot ? (
                  <div className="space-y-2">
                    {s.items.map(item => (
                      <ItemRow key={item.id} item={item} isNext={mode === 'guided' && next?.id === item.id}>
                        <Editor item={item} props={props} apply={apply} busy={busy} />
                      </ItemRow>
                    ))}
                    {props.equipmentSlot}
                  </div>
                ) : s.items.map(item => (
                  <ItemRow key={item.id} item={item} isNext={mode === 'guided' && next?.id === item.id}>
                    <Editor item={item} props={props} apply={apply} busy={busy} />
                  </ItemRow>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
      {t === null ? null : (
        <div className="text-[10px] text-slate-500">
          Answers are written to the project’s service model — the same one the single-line diagram,
          the BOM and the permit read.
        </div>
      )}
    </div>
  );
}

function ReleaseBanner({ interview }: { interview: Interview }) {
  const r = interview.release;
  const open = interview.openQuestions;
  // Eligible for release is not the same as nothing left to look at: a card can still hold items to
  // review (a ruling to verify, a recorded figure an analysis superseded). "Complete" is said only
  // when every card is.
  const toReview = interview.sections.filter(s => s.status !== 'complete');
  return (
    <div data-testid="interview-release"
         data-drawable={r.drawable ? 'yes' : 'no'} data-release-ready={r.releaseReady ? 'yes' : 'no'}
         className={`rounded-xl border p-3 ${r.releaseReady
           ? 'border-emerald-500/40 bg-emerald-500/5'
           : 'border-slate-700 bg-slate-900/60'}`}>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-black text-slate-100">
          {r.releaseReady && toReview.length === 0 ? 'Engineering complete — eligible for release'
            : r.releaseReady ? `Eligible for release — ${toReview.length} card${toReview.length === 1 ? '' : 's'} to review (${toReview.map(s => s.title).join(', ')})`
            : open.length > 0 ? `${open.length} ${open.length === 1 ? 'question needs' : 'questions need'} your answer`
              : 'Engineering needs review before release'}
        </span>
        <span className={r.drawable ? 'text-emerald-300' : 'text-amber-300'}>
          {r.drawable ? 'Drawable' : 'Not drawable yet'}
        </span>
        <span className={r.releaseReady ? 'text-emerald-300' : 'text-amber-300'}>
          {r.releaseReady ? 'Release eligible' : 'Release blocked'}
        </span>
      </div>
      {!r.releaseReady && r.blockers.length > 0 ? (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[11px] text-slate-400" data-testid="interview-blockers">
          {r.blockers.slice(0, 6).map((b, i) => <li key={i}>{b}</li>)}
          {r.blockers.length > 6 ? <li>…and {r.blockers.length - 6} more</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function ItemRow({ item, children, isNext }: { item: InterviewItem; children?: React.ReactNode; isNext?: boolean }) {
  const tone = item.state === 'answered' || item.state === 'calculated' ? 'text-slate-200'
    : item.state === 'fails' ? 'text-rose-300'
      : item.state === 'needs-answer' ? 'text-sky-200' : 'text-amber-200';
  return (
    <div data-testid={`interview-item-${item.id}`} data-state={item.state} data-next={isNext ? 'true' : undefined}
         className={`rounded-lg border p-2 ${isNext ? 'border-sky-400 bg-sky-500/10' : 'border-slate-700/60 bg-slate-900/40'}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        {isNext ? (
          <span data-testid="interview-next" className="rounded-full bg-sky-500 px-1.5 text-[10px] font-black text-white">NEXT</span>
        ) : null}
        <span className={`text-xs font-bold ${tone}`}>{item.question}</span>
        {item.answer ? <span className="text-xs text-slate-300" data-testid={`interview-answer-${item.id}`}>{item.answer}</span> : null}
        {item.source ? <span className="ml-auto text-[10px] text-slate-500">{item.source}</span> : null}
      </div>
      {/* A FAIL says why, too: a red verdict with no reason is not a next step. */}
      {(item.state === 'needs-answer' || item.state === 'needs-verification' || item.state === 'fails') && item.why ? (
        <div className="mt-1 text-[11px] text-slate-400">
          {item.why}
          {item.owner ? <span className="text-slate-500"> · Answer from: {item.owner}</span> : null}
          {item.blocks?.length ? <span className="text-slate-500"> · Blocks: {item.blocks.join(', ')}</span> : null}
        </div>
      ) : null}
      {children ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}

// ── Editors ─────────────────────────────────────────────────────────────────

function Radio({ name, options, value, onPick, disabled, testid }: {
  name: string; options: { value: string; label: string; detail?: string }[]; value: string | null | undefined;
  onPick: (v: string) => void; disabled?: boolean; testid: string;
}) {
  return (
    <div className="space-y-1">
      {options.map(o => (
        <label key={o.value} data-testid={`${testid}-${o.value}`}
               className={`flex cursor-pointer items-start gap-2 rounded border p-1.5 text-xs ${value === o.value
                 ? 'border-sky-400 bg-sky-500/10' : 'border-slate-800 hover:border-slate-600'}`}>
          <input type="radio" name={name} className="mt-0.5" checked={value === o.value} disabled={disabled}
                 onChange={() => onPick(o.value)} />
          <span>
            <span className="block font-bold text-slate-100">{o.label}</span>
            {o.detail ? <span className="block text-[11px] text-slate-400">{o.detail}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

function Editor({ item, props, apply, busy }: {
  item: InterviewItem; props: SystemConfigInterviewProps; apply: (r: AnswerResult) => Promise<boolean>; busy: boolean;
}) {
  const t = props.topology;
  const id = item.id;
  if (id.startsWith('behavior.utility.') || id.startsWith('engineering.disconnect.')) return <UtilityDisconnectsEditor item={item} topology={t} apply={apply} busy={busy} />;

  if (id.startsWith('equipment.system.') || id === 'behavior.backup') return <SystemEquipmentEditor item={item} topology={t} apply={apply} busy={busy} equipment={props.equipment} />;
  if (id.startsWith('engineering.loads')) return <LoadAnalysisEditor item={item} topology={t} apply={apply} busy={busy} />;

  if (id === 'service.rating') {
    return (
      <select data-testid="answer-service-rating" className={box} disabled={busy}
              value={t?.service.ratedAmps ?? ''}
              onChange={e => { const a = Number(e.target.value); if (a > 0) void apply(answerServiceRating(t, a)); }}>
        <option value="">Choose…</option>
        {SERVICE_RATINGS.map(a => <option key={a} value={a}>{a} A</option>)}
      </select>
    );
  }
  if (id === 'service.system' && t) {
    return (
      <select data-testid="answer-electrical-system" className={box} disabled={busy} value={String(t.service.phase)}
              onChange={e => void apply(answerElectricalSystem(t, e.target.value))}>
        {SYSTEMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    );
  }
  if (id === 'service.existing' && t) {
    const ex = t.service.existingEquipment ?? null;
    return (
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
        <label className="flex items-center gap-1">
          <input type="checkbox" data-testid="answer-existing-service" checked={ex !== null} disabled={busy}
                 onChange={e => void apply(answerExistingService(t, { existing: e.target.checked }))} />
          Existing equipment on the wall
        </label>
        {ex ? (
          <>
            <input data-testid="answer-existing-mfr" className={`w-28 ${box}`} placeholder="Manufacturer"
                   defaultValue={ex.manufacturer ?? ''} disabled={busy}
                   onBlur={e => { if ((e.target.value || null) !== ex.manufacturer) void apply(answerExistingService(t, { existing: true, manufacturer: e.target.value })); }} />
            <label className="flex items-center gap-1">
              <input type="checkbox" data-testid="answer-existing-verified" checked={ex.verified} disabled={busy}
                     onChange={e => void apply(answerExistingService(t, { existing: true, verified: e.target.checked }))} />
              Internals read on site
            </label>
          </>
        ) : null}
      </div>
    );
  }
  if (id === 'service.fault-current' && t) {
    return (
      <label className="flex items-center gap-2 text-[11px] text-slate-400">
        <input type="number" min={0} step={0.5} data-testid="answer-fault-current" className={`w-24 ${box}`}
               disabled={busy} placeholder="kA"
               defaultValue={t.service.availableFaultCurrentA !== null ? t.service.availableFaultCurrentA / 1000 : ''}
               onBlur={e => {
                 const ka = e.target.value === '' ? null : Number(e.target.value);
                 const amps = ka === null ? null : Math.round(ka * 1000);
                 if (amps !== t.service.availableFaultCurrentA) void apply(answerAvailableFaultCurrent(t, amps));
               }} />
        kA — from the utility
      </label>
    );
  }
  if (id === 'service.distribution' && t && item.options) {
    return (
      <Radio name="distribution" testid="answer-distribution" options={item.options} value={item.value}
             disabled={busy}
             onPick={v => void apply(answerDistribution(t, v as 'one-main-panel' | 'two-main-panels' | 'custom'))} />
    );
  }
  if (id.startsWith('service.panel.') && t) {
    const panelId = id.slice('service.panel.'.length);
    const p = t.panels.find(x => x.id === panelId);
    if (!p) return null;
    return (
      <div className="grid grid-cols-3 gap-2">
        <label className="text-[11px] text-slate-400">Main breaker
          <select data-testid={`answer-panel-main-${p.id}`} className={`mt-0.5 block w-full ${box}`} disabled={busy}
                  value={p.mainBreakerA ?? ''}
                  onChange={e => void apply(answerPanel(t, p.id, { mainBreakerA: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">—</option>
            {PANEL_RATINGS.map(a => <option key={a} value={a}>{a} A</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-400">Busbar
          <select data-testid={`answer-panel-bus-${p.id}`} className={`mt-0.5 block w-full ${box}`} disabled={busy}
                  value={p.busbarRatingA ?? ''}
                  onChange={e => void apply(answerPanel(t, p.id, { busbarRatingA: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">—</option>
            {PANEL_RATINGS.map(a => <option key={a} value={a}>{a} A</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-400">Manufacturer
          <input data-testid={`answer-panel-mfr-${p.id}`} className={`mt-0.5 block w-full ${box}`} disabled={busy}
                 defaultValue={p.manufacturer ?? ''} placeholder="e.g. Eaton"
                 onBlur={e => { if ((e.target.value || null) !== (p.manufacturer ?? null)) void apply(answerPanel(t, p.id, { manufacturer: e.target.value })); }} />
        </label>
      </div>
    );
  }
  if (id === 'behavior.pv-connection' && item.options) {
    return (
      <Radio name="pv-connection" testid="answer-pv-connection" options={item.options} value={item.value}
             disabled={busy || !t}
             onPick={v => { void props.onRecordCoupling(v as SolarCoupling); }} />
    );
  }
  if (id === 'behavior.storage-landing' && t && item.options) {
    return (
      <div className="space-y-2">
        <Radio name="storage-landing" testid="answer-storage-landing" options={item.options} value={item.value}
               disabled={busy}
               onPick={v => void apply(answerStorageLanding(t, v as Exclude<BackupDomain['storageConnection'], 'unresolved'>))} />
        {t.domains.length > 1 ? (
          <div className="text-[10px] text-slate-500">Applies to all {t.domains.length} systems.</div>
        ) : null}
      </div>
    );
  }
  if (id === 'behavior.systems' && t && item.options) {
    return (
      <Radio name="systems" testid="answer-systems" options={item.options} value={item.value} disabled={busy}
             onPick={v => void apply(answerSystemsArrangement(t, v as 'independent-branch' | 'common-aggregation' | 'custom'))} />
    );
  }
  if (id === 'behavior.pv-landing' && t) {
    return <PvLandingEditor t={t} props={props} apply={apply} busy={busy} />;
  }
  if (id === 'behavior.interconnection' && t && item.options) {
    return (
      <Radio name="interconnection" testid="answer-interconnection" options={item.options} value={item.value}
             disabled={busy}
             onPick={v => void apply(answerInterconnection(t, v as Parameters<typeof answerInterconnection>[1]))} />
    );
  }
  if (id === 'behavior.isolation' && t && item.options) {
    const isolators = t.devices.filter(d => d.roles.includes('der-isolation-disconnect'));
    const perPath = isolators.length > 1 && isolators.every(d => !!d.inlineOnNodeId);
    const accepted = t.interconnection.isolationArrangementAccepted ?? null;
    return (
      <div className="space-y-2">
        <select data-testid="answer-isolation-required" className={box} disabled={busy} value={item.value ?? 'unknown'}
                onChange={e => void apply(answerIsolationRequired(t, e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null))}>
          {item.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {t.interconnection.externalDerIsolationRequired === true && t.branches.length > 1 ? (
          <Radio name="isolation-arrangement" testid="answer-isolation-arrangement" disabled={busy}
                 value={isolators.length === 0 ? null : perPath ? 'one-per-path' : 'common-service'}
                 options={[
                   { value: 'one-per-path', label: 'One switch per system', detail: 'Each path isolated on its own, rated for that path.' },
                   { value: 'common-service', label: 'One switch for the whole service' },
                 ]}
                 onPick={v => void apply(answerIsolationArrangement(t, v as 'one-per-path' | 'common-service'))} />
        ) : null}
        {isolators.length > 0 ? (
          <label className="block text-[11px] text-slate-400">Utility / AHJ acceptance of this arrangement
            <select data-testid="answer-isolation-accepted" className={`mt-0.5 block ${box}`} disabled={busy}
                    value={accepted === true ? 'yes' : accepted === false ? 'no' : 'unknown'}
                    onChange={e => void apply(answerIsolationAccepted(t, e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null))}>
              <option value="unknown">Needs verification</option>
              <option value="yes">Utility / AHJ confirmed</option>
              <option value="no">Not accepted</option>
            </select>
          </label>
        ) : null}
      </div>
    );
  }
  return null;
}

function PvLandingEditor({ t, props, apply, busy }: {
  t: ServiceTopology; props: SystemConfigInterviewProps; apply: (r: AnswerResult) => Promise<boolean>; busy: boolean;
}) {
  const units = t.storage.filter(u => u.role === 'inverter-unit');
  const strings = props.derivedStrings;
  const [landing, setLanding] = useState<Record<number, string>>({});
  const watts = props.pvArray.module?.watts ?? null;
  const count = props.pvArray.moduleCount ?? 0;
  const perUnit = useMemo(() => {
    const m: Record<string, number[]> = {};
    strings.forEach((n, i) => { const u = landing[i]; if (u) (m[u] ??= []).push(n); });
    return m;
  }, [landing, strings]);
  if (strings.length === 0 || !watts) {
    return <div className="text-[11px] text-amber-300">The strings have not been derived yet, so there is nothing to land.</div>;
  }
  return (
    <div className="space-y-1">
      {strings.map((n, i) => (
        <label key={i} className="flex items-center gap-2 text-[11px] text-slate-300">
          String {i + 1} ({n} modules) →
          <select data-testid={`answer-pv-landing-${i}`} className={box} disabled={busy} value={landing[i] ?? ''}
                  onChange={e => setLanding(l => ({ ...l, [i]: e.target.value }))}>
            <option value="">Choose a unit…</option>
            {units.map((u, k) => <option key={u.id} value={u.id}>{u.label ?? u.productId} #{k + 1}</option>)}
          </select>
        </label>
      ))}
      <button type="button" data-testid="answer-pv-landing-save" disabled={busy || Object.keys(landing).length !== strings.length}
              className="mt-1 rounded bg-sky-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
              onClick={() => void apply(answerPvLanding(t, perUnit, watts, count))}>
        Record where each string lands
      </button>
    </div>
  );
}

export default SystemConfigInterview;
