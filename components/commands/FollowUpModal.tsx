'use client';
import React, { useState } from 'react';
import { Phone, CheckCircle, Loader2 } from 'lucide-react';
import ActionModal from './ActionModal';
import { postJson } from '@/lib/commands/postJson';
import type { FollowUpOutcome } from '@/lib/commands/types';

interface FollowUpModalProps {
  commandId: string;
  projectId: string;
  projectName: string;
  clientName?: string;
  onClose: () => void;
  onComplete: () => void;
}

const OUTCOMES: { value: FollowUpOutcome; label: string; color: string }[] = [
  { value: 'no_answer',            label: 'No Answer',           color: '#94a3b8' },
  { value: 'interested',           label: 'Interested',          color: '#22C55E' },
  { value: 'not_interested',       label: 'Not Interested',      color: '#EF4444' },
  { value: 'scheduled_next_step',  label: 'Scheduled Next Step', color: '#3B82F6' },
];

export default function FollowUpModal({
  commandId, projectId, projectName, clientName, onClose, onComplete,
}: FollowUpModalProps) {
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState<FollowUpOutcome | null>(null);
  const [nextDate, setNextDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!outcome) { setError('Select an outcome'); return; }
    setSaving(true);
    setError('');

    try {
      // 1. Log activity (best-effort — never block the action on a log write)
      try {
        await postJson('/api/activity', {
          project_id: projectId,
          type: 'follow_up',
          title: `Follow-up: ${OUTCOMES.find(o => o.value === outcome)?.label}`,
          details: notes || null,
          metadata: { outcome, next_follow_up_date: nextDate || null },
        });
      } catch { /* activity log is non-critical */ }

      // 2. Complete or reschedule the command
      if (outcome === 'no_answer' && nextDate) {
        // Snooze to next follow-up date
        const daysUntil = Math.max(1, Math.ceil((new Date(nextDate).getTime() - Date.now()) / 86400000));
        await postJson(`/api/commands/${commandId}`, { action: 'snooze', snooze_days: daysUntil }, { method: 'PATCH' });
      } else if (outcome === 'not_interested') {
        // Complete the action — deal is dead
        await postJson(`/api/commands/${commandId}`, { action: 'complete' }, { method: 'PATCH' });
      } else {
        // Complete the follow-up action
        await postJson(`/api/commands/${commandId}`, { action: 'complete' }, { method: 'PATCH' });

        // If scheduling next step, create a new schedule item
        if (outcome === 'scheduled_next_step' && nextDate) {
          await postJson('/api/schedule', {
            project_id: projectId,
            type: 'follow_up',
            date: nextDate,
            notes: notes || null,
          });
        }
      }

      onComplete();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ActionModal
      title={`Follow Up — ${clientName || projectName}`}
      subtitle={projectName}
      accentColor="#F59E0B"
      icon={<Phone size={18} />}
      onClose={onClose}>

      {/* Outcome Selection */}
      <div className="mb-4">
        <label className="text-xs font-bold uppercase tracking-wider mb-2 block"
          style={{ color: 'var(--text-secondary)' }}>Outcome</label>
        <div className="grid grid-cols-2 gap-2">
          {OUTCOMES.map(o => (
            <button key={o.value}
              onClick={() => { setOutcome(o.value); setError(''); }}
              className="text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-all hover:-translate-y-0.5"
              style={{
                background: outcome === o.value ? `${o.color}22` : 'var(--bg-muted)',
                border: outcome === o.value ? `1px solid ${o.color}55` : '1px solid var(--border-color)',
                color: outcome === o.value ? o.color : 'var(--text-secondary)',
              }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="mb-4">
        <label className="text-xs font-bold uppercase tracking-wider mb-2 block"
          style={{ color: 'var(--text-secondary)' }}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Call notes, what was discussed..."
          rows={3}
          className="w-full text-sm rounded-xl px-4 py-3 resize-none transition-all focus:ring-2"
          style={{
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            outline: 'none',
          }} />
      </div>

      {/* Next Follow-up Date */}
      {(outcome === 'no_answer' || outcome === 'scheduled_next_step') ? (
        <div className="mb-4">
          <label className="text-xs font-bold uppercase tracking-wider mb-2 block"
            style={{ color: 'var(--text-secondary)' }}>
            {outcome === 'no_answer' ? 'Retry Date' : 'Next Step Date'}
          </label>
          <input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)}
            className="w-full text-sm rounded-xl px-4 py-2.5 transition-all focus:ring-2"
            style={{
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              outline: 'none',
            }} />
        </div>
      ) : null}

      {error && <div className="text-xs text-red-400 font-medium mb-3">{error}</div>}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <button onClick={handleSubmit} disabled={saving || !outcome}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: '#F59E0B', color: '#0f172a' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
          {saving ? 'Saving...' : 'Complete Follow-Up'}
        </button>
        <button onClick={onClose}
          className="px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
          Cancel
        </button>
      </div>
    </ActionModal>
  );
}