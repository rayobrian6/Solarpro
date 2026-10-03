'use client';

// ═══════════════════════════════════════════════════════════════════════════
// THE OPTIONAL FULL LOAD ANALYSIS, IN SYSTEM CONFIG.
//
// The Service Topology inspector's "Full load analysis — optional" box, as an installer question.
// The relevance, the method gate and the sums all come from
// `lib/electrical/systemConfigLoadAnalysis.ts` (pure, tested). Every edit goes through its answer
// functions, which call the inspector's own writers, into the page's one write path. This component
// computes nothing and holds no engineering state; the only local state is the method picked before
// "Add" is pressed.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import type { ServiceTopology, LoadCalculationMethod } from '@/lib/electrical/serviceTopology';
import type { InterviewItem } from '@/lib/electrical/systemConfigInterview';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import {
  LOAD_ANALYSIS_ITEM_ID, describeLoadAnalysis, loadMethodChoices,
  answerLoadAnalysisMethod, answerPanelDemand, answerRemoveLoadAnalysis,
} from '@/lib/electrical/systemConfigLoadAnalysis';

const box = 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-100 border border-slate-700';
const A = (v: number | null) => (v === null ? 'not summed' : `${v.toFixed(1)} A`);

export function LoadAnalysisEditor({ item, topology: t, apply, busy }: {
  item: InterviewItem;
  topology: ServiceTopology | null;
  apply: (r: AnswerResult) => Promise<void>;
  busy: boolean;
}) {
  const [method, setMethod] = useState('');
  // The check rows under the item are verdicts — read, never edited here.
  if (item.id !== LOAD_ANALYSIS_ITEM_ID || !t) return null;

  const pic = describeLoadAnalysis(t);
  const choices = loadMethodChoices(t.service.phase);

  // 🚨 A METHOD THE SYSTEM CANNOT USE IS NOT OFFERED, AND THE SCREEN SAYS WHY.
  const notOffered = choices.unavailable.length > 0 ? (
    <ul data-testid="answer-loads-unavailable" className="space-y-0.5 text-[10px] text-slate-500">
      {choices.unavailable.map(m => (
        <li key={m.value} data-testid={`answer-loads-unavailable-${m.value}`}>
          <span className="font-bold text-slate-400">{m.label}</span> — not offered. {m.why}
        </li>
      ))}
    </ul>
  ) : null;

  if (!pic.present) {
    return (
      <div className="space-y-1.5">
        <div className="text-[11px] text-slate-400">
          Optional. The service, equipment, disconnects, diagram, schedule and permit drawing are all
          engineered without it. Add one if the project or the reviewer wants it. Demand is entered
          once per panelboard, and SolarPro sums everything else from those figures.
        </div>
        {t.panels.length === 0 ? (
          <div className="text-[11px] text-amber-300">
            Calculated demand is entered per panelboard, and this service has no panelboard yet.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select data-testid="answer-loads-method" className={box} disabled={busy} value={method}
                    onChange={e => setMethod(e.target.value)}>
              <option value="">Choose the calculation method…</option>
              {choices.available.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button type="button" data-testid="answer-loads-add" disabled={busy || !method}
                    className="rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600 disabled:opacity-40"
                    onClick={() => void apply(answerLoadAnalysisMethod(t, method as LoadCalculationMethod))}>
              Add a full load analysis
            </button>
          </div>
        )}
        {notOffered}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block text-[11px] text-slate-400">Method
        <select data-testid="answer-loads-method" className={`mt-0.5 block ${box}`} disabled={busy}
                value={pic.methodOutOfScope ? '' : pic.method ?? ''}
                onChange={e => {
                  if (e.target.value) void apply(answerLoadAnalysisMethod(t, e.target.value as LoadCalculationMethod));
                }}>
          {pic.methodOutOfScope ? (
            <option value="">{pic.methodLabel} — does not apply here; choose another…</option>
          ) : null}
          {choices.available.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {pic.methodOutOfScope ? (
        <div data-testid="answer-loads-method-out-of-scope" className="text-[11px] text-amber-300">
          {pic.methodOutOfScope}
        </div>
      ) : null}
      {notOffered}

      {pic.panels.length === 0 ? (
        <div className="text-[11px] text-amber-300">
          Calculated demand is entered per panelboard, and this service has no panelboard yet.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {pic.panels.map(p => (
            // Keyed on the stored figure so a reload shows what the store holds, not what was typed.
            <label key={`${p.id}:${p.demandA ?? ''}`} className="text-[11px] text-slate-400">
              {p.label} — calculated demand (A)
              <input type="number" min={0} step="any" data-testid={`answer-loads-panel-${p.id}`}
                     className={`mt-0.5 block w-28 ${box}`} disabled={busy} placeholder="not entered"
                     defaultValue={p.demandA ?? ''}
                     onBlur={e => {
                       const raw = e.target.value.trim();
                       const v = raw === '' ? null : Number(raw);
                       if (v !== p.demandA) void apply(answerPanelDemand(t, p.id, v));
                     }} />
            </label>
          ))}
        </div>
      )}

      {/* 🚨 A PARTIAL MODEL IS NOT A SMALLER LOAD. No subtotal is ever shown where the sum would be. */}
      {pic.panels.length > 0 ? (
        <div data-testid="answer-loads-derived" data-complete={pic.sums ? 'yes' : 'no'}
             className="rounded border border-slate-700/60 p-2 text-[11px] text-slate-300">
          {pic.sums ? (
            <>
              <div className="text-[10px] text-slate-500">
                Summed by SolarPro from the panelboard figures. These are not separate entries.
              </div>
              <div data-testid="answer-loads-aggregate" className="font-bold text-slate-100">
                Aggregate service demand: {A(pic.sums.aggregateA)}
                {pic.sums.otherA !== null ? ` (includes ${A(pic.sums.otherA)} outside the panelboards)` : ''}
              </div>
              {pic.sums.paths.length > 1 ? pic.sums.paths.map(b => (
                <div key={b.id} data-testid={`answer-loads-path-${b.id}`}>{b.label}: {A(b.demandA)}</div>
              )) : null}
              {pic.sums.systems.map(d => (
                <div key={d.id} data-testid={`answer-loads-system-${d.id}`}>
                  {d.label} backed-up load: {A(d.demandA)}
                </div>
              ))}
            </>
          ) : (
            <span>
              Aggregate, service-path and backed-up demand cannot be summed until every panelboard has a
              figure ({pic.entered} of {pic.panels.length} entered).
            </span>
          )}
        </div>
      ) : null}

      <button type="button" data-testid="answer-loads-remove" disabled={busy}
              className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              onClick={() => void apply(answerRemoveLoadAnalysis(t))}>
        Remove the load analysis
      </button>
    </div>
  );
}

export default LoadAnalysisEditor;
