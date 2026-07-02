'use client';

import { FormEvent, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ClipboardList, Loader2, Play, Shield, XCircle } from 'lucide-react';
import type { ProducerMetadata, ProducerName } from '@/lib/intelligence/registry';

type EntityType = 'contractor' | 'client' | 'project' | 'opportunity' | 'ahj' | 'utility' | 'user';

type ObservationPreview = {
  entity_type: string;
  entity_id: string;
  observation_type: string;
  confidence: number;
  observed_at: string;
  idempotency_key: string;
};

type ValidationFailure = {
  producer_name?: string;
  entity_type?: string | null;
  entity_id?: string | null;
  observation_type?: string | null;
  idempotency_key?: string | null;
  errors?: string[];
};

type ProducerFailure = {
  producer_name?: string;
  message?: string;
};

type RunnerSummary = {
  run_id: string;
  dry_run: boolean;
  started_at?: string;
  finished_at?: string;
  duration_ms: number;
  replay_boundary?: string;
  producers_requested?: string[];
  producers_executed: string[];
  observations_generated: number;
  observations_validated?: number;
  observations_written: number;
  observations_skipped: number;
  idempotent_collisions: number;
  validation_failures: ValidationFailure[];
  producer_failures: ProducerFailure[];
  write_failures: string[];
};

type RunnerResponse = {
  success?: boolean;
  dry_run?: boolean;
  error?: string;
  details?: unknown;
  summary?: RunnerSummary;
  observations_preview?: ObservationPreview[];
};

type ScopeState = {
  entity_type: '' | EntityType;
  entity_id: string;
  opportunity_id: string;
  project_id: string;
  source_event_id: string;
  window_start: string;
  window_end: string;
  preview_limit: number;
};

const ENTITY_TYPES: EntityType[] = ['opportunity', 'project', 'contractor', 'client', 'ahj', 'utility', 'user'];
const MAX_WINDOW_DAYS = 31;

function daysBetween(start: string, end: string): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return (endMs - startMs) / 86_400_000;
}

function safeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function MetricCard({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'good' | 'warn' | 'danger' }) {
  const toneClass = {
    default: 'border-slate-700/70 bg-slate-900/60 text-white',
    good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    danger: 'border-red-500/30 bg-red-500/10 text-red-200',
  }[tone];

  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-black tabular-nums">{value}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{children}</label>;
}

