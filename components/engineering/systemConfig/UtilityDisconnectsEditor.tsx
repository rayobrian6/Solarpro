'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM CONFIG — UTILITY FACTS AND DISCONNECTING MEANS.
//
// The editors for `behavior.utility.*` and `engineering.disconnect.*` items
// (lib/electrical/systemConfigUtilityDisconnects.ts). Every control calls one pure answer function
// from that module and hands the result to `apply`, which writes the service graph through the one
// write path. This component holds no engineering state; it never states a requirement itself.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import type { InterviewItem } from '@/lib/electrical/systemConfigInterview';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import {
  METER_COLLAR_ITEM_ID, ROLE_NOUN, disconnectRoleOf, describeDisconnect, disconnectPlacements,
  answerMeterCollarPermitted, answerAddDisconnect, answerRemoveDisconnect,
  answerDisconnectPlacement, answerDisconnectPart,
} from '@/lib/electrical/systemConfigUtilityDisconnects';

const box = 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-100 border border-slate-700';

export interface UtilityDisconnectsEditorProps {
  item: InterviewItem;
  topology: ServiceTopology | null;
  apply: (r: AnswerResult) => Promise<unknown>;
  busy: boolean;
}

/** Blank ⇒ not stated (null). Never zero. */
const amps = (raw: string): number | null => (raw.trim() === '' ? null : Number(raw));

export function UtilityDisconnectsEditor({ item, topology: t, apply, busy }: UtilityDisconnectsEditorProps) {
  if (!t) return null;

  if (item.id === METER_COLLAR_ITEM_ID && item.options) {
    return (
      <select data-testid="answer-utility-meter-collar" className={box} disabled={busy}
              value={item.value ?? 'unknown'}
              onChange={e => void apply(answerMeterCollarPermitted(t,
                e.target.value === 'permitted' ? true : e.target.value === 'not-permitted' ? false : null))}>
        {item.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  const spec = disconnectRoleOf(item.id);
  if (!spec) return null;   // e.g. the multi-gateway document: nothing an installer can answer here
  const devices = t.devices.filter(d => d.roles.includes(spec.role));
  const places = disconnectPlacements(t);
  return (
    <div className="space-y-1.5" data-testid={`answer-disconnect-role-${spec.role}`}>
      <div className="text-[10px] text-slate-500">{spec.where} {spec.purpose}</div>
      {devices.map(d => {
        const f = describeDisconnect(t, d);
        // 🚨 With no part chosen, a number on the device (a seeded service or path rating) was read off
        // no part, and the boxes say so. Naming a part resets them (answerDisconnectPart).
        const fromPart = !!d.productId;
        return (
          <div key={d.id} data-testid={`answer-disconnect-device-${d.id}`}
               className="rounded border border-slate-800 bg-slate-950/40 p-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-200">
              <span className="font-bold">{d.label}</span>
              <button type="button" data-testid={`answer-disconnect-remove-${d.id}`} disabled={busy}
                      className="rounded px-1.5 text-[11px] text-slate-400 hover:text-red-300"
                      onClick={() => void apply(answerRemoveDisconnect(t, d.id))}>
                Remove
              </button>
            </div>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] text-slate-400">Where it sits
                <select data-testid={`answer-disconnect-place-${d.id}`} className={`mt-0.5 block w-full ${box}`}
                        disabled={busy} value={d.inlineOnNodeId ?? ''}
                        onChange={e => void apply(answerDisconnectPlacement(t, d.id, e.target.value || null))}>
                  {places.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </label>
              {/* 🚨 THE REQUIREMENT IS THE ENGINE'S, OR IT IS NOT ESTABLISHED — never the seeded number. */}
              <div className="text-[11px] text-slate-400">Requirement
                <div data-testid={`answer-disconnect-requirement-${d.id}`}
                     className={`mt-0.5 ${f.requirementA === null ? 'text-amber-300' : 'text-slate-200'}`}>
                  {f.requirement}
                </div>
              </div>
              <label className="text-[11px] text-slate-400">Part selected
                <input key={`p-${d.productId ?? ''}`} data-testid={`answer-disconnect-part-${d.id}`}
                       className={`mt-0.5 block w-full ${box}`} disabled={busy}
                       placeholder="catalog number — not selected" defaultValue={d.productId ?? ''}
                       onBlur={e => { if ((e.target.value.trim() || null) !== (d.productId ?? null)) void apply(answerDisconnectPart(t, d.id, { productId: e.target.value })); }} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-slate-400">{fromPart ? 'Part rating (A)' : 'Recorded rating (A) — not from a part'}
                  <input key={`r-${d.ratedAmps ?? ''}`} type="number" min={0} data-testid={`answer-disconnect-rating-${d.id}`}
                         className={`mt-0.5 block w-full ${box}`} disabled={busy} placeholder="not stated"
                         defaultValue={d.ratedAmps ?? ''}
                         onBlur={e => { const v = amps(e.target.value); if (v !== d.ratedAmps) void apply(answerDisconnectPart(t, d.id, { ratedAmps: v })); }} />
                </label>
                <label className="text-[11px] text-slate-400">{fromPart ? 'SCCR (A)' : 'Recorded SCCR (A) — not from a part'}
                  <input key={`s-${d.sccrA ?? ''}`} type="number" min={0} data-testid={`answer-disconnect-sccr-${d.id}`}
                         className={`mt-0.5 block w-full ${box}`} disabled={busy} placeholder="not established"
                         defaultValue={d.sccrA ?? ''}
                         onBlur={e => { const v = amps(e.target.value); if (v !== d.sccrA) void apply(answerDisconnectPart(t, d.id, { sccrA: v })); }} />
                </label>
              </div>
            </div>
            {f.sccrEstablished ? null : (
              <div className="mt-1 text-[10px] font-bold text-amber-300">SCCR not established</div>
            )}
          </div>
        );
      })}
      {spec.role === 'gateway-isolation' && t.domains.length === 0 ? null : (
        <button type="button" data-testid={`answer-disconnect-add-${spec.role}`} disabled={busy}
                className="rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600"
                onClick={() => void apply(answerAddDisconnect(t, spec.role))}>
          + Add {devices.length > 0 ? 'another' : 'a'} {ROLE_NOUN[spec.role].toLowerCase()}
        </button>
      )}
    </div>
  );
}

export default UtilityDisconnectsEditor;
