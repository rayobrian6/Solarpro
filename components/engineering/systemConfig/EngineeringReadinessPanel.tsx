'use client';

// ═══════════════════════════════════════════════════════════════════════════
// ENGINEERING READINESS — the one compact panel at the bottom of System Config.
//
// Ray (System Config UX correction V3): "At the bottom, one compact NASA-level ENGINEERING READINESS
// panel for leftovers, unresolved items, manufacturer constraints and release readiness. Engineering
// complexity should increase the intelligence of the controls, not the vertical length of the page."
//
//   ENGINEERING READINESS
//   20 PASS · 0 FAIL · 12 NOT EVALUATED
//   Release status: BLOCKED — 3 required answers
//   Required next actions  • … • … • …
//   [ Answer Next ]  [ Review Engineering ]
//
// The counts are the engine's own checks (the interview's `evaluation`); the required answers are
// `requiredQueue` — the same list the guided strip reads. [Answer Next] asks the top one in a
// QuestionDialog with the editor its home card uses; [Review Engineering] holds the detail: every
// verdict with its governing code, the engineering items with their editors (disconnect roles, the
// multi-gateway document, the optional load analysis), what the engine still needs and from whom.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useId, useMemo, useRef, useState } from 'react';
import type { SystemConfigInterview, InterviewItem } from '@/lib/electrical/systemConfigInterview';
import { isOptionalCheck, type TopologyCheck } from '@/lib/electrical/serviceTopology';
import { runReadiness, type EngineeredRun } from '@/lib/electrical/electricalRuns';
import {
  CARD_TITLE, findInterviewItem, homeOf, nextActionLabel, readinessCounts, releaseStatus, requiredQueue,
} from '@/lib/electrical/systemConfigPlacement';
import {
  ItemEditor, ItemRow, ProvenanceChip, QuestionDialog, SystemConfigModal, hasItemEditor,
  type ApplyAnswer, type ItemEditorContext,
} from '@/components/engineering/systemConfig/ItemEditor';

