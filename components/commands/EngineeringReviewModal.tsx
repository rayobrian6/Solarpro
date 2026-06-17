'use client';
import React, { useState } from 'react';
import { Wrench, CheckCircle, Loader2 } from 'lucide-react';
import ActionModal from './ActionModal';
import { postJson } from '@/lib/commands/postJson';

interface EngineeringReviewModalProps {
  commandId?: string;
  projectId: string;
  projectName: string;
  clientName?: string;
  onClose: () => void;
  onComplete: () => void;
}

export default function EngineeringReviewModal({
  commandId, projectId, projectName, clientName, onClose, onComplete,
}: EngineeringReviewModalProps) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setSaving(true);
    setError('');

    try {
      // 1. Advance stage → engineering
      await postJson('/api/projects/update-status', { projectId, status: 'engineering' });

      // 2. Log activity (best-effort — never block a completed stage move on a log write)
      try {
        await postJson('/api/activity', {
          project_id: projectId,
          type: 'stage_change',
          title: 'Engineering review started',
          details: notes || null,
          metadata: { from_stage: 'contract_signed', to_stage: 'engineering' },
        });
      } catch { /* activity log is non-critical */ }

      // 3. Complete the command if one exists
      if (commandId) {
        await postJson(`/api/commands/${commandId}`, { action: 'complete' }, { method: 'PATCH' });
      }

      onComplete();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to start engineering');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ActionModal
      title={`Start Engineering — ${clientName || projectName}`}
      subtitle={projectName}
      accentColor="#6366F1"
      icon={<Wrench size={18} />}
      onClose={onClose}>

      {/* Confirmation */}
      <div className="rounded-xl p-4 mb-4"
        style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          This will move <strong>{clientName || projectName}</strong> to the <strong>Engineering</strong> stage.
        </div>
        <div className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
          The engineering team will begin plan set generation and permit package preparation.
        </div>
      </div>

      {/* Notes */}
      <div className="mb-4">
        <label className="text-xs font-bold uppercase tracking-wider mb-2 block"
          style={{ color: 'var(--text-secondary)' }}>Notes (optional)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Special engineering requirements, roof type notes..."
          rows={2}
          className="w-full text-sm rounded-xl px-4 py-3 resize-none transition-all focus:ring-2"
          style={{
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            outline: 'none',
          }} />
      </div>

      {error && <div className="text-xs text-red-400 font-medium mb-3">{error}</div>}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <button onClick={handleSubmit} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: '#6366F1', color: '#fff' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
          {saving ? 'Starting...' : 'Start Engineering Review'}
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