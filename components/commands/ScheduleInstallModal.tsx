'use client';
import React, { useState, useEffect } from 'react';
import { Calendar, CheckCircle, Loader2, Users } from 'lucide-react';
import ActionModal from './ActionModal';
import { postJson } from '@/lib/commands/postJson';
import type { Crew } from '@/lib/commands/types';

interface ScheduleInstallModalProps {
  commandId?: string;
  projectId: string;
  projectName: string;
  clientName?: string;
  existingDate?: string;
  existingCrew?: string;
  onClose: () => void;
  onComplete: () => void;
}

export default function ScheduleInstallModal({
  commandId, projectId, projectName, clientName,
  existingDate, existingCrew, onClose, onComplete,
}: ScheduleInstallModalProps) {
  const [installDate, setInstallDate] = useState(existingDate || '');
  const [crewId, setCrewId] = useState('');
  const [durationDays, setDurationDays] = useState('1');
  const [notes, setNotes] = useState('');
  const [crews, setCrews] = useState<Crew[]>([]);
  const [newCrewName, setNewCrewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/crews').then(r => r.json())
      .then(d => setCrews(d?.crews || []))
      .catch(() => {});
  }, []);

  const handleCreateCrew = async () => {
    if (!newCrewName.trim()) return;
    try {
      const res = await fetch('/api/crews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCrewName.trim(), color: '#3B82F6' }),
      });
      const data = await res.json();
      if (data?.crew) {
        setCrews(prev => [...prev, data.crew]);
        setCrewId(data.crew.id);
        setNewCrewName('');
      }
    } catch { /* ignore */ }
  };

  const handleSubmit = async () => {
    if (!installDate) { setError('Install date is required'); return; }
    setSaving(true);
    setError('');

    try {
      // 1. Update project: install_date, crew, move stage → install_scheduled
      await postJson(`/api/projects/${projectId}/operations`, {
        install_date: installDate,
      }, { method: 'PATCH' });

      // Set crew if selected
      const selectedCrew = crews.find(c => c.id === crewId);
      if (selectedCrew) {
        await postJson(`/api/projects/${projectId}/operations`, {
          crew_assigned: selectedCrew.name,
        }, { method: 'PATCH' });
      }

      // 2. Auto-advance stage to install_scheduled
      await postJson('/api/projects/update-status', { projectId, status: 'install_scheduled' });

      // 3. Create schedule item
      await postJson('/api/schedule', {
        project_id: projectId,
        type: 'install',
        date: installDate,
        crew_id: crewId || null,
        notes: notes || `${durationDays} day install`,
      });

      // 4. Log activity (best-effort — never block a completed schedule on a log write)
      try {
        await postJson('/api/activity', {
          project_id: projectId,
          type: 'schedule',
          title: `Install scheduled for ${new Date(installDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          details: notes || null,
          metadata: {
            install_date: installDate,
            crew: selectedCrew?.name || existingCrew || null,
            duration_days: parseInt(durationDays) || 1,
          },
        });
      } catch { /* activity log is non-critical */ }

      // 5. Complete the command if one exists
      if (commandId) {
        await postJson(`/api/commands/${commandId}`, { action: 'complete' }, { method: 'PATCH' });
      }

      onComplete();
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to schedule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ActionModal
      title={`Schedule Install — ${clientName || projectName}`}
      subtitle={projectName}
      accentColor="#3B82F6"
      icon={<Calendar size={18} />}
      onClose={onClose}>

      {/* Install Date */}
      <div className="mb-4">
        <label className="text-xs font-bold uppercase tracking-wider mb-2 block"
          style={{ color: 'var(--text-secondary)' }}>Install Date *</label>
        <input type="date" value={installDate} onChange={e => { setInstallDate(e.target.value); setError(''); }}
          className="w-full text-sm rounded-xl px-4 py-2.5 transition-all focus:ring-2"
          style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', outline: 'none' }} />
      </div>

      {/* Crew Assignment */}
      <div className="mb-4">
        <label className="text-xs font-bold uppercase tracking-wider mb-2 block"
          style={{ color: 'var(--text-secondary)' }}>
          <Users size={10} className="inline mr-1" /> Assign Crew
        </label>
        {crews.length > 0 ? (
          <div className="flex flex-wrap gap-2 mb-2">
            {crews.map(c => (
              <button key={c.id} onClick={() => setCrewId(crewId === c.id ? '' : c.id)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: crewId === c.id ? (c.color || '#3B82F6') : 'var(--bg-muted)',
                  color: crewId === c.id ? '#fff' : 'var(--text-secondary)',
                  border: crewId === c.id ? `1px solid ${c.color || '#3B82F6'}` : '1px solid var(--border-color)',
                }}>
                👷 {c.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <input type="text" value={newCrewName} onChange={e => setNewCrewName(e.target.value)}
            placeholder="New crew name..."
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCrew(); }}}
            className="flex-1 text-xs rounded-lg px-3 py-2 transition-all focus:ring-2"
            style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', outline: 'none' }} />
          <button onClick={handleCreateCrew} disabled={!newCrewName.trim()}
            className="text-xs font-bold px-3 py-2 rounded-lg transition-all disabled:opacity-30"
            style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
            + Add
          </button>
        </div>
      </div>

      {/* Duration */}
      <div className="mb-4">
        <label className="text-xs font-bold uppercase tracking-wider mb-2 block"
          style={{ color: 'var(--text-secondary)' }}>Duration (Days)</label>
        <input type="number" min="1" max="30" value={durationDays}
          onChange={e => setDurationDays(e.target.value)}
          className="w-24 text-sm rounded-xl px-4 py-2.5 transition-all focus:ring-2"
          style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', outline: 'none' }} />
      </div>

      {/* Notes */}
      <div className="mb-4">
        <label className="text-xs font-bold uppercase tracking-wider mb-2 block"
          style={{ color: 'var(--text-secondary)' }}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Special instructions, material prep..."
          rows={2}
          className="w-full text-sm rounded-xl px-4 py-3 resize-none transition-all focus:ring-2"
          style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', outline: 'none' }} />
      </div>

      {error && <div className="text-xs text-red-400 font-medium mb-3">{error}</div>}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <button onClick={handleSubmit} disabled={saving || !installDate}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: '#3B82F6', color: '#fff' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
          {saving ? 'Scheduling...' : 'Schedule Install'}
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