export interface EngineeringReadinessPanelProps extends ItemEditorContext {
  interview: SystemConfigInterview;
  /** The page's write error (the PUT failed). */
  error?: string | null;
  /** Take the installer to an item's home card (offered in a dialog for an item asked elsewhere). */
  onGoToCard?: (itemId: string) => void;
  /**
   * 🚨 THE ADVANCED SERVICE MODEL EDITOR — the old Service Topology screen, as a DIAGNOSTIC surface.
   * It is not in the Engineering tab bar any more (closure slice 1). It is rendered only inside Review
   * Engineering, behind a disclosure that says what it is, and only once that disclosure is opened.
   */
  advancedEditor?: React.ReactNode;
  /**
   * The service graph's conductor runs, engineered by the canonical engine (lib/electrical/
   * electricalRuns.ts) from the same facts the SLD route uses. The panel lists what the runs that are
   * not engineered still need — it never sizes anything itself.
   */
  conductorRuns?: EngineeredRun[] | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const STATUS_TONE = {
  BLOCKED: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  ELIGIBLE: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  COMPLETE: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
} as const;

const CONCLUSION_ORDER = ['FAIL', 'NOT_EVALUATED', 'PASS'] as const;
const CONCLUSION_WORD: Record<(typeof CONCLUSION_ORDER)[number], string> = {
  FAIL: 'FAIL', NOT_EVALUATED: 'NOT EVALUATED', PASS: 'PASS',
};
const CONCLUSION_TONE: Record<(typeof CONCLUSION_ORDER)[number], string> = {
  FAIL: 'text-rose-300', NOT_EVALUATED: 'text-amber-300', PASS: 'text-emerald-300',
};

export function EngineeringReadinessPanel(props: EngineeringReadinessPanelProps) {
  const { interview } = props;
  const queue = useMemo(() => requiredQueue(interview), [interview]);
  const counts = readinessCounts(interview.evaluation?.checks);
  const status = releaseStatus(interview, queue);

  const [questionId, setQuestionId] = useState<string | null>(null);
  const answeredRef = useRef(false);
  const [showRemaining, setShowRemaining] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const openQuestion = (itemId: string) => {
    answeredRef.current = false;
    setShowRemaining(false);
    setQuestionId(itemId);
  };
  const closeQuestion = () => {
    if (answeredRef.current) setShowRemaining(true);
    setQuestionId(null);
  };

  const ctx = {
    topology: props.topology, pvArray: props.pvArray, derivedStrings: props.derivedStrings,
    equipment: props.equipment, busy: props.busy, apply: props.apply, onRecordCoupling: props.onRecordCoupling,
    graphRead: props.graphRead,
  };

  return (
    <section id="engineering-readiness" data-testid="engineering-readiness" data-release={status.kind}
             className="eng-panel scroll-mt-4">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div className="min-w-[14rem] space-y-1">
          <h3 className="text-sm font-extrabold tracking-tight text-slate-100">ENGINEERING READINESS</h3>
          <div data-testid="readiness-counts" data-pass={counts.pass} data-fail={counts.fail}
               data-not-evaluated={counts.notEvaluated} className="text-xs font-bold tabular-nums">
            <span className="text-emerald-300">{counts.pass} PASS</span>
            <span className="text-slate-500"> · </span>
            <span className={counts.fail > 0 ? 'text-rose-300' : 'text-slate-300'}>{counts.fail} FAIL</span>
            <span className="text-slate-500"> · </span>
            <span className={counts.notEvaluated > 0 ? 'text-amber-300' : 'text-slate-300'}>{counts.notEvaluated} NOT EVALUATED</span>
          </div>
          <div className="text-xs text-slate-400">
            Release status:{' '}
            <span data-testid="readiness-status" data-kind={status.kind}
                  className={`rounded border px-1.5 py-px text-[11px] font-black ${STATUS_TONE[status.kind]}`}>
              {status.label}
            </span>
          </div>
        </div>

        <div className="min-w-[16rem] flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {interview.release.releaseReady ? 'Items to review' : 'Required next actions'}
          </div>
          {queue.length === 0 ? (
            <div data-testid="readiness-none" className="mt-1 text-xs text-slate-400">
              {interview.release.releaseReady ? 'Nothing required.' : 'No answer is waiting on you — see Review Engineering.'}
            </div>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {queue.slice(0, 3).map((item, i) => (
                <li key={item.id} data-testid={`readiness-next-${i}`} data-item-id={item.id}
                    className="flex items-baseline gap-2 text-xs">
                  <span className="text-slate-500">•</span>
                  <button type="button" className="text-left font-semibold text-slate-100 hover:text-sky-200"
                          onClick={() => openQuestion(item.id)}>
                    {nextActionLabel(item)}
                  </button>
                  <span className="text-[10px] text-slate-500">{CARD_TITLE[homeOf(item.id)]}</span>
                </li>
              ))}
              {queue.length > 3 ? (
                <li className="pl-4 text-[11px] text-slate-500">…and {queue.length - 3} more</li>
              ) : null}
            </ul>
          )}
          {showRemaining ? (
            <div data-testid="readiness-remaining" className="mt-1 text-[11px] font-bold text-sky-300">
              {queue.length === 0 ? 'No required answers remain' : `${plural(queue.length, 'required answer remains', 'required answers remain')}`}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 self-center">
          <button type="button" data-testid="readiness-answer-next" disabled={queue.length === 0}
                  onClick={() => queue[0] && openQuestion(queue[0].id)}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40">
            Answer Next
          </button>
          <button type="button" data-testid="readiness-review" onClick={() => setReviewOpen(true)}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800">
            Review Engineering
          </button>
        </div>
      </div>

      {props.conductorRuns && props.conductorRuns.length > 0 ? (
        <ConductorRunsReadiness runs={props.conductorRuns} />
      ) : null}

      <QuestionDialog {...ctx} item={findInterviewItem(interview, questionId)} error={props.error}
                      onClose={closeQuestion} onAnswered={() => { answeredRef.current = true; }}
                      onGoToCard={props.onGoToCard} />
      <ReviewEngineering open={reviewOpen} onClose={() => setReviewOpen(false)} interview={interview}
                         queue={queue} ctx={ctx} error={props.error} onAnswer={openQuestion}
                         advancedEditor={props.advancedEditor} />
    </section>
  );
}

// ── Conductors & raceway ────────────────────────────────────────────────────

/**
 * Ray: "If any required input is missing → NOT EVALUATED… Then Engineering Readiness tells the user
 * exactly what is missing." Each missing fact once, with how many runs wait on it; what only the
 * voltage-drop check waits on is listed apart, because it does not stop the conductors.
 */
export function ConductorRunsReadiness({ runs }: { runs: EngineeredRun[] }) {
  const rd = runReadiness(runs);
  return (
    <div data-testid="readiness-conductors" data-engineered={rd.engineered} data-not-evaluated={rd.notEvaluated}
         className="mt-3 border-t border-slate-700/60 pt-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Conductors &amp; raceway</span>
        <span className="font-bold tabular-nums text-slate-200">
          {rd.engineered} of {runs.length} runs engineered
        </span>
        {rd.notEvaluated > 0 ? <span className="font-bold text-amber-300">· {rd.notEvaluated} NOT EVALUATED</span> : null}
      </div>
      {rd.blocking.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {rd.blocking.map(item => (
            <li key={`${item.key}:${item.need}`} data-testid="readiness-conductor-need" data-key={item.key}
                className="flex items-baseline gap-2">
              <span className="text-slate-500">•</span>
              <span className="text-slate-200">{item.need}</span>
              <span className="text-[10px] text-slate-500">{plural(item.runs.length, 'run', 'runs')}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rd.voltageDrop.length > 0 ? (
        <div data-testid="readiness-conductor-vd" className="mt-1 text-[11px] text-slate-500">
          Voltage drop not evaluated — needs {rd.voltageDrop.map(i => i.need).join('; ')}.
        </div>
      ) : null}
    </div>
  );
}

// ── Review Engineering ──────────────────────────────────────────────────────

function ReviewEngineering({ open, onClose, interview, queue, ctx, error, onAnswer, advancedEditor }: {
  open: boolean;
  onClose: () => void;
  interview: SystemConfigInterview;
  queue: InterviewItem[];
  ctx: ItemEditorContext;
  error?: string | null;
  onAnswer: (itemId: string) => void;
  advancedEditor?: React.ReactNode;
}) {
  const titleId = useId();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const apply: ApplyAnswer = async r => {
    if (r.ok === false) { setRefusal(r.refused); return false; }
    setRefusal(null);
    return ctx.apply(r);
  };
  const checks: TopologyCheck[] = interview.evaluation?.checks ?? [];
  const counts = readinessCounts(checks);
  const status = releaseStatus(interview, queue);
  const eng = interview.sections.find(s => s.id === 'engineering');
  const engItems = (eng?.items ?? []).filter(i => !i.id.startsWith('engineering.needs.'));
  const needs = (eng?.items ?? []).filter(i => i.id.startsWith('engineering.needs.'));

  return (
    <SystemConfigModal open={open} onClose={onClose} titleId={titleId} testid="review-engineering" wide>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-black text-slate-100">Review Engineering</h2>
            <div className="mt-0.5 text-xs text-slate-400">
              {counts.pass} PASS · {counts.fail} FAIL · {counts.notEvaluated} NOT EVALUATED · Release status:{' '}
              <span className="font-bold text-slate-200" data-testid="review-status">{status.label}</span>
            </div>
          </div>
          <button type="button" data-testid="review-engineering-close" aria-label="Close" onClick={onClose}
                  className="rounded px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-slate-800 hover:text-slate-200">×</button>
        </div>

        {refusal ? (
          <div data-testid="answer-refusal" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">{refusal}</div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{error}</div>
        ) : null}

        {/* Release impact — what holds the release up, one line each. */}
        {!interview.release.releaseReady && interview.release.blockers.length > 0 ? (
          <div>
            <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-400">Release impact</h3>
            <ul data-testid="review-blockers" className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] text-slate-400">
              {interview.release.blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        ) : null}

        <div>
          <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-400">Required answers ({queue.length})</h3>
          {queue.length === 0 ? <div className="mt-1 text-[11px] text-slate-500">None.</div> : (
            <ul data-testid="review-required" className="mt-1 space-y-1">
              {queue.map(item => (
                <li key={item.id} data-testid={`review-required-${item.id}`}
                    className="flex flex-wrap items-baseline gap-2 rounded border border-slate-700/60 bg-slate-900/40 px-2 py-1 text-xs">
                  <span className="font-bold text-slate-100">{nextActionLabel(item)}</span>
                  <span className="text-[10px] text-slate-500">{CARD_TITLE[homeOf(item.id)]}</span>
                  {item.owner ? <span className="text-[10px] text-slate-500">· {item.owner}</span> : null}
                  <span className="ml-auto flex items-center gap-2">
                    <ProvenanceChip source={item.source} compact />
                    <button type="button" className="font-bold text-sky-300 hover:text-sky-200"
                            onClick={() => onAnswer(item.id)}>Answer</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-400">Engineering checks</h3>
          {checks.length === 0 ? (
            <div className="mt-1 text-[11px] text-slate-500">Nothing evaluated yet — the service is not recorded.</div>
          ) : CONCLUSION_ORDER.map(k => {
            const group = checks.filter(c => c.conclusion === k);
            if (group.length === 0) return null;
            return (
              <div key={k} data-testid={`review-checks-${k}`} data-count={group.length} className="mt-2">
                <div className={`text-[11px] font-black ${CONCLUSION_TONE[k]}`}>{CONCLUSION_WORD[k]} ({group.length})</div>
                <ul className="mt-0.5 divide-y divide-slate-800 rounded border border-slate-800">
                  {group.map((c, i) => (
                    <li key={`${c.id}-${c.scope}-${i}`} data-testid="review-check" data-conclusion={c.conclusion}
                        data-check-id={c.id} className="px-2 py-1 text-[11px]">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-bold text-slate-200">{c.title}</span>
                        {c.citation ? (
                          <span data-testid="review-check-code" className="rounded border border-slate-700 px-1 text-[10px] text-slate-400">{c.citation}</span>
                        ) : null}
                        {c.conclusion === 'NOT_EVALUATED' && isOptionalCheck(c) ? (
                          <span className="text-[10px] text-slate-500">optional</span>
                        ) : null}
                      </div>
                      <div className="text-slate-400">{c.detail}</div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <section data-testid="review-engineering-items" data-status={eng?.status ?? 'complete'}>
          <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-400">
            Disconnecting means, manufacturer documents, load analysis
          </h3>
          <div className="mt-1 space-y-2">
            {engItems.map(item => (
              <ItemRow key={item.id} item={item}>
                {hasItemEditor(item, ctx.topology)
                  ? <ItemEditor {...ctx} item={item} apply={apply} />
                  : null}
              </ItemRow>
            ))}
          </div>
        </section>

        {needs.length > 0 ? (
          <div>
            <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-400">What the engineering still needs</h3>
            <ul data-testid="review-needs" className="mt-1 space-y-1">
              {needs.map(n => (
                <li key={n.id} data-testid={`review-need-${n.id.slice('engineering.needs.'.length)}`}
                    className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-1 text-[11px]">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-bold text-slate-200">{n.question}</span>
                    <span className="ml-auto"><ProvenanceChip source={n.source} /></span>
                  </div>
                  {n.owner ? <div className="text-slate-500">{n.owner}</div> : null}
                  {n.why ? <div className="text-slate-500">{n.why}</div> : null}
                  {/* A need the installer can answer is answered HERE — never only in a graph editor. */}
                  {hasItemEditor(n, ctx.topology) ? (
                    <div className="mt-1"><ItemEditor {...ctx} item={n} apply={apply} /></div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ══ THE ADVANCED SERVICE MODEL EDITOR — diagnostic, not a workflow ═══════════════════
            The old Service Topology screen, kept for unusual systems (arbitrary service paths, panels
            and systems) and for the edits System Config refuses because they would remove connected
            equipment. Mounted only when opened; it saves through the page's one write path. */}
        {advancedEditor ? (
          <details data-testid="review-advanced-editor" className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-2"
                   open={advancedOpen}
                   onToggle={e => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary data-testid="review-advanced-editor-toggle"
                     className="cursor-pointer text-[11px] font-black uppercase tracking-wide text-slate-400">
              Advanced service model editor
            </summary>
            <p className="mt-1 text-[11px] text-slate-500">
              For unusual systems only. It edits the same service model the System Config cards answer, saves
              through the same write path, and every check above re-runs on it. Every normal decision is made
              in the cards — this is not the workflow.
            </p>
            {advancedOpen ? <div data-testid="review-advanced-editor-body" className="mt-2">{advancedEditor}</div> : null}
          </details>
        ) : null}

        <div className="flex justify-end">
          <button type="button" onClick={onClose}
                  className="rounded border border-slate-600 px-3 py-1 text-xs font-bold text-slate-200 hover:bg-slate-800">
            Close
          </button>
        </div>
      </div>
    </SystemConfigModal>
  );
}

export default EngineeringReadinessPanel;
