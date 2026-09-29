'use client';

// ═══════════════════════════════════════════════════════════════════════════
// BUILD THE SERVICE, IN THE PRODUCT.
//
// Ray: "Prove the topology can be created from the actual UI. Do not only deserialize a hand-built
// test fixture... Create/open project → select/create 400 A service → add two 200 A branches →
// assign MSP #1 and MSP #2 → create two backup domains → assign one Gateway to each → assign one
// PW3 to each → assign one Expansion to each PW3 → select non-meter-collar interconnection → save
// → reload."
//
// So this is that flow, and every step calls the pure authoring functions in
// `lib/electrical/topologyAuthoring.ts` — the screen constructs no graph objects of its own,
// because a screen that does is a second model of the graph.
//
// 🚨 AND IT LOADS AND SAVES THE WHOLE GRAPH. `GET`/`PUT /api/projects/[id]/service-topology`,
// whole-object, because a partial update to a graph whose parts reference each other is a way to
// leave it pointing at something that is gone.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import { ServiceTopologyPanel } from './ServiceTopologyPanel';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import {
  createServiceTopology, addServiceBranch, addPanel, addBackupDomain, addProtectiveDevice,
  setInterconnection,
} from '@/lib/electrical/topologyAuthoring';
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

  // Draft inputs for the builder controls.
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

  const btn = 'rounded bg-slate-700 px-2 py-1 text-xs text-slate-100 hover:bg-slate-600 disabled:opacity-40';
  const num = 'w-20 rounded bg-slate-800 px-2 py-1 text-xs text-slate-100';

  return (
    <div className="space-y-4" data-testid="service-topology-builder">
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-black text-slate-100">BUILD THE SERVICE</span>
          {loading ? <span className="text-xs text-slate-400">loading…</span> : null}
          <button type="button" className={btn} data-testid="topology-reload"
                  onClick={() => void load()} disabled={!projectId}>Reload</button>
          <button type="button" className={btn} data-testid="topology-save"
                  onClick={() => void save()} disabled={!projectId || !topology || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {message ? <span data-testid="topology-message" className="text-xs text-amber-300">{message}</span> : null}
        </div>

        {!topology ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-400">Aggregate service
              <input type="number" className={`${num} ml-1`} data-testid="new-service-amps"
                     value={serviceAmps} onChange={e => setServiceAmps(Number(e.target.value))} />
            </label>
            <span className="text-xs text-slate-400">A</span>
            <button type="button" className={btn} data-testid="create-service"
                    onClick={() => setTopology(createServiceTopology({ ratedAmps: serviceAmps }))}>
              Create service
            </button>
            <span className="text-xs text-slate-500">
              A service is an aggregate rating with branches under it — not a main-panel number.
            </span>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {/* ── BRANCHES ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-32 text-xs text-slate-400">Service branch</span>
              <input type="number" className={num} data-testid="new-branch-amps"
                     value={branchAmps} onChange={e => setBranchAmps(Number(e.target.value))} />
              <button type="button" className={btn} data-testid="add-branch"
                      onClick={() => setTopology(addServiceBranch(topology, { ratedAmps: branchAmps }).topology)}>
                Add branch
              </button>
            </div>

            {/* ── PANELS ───────────────────────────────────────────────── */}
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

            {/* ── BACKUP DOMAIN ────────────────────────────────────────── */}
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

            {/* ── DISCONNECT ROLES ─────────────────────────────────────── */}
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

            {/* ── INTERCONNECTION ──────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-32 text-xs text-slate-400">Interconnection</span>
              <label className="text-xs text-slate-300">
                <input type="checkbox" data-testid="meter-collar-permitted"
                       checked={topology.interconnection.meterCollarPermitted === true}
                       onChange={e => setTopology(setInterconnection(topology, {
                         meterCollarPermitted: e.target.checked,
                         // Choosing "not permitted" also clears any selection of it.
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

            {unresolved.length > 0 ? (
              <div data-testid="builder-unresolved" className="text-xs text-amber-300">
                {unresolved.map((u, i) => <div key={i}>{u}</div>)}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <ServiceTopologyPanel topology={topology} onChange={setTopology} />
    </div>
  );
}

export default ServiceTopologyBuilder;
