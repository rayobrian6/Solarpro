'use client';

// ═══════════════════════════════════════════════════════════════════════════
// CLICK THE THING, EDIT THE THING.
//
// Ray: "Do not force the user to understand the order in which internal graph objects must be
// created." So there is no "add branch / add panel / add domain" order here at all — you select a
// node in the visual topology and this edits THAT node.
//
// 🚨 EVERY EDIT IS A PURE FUNCTION FROM `topologyAuthoring.ts`. This file constructs no graph
// object and resolves no catalogue row itself; re-equipping a domain goes back through
// `setDomainEquipment` → `buildDomainFromCatalogue`, the same path the wizard uses.
//
// 🚨 AND THERE IS NO "MAIN PANEL AMPS". Ray: "Do not retain a competing editable Main Panel Amps
// scalar as another authority." A panel's bus rating is edited on that panel; a service's rating is
// edited on the service; they are different numbers and the screen never merges them.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import type { ServiceTopology, DeviceRole } from '@/lib/electrical/serviceTopology';
import {
  updateService, updateBranch, updatePanel, updateDomain, setDomainEquipment,
  removeBackupDomain, addProtectiveDevice, removeProtectiveDevice, setInterconnection,
} from '@/lib/electrical/topologyAuthoring';
import { DISCONNECT_ROLES, SERVICE_SIZE_CHOICES } from '@/lib/electrical/topologyPresets';
import { BACKUP_INTERFACES, BATTERIES } from '@/lib/equipment-db';

const GATEWAYS = () => BACKUP_INTERFACES.filter(g => g.subcategory === 'gateway_controller');
const INVERTING = () => BATTERIES.filter(b => (b.storageRole ?? 'inverter-unit') === 'inverter-unit');
const EXPANSIONS = () => BATTERIES.filter(b => b.storageRole === 'energy-expansion');

const box = 'w-full rounded bg-slate-800 px-2 py-1 text-xs text-slate-100 border border-slate-700';
const ring = 'ring-2 ring-amber-400 border-amber-400';

