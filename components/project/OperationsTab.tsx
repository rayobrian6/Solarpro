'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Section } from '@/components/ui/Section';
import { Card } from '@/components/ui/Card';
import { Grid } from '@/components/ui/Grid';
import {
  CheckCircle, Circle, Clock, Calendar, Users, DollarSign,
  ChevronRight, AlertTriangle, Flag, Loader2
} from 'lucide-react';
import InstallPhotosSection from '@/components/project/InstallPhotosSection';
import MonitoringLinkEditor from '@/components/project/MonitoringLinkEditor';
import {
  PROJECT_PIPELINE,
  STAGE_LABELS,
  STAGE_COLORS,
  KANBAN_STAGES,
  nextStage,
  type PipelineStage,
  type ProjectTask,
  type ProjectMilestone,
} from '@/lib/operations/pipeline';
import { safeArray, safeNum, safeStr } from '@/lib/utils/safeArray';

interface OperationsTabProps {
  projectId: string;
  onStatusChange?: () => void;
}

interface OpsData {
  project_status: string;
  contract_signed_at: string | null;
  install_date: string | null;
  estimated_completion: string | null;
  actual_completion: string | null;
  crew_assigned: string | null;
  labor_hours: number;
  labor_cost: number;
  material_cost: number;
}

const DEFAULT_OPS: OpsData = {
  project_status: 'lead',
  contract_signed_at: null,
  install_date: null,
  estimated_completion: null,
  actual_completion: null,
  crew_assigned: null,
  labor_hours: 0,
  labor_cost: 0,
  material_cost: 0,
};

/** Safely parse OpsData from any API response shape */
function parseOps(raw: any): OpsData {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_OPS };
  return {
    project_status: safeStr(raw.project_status, 'lead'),
    contract_signed_at: raw.contract_signed_at ?? null,
    install_date: raw.install_date ?? null,
    estimated_completion: raw.estimated_completion ?? null,
    actual_completion: raw.actual_completion ?? null,
    crew_assigned: raw.crew_assigned ?? null,
    labor_hours: safeNum(raw.labor_hours),
    labor_cost: safeNum(raw.labor_cost),
    material_cost: safeNum(raw.material_cost),
  };
}

