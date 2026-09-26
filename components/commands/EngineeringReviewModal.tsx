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
      // 1. Advance stage → engineering.
      // `update-status` now writes the project_activity row itself, through the ONE
      // stage writer (lib/operations/stageChange.ts applyStageChange), deriving
      // from_stage from the row it read under the ownership check.
      await postJson('/api/projects/update-status', {
        projectId,
        status: 'engineering',
        // Carried so the single row still records what the engineer typed.
        note: notes || null,
        activityTitle: 'Engineering review started',
      });

      // 🚨 THE SECOND ACTIVITY WRITE IS DELETED. It POSTed its own 'stage_change' row
      // with `metadata: { from_stage: 'contract_signed' }` — a FABRICATED literal, not
      // the stage the project was actually in. Now that update-status writes a correct
      // row, keeping this produced TWO rows per move, one of them fiction, and the
      // fiction is the one a reader would take as the answer to "where was this
      // project before?". A project moved to engineering from permit_submitted or from
      // survey recorded a contract signature it never had at that moment.
      //
      // The delete also removes the swallowed-failure path: the write was wrapped in a
      // bare catch, so the audit row could silently not exist while the stage moved.

      // 2. Complete the command if one exists
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

      {error ? <div className="text-xs text-red-400 font-medium mb-3">{error}</div> : null}

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