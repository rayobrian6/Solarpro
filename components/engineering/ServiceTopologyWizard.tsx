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
  DER_ARRANGEMENT_CHOICES, applyDerArrangement,
  ISOLATION_ARRANGEMENTS, applyIsolationArrangement, describeArrangementFor,
  SOLAR_COUPLING_CHOICES, applyPerSystemGenerationPanels, clearPerSystemGenerationPanels,
} from '@/lib/electrical/topologyPresets';
import {
  addBackupDomain, removeBackupDomain, setDomainEquipment, updatePanel, updateDomain,
  addProtectiveDevice, removeProtectiveDevice, setInterconnection, setSolarCoupling,
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
  /**
   * An EXISTING topology to walk back through, rather than a new one to create.
   *
   * 🚨 RAY SAVED A TOPOLOGY AND HAD NO WAY BACK IN. Ray: "The wizard creates the topology. The
   * wizard must not be the only way to edit it" — and its converse, which is what this prop is:
   * having created one, the guided flow must still be a way to change it. It opens ON the passed
   * graph, so every step edits the same object the diagram edits. There is no second draft model.
   */
  initial?: ServiceTopology | null;
  onBuilt: (topology: ServiceTopology) => void;
  onCancel?: () => void;
}

export function ServiceTopologyWizard({
  meterCollarPermitted = null, initial = null, onBuilt, onCancel,
}: ServiceTopologyWizardProps) {
  // Re-entering an existing design opens at BACKUP: the service and its distribution already exist,
  // and re-running the preset over them would rebuild branches that have equipment on them.
  const [step, setStep] = useState(initial ? 2 : 0);
  const [serviceAmps, setServiceAmps] = useState(initial?.service.ratedAmps ?? 400);
  const [phase, setPhase] = useState<ServicePhase>(initial?.service.phase ?? 'split-240');
  const [distribution, setDistribution] = useState('two-main-panels');
  const [customBranches, setCustomBranches] = useState(2);
  const [draft, setDraft] = useState<ServiceTopology | null>(initial);
  const [arrangementNotes, setArrangementNotes] = useState<string[]>([]);
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
      <div className="text-sm font-black text-slate-100">
        {initial ? 'Guided setup — editing this service' : 'Build the service'}
      </div>
      <div className="mt-1 text-xs text-slate-400">
        {initial
          ? 'Walk back through the six questions. Every answer edits the topology you already have.'
          : 'Six questions. SolarPro turns the answers into the service graph every other surface '
            + 'reads.'}
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
            {/* ── THE GENERATION / COMBINER PANEL, AS A PHYSICAL BOX ──────────
                🚨 NOT A NOTE AND NOT AN ASSUMED PIECE OF WIRING. Ray: "Each pair of Powerwall 3
                units must first land in a generation / combiner panel before feeding its Gateway...
                Do not represent the combiner as a note or invisible wiring assumption." One per
                system, each sized from ITS OWN batteries — never one shared by both gateways. */}
            {/* ══════════════════════════════════════════════════════════════
                🚨 ASK THE PHYSICAL QUESTION. DO NOT OFFER AN OPT-IN.

                This was a checkbox, and Ray's real project is the proof that a checkbox is the wrong
                control: he never ticked it, so his saved graph has NO generation panels, and the
                drawing, the BOM, the schedules and the permit have all been describing a design
                missing two physical panelboards. Ray: "The current opt-in checkbox is too easy to
                omit and leaves the project graph materially incomplete."

                An unticked checkbox is indistinguishable from a decision not to use one. A radio
                group with no default is not: until one is chosen the graph says `unresolved`, and
                every surface already reports NOT EVALUATED for that — which is the honest state.

                The three options are not invented for this control. They ARE
                `BackupDomain.storageConnection`, which has modelled exactly these since the graph was
                built, and each selects a DIFFERENT governing calculation:
                  · backed-up-panel-busbar — NEC 705.12(B), the 120% busbar rule
                  · gateway-panelboard     — the MANUFACTURER's limits, which SolarPro does not hold
                  · der-aggregation-panel  — the generation panel's own busbar
                Tesla's Gateway 3 manual supports both of the first two (internal panelboard, or an
                external generation panel), so neither is a default and the question is real.
               ══════════════════════════════════════════════════════════════ */}
            {draft.domains.length > 0 ? (
              <div data-testid="wizard-generation-panel"
                   className="rounded-lg border border-slate-700 p-2">
                <span className="block text-xs font-bold text-slate-100">
                  How are the battery AC circuits combined before the gateway?
                </span>
                <span className="mb-1 block text-[11px] text-slate-400">
                  A physical question with a different code rule behind each answer. Required —
                  unanswered, the busbar check cannot be evaluated.
                </span>
                {([
                  ['der-aggregation-panel',
                    'External generation / combiner panel — one per system',
                    `${draft.domains.length} panel${draft.domains.length === 1 ? '' : 's'}, each between that system's batteries and its gateway, with a breaker per battery. Never one shared.`],
                  ['gateway-panelboard',
                    'Inside the gateway’s own panelboard',
                    'The battery breakers sit in the gateway’s internal panelboard. Governed by the manufacturer’s limits, which SolarPro does not hold — the busbar check will say so rather than pass.'],
                  ['backed-up-panel-busbar',
                    'On the backed-up panel’s busbar',
                    'The battery breaker is in the backed-up panel, so its output counts against that panel’s busbar and NEC 705.12(B) governs.'],
                ] as const).map(([value, title, detail]) => {
                  const chosen = draft.domains.every(d => d.storageConnection === value);
                  return (
                    <label key={value}
                           data-testid={`wizard-storage-connection-${value}`}
                           className="mt-1 flex cursor-pointer items-start gap-2 rounded border border-slate-800 p-1.5">
                      <input type="radio" name="storage-connection" className="mt-1"
                             checked={chosen}
                             onChange={() => {
                               // One answer for the whole site: the question is about the
                               // arrangement, and a site with two systems wired differently is the
                               // 'custom' case, reached by editing a domain directly.
                               let next = draft;
                               next = value === 'der-aggregation-panel'
                                 ? (() => {
                                     const r = applyPerSystemGenerationPanels(next);
                                     setNotes(prev => [...new Set([...prev, ...r.created])]);
                                     return r.topology;
                                   })()
                                 : clearPerSystemGenerationPanels(next);
                               for (const d of next.domains) {
                                 next = updateDomain(next, d.id, { storageConnection: value });
                               }
                               setDraft(next);
                             }} />
                      <span>
                        <span className="block text-xs font-bold text-slate-100">{title}</span>
                        <span className="block text-[11px] text-slate-400">{detail}</span>
                      </span>
                    </label>
                  );
                })}
                <span>
                  {draft.domains.some(d => d.storageConnection === 'unresolved') ? (
                    <span className="mt-1 block text-[11px] font-bold text-amber-300">
                      NOT ANSWERED — the busbar check reports NOT EVALUATED until it is.
                    </span>
                  ) : null}
                  {(draft.aggregationPanels ?? []).filter(p => p.domainId).map(p => (
                    <span key={p.id} className="mt-1 block text-[11px] text-sky-300">
                      {p.label}: {p.busbarRatingA ?? '—'} A bus · {p.outputOcpdA ?? '—'} A output ·{' '}
                      {p.inputs.length} breaker{p.inputs.length === 1 ? '' : 's'}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}

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
            {/* 🚨 RAY'S QUESTION, ASKED FIRST.
                "After Ray builds 400 A → 2 × 200 A MSP → 2 backup domains, the next step should not
                be a pile of unresolved text. Ask: HOW DO THESE DER SYSTEMS INTERCONNECT? Show only
                topology choices SolarPro can represent."
                Choosing one BUILDS the nodes. It claims nothing about whether the arrangement is
                permitted — that is the manufacturer's and the jurisdiction's answer, and both stay
                exactly as unresolved as they were. */}
            {/* 🚨 ASKED IN THE INSTALLER'S WORDS. Ray: "Installer-facing language should be...
                Two 200 A systems... Avoid leading with terms like DER, graph node, aggregation
                topology, domain semantics." The node it builds is still the generic DER aggregation
                panel the engineering and the sheet speak about — one model, two vocabularies. */}
            {/* ── HOW THE NEW SOLAR CONNECTS ────────────────────────────────
                🚨 THE PROJECT'S ONE ANSWER, ASKED ONCE, HERE. Ray, from the live browser: "Service
                Topology says Tesla. Main electrical system still says MICROINVERTER. SLD still
                draws Enphase equipment. That is unacceptable. SolarPro needs one explicit
                project-level solar coupling architecture." Unanswered, every consumer infers one. */}
            <div className="text-xs font-bold text-slate-200">
              How does the new solar connect?
            </div>
            {SOLAR_COUPLING_CHOICES.map(c => (
              <label key={c.id} data-testid={`wizard-coupling-${c.id}`}
                     className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 ${
                       (draft.solarCoupling ?? null) === c.id
                         ? 'border-sky-400 bg-sky-500/10' : 'border-slate-700 hover:border-slate-500'}`}>
                <input type="radio" name="solarCoupling" className="mt-1"
                       checked={(draft.solarCoupling ?? null) === c.id}
                       onChange={() => setDraft(setSolarCoupling(draft, c.id))} />
                <span>
                  <span className="block text-xs font-bold text-slate-100">
                    {c.labelFor(draft)}
                  </span>
                  <span className="block text-[11px] text-slate-400">{c.describe}</span>
                </span>
              </label>
            ))}
            {(draft.solarCoupling ?? null) === null ? (
              <div data-testid="wizard-coupling-unset" className="text-[11px] text-amber-300">
                Not selected — until it is, the drawing and the equipment list each have to guess.
              </div>
            ) : null}

            <div className="pt-2 text-xs font-bold text-slate-200">
              How do these systems connect to the service?
            </div>
            {DER_ARRANGEMENT_CHOICES.map(c => (
              <label key={c.id} data-testid={`wizard-arrangement-${c.id}`}
                     className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 ${
                       draft.interconnection.derArrangement === c.id
                         ? 'border-sky-400 bg-sky-500/10' : 'border-slate-700 hover:border-slate-500'}`}>
                <input type="radio" name="derArrangement" className="mt-1"
                       checked={draft.interconnection.derArrangement === c.id}
                       onChange={() => {
                         const r = applyDerArrangement(draft, c.id);
                         setDraft(r.topology);
                         setArrangementNotes(r.created);
                       }} />
                <span>
                  <span className="block text-xs font-bold text-slate-100">{c.label}</span>
                  {/* The sizes actually in this graph — "Two 200 A systems, independent" — composed
                      from the branches so it can never disagree with them. */}
                  <span className="block text-[11px] text-slate-300">
                    {describeArrangementFor(draft, c.id)}
                  </span>
                  <span className="block text-[11px] text-slate-400">{c.describe}</span>
                  <span className="block text-[11px] text-slate-500">{c.builds}</span>
                </span>
              </label>
            ))}
            {arrangementNotes.length > 0 ? (
              <ul data-testid="wizard-arrangement-built"
                  className="list-disc space-y-0.5 pl-5 text-[11px] text-emerald-300">
                {arrangementNotes.map((nte, i) => <li key={i}>{nte}</li>)}
              </ul>
            ) : null}
            <div className="pt-1 text-[10px] text-slate-500">
              Neither standard option is claimed to be permitted here. The manufacturer's
              multi-controller guidance and the utility&apos;s interconnection requirements decide
              that, and both remain listed as unresolved until they are supplied.
            </div>

            <div className="mt-3 text-xs font-bold text-slate-200">Point of connection</div>

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

            {/* 🚨 NOT OFFERED WHEN THE ARRANGEMENT HAS ALREADY ANSWERED IT. With a common
                aggregation panel the storage no longer lands on a panel busbar or in a controller,
                and leaving these selects on screen invited the operator to undo the arrangement
                they had just chosen — two controls for one fact, which is the shape Ray rejected. */}
            {draft.interconnection.derArrangement === 'common-aggregation'
              ? draft.domains.map(d => (
                  <div key={d.id} data-testid={`wizard-${d.id}-connection-aggregated`}
                       className="rounded-lg border border-slate-700 p-2 text-xs text-slate-300">
                    <span className="font-bold">{d.label}</span> — its storage lands in the DER
                    aggregation panel and interconnects there.
                  </div>
                ))
              : draft.domains.map(d => (
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
              <span>This utility requires an external, utility-accessible safety switch</span>
            </label>
          </div>
        ) : null}

        {/* ── 6. DISCONNECTS ───────────────────────────────────────────────── */}
        {step === 5 && draft ? (
          <div className="space-y-2">
            {/* ── THE UTILITY'S SAFETY SWITCH, AND HOW MANY OF THEM ───────────
                🚨 ONE PER SYSTEM IS A CHOICE, NOT A CONSEQUENCE OF THE SERVICE SIZE. Ray: "Do not
                invent a common 400 A knife-blade switch or common DER combiner merely because the
                service is 400 A." Per-path builds one switch IN LINE in each path, rated for that
                path — 200 A devices on a 400 A service. */}
            <div className="text-xs font-bold text-slate-200">
              Where does the utility&apos;s safety switch go?
            </div>
            {ISOLATION_ARRANGEMENTS.map(choice => {
              const isolators = draft.devices.filter(d => d.roles.includes('der-isolation-disconnect'));
              const selected = choice.id === 'one-per-path'
                ? isolators.length > 1 && isolators.every(d => !!d.inlineOnNodeId)
                : isolators.length === 1 && !isolators[0].inlineOnNodeId;
              return (
                <label key={choice.id} data-testid={`wizard-isolation-${choice.id}`}
                       className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 ${
                         selected ? 'border-sky-400 bg-sky-500/10' : 'border-slate-700 hover:border-slate-500'}`}>
                  <input type="radio" name="isolationArrangement" className="mt-1" checked={selected}
                         onChange={() => {
                           const r = applyIsolationArrangement(draft, choice.id);
                           setDraft(r.topology);
                           setNotes(prev => [...new Set([...prev, ...r.unresolved])]);
                         }} />
                  <span>
                    <span className="block text-xs font-bold text-slate-100">{choice.label}</span>
                    <span className="block text-[11px] text-slate-400">{choice.describe}</span>
                    <span className="block text-[11px] text-slate-500">{choice.builds}</span>
                  </span>
                </label>
              );
            })}

            {/* 🚨 WHAT IS BUILT, AND — SEPARATELY — WHAT IS NOT APPROVED. Ray: "Show: 2 disconnects
                — both systems independently isolated, and SEPARATELY: Utility/AHJ acceptance: needs
                verification. Do not claim approval that SolarPro does not have." */}
            {(() => {
              const isolators = draft.devices.filter(d => d.roles.includes('der-isolation-disconnect'));
              if (isolators.length === 0) return null;
              const perPath = isolators.length > 1 && isolators.every(d => !!d.inlineOnNodeId);
              return (
                <div data-testid="wizard-isolation-summary"
                     className="rounded-lg border border-slate-700 p-2">
                  <div className="text-xs font-bold text-slate-100">
                    {isolators.length} disconnect{isolators.length === 1 ? '' : 's'} —{' '}
                    {perPath ? 'both systems independently isolated'
                      : 'one device isolating the whole service'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {isolators.map(d => `${d.label} (${d.ratedAmps ?? '—'} A)`).join(' · ')}
                  </div>
                  <label className="mt-2 block text-[11px] text-slate-400">
                    Utility / AHJ acceptance
                    <select data-testid="wizard-isolation-accepted" className={`mt-1 block ${box}`}
                            value={draft.interconnection.isolationArrangementAccepted === true ? 'yes'
                              : draft.interconnection.isolationArrangementAccepted === false ? 'no'
                                : 'unknown'}
                            onChange={e => setDraft(setInterconnection(draft, {
                              isolationArrangementAccepted: e.target.value === 'yes' ? true
                                : e.target.value === 'no' ? false : null,
                            }))}>
                      <option value="unknown">Needs verification</option>
                      <option value="yes">Accepted as drawn</option>
                      <option value="no">Not accepted</option>
                    </select>
                  </label>
                  {draft.interconnection.isolationArrangementAccepted === true ? null : (
                    <div data-testid="wizard-isolation-unverified"
                         className="mt-1 text-[11px] font-bold text-amber-300">
                      Utility / AHJ acceptance: needs verification
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="pt-2 text-xs font-bold text-slate-200">
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
            {initial ? 'Apply these changes' : 'Create this service'}
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
