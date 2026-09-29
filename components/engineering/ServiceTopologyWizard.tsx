'use client';

// ═══════════════════════════════════════════════════════════════════════════
// "400 AMP SERVICE, TWO 200 AMP PANELS, BACK UP BOTH, ONE GATEWAY STACK PER PANEL."
//
// Ray: "When a project has no service topology, start with a simple guided flow... SolarPro should
// ask an electrician questions in the language an electrician thinks in."
//
//   1 Service      → how big, and what system
//   2 Distribution → how the service is split
//   3 Backup       → which panels are backed up
//   4 Equipment    → the stack in each backup domain
//   5 Interconnection
//   6 Disconnects  → the four roles, where they sit
//
// 🚨 THE WIZARD BUILDS THE CANONICAL GRAPH FROM STEP 2 ONWARD. It holds no parallel description of
// the service: as soon as the distribution is chosen it makes a real `ServiceTopology` with the
// authoring functions and every later step EDITS that object. So what the last step hands over is
// the same thing the map, the SLD, the BOM and the permit read — there is nothing to translate, and
// therefore nothing to translate wrongly.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import type { ServiceTopology, DeviceRole, ServicePhase } from '@/lib/electrical/serviceTopology';
import {
  DISTRIBUTION_PRESETS, SERVICE_SIZE_CHOICES, DISCONNECT_ROLES, buildServiceFromPreset,
} from '@/lib/electrical/topologyPresets';
import {
  addBackupDomain, removeBackupDomain, setDomainEquipment, updatePanel, updateDomain,
  addProtectiveDevice, removeProtectiveDevice, setInterconnection,
} from '@/lib/electrical/topologyAuthoring';
import { BACKUP_INTERFACES, BATTERIES } from '@/lib/equipment-db';

const GATEWAYS = () => BACKUP_INTERFACES.filter(g => g.subcategory === 'gateway_controller');
const INVERTING = () => BATTERIES.filter(b => (b.storageRole ?? 'inverter-unit') === 'inverter-unit');
const EXPANSIONS = () => BATTERIES.filter(b => b.storageRole === 'energy-expansion');

const STEPS = ['Service', 'Distribution', 'Backup', 'Equipment', 'Interconnection', 'Disconnects'];

const box = 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-100 border border-slate-700';
const primary = 'rounded bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40';
const ghost = 'rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40';

export interface ServiceTopologyWizardProps {
  /** Known constraints from the project authority, applied before the operator can choose wrongly. */
  meterCollarPermitted?: boolean | null;
  onBuilt: (topology: ServiceTopology) => void;
  onCancel?: () => void;
}

