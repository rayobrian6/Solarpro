'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM CONFIG — EACH BACKUP SYSTEM'S EQUIPMENT, ITS BATTERY LANDING, AND WHICH PANELS ARE BACKED UP.
//
// The editors for the questions `lib/electrical/systemConfigSystemEquipment.ts` asks, plus the editor
// for "What is backed up?" (so a system's battery count has one control, not two). Every choice list
// comes from that module — already filtered to what the catalogue says fits — and every write goes
// through its answer functions into the service graph's one write path. Nothing here decides what
// fits, and nothing here edits the graph itself.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import type { ServiceTopology, BackupDomain } from '@/lib/electrical/serviceTopology';
import type { InterviewItem, InterviewOption } from '@/lib/electrical/systemConfigInterview';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import {
  parseSystemEquipmentItemId, systemEquipmentFacts, controllersFor, backupBatteries, expansionsFor,
  answerSystemEquipment, answerSystemLanding, answerBackedUpPanels, answerBackupChoice,
} from '@/lib/electrical/systemConfigSystemEquipment';

/** The equipment selection the page already passes the interview. */
export interface SystemEquipmentSelection {
  gatewayProductId: string | null;
  storageProductId: string | null;
  storageLabel: string | null;
  totalUnits: number;
}

type Apply = (r: AnswerResult) => Promise<void>;

const box = 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-100 border border-slate-700';
const T = 'answer-system-equipment';

export function SystemEquipmentEditor({ item, topology, apply, busy, equipment }: {
  item: InterviewItem;
  topology: ServiceTopology | null;
  apply: Apply;
  busy: boolean;
  equipment: SystemEquipmentSelection;
}) {
  if (!topology) return null;
  if (item.id === 'behavior.backup') {
    return <BackupPanels t={topology} item={item} apply={apply} busy={busy} equipment={equipment} />;
  }
  const parsed = parseSystemEquipmentItemId(item.id);
  if (!parsed || !topology.domains.some(d => d.id === parsed.domainId)) return null;
  if (parsed.kind === 'equip') {
    return <SystemEquipmentForm key={parsed.domainId} t={topology} domainId={parsed.domainId} apply={apply} busy={busy} />;
  }
  return (
    <Choice name={`landing-${parsed.domainId}`} testid={`${T}-landing-${parsed.domainId}`} options={item.options ?? []}
            value={item.value} disabled={busy}
            onPick={v => void apply(answerSystemLanding(topology, parsed.domainId,
              v as Exclude<BackupDomain['storageConnection'], 'unresolved'>))} />
  );
}

