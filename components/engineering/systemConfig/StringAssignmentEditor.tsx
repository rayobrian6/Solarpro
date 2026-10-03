'use client';

// ═══════════════════════════════════════════════════════════════════════════
// STRING ASSIGNMENT — "String i (n modules) → [PW3 #k ▼]", with a recommendation the installer accepts.
//
// Ray (System Config UX correction V3): the PV strings of a DC-coupled job are one compact line on
// the Inverters & Strings card; [Review] opens this — one row per derived string, and
// "Recommended assignment available [Accept] [Edit]".
//
//   · The recommendation is `recommendStringAssignment` (pure, deterministic, inside each unit's
//     published MPPT count and kW STC). It is SHOWN, never written: the one write is
//     `answerPvLanding`, from the installer's Accept or Save click.
//   · [Edit] puts the recommendation into the rows so the installer adjusts it rather than starting
//     from nothing; Save records whatever the rows say, refused while a unit is over its published
//     MPPT count or kW STC.
//   · A landing already recorded is read back into the rows: ONE wiring of these strings that gives
//     each unit its recorded kW. The graph records each unit's kW, not which string went where, so the
//     rows are consistent with the record — and the dialog says so — not a replay of the rows saved.
//   · The strings are keyed by their panel counts, so a page that maps them afresh on every render
//     does not re-run the search on every render.
//
// The same editor is asked wherever `behavior.pv-landing` is asked — the card's [Review] dialog,
// [Answer Next], the guided strip — because `ItemEditor` renders it for that id.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from 'react';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import type { PvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { answerPvLanding } from '@/lib/electrical/systemConfigAnswers';
import {
  assignmentViolations, invertingUnits, recommendStringAssignment, recordMatchesUnitKw, recordedStringAssignment,
  stringsPerUnit, unitDisplayLabels, unitKwOf, type StringAssignmentInput,
} from '@/lib/electrical/storageStringAssignment';
import type { ApplyAnswer } from '@/components/engineering/systemConfig/ItemEditor';

const box = 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-100 border border-slate-700';

export interface StringAssignmentEditorProps {
  t: ServiceTopology;
  pvArray: PvArrayDesign;
  /** Panel count of each derived string, in the engine's order. */
  strings: number[];
  apply: ApplyAnswer;
  busy: boolean;
}

/** The same strings, by value: a fresh-but-equal array keeps the same identity (no re-search). */
export function useStableStrings(strings: readonly number[]): number[] {
  const key = strings.join('/');
  return useMemo(() => (key ? key.split('/').map(Number) : []), [key]);
}