function Field({
  label, hint, focused, children,
}: { label: string; hint?: string; focused?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block text-xs ${focused ? 'text-amber-300' : 'text-slate-400'}`}>
      {label}
      {children}
      {hint ? <span className="mt-0.5 block text-[10px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

function NumberInput({
  value, onChange, placeholder, testId, focused, allowNull = true,
}: {
  value: number | null; onChange: (v: number | null) => void;
  placeholder?: string; testId: string; focused?: boolean; allowNull?: boolean;
}) {
  return (
    <input
      type="number" data-testid={testId} value={value ?? ''} placeholder={placeholder}
      className={`mt-1 ${box} ${focused ? ring : ''} placeholder:text-amber-400/70`}
      onChange={e => {
        const raw = e.target.value.trim();
        if (raw === '') { onChange(allowNull ? null : 0); return; }
        onChange(Number(raw));
      }}
    />
  );
}

export interface ServiceNodeInspectorProps {
  topology: ServiceTopology;
  /** 'service' | 'interconnection' | a branch / panel / domain id. */
  selectedId: string;
  /** The field a "needs input" item asked for, highlighted. */
  focusField?: string | null;
  onChange: (next: ServiceTopology) => void;
  /** Reported back so the screen can show what the catalogue could not answer. */
  onUnresolved?: (messages: string[]) => void;
}

export function ServiceNodeInspector({
  topology, selectedId, focusField, onChange, onUnresolved,
}: ServiceNodeInspectorProps) {
  const isFocus = (f: string) => !!focusField && (focusField === f || focusField.endsWith(`.${f}`));

  const shell = (title: string, subtitle: string, body: React.ReactNode) => (
    <div data-testid="node-inspector" className="rounded-xl border border-sky-500/30 bg-slate-900/70 p-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-sky-400">{title}</div>
      <div className="text-sm font-black text-slate-100">{subtitle}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{body}</div>
    </div>
  );

  // ── SERVICE ───────────────────────────────────────────────────────────────
  if (selectedId === 'service') {
    const s = topology.service;
    return shell('Editing', `${s.ratedAmps} A service`, (
      <>
        {/* 🚨 ONE CONTROL FOR ONE NUMBER. A picker with a free-text box permanently under it is two
            editors for the same value, which is the shape of the screen Ray rejected. The box
            appears only once "Custom…" is chosen. */}
        <Field label="Service rating (A)" focused={isFocus('ratedAmps')}
               hint="The aggregate service. Not a main-panel number — the panels are their own nodes.">
          <select data-testid="inspector-service-amps" value={
            SERVICE_SIZE_CHOICES.includes(s.ratedAmps) ? String(s.ratedAmps) : 'custom'
          } className={`mt-1 ${box}`}
                  onChange={e => {
                    if (e.target.value === 'custom') return;
                    onChange(updateService(topology, { ratedAmps: Number(e.target.value) }));
                  }}>
            {SERVICE_SIZE_CHOICES.map(a => <option key={a} value={a}>{a} A</option>)}
            <option value="custom">Custom…</option>
          </select>
          {SERVICE_SIZE_CHOICES.includes(s.ratedAmps) ? null : (
            <NumberInput testId="inspector-service-amps-custom" value={s.ratedAmps} allowNull={false}
                         onChange={v => onChange(updateService(topology, { ratedAmps: v ?? 0 }))} />
          )}
        </Field>

        <Field label="System voltage / phase">
          <select data-testid="inspector-service-phase" value={s.phase} className={`mt-1 ${box}`}
                  onChange={e => {
                    const phase = e.target.value as ServiceTopology['service']['phase'];
                    const voltage = phase === 'wye-480' ? 480 : phase === 'wye-208' ? 208 : 240;
                    onChange(updateService(topology, { phase, voltage }));
                  }}>
            <option value="split-240">120/240 V split phase</option>
            <option value="wye-208">120/208 V wye</option>
            <option value="wye-480">277/480 V wye</option>
          </select>
        </Field>

        <Field label="Available fault current (A)" focused={isFocus('availableFaultCurrentA')}
               hint="From the utility. Nothing in the interrupting-rating chain can be checked without it.">
          <NumberInput testId="inspector-fault-current" value={s.availableFaultCurrentA}
                       placeholder="REQUIRED — ask the utility"
                       focused={isFocus('availableFaultCurrentA')}
                       onChange={v => onChange(updateService(topology, { availableFaultCurrentA: v }))} />
        </Field>

        <Field label="Calculated service demand (A)" focused={isFocus('calculatedServiceDemandA')}
               hint="NEC 220 aggregate demand for the whole service.">
          <NumberInput testId="inspector-service-demand" value={topology.calculatedServiceDemandA}
                       placeholder="REQUIRED" focused={isFocus('calculatedServiceDemandA')}
                       onChange={v => onChange(updateService(topology, { calculatedServiceDemandA: v }))} />
        </Field>
      </>
    ));
  }

  // ── INTERCONNECTION AND THE FOUR DISCONNECT ROLES ─────────────────────────
  if (selectedId === 'interconnection') {
    const ic = topology.interconnection;
    const doc = ic.multiGatewayMeteringDoc;
    return (
      <div data-testid="node-inspector" className="rounded-xl border border-sky-500/30 bg-slate-900/70 p-4">
        <div className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Editing</div>
        <div className="text-sm font-black text-slate-100">Interconnection &amp; disconnects</div>

        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input type="checkbox" data-testid="ic-meter-collar-permitted" className="mt-0.5"
                   checked={ic.meterCollarPermitted === true}
                   onChange={e => onChange(setInterconnection(topology, {
                     meterCollarPermitted: e.target.checked,
                     meterCollarSelected: e.target.checked ? ic.meterCollarSelected : false,
                   }))} />
            <span>
              A meter-collar / Backup Switch interconnection is permitted on this project
              <span className="block text-[10px] text-slate-500">
                The utility and the jurisdiction decide this, not the equipment.
              </span>
            </span>
          </label>

          <label className={`flex items-start gap-2 text-xs ${
            ic.meterCollarPermitted === true ? 'text-slate-300' : 'text-slate-600'}`}>
            <input type="checkbox" data-testid="ic-meter-collar-selected" className="mt-0.5"
                   disabled={ic.meterCollarPermitted !== true}
                   checked={ic.meterCollarSelected}
                   onChange={e => onChange(setInterconnection(topology, {
                     meterCollarSelected: e.target.checked,
                   }))} />
            <span>
              Use a meter-collar interconnection
              {ic.meterCollarPermitted === false ? (
                <span data-testid="ic-meter-collar-blocked"
                      className="block text-[10px] font-bold text-amber-300">
                  Unavailable — not permitted on this project.
                </span>
              ) : null}
            </span>
          </label>

          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input type="checkbox" data-testid="ic-der-isolation-required" className="mt-0.5"
                   checked={ic.externalDerIsolationRequired === true}
                   onChange={e => onChange(setInterconnection(topology, {
                     externalDerIsolationRequired: e.target.checked,
                   }))} />
            <span>This utility requires an external DER isolation device</span>
          </label>
        </div>

        {/* 🚨 THE ROLES, WITH WHERE THEY SIT — not four unlabelled buttons. */}
        <div className="mt-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Disconnecting means
        </div>
        <div className="mt-1 space-y-2">
          {DISCONNECT_ROLES.map(spec => {
            const devices = topology.devices.filter(d => d.roles.includes(spec.role as DeviceRole));
            return (
              <div key={spec.role} data-testid={`ic-role-${spec.role}`}
                   className="rounded-lg border border-slate-700/70 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-100">{spec.label}</div>
                    <div className="text-[10px] text-slate-500">{spec.where}</div>
                    <div className="text-[10px] text-slate-500">{spec.purpose}</div>
                  </div>
                  <button type="button" data-testid={`ic-add-${spec.role}`}
                          className="shrink-0 rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600"
                          onClick={() => onChange(addProtectiveDevice(topology, {
                            label: spec.label,
                            roles: [spec.role as DeviceRole],
                            ratedAmps: topology.service.ratedAmps,
                            lockableOpen: spec.lockableOpen,
                            visibleOpen: spec.visibleOpen,
                            locationNote: spec.where,
                          }).topology)}>
                    + Add
                  </button>
                </div>
                {devices.length === 0 ? (
                  <div className="mt-1 text-[11px] text-slate-500">None recorded.</div>
                ) : devices.map(d => (
                  <div key={d.id} data-testid={`ic-device-${d.id}`}
                       className="mt-1 flex items-center justify-between gap-2 rounded bg-slate-950/50 px-2 py-1">
                    <span className="text-[11px] text-slate-200">
                      {d.label} · {d.ratedAmps === null ? '—' : `${d.ratedAmps} A`} ·{' '}
                      {d.sccrA === null
                        ? <span className="text-amber-300">SCCR not established</span>
                        : `${d.sccrA} A SCCR`}
                    </span>
                    <button type="button" data-testid={`ic-remove-${d.id}`}
                            className="rounded px-1.5 text-[11px] text-slate-400 hover:text-red-300"
                            onClick={() => onChange(removeProtectiveDevice(topology, d.id))}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* The manufacturer authority we do not hold, stated rather than assumed. */}
        {topology.domains.length > 1 ? (
          <div data-testid="ic-manufacturer-doc"
               className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-200">
            <span className="font-black">MANUFACTURER DOCUMENT REQUIRED</span> —{' '}
            {doc ? `${doc.title} (${doc.source})` : 'a multi-gateway application note'} governs site
            metering, CT assignment and coordination when more than one gateway is on one service.
            SolarPro will not decide those without it.
          </div>
        ) : null}
      </div>
    );
  }

  // ── BRANCH ────────────────────────────────────────────────────────────────
  const branch = topology.branches.find(b => b.id === selectedId);
  if (branch) {
    const fed = branch.panelIds
      ?? topology.domains.find(d => d.branchId === branch.id)?.backedUpPanelIds
      ?? [];
    return shell('Editing', `${branch.label} — service branch`, (
      <>
        <Field label="Branch rating (A)" focused={isFocus('ratedAmps')}>
          <NumberInput testId="inspector-branch-amps" value={branch.ratedAmps} allowNull={false}
                       onChange={v => onChange(updateBranch(topology, branch.id, { ratedAmps: v ?? 0 }))} />
        </Field>
        <Field label="Feeder OCPD (A)" focused={isFocus('ocpdAmps')}>
          <NumberInput testId="inspector-branch-ocpd" value={branch.ocpdAmps} placeholder="REQUIRED"
                       focused={isFocus('ocpdAmps')}
                       onChange={v => onChange(updateBranch(topology, branch.id, { ocpdAmps: v }))} />
        </Field>
        <Field label="Calculated demand on this branch (A)" focused={isFocus('calculatedDemandA')}
               hint="An aggregate service calculation does not establish that this branch is adequate.">
          <NumberInput testId="inspector-branch-demand" value={branch.calculatedDemandA}
                       placeholder="REQUIRED" focused={isFocus('calculatedDemandA')}
                       onChange={v => onChange(updateBranch(topology, branch.id, { calculatedDemandA: v }))} />
        </Field>
        <Field label="Panels this branch feeds"
               hint="Which panelboards the branch conductors land in. Backup is set on the domain.">
          <div className="mt-1 space-y-1">
            {topology.panels.length === 0
              ? <span className="text-[11px] text-slate-500">No panels on this service yet.</span>
              : topology.panels.map(p => (
                  <label key={p.id} className="flex items-center gap-2 text-[11px] text-slate-200">
                    <input type="checkbox" data-testid={`inspector-branch-panel-${p.id}`}
                           checked={fed.includes(p.id)}
                           onChange={e => {
                             const next = e.target.checked
                               ? [...new Set([...fed, p.id])]
                               : fed.filter(x => x !== p.id);
                             onChange(updateBranch(topology, branch.id, { panelIds: next }));
                           }} />
                    {p.label}
                  </label>
                ))}
          </div>
        </Field>
      </>
    ));
  }

  // ── PANEL ─────────────────────────────────────────────────────────────────
  const panel = topology.panels.find(p => p.id === selectedId);
  if (panel) {
    return shell('Editing', `${panel.label} — panelboard`, (
      <>
        <Field label="Busbar rating (A)" focused={isFocus('busbarRatingA')}>
          <NumberInput testId="inspector-panel-bus" value={panel.busbarRatingA} placeholder="REQUIRED"
                       focused={isFocus('busbarRatingA')}
                       onChange={v => onChange(updatePanel(topology, panel.id, { busbarRatingA: v }))} />
        </Field>
        <Field label="Main breaker (A)" focused={isFocus('mainBreakerA')}>
          <NumberInput testId="inspector-panel-main" value={panel.mainBreakerA} placeholder="REQUIRED"
                       focused={isFocus('mainBreakerA')}
                       onChange={v => onChange(updatePanel(topology, panel.id, { mainBreakerA: v }))} />
        </Field>
        <Field label="Interrupting rating / SCCR (A)" focused={isFocus('sccrA')}>
          <NumberInput testId="inspector-panel-sccr" value={panel.sccrA} placeholder="REQUIRED"
                       focused={isFocus('sccrA')}
                       onChange={v => onChange(updatePanel(topology, panel.id, { sccrA: v }))} />
        </Field>
        <Field label="Backed up">
          <label className="mt-1 flex items-center gap-2 text-[11px] text-slate-200">
            <input type="checkbox" data-testid="inspector-panel-backed-up" checked={panel.backedUp}
                   onChange={e => onChange(updatePanel(topology, panel.id, { backedUp: e.target.checked }))} />
            This panel sits behind a backup gateway
          </label>
        </Field>
      </>
    ));
  }

  // ── BACKUP DOMAIN ─────────────────────────────────────────────────────────
  const domain = topology.domains.find(d => d.id === selectedId);
  if (domain) {
    const units = domain.storageUnitIds
      .map(id => topology.storage.find(u => u.id === id))
      .filter((u): u is NonNullable<typeof u> => !!u);
    const inverting = units.filter(u => u.role === 'inverter-unit');
    const expansions = units.filter(u => u.role === 'energy-expansion');
    const essProductId = inverting[0]?.productId ?? '';
    const expProductId = expansions[0]?.productId ?? '';

    const reEquip = (opts: {
      gatewayProductId?: string; essId?: string; essCount?: number;
      expId?: string; expCount?: number;
    }) => {
      const nEss = opts.essCount ?? inverting.length;
      const eid = opts.essId ?? essProductId;
      const nExp = opts.expCount ?? expansions.length;
      const xid = opts.expId ?? expProductId;
      const r = setDomainEquipment(topology, domain.id, {
        gatewayProductId: opts.gatewayProductId,
        storageProductIds: eid ? Array.from({ length: nEss }, () => eid) : [],
        expansionProductIds: xid ? Array.from({ length: nExp }, () => xid) : [],
      });
      onChange(r.topology);
      onUnresolved?.(r.unresolved);
    };

    return (
      <div data-testid="node-inspector" className="rounded-xl border border-sky-500/30 bg-slate-900/70 p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Editing</div>
            <div className="text-sm font-black text-slate-100">{domain.label} — backup domain</div>
          </div>
          <button type="button" data-testid="inspector-domain-remove"
                  className="rounded px-2 py-1 text-[11px] text-slate-400 hover:text-red-300"
                  onClick={() => onChange(removeBackupDomain(topology, domain.id))}>
            Remove domain
          </button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Fed by">
            <select data-testid="inspector-domain-branch" value={domain.branchId} className={`mt-1 ${box}`}
                    onChange={e => onChange(updateDomain(topology, domain.id, { branchId: e.target.value }))}>
              {topology.branches.map(b => (
                <option key={b.id} value={b.id}>{b.label} — {b.ratedAmps} A</option>
              ))}
            </select>
          </Field>

          <Field label="Controller / gateway" focused={isFocus('gateway')}>
            <select data-testid="inspector-domain-gateway" value={domain.gateway.productId}
                    className={`mt-1 ${box}`}
                    onChange={e => reEquip({ gatewayProductId: e.target.value })}>
              {GATEWAYS().map(g => (
                <option key={g.id} value={g.id}>{g.manufacturer} {g.model}</option>
              ))}
            </select>
          </Field>

          <Field label="Battery / inverter unit">
            <select data-testid="inspector-domain-ess" value={essProductId} className={`mt-1 ${box}`}
                    onChange={e => reEquip({ essId: e.target.value })}>
              <option value="">none</option>
              {INVERTING().map(b => (
                <option key={b.id} value={b.id}>{b.manufacturer} {b.model}</option>
              ))}
            </select>
            <NumberInput testId="inspector-domain-ess-count" value={inverting.length} allowNull={false}
                         onChange={v => reEquip({ essCount: Math.max(0, v ?? 0) })} />
          </Field>

          <Field label="Expansion units"
                 hint="DC extensions of the units above. They add energy, never AC current or a breaker.">
            <select data-testid="inspector-domain-expansion" value={expProductId} className={`mt-1 ${box}`}
                    onChange={e => reEquip({ expId: e.target.value })}>
              <option value="">none</option>
              {EXPANSIONS().map(b => (
                <option key={b.id} value={b.id}>{b.manufacturer} {b.model}</option>
              ))}
            </select>
            <NumberInput testId="inspector-domain-expansion-count" value={expansions.length}
                         allowNull={false}
                         onChange={v => reEquip({ expCount: Math.max(0, v ?? 0) })} />
          </Field>

          <Field label="Storage point of connection" focused={isFocus('storageConnection')}
                 hint="Where the storage breaker lands decides whether NEC 705.12(B) is the governing rule at all.">
            <select data-testid="inspector-domain-connection" value={domain.storageConnection}
                    className={`mt-1 ${box} ${isFocus('storageConnection') ? ring : ''}`}
                    onChange={e => onChange(updateDomain(topology, domain.id, {
                      storageConnection: e.target.value as typeof domain.storageConnection,
                    }))}>
              <option value="unresolved">Not established</option>
              <option value="backed-up-panel-busbar">
                Backed-up panel busbar — load side (NEC 705.12(B))
              </option>
              <option value="gateway-panelboard">
                Gateway panelboard — manufacturer-approved gateway topology
              </option>
            </select>
            {/* An arrangement the graph cannot yet express is SAID, not silently omitted. */}
            <span data-testid="inspector-domain-connection-gap"
                  className="mt-0.5 block text-[10px] text-slate-500">
              A supply-side (service-side) tap is not represented in the service graph yet — it
              would change which code section governs, so it is not offered as a choice here.
            </span>
          </Field>

          <Field label="Backed-up load (A)" focused={isFocus('backedUpDemandA')}>
            <NumberInput testId="inspector-domain-backed-up-demand" value={domain.backedUpDemandA}
                         placeholder="REQUIRED" focused={isFocus('backedUpDemandA')}
                         onChange={v => onChange(updateDomain(topology, domain.id, { backedUpDemandA: v }))} />
          </Field>

          <Field label="Generation in this domain (A)" focused={isFocus('generationOutputA')}
                 hint="PV or other generation landing inside this domain, excluding the storage above.">
            <NumberInput testId="inspector-domain-generation" value={domain.generationOutputA}
                         focused={isFocus('generationOutputA')}
                         onChange={v => onChange(updateDomain(topology, domain.id, { generationOutputA: v }))} />
          </Field>

          <Field label="Panels this domain backs up">
            <div className="mt-1 space-y-1">
              {topology.panels.map(p => (
                <label key={p.id} className="flex items-center gap-2 text-[11px] text-slate-200">
                  <input type="checkbox" data-testid={`inspector-domain-panel-${p.id}`}
                         checked={domain.backedUpPanelIds.includes(p.id)}
                         onChange={e => onChange(updateDomain(topology, domain.id, {
                           backedUpPanelIds: e.target.checked
                             ? [...new Set([...domain.backedUpPanelIds, p.id])]
                             : domain.backedUpPanelIds.filter(x => x !== p.id),
                         }))} />
                  {p.label}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="node-inspector" className="rounded-xl border border-slate-700 bg-slate-900/60 p-4
                    text-xs text-slate-400">
      Select any box in the diagram above to edit it.
    </div>
  );
}

export default ServiceNodeInspector;
