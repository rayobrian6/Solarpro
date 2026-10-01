'use client';

// ═══════════════════════════════════════════════════════════════════════════
// THE SERVICE TOPOLOGY SCREEN — SEEN FIRST, CONFIGURED THROUGH, PROVED UNDERNEATH.
//
// Ray tested the first version in Dev and rejected its UX, not its engineering:
//
//   "DO NOT REWRITE THE SERVICE TOPOLOGY ENGINE. The problem is the UX. Right now the page exposes
//    the internal graph-building primitives directly... then large walls of PASS / NOT EVALUATED
//    text. This is too difficult to operate on a real job."
//   "Normal workflow should be: understand topology → configure topology → see unresolved
//    requirements → inspect engineering proof if needed."
//
// So the order on this screen is exactly that:
//
//   1  SUMMARY BAR        — does SolarPro understand the system? One line, answered immediately.
//   2  VISUAL TOPOLOGY    — the electrical system, drawn. Click any box to edit that box.
//   3  NEEDS INPUT        — "3 items required to finish engineering", each one a link to the field.
//   4  ENGINEERING CHECKS — the canonical PASS / FAIL / NOT_EVALUATED proof, collapsed by default.
//   5  ADVANCED TOPOLOGY  — the original primitives, kept for unusual systems, behind the model.
//
// 🚨 ONE MODEL. The visual builder edits the exact canonical `ServiceTopology`; there is no
// simplified copy of it anywhere in this file, and every mutation is a pure function from
// `topologyAuthoring.ts`. Ray: "Do not create a second simplified service model merely to make the
// screen easier."
//
// 🚨 AND THE ENGINEERING CONCLUSION IS UNCHANGED. `NOT_EVALUATED` is still `NOT_EVALUATED` in the
// model; the summary merely WORDS it as "needs input" for a reader. Ray: "Preserve the
// NOT_EVALUATED engineering conclusion... Do not change the engineering conclusion itself."
// ═══════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ServiceTopologyPanel } from './ServiceTopologyPanel';
import { ServiceTopologyMap } from './ServiceTopologyMap';
import { ServiceNodeInspector } from './ServiceNodeInspector';
import { ServiceTopologyWizard } from './ServiceTopologyWizard';
import { StatusBadge } from './StatusBadge';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import {
  buildServiceOverview, conclusionWord, groupRequirements,
} from '@/lib/electrical/topologyOverview';
import {
  createServiceTopology, addServiceBranch, addPanel, addBackupDomain, addProtectiveDevice,
  setInterconnection,
} from '@/lib/electrical/topologyAuthoring';
import { addBranchWithPanel } from '@/lib/electrical/topologyPresets';
import { BACKUP_INTERFACES, BATTERIES } from '@/lib/equipment-db';

const GATEWAYS = () => BACKUP_INTERFACES.filter(g => g.subcategory === 'gateway_controller');
const INVERTING = () => BATTERIES.filter(b => (b.storageRole ?? 'inverter-unit') === 'inverter-unit');
const EXPANSIONS = () => BATTERIES.filter(b => b.storageRole === 'energy-expansion');

export interface ServiceTopologyBuilderProps {
  projectId: string | null;
  /** Injected in tests; defaults to the browser fetch. */
  fetchImpl?: typeof fetch;
  /**
   * 🚨 THE REST OF THE PAGE NEEDS TO KNOW WHAT THIS IS.
   *
   * Ray, from the live browser: "Service Topology says Tesla. Main electrical system still says
   * MICROINVERTER... The sidebar and SLD must share authority." The sidebar could not agree with
   * the topology because it had never seen it — this component loaded the graph and kept it. This
   * hands the loaded graph up so the page reads the SAME object, rather than a second copy fetched
   * somewhere else that can drift from it.
   */
  onTopologyChange?: (t: ServiceTopology | null) => void;
}