function Choice({ name, options, value, onPick, disabled, testid }: {
  name: string; options: InterviewOption[]; value: string | null | undefined;
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

/** A select of only what fits — plus the recorded value, shown but not offered, when it does not. */
function FitSelect({ testid, value, options, onChange, disabled, empty }: {
  testid: string; value: string; options: InterviewOption[]; onChange: (v: string) => void;
  disabled?: boolean; empty?: string;
}) {
  const listed = options.some(o => o.value === value);
  return (
    <select data-testid={testid} className={`mt-0.5 block w-full ${box}`} disabled={disabled} value={value}
            onChange={e => onChange(e.target.value)}>
      {empty !== undefined ? <option value="">{empty}</option> : null}
      {value && !listed ? <option value={value} disabled>{value} — not listed as fitting</option> : null}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

interface Draft { gw?: string; ess?: string; nEss?: number; exp?: string; nExp?: number }

function SystemEquipmentForm({ t, domainId, apply, busy }: {
  t: ServiceTopology; domainId: string; apply: Apply; busy: boolean;
}) {
  const [draft, setDraft] = useState<Draft>({});
  const d = t.domains.find(x => x.id === domainId);
  if (!d) return null;
  const f = systemEquipmentFacts(t, d);
  const cur = {
    gw: d.gateway.productId, ess: f.storageProductId ?? '', nEss: f.inverting.length,
    exp: f.expansionProductId ?? '', nExp: f.expansions.length,
  };
  const v = { ...cur, ...draft };
  const ctl = controllersFor(v.ess || null);
  const exps = expansionsFor(v.ess || null);
  const showExpansion = exps.evaluated || cur.nExp > 0 || v.nExp > 0;
  const changed = (Object.keys(cur) as Array<keyof typeof cur>).some(k => v[k] !== cur[k]);
  const count = (s: string) => Math.max(0, Math.floor(Number(s) || 0));

  const save = async () => {
    const r = answerSystemEquipment(t, d.id, {
      ...(v.gw !== cur.gw ? { gatewayProductId: v.gw } : {}),
      ...(v.ess !== cur.ess ? { storageProductId: v.ess || null } : {}),
      ...(v.nEss !== cur.nEss ? { storageUnits: v.nEss } : {}),
      ...(v.exp !== cur.exp ? { expansionProductId: v.exp || null } : {}),
      ...(v.nExp !== cur.nExp ? { expansionUnits: v.nExp } : {}),
    });
    await apply(r);
    if (r.ok) setDraft({});
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[11px] text-slate-400">Backup controller
          <FitSelect testid={`${T}-gateway-${d.id}`} value={v.gw} options={ctl.options} disabled={busy}
                     onChange={x => setDraft(s => ({ ...s, gw: x }))} />
          {ctl.evaluated ? null : (
            <span data-testid={`${T}-gateway-note-${d.id}`} className="mt-0.5 block text-[10px] font-bold text-amber-300">
              {ctl.note}
            </span>
          )}
        </label>
        <label className="text-[11px] text-slate-400">Batteries
          <FitSelect testid={`${T}-ess-${d.id}`} value={v.ess} options={backupBatteries()} disabled={busy}
                     empty="— choose —" onChange={x => setDraft(s => ({ ...s, ess: x }))} />
          <input type="number" min={0} step={1} data-testid={`${T}-ess-count-${d.id}`} disabled={busy}
                 className={`mt-1 block w-20 ${box}`} value={v.nEss}
                 onChange={e => setDraft(s => ({ ...s, nEss: count(e.target.value) }))} />
        </label>
        {showExpansion ? (
          <label className="text-[11px] text-slate-400">Expansion units
            <FitSelect testid={`${T}-expansion-${d.id}`} value={v.exp} options={exps.options} disabled={busy}
                       empty="none" onChange={x => setDraft(s => ({ ...s, exp: x }))} />
            <input type="number" min={0} max={v.nEss} step={1} data-testid={`${T}-expansion-count-${d.id}`}
                   disabled={busy} className={`mt-1 block w-20 ${box}`} value={v.nExp}
                   onChange={e => setDraft(s => ({ ...s, nExp: count(e.target.value) }))} />
            <span className="mt-0.5 block text-[10px] text-slate-500">
              DC extensions of the batteries — energy, never AC current or a breaker. One per battery.
            </span>
          </label>
        ) : null}
      </div>
      <button type="button" data-testid={`${T}-save-${d.id}`} disabled={busy || !changed}
              className="rounded bg-sky-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
              onClick={() => void save()}>
        Record {d.label}’s equipment
      </button>
    </div>
  );
}

function BackupPanels({ t, item, apply, busy, equipment }: {
  t: ServiceTopology; item: InterviewItem; apply: Apply; busy: boolean; equipment: SystemEquipmentSelection;
}) {
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [units, setUnits] = useState<Record<string, number>>({});
  const multi = t.panels.length > 1;
  const systemOf = (panelId: string) => t.domains.find(d => d.backedUpPanelIds.includes(panelId)) ?? null;
  const isPicked = (panelId: string) =>
    picked[panelId] ?? (!!t.panels.find(p => p.id === panelId)?.backedUp && !!systemOf(panelId));
  const value = choosing ? 'panels' : (item.value ?? null);
  const sel = { ...equipment, unitsPerPanel: units };

  const record = async () => {
    const r = answerBackedUpPanels(t, t.panels.filter(p => isPicked(p.id)).map(p => p.id), sel);
    await apply(r);
    if (r.ok) { setChoosing(false); setPicked({}); }
  };

  return (
    <div className="space-y-2">
      <Choice name="backup" testid={`${T}-backup`} options={item.options ?? []} value={value} disabled={busy}
              onPick={v => {
                if (v === 'panels') { setChoosing(true); return; }
                setChoosing(false);
                void apply(answerBackupChoice(t, v as 'whole' | 'none', sel));
              }} />
      {multi ? (
        <div className="grid gap-1 sm:grid-cols-2">
          {t.panels.map(p => {
            const sys = systemOf(p.id);
            const held = sys ? systemEquipmentFacts(t, sys).inverting.length : 0;
            return (
              <div key={p.id} className="rounded border border-slate-800 p-1.5 text-[11px] text-slate-300">
                <label className="flex items-center gap-1.5">
                  {value === 'panels' ? (
                    <input type="checkbox" data-testid={`${T}-backup-panel-${p.id}`} checked={isPicked(p.id)}
                           disabled={busy} onChange={e => setPicked(m => ({ ...m, [p.id]: e.target.checked }))} />
                  ) : null}
                  <span className="font-bold text-slate-100">{p.label}</span>
                  <span className="text-slate-500">
                    {sys ? `— ${sys.label}, ${held} batter${held === 1 ? 'y' : 'ies'}` : '— not backed up'}
                  </span>
                </label>
                {sys ? null : (
                  <label className="mt-1 block text-slate-400">
                    {equipment.storageLabel ?? 'Batteries'} in its new system
                    <input type="number" min={0} step={1} data-testid={`${T}-backup-units-${p.id}`} disabled={busy}
                           className={`mt-0.5 block w-20 ${box}`} value={units[p.id] ?? ''}
                           onChange={e => setUnits(m => ({ ...m, [p.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
                  </label>
                )}
              </div>
            );
          })}
          <div className="text-[10px] text-slate-500 sm:col-span-2">
            {equipment.totalUnits} selected in total. SolarPro does not split them for you — a new system holds
            exactly the number you enter for its panel.
          </div>
          {value === 'panels' ? (
            <button type="button" data-testid={`${T}-backup-save`} disabled={busy}
                    className="justify-self-start rounded bg-sky-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
                    onClick={() => void record()}>
              Record which panels are backed up
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default SystemEquipmentEditor;