export function ServiceTopologyWizard({
  meterCollarPermitted = null, onBuilt, onCancel,
}: ServiceTopologyWizardProps) {
  const [step, setStep] = useState(0);
  const [serviceAmps, setServiceAmps] = useState(400);
  const [phase, setPhase] = useState<ServicePhase>('split-240');
  const [distribution, setDistribution] = useState('two-main-panels');
  const [customBranches, setCustomBranches] = useState(2);
  const [draft, setDraft] = useState<ServiceTopology | null>(null);
  const [gatewayId, setGatewayId] = useState(() => GATEWAYS()[0]?.id ?? '');
  const [notes, setNotes] = useState<string[]>([]);

  const preset = DISTRIBUTION_PRESETS.find(p => p.id === distribution);

  /** Step 2 → 3: the graph comes into existence here, from the generic authoring functions. */
  const materialise = () => {
    const built = buildServiceFromPreset({
      ratedAmps: serviceAmps, phase, distribution, customBranches,
      voltage: phase === 'wye-480' ? 480 : phase === 'wye-208' ? 208 : 240,
    });
    // The project's own interconnection authority is recorded up front, so a prohibited
    // arrangement is unavailable rather than selectable-then-rejected.
    setDraft(setInterconnection(built.topology, { meterCollarPermitted }));
    setStep(2);
  };

  /** Step 3 → 4: one backup domain per backed-up panel, on the branch that feeds it. */
  const materialiseDomains = () => {
    if (!draft) return;
    let t = draft;
    const wanted = t.panels.filter(p => p.backedUp);
    // Drop domains whose panel is no longer backed up — going back a step must not leave a
    // gateway behind on a panel the operator just un-ticked.
    for (const d of [...t.domains]) {
      if (!d.backedUpPanelIds.some(id => wanted.some(p => p.id === id))) {
        t = removeBackupDomain(t, d.id);
      }
    }
    for (const p of wanted) {
      if (t.domains.some(d => d.backedUpPanelIds.includes(p.id))) continue;
      const branch = t.branches.find(b => (b.panelIds ?? []).includes(p.id))
        ?? t.branches.find(b => !t.domains.some(d => d.branchId === b.id));
      if (!branch) continue;
      const r = addBackupDomain(t, {
        branchId: branch.id,
        panelIds: [p.id],
        gatewayProductId: gatewayId,
        storageProductIds: [],
      });
      t = r.topology;
    }
    setDraft(t);
    setStep(3);
  };

  const preview = useMemo(() => {
    if (!draft) return null;
    return {
      branches: draft.branches.length,
      panels: draft.panels.length,
      domains: draft.domains.length,
    };
  }, [draft]);

  const stepRail = (
    <ol className="flex flex-wrap gap-1 text-[10px] font-bold uppercase tracking-wider">
      {STEPS.map((s, i) => (
        <li key={s} data-testid={`wizard-step-${i + 1}`}
            className={`rounded px-2 py-1 ${i === step
              ? 'bg-sky-600 text-white'
              : i < step ? 'bg-slate-700 text-slate-200' : 'bg-slate-800/60 text-slate-500'}`}>
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  );

  return (
    <div data-testid="service-topology-wizard"
         className="rounded-xl border border-sky-500/30 bg-slate-900/70 p-4">
      <div className="text-sm font-black text-slate-100">Build the service</div>
      <div className="mt-1 text-xs text-slate-400">
        Six questions. SolarPro turns the answers into the service graph every other surface reads.
      </div>
      <div className="mt-3">{stepRail}</div>

      <div className="mt-4 min-h-[140px]">
        {/* ── 1. SERVICE ───────────────────────────────────────────────────── */}
        {step === 0 ? (
          <div className="space-y-3">
            <div className="text-xs font-bold text-slate-200">What is the service size?</div>
            <div className="flex flex-wrap gap-2">
              {SERVICE_SIZE_CHOICES.map(a => (
                <button key={a} type="button" data-testid={`wizard-service-${a}`}
                        onClick={() => setServiceAmps(a)}
                        className={`rounded px-3 py-1.5 text-xs font-bold ${serviceAmps === a
                          ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                  {a} A
                </button>
              ))}
              <label className="flex items-center gap-1 text-xs text-slate-400">
                Custom
                <input type="number" data-testid="wizard-service-custom" value={serviceAmps}
                       className={`w-24 ${box}`}
                       onChange={e => setServiceAmps(Number(e.target.value))} />
              </label>
            </div>
            <label className="block text-xs text-slate-400">
              System
              <select data-testid="wizard-phase" value={phase} className={`mt-1 block ${box}`}
                      onChange={e => setPhase(e.target.value as ServicePhase)}>
                <option value="split-240">120/240 V split phase</option>
                <option value="wye-208">120/208 V wye</option>
                <option value="wye-480">277/480 V wye</option>
              </select>
            </label>
          </div>
        ) : null}

        {/* ── 2. DISTRIBUTION ──────────────────────────────────────────────── */}
        {step === 1 ? (
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-200">
              How is this {serviceAmps} A service distributed?
            </div>
            {DISTRIBUTION_PRESETS.map(p => (
              <label key={p.id} data-testid={`wizard-dist-${p.id}`}
                     className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 ${
                       distribution === p.id
                         ? 'border-sky-400 bg-sky-500/10' : 'border-slate-700 hover:border-slate-500'}`}>
                <input type="radio" name="distribution" className="mt-1" checked={distribution === p.id}
                       onChange={() => setDistribution(p.id)} />
                <span>
                  <span className="block text-xs font-bold text-slate-100">{p.label}</span>
                  <span className="block text-[11px] text-slate-400">{p.describe(serviceAmps)}</span>
                </span>
              </label>
            ))}
            {distribution === 'custom' ? (
              <label className="block text-xs text-slate-400">
                Equal branches to create now
                <input type="number" data-testid="wizard-custom-branches" value={customBranches}
                       className={`ml-2 w-20 ${box}`}
                       onChange={e => setCustomBranches(Number(e.target.value))} />
              </label>
            ) : null}
          </div>
        ) : null}

        {/* ── 3. BACKUP ────────────────────────────────────────────────────── */}
        {step === 2 && draft ? (
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-200">Which panels are backed up?</div>
            {draft.panels.length === 0 ? (
              <div className="text-xs text-slate-500">
                This service has no panels yet. Finish and add them from the diagram.
              </div>
            ) : draft.panels.map(p => (
              <label key={p.id} data-testid={`wizard-backup-${p.id}`}
                     className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-xs text-slate-200">
                <input type="checkbox" checked={p.backedUp}
                       onChange={e => setDraft(updatePanel(draft, p.id, { backedUp: e.target.checked }))} />
                <span className="font-bold">{p.label}</span>
                <span className="text-slate-400">
                  {p.busbarRatingA ?? '—'} A bus · {p.mainBreakerA ?? '—'} A main
                </span>
              </label>
            ))}
            <div className="text-[11px] text-slate-500">
              Partial backup is fine — untick a panel and it stays on the service without a gateway.
            </div>
          </div>
        ) : null}

        {/* ── 4. EQUIPMENT ─────────────────────────────────────────────────── */}
        {step === 3 && draft ? (
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-200">
              The stack in each backup domain
            </div>
            {draft.domains.length === 0 ? (
              <div className="text-xs text-slate-500">No backed-up panels, so no domains.</div>
            ) : draft.domains.map(d => {
              const units = d.storageUnitIds
                .map(id => draft.storage.find(u => u.id === id))
                .filter((u): u is NonNullable<typeof u> => !!u);
              const inverting = units.filter(u => u.role === 'inverter-unit');
              const expansions = units.filter(u => u.role === 'energy-expansion');
              const essId = inverting[0]?.productId ?? (INVERTING()[0]?.id ?? '');
              const expId = expansions[0]?.productId ?? (EXPANSIONS()[0]?.id ?? '');
              const reEquip = (o: {
                gw?: string; ess?: string; essN?: number; exp?: string; expN?: number;
              }) => {
                const nEss = o.essN ?? Math.max(inverting.length, 1);
                const nExp = o.expN ?? expansions.length;
                const eid = o.ess ?? essId;
                const xid = o.exp ?? expId;
                const r = setDomainEquipment(draft, d.id, {
                  gatewayProductId: o.gw,
                  storageProductIds: eid ? Array.from({ length: nEss }, () => eid) : [],
                  expansionProductIds: xid ? Array.from({ length: nExp }, () => xid) : [],
                });
                setDraft(r.topology);
                // Accumulated, not replaced: editing domain B used to erase what was unresolved
                // about domain A, so the screen said one gateway had no interrupting rating when
                // neither did.
                setNotes(prev => [...new Set([...prev.filter(n => !n.startsWith(d.label)), ...r.unresolved])]);
              };
              return (
                <div key={d.id} data-testid={`wizard-domain-${d.id}`}
                     className="rounded-lg border border-slate-700 p-2">
                  <div className="text-xs font-bold text-slate-100">
                    {/* 🚨 THE PANEL'S NAME, NOT ITS ID. "backs msp-1" is an internal key shown to
                        an electrician; MSP #1 is what is written on the enclosure. */}
                    {d.label} — backs {d.backedUpPanelIds
                      .map(id => draft.panels.find(p => p.id === id)?.label ?? id).join(', ')}
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="text-[11px] text-slate-400">
                      Controller / gateway
                      <select data-testid={`wizard-${d.id}-gateway`} value={d.gateway.productId}
                              className={`mt-1 block w-full ${box}`}
                              onChange={e => reEquip({ gw: e.target.value })}>
                        {GATEWAYS().map(g => (
                          <option key={g.id} value={g.id}>{g.manufacturer} {g.model}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] text-slate-400">
                      Battery / inverter unit
                      <select data-testid={`wizard-${d.id}-ess`} value={inverting[0]?.productId ?? ''}
                              className={`mt-1 block w-full ${box}`}
                              onChange={e => reEquip({ ess: e.target.value, essN: Math.max(inverting.length, 1) })}>
                        <option value="">none</option>
                        {INVERTING().map(b => (
                          <option key={b.id} value={b.id}>{b.manufacturer} {b.model}</option>
                        ))}
                      </select>
                      <span className="mt-1 flex items-center gap-1">
                        <input type="number" data-testid={`wizard-${d.id}-ess-count`} min={0}
                               value={inverting.length} className={`w-16 ${box}`}
                               onChange={e => reEquip({ essN: Math.max(0, Number(e.target.value)) })} />
                        <span className="text-[10px] text-slate-500">units</span>
                      </span>
                    </label>
                    <label className="text-[11px] text-slate-400">
                      Expansion units
                      <select data-testid={`wizard-${d.id}-expansion`}
                              value={expansions[0]?.productId ?? ''}
                              className={`mt-1 block w-full ${box}`}
                              onChange={e => reEquip({ exp: e.target.value, expN: Math.max(expansions.length, 1) })}>
                        <option value="">none</option>
                        {EXPANSIONS().map(b => (
                          <option key={b.id} value={b.id}>{b.manufacturer} {b.model}</option>
                        ))}
                      </select>
                      <span className="mt-1 flex items-center gap-1">
                        <input type="number" data-testid={`wizard-${d.id}-expansion-count`} min={0}
                               value={expansions.length} className={`w-16 ${box}`}
                               onChange={e => reEquip({ expN: Math.max(0, Number(e.target.value)) })} />
                        <span className="text-[10px] text-slate-500">units</span>
                      </span>
                      {/* Said here, where the number is typed. */}
                      <span className="mt-0.5 block text-[10px] text-sky-300">
                        DC extensions — energy only, no AC output and no breaker of their own.
                      </span>
                    </label>
                  </div>
                </div>
              );
            })}
            {notes.length > 0 ? (
              <ul data-testid="wizard-unresolved"
                  className="list-disc space-y-0.5 pl-5 text-[11px] text-amber-300">
                {notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* ── 5. INTERCONNECTION ───────────────────────────────────────────── */}
        {step === 4 && draft ? (
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-200">How does this system interconnect?</div>

            {/* The project's own authority, RECORDED — not inferred from the equipment chosen. */}
            <label className="block text-xs text-slate-400">
              Is a meter-collar interconnection permitted on this project?
              <select data-testid="wizard-meter-collar-permitted"
                      className={`mt-1 block ${box}`}
                      value={draft.interconnection.meterCollarPermitted === true ? 'yes'
                        : draft.interconnection.meterCollarPermitted === false ? 'no' : 'unknown'}
                      onChange={e => {
                        const v = e.target.value === 'yes' ? true
                          : e.target.value === 'no' ? false : null;
                        setDraft(setInterconnection(draft, {
                          meterCollarPermitted: v,
                          meterCollarSelected: v === true ? draft.interconnection.meterCollarSelected : false,
                        }));
                      }}>
                <option value="unknown">Not established</option>
                <option value="yes">Yes — permitted</option>
                <option value="no">No — prohibited</option>
              </select>
            </label>

            <label data-testid="wizard-ic-meter-collar"
                   className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${
                     draft.interconnection.meterCollarPermitted === false
                       ? 'border-slate-800 text-slate-600'
                       : 'border-slate-700 text-slate-200'}`}>
              <input type="radio" name="poi" className="mt-1"
                     disabled={draft.interconnection.meterCollarPermitted === false}
                     checked={draft.interconnection.meterCollarSelected}
                     onChange={() => setDraft(setInterconnection(draft, { meterCollarSelected: true }))} />
              <span>
                <span className="block font-bold">Meter collar / Backup Switch</span>
                {draft.interconnection.meterCollarPermitted === false ? (
                  <span data-testid="wizard-meter-collar-blocked"
                        className="block text-[11px] font-bold text-amber-300">
                    Unavailable — not permitted on this project.
                  </span>
                ) : (
                  <span className="block text-[11px] text-slate-400">
                    The system connects at the meter socket.
                  </span>
                )}
              </span>
            </label>

            {draft.domains.map(d => (
              <label key={d.id} className="block rounded-lg border border-slate-700 p-2 text-xs text-slate-200">
                <span className="font-bold">{d.label}</span> — point of connection
                <select data-testid={`wizard-${d.id}-connection`} value={d.storageConnection}
                        className={`mt-1 block w-full ${box}`}
                        onChange={e => setDraft(setInterconnection(
                          updateDomain(draft, d.id, {
                            storageConnection: e.target.value as typeof d.storageConnection,
                          }),
                          { meterCollarSelected: false }))}>
                  <option value="unresolved">Not established</option>
                  <option value="backed-up-panel-busbar">
                    Load side — backed-up panel busbar (NEC 705.12(B))
                  </option>
                  <option value="gateway-panelboard">
                    Gateway panelboard — manufacturer-approved gateway topology
                  </option>
                </select>
              </label>
            ))}

            <label className="flex items-start gap-2 text-xs text-slate-200">
              <input type="checkbox" data-testid="wizard-der-isolation-required" className="mt-0.5"
                     checked={draft.interconnection.externalDerIsolationRequired === true}
                     onChange={e => setDraft(setInterconnection(draft, {
                       externalDerIsolationRequired: e.target.checked,
                     }))} />
              <span>This utility requires an external DER isolation device</span>
            </label>
          </div>
        ) : null}

        {/* ── 6. DISCONNECTS ───────────────────────────────────────────────── */}
        {step === 5 && draft ? (
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-200">
              Disconnecting means — four separate roles
            </div>
            {DISCONNECT_ROLES.map(spec => {
              const present = draft.devices.filter(d => d.roles.includes(spec.role as DeviceRole));
              return (
                <label key={spec.role} data-testid={`wizard-role-${spec.role}`}
                       className="flex items-start gap-2 rounded-lg border border-slate-700 p-2 text-xs">
                  <input type="checkbox" className="mt-1" checked={present.length > 0}
                         onChange={e => {
                           if (e.target.checked) {
                             setDraft(addProtectiveDevice(draft, {
                               label: spec.label,
                               roles: [spec.role as DeviceRole],
                               ratedAmps: draft.service.ratedAmps,
                               lockableOpen: spec.lockableOpen,
                               visibleOpen: spec.visibleOpen,
                               locationNote: spec.where,
                             }).topology);
                           } else {
                             let t = draft;
                             for (const d of present) t = removeProtectiveDevice(t, d.id);
                             setDraft(t);
                           }
                         }} />
                  <span>
                    <span className="block font-bold text-slate-100">{spec.label}</span>
                    <span className="block text-[11px] text-slate-400">{spec.where}</span>
                    <span className="block text-[11px] text-slate-500">{spec.purpose}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* ── NAVIGATION ─────────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
        <button type="button" className={ghost} data-testid="wizard-back" disabled={step === 0}
                onClick={() => setStep(s => Math.max(0, s - 1))}>
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" className={primary} data-testid="wizard-next"
                  onClick={() => {
                    if (step === 1) { materialise(); return; }
                    if (step === 2) { materialiseDomains(); return; }
                    setStep(s => s + 1);
                  }}>
            Next: {STEPS[step + 1]}
          </button>
        ) : (
          <button type="button" className={primary} data-testid="wizard-finish"
                  disabled={!draft} onClick={() => draft && onBuilt(draft)}>
            Create this service
          </button>
        )}
        {onCancel ? (
          <button type="button" className={ghost} data-testid="wizard-cancel" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {preview ? (
          <span data-testid="wizard-preview" className="ml-auto text-[11px] text-slate-400">
            {serviceAmps} A · {preview.branches} branch{preview.branches === 1 ? '' : 'es'} ·{' '}
            {preview.panels} panel{preview.panels === 1 ? '' : 's'} ·{' '}
            {preview.domains} backup domain{preview.domains === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-slate-500">{preset?.describe(serviceAmps)}</span>
        )}
      </div>
    </div>
  );
}

export default ServiceTopologyWizard;
