import Link from 'next/link';
import type {
  AuditGuardWorkspaceModel,
  CanonicalEvidenceWorkspaceGroupModel,
  DecisionWorkspaceItemModel,
  AffectedOutputsWorkspaceModel,
  DependencyGraphViewerModel,
  DependencyTraversalWorkspaceModel,
  EngineeringHealthDashboardModel,
  EngineeringIntelligenceRouteSummary,
  EngineeringIntelligenceWorkspaceModel,
  InvalidationPropagationWorkspaceModel,
  RegenerationPlanningV1WorkspaceModel,
  RegenerationPlanningWorkspaceModel,
  RequirementWorkspaceItemModel,
  SnapshotDeltaWorkspaceModel,
  SnapshotTimelineWorkspaceModel,
  StaleInvalidationWorkspaceModel,
  StaleStateTimelineWorkspaceModel,
} from '@/lib/engineeringIntelligence';
import type { HydratedProjectEngineeringState } from '@/lib/engineeringIntelligence/projectHydration';
import type { CADReadinessMetadataModel } from '@/lib/engineeringIntelligence/cadReadiness';
import type { DeterministicPhotoGroupingModel } from '@/lib/engineeringIntelligence/photoGrouping';
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

type WorkspaceRenderable = unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Map) && !(value instanceof Set);
}

function safeRenderValue(value: WorkspaceRenderable, fallback = 'not_loaded'): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.length ? value : fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value.toISOString();
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort().slice(0, 5);
    return keys.length ? `object(keys=${keys.join('|')}${Object.keys(value).length > keys.length ? '|…' : ''})` : 'object(empty)';
  }
  return fallback;
}

function renderMetadataValue(value: WorkspaceRenderable, fallback = 'not_loaded'): string {
  return safeRenderValue(value, fallback);
}

function normalizeWorkspaceDisplay(value: WorkspaceRenderable): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(item => renderMetadataValue(item));
  if (value instanceof Set) return Array.from(value).map(item => renderMetadataValue(item));
  if (value instanceof Map) return Array.from(value.entries()).map(([key, item]) => `${renderMetadataValue(key)}:${renderMetadataValue(item)}`);
  return [renderMetadataValue(value)];
}

function workspaceKey(prefix: string, value: WorkspaceRenderable, index: number): string {
  return `${prefix}:${index}:${safeRenderValue(value, 'empty')}`;
}

function safeArray<T>(value: T[] | readonly T[] | null | undefined): T[];
function safeArray<T = unknown>(value: unknown): T[];
function safeArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function collectionSize(value: unknown): number {
  if (Array.isArray(value) || typeof value === 'string') return value.length;
  if (value instanceof Map || value instanceof Set) return value.size;
  return 0;
}

function summarizeContinuityChain(chain: unknown): string {
  if (!isRecord(chain)) return renderMetadataValue(chain);
  return `${renderMetadataValue(chain.chainId, 'chain')}:${renderMetadataValue(chain.sequenceStart, '?')}-${renderMetadataValue(chain.sequenceEnd, '?')}:${renderMetadataValue(chain.continuityConfidence, 'unknown')}`;
}

function summarizeSequenceBreakpoint(point: unknown): string {
  if (!isRecord(point)) return renderMetadataValue(point);
  return `${renderMetadataValue(point.breakpointId, 'breakpoint')}:${renderMetadataValue(point.reason, 'reason_not_loaded')}`;
}

function summarizeMetadataCompleteness(score: unknown): string {
  if (!isRecord(score)) return renderMetadataValue(score);
  const missing = normalizeWorkspaceDisplay(score.missingFields).join('|') || 'none';
  return `${renderMetadataValue(score.evidenceId, 'evidence')}:${renderMetadataValue(score.score, 'score_not_loaded')}:missing=${missing}`;
}

function summarizeSnapshotHash(snapshot: unknown): string {
  if (!isRecord(snapshot)) return renderMetadataValue(snapshot);
  return `${renderMetadataValue(snapshot.snapshotId, 'snapshot')}:${renderMetadataValue(snapshot.snapshotHash, 'hash_not_loaded')}`;
}

function summarizeTransitionEvent(event: unknown): string {
  if (!isRecord(event)) return renderMetadataValue(event);
  return `${renderMetadataValue(event.eventType, 'event')}:${renderMetadataValue(event.transitionEventId, 'transition_not_loaded')}`;
}

function summarizeDiffEntry(entry: unknown): string {
  if (!isRecord(entry)) return renderMetadataValue(entry);
  return `${renderMetadataValue(entry.diffType, 'diff')}:${renderMetadataValue(entry.stateId, 'state_not_loaded')}`;
}

