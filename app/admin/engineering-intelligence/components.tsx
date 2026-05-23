import Link from 'next/link';
import type {
  AuditGuardWorkspaceModel,
  CanonicalEvidenceWorkspaceGroupModel,
  DecisionWorkspaceItemModel,
  DependencyGraphViewerModel,
  EngineeringHealthDashboardModel,
  EngineeringIntelligenceRouteSummary,
  EngineeringIntelligenceWorkspaceModel,
  RegenerationPlanningWorkspaceModel,
  RequirementWorkspaceItemModel,
  SnapshotTimelineWorkspaceModel,
  StaleInvalidationWorkspaceModel,
} from '@/lib/engineeringIntelligence';

const statusColor: Record<string, string> = {
  satisfied: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  partial: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  partially_satisfied: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  blocked: 'border-red-500/30 bg-red-500/10 text-red-300',
  missing: 'border-red-500/30 bg-red-500/10 text-red-300',
  inactive: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  current: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  stale: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  invalidated: 'border-red-500/30 bg-red-500/10 text-red-300',
  preserved: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  not_loaded: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
  insufficient_metadata: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function WorkspaceShell({ model, title, subtitle, children }: {
  model: EngineeringIntelligenceWorkspaceModel;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6 text-slate-100">
      <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-slate-950 via-slate-950 to-sky-950/40 p-6 shadow-2xl shadow-sky-950/10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-3 inline-flex rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.28em] text-sky-300">
              Deterministic Engineering Intelligence
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">{title}</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">{subtitle}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs text-slate-300 lg:w-80">
            <div className="font-semibold text-white">Workspace source</div>
            <div className="mt-2 font-mono text-sky-300">{model.generatedFrom}</div>
            <div className="mt-1">Project: {model.projectId ?? 'not selected'}</div>
            <div className="mt-3 text-slate-400">No OCR/CV/CAD/autonomous-regeneration runtime path is exposed here.</div>
          </div>
        </div>
      </div>
      <RouteNav routes={model.routes} />
      {children}
    </div>
  );
}

