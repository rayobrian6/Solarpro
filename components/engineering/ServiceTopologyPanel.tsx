'use client';

// ═══════════════════════════════════════════════════════════════════════════
// THE SERVICE, AS SOMETHING RAY CAN SEE AND EDIT.
//
// Ray: "Ray needs to be able to build and inspect this topology without editing JSON... Do not
// reduce this back into one 'Main Panel Amps' field."
//
// So the shape on screen IS the shape in the model: an aggregate service, its branches, its panels,
// its backup domains, and the four disconnect roles listed separately. There is no "Main Panel
// Amps" input anywhere in this file, and a job with two MSPs shows two MSPs.
//
// 🚨 AND THE STATUS COLUMN CAN SAY "I DO NOT KNOW". Every domain and the site show PASS, FAIL or
// NOT EVALUATED — and the third one prints the specific input or authority that would settle it,
// because a badge that cannot say what it needs is a dead end. That is the whole reason
// `EngineeringConclusion` exists separately from severity.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useMemo } from 'react';
import { StatusBadge } from './StatusBadge';
import {
  evaluateServiceTopology, summariseStorage,
  type ServiceTopology, type TopologyCheck,
} from '@/lib/electrical/serviceTopology';
import { equipmentQuantities } from '@/lib/electrical/topologyEquipment';
import { foldConclusions, requiredInputs } from '@/lib/engineering/engineeringStatus';

const A = (v: number | null | undefined) => (typeof v === 'number' ? `${v} A` : '—');

const ROLE_LABEL: Record<string, string> = {
  'service-disconnect': 'Service disconnect',
  'der-isolation-disconnect': 'Utility DER isolation',
  'gateway-isolation': 'Gateway isolation',
  'ess-disconnect': 'ESS OCPD / disconnect',
};