export default function OperationsTab({ projectId, onStatusChange }: OperationsTabProps) {
  const [ops, setOps] = useState<OpsData>(DEFAULT_OPS);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  // ——— Fetch all operations data ——————————————————————————————————
  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [opsRes, tasksRes, msRes] = await Promise.allSettled([
        fetch(`/api/projects/${projectId}/operations`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/projects/${projectId}/tasks`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/projects/${projectId}/milestones`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      // Parse operations — { success, data: { operations } }
      const opsJson = opsRes.status === 'fulfilled' ? opsRes.value : null;
      setOps(parseOps(opsJson?.data?.operations ?? opsJson?.operations ?? null));

      // Parse tasks — { success, data: { tasks } }
      const tasksJson = tasksRes.status === 'fulfilled' ? tasksRes.value : null;
      const rawTasks = tasksJson?.data?.tasks ?? tasksJson?.tasks ?? [];
      setTasks(safeArray<ProjectTask>(rawTasks));

      // Parse milestones — { success, data: { milestones } }
      const msJson = msRes.status === 'fulfilled' ? msRes.value : null;
      const rawMs = msJson?.data?.milestones ?? msJson?.milestones ?? [];
      setMilestones(safeArray<ProjectMilestone>(rawMs));

    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load operations data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) fetchAll();
  }, [fetchAll, projectId]);

  // ——— Status Change ——————————————————————————————————————————————
  async function handleStatusChange(newStatus: string) {
    try {
      setStatusUpdating(true);
      setError(null);
      const res = await fetch('/api/projects/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, status: newStatus }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || 'Failed to update status');
      }
      await fetchAll();
      onStatusChange?.();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Status update failed');
    } finally {
      setStatusUpdating(false);
    }
  }

  // ——— Task Toggle ————————————————————————————————————————————————
  async function toggleTask(taskId: string, currentStatus: string) {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    try {
      setError(null);
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, status: newStatus }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || 'Failed to update task');
      }
      const json = await res.json();
      const rawTasks = json?.data?.tasks ?? json?.tasks ?? [];
      setTasks(safeArray<ProjectTask>(rawTasks));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Task update failed');
    }
  }

  // ——— Save Operations Fields ————————————————————————————————————
  async function saveField(field: string, value: any) {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/projects/${projectId}/operations`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || 'Failed to save');
      }
      const json = await res.json();
      setOps(parseOps(json?.data?.operations ?? json?.operations ?? null));
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ——— Create Default Milestones ——————————————————————————————————
  async function createDefaultMilestones() {
    try {
      setError(null);
      const defaults = ['Permit Submitted', 'Inspection Date', 'PTO Submitted'];
      const currentNames = milestones.map(m => safeStr(m?.name));
      for (const name of defaults) {
        if (!currentNames.includes(name)) {
          await fetch(`/api/projects/${projectId}/milestones`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          }).catch(() => {}); // Non-fatal per-milestone
        }
      }
      await fetchAll();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to create milestones');
    }
  }

  // ——— Toggle Milestone ——————————————————————————————————————————
  async function toggleMilestone(milestoneId: string, currentStatus: string) {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    try {
      setError(null);
      await fetch(`/api/projects/${projectId}/milestones`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ milestoneId, status: newStatus }),
      });
      await fetchAll();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Milestone update failed');
    }
  }

  // ——— Computed values ————————————————————————————————————————————
  const currentStage = (ops.project_status || 'lead') as PipelineStage;
  const safeTasks = safeArray<ProjectTask>(tasks);
  const totalTasks = safeTasks.length;
  const completedTasks = safeTasks.filter(t => t?.status === 'completed').length;
  const taskPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Group tasks by stage
  const tasksByStage: Record<string, ProjectTask[]> = {};
  safeTasks.forEach(t => {
    if (!t) return;
    const key = safeStr(t.stage, 'general');
    if (!tasksByStage[key]) tasksByStage[key] = [];
    tasksByStage[key].push(t);
  });

  // Suggest next stage
  const currentStageTasks = safeTasks.filter(t => t?.stage === currentStage);
  const currentStageComplete =
    currentStageTasks.length > 0 &&
    currentStageTasks.every(t => t?.status === 'completed');
  const suggested = nextStage(currentStage);

  const safeMilestones = safeArray<ProjectMilestone>(milestones);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2" style={{ color: 'var(--text-muted)' }}>
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Loading operations...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Card variant="danger" padding="sm">
          <div className="flex items-center gap-2 text-xs">
            <AlertTriangle size={12} />
            {error}
            <button onClick={() => setError(null)} className="ml-auto underline text-[10px]">
              dismiss
            </button>
          </div>
        </Card>
      ) : null}

      {/* ——— A. Status Dropdown ————————————————————————————————— */}
      <Section title="Pipeline Status" subtitle="Current stage in the project lifecycle">
        <Card variant="ghost" padding="md">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${STAGE_COLORS[currentStage] || 'bg-slate-500'}`} />
              <select
                value={currentStage}
                onChange={e => handleStatusChange(e.target.value)}
                disabled={statusUpdating}
                className="text-sm font-semibold rounded px-3 py-1.5 border"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
              >
                {PROJECT_PIPELINE.map(s => (
                  <option key={s} value={s}>{STAGE_LABELS[s] || s}</option>
                ))}
              </select>
              {statusUpdating ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} /> : null}
            </div>

            {/* Next stage suggestion */}
            {currentStageComplete && suggested ? (
              <button
                onClick={() => handleStatusChange(suggested)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{
                  background: 'var(--accent-color)',
                  color: '#fff',
                }}
              >
                <ChevronRight size={12} />
                Advance to {STAGE_LABELS[suggested] || suggested}
              </button>
            ) : null}
          </div>

          {/* Pipeline progress bar */}
          <div className="mt-4 flex items-center gap-0.5">
            {PROJECT_PIPELINE.map((s, i) => {
              const currentIdx = PROJECT_PIPELINE.indexOf(currentStage);
              const isPast = i < currentIdx;
              const isCurrent = i === currentIdx;
              return (
                <div
                  key={s}
                  className="flex-1 h-1.5 rounded-full transition-colors"
                  style={{
                    background: isPast
                      ? 'var(--accent-color)'
                      : isCurrent
                        ? 'var(--accent-color)'
                        : 'var(--border-color)',
                    opacity: isPast ? 0.5 : isCurrent ? 1 : 0.3,
                  }}
                  title={STAGE_LABELS[s] || s}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>Lead</span>
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>Complete</span>
          </div>
        </Card>
      </Section>

      {/* ——— B. Task Checklist ————————————————————————————————— */}
      <Section
        title="Task Checklist"
        subtitle={totalTasks > 0 ? `${completedTasks}/${totalTasks} complete (${taskPercent}%)` : 'No tasks yet'}
        action={
          totalTasks > 0 ? (
            <div className="flex items-center gap-2">
              <div
                className="w-24 h-2 rounded-full overflow-hidden"
                style={{ background: 'var(--border-color)' }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${taskPercent}%`,
                    background: taskPercent === 100 ? '#22c55e' : 'var(--accent-color)',
                  }}
                />
              </div>
              <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                {taskPercent}%
              </span>
            </div>
          ) : undefined
        }
      >
        {totalTasks === 0 ? (
          <Card variant="ghost" padding="md">
            <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
              Tasks are auto-generated when you advance the pipeline stage.
              Change the status above to generate tasks.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {Object.entries(tasksByStage).map(([stage, stageTasks]) => {
              const safeStage = safeArray<ProjectTask>(stageTasks);
              if (safeStage.length === 0) return null;
              return (
                <Card key={stage} variant="ghost" padding="sm">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${STAGE_COLORS[stage as PipelineStage] || 'bg-slate-500'}`}
                    />
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      {STAGE_LABELS[stage as PipelineStage] || stage}
                    </span>
                    <span className="text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>
                      {safeStage.filter(t => t?.status === 'completed').length}/{safeStage.length}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {safeStage.map(task => {
                      if (!task?.id) return null;
                      return (
                        <label
                          key={task.id}
                          className="flex items-center gap-2.5 py-1.5 px-2 rounded cursor-pointer transition-colors hover:bg-white/5"
                        >
                          <button
                            onClick={() => toggleTask(task.id, safeStr(task.status))}
                            className="flex-shrink-0"
                          >
                            {task.status === 'completed' ? (
                              <CheckCircle size={15} className="text-green-500" />
                            ) : (
                              <Circle size={15} style={{ color: 'var(--text-muted)' }} />
                            )}
                          </button>
                          <span
                            className={`text-xs ${task.status === 'completed' ? 'line-through' : ''}`}
                            style={{ color: task.status === 'completed' ? 'var(--text-muted)' : 'var(--text-primary)' }}
                          >
                            {safeStr(task.title, 'Untitled task')}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {/* ——— C. Scheduling ————————————————————————————————————— */}
      <Section title="Scheduling" subtitle="Install date and crew assignment">
        <Grid cols={1} colsMd={2} gap="sm">
          <Card variant="ghost" padding="sm">
            <label className="block space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
                <Calendar size={10} className="inline mr-1" />Install Date
              </span>
              <input
                type="date"
                defaultValue={ops.install_date?.split('T')[0] || ''}
                onBlur={e => saveField('install_date', e.target.value || null)}
                className="w-full text-sm rounded px-3 py-1.5 border"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
              />
            </label>
          </Card>

          <Card variant="ghost" padding="sm">
            <label className="block space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
                <Users size={10} className="inline mr-1" />Crew Assigned
              </span>
              <input
                type="text"
                placeholder="e.g. Team Alpha"
                defaultValue={ops.crew_assigned || ''}
                onBlur={e => saveField('crew_assigned', e.target.value || null)}
                className="w-full text-sm rounded px-3 py-1.5 border"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
              />
            </label>
          </Card>
        </Grid>
      </Section>

      {/* ——— D. Milestones ————————————————————————————————————— */}
      <Section
        title="Milestones"
        subtitle="Key project dates"
        action={
          safeMilestones.length === 0 ? (
            <button
              onClick={createDefaultMilestones}
              className="text-[10px] font-medium px-3 py-1 rounded"
              style={{ background: 'var(--accent-color)', color: '#fff' }}
            >
              + Create Defaults
            </button>
          ) : undefined
        }
      >
        {safeMilestones.length === 0 ? (
          <Card variant="ghost" padding="md">
            <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
              No milestones yet. Click "Create Defaults" to add standard milestones.
            </p>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {safeMilestones.map(ms => {
              if (!ms?.id) return null;
              return (
                <Card key={ms.id} variant="ghost" padding="sm">
                  <div className="flex items-center gap-3">
                    <button onClick={() => toggleMilestone(ms.id, safeStr(ms.status))} className="flex-shrink-0">
                      {ms.status === 'completed' ? (
                        <CheckCircle size={15} className="text-green-500" />
                      ) : (
                        <Flag size={15} style={{ color: 'var(--text-muted)' }} />
                      )}
                    </button>
                    <span
                      className={`text-xs flex-1 ${ms.status === 'completed' ? 'line-through' : ''}`}
                      style={{ color: ms.status === 'completed' ? 'var(--text-muted)' : 'var(--text-primary)' }}
                    >
                      {safeStr(ms.name, 'Untitled milestone')}
                    </span>
                    {ms.due_date ? (
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {(() => {
                          try { return new Date(ms.due_date).toLocaleDateString(); }
                          catch { return '—'; }
                        })()}
                      </span>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {/* ——— E. Cost Tracking ————————————————————————————————— */}
      <Section title="Cost Tracking" subtitle="Labor and material costs">
        <Grid cols={1} colsMd={3} gap="sm">
          <Card variant="ghost" padding="sm">
            <label className="block space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
                <Clock size={10} className="inline mr-1" />Labor Hours
              </span>
              <input
                type="number"
                step="0.5"
                min="0"
                defaultValue={safeNum(ops.labor_hours)}
                onBlur={e => saveField('labor_hours', e.target.value)}
                className="w-full text-sm rounded px-3 py-1.5 border"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
              />
            </label>
          </Card>

          <Card variant="ghost" padding="sm">
            <label className="block space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
                <DollarSign size={10} className="inline mr-1" />Labor Cost ($)
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                defaultValue={safeNum(ops.labor_cost)}
                onBlur={e => saveField('labor_cost', e.target.value)}
                className="w-full text-sm rounded px-3 py-1.5 border"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
              />
            </label>
          </Card>

          <Card variant="ghost" padding="sm">
            <label className="block space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
                <DollarSign size={10} className="inline mr-1" />Material Cost ($)
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                defaultValue={safeNum(ops.material_cost)}
                onBlur={e => saveField('material_cost', e.target.value)}
                className="w-full text-sm rounded px-3 py-1.5 border"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                }}
              />
            </label>
          </Card>
        </Grid>

        {/* Total */}
        {(safeNum(ops.labor_cost) > 0 || safeNum(ops.material_cost) > 0) ? (
          <Card variant="highlight" padding="sm" className="mt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Total Project Cost
              </span>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                ${(safeNum(ops.labor_cost) + safeNum(ops.material_cost)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </Card>
        ) : null}
      </Section>

      {/* ——— F. Install Photos ————————————————————————————————— */}
      <InstallPhotosSection projectId={projectId} />

      {/* ——— G. Monitoring Link ——————————————————————————————————————————— */}
      <Section title="Monitoring">
        <MonitoringLinkEditor projectId={projectId} />
      </Section>

      {/* ——— Save indicator ———————————————————————————————————— */}
      {saving ? (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
          style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
          <Loader2 size={12} className="animate-spin" />
          Saving...
        </div>
      ) : null}
    </div>
  );
}