export function RouteNav({ routes }: { routes: EngineeringIntelligenceRouteSummary[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {routes.map(route => (
        <Link key={route.routeId} href={route.href.includes('[id]') ? '/admin/engineering-intelligence/project/demo' : route.href}
          className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-sky-400/40 hover:bg-sky-400/10">
          <div className="text-sm font-bold text-white">{route.label}</div>
          <div className="mt-2 text-xs leading-5 text-slate-400">{route.deterministicPurpose}</div>
        </Link>
      ))}
    </div>
  );
}

export function Panel({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 shadow-xl shadow-black/10">
      <div className="mb-4">
        {eyebrow && <div className="mb-1 text-[10px] font-black uppercase tracking-[0.24em] text-sky-300">{eyebrow}</div>}
        <h2 className="text-lg font-black text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-slate-400">{children}</div>;
}

function StatusPill({ value }: { value: string }) {
  return <span className={cx('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', statusColor[value] ?? statusColor.not_loaded)}>{value}</span>;
}

function TokenList({ values, limit = 6 }: { values: string[]; limit?: number }) {
  if (!values.length) return <span className="text-slate-500">none</span>;
  const visible = values.slice(0, limit);
  const remaining = values.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map(value => <span key={value} className="rounded-md bg-white/5 px-2 py-1 font-mono text-[10px] text-slate-300">{value}</span>)}
      {remaining > 0 && <span className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-slate-400">+{remaining}</span>}
    </div>
  );
}

export function EngineeringHealthDashboard({ health }: { health: EngineeringHealthDashboardModel }) {
  const cards = [
    ['Valid outputs', health.validOutputs, 'current deterministic outputs'],
    ['Stale outputs', health.staleOutputs, 'outputs requiring review or planned regeneration'],
    ['Invalidated outputs', health.invalidatedOutputs, 'transition events marked invalidated'],
    ['Blocked outputs', health.blockedOutputs, 'blocked by dependencies'],
    ['Regeneration candidates', health.regenerationCandidates, 'planned candidates only'],
    ['Audit warnings', health.activeAuditGuardWarnings, 'active guard warnings/failures'],
    ['Snapshots', health.snapshotVersions, 'durable state versions'],
    ['Graph edges', health.dependencyGraphEdges, `${health.dependencyGraphNodes} graph nodes`],
  ];
  return (
    <Panel title="Engineering Health Dashboard" eyebrow="Health">
      <div className="grid gap-3 md:grid-cols-4">
        {cards.map(([label, value, sub]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
            <div className="mt-2 text-3xl font-black text-white">{value}</div>
            <div className="mt-1 text-xs text-slate-400">{sub}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">Evidence completeness: <span className="font-mono text-sky-300">{health.evidenceCompleteness}</span></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">Requirement satisfaction: <span className="font-mono text-sky-300">{health.requirementSatisfaction}</span></div>
      </div>
      <DeterministicNotes notes={health.deterministicNotes} />
    </Panel>
  );
}

export function CanonicalEvidenceWorkspace({ groups }: { groups: CanonicalEvidenceWorkspaceGroupModel[] }) {
  return (
    <Panel title="Canonical Evidence Workspace" eyebrow="Evidence lineage">
      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map(group => (
          <div key={group.groupId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-white">{group.label}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-400">{group.description}</p>
              </div>
              <span className="rounded-full bg-sky-400/10 px-2 py-1 text-[10px] font-bold text-sky-300">{group.canonicalEvidenceItems.length} items</span>
            </div>
            <div className="mt-3 text-xs text-slate-400">Linked requirements</div>
            <TokenList values={group.requirementIds} />
            <div className="mt-4 space-y-2">
              {group.canonicalEvidenceItems.length ? group.canonicalEvidenceItems.map(item => (
                <div key={item.canonicalEvidenceId} className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-white">{item.canonicalEvidenceId}</span><StatusPill value={item.status} /></div>
                  <div className="mt-2 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
                    <div>Duplicate collapse count: {item.duplicateCollapseCount}</div>
                    <div>Origin surveys: {item.originatingSurveyIds.length}</div>
                  </div>
                  <div className="mt-2"><TokenList values={item.linkedRequirementIds} /></div>
                </div>
              )) : <EmptyState>No canonical evidence rows are loaded for this group in the current deterministic workspace context.</EmptyState>}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function RequirementWorkspace({ requirements }: { requirements: RequirementWorkspaceItemModel[] }) {
  return (
    <Panel title="Requirement Workspace" eyebrow="Registry status">
      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.04] text-slate-400">
            <tr><th className="p-3">Requirement</th><th className="p-3">Status</th><th className="p-3">Evidence</th><th className="p-3">Decisions</th><th className="p-3">Stale impact</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {requirements.map(req => (
              <tr key={req.requirementId} className="align-top">
                <td className="p-3"><div className="font-semibold text-white">{req.label}</div><div className="mt-1 text-slate-500">{req.requirementId}</div><div className="mt-1 max-w-md text-slate-400">{req.description}</div></td>
                <td className="p-3"><StatusPill value={req.status} /></td>
                <td className="p-3"><TokenList values={req.linkedEvidenceIds} /></td>
                <td className="p-3"><TokenList values={req.linkedDecisionIds} /></td>
                <td className="p-3"><TokenList values={req.staleImpactStateIds} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function DecisionWorkspace({ decisions }: { decisions: DecisionWorkspaceItemModel[] }) {
  return (
    <Panel title="Engineering Decision Workspace" eyebrow="Decision provenance">
      <div className="grid gap-3 lg:grid-cols-2">
        {decisions.map(decision => (
          <div key={decision.decisionType} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-white">{decision.label}</h3><div className="mt-1 font-mono text-[10px] text-slate-500">{decision.decisionType}</div></div><StatusPill value={decision.fallbackDefaultChain.length ? 'partial' : 'not_loaded'} /></div>
            <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2"><div>Category: {decision.category}</div><div>Domain: {decision.domain}</div></div>
            <div className="mt-3 text-xs text-slate-400">Governing rules</div><TokenList values={decision.governingRuleIds} />
            <div className="mt-3 text-xs text-slate-400">Dependency lineage</div><TokenList values={decision.dependencyLineageIds} />
            <div className="mt-3 text-xs text-slate-400">Fallback/default chain</div><TokenList values={decision.fallbackDefaultChain} />
            <div className="mt-3 text-xs text-slate-400">Affected outputs / stale impact</div><TokenList values={[...decision.affectedOutputIds, ...decision.staleImpactStateIds]} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function StaleInvalidationWorkspace({ stale }: { stale: StaleInvalidationWorkspaceModel }) {
  return (
    <Panel title="Stale-State / Invalidation Workspace" eyebrow="Invalidation">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Stale outputs" value={stale.staleOutputIds.length} />
        <Metric label="Invalidation chains" value={stale.invalidationChains.length} />
        <Metric label="Preserved outputs" value={stale.preservedOutputIds.length} />
        <Metric label="Regeneration scope" value={stale.regenerationScopeIds.length} />
      </div>
      <div className="mt-4 space-y-2">
        {stale.invalidationChains.length ? stale.invalidationChains.map(chain => (
          <div key={chain.eventId} className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 text-xs">
            <div className="font-mono text-orange-300">{chain.eventId}</div><div className="mt-1 text-white">{chain.stateId}</div><p className="mt-2 text-slate-400">{chain.reason}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3"><TokenList values={chain.triggeringEvidenceIds} /><TokenList values={chain.triggeringDecisionIds} /><TokenList values={chain.downstreamStateIds} /></div>
          </div>
        )) : <EmptyState>No invalidation transition history is loaded.</EmptyState>}
      </div>
      <DeterministicNotes notes={stale.deterministicNotes} />
    </Panel>
  );
}

export function SnapshotTimelineWorkspace({ snapshots }: { snapshots: SnapshotTimelineWorkspaceModel }) {
  return (
    <Panel title="Snapshot Timeline Workspace" eyebrow="State snapshots">
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Snapshots" value={snapshots.snapshots.length} />
        <Metric label="Diffs" value={snapshots.diffs.length} />
        <Metric label="Transition events" value={snapshots.transitionHistory?.transitionEvents.length ?? 0} />
      </div>
      <div className="mt-4 space-y-2">
        {snapshots.snapshotHashes.length ? snapshots.snapshotHashes.map(snapshot => (
          <div key={snapshot.snapshotId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"><div className="font-semibold text-white">{snapshot.snapshotId}</div><div className="break-all font-mono text-xs text-sky-300">{snapshot.snapshotHash}</div></div>
          </div>
        )) : <EmptyState>No persistent snapshot set is loaded.</EmptyState>}
      </div>
      <DeterministicNotes notes={snapshots.deterministicNotes} />
    </Panel>
  );
}

export function DependencyGraphViewer({ graph }: { graph: DependencyGraphViewerModel }) {
  const nodes = graph.nodes.slice(0, 36);
  const width = 920;
  const height = Math.max(320, Math.ceil(nodes.length / 4) * 96);
  const positioned = nodes.map((node, index) => ({ ...node, x: 80 + (index % 4) * 220, y: 60 + Math.floor(index / 4) * 92 }));
  return (
    <Panel title="Dependency Graph Viewer" eyebrow="Graph">
      <div className="overflow-auto rounded-xl border border-white/10 bg-black/30 p-4">
        <svg width={width} height={height} role="img" aria-label="Deterministic engineering dependency graph preview">
          {graph.edges.slice(0, 60).map(edge => {
            const source = positioned.find(node => node.nodeId === edge.sourceNodeId);
            const target = positioned.find(node => node.nodeId === edge.targetNodeId);
            if (!source || !target) return null;
            return <line key={edge.edgeId} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="rgba(56,189,248,0.35)" strokeWidth="1" />;
          })}
          {positioned.map(node => (
            <g key={node.nodeId} transform={`translate(${node.x},${node.y})`}>
              <rect x="-58" y="-24" width="116" height="48" rx="12" fill="rgba(15,23,42,0.95)" stroke="rgba(148,163,184,0.35)" />
              <text x="0" y="-3" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">{node.label.slice(0, 18)}</text>
              <text x="0" y="13" textAnchor="middle" fill="rgb(125,211,252)" fontSize="8">{node.nodeType}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><Metric label="Graph nodes" value={graph.nodes.length} /><Metric label="Graph edges" value={graph.edges.length} /></div>
      <DeterministicNotes notes={graph.deterministicNotes} />
    </Panel>
  );
}

export function RegenerationPlanningWorkspace({ planning }: { planning: RegenerationPlanningWorkspaceModel }) {
  return (
    <Panel title="Regeneration Planning Workspace" eyebrow="Plan visualization">
      <div className="grid gap-3 md:grid-cols-4"><Metric label="Plans" value={planning.plans.length} /><Metric label="Candidates" value={planning.regenerationCandidates.length} /><Metric label="Blocked deps" value={planning.blockedDependencies.length} /><Metric label="Preserved" value={planning.preservedOutputIds.length} /></div>
      <div className="mt-4 grid gap-4 md:grid-cols-2"><ListBox title="Regeneration order" values={planning.regenerationOrder} /><ListBox title="Blocked dependencies" values={planning.blockedDependencies} /><ListBox title="Preserved outputs" values={planning.preservedOutputIds} /><ListBox title="Candidates" values={planning.regenerationCandidates} /></div>
      <DeterministicNotes notes={planning.deterministicNotes} />
    </Panel>
  );
}

export function AuditGuardWorkspace({ audit }: { audit: AuditGuardWorkspaceModel }) {
  return (
    <Panel title="Audit Guard Workspace" eyebrow="Guards">
      <div className="grid gap-3 md:grid-cols-5"><Metric label="All guards" value={audit.guards.length} /><Metric label="Topology" value={audit.topologyViolations.length} /><Metric label="Provenance" value={audit.provenanceFailures.length} /><Metric label="Orphans" value={audit.orphanedNodeFailures.length} /><Metric label="Stale lineage" value={audit.staleLineageFailures.length} /></div>
      <div className="mt-4 space-y-2">
        {audit.guards.length ? audit.guards.map(guard => (
          <div key={guard.guardCode} className="rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs">
            <div className="flex items-center justify-between gap-3"><span className="font-mono text-white">{guard.guardCode}</span><StatusPill value={guard.passed ? 'current' : 'blocked'} /></div>
            <p className="mt-2 text-slate-400">{guard.message}</p>
          </div>
        )) : <EmptyState>No audit guard result set is loaded.</EmptyState>}
      </div>
      <DeterministicNotes notes={audit.deterministicNotes} />
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div><div className="mt-2 text-2xl font-black text-white">{value}</div></div>;
}

function ListBox({ title, values }: { title: string; values: string[] }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4"><div className="mb-3 text-sm font-bold text-white">{title}</div><TokenList values={values} limit={12} /></div>;
}

function DeterministicNotes({ notes }: { notes: string[] }) {
  return <div className="mt-4 rounded-xl border border-sky-500/15 bg-sky-500/5 p-4 text-xs leading-5 text-sky-100/80">{notes.map(note => <div key={note}>• {note}</div>)}</div>;
}
