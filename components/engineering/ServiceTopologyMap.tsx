'use client';

// ═══════════════════════════════════════════════════════════════════════════
// THE ELECTRICAL SYSTEM, DRAWN — AND EVERY BOX IS THE THING YOU CLICK TO EDIT IT.
//
// Ray: "The installer should see the electrical system first and the data structure second...
// Configuration should happen through the visual system."
//
//        400 A SERVICE
//              │
//     ┌────────┴────────┐
//  BRANCH A          BRANCH B
//   200 A             200 A
//     │                 │
//   MSP #1            MSP #2
//     │                 │
//  Domain 1          Domain 2
//  Gateway #1        Gateway #2
//  Powerwall 3       Powerwall 3
//  + Expansion       + Expansion
//
// 🚨 IT RENDERS THE CANONICAL GRAPH AND NOTHING ELSE. Every node here is a real object in
// `ServiceTopology`; there is no display-only node, no invented grouping and no equipment that the
// BOM would not also see. A card that exists on screen and not in the graph is how a drawing starts
// disagreeing with a bill of materials.
//
// 🚨 AND AN EXPANSION IS DRAWN AS AN EXPANSION. Ray: "Do not show it as another inverter." It gets
// the DC styling, its energy, and an explicit "DC expansion — no AC output, no breaker".
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import { resolveDemands, serviceRatingLabel } from '@/lib/electrical/serviceTopology';
import type { ServiceOverview } from '@/lib/electrical/topologyOverview';
import { conclusionWord } from '@/lib/electrical/topologyOverview';
import type { EngineeringConclusion } from '@/lib/engineering/engineeringStatus';
import { getBatteryById } from '@/lib/equipment-db';

const A = (v: number | null | undefined) => (typeof v === 'number' ? `${v} A` : '—');

/** The catalogue's own name for a product, falling back to the id when the row is gone. */
function productName(productId: string): string {
  const b = getBatteryById(productId);
  return b ? `${b.manufacturer} ${b.model}` : productId;
}

/** The name on the enclosure for any node id — never the internal key. */
function nodeName(t: ServiceTopology, nodeId: string): string {
  return t.devices.find(d => d.id === nodeId)?.label
    ?? t.panels.find(p => p.id === nodeId)?.label
    ?? t.domains.find(d => d.gateway.id === nodeId)?.gateway.label
    ?? (t.aggregationPanels ?? []).find(a => a.id === nodeId)?.label
    ?? (nodeId === 'service-distribution' ? 'the service distribution' : nodeId);
}

function StatusDot({ conclusion }: { conclusion: EngineeringConclusion }) {
  const cls = conclusion === 'FAIL' ? 'bg-red-400'
    : conclusion === 'NOT_EVALUATED' ? 'bg-amber-400' : 'bg-emerald-400';
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden />;
}

function StatusLine({ status }: { status: { conclusion: EngineeringConclusion; headline: string | null } }) {
  const tone = status.conclusion === 'FAIL' ? 'text-red-300'
    : status.conclusion === 'NOT_EVALUATED' ? 'text-amber-300' : 'text-emerald-300';
  return (
    <div className={`mt-1 flex items-start gap-1.5 text-[11px] leading-snug ${tone}`}>
      <StatusDot conclusion={status.conclusion} />
      <span>
        {conclusionWord(status.conclusion)}
        {status.headline ? <span className="text-slate-400"> — {status.headline}</span> : null}
      </span>
    </div>
  );
}

/** A vertical connector between two stacked cards. */
const Drop = ({ h = 14 }: { h?: number }) => (
  <div className="flex justify-center" aria-hidden>
    <div className="w-px bg-slate-600" style={{ height: h }} />
  </div>
);

export interface ServiceTopologyMapProps {
  topology: ServiceTopology;
  overview: ServiceOverview;
  /** The currently selected node id ('service', 'interconnection', or a topology id). */
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  /** Offered when the service has capacity nobody has claimed. */
  onAddBranch?: (ratedAmps: number) => void;
}

