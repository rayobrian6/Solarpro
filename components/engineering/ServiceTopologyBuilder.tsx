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
}

export function ServiceTopologyBuilder({ projectId, fetchImpl }: ServiceTopologyBuilderProps) {
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
    } catch (e) {
      setMessage(`Save failed: ${(e as Error).message}`);
    } finally { setSaving(false); }
  }, [projectId, topology, doFetch]);

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

        <ServiceTopologyWizard onBuilt={t => { setTopology(t); setSelectedId('service'); }} />

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
                                     setSelectedId('service'); }}>
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
      <div data-testid="topology-summary"
           className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-lg font-black text-slate-100">{summary.serviceAmps} A service</span>
          <span className="text-sm text-slate-300">
            {summary.branchCount} × service branch
          </span>
          <span className="text-sm text-slate-300">
            {summary.panelCount} panel{summary.panelCount === 1 ? '' : 's'}
          </span>
          <span className="text-sm text-slate-300">
            {summary.domainCount} backup domain{summary.domainCount === 1 ? '' : 's'}
          </span>
          <span className="text-sm text-slate-300">{summary.gatewayCount} gateway
            {summary.gatewayCount === 1 ? '' : 's'}</span>
          <span className="text-sm text-slate-300">
            {summary.invertingUnitCount} battery unit{summary.invertingUnitCount === 1 ? '' : 's'}
          </span>
          <span className="text-sm text-sky-300">
            {summary.expansionUnitCount} expansion{summary.expansionUnitCount === 1 ? '' : 's'}
          </span>
          <span className="text-sm font-bold text-slate-100">
            {summary.usableKwh === null ? '— kWh' : `${summary.usableKwh.toFixed(1)} kWh`}
          </span>
          <span className="text-sm font-bold text-slate-100">
            {summary.continuousOutputA === null ? '— A' : `${summary.continuousOutputA} A`} AC storage output
          </span>
          {summary.aggregationPanelCount > 0 ? (
            <span className="text-sm text-emerald-300">
              {summary.aggregationPanelCount} DER aggregation panel
              {summary.aggregationPanelCount === 1 ? '' : 's'}
            </span>
          ) : null}
          <span data-testid="topology-arrangement" className={`text-sm ${
            summary.derArrangementLabel ? 'text-slate-300' : 'text-amber-300'}`}>
            {summary.derArrangementLabel ?? 'DER interconnection not chosen'}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <StatusBadge status={overview.site.conclusion} />
            <span data-testid="topology-needs-count" className="text-xs text-slate-300">
              {needs.length === 0
                ? conclusionWord(overview.site.conclusion)
                : `Engineering: ${needs.length} input${needs.length === 1 ? '' : 's'} required`}
            </span>
          </span>
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={btn} data-testid="topology-reload"
                  onClick={() => void load()} disabled={!projectId}>Reload</button>
          <button type="button"
                  className="rounded bg-sky-600 px-3 py-1 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40"
                  data-testid="topology-save"
                  onClick={() => void save()} disabled={!projectId || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {loading ? <span className="text-xs text-slate-400">loading…</span> : null}
          {message ? <span data-testid="topology-message" className="text-xs text-amber-300">{message}</span> : null}
        </div>
      </div>

      {/* ── 2. THE ELECTRICAL SYSTEM ───────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
        <ServiceTopologyMap
          topology={topology} overview={overview}
          selectedId={selectedId} onSelect={id => { setSelectedId(id); setFocusField(null); }}
          onAddBranch={amps => setTopology(addBranchWithPanel(topology, amps).topology)}
        />
      </div>

      {selectedId ? (
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
            NEEDS INPUT — {needs.length} item{needs.length === 1 ? '' : 's'} required to finish engineering
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
                <ul className="mt-1 space-y-1">
                  {group.items.map(n => (
                    <li key={n.key}>
                      <button type="button" data-testid={`need-${n.key}`}
                              className="w-full rounded px-2 py-1 text-left text-xs text-amber-100 hover:bg-amber-500/10"
                              onClick={() => { setSelectedId(n.focus.nodeId); setFocusField(n.focus.field ?? null); }}>
                        <span className="font-bold">{n.label}</span>
                        <span className="block text-[11px] text-amber-200/70">{n.because}</span>
                      </button>
                    </li>
                  ))}
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

      {/* ── 5. ADVANCED — the original primitives, preserved, behind the model ─ */}
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
              {' '}Utility requires an external DER isolation device
            </label>
          </div>
        </div>
      </details>
    </div>
  );
}

export default ServiceTopologyBuilder;
