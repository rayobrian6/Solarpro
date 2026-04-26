'use client';
/**
 * components/deals/DealDecisionModal.tsx
 *
 * Compact quick-action modal for stage changes.
 * 4 options: next stage / keep / prev stage / choose manually.
 * Under 2 clicks total. No new pages, no large workflow UI.
 *
 * Props (unchanged — drop-in replacement):
 *   projectId     — project UUID
 *   projectName   — display name
 *   clientName    — optional client name
 *   currentStage  — ops pipeline stage (e.g. 'proposal_sent')
 *   onClose       — dismiss without action
 *   onComplete    — called after successful transition with newStage
 */

import React, { useState, useMemo } from 'react';
import { X, Loader2, CheckCircle, ChevronRight, ChevronLeft, RotateCcw, List } from 'lucide-react';
import {
  PROJECT_PIPELINE,
  STAGE_LABELS,
  nextStage,
  stageIndex,
} from '@/lib/operations/pipeline';


// ─── Types ─────────────────────────────────────────────────────────────────

interface DealDecisionModalProps {
  projectId: string;
  projectName: string;
  clientName?: string;
  currentStage: string;
  onClose: () => void;
  onComplete: (newStage: string) => void;
}

type OptionKey = 'next' | 'keep' | 'prev' | 'manual';

interface StageOption {
  key: OptionKey;
  label: string;
  stageName: string;
  stage: string | null;     // null when option is disabled
  icon: React.ReactNode;
  accent: string;           // CSS color for selected ring
  bg: string;               // CSS background for selected state
  disabled: boolean;
}

// ─── Contextual milestone toggles per stage ────────────────────────────────

const MILESTONE_TOGGLES: Record<string, { id: string; label: string }[]> = {
  proposal_sent: [
    { id: 'proposal_accepted', label: 'Proposal accepted by client' },
  ],
  contract_signed: [
    { id: 'contract_signed_confirmed', label: 'Contract signed & filed' },
  ],
  engineering: [
    { id: 'engineering_approved', label: 'Engineering drawings approved' },
  ],
  install_scheduled: [
    { id: 'install_scheduled_confirmed', label: 'Installation date scheduled' },
  ],
  installation: [
    { id: 'install_scheduled_confirmed', label: 'Installation date confirmed' },
  ],
};

// ─── Helper ────────────────────────────────────────────────────────────────

