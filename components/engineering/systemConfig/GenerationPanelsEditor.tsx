'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM CONFIG — THE GENERATION / COMBINER PANELS: WHICH PANELBOARD, ITS BUSBAR, ITS SCCR.
//
// The editor for `engineering.generation-panels` (lib/electrical/systemConfigGenerationPanels.ts) —
// what the Service Topology inspector's generation-panel box asked, now behind the Battery card's
// existing [Configure systems differently] (each system's own panel; inline in Manual), in Review
// Engineering and in [Answer Next]. No permanent row of its own (brief §6). One row per panel: the
// engine's requirement (read, never typed), the part, and what is read off the part. Every control
// calls `answerGenerationPanelPart` and hands the result to `apply` — the page's one write path.
//
// 🚨 THE SCCR IS IN kA, like every other interrupting rating System Config asks for, and a typo
// ('22e', '22kA' — the browser reports '' with validity.badInput) is REFUSED and the recorded figure
// restored: a blank written over a recorded rating would erase it.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { evaluateServiceTopology, type ServiceTopology, type TopologyEvaluation } from '@/lib/electrical/serviceTopology';
import { sccrAmpsFromKa, sccrKaFromAmps, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { answerGenerationPanelPart, generationPanelFacts } from '@/lib/electrical/systemConfigGenerationPanels';

const box = 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-100 border border-slate-700';

/** Blank ⇒ not stated (null). Never zero. */
const amps = (raw: string): number | null => (raw.trim() === '' ? null : Number(raw));

/**
 * What a number field holds on blur: null (blank — "not stated"), a number, or 'typo' — the browser
 * reports '' for input it cannot parse ('22e', '22kA') and flags `validity.badInput`, so a blank is
 * only a blank when that flag is down.
 */
function readNumber(el: HTMLInputElement): number | null | 'typo' {
  if (el.validity?.badInput) return 'typo';
  return amps(el.value);
}

export function GenerationPanelsEditor({ topology: t, evaluation, apply, busy, domainId }: {
  topology: ServiceTopology | null;
  evaluation?: TopologyEvaluation | null;
  apply: (r: AnswerResult) => Promise<unknown>;
  busy: boolean;
  /**
   * Only one system's panel (`domainId`), or only the site-wide shared panel(s) (`null`) — the Battery
   * card shows each beside its own system behind [Configure systems differently]. Absent ⇒ every panel.
   */
  domainId?: string | null;
}) {
  const panels = (t?.aggregationPanels ?? []).filter(p => domainId === undefined || (p.domainId ?? null) === domainId);
  if (!t || panels.length === 0) return null;
  // The engine's own verdicts on each panel — read, never recomputed here.
  const verdicts = evaluation ?? evaluateServiceTopology(t);
  return (
    <div className="space-y-1.5" data-testid="answer-generation-panels">
      {panels.map(p => {
        const f = generationPanelFacts(t, p, verdicts);
        const fromPart = f.partChosen;
        return (
          <div key={p.id} data-testid={`answer-generation-panel-${p.id}`}
               className="rounded border border-slate-800 bg-slate-950/40 p-1.5">
            <div className="text-[11px] font-bold text-slate-200">{f.label}</div>
            {/* 🚨 THE REQUIREMENT IS THE ENGINE'S — sized from the batteries feeding it, never the service. */}
            <div data-testid={`answer-generation-requirement-${p.id}`} className="text-[10px] text-slate-400">{f.requirement}</div>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              <label className="text-[11px] text-slate-400">Panelboard selected
                <input key={`p-${p.productId ?? ''}`} data-testid={`answer-generation-part-${p.id}`}
                       className={`mt-0.5 block w-full ${box}`} disabled={busy}
                       placeholder="catalog number — not selected" defaultValue={p.productId ?? ''}
                       onBlur={e => {
                         if ((e.target.value.trim() || null) !== (p.productId ?? null)) {
                           void apply(answerGenerationPanelPart(t, p.id, { productId: e.target.value }));
                         }
                       }} />
              </label>
              <label className="text-[11px] text-slate-400">{fromPart ? 'Busbar (A)' : 'Busbar (A) — sized, not from a part'}
                <input key={`b-${p.busbarRatingA ?? ''}`} type="number" min={0} data-testid={`answer-generation-bus-${p.id}`}
                       className={`mt-0.5 block w-full ${box}`} disabled={busy} placeholder="not stated"
                       defaultValue={p.busbarRatingA ?? ''}
                       onBlur={e => {
                         const el = e.currentTarget;
                         const v = readNumber(el);
                         if (v === 'typo') {
                           el.value = p.busbarRatingA != null ? String(p.busbarRatingA) : '';
                           void apply({ ok: false, refused: `${p.label} busbar: enter the amperes on the panelboard label, or leave it blank.` });
                           return;
                         }
                         if (v !== p.busbarRatingA) void apply(answerGenerationPanelPart(t, p.id, { busbarRatingA: v }));
                       }} />
              </label>
              <label className="text-[11px] text-slate-400" title="Interrupting rating (SCCR) off the panelboard label, in kA">SCCR (kA)
                <input key={`s-${p.sccrA ?? ''}`} type="number" min={0} step={0.5} data-testid={`answer-generation-sccr-${p.id}`}
                       aria-label={`${p.label} SCCR (kA)`}
                       className={`mt-0.5 block w-full ${box}`} disabled={busy} placeholder="kA — not established"
                       defaultValue={p.sccrA != null ? sccrKaFromAmps(p.sccrA) : ''}
                       onBlur={e => {
                         const el = e.currentTarget;
                         const ka = readNumber(el);
                         if (ka === 'typo') {
                           el.value = p.sccrA != null ? String(sccrKaFromAmps(p.sccrA)) : '';
                           void apply({ ok: false, refused: `${p.label} SCCR: enter the kiloamperes on the panelboard label, or leave it blank.` });
                           return;
                         }
                         const a = ka === null ? null : sccrAmpsFromKa(ka);
                         if (a !== (p.sccrA ?? null)) void apply(answerGenerationPanelPart(t, p.id, { sccrA: a }));
                       }} />
              </label>
            </div>
            {f.fails.length > 0 ? (
              <div data-testid={`answer-generation-fails-${p.id}`} className="mt-1 text-[10px] font-bold text-rose-300">
                {f.fails.join(' ')}
              </div>
            ) : !fromPart ? (
              <div className="mt-1 text-[10px] font-bold text-amber-300">Part not selected — nothing is ordered until it is</div>
            ) : !f.sccrStated ? (
              <div className="mt-1 text-[10px] font-bold text-amber-300">SCCR not established</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default GenerationPanelsEditor;