export function StringAssignmentEditor({ t, pvArray, strings: stringsProp, apply, busy }: StringAssignmentEditorProps) {
  const strings = useStableStrings(stringsProp);
  const watts = pvArray.module?.watts ?? null;
  const count = pvArray.moduleCount ?? 0;
  const units = useMemo(() => invertingUnits(t), [t]);
  const labels = useMemo(() => unitDisplayLabels(t), [t]);
  const input: StringAssignmentInput = useMemo(
    () => ({ strings, moduleWatts: watts, units }), [strings, watts, units]);
  const rec = useMemo(() => recommendStringAssignment(input), [input]);
  // The record is each unit's kW: when it equals the recommendation's, the recorded landing IS the
  // recommended one, and the rows show the recommendation's wiring.
  const recordedIsRecommended = rec.ok && recordMatchesUnitKw(units, rec.unitKw);
  const recorded = useMemo(() => (recordedIsRecommended && rec.ok ? rec.unitOf : recordedStringAssignment(input)),
    [input, rec, recordedIsRecommended]);

  // The rows start at what is recorded (read back), else empty; they follow a new record or new strings.
  const resetKey = `${strings.join('/')}|${watts}|${units.map(u => `${u.id}:${u.pvDcStcKw ?? ''}`).join(',')}`;
  const [landing, setLanding] = useState<(string | null)[]>(() => recorded ?? strings.map(() => null));
  useEffect(() => { setLanding(recorded ?? strings.map(() => null)); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (strings.length === 0 || !watts) {
    return (
      <div data-testid="inv-string-none" className="text-[11px] text-amber-300">
        The strings have not been derived yet, so there is nothing to land.
      </div>
    );
  }
  if (units.length === 0) {
    return (
      <div data-testid="inv-string-none" className="text-[11px] text-amber-300">
        No battery with PV inputs is on the service yet — choose the storage on the Battery Storage card first.
      </div>
    );
  }

  const unitIds = units.map(u => u.id);
  const perUnit = stringsPerUnit(strings, landing, unitIds);
  const kw = unitKwOf(perUnit, watts);
  const unassigned = landing.filter(u => !u || !unitIds.includes(u)).length;
  const violations = assignmentViolations(input, landing, labels);

  return (
    <div data-testid="inv-string-editor" className="space-y-2">
      {rec.ok ? (
        <div data-testid="inv-string-recommendation"
             data-matches-recorded={recordedIsRecommended ? 'true' : undefined}
             className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2 text-[11px] text-slate-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-sky-200">
              {recordedIsRecommended ? 'Recorded — matches the recommended assignment' : 'Recommended assignment available'}
            </span>
            <span className="ml-auto flex gap-1.5">
              {!recordedIsRecommended ? (
                <button type="button" data-testid="inv-string-accept" disabled={busy}
                        className="rounded bg-sky-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-40"
                        onClick={async () => {
                          if (await apply(answerPvLanding(t, rec.perUnit, watts, count))) setLanding(rec.unitOf);
                        }}>
                  Accept
                </button>
              ) : null}
              <button type="button" data-testid="inv-string-edit" disabled={busy}
                      className="rounded border border-slate-600 px-2 py-0.5 text-[11px] font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                      onClick={() => setLanding(rec.unitOf)}>
                Edit
              </button>
            </span>
          </div>
          <div data-testid="inv-string-recommended-units" className="mt-1 text-slate-400">
            {unitIds.map(id => {
              const idx = rec.unitOf.map((u, i) => (u === id ? i + 1 : 0)).filter(Boolean);
              return idx.length === 0 ? `${labels[id]}: no PV`
                : `${labels[id]}: String ${idx.join(', ')} · ${rec.unitKw[id].toFixed(2)} kW`;
            }).join(' · ')}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">
            Within each unit’s published PV inputs (one string per MPPT, kW STC), the load spread across the units.
            Written only when you accept it.
          </div>
        </div>
      ) : (
        <div data-testid="inv-string-no-recommendation"
             className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-200">
          No recommended assignment — {rec.ok === false ? rec.reason : null}
        </div>
      )}

      {recorded ? (
        <div data-testid="inv-string-readback-note" className="text-[10px] text-slate-500">
          Read back from the recorded kW per unit. SolarPro records each unit’s kW, not which string went
          where, so these rows are one wiring that gives those totals.
        </div>
      ) : null}

      <div className="space-y-1">
        {strings.map((n, i) => (
          <label key={i} className="flex items-center gap-2 text-[11px] text-slate-300">
            <span className="w-28 shrink-0">String {i + 1} ({n} modules)</span> →
            <select data-testid={`inv-string-${i + 1}`} className={box} disabled={busy} value={landing[i] ?? ''}
                    onChange={e => {
                      const v = e.target.value || null;
                      setLanding(l => l.map((u, k) => (k === i ? v : u)));
                    }}>
              <option value="">Choose a unit…</option>
              {units.map(u => <option key={u.id} value={u.id}>{labels[u.id]}</option>)}
            </select>
          </label>
        ))}
      </div>

      <div className="space-y-0.5 text-[10px] text-slate-500">
        {units.map((u, k) => {
          const l = u.pvInputLimits ?? null;
          const n = perUnit[u.id].length;
          const over = !!l && (n > l.mppts || kw[u.id] > l.maxStcKw);
          return (
            <div key={u.id} data-testid={`inv-string-unit-${k + 1}`} className={over ? 'text-rose-300' : undefined}>
              {labels[u.id]} · {n} string{n === 1 ? '' : 's'} · {kw[u.id].toFixed(2)}
              {l ? ` of ${l.maxStcKw} kW STC · ${n} of ${l.mppts} MPPT` : ' kW STC · PV input limits not published'}
            </div>
          );
        })}
      </div>

      {violations.length > 0 ? (
        <div data-testid="inv-string-violations" className="rounded border border-rose-500/40 bg-rose-500/10 p-1.5 text-[11px] text-rose-200">
          {violations.map(v => <div key={v}>{v}</div>)}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button type="button" data-testid="inv-string-save"
                disabled={busy || unassigned > 0 || violations.length > 0}
                className="rounded bg-sky-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
                onClick={() => void apply(answerPvLanding(t, perUnit, watts, count))}>
          Record where each string lands
        </button>
        {unassigned > 0 ? (
          <span data-testid="inv-string-unassigned" className="text-[10px] text-slate-500">
            {unassigned} string{unassigned === 1 ? '' : 's'} not assigned
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default StringAssignmentEditor;
