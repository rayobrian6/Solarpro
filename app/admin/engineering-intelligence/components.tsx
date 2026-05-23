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
import type { HydratedProjectEngineeringState } from '@/lib/engineeringIntelligence/projectHydration';
import type { CADReadinessMetadataModel } from '@/lib/engineeringIntelligence/cadReadiness';
import type { FieldEvidenceOrchestrationModel } from '@/lib/survey/evidence/fieldOrchestration';
import type { Project } from '@/types';

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
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  not_applicable: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
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
      {routes.map(route => {
        const isProjectRoute = route.href.includes('[id]');
        const href = isProjectRoute ? '/admin/engineering-intelligence' : route.href;
        const stateLabel = isProjectRoute ? 'select_real_project' : 'registered route';
        return (
          <Link key={route.routeId} href={href}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-sky-400/40 hover:bg-sky-400/10">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-bold text-white">{route.label}</div>
              <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">{stateLabel}</span>
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-400">{route.deterministicPurpose}</div>
            {isProjectRoute && <div className="mt-3 text-[10px] font-mono text-sky-300">Project route requires an actual project UUID selected below.</div>}
          </Link>
        );
      })}
    </div>
  );
}

export function ProjectIntelligencePicker({ projects, loadState }: { projects: Project[]; loadState: 'loaded' | 'unauthenticated' | 'load_error' }) {
  return (
    <Panel title="Project Intelligence Picker" eyebrow="Real project routing">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Route mode" value="real_uuid_only" />
        <Metric label="Selectable projects" value={projects.length} />
        <Metric label="Demo route" value="removed" />
        <Metric label="Load state" value={loadState} />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">
        Select an existing project to open live Engineering Intelligence hydration. Links are built only from real project records returned for the authenticated user; this workspace never falls back to a placeholder, demo, or fabricated project id.
      </p>
      {loadState === 'unauthenticated' ? (
        <div className="mt-4"><EmptyState state="not_authenticated">Project records were not loaded because no valid admin session user was available. No placeholder project intelligence route is rendered.</EmptyState></div>
      ) : loadState === 'load_error' ? (
        <div className="mt-4"><EmptyState state="project_list_load_error">Project records could not be loaded from the database. No placeholder project intelligence route is rendered.</EmptyState></div>
      ) : projects.length === 0 ? (
        <div className="mt-4"><EmptyState state="no_projects">No real projects are available for selection. Create or load a project first; Engineering Intelligence will not synthesize a project route.</EmptyState></div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {projects.map(project => (
            <Link key={project.id} href={`/admin/engineering-intelligence/project/${project.id}`}
              className="rounded-xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-sky-400/40 hover:bg-sky-400/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-white">{project.name}</h3>
                  <div className="mt-1 break-all font-mono text-[10px] text-sky-300">{project.id}</div>
                </div>
                <StatusPill value={project.status ?? 'not_loaded'} />
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
                <div>System: {project.systemType ?? 'not_loaded'}</div>
                <div>Size: {project.systemSizeKw ? `${project.systemSizeKw} kW` : 'not_loaded'}</div>
                <div>Updated: {project.updatedAt ? new Date(project.updatedAt).toLocaleString() : 'not_loaded'}</div>
                <div>Evidence route: real project UUID</div>
              </div>
              <div className="mt-3 text-xs text-slate-500">{project.address ?? 'No project address stored.'}</div>
            </Link>
          ))}
        </div>
      )}
      <DeterministicNotes notes={[
        'Project Intelligence links are emitted only from persisted project ids returned by getProjectsByUser.',
        'If no project list is available, the picker renders explicit no_projects/not_authenticated/load_error states instead of fake engineering state.',
        'Selecting a project only loads deterministic evidence, graph, snapshot, invalidation, regeneration-plan metadata, and CAD-readiness metadata; it does not run OCR, CV, CAD generation, or autonomous regeneration.',
      ]} />
    </Panel>
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

function EmptyState({ children, state = 'not_loaded' }: { children: React.ReactNode; state?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-slate-400">
      <div className="mb-2 inline-flex rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 font-mono text-[10px] text-slate-300">{state}</div>
      <div>{children}</div>
    </div>
  );
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


export function ProjectHydrationSummary({ hydration }: { hydration: HydratedProjectEngineeringState }) {
  return (
    <Panel title="Live Project Engineering Hydration" eyebrow="Project state">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Hydration source" value={hydration.source} />
        <Metric label="Survey sessions" value={hydration.surveyCount} />
        <Metric label="Snapshots" value={hydration.snapshots.length} />
        <Metric label="Regeneration plans" value={hydration.regenerationPlans.length} />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-300">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Canonical survey</div>
          <div className="mt-2 break-all font-mono text-sky-300">{hydration.canonicalSurveyId ?? 'not_loaded'}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-300">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Invalidation event</div>
          <div className="mt-2 break-all font-mono text-orange-300">{hydration.invalidationResult?.resultId ?? 'not_loaded'}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-300">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">State graph</div>
          <div className="mt-2 break-all font-mono text-violet-300">{hydration.stateGraph?.graphId ?? 'not_loaded'}</div>
        </div>
      </div>
      {hydration.surveyEvidence ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Metric label="Canonical evidence" value={hydration.surveyEvidence.canonicalEvidenceCount} />
          <Metric label="Completeness" value={hydration.surveyEvidence.completeness} />
          <Metric label="Raw photo count" value={hydration.surveyEvidence.rawPhotoCount} />
        </div>
      ) : (
        <div className="mt-4"><EmptyState state="not_loaded">No project survey evidence was loaded; live panels remain explicit empty state.</EmptyState></div>
      )}
      <DeterministicNotes notes={hydration.deterministicNotes} />
    </Panel>
  );
}

export function CADReadinessWorkspace({ readiness }: { readiness: CADReadinessMetadataModel }) {
  return (
    <Panel title="CAD Readiness Metadata" eyebrow="Metadata only">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Ready flags" value={readiness.readyFlags.length} />
        <Metric label="Partial flags" value={readiness.partialFlags.length} />
        <Metric label="Blocked flags" value={readiness.blockedFlags.length} />
        <Metric label="Runtime CAD" value="disabled" />
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {readiness.flags.map(flag => (
          <div key={flag.flagId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-xs">
            <div className="flex items-center justify-between gap-3"><span className="font-mono text-white">{flag.flagId}</span><StatusPill value={flag.status} /></div>
            <p className="mt-2 leading-5 text-slate-400">{flag.deterministicReason}</p>
            <div className="mt-3 text-slate-500">Satisfied categories</div><TokenList values={flag.satisfiedCategories} />
            <div className="mt-3 text-slate-500">Missing categories</div><TokenList values={flag.missingCategories} />
            <div className="mt-3 text-slate-500">Explicit survey signals</div><TokenList values={flag.explicitSurveySignals} />
          </div>
        ))}
      </div>
      <div className="mt-4"><ListBox title="Prohibited runtime behavior" values={readiness.prohibitedRuntimeBehavior} /></div>
      <DeterministicNotes notes={readiness.deterministicNotes} />
    </Panel>
  );
}

export function FieldEvidenceOrchestrationWorkspace({ orchestration }: { orchestration: FieldEvidenceOrchestrationModel }) {
  return (
    <Panel title="Field Evidence Orchestration" eyebrow="Technician movement order">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Workflow steps" value={orchestration.steps.length} />
        <Metric label="Canonical groups" value={orchestration.groups.length} />
        <Metric label="Capture items" value={orchestration.steps.reduce((sum, step) => sum + step.captureItems.length, 0)} />
        <Metric label="Movement logic" value="deterministic" />
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.04] text-slate-400">
            <tr><th className="p-3">Order</th><th className="p-3">Movement zone</th><th className="p-3">Group</th><th className="p-3">Instruction</th><th className="p-3">Capture categories</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {orchestration.steps.map(step => (
              <tr key={step.stepId} className="align-top">
                <td className="p-3 font-mono text-sky-300">{step.sequence}</td>
                <td className="p-3"><div className="font-semibold text-white">{step.label}</div><div className="mt-1 font-mono text-slate-500">{step.movementZone}</div></td>
                <td className="p-3 font-mono text-slate-300">{step.groupId}</td>
                <td className="p-3 max-w-md text-slate-400">{step.technicianInstruction}<div className="mt-2 text-slate-500">{step.minimizesBacktrackingBecause}</div></td>
                <td className="p-3"><TokenList values={step.captureItems.map(item => item.canonicalCategory)} limit={10} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {orchestration.groups.map(group => <ListBox key={group.groupId} title={group.label} values={group.canonicalCategories} />)}
      </div>
      <div className="mt-4"><ListBox title="Prohibited runtime behavior" values={orchestration.prohibitedRuntimeBehavior} /></div>
      <DeterministicNotes notes={orchestration.deterministicNotes} />
    </Panel>
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
              <span className="rounded-full bg-sky-400/10 px-2 py-1 text-[10px] font-bold text-sky-300">{group.canonicalEvidenceItems.length} rows</span>
            </div>
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="font-bold uppercase tracking-wide text-slate-500">Linked requirements</div>
                <TokenList values={group.requirementIds} />
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="font-bold uppercase tracking-wide text-slate-500">Missing / insufficient</div>
                <TokenList values={group.missingRequirementIds.length ? group.missingRequirementIds : ['none']} />
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Deterministic field-quality signals</div>
              <TokenList values={group.fieldQualitySignals.length ? group.fieldQualitySignals : ['no group-level quality warnings']} limit={10} />
            </div>
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-violet-300">CAD readiness flags from real evidence</div>
              {group.readinessFlags.length ? (
                <div className="mt-2 space-y-2">
                  {group.readinessFlags.map(flag => (
                    <div key={flag.flagId} className="rounded-md border border-white/10 bg-black/20 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2"><span className="font-mono text-white">{flag.flagId}</span><StatusPill value={flag.status} /></div>
                      <div className="mt-1 text-slate-400">{flag.deterministicReason}</div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState state="not_loaded">No CAD-readiness metadata is linked to this group.</EmptyState>}
            </div>
            <div className="mt-4 space-y-3">
              {group.canonicalEvidenceItems.length ? group.canonicalEvidenceItems.map(item => (
                <div key={item.canonicalEvidenceId} className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="break-all font-mono text-xs text-white">{item.canonicalEvidenceId}</div>
                      <div className="mt-1 text-xs text-sky-300">{item.evidenceCategoryLabel} · {item.category}</div>
                    </div>
                    <div className="flex flex-wrap gap-2"><StatusPill value={item.status} /><StatusPill value={item.readinessImpact} /></div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
                    <div>Representative: <span className="font-mono text-slate-200">{item.canonicalRepresentativeStatus}</span></div>
                    <div>Duplicate group size: <span className="text-slate-200">{item.duplicateCollapseCount}</span></div>
                    <div>Confidence: <span className="text-slate-200">{item.evidenceConfidence}</span></div>
                    <div>Evidence source: <span className="text-slate-200">{item.evidenceSource}</span></div>
                    <div>Truth source: <span className="text-slate-200">{item.evidenceTruthSource}</span></div>
                    <div>Origin timestamps: <span className="text-slate-200">{item.originatingSurveyCreatedAts.filter(Boolean).join(', ') || 'not_loaded'}</span></div>
                  </div>
                  <p className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-300">{item.canonicalSelectionReason}</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <LineageBox title="Origin surveys" values={item.originatingSurveyIds} />
                    <LineageBox title="Provenance / state refs" values={item.provenance} />
                    <LineageBox title="Requirements" values={item.linkedRequirementIds} />
                    <LineageBox title="Decisions" values={item.linkedDecisionIds} />
                    <LineageBox title="Outputs / document sections" values={[...item.linkedOutputIds, ...item.linkedDocumentSectionIds]} />
                    <LineageBox title="Graph nodes / edges" values={[...item.linkedGraphNodeIds, ...item.linkedGraphEdgeIds]} />
                    <LineageBox title="Stale impacts" values={[...item.staleStateImpactStateIds, ...item.staleImpactReasons]} />
                    <LineageBox title="Regeneration candidates" values={item.regenerationCandidateIds} />
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Metadata completeness</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.metadataCompleteness.length ? item.metadataCompleteness.map(entry => <span key={entry.field} className={`rounded-full px-2 py-1 text-[10px] ${entry.present ? 'bg-emerald-500/10 text-emerald-300' : 'bg-orange-500/10 text-orange-300'}`}>{entry.field}:{entry.present ? 'present' : 'missing'}</span>) : <span className="text-xs text-slate-500">not_loaded</span>}
                      </div>
                    </div>
                    <LineageBox title="Field-quality signals" values={item.fieldQualitySignals.length ? item.fieldQualitySignals : ['no row-level quality warnings']} />
                  </div>
                </div>
              )) : <EmptyState state="no_evidence">No canonical evidence rows are loaded for this group. Missing evidence is explicit; no MSP, attic, routing, trench, ESS, or detached-structure evidence is synthesized.</EmptyState>}
            </div>
            <DeterministicNotes notes={group.deterministicNotes} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function LineageBox({ title, values }: { title: string; values: string[] }) {
  return <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3"><div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">{title}</div><TokenList values={values.length ? values : ['none']} limit={8} /></div>;
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
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ListBox title="Current stale outputs" values={stale.staleOutputIds} />
        <ListBox title="Preserved outputs" values={stale.preservedOutputIds} />
        <ListBox title="Regeneration candidates" values={stale.regenerationScopeIds} />
        <ListBox title="No autonomous action" values={['metadata visualization only', 'operator-controlled regeneration required']} />
      </div>
      <div className="mt-4 space-y-3">
        {stale.invalidationChains.length ? stale.invalidationChains.map(chain => (
          <div key={chain.eventId} className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 text-xs">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="font-mono text-orange-300">{chain.eventId}</div>
              <StatusPill value="stale" />
            </div>
            <div className="mt-1 break-all text-white">Impacted state: {chain.stateId}</div>
            <p className="mt-2 text-slate-400">{chain.reason}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <LineageBox title="Triggering evidence" values={chain.triggeringEvidenceIds} />
              <LineageBox title="Triggering requirements" values={chain.triggeringRequirementIds} />
              <LineageBox title="Triggering decisions" values={chain.triggeringDecisionIds} />
              <LineageBox title="Downstream states" values={chain.downstreamStateIds} />
            </div>
          </div>
        )) : <EmptyState state="no_invalidation_history">No invalidation transition history is loaded.</EmptyState>}
      </div>
      <DeterministicNotes notes={stale.deterministicNotes} />
    </Panel>
  );
}

export function SnapshotTimelineWorkspace({ snapshots }: { snapshots: SnapshotTimelineWorkspaceModel }) {
  return (
    <Panel title="Snapshot Timeline Workspace" eyebrow="State snapshots">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Snapshots" value={snapshots.snapshots.length} />
        <Metric label="Diffs" value={snapshots.diffs.length} />
        <Metric label="Transition events" value={snapshots.transitionHistory?.transitionEvents.length ?? 0} />
        <Metric label="Latest" value={snapshots.latestSnapshotId ? 'loaded' : 'no_snapshot'} />
      </div>
      <div className="mt-4 space-y-3">
        {snapshots.snapshots.length ? snapshots.snapshots.map(snapshot => (
          <div key={snapshot.snapshotId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="font-semibold text-white">{snapshot.snapshotId}</div>
                <div className="mt-1 text-xs text-slate-400">Generated: {snapshot.generatedAt}</div>
                <div className="mt-1 text-xs text-slate-500">Previous: {snapshot.previousSnapshotId ?? 'none'} · Superseded by: {snapshot.supersededBySnapshotId ?? 'none'}</div>
              </div>
              <div className="break-all font-mono text-xs text-sky-300">{snapshot.snapshotHash}</div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Metric label="State refs" value={snapshot.stateRefs.length} />
              <Metric label="Valid" value={snapshot.validStateIds.length} />
              <Metric label="Stale" value={snapshot.staleStateIds.length} />
              <Metric label="Transitions" value={snapshot.transitionEventIds.length} />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <LineageBox title="Valid outputs" values={snapshot.validStateIds} />
              <LineageBox title="Stale outputs" values={snapshot.staleStateIds} />
              <LineageBox title="Transition lineage" values={snapshot.transitionEventIds} />
              <LineageBox title="Snapshot notes" values={snapshot.deterministicNotes} />
            </div>
          </div>
        )) : <EmptyState state="no_snapshot">No persistent snapshot set is loaded.</EmptyState>}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ListBox title="Snapshot hashes" values={snapshots.snapshotHashes.map(snapshot => `${snapshot.snapshotId}:${snapshot.snapshotHash}`)} />
        <ListBox title="Timeline transitions" values={snapshots.transitionHistory?.transitionEvents.map(event => `${event.eventType}:${event.transitionEventId}`) ?? []} />
        <ListBox title="Diff entries" values={snapshots.diffs.flatMap(diff => diff.entries.map(entry => `${entry.diffType}:${entry.stateId}`))} />
        <ListBox title="Timeline stale states" values={snapshots.timeline?.staleStateIds ?? []} />
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
      {graph.sourceGraph === null && (
        <div className="mb-4"><EmptyState state="no_graph">No persistent graph snapshot is loaded; graph preview is showing registry-visible requirement and decision nodes only.</EmptyState></div>
      )}
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
              <rect x="-64" y="-28" width="128" height="56" rx="12" fill={node.status === 'stale' || node.status === 'invalidated' ? 'rgba(124,45,18,0.95)' : 'rgba(15,23,42,0.95)'} stroke={node.status === 'not_loaded' ? 'rgba(148,163,184,0.45)' : node.status === 'current' ? 'rgba(56,189,248,0.45)' : 'rgba(251,146,60,0.6)'} />
              <text x="0" y="-3" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">{node.label.slice(0, 18)}</text>
              <text x="0" y="11" textAnchor="middle" fill="rgb(125,211,252)" fontSize="8">{node.nodeType}</text>
              <text x="0" y="23" textAnchor="middle" fill="rgb(148,163,184)" fontSize="7">{node.status}</text>
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
        )) : <EmptyState state="not_loaded">No audit guard result set is loaded.</EmptyState>}
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
