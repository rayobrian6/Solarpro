'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM CONFIG — ONE QUESTION, ANYWHERE IT IS ASKED.
//
// Ray (System Config UX correction V3): "The existing System Config sections must become smarter and
// absorb the engineering questions that naturally belong there." The five-card questionnaire that sat
// above the grid is gone; each question is now asked in its home card, in a dialog ([Answer Next],
// the guided strip), or in the Review Engineering modal — and every one of those renders the SAME
// editor, from here.
//
//   · ItemEditor     — the editor for one interview item id (the switch that used to live inside the
//                      five-card SystemConfigInterview), reusing SystemEquipmentEditor /
//                      UtilityDisconnectsEditor / LoadAnalysisEditor / PvLandingEditor as they are.
//   · QuestionDialog — an accessible modal: the question, its provenance, why / owner / blocks behind
//                      [?], the ItemEditor, and a close button. It closes after a successful write.
//   · ItemRow, ProvenanceChip, SystemConfigModal — the small parts the cards and panels share.
//
// Every edit goes through `lib/electrical/systemConfigAnswers.ts` (and its sibling answer modules)
// into `apply` — the page's one write path — or, for the PV coupling, through `onRecordCoupling`,
// the architecture decision route. Nothing here holds engineering state.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceTopology, SolarCoupling, BackupDomain } from '@/lib/electrical/serviceTopology';
import type { PvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import type { FactSource, InterviewItem } from '@/lib/electrical/systemConfigInterview';
import {
  answerStorageLanding, answerSystemsArrangement, answerInterconnection,
  answerIsolationRequired, answerIsolationArrangement, answerIsolationAccepted,
  type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import {
  DISCONNECT_ITEM_PREFIX, METER_COLLAR_ITEM_ID, UTILITY_ITEM_PREFIX, disconnectRoleOf,
} from '@/lib/electrical/systemConfigUtilityDisconnects';
import { SYSTEM_EQUIPMENT_PREFIX, parseSystemEquipmentItemId } from '@/lib/electrical/systemConfigSystemEquipment';
import { LOAD_ANALYSIS_ITEM_ID } from '@/lib/electrical/systemConfigLoadAnalysis';
import { CARD_TITLE, PV_STRING_ASSIGNMENT_NEED, homeOf } from '@/lib/electrical/systemConfigPlacement';
import { UtilityDisconnectsEditor } from '@/components/engineering/systemConfig/UtilityDisconnectsEditor';
import { SystemEquipmentEditor, type SystemEquipmentSelection } from '@/components/engineering/systemConfig/SystemEquipmentEditor';
import { LoadAnalysisEditor } from '@/components/engineering/systemConfig/LoadAnalysisEditor';
import { ExistingServiceVerifyForm } from '@/components/engineering/systemConfig/cards/ExistingServiceVerifyForm';
import {
  DistributionControl, ElectricalSystemSelect, ExistingServiceLine, FaultCurrentRow, PanelRow, ServiceRatingSelect,
} from '@/components/engineering/systemConfig/cards/ServiceControls';
import { EXISTING_SERVICE_NEED_PREFIX, existingNeedField } from '@/lib/electrical/systemConfigServiceCard';
import { StringAssignmentEditor } from '@/components/engineering/systemConfig/StringAssignmentEditor';

export type { SystemEquipmentSelection };

const box = 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-100 border border-slate-700';

// ── The contract every card / dialog uses ───────────────────────────────────

/**
 * Write an answer. True only when the answer was accepted AND the page's PUT succeeded — an editor
 * clears what the installer typed on true alone, so a failed write never throws the answer away.
 */
export type ApplyAnswer = (r: AnswerResult) => Promise<boolean>;

/** The page's read of the service graph (`svcTopologyRead`). */
export type GraphRead = 'loading' | 'absent' | 'failed' | 'loaded';

/**
 * Why nothing may be written over the graph in this read state — null ⇔ an answer may be written.
 *
 * 🚨 A NULL GRAPH WHOSE READ FAILED IS NOT "NO SERVICE YET", and a graph being re-read after a write
 * is not the stored one. An answer is computed FROM the graph in hand; written while the read is
 * loading or failed, its PUT replaces a stored graph nobody could see (Ray's 400 A two-gateway job,
 * overwritten by a fresh 200 A one-panel graph), or the previous answer still on its way back.
 */
export function unreadGraphRefusal(read: GraphRead | null | undefined): string | null {
  if (read === 'failed') {
    return 'The service could not be read. Nothing is written over it until it can be — reload to try again.';
  }
  if (read === 'loading') return 'The service is being read. Answer again once it has loaded.';
  return null;
}

/**
 * The page's write, refused while the graph is unread. It wraps the ONE write path
 * (`writeInterviewAnswer`), so every caller — the cards, the question dialog, the guided strip,
 * [Answer Next], Review Engineering — gets the same guard, whatever its own UI does.
 */
export function guardGraphRead(
  onWrite: (next: ServiceTopology, what: string) => Promise<boolean>,
  readState: () => GraphRead | null | undefined,
  onRefused?: (why: string) => void,
): (next: ServiceTopology, what: string) => Promise<boolean> {
  return async (next, what) => {
    const why = unreadGraphRefusal(readState());
    if (why) { onRefused?.(why); return false; }
    return onWrite(next, what);
  };
}

/** What every editor needs besides the item: the graph, the Design array and the equipment. */
export interface ItemEditorContext {
  topology: ServiceTopology | null;
  pvArray: PvArrayDesign;
  /** Panel counts of the strings the engine derived for this array, in order. */
  derivedStrings: number[];
  equipment: SystemEquipmentSelection;
  busy: boolean;
  apply: ApplyAnswer;
  /** Records the PV coupling through the architecture decision route (`behavior.pv-connection`). */
  onRecordCoupling?: (coupling: SolarCoupling) => Promise<boolean>;
  /**
   * The page's read of the graph. While it is loading or FAILED, editors are disabled and say why;
   * the write path itself refuses as well (`guardGraphRead`).
   */
  graphRead?: GraphRead;
}

export interface ItemEditorProps extends ItemEditorContext {
  item: InterviewItem;
}

/**
 * An `apply` over the page's write path. A refused answer (the writer's own refusal, with its
 * reason) is reported to `onRefused` and never written; an accepted one clears it.
 */
export function applyVia(
  onWrite: (next: ServiceTopology, what: string) => Promise<boolean>,
  onRefused?: (why: string | null) => void,
): ApplyAnswer {
  return async r => {
    if (r.ok === false) { onRefused?.(r.refused); return false; }
    onRefused?.(null);
    return onWrite(r.topology, r.did);
  };
}

/** Items whose editor takes several separate writes (a dialog stays open between them). */
export function isMultiFieldItem(itemId: string): boolean {
  return itemId.startsWith('service.panel.') || itemId === 'service.existing' || itemId === 'behavior.isolation'
    || itemId.startsWith(DISCONNECT_ITEM_PREFIX) || itemId === LOAD_ANALYSIS_ITEM_ID;
}

/** Does `ItemEditor` render a control for this item? (False ⇒ it is a fact, or answered elsewhere.) */
export function hasItemEditor(item: InterviewItem, t: ServiceTopology | null): boolean {
  const id = item.id;
  if (id === 'service.rating') return true;
  if (id === 'behavior.pv-connection') return !!item.options;
  if (!t) return false;
  if (id.startsWith(EXISTING_SERVICE_NEED_PREFIX)) return !!t.service.existingEquipment;
  if (id.startsWith(UTILITY_ITEM_PREFIX)) return id === METER_COLLAR_ITEM_ID && !!item.options;
  if (id.startsWith(DISCONNECT_ITEM_PREFIX)) return disconnectRoleOf(id) !== null;
  if (id.startsWith(SYSTEM_EQUIPMENT_PREFIX)) {
    const p = parseSystemEquipmentItemId(id);
    return !!p && t.domains.some(d => d.id === p.domainId);
  }
  if (id === 'behavior.backup' || id === LOAD_ANALYSIS_ITEM_ID) return true;
  if (id === 'service.system' || id === 'service.existing' || id === 'service.fault-current' || id === 'behavior.pv-landing') return true;
  // One inverting unit: the engine's "assign the strings" need IS the question (nothing else asks it).
  if (id === PV_STRING_ASSIGNMENT_NEED) return true;
  if (id.startsWith('service.panel.')) return t.panels.some(p => id === `service.panel.${p.id}`);
  if (id === 'service.distribution' || id === 'behavior.storage-landing' || id === 'behavior.systems'
    || id === 'behavior.interconnection' || id === 'behavior.isolation') return !!item.options;
  return false;
}

// ── Provenance ──────────────────────────────────────────────────────────────

const SOURCE_SHORT: Record<FactSource, string> = {
  'From Design': 'Design',
  'Installer entered': 'Installer',
  'Installer decision': 'Decision',
  'Selected equipment': 'Equipment',
  'Manufacturer specification': 'Mfr spec',
  'SolarPro calculation': 'SolarPro',
  'Utility / AHJ ruling required': 'Utility / AHJ',
  'Not established': 'Not set',
};
const SOURCE_TONE: Record<FactSource, string> = {
  'From Design': 'border-sky-500/30 text-sky-300',
  'Installer entered': 'border-slate-600 text-slate-300',
  'Installer decision': 'border-indigo-500/40 text-indigo-300',
  'Selected equipment': 'border-slate-600 text-slate-300',
  'Manufacturer specification': 'border-violet-500/40 text-violet-300',
  'SolarPro calculation': 'border-emerald-500/30 text-emerald-300',
  'Utility / AHJ ruling required': 'border-amber-500/40 text-amber-300',
  'Not established': 'border-dashed border-slate-600 text-slate-500',
};

/** Where a fact came from — a subtle chip; the full words are its title. */
export function ProvenanceChip({ source, compact = false, testid }: {
  source?: FactSource | null; compact?: boolean; testid?: string;
}) {
  if (!source) return null;
  return (
    <span data-testid={testid} data-source={source} title={source}
          className={`inline-block whitespace-nowrap rounded-full border px-1.5 py-px text-[9px] font-semibold leading-tight ${SOURCE_TONE[source] ?? 'border-slate-600 text-slate-400'}`}>
      {compact ? SOURCE_SHORT[source] ?? source : source}
    </span>
  );
}

// ── One item, as a row (Review Engineering, cards) ──────────────────────────

/** The question, its answer and provenance, and — when something is owed — why, who and what it blocks. */
export function ItemRow({ item, children, isNext }: { item: InterviewItem; children?: React.ReactNode; isNext?: boolean }) {
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
        {item.source ? <span className="ml-auto"><ProvenanceChip source={item.source} /></span> : null}
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

// ── A modal ─────────────────────────────────────────────────────────────────

/** Open modals, innermost last — Escape closes only the innermost. */
const openModals: symbol[] = [];

/**
 * A dialog over the page: role="dialog", aria-modal, labelled by its title, Escape and the backdrop
 * close it, focus moves into it on open and back to where it was on close. Rendered into
 * document.body so no card's overflow or transform can clip it.
 */
export function SystemConfigModal({ open, onClose, titleId, testid, wide = false, children }: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  testid: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const me = Symbol('modal');
    openModals.push(me);
    const before = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openModals[openModals.length - 1] !== me) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = openModals.indexOf(me);
      if (at >= 0) openModals.splice(at, 1);
      before?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  const node = (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
         onMouseDown={e => { if (e.target === e.currentTarget) closeRef.current(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid={testid}
           className={`mt-10 w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl outline-none`}>
        {children}
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}

// ── The question dialog ─────────────────────────────────────────────────────

export interface QuestionDialogProps extends ItemEditorContext {
  /** The item to ask, read from the LIVE interview each render; null ⇒ closed. */
  item: InterviewItem | null;
  onClose: () => void;
  /** The page's write error (the PUT failed), shown inside the dialog. */
  error?: string | null;
  /** Close after a successful write. Default: yes, except for items edited in several writes. */
  closeOnWrite?: boolean;
  /** Told after every successful write from this dialog. */
  onAnswered?: (itemId: string) => void;
  /** When the item has no editor here: take the installer to the card that answers it. */
  onGoToCard?: (itemId: string) => void;
}

const STATE_WORD: Record<InterviewItem['state'], string> = {
  'answered': 'Answered',
  'needs-answer': 'Needs your answer',
  'derived': 'Derived — confirm',
  'calculated': 'Calculated',
  'needs-verification': 'Needs verification',
  'fails': 'Fails',
};

export function QuestionDialog(props: QuestionDialogProps) {
  const { item, onClose } = props;
  const titleId = useId();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const itemId = item?.id ?? null;
  useEffect(() => { setRefusal(null); setSaved(false); }, [itemId]);

  const closeOnWrite = props.closeOnWrite ?? (itemId ? !isMultiFieldItem(itemId) : true);
  const after = (ok: boolean): boolean => {
    if (ok && itemId) {
      props.onAnswered?.(itemId);
      if (closeOnWrite) onClose(); else setSaved(true);
    }
    return ok;
  };
  const apply: ApplyAnswer = async r => {
    if (r.ok === false) { setRefusal(r.refused); return false; }
    setRefusal(null);
    return after(await props.apply(r));
  };
  const record = props.onRecordCoupling;
  const onRecordCoupling = record ? async (c: SolarCoupling) => after(await record(c)) : undefined;

  if (!item) return null;
  const home = homeOf(item.id);
  const editable = hasItemEditor(item, props.topology);
  const unread = unreadGraphRefusal(props.graphRead);
  return (
    <SystemConfigModal open onClose={onClose} titleId={titleId} testid="question-dialog">
      <div data-item-id={item.id} data-state={item.state} className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {CARD_TITLE[home]} · <span data-testid="question-state">{STATE_WORD[item.state]}</span>
            </div>
            <h2 id={titleId} className="mt-0.5 text-sm font-extrabold text-slate-100">{item.question}</h2>
          </div>
          <button type="button" data-testid="question-dialog-close" aria-label="Close"
                  className="rounded px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  onClick={onClose}>×</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {item.answer ? <span className="text-slate-300" data-testid="question-answer">{item.answer}</span> : null}
          <ProvenanceChip source={item.source} testid="question-provenance" />
          {item.why || item.owner || item.blocks?.length ? (
            <details data-testid="question-help" className="text-[11px] text-slate-400">
              <summary aria-label="Why this is asked" title="Why this is asked"
                       className="inline-block cursor-pointer rounded-full border border-slate-600 px-1.5 text-[10px] font-black text-slate-300">?</summary>
              <div className="mt-1 space-y-0.5">
                {item.why ? <div>{item.why}</div> : null}
                {item.owner ? <div className="text-slate-500">Answer from: {item.owner}</div> : null}
                {item.blocks?.length ? <div className="text-slate-500">Blocks: {item.blocks.join(', ')}</div> : null}
              </div>
            </details>
          ) : null}
        </div>

        {refusal ? (
          <div data-testid="answer-refusal" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">{refusal}</div>
        ) : null}
        {props.error ? (
          <div data-testid="question-error" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{props.error}</div>
        ) : null}
        {unread ? (
          <div data-testid="question-unread" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">{unread}</div>
        ) : null}

        {editable ? (
          <div data-testid="question-editor">
            <ItemEditor item={item} topology={props.topology} pvArray={props.pvArray} derivedStrings={props.derivedStrings}
                        equipment={props.equipment} busy={props.busy || unread !== null} apply={apply}
                        onRecordCoupling={onRecordCoupling} graphRead={props.graphRead} />
          </div>
        ) : (
          <div data-testid="question-no-editor" className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-2 text-[11px] text-slate-400">
            {home === 'readiness' || home === 'summary'
              ? `Nothing to enter here — ${item.owner ?? 'this is a fact SolarPro reads from its owner'}.`
              : `Answered on the ${CARD_TITLE[home]} card.`}
            {props.onGoToCard && home !== 'readiness' ? (
              <button type="button" data-testid="question-go-to-card"
                      className="ml-2 font-bold text-sky-300 hover:text-sky-200"
                      onClick={() => { props.onGoToCard!(item.id); onClose(); }}>
                Go to {CARD_TITLE[home]}
              </button>
            ) : null}
          </div>
        )}

        {saved ? (
          <div data-testid="question-saved" className="text-[11px] text-emerald-300">
            Saved — the engineering re-evaluates with this answer.
          </div>
        ) : null}
        <div className="flex justify-end">
          <button type="button" data-testid="question-dialog-done" onClick={onClose}
                  className="rounded border border-slate-600 px-3 py-1 text-xs font-bold text-slate-200 hover:bg-slate-800">
            {saved ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </SystemConfigModal>
  );
}

// ── The editor for one item id ──────────────────────────────────────────────

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

/** The existing editor for an interview item id — the same control wherever the item is asked. */
export function ItemEditor(props: ItemEditorProps) {
  const { item, topology: t, apply, busy } = props;
  const id = item.id;
  if (id.startsWith(UTILITY_ITEM_PREFIX) || id.startsWith(DISCONNECT_ITEM_PREFIX)) {
    return <UtilityDisconnectsEditor item={item} topology={t} apply={apply} busy={busy} />;
  }
  if (id.startsWith(SYSTEM_EQUIPMENT_PREFIX) || id === 'behavior.backup') {
    return <SystemEquipmentEditor item={item} topology={t} apply={apply} busy={busy} equipment={props.equipment} />;
  }
  if (id.startsWith(LOAD_ANALYSIS_ITEM_ID)) return <LoadAnalysisEditor item={item} topology={t} apply={apply} busy={busy} />;

  // 🚨 THE SERVICE QUESTIONS USE THE SERVICE CARD'S OWN CONTROLS (`cards/ServiceControls.tsx`): the
  // same ladders (175 A is a main breaker rating), the recorded value always offered, a fault-current
  // typo refused, a destructive answer confirmed, no preset panel ratings — wherever they are asked.
  if (id === 'service.rating') {
    return <ServiceRatingSelect t={t} item={item} ids="answer" disabled={busy} apply={apply} />;
  }
  if (id === 'service.system' && t) {
    return <ElectricalSystemSelect t={t} item={item} ids="answer" disabled={busy} apply={apply} />;
  }
  // What the engine still needs read off an existing assembly is answered in the Service card's
  // [Verify] form — the same form here, so [Answer Next] can ask it where it stands.
  if (id.startsWith(EXISTING_SERVICE_NEED_PREFIX) && t?.service.existingEquipment) {
    const field = existingNeedField(id);
    return <ExistingServiceVerifyForm t={t} apply={apply} busy={busy} needed={field ? [field] : []} />;
  }
  if (id === 'service.existing' && t) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-300">
          <ExistingServiceLine t={t} ids="answer" disabled={busy} apply={apply} />
        </div>
        {t.service.existingEquipment ? <ExistingServiceVerifyForm t={t} apply={apply} busy={busy} /> : null}
      </div>
    );
  }
  if (id === 'service.fault-current' && t) {
    return <FaultCurrentRow t={t} item={item} ids="answer" disabled={busy} apply={apply} />;
  }
  if (id === 'service.distribution' && t && item.options) {
    return <DistributionControl t={t} item={item} ids="answer" disabled={busy} apply={apply} />;
  }
  if (id.startsWith('service.panel.') && t) {
    const panelId = id.slice('service.panel.'.length);
    const p = t.panels.find(x => x.id === panelId);
    if (!p) return null;
    return <PanelRow t={t} panel={p} item={item} ids="answer" disabled={busy} apply={apply} />;
  }
  if (id === 'behavior.pv-connection' && item.options) {
    const record = props.onRecordCoupling;
    // In conflict ('fails') the coupling on file is one side of the dispute, not an answer: nothing is
    // pre-checked, so either side — the one on file included — can be chosen and recorded.
    return (
      <Radio name="pv-connection" testid="answer-pv-connection" options={item.options}
             value={item.state === 'fails' ? null : item.value}
             disabled={busy || !t || !record}
             onPick={v => { if (record) void record(v as SolarCoupling); }} />
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
  if ((id === 'behavior.pv-landing' || id === PV_STRING_ASSIGNMENT_NEED) && t) {
    return <PvLandingEditor t={t} pvArray={props.pvArray} strings={props.derivedStrings} apply={apply} busy={busy} />;
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

/**
 * "String i → unit #n": which battery's PV inputs each derived string lands on — the String
 * assignment editor (recommendation + Accept / Edit, rows, Save) the Inverters & Strings card opens
 * from [Review]. One write, on Accept or Save.
 */
export function PvLandingEditor({ t, pvArray, strings, apply, busy }: {
  t: ServiceTopology; pvArray: PvArrayDesign; strings: number[]; apply: ApplyAnswer; busy: boolean;
}) {
  return <StringAssignmentEditor t={t} pvArray={pvArray} strings={strings} apply={apply} busy={busy} />;
}

export default ItemEditor;