export function ServiceTopologyBuilder({
  projectId, fetchImpl, onTopologyChange,
}: ServiceTopologyBuilderProps) {
  const doFetch = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  const [topology, setTopology] = useState<ServiceTopology | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [showProof, setShowProof] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── THE LIFECYCLE RAY COULD NOT COMPLETE ──────────────────────────────────
  //
  // 🚨 "Ray saved a topology and then had no obvious way to edit it. Fix this. Required lifecycle:
  // View topology → Edit topology → change equipment/service/interconnection → Save changes → view."
  //
  // A saved topology used to land straight in the editing surface with no mode at all: no Edit
  // button to press, no Save changes to finish with, and nothing to discard if you had wandered
  // into the wrong number. So there are two modes, and — because Ray also asked that "the visual
  // diagram itself should remain editable by clicking" — clicking any node in VIEW mode is what
  // enters EDIT mode on that node. The wizard creates; it is never the only way to edit.
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  /** The topology as it was when editing began, so Discard is exact rather than a reload. */
  const [beforeEdit, setBeforeEdit] = useState<ServiceTopology | null>(null);
  /** Re-entering the guided flow on an EXISTING topology, rather than only on an empty project. */
  const [guided, setGuided] = useState(false);

  const beginEdit = useCallback((nodeId?: string | null, field?: string | null) => {
    setBeforeEdit(prev => prev ?? topology);
    setMode('edit');
    if (nodeId !== undefined) { setSelectedId(nodeId); setFocusField(field ?? null); }
  }, [topology]);

  // Advanced-strip drafts (the original primitives, preserved).
  const [serviceAmps, setServiceAmps] = useState(400);
  const [branchAmps, setBranchAmps] = useState(200);
  const [panelBus, setPanelBus] = useState(200);
  const [panelMain, setPanelMain] = useState(200);
  const [gatewayId, setGatewayId] = useState('');
  const [essId, setEssId] = useState('');
  const [expansionId, setExpansionId] = useState('');

  useEffect(() => {
    const gw = GATEWAYS(); if (gw.length && !gatewayId) setGatewayId(gw[0].id);
    const es = INVERTING(); if (es.length && !essId) setEssId(es[0].id);
    const ex = EXPANSIONS(); if (ex.length && !expansionId) setExpansionId(ex[0].id);
  }, [gatewayId, essId, expansionId]);

  const load = useCallback(async () => {
    if (!projectId || !doFetch) return;
    setLoading(true); setMessage(null);
    try {
      const res = await doFetch(`/api/projects/${projectId}/service-topology`);
      const data = await res.json().catch(() => null);
      if (data?.success && data.available) setTopology(data.topology as ServiceTopology);
      else setTopology(null);
    } catch (e) {
      setMessage(`Could not load the service topology: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, [projectId, doFetch]);

  useEffect(() => { void load(); }, [load]);

  // Every change, not only the loads: the sidebar must follow an edit in progress too, or it goes
  // back to disagreeing with the screen beside it the moment somebody picks a coupling.
  useEffect(() => { onTopologyChange?.(topology); }, [topology, onTopologyChange]);

  const save = useCallback(async () => {
    if (!projectId || !topology || !doFetch) return;
    setSaving(true); setMessage(null);
    try {
      const res = await doFetch(`/api/projects/${projectId}/service-topology`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topology }),
      });
      const data = await res.json().catch(() => null);
      setMessage(data?.success ? 'Service topology saved.' : (data?.error ?? 'Save failed.'));
      // 🚨 BACK TO VIEW ONLY ON A REAL SAVE. Returning to view after a failed PUT would show the
      // operator their unsaved edits as though they were the saved design.
      if (data?.success) { setMode('view'); setBeforeEdit(null); setSelectedId(null); }
    } catch (e) {
      setMessage(`Save failed: ${(e as Error).message}`);
    } finally { setSaving(false); }
  }, [projectId, topology, doFetch]);

  const discard = useCallback(() => {
    // A snapshot exists when editing something that was already saved. A topology built this
    // session has none, so the only honest "before" is what the store actually holds — which is what
    // a reload fetches.
    if (beforeEdit) setTopology(beforeEdit); else void load();
    setBeforeEdit(null); setMode('view'); setSelectedId(null); setFocusField(null);
    setUnresolved([]); setGuided(false);
    setMessage('Changes discarded.');
  }, [beforeEdit, load]);

  const overview = useMemo(
    () => (topology ? buildServiceOverview(topology) : null), [topology]);

  const btn = 'rounded bg-slate-700 px-2 py-1 text-xs text-slate-100 hover:bg-slate-600 disabled:opacity-40';
  const num = 'w-20 rounded bg-slate-800 px-2 py-1 text-xs text-slate-100';

  // ── EMPTY: THE GUIDED FLOW ────────────────────────────────────────────────
  if (!topology || !overview) {
    return (
      <div className="space-y-4" data-testid="service-topology-builder">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-black text-slate-100">SERVICE TOPOLOGY</span>
          {loading ? <span className="text-xs text-slate-400">loading…</span> : null}
          <button type="button" className={btn} data-testid="topology-reload"
                  onClick={() => void load()} disabled={!projectId}>Reload</button>
          {message ? <span data-testid="topology-message" className="text-xs text-amber-300">{message}</span> : null}
        </div>

        {/* A topology that has just been built has not been SAVED, so the screen it lands on is the
            editing one — with Save changes on it. Landing in view mode would show unsaved work as
            though it were the saved design. */}
        <ServiceTopologyWizard onBuilt={t => {
          setTopology(t); setSelectedId('service'); setMode('edit'); setBeforeEdit(null);
        }} />

        {/* Advanced stays reachable even from empty — Ray: "Preserve access to detailed graph
            editing for unusual systems. Do not make Advanced the default workflow." */}
        <details className="rounded-xl border border-slate-800 bg-slate-900/40 p-3"
                 open={showAdvanced}
                 onToggle={e => setShowAdvanced((e.currentTarget as HTMLDetailsElement).open)}>
          <summary data-testid="advanced-toggle"
                   className="cursor-pointer text-xs font-bold text-slate-400">
            Advanced topology
          </summary>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-400">Aggregate service
              <input type="number" className={`${num} ml-1`} data-testid="new-service-amps"
                     value={serviceAmps} onChange={e => setServiceAmps(Number(e.target.value))} />
            </label>
            <span className="text-xs text-slate-400">A</span>
            <button type="button" className={btn} data-testid="create-service"
                    onClick={() => { setTopology(createServiceTopology({ ratedAmps: serviceAmps }));
                                     setSelectedId('service'); setMode('edit'); setBeforeEdit(null); }}>
              Create bare service
            </button>
            <span className="text-xs text-slate-500">
              A service is an aggregate rating with branches under it — not a main-panel number.
            </span>
          </div>
        </details>
      </div>
    );
  }

  const { summary, allocation } = overview;
  const needs = overview.requiredInputs;

  return (
    <div className="space-y-4" data-testid="service-topology-builder">
      {/* ── 1. SUMMARY BAR — "did SolarPro understand the system?" ─────────── */}
      {/* 🚨 THE SYSTEM AS IT IS DESCRIBED ON SITE, AND THE COUNTS UNDERNEATH.
          Ray read the first bar — "2 × service branch · 2 panels · 2 backup domains · 2 gateways" —
          and could not find his own installation in it. A branch, a panel and a backup domain are
          three names for one 200 A system to the person installing it, so the bar leads with that.
          Ray's target, near verbatim: 400 A service / 2 × 200 A systems / 2 Gateway 3 / 2 Powerwall
          3 / 2 Expansion / 54.0 kWh / 96 A AC / 2 external isolation switches. */}
      <div data-testid="topology-summary"
           className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-lg font-black text-slate-100">
            {summary.serviceAmps} A service
            {summary.serviceEquipmentIsExisting
              ? <span className="ml-1 text-xs font-bold text-amber-300">(existing)</span> : null}
          </span>
          {summary.systemsLabel ? (
            <span data-testid="topology-systems" className="text-sm font-bold text-slate-100">
              {summary.systemsLabel}
            </span>
          ) : null}
          {summary.gatewayCount > 0 ? (
            <span className="text-sm text-slate-300">
              {summary.gatewayCount} {summary.gatewayModelLabel ?? 'gateway'}
            </span>
          ) : null}
          {summary.invertingUnitCount > 0 ? (
            <span className="text-sm text-slate-300">
              {summary.invertingUnitCount} {summary.batteryModelLabel ?? 'battery unit'}
            </span>
          ) : null}
          {summary.expansionUnitCount > 0 ? (
            <span className="text-sm text-sky-300">
              {summary.expansionUnitCount} Expansion
            </span>
          ) : null}
          <span className="text-sm font-bold text-slate-100">
            {summary.usableKwh === null ? '— kWh' : `${summary.usableKwh.toFixed(1)} kWh`}
          </span>
          <span className="text-sm font-bold text-slate-100">
            {summary.continuousOutputA === null ? '— A' : `${summary.continuousOutputA} A`} AC
          </span>
          {summary.isolationSwitchCount > 0 ? (
            <span data-testid="topology-isolation-switches" className="text-sm text-slate-300">
              {summary.isolationSwitchCount} external isolation switch
              {summary.isolationSwitchCount === 1 ? '' : 'es'}
            </span>
          ) : null}
          {/* 🚨 ONE PER SYSTEM AND ONE SHARED ARE DIFFERENT DESIGNS, so they are different words.
              Ray's job has two of the first kind and none of the second; a bar that said "2
              generation panels" for either would hide the distinction the whole arrangement turns
              on. */}
          {summary.perSystemGenerationPanelCount > 0 ? (
            <span data-testid="topology-generation-panels" className="text-sm text-emerald-300">
              {summary.perSystemGenerationPanelCount} generation panel
              {summary.perSystemGenerationPanelCount === 1 ? '' : 's'} — one per system
            </span>
          ) : null}
          {summary.aggregationPanelCount - summary.perSystemGenerationPanelCount > 0 ? (
            <span className="text-sm text-emerald-300">
              {summary.aggregationPanelCount - summary.perSystemGenerationPanelCount} combined
              generation panel
            </span>
          ) : null}
          <span data-testid="topology-arrangement" className={`text-sm ${
            summary.derArrangementLabel ? 'text-slate-300' : 'text-amber-300'}`}>
            {summary.derArrangementLabel ?? 'Connection arrangement not chosen'}
          </span>
          {/* The project's one answer about the PV, on the bar — the contradiction Ray read in the
              browser was between two surfaces that each inferred this. */}
          <span data-testid="topology-solar-coupling" className={`text-sm ${
            summary.solarCouplingSelected ? 'text-slate-300' : 'text-amber-300'}`}>
            {summary.solarCouplingSelected
              ? summary.solarCouplingLabel : 'Solar connection not chosen'}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <StatusBadge status={overview.site.conclusion} />
            {/* 🚨 NOT "8 INPUTS REQUIRED". Ray: "Do not say `8 inputs required` when several are
                calculations or optional." Two sentences, because they mean two different things and
                only one of them is waiting on him. */}
            <span data-testid="topology-needs-count" className="text-xs text-slate-300">
              {summary.requiredCount === 0
                ? 'Topology complete'
                : `${summary.requiredCount} required item${
                    summary.requiredCount === 1 ? '' : 's'} unresolved`}
              {summary.optionalCount > 0
                ? ` · ${summary.optionalCount} optional calculation${
                    summary.optionalCount === 1 ? '' : 's'} not provided`
                : ''}
            </span>
          </span>
        </div>

        {/* The engineering counts, kept — they are what a plan reviewer reads. */}
        <div data-testid="topology-engineering-counts" className="mt-1 text-[11px] text-slate-500">
          {summary.phaseLabel} · {summary.branchCount} service branch
          {summary.branchCount === 1 ? '' : 'es'} · {summary.panelCount} panelboard
          {summary.panelCount === 1 ? '' : 's'} · {summary.domainCount} backup domain
          {summary.domainCount === 1 ? '' : 's'}
          {summary.poiCount > 0 ? ` · ${summary.poiCount} point${
            summary.poiCount === 1 ? '' : 's'} of interconnection` : ''}
        </div>

        {/* 🚨 THE 400 A SPLIT, MADE OBVIOUS. */}
        {allocation.unallocatedAmps > 0 || allocation.overAllocatedAmps > 0 ? (
          <div data-testid="topology-allocation"
               className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <span className="text-xs text-amber-200">
              {allocation.ratedAmps} A service · {allocation.allocatedAmps} A allocated ·{' '}
              {allocation.overAllocatedAmps > 0
                ? <b>{allocation.overAllocatedAmps} A OVER the service rating</b>
                : <b>{allocation.unallocatedAmps} A unassigned</b>}
            </span>
            {allocation.suggestedBranchAmps ? (
              <button type="button" data-testid="complete-the-service" className={btn}
                      onClick={() => {
                        let t = topology;
                        for (let i = 0; i < allocation.suggestedBranchCount; i++) {
                          t = addBranchWithPanel(t, allocation.suggestedBranchAmps!).topology;
                        }
                        setTopology(t);
                      }}>
                Complete {allocation.suggestedBranchCount + topology.branches.length} ×{' '}
                {allocation.suggestedBranchAmps} A service
              </button>
            ) : null}
          </div>
        ) : null}

        {/* ── VIEW → EDIT → SAVE CHANGES → VIEW ───────────────────────────── */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {mode === 'view' ? (
            <>
              <button type="button"
                      className="rounded bg-sky-600 px-3 py-1 text-xs font-bold text-white hover:bg-sky-500"
                      data-testid="topology-edit"
                      onClick={() => beginEdit('service')}>
                Edit topology
              </button>
              <button type="button" className={btn} data-testid="topology-reload"
                      onClick={() => void load()} disabled={!projectId}>Reload</button>
              <span className="text-[11px] text-slate-500">
                Or click any box in the diagram to edit it.
              </span>
            </>
          ) : (
            <>
              <button type="button"
                      className="rounded bg-sky-600 px-3 py-1 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40"
                      data-testid="topology-save"
                      onClick={() => void save()} disabled={!projectId || saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className={btn} data-testid="topology-discard"
                      onClick={discard} disabled={saving}>
                Discard changes
              </button>
              {/* 🚨 THE WIZARD IS NOT THE ONLY WAY TO EDIT — AND IT IS STILL A WAY TO EDIT.
                  Ray: "The wizard creates the topology. The wizard must not be the only way to edit
                  it." It re-opens ON the current graph, so it changes the same object the diagram
                  does rather than starting a second design. */}
              <button type="button" className={btn} data-testid="topology-guided"
                      onClick={() => setGuided(g => !g)}>
                {guided ? 'Close guided setup' : 'Guided setup'}
              </button>
            </>
          )}
          {loading ? <span className="text-xs text-slate-400">loading…</span> : null}
          {message ? <span data-testid="topology-message" className="text-xs text-amber-300">{message}</span> : null}
        </div>
      </div>

      {mode === 'edit' && guided ? (
        <ServiceTopologyWizard
          initial={topology}
          meterCollarPermitted={topology.interconnection.meterCollarPermitted}
          onBuilt={t => { setTopology(t); setGuided(false); }}
          onCancel={() => setGuided(false)}
        />
      ) : null}

      {/* ── 2. THE ELECTRICAL SYSTEM ───────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
        <ServiceTopologyMap
          topology={topology} overview={overview}
          selectedId={mode === 'edit' ? selectedId : null}
          // 🚨 CLICKING A BOX IS THE WAY IN. Ray: "The visual diagram itself should remain editable
          // by clicking: service / branch / panel / switch / Gateway / Powerwall / Expansion."
          onSelect={id => beginEdit(id)}
          onAddBranch={amps => {
            beginEdit();
            setTopology(addBranchWithPanel(topology, amps).topology);
          }}
        />
      </div>

      {mode === 'edit' && selectedId ? (
        <ServiceNodeInspector
          topology={topology} selectedId={selectedId} focusField={focusField}
          onChange={setTopology} onUnresolved={setUnresolved}
        />
      ) : null}

      {unresolved.length > 0 ? (
        <div data-testid="builder-unresolved"
             className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-200">
          {unresolved.map((u, i) => <div key={i}>{u}</div>)}
        </div>
      ) : null}

      {/* ── 3. NEEDS INPUT — grouped by WHO OWES IT ─────────────────────────
          Ray: "Don't present all five categories as equivalent text boxes." A number the utility
          owes, a ruling the jurisdiction owes, a document the manufacturer owes, a calculation
          SolarPro will run and a choice the designer has not made are five different kinds of
          blocked, and only some of them can be cleared this afternoon. */}
      {needs.length > 0 ? (
        <div data-testid="topology-needs-input"
             className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="text-sm font-black text-amber-300">
            {summary.requiredCount === 0
              ? 'TOPOLOGY COMPLETE'
              : `NEEDS INPUT — ${summary.requiredCount} required item${
                  summary.requiredCount === 1 ? '' : 's'} unresolved`}
            {summary.optionalCount > 0 ? (
              <span className="font-normal text-amber-200/70">
                {' '}· {summary.optionalCount} optional calculation
                {summary.optionalCount === 1 ? '' : 's'} not provided
              </span>
            ) : null}
          </div>
          <div className="mt-3 space-y-3">
            {groupRequirements(needs).map(group => (
              <div key={group.spec.owner} data-testid={`needs-group-${group.spec.owner}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[11px] font-black uppercase tracking-widest text-amber-200">
                    {group.spec.heading}
                  </span>
                  <span className="text-[10px] text-amber-200/60">{group.spec.action}</span>
                </div>
                {/* 🚨 THE REASON IS PRINTED ONCE PER REASON, NOT ONCE PER ITEM.
                    Six facts about the existing service assembly all come from one check, so the
                    screen printed the same three-line paragraph six times running — a wall of
                    repeated text, which is the shape Ray rejected in the first place. Consecutive
                    items that share a reason show it under the last of them. */}
                <ul className="mt-1 space-y-1">
                  {group.items.map((n, i) => {
                    const sameNext = group.items[i + 1]?.because === n.because;
                    return (
                      <li key={n.key}>
                        {/* Every unresolved item has a useful action: it opens the editor on the
                            exact field that answers it. */}
                        <button type="button" data-testid={`need-${n.key}`}
                                className="w-full rounded px-2 py-0.5 text-left text-xs text-amber-100 hover:bg-amber-500/10"
                                onClick={() => beginEdit(n.focus.nodeId, n.focus.field ?? null)}>
                          <span className="font-bold">{n.label}</span>
                          {sameNext ? null : (
                            <span className="block text-[11px] text-amber-200/70">{n.because}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── 4. THE ENGINEERING PROOF, UNDERNEATH ───────────────────────────── */}
      <details className="rounded-xl border border-slate-800 bg-slate-900/40 p-3"
               open={showProof}
               onToggle={e => setShowProof((e.currentTarget as HTMLDetailsElement).open)}>
        <summary data-testid="proof-toggle" className="cursor-pointer text-xs font-bold text-slate-400">
          Show engineering checks ({overview.evaluation.checks.length})
        </summary>
        <div className="mt-3">
          {/* Read-only on purpose: configuration happens through the visual system above, so there
              is exactly one place to change any number. */}
          <ServiceTopologyPanel topology={topology} />
        </div>
      </details>

      {/* ── 5. ADVANCED — the original primitives, preserved, behind the model ─
          Only while editing: it mutates the graph, and a control that changes a design does not
          belong on a screen whose job is to show what was saved. */}
      {mode === 'edit' ? (
      <details className="rounded-xl border border-slate-800 bg-slate-900/40 p-3"
               open={showAdvanced}
               onToggle={e => setShowAdvanced((e.currentTarget as HTMLDetailsElement).open)}>
        <summary data-testid="advanced-toggle" className="cursor-pointer text-xs font-bold text-slate-400">
          Advanced topology
        </summary>
        <div className="mt-3 space-y-2">
          <div className="text-[11px] text-slate-500">
            Arbitrary branches, panels and domains for systems the guided flow does not describe.
            These edit the same graph.
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-32 text-xs text-slate-400">Service branch</span>
            <input type="number" className={num} data-testid="new-branch-amps"
                   value={branchAmps} onChange={e => setBranchAmps(Number(e.target.value))} />
            <button type="button" className={btn} data-testid="add-branch"
                    onClick={() => setTopology(addServiceBranch(topology, { ratedAmps: branchAmps }).topology)}>
              Add branch
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-32 text-xs text-slate-400">Panel (bus / main)</span>
            <input type="number" className={num} data-testid="new-panel-bus"
                   value={panelBus} onChange={e => setPanelBus(Number(e.target.value))} />
            <input type="number" className={num} data-testid="new-panel-main"
                   value={panelMain} onChange={e => setPanelMain(Number(e.target.value))} />
            <button type="button" className={btn} data-testid="add-panel"
                    onClick={() => setTopology(
                      addPanel(topology, { busbarRatingA: panelBus, mainBreakerA: panelMain }).topology)}>
              Add panel
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-32 text-xs text-slate-400">Backup domain</span>
            <select className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-100"
                    data-testid="new-domain-gateway" value={gatewayId}
                    onChange={e => setGatewayId(e.target.value)}>
              {GATEWAYS().map(g => <option key={g.id} value={g.id}>{g.manufacturer} {g.model}</option>)}
            </select>
            <select className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-100"
                    data-testid="new-domain-ess" value={essId}
                    onChange={e => setEssId(e.target.value)}>
              {INVERTING().map(b => <option key={b.id} value={b.id}>{b.manufacturer} {b.model}</option>)}
            </select>
            <select className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-100"
                    data-testid="new-domain-expansion" value={expansionId}
                    onChange={e => setExpansionId(e.target.value)}>
              <option value="">no expansion</option>
              {EXPANSIONS().map(b => <option key={b.id} value={b.id}>{b.manufacturer} {b.model}</option>)}
            </select>
            <button type="button" className={btn} data-testid="add-domain"
                    disabled={topology.branches.length === 0 || topology.panels.length === 0}
                    onClick={() => {
                      // Each new domain takes the next unassigned branch and panel — which is
                      // what "one gateway per 200 A path" means in this flow.
                      const usedBranches = new Set(topology.domains.map(d => d.branchId));
                      const usedPanels = new Set(topology.domains.flatMap(d => d.backedUpPanelIds));
                      const branch = topology.branches.find(b => !usedBranches.has(b.id));
                      const panel = topology.panels.find(p => !usedPanels.has(p.id));
                      if (!branch || !panel) {
                        setMessage('Add another branch and panel before adding a domain.');
                        return;
                      }
                      const r = addBackupDomain(topology, {
                        branchId: branch.id,
                        panelIds: [panel.id],
                        gatewayProductId: gatewayId,
                        storageProductIds: essId ? [essId] : [],
                        expansionProductIds: expansionId ? [expansionId] : [],
                      });
                      setTopology(r.topology);
                      setUnresolved(r.unresolved);
                    }}>
              Add backup domain
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-32 text-xs text-slate-400">Disconnects</span>
            <button type="button" className={btn} data-testid="add-service-disconnect"
                    onClick={() => setTopology(addProtectiveDevice(topology, {
                      label: `${topology.service.ratedAmps} A service disconnect`,
                      roles: ['service-disconnect'],
                      ratedAmps: topology.service.ratedAmps,
                      lockableOpen: true,
                      locationNote: 'Ahead of the service distribution.',
                    }).topology)}>
              Add service disconnect
            </button>
            <button type="button" className={btn} data-testid="add-der-isolation"
                    onClick={() => setTopology(addProtectiveDevice(topology, {
                      label: 'Utility DER isolation disconnect',
                      roles: ['der-isolation-disconnect'],
                      ratedAmps: topology.service.ratedAmps,
                      lockableOpen: true, visibleOpen: true,
                      locationNote: 'Adjacent to the revenue meter, accessible to the utility.',
                    }).topology)}>
              Add utility DER isolation
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-32 text-xs text-slate-400">Interconnection</span>
            <label className="text-xs text-slate-300">
              <input type="checkbox" data-testid="meter-collar-permitted"
                     checked={topology.interconnection.meterCollarPermitted === true}
                     onChange={e => setTopology(setInterconnection(topology, {
                       meterCollarPermitted: e.target.checked,
                       meterCollarSelected: e.target.checked
                         ? topology.interconnection.meterCollarSelected : false,
                     }))} />
              {' '}Meter collar permitted on this project
            </label>
            <label className="text-xs text-slate-300">
              <input type="checkbox" data-testid="meter-collar-selected"
                     disabled={topology.interconnection.meterCollarPermitted !== true}
                     checked={topology.interconnection.meterCollarSelected}
                     onChange={e => setTopology(setInterconnection(topology, {
                       meterCollarSelected: e.target.checked,
                     }))} />
              {' '}Meter-collar interconnection selected
            </label>
            <label className="text-xs text-slate-300">
              <input type="checkbox" data-testid="der-isolation-required"
                     checked={topology.interconnection.externalDerIsolationRequired === true}
                     onChange={e => setTopology(setInterconnection(topology, {
                       externalDerIsolationRequired: e.target.checked,
                     }))} />
              {' '}Utility requires an external, utility-accessible safety switch
            </label>
          </div>
        </div>
      </details>
      ) : null}
    </div>
  );
}

export default ServiceTopologyBuilder;