function CheckList({ checks }: { checks: TopologyCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {checks.map(c => (
        <li key={`${c.scope}/${c.id}`} className="text-xs flex gap-2 items-start">
          <span className={
            c.conclusion === 'FAIL' ? 'text-red-400 font-bold'
              : c.conclusion === 'NOT_EVALUATED' ? 'text-amber-300 font-bold'
                : 'text-emerald-400'
          }>
            {c.conclusion === 'FAIL' ? 'FAIL' : c.conclusion === 'NOT_EVALUATED' ? 'NOT EVAL' : 'PASS'}
          </span>
          <span className="text-slate-300">
            <span className="font-semibold">{c.title}</span>
            {' — '}{c.detail}
            {/* 🚨 THE SPECIFIC MISSING INPUT, NAMED. Never just "not evaluated". */}
            {c.conclusion === 'NOT_EVALUATED' && (c.requires?.length ?? 0) > 0 ? (
              <span className="text-amber-300"> {' '}REQUIRES: {c.requires!.join(', ')}</span>
            ) : null}
            {c.citation ? <span className="text-slate-500"> [{c.citation}]</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface ServiceTopologyPanelProps {
  topology: ServiceTopology | null;
  /** Called with a changed copy. Absent ⇒ read-only inspection. */
  onChange?: (next: ServiceTopology) => void;
}

export function ServiceTopologyPanel({ topology, onChange }: ServiceTopologyPanelProps) {
  const evaluation = useMemo(
    () => (topology ? evaluateServiceTopology(topology) : null), [topology]);
  const storage = useMemo(() => (topology ? summariseStorage(topology) : null), [topology]);
  const quantities = useMemo(() => (topology ? equipmentQuantities(topology) : {}), [topology]);

  if (!topology || !evaluation || !storage) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <div className="text-sm font-bold text-slate-200">Service topology</div>
        <div className="mt-1 text-xs text-slate-400">
          No service topology on this project yet. A service is an aggregate rating, its branches and
          its backup domains — not a single main-panel number.
        </div>
      </div>
    );
  }

  const siteChecks = evaluation.checks.filter(c => c.scope === 'site');
  const edit = (mutate: (t: ServiceTopology) => void) => {
    if (!onChange) return;
    const next: ServiceTopology = JSON.parse(JSON.stringify(topology));
    mutate(next);
    onChange(next);
  };
  const ro = !onChange;

  return (
    <div className="space-y-4" data-testid="service-topology-panel">
      {/* ── SERVICE ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-black text-slate-100">SERVICE</div>
          <StatusBadge status={evaluation.overall} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="text-xs text-slate-400">
            Aggregate service
            <input
              data-testid="service-rated-amps"
              type="number" readOnly={ro} value={topology.service.ratedAmps}
              onChange={e => edit(t => { t.service.ratedAmps = Number(e.target.value); })}
              className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-slate-100"
            />
          </label>
          <label className="text-xs text-slate-400">
            Available fault current
            <input
              data-testid="service-fault-current"
              type="number" readOnly={ro}
              value={topology.service.availableFaultCurrentA ?? ''}
              placeholder="REQUIRED"
              onChange={e => edit(t => {
                const v = e.target.value.trim();
                t.service.availableFaultCurrentA = v === '' ? null : Number(v);
              })}
              className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-slate-100 placeholder:text-amber-400"
            />
          </label>
          <div className="text-xs text-slate-400">
            Calculated demand
            <div className="mt-1 text-slate-100">{A(topology.calculatedServiceDemandA)}</div>
          </div>
          <div className="text-xs text-slate-400">
            Storage
            <div className="mt-1 text-slate-100">
              {storage.totalUsableKwh === null ? '—' : `${storage.totalUsableKwh.toFixed(1)} kWh`}
              {' · '}
              {storage.totalContinuousOutputA === null ? '—' : `${storage.totalContinuousOutputA} A AC`}
              <span className="text-slate-500">
                {' '}({storage.inverterUnitCount} inverting, {storage.expansionUnitCount} expansion)
              </span>
            </div>
          </div>
        </div>
        <CheckList checks={siteChecks} />
      </section>

      {/* ── BRANCHES ───────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <div className="text-sm font-black text-slate-100">SERVICE BRANCHES</div>
        <div className="mt-2 space-y-2">
          {topology.branches.map((b, i) => {
            const checks = evaluation.checks.filter(c => c.scope === `branch:${b.id}`);
            return (
              <div key={b.id} data-testid={`branch-${b.id}`}
                   className="rounded-lg border border-slate-700/70 p-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-slate-100">{b.label}</span>
                  <input
                    type="number" readOnly={ro} value={b.ratedAmps}
                    aria-label={`${b.label} rating`}
                    onChange={e => edit(t => { t.branches[i].ratedAmps = Number(e.target.value); })}
                    className="w-20 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-100"
                  />
                  <span className="text-xs text-slate-400">A</span>
                  <span className="text-xs text-slate-400">
                    demand {A(b.calculatedDemandA)}
                  </span>
                  <StatusBadge size="sm" status={foldConclusions(checks)} />
                </div>
                <CheckList checks={checks} />
              </div>
            );
          })}
        </div>
      </section>

      {/* ── PANELS ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <div className="text-sm font-black text-slate-100">PANELS</div>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {topology.panels.map((p, i) => (
            <div key={p.id} data-testid={`panel-${p.id}`}
                 className="rounded-lg border border-slate-700/70 p-2 text-xs">
              <div className="font-bold text-slate-100">{p.label}</div>
              <div className="mt-1 flex items-center gap-2 text-slate-400">
                <span>bus</span>
                <input
                  type="number" readOnly={ro} value={p.busbarRatingA ?? ''}
                  aria-label={`${p.label} busbar rating`}
                  onChange={e => edit(t => {
                    const v = e.target.value.trim();
                    t.panels[i].busbarRatingA = v === '' ? null : Number(v);
                  })}
                  className="w-20 rounded bg-slate-800 px-2 py-0.5 text-slate-100"
                />
                <span>main</span>
                <input
                  type="number" readOnly={ro} value={p.mainBreakerA ?? ''}
                  aria-label={`${p.label} main breaker`}
                  onChange={e => edit(t => {
                    const v = e.target.value.trim();
                    t.panels[i].mainBreakerA = v === '' ? null : Number(v);
                  })}
                  className="w-20 rounded bg-slate-800 px-2 py-0.5 text-slate-100"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BACKUP DOMAINS ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <div className="text-sm font-black text-slate-100">BACKUP DOMAINS</div>
        <div className="mt-2 space-y-3">
          {topology.domains.map((d, di) => {
            const checks = evaluation.checks.filter(c => c.scope === `domain:${d.id}`);
            const units = topology.storage.filter(u => d.storageUnitIds.includes(u.id));
            const dStorage = storage.byDomain[d.id];
            return (
              <div key={d.id} data-testid={`domain-${d.id}`}
                   className="rounded-lg border border-slate-700/70 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-slate-100">{d.label}</div>
                  {/* Each domain's engineering is its own — Ray's acceptance items 7 and 8. */}
                  <StatusBadge size="sm" status={foldConclusions(checks)} />
                </div>
                <div className="mt-1 text-xs text-slate-300">
                  {/* Names, not internal keys — this is read by an installer, not a debugger. */}
                  {d.gateway.label} ({A(d.gateway.continuousRatingA)})
                  {' → '}{d.backedUpPanelIds
                    .map(id => topology.panels.find(p => p.id === id)?.label ?? id).join(', ')}
                  {' · fed by '}
                  {topology.branches.find(b => b.id === d.branchId)?.label ?? d.branchId}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {units.map(u => (
                    <span key={u.id} className="mr-3">
                      {u.role === 'energy-expansion' ? (
                        <>
                          <span className="text-sky-300">DC expansion</span> {u.productId}
                          {' · '}{u.usableKwh ?? '—'} kWh
                          {/* Said on screen, so nobody wonders if a breaker was forgotten. */}
                          <span className="text-slate-500"> · no AC output, no breaker</span>
                        </>
                      ) : (
                        <>
                          <span className="text-emerald-300">ESS</span> {u.productId}
                          {' · '}{A(u.continuousOutputA)}{' · '}{u.usableKwh ?? '—'} kWh
                        </>
                      )}
                    </span>
                  ))}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Domain storage: {dStorage?.usableKwh ?? '—'} kWh ·{' '}
                  {dStorage?.continuousOutputA ?? '—'} A AC
                </div>
                <label className="mt-2 block text-xs text-slate-400">
                  Storage point of connection
                  <select
                    data-testid={`domain-${d.id}-connection`}
                    disabled={ro} value={d.storageConnection}
                    onChange={e => edit(t => {
                      t.domains[di].storageConnection =
                        e.target.value as ServiceTopology['domains'][number]['storageConnection'];
                    })}
                    className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-slate-100"
                  >
                    <option value="unresolved">Not established</option>
                    <option value="backed-up-panel-busbar">Backed-up panel busbar (NEC 705.12(B) applies)</option>
                    <option value="gateway-panelboard">Gateway panelboard (manufacturer limit)</option>
                  </select>
                </label>
                <CheckList checks={checks} />
              </div>
            );
          })}
        </div>
      </section>

      {/* ── DISCONNECT ROLES ───────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <div className="text-sm font-black text-slate-100">DISCONNECT ROLES</div>
        <div className="mt-1 text-xs text-slate-500">
          Four separate roles. One device may hold more than one only where an authority permits it.
        </div>
        <div className="mt-2 space-y-1">
          {Object.keys(ROLE_LABEL).map(role => {
            const devices = topology.devices.filter(d => d.roles.includes(role as never));
            return (
              <div key={role} data-testid={`role-${role}`} className="text-xs flex gap-2">
                <span className="w-44 shrink-0 text-slate-400">{ROLE_LABEL[role]}</span>
                <span className="text-slate-100">
                  {devices.length === 0
                    ? <span className="text-slate-500">none</span>
                    : devices.map(d => (
                        <span key={d.id} className="mr-3">
                          {d.label} · {A(d.ratedAmps)}
                          {' · '}{d.sccrA === null
                            ? <span className="text-amber-300">SCCR NOT EVALUATED</span>
                            : `${d.sccrA} A SCCR`}
                        </span>
                      ))}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-slate-400">
          Neutral-ground bond: <span className="text-slate-100">{evaluation.bonding.basis}</span>
        </div>
      </section>

      {/* ── WHAT IS ON THE JOB ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <div className="text-sm font-black text-slate-100">EQUIPMENT ON THIS TOPOLOGY</div>
        <div className="mt-1 text-xs text-slate-500">
          The same instances the BOM and pricing consume.
        </div>
        <div className="mt-2 space-y-0.5">
          {Object.entries(quantities).map(([id, n]) => (
            <div key={id} data-testid={`qty-${id}`} className="text-xs text-slate-200">
              {n} × {id}
            </div>
          ))}
        </div>
      </section>

      {/* ── WHAT WOULD SETTLE THE UNKNOWNS ─────────────────────────────────── */}
      {evaluation.overall === 'NOT_EVALUATED' ? (
        <section data-testid="topology-required-inputs"
                 className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="text-sm font-black text-amber-300">NOT EVALUATED — INPUT REQUIRED</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-amber-200">
            {requiredInputs(evaluation.checks).map(r => <li key={r}>{r}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default ServiceTopologyPanel;
