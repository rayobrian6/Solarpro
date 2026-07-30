'use client';
// W4 §7 — Equipment-identity reconciliation admin UI.
// Shows every conflicting source with values + provenance; the operator selects a
// winner and MUST give a reason. Records audit + invalidations. No silent win.
import React, { useState } from 'react';

interface SourceValue { source: string; value: string | null; label?: string | null; provenance: string; }

export default function ReconciliationPage() {
  const [projectId, setProjectId] = useState('');
  const [conflictField, setConflictField] = useState('module_model');
  const [subsystemKey, setSubsystemKey] = useState('');
  const [sources, setSources] = useState<SourceValue[]>([
    { source: 'subsystem_panel_id', value: '', provenance: '' },
    { source: 'fleet', value: '', provenance: '' },
  ]);
  const [chosen, setChosen] = useState('');
  const [reason, setReason] = useState('');
  const [audit, setAudit] = useState<any[]>([]);
  const [invalidations, setInvalidations] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const loadHistory = async () => {
    if (!projectId) return;
    const [a, i] = await Promise.all([
      fetch(`/api/admin/reconciliation?project_id=${encodeURIComponent(projectId)}`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/api/admin/reconciliation?project_id=${encodeURIComponent(projectId)}&invalidations=1`, { credentials: 'include' }).then(r => r.json()),
    ]);
    if (a.success) setAudit(a.audit); if (i.success) setInvalidations(i.invalidations);
  };

  const updSource = (idx: number, k: keyof SourceValue) => (e: any) =>
    setSources(s => s.map((v, n) => n === idx ? { ...v, [k]: e.target.value } : v));
  const addSource = () => setSources(s => [...s, { source: 'design', value: '', provenance: '' }]);

  const reconcile = async () => {
    setBusy(true); setMsg('');
    const r = await fetch('/api/admin/reconciliation', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, conflictField, subsystemKey: subsystemKey || null, sources, chosenSource: chosen, reason }),
    });
    const j = await r.json();
    setMsg(j.success ? `Reconciled. audit=${j.result.auditId.slice(0, 8)} invalidations=${j.result.invalidations.length}` : (j.error || 'failed'));
    setBusy(false); loadHistory();
  };

  return (
    <div style={{ padding: 24, color: '#e5e7eb', maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Equipment-Identity Reconciliation</h1>
      <p style={{ color: '#9ca3af', fontSize: 13 }}>W4 §7 — operator selection + reason required. Updates canonical references transactionally, preserves previous values, and invalidates affected snapshot digests + engineering approvals.</p>
      {msg && <div style={{ margin: '10px 0', padding: 10, background: '#1f2937', borderRadius: 6, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input placeholder="project id" value={projectId} onChange={e => setProjectId(e.target.value)} style={inp} />
        <button onClick={loadHistory} style={btn}>Load history</button>
      </div>

      <section style={{ marginTop: 16, padding: 16, border: '1px solid #374151', borderRadius: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>New reconciliation</h2>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input placeholder="conflict field" value={conflictField} onChange={e => setConflictField(e.target.value)} style={inp} />
          <input placeholder="subsystem key (opt)" value={subsystemKey} onChange={e => setSubsystemKey(e.target.value)} style={inp} />
        </div>
        <h3 style={{ fontSize: 13, marginTop: 12, color: '#9ca3af' }}>Conflicting sources (every source, its value + provenance)</h3>
        {sources.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <input type="radio" name="chosen" checked={chosen === s.source} onChange={() => setChosen(s.source)} />
            <input placeholder="source" value={s.source} onChange={updSource(i, 'source')} style={{ ...inp, width: 150 }} />
            <input placeholder="value" value={s.value ?? ''} onChange={updSource(i, 'value')} style={inp} />
            <input placeholder="provenance" value={s.provenance} onChange={updSource(i, 'provenance')} style={{ ...inp, flex: 1 }} />
          </div>
        ))}
        <button onClick={addSource} style={{ ...btn, marginTop: 8 }}>+ source</button>
        <textarea placeholder="reason (REQUIRED)" value={reason} onChange={e => setReason(e.target.value)} style={{ ...inp, width: '100%', marginTop: 10, minHeight: 60 }} />
        <button disabled={busy || !chosen || reason.trim().length < 3} onClick={reconcile} style={{ ...btn, marginTop: 10, background: '#dc2626' }}>Reconcile (select a winner + reason)</button>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Audit history ({audit.length})</h2>
        {audit.map(a => (
          <div key={a.id} style={{ fontSize: 12, borderTop: '1px solid #1f2937', padding: '6px 0' }}>
            <b>{a.conflict_field}</b> → chose <b>{a.chosen_source}</b> · {a.reason} · by {a.operator_name || a.operator_id} · {a.reconciled_at}
          </div>
        ))}
        <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 16 }}>Active invalidations ({invalidations.length})</h2>
        {invalidations.map(i => (
          <div key={i.id} style={{ fontSize: 12, borderTop: '1px solid #1f2937', padding: '6px 0', color: '#fbbf24' }}>
            {i.scope} · digest {i.digest ? String(i.digest).slice(0, 12) : '(all current)'} · {i.reason}
          </div>
        ))}
      </section>
    </div>
  );
}

const inp: React.CSSProperties = { background: '#111827', border: '1px solid #374151', borderRadius: 4, padding: '5px 8px', color: '#e5e7eb', fontSize: 13 };
const btn: React.CSSProperties = { padding: '6px 12px', background: '#2563eb', color: '#fff', borderRadius: 6, border: 0, fontSize: 13 };