export default function IntelligenceRunnerPanel({
  producers,
  adminRole,
  isSuperAdmin,
}: {
  producers: ProducerMetadata[];
  adminRole: 'admin' | 'super_admin';
  isSuperAdmin: boolean;
}) {
  const [selected, setSelected] = useState<ProducerName[]>([]);
  const [scope, setScope] = useState<ScopeState>({
    entity_type: '',
    entity_id: '',
    opportunity_id: '',
    project_id: '',
    source_event_id: '',
    window_start: '',
    window_end: '',
    preview_limit: 10,
  });
  const [dryRunState, setDryRunState] = useState(true);
  const dryRun = isSuperAdmin ? dryRunState : true;
  const [running, setRunning] = useState(false);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [result, setResult] = useState<RunnerResponse | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const validationError = useMemo(() => {
    if (selected.length === 0) return 'Select at least one producer.';

    const hasEntityScope = Boolean(scope.entity_type && scope.entity_id.trim());
    const hasDirectScope = Boolean(scope.opportunity_id.trim() || scope.project_id.trim() || scope.source_event_id.trim());
    const hasAnyWindowValue = Boolean(scope.window_start || scope.window_end);
    const hasCompleteWindow = Boolean(scope.window_start && scope.window_end);

    if (hasAnyWindowValue && !hasCompleteWindow) return 'Replay window requires both start and end timestamps.';

    if (hasCompleteWindow) {
      const days = daysBetween(scope.window_start, scope.window_end);
      if (days === null) return 'Replay window timestamps are invalid.';
      if (days < 0) return 'Replay window end must be after start.';
      if (days > MAX_WINDOW_DAYS) return `Replay window cannot exceed ${MAX_WINDOW_DAYS} days.`;
    }

    if (!hasEntityScope && !hasDirectScope && !hasCompleteWindow) {
      return 'Bounded scope is required before execution.';
    }

    if (!dryRun && !isSuperAdmin) return 'Write mode is restricted to super_admin.';

    return null;
  }, [dryRun, isSuperAdmin, scope, selected.length]);

  const canSubmit = !running && !validationError;

  function updateScope<K extends keyof ScopeState>(key: K, value: ScopeState[K]) {
    setScope(prev => ({ ...prev, [key]: value }));
  }

  function toggleProducer(name: ProducerName) {
    setSelected(prev => prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]);
  }

  function buildPayload() {
    const payload: Record<string, unknown> = {
      producer_names: selected,
      dry_run: dryRun,
      preview_limit: Math.max(0, Math.min(50, Number(scope.preview_limit) || 10)),
    };

    if (scope.entity_type && scope.entity_id.trim()) {
      payload.entity_type = scope.entity_type;
      payload.entity_id = scope.entity_id.trim();
    }
    if (scope.opportunity_id.trim()) payload.opportunity_id = scope.opportunity_id.trim();
    if (scope.project_id.trim()) payload.project_id = scope.project_id.trim();
    if (scope.source_event_id.trim()) payload.source_event_id = scope.source_event_id.trim();
    if (scope.window_start && scope.window_end) {
      payload.window = {
        start: new Date(scope.window_start).toISOString(),
        end: new Date(scope.window_end).toISOString(),
      };
    }

    return payload;
  }

  async function executeRun() {
    if (!canSubmit) return;
    setRunning(true);
    setClientError(null);
    setResult(null);

    try {
      const response = await fetch('/api/admin/network/intelligence/runner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const data = await response.json() as RunnerResponse;
      setResult(data);
      if (!response.ok) {
        setClientError(data.error || 'Intelligence runner request failed.');
      }
    } catch (err: unknown) {
      setClientError((err as Error).message || 'Network request failed.');
    } finally {
      setRunning(false);
      setConfirmWrite(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running) return;
    if (validationError) {
      setClientError(validationError);
      return;
    }
    if (!dryRun) {
      setConfirmWrite(true);
      return;
    }
    void executeRun();
  }

  const summary = result?.summary;
  const preview = result?.observations_preview ?? [];
  const hasFailures = Boolean(
    clientError ||
    result?.error ||
    (summary && (summary.validation_failures.length || summary.producer_failures.length || summary.write_failures.length))
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10">
              <ClipboardList className="h-5 w-5 text-blue-300" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">Intelligence Runner</h1>
              <p className="mt-1 text-sm text-slate-400">Hidden operational execution panel for controlled observation-only producer validation.</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-xs text-slate-400">
          <div className="font-semibold uppercase tracking-[0.16em] text-slate-500">Access</div>
          <div className="mt-1 text-white">{adminRole}</div>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
        <div className="flex gap-3">
          <Shield className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            This panel calls the existing admin runner endpoint only. Dry-run is the default. Runs must be bounded by entity, opportunity, project, source event, or a replay window of {MAX_WINDOW_DAYS} days or less.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">Producer Selection</h2>
              <p className="mt-1 text-xs text-slate-500">Select one or more canonical observation producers.</p>
            </div>
            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{selected.length} selected</span>
          </div>

          <div className="space-y-3">
            {producers.map(producer => {
              const checked = selected.includes(producer.name);
              return (
                <label
                  key={producer.name}
                  className={`block cursor-pointer rounded-xl border p-4 transition ${checked ? 'border-blue-400/50 bg-blue-500/10' : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProducer(producer.name)}
                      className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-white">{producer.name}</span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{producer.version}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{producer.description}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {producer.supported_entity_types.map(entity => (
                          <span key={entity} className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] text-slate-300">{entity}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
            <h2 className="text-sm font-bold text-white">Bounded Replay Scope</h2>
            <p className="mt-1 text-xs text-slate-500">At least one bounded scope is required. Unbounded execution is blocked in the UI and by the endpoint.</p>

            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <FieldLabel>Entity type</FieldLabel>
                  <select
                    value={scope.entity_type}
                    onChange={event => updateScope('entity_type', event.target.value as ScopeState['entity_type'])}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                  >
                    <option value="">None</option>
                    {ENTITY_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <FieldLabel>Entity id</FieldLabel>
                  <input
                    value={scope.entity_id}
                    onChange={event => updateScope('entity_id', event.target.value)}
                    placeholder="UUID or canonical id"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-blue-400"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <FieldLabel>Opportunity id</FieldLabel>
                <input value={scope.opportunity_id} onChange={event => updateScope('opportunity_id', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-blue-400" placeholder="network_opportunities.id" />
              </div>
              <div className="space-y-2">
                <FieldLabel>Project id</FieldLabel>
                <input value={scope.project_id} onChange={event => updateScope('project_id', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-blue-400" placeholder="projects.id" />
              </div>
              <div className="space-y-2">
                <FieldLabel>Source event id</FieldLabel>
                <input value={scope.source_event_id} onChange={event => updateScope('source_event_id', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-blue-400" placeholder="Optional replay source event" />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-300" />
                  Replay window maximum: {MAX_WINDOW_DAYS} days.
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel>Start</FieldLabel>
                    <input type="datetime-local" value={scope.window_start} onChange={event => updateScope('window_start', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400" />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>End</FieldLabel>
                    <input type="datetime-local" value={scope.window_end} onChange={event => updateScope('window_end', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400" />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <FieldLabel>Preview limit</FieldLabel>
                <input type="number" min={0} max={50} value={scope.preview_limit} onChange={event => updateScope('preview_limit', Number(event.target.value))} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-400" />
              </div>
            </div>
          </div>

          <div className={`rounded-2xl border p-5 ${dryRun ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
            <h2 className="text-sm font-bold text-white">Execution Mode</h2>
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={dryRun}
                disabled={!isSuperAdmin}
                onChange={event => setDryRunState(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500 disabled:opacity-60"
              />
              <span>
                <span className="block text-sm font-semibold text-white">Dry-run only</span>
                <span className="mt-1 block text-xs leading-5 text-slate-400">Default mode. Generates and previews observations without writing.{!isSuperAdmin ? ' Locked for admin role.' : ' Clear only when an approved write-mode run is required.'}</span>
              </span>
            </label>

            {isSuperAdmin ? (
              !dryRun && (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-200">
                  Write mode is enabled. This may append observations through the existing runner endpoint. It does not mutate lifecycle state or projections.
                </div>
              )
            ) : (
              <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400">Write mode is hidden for non-super_admin users.</div>
            )}

            {validationError ? <div className="mt-4 text-xs text-amber-300">{validationError}</div> : null}

            <button
              type="submit"
              disabled={!canSubmit}
              className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${dryRun ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-red-500 text-white hover:bg-red-400'}`}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? 'Running producers...' : 'Run Producers'}
            </button>
          </div>
        </section>
      </form>

      {summary ? (
        <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
          <div className="mb-4 flex items-center gap-2">
            {result?.success ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <AlertTriangle className="h-5 w-5 text-amber-400" />}
            <h2 className="text-sm font-bold text-white">Execution Summary</h2>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 text-xs text-slate-400 md:grid-cols-2">
            <div><span className="text-slate-500">run_id:</span> <span className="font-mono text-slate-200">{summary.run_id}</span></div>
            <div><span className="text-slate-500">dry_run:</span> <span className="font-mono text-slate-200">{String(summary.dry_run)}</span></div>
            {summary.replay_boundary ? <div className="md:col-span-2"><span className="text-slate-500">replay_boundary:</span> <span className="font-mono text-slate-200 break-all">{summary.replay_boundary}</span></div> : null}
            <div><span className="text-slate-500">producers executed:</span> <span className="font-mono text-slate-200">{summary.producers_executed.join(', ') || 'none'}</span></div>
            <div><span className="text-slate-500">duration:</span> <span className="font-mono text-slate-200">{summary.duration_ms}ms</span></div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <MetricCard label="Generated" value={summary.observations_generated} />
            <MetricCard label="Written" value={summary.observations_written} tone={summary.observations_written > 0 ? 'good' : 'default'} />
            <MetricCard label="Skipped" value={summary.observations_skipped} tone={summary.observations_skipped > 0 ? 'warn' : 'default'} />
            <MetricCard label="Collisions" value={summary.idempotent_collisions} tone={summary.idempotent_collisions > 0 ? 'warn' : 'default'} />
            <MetricCard label="Validation" value={summary.validation_failures.length} tone={summary.validation_failures.length > 0 ? 'danger' : 'default'} />
            <MetricCard label="Failures" value={summary.producer_failures.length + summary.write_failures.length} tone={summary.producer_failures.length + summary.write_failures.length > 0 ? 'danger' : 'default'} />
          </div>
        </section>
      ) : null}

      {preview.length > 0 ? (
        <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
          <h2 className="text-sm font-bold text-white">Observation Preview</h2>
          <p className="mt-1 text-xs text-slate-500">Bounded preview rows returned by the runner endpoint. Raw payloads are intentionally not dumped here.</p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
            <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Entity</th>
                  <th className="px-3 py-2 font-semibold">Observation</th>
                  <th className="px-3 py-2 font-semibold">Confidence</th>
                  <th className="px-3 py-2 font-semibold">Observed at</th>
                  <th className="px-3 py-2 font-semibold">Idempotency key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {preview.map(row => (
                  <tr key={row.idempotency_key} className="text-slate-300">
                    <td className="px-3 py-2"><span className="font-mono">{row.entity_type}</span><div className="font-mono text-[10px] text-slate-500">{row.entity_id}</div></td>
                    <td className="px-3 py-2 font-mono">{row.observation_type}</td>
                    <td className="px-3 py-2 font-mono">{row.confidence}</td>
                    <td className="px-3 py-2 font-mono">{row.observed_at}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{row.idempotency_key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {hasFailures ? (
        <section className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5">
          <div className="mb-3 flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-300" />
            <h2 className="text-sm font-bold text-white">Validation / Failure Output</h2>
          </div>
          {clientError ? <p className="mb-3 text-sm text-red-200">{clientError}</p> : null}
          {result?.error ? <p className="mb-3 text-sm text-red-200">{result.error}</p> : null}
          {summary?.validation_failures.map((failure, index) => (
            <div key={`validation-${index}`} className="mb-2 rounded-lg border border-red-500/20 bg-slate-950/40 p-3 text-xs text-red-100">
              <div className="font-semibold">Validation failure: {safeText(failure.producer_name) || 'unknown producer'}</div>
              <div className="mt-1 text-red-200/80">{failure.errors?.join('; ') || 'Observation validation failed.'}</div>
            </div>
          ))}
          {summary?.producer_failures.map((failure, index) => (
            <div key={`producer-${index}`} className="mb-2 rounded-lg border border-red-500/20 bg-slate-950/40 p-3 text-xs text-red-100">
              <div className="font-semibold">Producer failure: {safeText(failure.producer_name) || 'unknown producer'}</div>
              <div className="mt-1 text-red-200/80">{safeText(failure.message) || 'Producer execution failed.'}</div>
            </div>
          ))}
          {summary?.write_failures.map((failure, index) => (
            <div key={`write-${index}`} className="mb-2 rounded-lg border border-red-500/20 bg-slate-950/40 p-3 text-xs text-red-100">
              <div className="font-semibold">Write failure</div>
              <div className="mt-1 text-red-200/80">{failure}</div>
            </div>
          ))}
        </section>
      ) : null}

      {confirmWrite ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-1 h-5 w-5 flex-shrink-0 text-red-300" />
              <div>
                <h2 className="text-lg font-black text-white">Confirm write-mode execution</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  This will call the existing runner endpoint with dry_run=false. It can append intelligence observations, but it must not mutate lifecycle state, projections, or canonical source-of-truth tables.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmWrite(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-900">Cancel</button>
              <button type="button" onClick={() => void executeRun()} disabled={running} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-bold text-white hover:bg-red-400 disabled:opacity-50">Confirm write run</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