function metadataCompletenessLabel(entry: unknown): string {
  if (!isRecord(entry)) return renderMetadataValue(entry);
  return `${renderMetadataValue(entry.field, 'field')}:${entry.present ? 'present' : 'missing'}`;
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
            <h1 className="text-3xl font-black tracking-tight text-white">{safeRenderValue(title, 'Engineering Intelligence')}</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">{safeRenderValue(subtitle)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs text-slate-300 lg:w-80">
            <div className="font-semibold text-white">Workspace source</div>
            <div className="mt-2 font-mono text-sky-300">{safeRenderValue(model.generatedFrom)}</div>
            <div className="mt-1">Project: {safeRenderValue(model.projectId, 'not selected')}</div>
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
              <div className="text-sm font-bold text-white">{safeRenderValue(route.label)}</div>
              <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">{stateLabel}</span>
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-400">{safeRenderValue(route.deterministicPurpose)}</div>
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
        <Metric label="Selectable projects" value={collectionSize(projects)} />
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
      ) : collectionSize(projects) === 0 ? (
        <div className="mt-4"><EmptyState state="no_projects">No real projects are available for selection. Create or load a project first; Engineering Intelligence will not synthesize a project route.</EmptyState></div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {projects.map(project => (
            <Link key={project.id} href={`/admin/engineering-intelligence/project/${project.id}`}
              className="rounded-xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-sky-400/40 hover:bg-sky-400/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-white">{safeRenderValue(project.name)}</h3>
                  <div className="mt-1 break-all font-mono text-[10px] text-sky-300">{safeRenderValue(project.id)}</div>
                </div>
                <StatusPill value={project.status ?? 'not_loaded'} />
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
                <div>System: {safeRenderValue(project.systemType)}</div>
                <div>Size: {project.systemSizeKw ? `${project.systemSizeKw} kW` : 'not_loaded'}</div>
                <div>Updated: {project.updatedAt ? new Date(project.updatedAt).toLocaleString() : 'not_loaded'}</div>
                <div>Evidence route: real project UUID</div>
              </div>
              <div className="mt-3 text-xs text-slate-500">{safeRenderValue(project.address, 'No project address stored.')}</div>
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
        {eyebrow && <div className="mb-1 text-[10px] font-black uppercase tracking-[0.24em] text-sky-300">{safeRenderValue(eyebrow)}</div>}
        <h2 className="text-lg font-black text-white">{safeRenderValue(title, 'Panel')}</h2>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children, state = 'not_loaded' }: { children: React.ReactNode; state?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-slate-400">
      <div className="mb-2 inline-flex rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 font-mono text-[10px] text-slate-300">{safeRenderValue(state)}</div>
      <div>{children}</div>
    </div>
  );
}

function StatusPill({ value }: { value: WorkspaceRenderable }) {
  const label = safeRenderValue(value);
  return <span className={cx('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', statusColor[label] ?? statusColor.not_loaded)}>{label}</span>;
}

function TokenList({ values, limit = 6 }: { values: WorkspaceRenderable; limit?: number }) {
  const normalized = normalizeWorkspaceDisplay(values).filter(Boolean);
  if (!normalized.length) return <span className="text-slate-500">none</span>;
  const visible = normalized.slice(0, limit);
  const remaining = normalized.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((value, index) => <span key={workspaceKey('token', value, index)} className="rounded-md bg-white/5 px-2 py-1 font-mono text-[10px] text-slate-300">{value}</span>)}
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
        <Metric label="Snapshots" value={collectionSize(hydration.snapshots)} />
        <Metric label="Regeneration plans" value={collectionSize(hydration.regenerationPlans)} />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-300">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Canonical survey</div>
          <div className="mt-2 break-all font-mono text-sky-300">{safeRenderValue(hydration.canonicalSurveyId)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-300">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Invalidation event</div>
          <div className="mt-2 break-all font-mono text-orange-300">{safeRenderValue(hydration.invalidationResult?.resultId)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-300">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">State graph</div>
          <div className="mt-2 break-all font-mono text-violet-300">{safeRenderValue(hydration.stateGraph?.graphId)}</div>
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
        <Metric label="Ready flags" value={collectionSize(readiness.readyFlags)} />
        <Metric label="Partial flags" value={collectionSize(readiness.partialFlags)} />
        <Metric label="Blocked flags" value={collectionSize(readiness.blockedFlags)} />
        <Metric label="Runtime CAD" value="disabled" />
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {safeArray(readiness.flags).map(flag => (
          <div key={flag.flagId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-xs">
            <div className="flex items-center justify-between gap-3"><span className="font-mono text-white">{safeRenderValue(flag.flagId)}</span><StatusPill value={flag.status} /></div>
            <p className="mt-2 leading-5 text-slate-400">{safeRenderValue(flag.deterministicReason)}</p>
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


export function PhotoGroupingWorkspace({ grouping }: { grouping: DeterministicPhotoGroupingModel }) {
  return (
    <Panel title="Deterministic Photo Grouping + Survey Sequence" eyebrow="Metadata-only grouping">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Traversal rows" value={collectionSize(grouping.surveyTraversalOrder)} />
        <Metric label="Segments" value={collectionSize(grouping.surveyTraversalSegments)} />
        <Metric label="Clusters" value={collectionSize(grouping.evidenceClusters)} />
        <Metric label="Sequence breaks" value={collectionSize(grouping.sequenceBreakpoints)} />
      </div>
      {grouping.source === 'not_loaded' ? (
        <div className="mt-4"><EmptyState state="not_loaded">No canonical manifest metadata was loaded, so traversal order, photo continuity, evidence clusters, and grouped readiness are not fabricated.</EmptyState></div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Metric label="Roof-side groups" value={collectionSize(grouping.roofSideCandidateGroups)} />
            <Metric label="Utility groups" value={collectionSize(grouping.utilityEvidenceGroups)} />
            <Metric label="Electrical groups" value={collectionSize(grouping.electricalEvidenceGroups)} />
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-slate-400">
                <tr><th className="p-3">Order</th><th className="p-3">Evidence</th><th className="p-3">Category</th><th className="p-3">Timestamp</th><th className="p-3">Metadata</th></tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {safeArray(grouping.surveyTraversalOrder).slice(0, 40).map(item => (
                  <tr key={item.evidenceId} className="align-top">
                    <td className="p-3 font-mono text-sky-300">{safeRenderValue(item.sequenceIndex)}</td>
                    <td className="p-3"><div className="break-all font-mono text-white">{safeRenderValue(item.evidenceId)}</div><div className="mt-1 break-all text-slate-500">{safeRenderValue(item.filename, 'no_filename')}</div></td>
                    <td className="p-3"><div className="font-mono text-slate-200">{safeRenderValue(item.category)}</div><div className="mt-1 text-slate-500">submitted: {safeRenderValue(item.submittedCategory)}</div></td>
                    <td className="p-3 text-slate-400"><div>capture: {safeRenderValue(item.captureTimestamp)}</div><div>upload: {safeRenderValue(item.uploadTimestamp)}</div></td>
                    <td className="p-3 text-slate-400"><div>score: {safeRenderValue(item.metadataCompletenessScore)}</div><div>{safeRenderValue(item.widthPx, 'w?')}×{safeRenderValue(item.heightPx, 'h?')} · {safeRenderValue(item.orientation, 'orientation?')}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-white">Movement segments</h3>
          {safeArray(grouping.surveyTraversalSegments).length ? safeArray(grouping.surveyTraversalSegments).map(segment => (
            <div key={segment.segmentId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-xs">
              <div className="flex items-center justify-between gap-3"><span className="font-mono text-white">{safeRenderValue(segment.segmentId)}</span><StatusPill value={segment.continuityConfidence} /></div>
              <p className="mt-2 text-slate-400">{safeRenderValue(segment.probableMovementContext)}</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <LineageBox title="Evidence chain" values={segment.evidenceIds} />
                <LineageBox title="Categories" values={segment.dominantCategories} />
                <LineageBox title="Boundary reasons" values={segment.clusterBoundaryReasons} />
                <LineageBox title="Transition reasons" values={segment.clusterTransitionReasons} />
              </div>
            </div>
          )) : <EmptyState state="no_segments">No movement segments were derived.</EmptyState>}
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-white">Evidence clusters</h3>
          {safeArray(grouping.evidenceClusters).length ? safeArray(grouping.evidenceClusters).map(cluster => (
            <div key={cluster.clusterId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-xs">
              <div className="flex items-center justify-between gap-3"><span className="font-mono text-white">{safeRenderValue(cluster.clusterId)}</span><StatusPill value={cluster.clusterConfidence} /></div>
              <div className="mt-1 text-sky-300">{safeRenderValue(cluster.label)} · sequence {safeRenderValue(cluster.sequenceStart)}-{safeRenderValue(cluster.sequenceEnd)}</div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <LineageBox title="Evidence ids" values={cluster.evidenceIds} />
                <LineageBox title="Readiness context" values={cluster.readinessPromotionContext} />
              </div>
            </div>
          )) : <EmptyState state="no_clusters">No evidence clusters were derived.</EmptyState>}
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ListBox title="Photo continuity chains" values={safeArray(grouping.photoContinuityChains).map(summarizeContinuityChain)} />
        <ListBox title="Sequence breakpoints" values={safeArray(grouping.sequenceBreakpoints).map(summarizeSequenceBreakpoint)} />
        <ListBox title="Detached structure groups" values={safeArray(grouping.detachedStructureGroups).map(group => isRecord(group) ? group.clusterId : group)} />
        <ListBox title="Ground/trench candidate groups" values={safeArray(grouping.groundMountCandidateGroups).map(group => isRecord(group) ? group.clusterId : group)} />
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {safeArray(grouping.groupedCADReadiness).map(context => (
          <div key={context.contextId} className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-xs">
            <div className="flex items-center justify-between gap-3"><span className="font-bold text-white">{safeRenderValue(context.label)}</span><StatusPill value={context.status} /></div>
            <p className="mt-2 text-slate-300">{safeRenderValue(context.deterministicReason)}</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <LineageBox title="Readiness flags" values={context.linkedReadinessFlagIds} />
              <LineageBox title="Supporting clusters" values={context.supportingClusterIds} />
              <LineageBox title="Blocking reasons" values={safeArray(context.blockingReasons).length ? context.blockingReasons : ['none']} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ListBox title="Metadata completeness scores" values={safeArray(grouping.metadataCompletenessScores).map(summarizeMetadataCompleteness)} />
        <ListBox title="Prohibited runtime behavior" values={grouping.prohibitedRuntimeBehavior} />
      </div>
      <DeterministicNotes notes={grouping.deterministicNotes} />
    </Panel>
  );
}

export function FieldEvidenceOrchestrationWorkspace({ orchestration }: { orchestration: FieldEvidenceOrchestrationModel }) {
  return (
    <Panel title="Field Evidence Orchestration" eyebrow="Technician movement order">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Workflow steps" value={collectionSize(orchestration.steps)} />
        <Metric label="Canonical groups" value={collectionSize(orchestration.groups)} />
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
                <td className="p-3"><TokenList values={safeArray(step.captureItems).map(item => isRecord(item) ? item.canonicalCategory : item)} limit={10} /></td>
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
          <div key={safeRenderValue(label)} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{safeRenderValue(label)}</div>
            <div className="mt-2 text-3xl font-black text-white">{safeRenderValue(value)}</div>
            <div className="mt-1 text-xs text-slate-400">{safeRenderValue(sub)}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">Evidence completeness: <span className="font-mono text-sky-300">{safeRenderValue(health.evidenceCompleteness)}</span></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">Requirement satisfaction: <span className="font-mono text-sky-300">{safeRenderValue(health.requirementSatisfaction)}</span></div>
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
                <h3 className="font-bold text-white">{safeRenderValue(group.label)}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-400">{safeRenderValue(group.description)}</p>
              </div>
              <span className="rounded-full bg-sky-400/10 px-2 py-1 text-[10px] font-bold text-sky-300">{safeArray(group.canonicalEvidenceItems).length} rows</span>
            </div>
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="font-bold uppercase tracking-wide text-slate-500">Linked requirements</div>
                <TokenList values={group.requirementIds} />
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="font-bold uppercase tracking-wide text-slate-500">Missing / insufficient</div>
                <TokenList values={collectionSize(group.missingRequirementIds) ? group.missingRequirementIds : ['none']} />
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Deterministic field-quality signals</div>
              <TokenList values={collectionSize(group.fieldQualitySignals) ? group.fieldQualitySignals : ['no group-level quality warnings']} limit={10} />
            </div>
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-violet-300">CAD readiness flags from real evidence</div>
              {collectionSize(group.readinessFlags) ? (
                <div className="mt-2 space-y-2">
                  {group.readinessFlags.map(flag => (
                    <div key={flag.flagId} className="rounded-md border border-white/10 bg-black/20 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2"><span className="font-mono text-white">{safeRenderValue(flag.flagId)}</span><StatusPill value={flag.status} /></div>
                      <div className="mt-1 text-slate-400">{flag.deterministicReason}</div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState state="not_loaded">No CAD-readiness metadata is linked to this group.</EmptyState>}
            </div>
            <div className="mt-4 space-y-3">
              {collectionSize(group.canonicalEvidenceItems) ? group.canonicalEvidenceItems.map(item => (
                <div key={item.canonicalEvidenceId} className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="break-all font-mono text-xs text-white">{safeRenderValue(item.canonicalEvidenceId)}</div>
                      <div className="mt-1 text-xs text-sky-300">{item.evidenceCategoryLabel} · {safeRenderValue(item.category)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2"><StatusPill value={item.status} /><StatusPill value={item.readinessImpact} /></div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
                    <div>Representative: <span className="font-mono text-slate-200">{safeRenderValue(item.canonicalRepresentativeStatus)}</span></div>
                    <div>Duplicate group size: <span className="text-slate-200">{safeRenderValue(item.duplicateCollapseCount)}</span></div>
                    <div>Confidence: <span className="text-slate-200">{safeRenderValue(item.evidenceConfidence)}</span></div>
                    <div>Evidence source: <span className="text-slate-200">{safeRenderValue(item.evidenceSource)}</span></div>
                    <div>Truth source: <span className="text-slate-200">{safeRenderValue(item.evidenceTruthSource)}</span></div>
                    <div>Origin timestamps: <span className="text-slate-200">{normalizeWorkspaceDisplay(item.originatingSurveyCreatedAts).filter(Boolean).join(', ') || 'not_loaded'}</span></div>
                  </div>
                  <p className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-300">{safeRenderValue(item.canonicalSelectionReason)}</p>
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
                        {safeArray(item.metadataCompleteness).length ? safeArray(item.metadataCompleteness).map((entry, index) => <span key={workspaceKey('metadata-completeness', isRecord(entry) ? entry.field : entry, index)} className={`rounded-full px-2 py-1 text-[10px] ${entry.present ? 'bg-emerald-500/10 text-emerald-300' : 'bg-orange-500/10 text-orange-300'}`}>{metadataCompletenessLabel(entry)}</span>) : <span className="text-xs text-slate-500">not_loaded</span>}
                      </div>
                    </div>
                    <LineageBox title="Field-quality signals" values={collectionSize(item.fieldQualitySignals) ? item.fieldQualitySignals : ['no row-level quality warnings']} />
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

function LineageBox({ title, values }: { title: WorkspaceRenderable; values: WorkspaceRenderable }) {
  const normalized = normalizeWorkspaceDisplay(values);
  return <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3"><div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">{safeRenderValue(title, 'Metadata')}</div><TokenList values={normalized.length ? normalized : ['none']} limit={8} /></div>;
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
                <td className="p-3"><div className="font-semibold text-white">{safeRenderValue(req.label)}</div><div className="mt-1 text-slate-500">{safeRenderValue(req.requirementId)}</div><div className="mt-1 max-w-md text-slate-400">{safeRenderValue(req.description)}</div></td>
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
            <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-white">{safeRenderValue(decision.label)}</h3><div className="mt-1 font-mono text-[10px] text-slate-500">{safeRenderValue(decision.decisionType)}</div></div><StatusPill value={safeArray(decision.fallbackDefaultChain).length ? 'partial' : 'not_loaded'} /></div>
            <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2"><div>Category: {safeRenderValue(decision.category)}</div><div>Domain: {safeRenderValue(decision.domain)}</div></div>
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
        <Metric label="Stale outputs" value={collectionSize(stale.staleOutputIds)} />
        <Metric label="Invalidation chains" value={collectionSize(stale.invalidationChains)} />
        <Metric label="Preserved outputs" value={collectionSize(stale.preservedOutputIds)} />
        <Metric label="Regeneration scope" value={collectionSize(stale.regenerationScopeIds)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ListBox title="Current stale outputs" values={stale.staleOutputIds} />
        <ListBox title="Preserved outputs" values={stale.preservedOutputIds} />
        <ListBox title="Regeneration candidates" values={stale.regenerationScopeIds} />
        <ListBox title="No autonomous action" values={['metadata visualization only', 'operator-controlled regeneration required']} />
      </div>
      <div className="mt-4 space-y-3">
        {safeArray(stale.invalidationChains).length ? safeArray(stale.invalidationChains).map(chain => (
          <div key={chain.eventId} className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 text-xs">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="font-mono text-orange-300">{safeRenderValue(chain.eventId)}</div>
              <StatusPill value="stale" />
            </div>
            <div className="mt-1 break-all text-white">Impacted state: {safeRenderValue(chain.stateId)}</div>
            <p className="mt-2 text-slate-400">{safeRenderValue(chain.reason)}</p>
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
        <Metric label="Snapshots" value={collectionSize(snapshots.snapshots)} />
        <Metric label="Diffs" value={collectionSize(snapshots.diffs)} />
        <Metric label="Transition events" value={collectionSize(snapshots.transitionHistory?.transitionEvents)} />
        <Metric label="Latest" value={snapshots.latestSnapshotId ? 'loaded' : 'no_snapshot'} />
      </div>
      <div className="mt-4 space-y-3">
        {safeArray(snapshots.snapshots).length ? safeArray(snapshots.snapshots).map(snapshot => (
          <div key={snapshot.snapshotId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="font-semibold text-white">{safeRenderValue(snapshot.snapshotId)}</div>
                <div className="mt-1 text-xs text-slate-400">Generated: {safeRenderValue(snapshot.generatedAt)}</div>
                <div className="mt-1 text-xs text-slate-500">Previous: {safeRenderValue(snapshot.previousSnapshotId, 'none')} · Superseded by: {safeRenderValue(snapshot.supersededBySnapshotId, 'none')}</div>
              </div>
              <div className="break-all font-mono text-xs text-sky-300">{safeRenderValue(snapshot.snapshotHash)}</div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Metric label="State refs" value={collectionSize(snapshot.stateRefs)} />
              <Metric label="Valid" value={collectionSize(snapshot.validStateIds)} />
              <Metric label="Stale" value={collectionSize(snapshot.staleStateIds)} />
              <Metric label="Transitions" value={collectionSize(snapshot.transitionEventIds)} />
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
        <ListBox title="Snapshot hashes" values={safeArray(snapshots.snapshotHashes).map(summarizeSnapshotHash)} />
        <ListBox title="Timeline transitions" values={safeArray(snapshots.transitionHistory?.transitionEvents).map(summarizeTransitionEvent)} />
        <ListBox title="Diff entries" values={safeArray(snapshots.diffs).flatMap(diff => isRecord(diff) ? safeArray(diff.entries).map(summarizeDiffEntry) : [renderMetadataValue(diff)])} />
        <ListBox title="Timeline stale states" values={snapshots.timeline?.staleStateIds ?? []} />
      </div>
      <DeterministicNotes notes={snapshots.deterministicNotes} />
    </Panel>
  );
}

export function DependencyGraphViewer({ graph }: { graph: DependencyGraphViewerModel }) {
  const nodes = safeArray(graph.nodes).slice(0, 36);
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
          {safeArray(graph.edges).slice(0, 60).map(edge => {
            const source = positioned.find(node => node.nodeId === edge.sourceNodeId);
            const target = positioned.find(node => node.nodeId === edge.targetNodeId);
            if (!source || !target) return null;
            return <line key={edge.edgeId} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="rgba(56,189,248,0.35)" strokeWidth="1" />;
          })}
          {positioned.map(node => (
            <g key={node.nodeId} transform={`translate(${node.x},${node.y})`}>
              <rect x="-64" y="-28" width="128" height="56" rx="12" fill={node.status === 'stale' || node.status === 'invalidated' ? 'rgba(124,45,18,0.95)' : 'rgba(15,23,42,0.95)'} stroke={node.status === 'not_loaded' ? 'rgba(148,163,184,0.45)' : node.status === 'current' ? 'rgba(56,189,248,0.45)' : 'rgba(251,146,60,0.6)'} />
              <text x="0" y="-3" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">{safeRenderValue(node.label).slice(0, 18)}</text>
              <text x="0" y="11" textAnchor="middle" fill="rgb(125,211,252)" fontSize="8">{safeRenderValue(node.nodeType)}</text>
              <text x="0" y="23" textAnchor="middle" fill="rgb(148,163,184)" fontSize="7">{safeRenderValue(node.status)}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><Metric label="Graph nodes" value={collectionSize(graph.nodes)} /><Metric label="Graph edges" value={collectionSize(graph.edges)} /></div>
      <DeterministicNotes notes={graph.deterministicNotes} />
    </Panel>
  );
}

export function RegenerationPlanningWorkspace({ planning }: { planning: RegenerationPlanningWorkspaceModel }) {
  return (
    <Panel title="Regeneration Planning Workspace" eyebrow="Plan visualization">
      <div className="grid gap-3 md:grid-cols-4"><Metric label="Plans" value={collectionSize(planning.plans)} /><Metric label="Candidates" value={collectionSize(planning.regenerationCandidates)} /><Metric label="Blocked deps" value={collectionSize(planning.blockedDependencies)} /><Metric label="Preserved" value={collectionSize(planning.preservedOutputIds)} /></div>
      <div className="mt-4 grid gap-4 md:grid-cols-2"><ListBox title="Regeneration order" values={planning.regenerationOrder} /><ListBox title="Blocked dependencies" values={planning.blockedDependencies} /><ListBox title="Preserved outputs" values={planning.preservedOutputIds} /><ListBox title="Candidates" values={planning.regenerationCandidates} /></div>
      <DeterministicNotes notes={planning.deterministicNotes} />
    </Panel>
  );
}

export function InvalidationPropagationWorkspace({ model }: { model: InvalidationPropagationWorkspaceModel }) {
  return (
    <Panel title="Invalidation Propagation Workspace" eyebrow="Propagation V1">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Sources" value={collectionSize(model.invalidationSources)} />
        <Metric label="Impacted outputs" value={collectionSize(model.impactedOutputs)} />
        <Metric label="Propagation paths" value={collectionSize(model.dependencyTraversalPaths)} />
        <Metric label="Cycle detected" value={model.propagation?.cycleProtection.cycleDetected ?? 'not_loaded'} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ListBox title="Invalidation sources" values={model.invalidationSources} />
        <ListBox title="Impacted outputs" values={model.impactedOutputs} />
        <ListBox title="Impacted document sections" values={model.impactedDocumentSections} />
        <ListBox title="Impacted render contexts" values={model.impactedRenderContexts} />
        <ListBox title="Impacted snapshots" values={model.impactedSnapshots} />
        <ListBox title="Cycle protection" values={model.cycleProtectionIndicators} />
      </div>
      <div className="mt-4"><ListBox title="Dependency traversal paths" values={model.dependencyTraversalPaths} /></div>
      <DeterministicNotes notes={model.deterministicNotes} />
    </Panel>
  );
}

export function DependencyTraversalWorkspace({ model }: { model: DependencyTraversalWorkspaceModel }) {
  return (
    <Panel title="Dependency Traversal Workspace" eyebrow="Traversal V1">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Visited nodes" value={collectionSize(model.traversal?.visitedNodeIds)} />
        <Metric label="Impacted nodes" value={collectionSize(model.traversal?.impactedNodeIds)} />
        <Metric label="Missing nodes" value={collectionSize(model.missingNodeIds)} />
        <Metric label="Suppressed duplicate edges" value={collectionSize(model.duplicateEdgeIdsSuppressed)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ListBox title="Downstream lineage" values={model.downstreamLineage} />
        <ListBox title="Propagation depth" values={model.propagationDepths} />
        <ListBox title="Missing nodes" values={model.missingNodeIds} />
        <ListBox title="Duplicate edges suppressed" values={model.duplicateEdgeIdsSuppressed} />
        <ListBox title="Cycle protection" values={model.cycleProtectionIndicators} />
        <ListBox title="Traversal seeds" values={model.traversal?.seedNodeIds ?? []} />
      </div>
      <DeterministicNotes notes={model.deterministicNotes} />
    </Panel>
  );
}

export function RegenerationPlanningV1Workspace({ model }: { model: RegenerationPlanningV1WorkspaceModel }) {
  return (
    <Panel title="Regeneration Planning V1 Workspace" eyebrow="No regeneration executed">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Would regenerate" value={collectionSize(model.wouldRegenerate)} />
        <Metric label="Missing evidence" value={collectionSize(model.missingEvidence)} />
        <Metric label="Dependency chains" value={collectionSize(model.dependencyChains)} />
        <Metric label="Plan loaded" value={model.plan ? 'loaded' : 'not_loaded'} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ListBox title="Would need regeneration/review" values={model.wouldRegenerate} />
        <ListBox title="Why" values={model.whyRegenerate} />
        <ListBox title="Upstream triggers" values={model.upstreamTriggers} />
        <ListBox title="Impacted outputs" values={model.impactedOutputs} />
        <ListBox title="Missing evidence" values={model.missingEvidence} />
        <ListBox title="Dependency chains" values={model.dependencyChains} />
      </div>
      <DeterministicNotes notes={model.deterministicNotes} />
    </Panel>
  );
}

export function SnapshotDeltaWorkspace({ model }: { model: SnapshotDeltaWorkspaceModel }) {
  return (
    <Panel title="Snapshot Delta Workspace" eyebrow="Delta V1">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Delta entries" value={collectionSize(model.delta?.entries)} />
        <Metric label="Stale introduced" value={collectionSize(model.staleOutputsIntroduced)} />
        <Metric label="Graph delta" value={collectionSize(model.dependencyGraphDelta)} />
        <Metric label="CAD readiness changes" value={collectionSize(model.changedCADReadiness)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ListBox title="Added evidence" values={model.addedEvidence} />
        <ListBox title="Removed evidence" values={model.removedEvidence} />
        <ListBox title="Changed decisions" values={model.changedDecisions} />
        <ListBox title="Stale outputs introduced" values={model.staleOutputsIntroduced} />
        <ListBox title="Regenerated candidates" values={model.regeneratedCandidates} />
        <ListBox title="Invalidation causes" values={model.invalidationCauses} />
        <ListBox title="Changed CAD readiness" values={model.changedCADReadiness} />
        <ListBox title="Dependency graph delta" values={model.dependencyGraphDelta} />
      </div>
      <DeterministicNotes notes={model.deterministicNotes} />
    </Panel>
  );
}

export function AffectedOutputsWorkspace({ model }: { model: AffectedOutputsWorkspaceModel }) {
  return (
    <Panel title="Affected Outputs Workspace" eyebrow="Output impact V1">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Outputs" value={collectionSize(model.outputs)} />
        <Metric label="Document sections" value={collectionSize(model.documentSections)} />
        <Metric label="Render contexts" value={collectionSize(model.renderContexts)} />
        <Metric label="Review required" value={collectionSize(model.reviewRequired)} />
      </div>
      <div className="mt-4 space-y-3">
        {safeArray(model.outputs).length ? safeArray(model.outputs).slice(0, 24).map(output => (
          <div key={output.impactId} className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 text-xs">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"><div className="break-all font-mono text-white">{safeRenderValue(output.outputId)}</div><StatusPill value={output.staleClass} /></div>
            <p className="mt-2 text-slate-300">{safeRenderValue(output.deterministicReason)}</p>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <LineageBox title="Document sections" values={output.affectedDocumentSectionIds} />
              <LineageBox title="Render contexts" values={output.affectedRenderContextIds} />
              <LineageBox title="Snapshots" values={output.affectedSnapshotIds} />
              <LineageBox title="Decisions" values={output.invalidatedDecisionIds} />
              <LineageBox title="Missing evidence" values={output.missingEvidenceIds} />
              <LineageBox title="Propagation paths" values={output.propagationPathIds} />
            </div>
          </div>
        )) : <EmptyState state="no_affected_outputs">No V1 affected-output metadata is loaded.</EmptyState>}
      </div>
      <DeterministicNotes notes={model.deterministicNotes} />
    </Panel>
  );
}

export function StaleStateTimelineWorkspace({ model }: { model: StaleStateTimelineWorkspaceModel }) {
  return (
    <Panel title="Stale State Timeline" eyebrow="Timeline V1">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Events" value={collectionSize(model.events)} />
        <Metric label="Stale states" value={collectionSize(model.staleStateIds)} />
        <Metric label="Transitions" value={collectionSize(model.transitionEventIds)} />
        <Metric label="Mode" value="metadata_only" />
      </div>
      <div className="mt-4 space-y-3">
        {safeArray(model.events).length ? safeArray(model.events).slice(0, 24).map(event => (
          <div key={event.eventId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-xs">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"><div className="break-all font-mono text-white">{safeRenderValue(event.eventId)}</div><StatusPill value={event.staleClass} /></div>
            <div className="mt-1 text-sky-300">Snapshot: {safeRenderValue(event.snapshotId)}</div>
            <p className="mt-2 text-slate-300">{safeRenderValue(event.deterministicReason)}</p>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <LineageBox title="States" values={event.stateIds} />
              <LineageBox title="Dependencies" values={event.dependencyNodeIds} />
              <LineageBox title="Evidence" values={event.canonicalEvidenceIds} />
              <LineageBox title="Requirements" values={event.requirementIds} />
              <LineageBox title="Decisions" values={event.decisionIds} />
            </div>
          </div>
        )) : <EmptyState state="no_timeline_events">No transition events are loaded.</EmptyState>}
      </div>
      <DeterministicNotes notes={model.deterministicNotes} />
    </Panel>
  );
}

export function AuditGuardWorkspace({ audit }: { audit: AuditGuardWorkspaceModel }) {
  return (
    <Panel title="Audit Guard Workspace" eyebrow="Guards">
      <div className="grid gap-3 md:grid-cols-5"><Metric label="All guards" value={collectionSize(audit.guards)} /><Metric label="Topology" value={collectionSize(audit.topologyViolations)} /><Metric label="Provenance" value={collectionSize(audit.provenanceFailures)} /><Metric label="Orphans" value={collectionSize(audit.orphanedNodeFailures)} /><Metric label="Stale lineage" value={collectionSize(audit.staleLineageFailures)} /></div>
      <div className="mt-4 space-y-2">
        {safeArray(audit.guards).length ? safeArray(audit.guards).map(guard => (
          <div key={guard.guardCode} className="rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs">
            <div className="flex items-center justify-between gap-3"><span className="font-mono text-white">{safeRenderValue(guard.guardCode)}</span><StatusPill value={guard.passed ? 'current' : 'blocked'} /></div>
            <p className="mt-2 text-slate-400">{safeRenderValue(guard.message)}</p>
          </div>
        )) : <EmptyState state="not_loaded">No audit guard result set is loaded.</EmptyState>}
      </div>
      <DeterministicNotes notes={audit.deterministicNotes} />
    </Panel>
  );
}

function Metric({ label, value }: { label: WorkspaceRenderable; value: WorkspaceRenderable }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{safeRenderValue(label, 'Metric')}</div><div className="mt-2 text-2xl font-black text-white">{safeRenderValue(value)}</div></div>;
}

function ListBox({ title, values }: { title: WorkspaceRenderable; values: WorkspaceRenderable }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4"><div className="mb-3 text-sm font-bold text-white">{safeRenderValue(title, 'Metadata')}</div><TokenList values={values} limit={12} /></div>;
}

function DeterministicNotes({ notes }: { notes: WorkspaceRenderable }) {
  const normalized = normalizeWorkspaceDisplay(notes);
  return <div className="mt-4 rounded-xl border border-sky-500/15 bg-sky-500/5 p-4 text-xs leading-5 text-sky-100/80">{(normalized.length ? normalized : ['not_loaded']).map((note, index) => <div key={workspaceKey('note', note, index)}>• {note}</div>)}</div>;
}