function stageName(stage: string | null): string {
  if (!stage) return '—';
  return (STAGE_LABELS as Record<string, string>)[stage] ?? stage.replace(/_/g, ' ');
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function DealDecisionModal({
  projectId,
  projectName,
  clientName,
  currentStage,
  onClose,
  onComplete,
}: DealDecisionModalProps) {
  const idx = stageIndex(currentStage);
  const prevStageValue = idx > 0 ? PROJECT_PIPELINE[idx - 1] : null;
  const nextStageValue = nextStage(currentStage);

  // Options
  const options = useMemo<StageOption[]>(() => [
    {
      key: 'next',
      label: 'Move to next stage',
      stageName: stageName(nextStageValue),
      stage: nextStageValue,
      icon: <ChevronRight size={16} />,
      accent: '#22c55e',
      bg: 'rgba(34,197,94,0.10)',
      disabled: !nextStageValue,
    },
    {
      key: 'keep',
      label: 'Keep in current stage',
      stageName: stageName(currentStage),
      stage: currentStage,
      icon: <RotateCcw size={16} />,
      accent: '#3b82f6',
      bg: 'rgba(59,130,246,0.10)',
      disabled: false,
    },
    {
      key: 'prev',
      label: 'Move back one stage',
      stageName: stageName(prevStageValue),
      stage: prevStageValue,
      icon: <ChevronLeft size={16} />,
      accent: '#f59e0b',
      bg: 'rgba(245,158,11,0.10)',
      disabled: !prevStageValue,
    },
    {
      key: 'manual',
      label: 'Choose stage manually',
      stageName: 'Select below',
      stage: null,           // resolved via manualStage
      icon: <List size={16} />,
      accent: '#8b5cf6',
      bg: 'rgba(139,92,246,0.10)',
      disabled: false,
    },
  ], [currentStage, nextStageValue, prevStageValue]);

  const [selected, setSelected] = useState<OptionKey>('next');
  const [manualStage, setManualStage] = useState<string>(currentStage);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null); // new stage name on success

  const milestones = MILESTONE_TOGGLES[currentStage] ?? [];

  // Resolve final target stage
  const targetStage: string | null = useMemo(() => {
    if (selected === 'manual') return manualStage || null;
    return options.find(o => o.key === selected)?.stage ?? null;
  }, [selected, manualStage, options]);

  const selectedOption = options.find(o => o.key === selected)!;

  const handleConfirm = async () => {
    if (!targetStage) return;
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/projects/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          status: targetStage,
          // pass milestone toggles as metadata (non-breaking — update-status ignores unknown fields)
          milestones: Object.entries(toggles)
            .filter(([, v]) => v)
            .map(([k]) => k),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Server error (${res.status})`);
      }

      setDone(stageName(targetStage));
      setTimeout(() => {
        onComplete(targetStage);
      }, 900);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full rounded-2xl shadow-2xl"
        style={{
          maxWidth: 420,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
        }}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div
          className="px-5 py-4 flex items-center justify-between gap-3"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}>
              Update Stage
            </div>
            <div className="text-sm font-black truncate mt-0.5"
              style={{ color: 'var(--text-primary)' }}>
              {clientName || projectName}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Currently: <span className="font-semibold"
                style={{ color: 'var(--text-secondary)' }}>{stageName(currentStage)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1.5 rounded-lg"
            style={{ color: 'var(--text-muted)', background: 'var(--bg-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Success flash ─────────────────────────────────────────────── */}
        {done ? (
          <div className="px-5 py-8 flex flex-col items-center gap-2 text-center">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(34,197,94,0.12)' }}>
              <CheckCircle size={24} className="text-green-400" />
            </div>
            <div className="text-sm font-bold mt-1" style={{ color: 'var(--text-primary)' }}>
              Stage updated
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              → <strong>{done}</strong>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">

            {/* ── 4 quick options ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-2">
              {options.map(opt => {
                const isSelected = selected === opt.key;
                return (
                  <button
                    key={opt.key}
                    disabled={opt.disabled}
                    onClick={() => { if (!opt.disabled) setSelected(opt.key); }}
                    className="text-left rounded-xl px-3 py-2.5 transition-all"
                    style={{
                      background: isSelected ? opt.bg : 'var(--bg-muted)',
                      border: isSelected
                        ? `1.5px solid ${opt.accent}`
                        : '1.5px solid var(--border-color)',
                      opacity: opt.disabled ? 0.35 : 1,
                      cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-1"
                      style={{ color: isSelected ? opt.accent : 'var(--text-muted)' }}>
                      {opt.icon}
                      <span className="text-[11px] font-bold uppercase tracking-wide">
                        {opt.label}
                      </span>
                    </div>
                    <div className="text-xs font-semibold truncate"
                      style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {opt.key === 'manual' ? '— pick below —' : opt.stageName}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ── Manual stage dropdown (only when 'manual' selected) ── */}
            {selected === 'manual' && (
              <select
                value={manualStage}
                onChange={e => setManualStage(e.target.value)}
                className="w-full text-sm rounded-xl px-3 py-2.5"
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  outline: 'none',
                }}
              >
                {PROJECT_PIPELINE.map(s => (
                  <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                ))}
              </select>
            )}

            {/* ── Contextual milestone toggles ─────────────────────────── */}
            {milestones.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {milestones.map(m => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2.5 cursor-pointer rounded-xl px-3 py-2"
                    style={{
                      background: toggles[m.id] ? 'rgba(59,130,246,0.08)' : 'var(--bg-muted)',
                      border: `1px solid ${toggles[m.id] ? 'rgba(59,130,246,0.3)' : 'var(--border-color)'}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!toggles[m.id]}
                      onChange={e => setToggles(t => ({ ...t, [m.id]: e.target.checked }))}
                      className="rounded"
                      style={{ accentColor: '#3b82f6' }}
                    />
                    <span className="text-xs font-medium"
                      style={{ color: 'var(--text-secondary)' }}>
                      {m.label}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* ── Error ────────────────────────────────────────────────── */}
            {error && (
              <div className="text-xs font-semibold px-3 py-2 rounded-lg"
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  color: '#EF4444',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}>
                {error}
              </div>
            )}

            {/* ── Confirm / Cancel ──────────────────────────────────────── */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleConfirm}
                disabled={saving || !targetStage}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: selectedOption.accent,
                  color: '#fff',
                }}
              >
                {saving ? (
                  <><Loader2 size={14} className="animate-spin" /> Saving…</>
                ) : (
                  <><CheckCircle size={14} /> Confirm</>
                )}
              </button>
              <button
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--bg-muted)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                }}
              >
                Cancel
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}