export function ServiceTopologyMap({
  topology, overview, selectedId, onSelect, onAddBranch,
}: ServiceTopologyMapProps) {
  // One reader for load, shared with the inspector and the engineering.
  const demands = resolveDemands(topology);
  const sel = (id: string) =>
    `w-full rounded-lg border px-3 py-2 text-left transition ${
      selectedId === id
        ? 'border-sky-400 bg-sky-500/10 ring-1 ring-sky-400/40'
        : 'border-slate-700 bg-slate-900/70 hover:border-slate-500'
    }`;

  const panelById = new Map(topology.panels.map(p => [p.id, p]));
  const storageById = new Map(topology.storage.map(u => [u.id, u]));
  const domainByBranch = new Map(topology.domains.map(d => [d.branchId, d]));

  // Panels nobody's domain backs up still belong on the drawing: partial backup is a real
  // arrangement, and a panel that vanished from the picture is a panel nobody notices is missing.
  const backedUp = new Set(topology.domains.flatMap(d => d.backedUpPanelIds));
  const branchPanel = (index: number) => {
    // A branch's own panel is the one at the same ordinal that no domain has claimed, unless a
    // domain on this branch names one — then the domain's panel wins, because that is explicit.
    const branch = topology.branches[index];
    const domain = domainByBranch.get(branch.id);
    if (domain) return panelById.get(domain.backedUpPanelIds[0] ?? '') ?? null;
    const free = topology.panels.filter(p => !backedUp.has(p.id));
    return free[index] ?? null;
  };

  const { allocation } = overview;

  return (
    <div data-testid="service-topology-map" className="overflow-x-auto">
      {/* ── SERVICE ──────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-sm">
        <button type="button" data-testid="node-service" className={sel('service')}
                onClick={() => onSelect('service')}>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Service</div>
          <div className="text-lg font-black text-slate-100">
            {serviceRatingLabel(topology)}
          </div>
          <div className="text-xs text-slate-400">{overview.summary.phaseLabel}</div>
          <StatusLine status={overview.site} />
        </button>
        {/* The drop belongs INSIDE the service card's own centred container. Outside it, it centred
            on the full width and hung to the right of the card it was supposed to leave. */}
        <Drop h={18} />
      </div>

      {/* ── THE DISTRIBUTION BUS ──────────────────────────────────────────
          🚨 IT IS BUILT FROM THE SAME FLEX ROW THE COLUMNS USE. Drawn as one wide rule it ran
          past the outermost column on both sides and read as a stray line rather than as the bus
          the branches leave from — visible the moment the screen was looked at. Each cell here is
          one column's width, split at its centre, so the rule starts at the first column's centre
          and stops at the last one's whatever the column count or the viewport. */}
      {(() => {
        const cols = topology.branches.length + (allocation.unallocatedAmps > 0 ? 1 : 0);
        if (cols === 0) return null;
        return (
          <div className="flex justify-center gap-4" aria-hidden>
            {Array.from({ length: cols }, (_, i) => (
              <div key={i} className="flex min-w-[210px] max-w-[280px] flex-1">
                <div className={`h-px flex-1 ${i === 0 ? '' : 'bg-slate-600'}`} />
                <div className={`h-px flex-1 ${i === cols - 1 ? '' : 'bg-slate-600'}`} />
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── ONE COLUMN PER BRANCH ────────────────────────────────────────── */}
      <div className="mt-0 flex items-start justify-center gap-4">
        {topology.branches.map((b, i) => {
          const panel = branchPanel(i);
          const domain = domainByBranch.get(b.id) ?? null;
          const bStatus = overview.branches[b.id]
            ?? { conclusion: 'NOT_EVALUATED' as EngineeringConclusion, headline: null };
          return (
            <div key={b.id} className="min-w-[210px] max-w-[280px] flex-1">
              <Drop h={14} />
              <button type="button" data-testid={`node-${b.id}`} className={sel(b.id)}
                      onClick={() => onSelect(b.id)}>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Service branch
                </div>
                <div className="text-sm font-black text-slate-100">{b.label}</div>
                <div className="text-sm font-bold text-slate-200">{b.ratedAmps} A</div>
                <div className="text-[11px] text-slate-400">
                  {/* 🚨 THE DERIVED FIGURE, NOT THE SCALAR. With the load model behind it the
                      branch's own `calculatedDemandA` is no longer written, so reading it here
                      printed "demand —" on a card whose inspector showed 118.0 A: two answers to
                      one number, on adjacent surfaces. */}
                  OCPD {A(b.ocpdAmps)} · demand {A(demands.branchA[b.id] ?? null)}
                </div>
                <StatusLine status={bStatus} />
              </button>

              {panel ? (
                <>
                  <Drop />
                  <button type="button" data-testid={`node-${panel.id}`} className={sel(panel.id)}
                          onClick={() => onSelect(panel.id)}>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Panelboard
                    </div>
                    <div className="text-sm font-black text-slate-100">{panel.label}</div>
                    <div className="text-[11px] text-slate-300">
                      {A(panel.busbarRatingA)} bus · {A(panel.mainBreakerA)} main
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {panel.backedUp ? 'Backed up' : 'Not backed up'}
                    </div>
                  </button>
                </>
              ) : null}

              {domain ? (
                <>
                  <Drop />
                  <button type="button" data-testid={`node-${domain.id}`} className={sel(domain.id)}
                          onClick={() => onSelect(domain.id)}>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      {/* 🚨 NOT "BACKUP DOMAIN". Ray: avoid leading with domain semantics — it is
                          the system that is backed up, as far as the person installing it is
                          concerned. `BackupDomain` is still what the model and the engineering
                          call it. */}
                      Backed-up system
                    </div>
                    <div className="text-sm font-black text-slate-100">{domain.label}</div>

                    {/* GATEWAY — equipment that looks like equipment. */}
                    <div className="mt-2 rounded border border-slate-700/80 bg-slate-950/40 px-2 py-1">
                      <div className="text-[11px] font-bold text-slate-100">{domain.gateway.label}</div>
                      <div className="text-[11px] text-slate-400">
                        {A(domain.gateway.continuousRatingA)} continuous
                      </div>
                      <div className="text-[11px] text-slate-500">
                        backs {domain.backedUpPanelIds
                          .map(id => panelById.get(id)?.label ?? id).join(', ') || '—'}
                      </div>
                    </div>

                    {/* STORAGE — inverting units, then their DC expansions. */}
                    {domain.storageUnitIds
                      .map(id => storageById.get(id))
                      .filter((u): u is NonNullable<typeof u> => !!u)
                      .sort((a, b2) => (a.role === b2.role ? 0 : a.role === 'inverter-unit' ? -1 : 1))
                      .map(u => u.role === 'energy-expansion' ? (
                        <div key={u.id} data-testid={`node-storage-${u.id}`}
                             className="mt-1 rounded border border-dashed border-sky-500/50 bg-sky-500/5 px-2 py-1">
                          <div className="text-[11px] font-bold text-sky-200">
                            {productName(u.productId)}
                          </div>
                          <div className="text-[11px] text-slate-300">
                            {u.usableKwh ?? '—'} kWh
                          </div>
                          {/* 🚨 NEVER "another inverter". */}
                          <div className="text-[11px] text-sky-300">
                            DC expansion — no AC output, no breaker
                          </div>
                        </div>
                      ) : (
                        <div key={u.id} data-testid={`node-storage-${u.id}`}
                             className="mt-1 rounded border border-emerald-600/40 bg-emerald-500/5 px-2 py-1">
                          <div className="text-[11px] font-bold text-emerald-200">
                            {productName(u.productId)}
                          </div>
                          <div className="text-[11px] text-slate-300">
                            {u.usableKwh ?? '—'} kWh · {A(u.continuousOutputA)} AC
                          </div>
                        </div>
                      ))}

                    <StatusLine status={overview.domains[domain.id]
                      ?? { conclusion: 'NOT_EVALUATED', headline: null }} />
                  </button>

                  {/* ── THIS SYSTEM'S OWN GENERATION / COMBINER PANEL ────────
                      🚨 INSIDE THE SYSTEM, NOT IN A SHARED GROUP BELOW. Ray's job has one per
                      system, each taking only its own batteries and feeding only its own gateway;
                      drawn in the shared "connection to the service" group they would read as a
                      combined panel, which is the arrangement he explicitly does not have. */}
                  {(topology.aggregationPanels ?? [])
                    .filter(agg => agg.domainId === domain.id)
                    .map(agg => (
                      <React.Fragment key={agg.id}>
                        <Drop />
                        <button type="button" data-testid={`node-${agg.id}`}
                                className={`${sel(agg.id)} w-full`} onClick={() => onSelect(agg.id)}>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Generation panel
                          </div>
                          <div className="text-sm font-black text-slate-100">{agg.label}</div>
                          <div className="text-[11px] text-slate-300">
                            {A(agg.busbarRatingA)} bus · {agg.inputs.length} breaker
                            {agg.inputs.length === 1 ? '' : 's'} · {A(agg.outputOcpdA)} out
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Feeds {nodeName(topology, agg.feedsNodeId ?? '')}
                          </div>
                          <StatusLine status={overview.aggregationPanels?.[agg.id]
                            ?? { conclusion: 'NOT_EVALUATED', headline: null }} />
                        </button>
                      </React.Fragment>
                    ))}
                </>
              ) : (
                <>
                  <Drop />
                  <div data-testid={`no-domain-${b.id}`}
                       className="rounded-lg border border-dashed border-slate-700 px-3 py-2 text-[11px] text-slate-500">
                    Not backed up.
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* ── THE UNASSIGNED SERVICE CAPACITY, SHOWN AS A GAP ──────────────── */}
        {allocation.unallocatedAmps > 0 ? (
          <div className="min-w-[210px] max-w-[280px] flex-1" data-testid="unallocated-column">
            <Drop h={14} />
            <div className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                Unassigned
              </div>
              <div className="text-sm font-black text-amber-200">
                {allocation.unallocatedAmps} A
              </div>
              <div className="text-[11px] text-slate-400">
                The service is rated {allocation.ratedAmps} A and {allocation.allocatedAmps} A is
                allocated to branches.
              </div>
              {onAddBranch && allocation.suggestedBranchAmps ? (
                <button type="button" data-testid="add-suggested-branch"
                        onClick={() => onAddBranch(allocation.suggestedBranchAmps!)}
                        className="mt-2 w-full rounded bg-amber-500/20 px-2 py-1 text-[11px] font-bold text-amber-200 hover:bg-amber-500/30">
                  + Add {allocation.suggestedBranchCount > 1 ? 'a' : 'second'}{' '}
                  {allocation.suggestedBranchAmps} A branch
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* ── PANELS NO BRANCH COLUMN CLAIMED ──────────────────────────────── */}
      {(() => {
        const shown = new Set(
          topology.branches.map((_, i) => branchPanel(i)?.id).filter(Boolean) as string[]);
        const rest = topology.panels.filter(p => !shown.has(p.id));
        if (rest.length === 0) return null;
        return (
          <div className="mt-4" data-testid="unplaced-panels">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Panels not on a branch
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              {rest.map(p => (
                <button key={p.id} type="button" data-testid={`node-${p.id}`}
                        className={`${sel(p.id)} max-w-[220px]`} onClick={() => onSelect(p.id)}>
                  <div className="text-sm font-black text-slate-100">{p.label}</div>
                  <div className="text-[11px] text-slate-300">
                    {A(p.busbarRatingA)} bus · {A(p.mainBreakerA)} main
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── WHERE THE DER ACTUALLY CONVERGES ─────────────────────────────────
          Ray: "Ray should be able to see Gateway / PW domain A and Gateway / PW domain B
          converging where they actually converge. Then visibly show: DER aggregation panel →
          external DER disconnect → 400 A service point of interconnection." */}
      {(topology.aggregationPanels ?? []).some(a => !a.domainId)
        || (topology.pointsOfInterconnection ?? []).length > 0 ? (
        <div className="mt-5" data-testid="der-interconnection-group">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Connection to the service
            {overview.summary.derArrangementLabel
              ? <span className="ml-2 normal-case tracking-normal text-slate-400">
                  {overview.summary.derArrangementLabel}
                </span>
              : <span className="ml-2 normal-case tracking-normal text-amber-300">
                  arrangement not chosen
                </span>}
          </div>
          <div className="mt-2 flex flex-wrap items-stretch gap-3">
            {/* Only the SITE-WIDE kind here. A panel that belongs to one system was already
                drawn inside that system's column above. */}
            {(topology.aggregationPanels ?? []).filter(a => !a.domainId).map(agg => {
              const sourceCount = agg.inputs.length;
              return (
                <button key={agg.id} type="button" data-testid={`node-${agg.id}`}
                        className={`${sel(agg.id)} max-w-xs flex-1`} onClick={() => onSelect(agg.id)}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    DER aggregation panel
                  </div>
                  <div className="text-sm font-black text-slate-100">{agg.label}</div>
                  <div className="text-[11px] text-slate-300">
                    {A(agg.busbarRatingA)} bus · {agg.mainLugOnly ? 'MLO' : `${A(agg.mainBreakerA)} main`}
                    {' · '}{A(agg.outputOcpdA)} output
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {sourceCount} DER circuit{sourceCount === 1 ? '' : 's'}
                    {agg.carriesPremisesLoad === false ? ' · DER only, no premises load' : ''}
                  </div>
                  <StatusLine status={overview.aggregationPanels?.[agg.id]
                    ?? { conclusion: 'NOT_EVALUATED', headline: null }} />
                </button>
              );
            })}
            {(topology.pointsOfInterconnection ?? []).map(poi => (
              <button key={poi.id} type="button" data-testid={`node-${poi.id}`}
                      className={`${sel(poi.id)} max-w-xs flex-1`} onClick={() => onSelect(poi.id)}>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Point of interconnection
                </div>
                <div className="text-sm font-black text-slate-100">{poi.label}</div>
                <div className={`text-[11px] ${poi.relationship === 'unresolved'
                  ? 'font-bold text-amber-300' : 'text-slate-300'}`}>
                  {poi.relationship === 'unresolved'
                    ? 'Arrangement not chosen'
                    : poi.relationship.replace(/-/g, ' ')}
                </div>
                <div className="text-[11px] text-slate-500">
                  {poi.connectedToNodeId
                    ? `lands on ${nodeName(topology, poi.connectedToNodeId)}`
                    : 'landing point not established'}
                </div>
                <StatusLine status={overview.pois?.[poi.id]
                  ?? { conclusion: 'NOT_EVALUATED', headline: null }} />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── THE UTILITY-FACING ARRANGEMENT ───────────────────────────────── */}
      <div className="mt-5 flex flex-wrap items-stretch gap-3">
        <button type="button" data-testid="node-interconnection"
                className={`${sel('interconnection')} max-w-md flex-1`}
                onClick={() => onSelect('interconnection')}>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Interconnection &amp; disconnects
          </div>
          <div className="text-xs text-slate-300">
            {topology.devices.length === 0
              ? 'No disconnecting means recorded yet.'
              : topology.devices.map(d => d.label).join(' · ')}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Meter collar:{' '}
            {topology.interconnection.meterCollarPermitted === false ? 'not permitted'
              : topology.interconnection.meterCollarSelected ? 'selected'
                : topology.interconnection.meterCollarPermitted === true ? 'permitted, not selected'
                  : 'not established'}
          </div>
        </button>
      </div>
    </div>
  );
}

export default ServiceTopologyMap;
