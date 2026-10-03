'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM CONFIG — THE BATTERY STORAGE CARD (its body, under the page's ON / OFF toggle).
//
// Ray (System Config UX correction V3): "Battery edits in Battery… Do not make the user stare at
// mission control to configure four Powerwalls." Everything about storage is asked here, once:
//
//   · Battery model · Quantity · Expansion packs · Backup controller × how many.
//   · AC aggregation [▼] — `behavior.storage-landing`, ONE answer for every system.
//   · With more than one backup system: "Battery grouping · N systems", one line per system, and
//     per-system editing — its controller, its battery count, its expansion packs and where its AC
//     circuits land, NEVER its battery model — only behind [Configure systems differently] (inline
//     in Manual mode). The battery model is asked once for every system: the project selection can
//     name one battery, so a job with a different battery per system is flagged, not offered.
//   · The output setting the batteries are commissioned at — under the count with one system, per
//     system behind [Configure systems differently] — and each system's generation panel the AC
//     aggregation answer built (panelboard, busbar, SCCR), beside its system behind the SAME
//     disclosure. No permanent row of their own (brief §6): the panels are also answered in Answer
//     Next / Review Engineering. Both moved here from the Service Topology inspector when it left the
//     normal navigation (closure slice 1).
//
// Which store is edited:
//   · No backup system in the service graph yet ⇒ the project selection (`config.batteryId /
//     batteryCount / batteryKwh / backupControllerId`) through `onSelectionChange`, as before.
//   · The graph has backup systems ⇒ the GRAPH is the battery record. Totals are read from it and
//     every edit is an answer (`answerSystemEquipment`, `answerEverySystemEquipment`,
//     `answerStorageLanding`, `answerSystemLanding`) through `apply` — the page's one write path,
//     which mirrors the selection from the graph after the write (`batteryConfigMirror`).
//
// Only what the catalogue lists together is offered (`controllersFor`, `backupBatteries`,
// `expansionsFor`); a writer's refusal is shown here and never written, and so is a write the page
// could not save. Batteries are never split: with more than one system the quantity is the systems'
// sum, and a count is changed per system. An edit that would leave every system with no battery is
// refused — the graph cannot hold "no battery" as a count (an empty system is a question still open).
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { BATTERIES, getBatteryById, getBackupInterfaceById } from '@/lib/equipment-db';
import type { ControlMode } from '@/types';
import type { BackupDomain, ServiceTopology } from '@/lib/electrical/serviceTopology';
import type { InterviewItem, SystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { answerStorageLanding } from '@/lib/electrical/systemConfigAnswers';
import {
  answerSystemEquipment, answerSystemLanding, backupBatteries, controllersFor, expansionsFor,
  outputConfigOf, outputConfigurationsFor,
  storageByProduct, systemEquipmentFacts, systemEquipmentItemId, systemLandingItemId,
} from '@/lib/electrical/systemConfigSystemEquipment';
import {
  answerEverySystemEquipment, batteriesInWords, batteryGroupingOf, batteryNeedsController, graphHoldsBatteries,
  selectionAfterBatteryChange, selectionControllerOf, storageTotalKwh,
  type BatteryGrouping, type BatterySelection, type BatterySystemSummary,
} from '@/lib/electrical/systemConfigBatteryCard';
import { findInterviewItem } from '@/lib/electrical/systemConfigPlacement';
import { ProvenanceChip, type ApplyAnswer, type ItemEditorContext } from '@/components/engineering/systemConfig/ItemEditor';
import { GenerationPanelsEditor } from '@/components/engineering/systemConfig/GenerationPanelsEditor';
import { GENERATION_PANELS_ITEM_ID } from '@/lib/electrical/systemConfigGenerationPanels';

export interface BatteryStorageCardProps extends ItemEditorContext {
  interview: Pick<SystemConfigInterview, 'sections'>;
  controlMode: ControlMode;
  /** The project selection — the battery record until the graph has a backup system. */
  selection: BatterySelection;
  onSelectionChange: (patch: Partial<BatterySelection>) => void;
  /** PV kW DC, for the backup / runtime estimate (an estimate shown in the card only). */
  pvKw: number;
  /** The page's write error (the service record's PUT failed) — shown when THIS card's write failed. */
  error?: string | null;
}

type Landing = Exclude<BackupDomain['storageConnection'], 'unresolved'>;

const controllerName = (id: string) => {
  const g = getBackupInterfaceById(id);
  return g ? `${g.manufacturer} ${g.model}` : id;
};
const batteryName = (id: string) => {
  const b = getBatteryById(id);
  return b ? `${b.manufacturer} ${b.model}` : id;
};
const OWED = new Set<InterviewItem['state']>(['needs-answer', 'needs-verification', 'fails']);

/** The refusal for an edit that would leave every backed-up system with no battery. */
export const EMPTIES_EVERY_SYSTEM = 'That leaves no battery in any backed-up system. The service record cannot hold '
  + '"no battery" as a count — an empty system is a question still open, and the project would keep its '
  + 'battery selection. To install no battery, set Backup to none in System Configuration, then turn '
  + 'Battery Storage off.';

function Owed({ item, testid }: { item: InterviewItem | null; testid: string }) {
  if (!item || !OWED.has(item.state)) return null;
  return (
    <span data-testid={testid} title={item.why ?? item.question}
          className="ml-1 rounded-full border border-sky-400/50 px-1.5 text-[9px] font-black uppercase tracking-wide text-sky-300">
      {item.state === 'needs-verification' ? 'Verify' : item.state === 'fails' ? 'Fails' : 'Needs answer'}
    </span>
  );
}

function Note({ testid, children, tone = 'amber' }: { testid: string; children: React.ReactNode; tone?: 'amber' | 'slate' }) {
  return (
    <div data-testid={testid}
         className={tone === 'amber'
           ? 'rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200'
           : 'rounded-lg border border-slate-700/60 bg-slate-900/40 p-2 text-[11px] text-slate-300'}>
      {children}
    </div>
  );
}

// ── The estimate strip ──────────────────────────────────────────────────────

function KwhStrip({ kwh, pvKw }: { kwh: number; pvKw: number }) {
  if (!(kwh > 0)) return null;
  const backupPct = pvKw > 0 ? Math.min(100, Math.round((kwh / Math.max(1, pvKw * 0.3)) * 100)) : 0;
  return (
    <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
      <div className="text-center">
        <div data-testid="bat-total-kwh" className="text-lg font-black text-emerald-400 tabular-nums">{kwh.toFixed(1)}</div>
        <div className="text-[10px] text-slate-500">Total kWh</div>
      </div>
      <div className="text-center">
        <div className="text-lg font-black text-emerald-400 tabular-nums">~{backupPct}%</div>
        <div className="text-[10px] text-slate-500">Est. Backup</div>
      </div>
      <div className="text-center">
        <div className="text-lg font-black text-emerald-400 tabular-nums">~{(kwh / Math.max(0.5, pvKw * 0.15)).toFixed(1)}h</div>
        <div className="text-[10px] text-slate-500">Est. Runtime</div>
      </div>
    </div>
  );
}

// ── Before the graph has a backup system: the project selection ─────────────

/** The Battery Model picker over the selection — before the graph, and while no system holds a battery. */
function SelectionBatteryModel({ selection, onSelectionChange, options, label, disabled }: {
  selection: BatterySelection;
  onSelectionChange: (patch: Partial<BatterySelection>) => void;
  options: Array<{ value: string; label: string }>;
  label: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <>
      <label className="eng-label" htmlFor="bat-model">{label}</label>
      <select id="bat-model" data-testid="bat-model" value={selection.batteryId} className="eng-select" disabled={disabled}
              onChange={e => onSelectionChange(selectionAfterBatteryChange(e.target.value, selection))}>
        <option value="">None</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </>
  );
}

const SELECTION_BATTERIES = BATTERIES.map(b => ({
  value: b.id,
  label: `${b.isNew ? '🆕 ' : ''}${b.manufacturer} ${b.model} (${b.usableCapacityKwh} kWh)${b.subcategory === 'ac_coupled' ? ' · AC' : ' · DC'}`,
}));

function SelectionControls({ selection, onSelectionChange, gatewayItem, busy }: {
  selection: BatterySelection;
  onSelectionChange: (patch: Partial<BatterySelection>) => void;
  gatewayItem: InterviewItem | null;
  busy: boolean;
}) {
  // The controller lives in `backupControllerId` — never the legacy BUI field (see the lib header).
  const recorded = selection.backupControllerId ?? '';
  const ctl = controllersFor(selection.batteryId || null);
  const listed = ctl.options.some(o => o.value === recorded);
  const { unlisted } = selectionControllerOf({ batteryId: selection.batteryId, backupControllerId: recorded });
  const showController = batteryNeedsController(selection.batteryId) || ctl.options.length > 0 || !!recorded;
  const exps = expansionsFor(selection.batteryId || null);
  const bat = selection.batteryId ? getBatteryById(selection.batteryId) : undefined;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <SelectionBatteryModel selection={selection} onSelectionChange={onSelectionChange} options={SELECTION_BATTERIES}
                                 label="Battery Model" />
        </div>
        <div>
          <label className="eng-label" htmlFor="bat-qty">Quantity</label>
          <input id="bat-qty" data-testid="bat-qty" type="number" min={0} max={10} value={selection.batteryCount}
                 onChange={e => onSelectionChange({ batteryCount: +e.target.value })} className="eng-input" />
        </div>
        <div>
          <label className="eng-label" htmlFor="bat-kwh-unit">kWh / Unit</label>
          <input id="bat-kwh-unit" data-testid="bat-kwh-unit" type="number" min={0} step={0.1} value={selection.batteryKwh}
                 onChange={e => onSelectionChange({ batteryKwh: +e.target.value })} className="eng-input" />
        </div>
        {showController ? (
          <div className="col-span-2">
            <label className="eng-label" htmlFor="bat-controller">
              Backup controller<Owed item={gatewayItem} testid="bat-controller-owed" />
            </label>
            <div className="flex items-center gap-2">
              <select id="bat-controller" data-testid="bat-controller" className="eng-select" disabled={busy} value={recorded}
                      onChange={e => onSelectionChange({ backupControllerId: e.target.value })}>
                <option value="">{ctl.evaluated ? 'Choose…' : 'None listed'}</option>
                {recorded && !listed ? (
                  <option value={recorded} disabled>{controllerName(recorded)} — not listed as fitting</option>
                ) : null}
                {ctl.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="shrink-0 text-xs text-slate-400">×</span>
              <output data-testid="bat-controller-qty" title="One per backed-up system"
                      className="w-8 shrink-0 text-center text-xs font-bold tabular-nums text-slate-200">
                {recorded && !unlisted ? 1 : '—'}
              </output>
            </div>
            {unlisted ? (
              // Another writer (the ecosystem picker, the sizing adoption) changed the battery and left
              // the controller: it is not counted as chosen, and the installer is told why.
              <div data-testid="bat-controller-unlisted" className="mt-1 text-[10px] font-bold text-amber-300">
                The catalogue does not list {controllerName(unlisted)} with {batteryName(selection.batteryId)} — choose a
                listed controller.
              </div>
            ) : null}
            {ctl.evaluated ? null : (
              <div data-testid="bat-controller-note" className="mt-1 text-[10px] font-bold text-amber-300">{ctl.note}</div>
            )}
          </div>
        ) : null}
        {exps.evaluated ? (
          <div data-testid="bat-expansions" className="col-span-2 text-[11px] text-slate-400">
            Expansion packs · {exps.options.map(o => o.label).join(', ')} — recorded per backup system once the
            service is set.
          </div>
        ) : null}
      </div>
      {bat?.backfeedBreakerA ? (
        <div className="text-xs text-orange-400 text-center">+{bat.backfeedBreakerA}A bus load (NEC 705.12B)</div>
      ) : null}
    </>
  );
}

// ── The graph has backup systems: the graph is the record ───────────────────

interface Draft { ess?: string; gw?: string; nEss?: number; exp?: string; nExp?: number; cfg?: string }

const count = (s: string) => Math.max(0, Math.floor(Number(s) || 0));

/** A system's recorded output setting as the select's value ('' ⇒ not recorded). */
const cfgOf = (t: ServiceTopology, domainId: string | null | undefined): string => {
  const d = domainId ? t.domains.find(x => x.id === domainId) : undefined;
  const kw = d ? outputConfigOf(t, d) : null;
  return kw === null ? '' : String(kw);
};
/** The writer's patch for a changed setting select. */
const cfgPatch = (v: string, cur: string): { outputConfigKw?: number | null } =>
  (v !== cur ? { outputConfigKw: v === '' ? null : Number(v) } : {});

/**
 * 🚨 THE OUTPUT SETTING THE BATTERIES ARE COMMISSIONED AT — the Service Topology tab never asked it
 * (its re-equip silently reset it to the top row); it moves the batteries' continuous current and
 * OCPD, so the 120% busbar arithmetic and the ESS output follow it. Offered only for a battery whose
 * manufacturer publishes settings (`outputConfigurationsFor`), as a small select under the count.
 */
function OutputSetting({ testid, ess, value, onChange, disabled }: {
  testid: string; ess: string | null | undefined; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  const settings = outputConfigurationsFor(ess);
  if (settings.length === 0) return null;
  const top = settings[settings.length - 1];
  return (
    <label className="mt-1 block text-[10px] text-slate-500">Commissioned at
      <select data-testid={testid} className="eng-select mt-0.5 !py-0.5 !text-[11px]" disabled={disabled} value={value}
              title="The output setting each battery in this system is commissioned at — its current and OCPD follow it"
              onChange={e => onChange(e.target.value)}>
        <option value="">Not recorded — sized at {top.label}</option>
        {settings.map(o => <option key={o.value} value={o.value}>{o.label} · {o.detail}</option>)}
      </select>
    </label>
  );
}

function GraphControls({ ctx, grouping, apply, gatewayItem }: {
  ctx: BatteryStorageCardProps;
  grouping: BatteryGrouping;
  apply: ApplyAnswer;
  gatewayItem: InterviewItem | null;
}) {
  const t = ctx.topology!;
  const [draft, setDraft] = useState<Draft>({});
  const n = grouping.systems.length;
  const single = n === 1 ? grouping.systems[0] : null;
  // More than one system and none holds a battery yet: the battery model is the project selection's
  // (the per-system counts are asked per system, from it) — there is no graph battery to re-equip.
  const awaiting = grouping.batteries === 0;
  const modelIsSelection = !single && awaiting;
  const cur = {
    ess: grouping.commonStorageProductId ?? '',
    gw: grouping.commonGatewayProductId ?? '',
    nEss: grouping.batteries,
    exp: grouping.commonExpansionProductId ?? '',
    nExp: grouping.expansions,
    // One system: its output setting is edited here. More than one: per system, behind the disclosure.
    cfg: single ? cfgOf(t, single.domainId) : '',
  };
  const v = { ...cur, ...draft };
  const essForFit = modelIsSelection ? (ctx.selection.batteryId || '') : v.ess;
  const ctl = controllersFor(essForFit || null);
  const exps = expansionsFor(v.ess || null);
  // With exactly one expansion the catalogue lists for this battery, that is the one a count records.
  const expProduct = v.exp || (exps.options.length === 1 ? exps.options[0].value : '');
  const showExpansions = exps.evaluated || cur.nExp > 0;
  const changed = (Object.keys(cur) as Array<keyof typeof cur>).some(k => v[k] !== cur[k]);
  const batteries = backupBatteries();
  const essListed = batteries.some(o => o.value === v.ess);
  const gwListed = ctl.options.some(o => o.value === v.gw);
  const ownItem = single ? findInterviewItem(ctx.interview, systemEquipmentItemId(single.domainId)) : null;
  const mixed = grouping.batteries > 0 && grouping.commonStorageProductId === null;

  const save = async () => {
    const r = single
      ? answerSystemEquipment(t, single.domainId, {
        ...(v.gw !== cur.gw ? { gatewayProductId: v.gw } : {}),
        ...(v.ess !== cur.ess ? { storageProductId: v.ess || null } : {}),
        ...(v.nEss !== cur.nEss ? { storageUnits: v.nEss } : {}),
        ...(expProduct !== cur.exp && (v.nExp > 0 || cur.nExp > 0) ? { expansionProductId: expProduct || null } : {}),
        ...(v.nExp !== cur.nExp ? { expansionUnits: v.nExp } : {}),
        ...cfgPatch(v.cfg, cur.cfg),
      })
      : answerEverySystemEquipment(t, {
        ...(v.gw !== cur.gw && v.gw ? { gatewayProductId: v.gw } : {}),
        ...(v.ess !== cur.ess && v.ess ? { storageProductId: v.ess } : {}),
        // No system holds a battery yet: the controller is checked against the selection's battery.
        ...(modelIsSelection && v.gw !== cur.gw && essForFit ? { storageProductId: essForFit } : {}),
      });
    // A refused answer or a failed write keeps what the installer chose.
    if (await apply(r)) setDraft({});
  };

  const every = n > 1 ? <span className="ml-1 normal-case text-slate-500">· every system</span> : null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          {modelIsSelection ? (
            <SelectionBatteryModel selection={ctx.selection} onSelectionChange={ctx.onSelectionChange} options={batteries}
                                   disabled={ctx.busy} label={<>Battery Model{every}</>} />
          ) : (
            <>
              <label className="eng-label" htmlFor="bat-model">
                Battery Model{every}
                <Owed item={ownItem} testid="bat-model-owed" />
              </label>
              <select id="bat-model" data-testid="bat-model" className="eng-select" disabled={ctx.busy} value={v.ess}
                      // A different battery has its own settings (or none): the setting starts unrecorded.
                      onChange={e => setDraft(s => ({ ...s, ess: e.target.value, cfg: '' }))}>
                <option value="" disabled>{n > 1 && grouping.batteries > 0 ? 'Differs per system' : '— choose —'}</option>
                {v.ess && !essListed ? <option value={v.ess} disabled>{batteryName(v.ess)} — not listed for backup</option> : null}
                {batteries.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </>
          )}
        </div>
        <div>
          <label className="eng-label" htmlFor="bat-qty">Quantity</label>
          {single ? (
            <>
              <input id="bat-qty" data-testid="bat-qty" type="number" min={0} step={1} className="eng-input" disabled={ctx.busy}
                     value={v.nEss} onChange={e => setDraft(s => ({ ...s, nEss: count(e.target.value) }))} />
              <OutputSetting testid="bat-output-setting" ess={v.ess || null} value={v.cfg} disabled={ctx.busy}
                             onChange={x => setDraft(s => ({ ...s, cfg: x }))} />
            </>
          ) : (
            <output id="bat-qty" data-testid="bat-qty" className="block text-sm font-black tabular-nums text-slate-100"
                    title="The sum of the systems' batteries — change a count per system">
              {grouping.batteries}
              <span className="ml-1 text-[10px] font-normal text-slate-500">across {n} systems</span>
            </output>
          )}
        </div>
        {showExpansions ? (
          <div>
            <label className="eng-label" htmlFor="bat-expansions">Expansion packs</label>
            {single ? (
              <input id="bat-expansions" data-testid="bat-expansions" type="number" min={0} max={v.nEss} step={1}
                     className="eng-input" disabled={ctx.busy} value={v.nExp}
                     onChange={e => setDraft(s => ({ ...s, nExp: count(e.target.value) }))} />
            ) : (
              <output id="bat-expansions" data-testid="bat-expansions"
                      className="block text-sm font-black tabular-nums text-slate-100">{grouping.expansions}</output>
            )}
            {single && exps.options.length > 1 ? (
              <select data-testid="bat-expansions-model" className="eng-select mt-1" disabled={ctx.busy} value={v.exp}
                      onChange={e => setDraft(s => ({ ...s, exp: e.target.value }))}>
                <option value="">— choose —</option>
                {exps.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : expProduct ? (
              <div className="mt-0.5 text-[10px] text-slate-500">× {batteryName(expProduct)} · DC energy, no AC current</div>
            ) : null}
          </div>
        ) : null}
        <div className="col-span-2">
          <label className="eng-label" htmlFor="bat-controller">
            Backup controller{every}
            <Owed item={gatewayItem} testid="bat-controller-owed" />
          </label>
          <div className="flex items-center gap-2">
            <select id="bat-controller" data-testid="bat-controller" className="eng-select" disabled={ctx.busy} value={v.gw}
                    onChange={e => setDraft(s => ({ ...s, gw: e.target.value }))}>
              <option value="" disabled>{n > 1 ? 'Differs per system' : 'Choose…'}</option>
              {v.gw && !gwListed ? (
                <option value={v.gw} disabled>
                  {controllerName(v.gw)} — {ctl.evaluated ? 'not listed as fitting' : 'compatibility not evaluated'}
                </option>
              ) : null}
              {ctl.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="shrink-0 text-xs text-slate-400">×</span>
            <output data-testid="bat-controller-qty" title="One per backed-up system"
                    className="w-8 shrink-0 text-center text-xs font-bold tabular-nums text-slate-200">
              {grouping.controllers}
            </output>
          </div>
          {ctl.evaluated ? null : (
            <div data-testid="bat-controller-note" className="mt-1 text-[10px] font-bold text-amber-300">{ctl.note}</div>
          )}
        </div>
      </div>
      {mixed ? (
        <Note testid="bat-mixed">
          The systems hold different batteries — {storageByProduct(t).map(p => `${p.count} × ${batteryName(p.productId)}`).join(', ')}.
          The project&apos;s battery selection names one battery
          ({batteriesInWords(ctx.selection.batteryCount)} · {ctx.selection.batteryId ? batteryName(ctx.selection.batteryId) : 'none'}),
          so the drawings and the BOM that read it cannot state this job. Choose one Battery Model for every system.
        </Note>
      ) : null}
      {awaiting ? (
        <Note testid="bat-awaiting">
          No system holds a battery yet
          {ctx.selection.batteryId && ctx.selection.batteryCount > 0
            ? ` — the selection is ${ctx.selection.batteryCount} × ${batteryName(ctx.selection.batteryId)}`
            : ''}. {single ? 'Enter its quantity and Record.'
            : 'How many each system holds is asked for that system, never shared out — Configure systems differently.'}
        </Note>
      ) : null}
      {changed ? (
        <div className="flex items-center gap-2">
          <button type="button" data-testid="bat-record" disabled={ctx.busy}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
                  onClick={() => void save()}>
            {single ? 'Record' : 'Record for every system'}
          </button>
          <button type="button" data-testid="bat-reset" className="text-[11px] text-slate-400 hover:text-slate-200"
                  onClick={() => setDraft({})}>Reset</button>
        </div>
      ) : null}
    </div>
  );
}

// ── AC aggregation — asked once ─────────────────────────────────────────────

function Aggregation({ item, systems, onPick, busy }: {
  item: InterviewItem; systems: number; onPick: (v: Landing) => void; busy: boolean;
}) {
  return (
    <div data-testid="bat-aggregation-row">
      <label className="eng-label" htmlFor="bat-aggregation" title={item.question}>
        AC aggregation<Owed item={item} testid="bat-aggregation-owed" />
        <span className="ml-1 align-middle"><ProvenanceChip source={item.source} compact /></span>
      </label>
      <select id="bat-aggregation" data-testid="bat-aggregation" className="eng-select" disabled={busy}
              value={item.value ?? ''} onChange={e => { if (e.target.value) onPick(e.target.value as Landing); }}>
        <option value="" disabled>{item.state === 'needs-answer' ? 'Not established' : 'Set per system'}</option>
        {(item.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {systems > 1 ? <div className="mt-0.5 text-[10px] text-slate-500">One answer for all {systems} systems.</div> : null}
    </div>
  );
}

// ── One system's own controller, battery count and expansion packs ──────────

interface SystemDraft { gw?: string; nEss?: number; exp?: string; nExp?: number; cfg?: string }

/**
 * What [Configure systems differently] edits for ONE system: its controller, how many batteries and
 * how many expansion packs it holds — through `answerSystemEquipment`, so every refusal the writer
 * has (an unlisted pairing, an expansion the battery does not take, a shared generation panel) is
 * shown and never written. The battery MODEL is not here: it is asked once, for every system. A
 * system holding no battery yet takes the battery every other system holds (or the selection's).
 */
function SystemRow({ t, s, battery, apply, busy }: {
  t: ServiceTopology; s: BatterySystemSummary; battery: string | null; apply: ApplyAnswer; busy: boolean;
}) {
  const [draft, setDraft] = useState<SystemDraft>({});
  const d = t.domains.find(x => x.id === s.domainId);
  if (!d) return null;
  const f = systemEquipmentFacts(t, d);
  if (f.mixed) {
    return (
      <div data-testid={`bat-system-mixed-${s.domainId}`} className="text-[11px] text-amber-300">
        More than one battery model is recorded in {d.label} — choose the Battery Model for every system above.
      </div>
    );
  }
  const ess = f.storageProductId ?? battery;
  const cur = {
    gw: d.gateway.productId, nEss: f.inverting.length, exp: f.expansionProductId ?? '', nExp: f.expansions.length,
    cfg: cfgOf(t, d.id),
  };
  const v = { ...cur, ...draft };
  const ctl = controllersFor(ess);
  const exps = expansionsFor(ess);
  const expProduct = v.exp || (exps.options.length === 1 ? exps.options[0].value : '');
  const showExpansions = exps.evaluated || cur.nExp > 0;
  const gwListed = ctl.options.some(o => o.value === v.gw);
  const changed = (Object.keys(cur) as Array<keyof typeof cur>).some(k => v[k] !== cur[k]);
  const id = s.domainId;

  const save = async () => {
    const r = answerSystemEquipment(t, d.id, {
      ...(v.gw !== cur.gw ? { gatewayProductId: v.gw } : {}),
      // A system's first battery is the one every system holds — never a model chosen per system.
      ...(!f.storageProductId && ess && v.nEss > 0 ? { storageProductId: ess } : {}),
      ...(v.nEss !== cur.nEss ? { storageUnits: v.nEss } : {}),
      ...(expProduct !== cur.exp && (v.nExp > 0 || cur.nExp > 0) ? { expansionProductId: expProduct || null } : {}),
      ...(v.nExp !== cur.nExp ? { expansionUnits: v.nExp } : {}),
      ...cfgPatch(v.cfg, cur.cfg),
    });
    if (await apply(r)) setDraft({});
  };

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-2">
        <label className="text-[11px] text-slate-400">Backup controller
          <select data-testid={`bat-system-controller-${id}`} className="eng-select mt-0.5" disabled={busy} value={v.gw}
                  onChange={e => setDraft(x => ({ ...x, gw: e.target.value }))}>
            {v.gw && !gwListed ? (
              <option value={v.gw} disabled>
                {controllerName(v.gw)} — {ctl.evaluated ? 'not listed as fitting' : 'compatibility not evaluated'}
              </option>
            ) : null}
            {ctl.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-400">Batteries{ess ? ` · ${getBatteryById(ess)?.model ?? ess}` : ''}
          <input type="number" min={0} step={1} data-testid={`bat-system-qty-${id}`} className="eng-input mt-0.5"
                 disabled={busy || !ess} value={v.nEss} title={ess ? undefined : 'Choose the Battery Model above first'}
                 onChange={e => setDraft(x => ({ ...x, nEss: count(e.target.value) }))} />
          <OutputSetting testid={`bat-system-output-${id}`} ess={ess} value={v.cfg} disabled={busy}
                         onChange={x => setDraft(y => ({ ...y, cfg: x }))} />
        </label>
        {showExpansions ? (
          <label className="text-[11px] text-slate-400">Expansion packs
            <input type="number" min={0} max={v.nEss} step={1} data-testid={`bat-system-expansions-${id}`}
                   className="eng-input mt-0.5" disabled={busy} value={v.nExp}
                   onChange={e => setDraft(x => ({ ...x, nExp: count(e.target.value) }))} />
            {exps.options.length > 1 ? (
              <select data-testid={`bat-system-expansions-model-${id}`} className="eng-select mt-0.5" disabled={busy}
                      value={v.exp} onChange={e => setDraft(x => ({ ...x, exp: e.target.value }))}>
                <option value="">— choose —</option>
                {exps.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : null}
          </label>
        ) : null}
      </div>
      {changed ? (
        <button type="button" data-testid={`bat-system-record-${id}`} disabled={busy}
                className="rounded bg-sky-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
                onClick={() => void save()}>
          Record {d.label}
        </button>
      ) : null}
    </div>
  );
}

// ── Battery grouping · N systems ────────────────────────────────────────────

function Grouping({ ctx, grouping, apply }: {
  ctx: BatteryStorageCardProps; grouping: BatteryGrouping; apply: ApplyAnswer;
}) {
  const [open, setOpen] = useState(false);
  const inline = ctx.controlMode === 'manual';
  const expanded = inline || open;
  const t = ctx.topology!;
  const generationItem = findInterviewItem(ctx.interview, GENERATION_PANELS_ITEM_ID);
  // The battery a system holding none yet takes: the one every other system holds, else the selection's.
  const battery = grouping.commonStorageProductId ?? ctx.equipment.storageProductId ?? (ctx.selection.batteryId || null);
  return (
    <div data-testid="bat-grouping" data-expanded={expanded ? 'true' : 'false'}
         className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-2 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-300">
          Battery grouping · {grouping.systems.length} systems
        </span>
        {inline ? null : (
          <button type="button" data-testid="bat-configure-differently" aria-expanded={open}
                  className="ml-auto text-[11px] font-bold text-sky-300 hover:text-sky-200"
                  onClick={() => setOpen(o => !o)}>
            {open ? 'Done' : 'Configure systems differently'}
          </button>
        )}
      </div>
      {grouping.systems.map(s => {
        const item = findInterviewItem(ctx.interview, systemEquipmentItemId(s.domainId));
        return (
          <div key={s.domainId} data-testid={`bat-system-${s.domainId}`} data-state={item?.state ?? undefined}
               className="text-xs text-slate-300">
            {s.line}<Owed item={item} testid={`bat-system-owed-${s.domainId}`} />
          </div>
        );
      })}
      {expanded ? (
        <div className="space-y-2 pt-1">
          {grouping.systems.map(s => {
            const landing = findInterviewItem(ctx.interview, systemLandingItemId(s.domainId));
            return (
              <div key={s.domainId} data-testid={`bat-system-edit-${s.domainId}`}
                   className="rounded border border-slate-700/60 p-2 space-y-2">
                <div className="text-[11px] font-bold text-slate-100">{s.label}</div>
                <SystemRow t={t} s={s} battery={battery} apply={apply} busy={ctx.busy} />
                {/* This system's own generation panel — panelboard, busbar, SCCR — beside its system. */}
                {(t.aggregationPanels ?? []).some(a => a.domainId === s.domainId) ? (
                  <div data-testid={`bat-system-generation-${s.domainId}`}>
                    <div className="text-[11px] text-slate-400">Its generation panel
                      <Owed item={generationItem} testid={`bat-system-generation-owed-${s.domainId}`} />
                    </div>
                    <GenerationPanelsEditor topology={t} apply={apply} busy={ctx.busy} domainId={s.domainId} />
                  </div>
                ) : null}
                {landing ? (
                  <label className="block text-[11px] text-slate-400">Its battery AC circuits
                    <select data-testid={`bat-system-landing-${s.domainId}`} className="eng-select mt-0.5"
                            disabled={ctx.busy} value={landing.value ?? ''}
                            onChange={e => {
                              if (e.target.value) void apply(answerSystemLanding(t, s.domainId, e.target.value as Landing));
                            }}>
                      <option value="" disabled>Not established</option>
                      {(landing.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            );
          })}
          {/* A generation panel the systems SHARE (site-wide) belongs to none of them. */}
          {(t.aggregationPanels ?? []).some(a => !a.domainId) ? (
            <div data-testid="bat-shared-generation" className="rounded border border-slate-700/60 p-2">
              <div className="text-[11px] font-bold text-slate-100">Shared generation panel
                <Owed item={generationItem} testid="bat-shared-generation-owed" />
              </div>
              <GenerationPanelsEditor topology={t} apply={apply} busy={ctx.busy} domainId={null} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Battery Storage OFF while the service record still holds batteries ─────

/**
 * OFF clears the project selection; it does not edit the service record. When the record still
 * holds batteries the installer is told so, and where they are removed — the toggle never claims
 * a drawing without them.
 */
export function BatteryOffNote({ topology }: { topology: ServiceTopology | null | undefined }) {
  const g = batteryGroupingOf(topology);
  if (!g || !graphHoldsBatteries(topology)) return null;
  return (
    <Note testid="bat-off-graph-note">
      The service record still holds {batteriesInWords(g.batteries)} in {g.systems.length} backup
      system{g.systems.length === 1 ? '' : 's'}, and what is drawn from it keeps them. Set Backup to none in System
      Configuration to remove them.
    </Note>
  );
}

// ── The card body ───────────────────────────────────────────────────────────

export function BatteryStorageCard(props: BatteryStorageCardProps) {
  const { topology: t, interview, selection, onSelectionChange, busy, pvKw } = props;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The writers' refusals are shown in this card and never written, and so is an edit that would
  // leave every system with no battery; an accepted answer goes to the page's one write path, and a
  // write it could not save is said here, where it was made.
  const apply: ApplyAnswer = async r => {
    if (r.ok === false) { setRefusal(r.refused); return false; }
    if (graphHoldsBatteries(t) && r.topology.domains.length > 0 && !graphHoldsBatteries(r.topology)) {
      setRefusal(EMPTIES_EVERY_SYSTEM);
      return false;
    }
    setRefusal(null);
    const ok = await props.apply(r);
    setFailed(!ok);
    return ok;
  };
  const grouping = batteryGroupingOf(t);
  const landing = findInterviewItem(interview, 'behavior.storage-landing');
  const gatewayItem = findInterviewItem(interview, 'equipment.gateway');

  return (
    <div className="space-y-3" data-testid="bat-card" data-record={grouping ? 'service-graph' : 'selection'}>
      <KwhStrip kwh={storageTotalKwh(t, selection)} pvKw={pvKw} />
      {grouping && t ? (
        <GraphControls ctx={props} grouping={grouping} apply={apply} gatewayItem={gatewayItem} />
      ) : (
        <SelectionControls selection={selection} onSelectionChange={onSelectionChange} gatewayItem={gatewayItem} busy={busy} />
      )}
      {landing && t && landing.options ? (
        <Aggregation item={landing} systems={t.domains.length} busy={busy}
                     onPick={v => void apply(answerStorageLanding(t, v))} />
      ) : null}
      {grouping && t && grouping.systems.length > 1 ? <Grouping ctx={props} grouping={grouping} apply={apply} /> : null}
      {refusal ? (
        <div data-testid="bat-refusal" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
          {refusal}
        </div>
      ) : null}
      {failed ? (
        <div data-testid="bat-error" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
          {props.error || 'The change was not saved — the service record did not accept it.'}
        </div>
      ) : null}
    </div>
  );
}

export default BatteryStorageCard;
