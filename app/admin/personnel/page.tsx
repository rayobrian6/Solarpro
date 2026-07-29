'use client';
// AAC WS-6 — Personnel roles of record (System Config surface).
//
// The designer is a CONFIGURATION fact: set it ONCE here and every planset
// populates it (cover DESIGNER row, CERT designer field + revision "by", PV-4C
// installed-by, projectAuthority.designer, the SLD adapter). Nothing on this page
// can produce a PE, a signature, a seal or a digest-bound approval — the licensed
// roles are recorded for reference only, and the permit resolver populates the
// DESIGNER role and nothing else.
//
// Same visual language + fetch pattern as app/admin/reconciliation/page.tsx.
import React, { useCallback, useEffect, useState } from 'react';

const ROLES = ['designer', 'preparer', 'reviewer', 'engineer_of_record', 'approving_engineer'] as const;
const LICENSED = new Set<string>(['engineer_of_record', 'approving_engineer']);
const LABEL: Record<string, string> = {
  designer: 'Designer', preparer: 'Preparer', reviewer: 'Reviewer',
  engineer_of_record: 'Engineer of Record', approving_engineer: 'Approving Engineer',
};

export default function PersonnelPage() {
  const [roster, setRoster] = useState<any[]>([]);
  const [projectId, setProjectId] = useState('');
  const [authority, setAuthority] = useState<any>(null);
  const [role, setRole] = useState<string>('designer');
  const [personName, setPersonName] = useState('');
  const [personTitle, setPersonTitle] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseState, setLicenseState] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const loadRoster = useCallback(async () => {
    const j = await fetch('/api/admin/personnel', { credentials: 'include' }).then(r => r.json());
    if (j.success) setRoster(j.roster ?? []);
    else setMsg(j.error || 'could not read the personnel store — has migration 115 been run?');
  }, []);

  useEffect(() => { void loadRoster(); }, [loadRoster]);

  const loadProject = async () => {
    if (!projectId) return;
    const j = await fetch(`/api/admin/personnel?project_id=${encodeURIComponent(projectId)}`, { credentials: 'include' }).then(r => r.json());
    if (j.success) { setAuthority(j.authority); setRoster(j.roster ?? []); }
    else setMsg(j.error || 'lookup failed');
  };

  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setMsg('');
    const j = await fetch('/api/admin/personnel', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json());
    setMsg(j.success ? 'Saved.' : (j.error || 'failed'));
    setBusy(false);
    await loadRoster();
    if (projectId) await loadProject();
  };

  const saveDefault = () => post({
    op: 'upsert', role, personName, personTitle: personTitle || null,
    licenseNumber: licenseNumber || null, licenseState: licenseState || null, isDefault: true,
  });
  const assign = () => post({
    op: 'assign', projectId, role, personName, personTitle: personTitle || null,
    licenseNumber: licenseNumber || null, licenseState: licenseState || null, reason: reason || null,
  });

  return (
    <div style={{ padding: 24, color: '#e5e7eb', maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Personnel Roles of Record</h1>
      <p style={{ color: '#9ca3af', fontSize: 13 }}>
        AAC WS-6 — five distinct roles. A configured <b>designer</b> populates every planset automatically (that is the whole
        point: the platform must never ask for what it already knows). The <b>engineer of record</b> and <b>approving
        engineer</b> rows are configuration only — no signature, seal or digest-bound approval is ever produced from them.
        Requires migration <code>115</code> (Admin → System Tools → Migrations).
      </p>
      {msg && <div style={{ margin: '10px 0', padding: 10, background: '#1f2937', borderRadius: 6, fontSize: 13 }}>{msg}</div>}

      <section style={sec}>
        <h2 style={h2}>Configured roster</h2>
        {roster.length === 0
          ? <div style={{ color: '#9ca3af', fontSize: 13 }}>No configured personnel. Add a designer below — one entry covers every project.</div>
          : (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Role</th><th style={th}>Name</th><th style={th}>Title</th><th style={th}>Licence</th><th style={th}>Default</th></tr></thead>
              <tbody>
                {roster.map((p: any) => (
                  <tr key={p.id}>
                    <td style={td}>{LABEL[p.role] ?? p.role}</td>
                    <td style={td}>{p.personName}</td>
                    <td style={td}>{p.personTitle ?? '—'}</td>
                    <td style={td}>{p.licenseNumber ? `${p.licenseNumber}${p.licenseState ? ` (${p.licenseState})` : ''}` : '—'}</td>
                    <td style={td}>{p.isDefault ? 'YES' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>

      <section style={sec}>
        <h2 style={h2}>Set a role</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <select value={role} onChange={e => setRole(e.target.value)} style={inp}>
            {ROLES.map(r => <option key={r} value={r}>{LABEL[r]}</option>)}
          </select>
          <input placeholder="person name" value={personName} onChange={e => setPersonName(e.target.value)} style={inp} />
          <input placeholder="title (optional)" value={personTitle} onChange={e => setPersonTitle(e.target.value)} style={inp} />
          {LICENSED.has(role) && (
            <>
              <input placeholder="licence number (required)" value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} style={inp} />
              <input placeholder="licence state" value={licenseState} onChange={e => setLicenseState(e.target.value)} style={inp} />
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button disabled={busy || !personName.trim()} onClick={saveDefault} style={btn}>Save as the default for this role</button>
        </div>
        {LICENSED.has(role) && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#fbbf24' }}>
            A licensed role is recorded for reference only. It never populates a title block, never seals a set, and never
            satisfies the professional-release requirement.
          </div>
        )}
      </section>

      <section style={sec}>
        <h2 style={h2}>Per-project override</h2>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input placeholder="project id" value={projectId} onChange={e => setProjectId(e.target.value)} style={inp} />
          <button onClick={loadProject} style={btn}>Resolve for project</button>
          <input placeholder="reason (recorded)" value={reason} onChange={e => setReason(e.target.value)} style={inp} />
          <button disabled={busy || !projectId || !personName.trim()} onClick={assign} style={btn}>Assign to this project</button>
        </div>
        {authority && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <div style={{ color: '#9ca3af' }}>{authority.basis}</div>
            <ul style={{ marginTop: 6 }}>
              {ROLES.map(r => {
                const v = authority.roles?.[r];
                return (
                  <li key={r} style={{ marginBottom: 2 }}>
                    <b>{LABEL[r]}:</b> {v ? `${v.personName} — ${v.source} (${v.path})` : 'not configured'}
                  </li>
                );
              })}
            </ul>
            <div style={{ color: '#9ca3af', fontSize: 12 }}>
              Populated onto the project record: {(authority.populatedRoles ?? []).join(', ') || 'none'} — licensed roles are never populated.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const sec: React.CSSProperties = { marginTop: 16, padding: 16, border: '1px solid #374151', borderRadius: 8 };
const h2: React.CSSProperties = { fontSize: 16, fontWeight: 600 };
const inp: React.CSSProperties = { background: '#111827', border: '1px solid #374151', borderRadius: 6, padding: '6px 8px', color: '#e5e7eb', fontSize: 13 };
const btn: React.CSSProperties = { background: '#2563eb', border: 0, borderRadius: 6, padding: '6px 12px', color: '#fff', fontSize: 13, cursor: 'pointer' };
const th: React.CSSProperties = { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid #374151', color: '#9ca3af', fontWeight: 600 };
const td: React.CSSProperties = { padding: '4px 6px', borderBottom: '1px solid #1f2937' };
