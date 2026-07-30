'use client';
// W4 §8/§9 — Manufacturer/authority document registry admin UI.
// Lists registry documents, ingests an RT-MINI structural source, and verifies.
import React, { useCallback, useEffect, useState } from 'react';

interface RegistryDoc {
  id: string;
  documentClass: string;
  manufacturerOrIssuer: string;
  equipmentId: string | null;
  equipmentModelApplicability: string | null;
  title: string;
  revision: string | null;
  sha256: string | null;
  archivedInRepo: boolean;
  status: string;
  verificationState: string;
  jurisdictionBoundary: string | null;
  extractedClaims: any;
}

const EMPTY_RT = {
  title: '', archivedFileIdentity: '', sha256: '', exactModel: 'RT-MINI',
  fastenerModel: '', fastenerCount: 2, substrate: '', rafterDeckCondition: '',
  embedmentIn: 2.5, railLFootAssembly: '', loadBasis: 'ASD allowable',
  adjustmentFactors: '{"omega":1.5}', jurisdiction: '', asdAllowableLbs: 600,
  documentDate: '', revision: '', source: '', verifyNow: false,
};

export default function DocumentRegistryPage() {
  const [docs, setDocs] = useState<RegistryDoc[]>([]);
  const [msg, setMsg] = useState<string>('');
  const [rt, setRt] = useState<any>({ ...EMPTY_RT });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/document-registry', { credentials: 'include' });
    const j = await r.json();
    if (j.success) setDocs(j.documents);
    else setMsg(j.error || 'load failed');
  }, []);
  useEffect(() => { load(); }, [load]);

  const verify = async (id: string, state: string) => {
    setBusy(true);
    const r = await fetch('/api/admin/document-registry', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, verification_state: state }),
    });
    const j = await r.json();
    setMsg(j.success ? `Set ${id.slice(0, 8)} → ${state}` : (j.error || 'failed'));
    setBusy(false); load();
  };

  const ingestRtMini = async () => {
    setBusy(true); setMsg('');
    let adjustmentFactors: any = {};
    try { adjustmentFactors = JSON.parse(rt.adjustmentFactors || '{}'); } catch { setMsg('adjustmentFactors must be JSON'); setBusy(false); return; }
    const r = await fetch('/api/admin/document-registry/rt-mini', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rt, fastenerCount: Number(rt.fastenerCount), embedmentIn: Number(rt.embedmentIn), asdAllowableLbs: Number(rt.asdAllowableLbs), adjustmentFactors }),
    });
    const j = await r.json();
    setMsg(j.success ? (j.note || 'ingested') : (j.error || 'failed'));
    if (j.success) setRt({ ...EMPTY_RT });
    setBusy(false); load();
  };

  const set = (k: string) => (e: any) => setRt((s: any) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <div style={{ padding: 24, color: '#e5e7eb', maxWidth: 1100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Manufacturer / Authority Document Registry</h1>
      <p style={{ color: '#9ca3af', fontSize: 13 }}>W4 §8/§9 — versioned document authority. Engineering values may cite only VERIFIED, CURRENT documents covering the exact equipment + installation condition.</p>
      {msg && <div style={{ margin: '10px 0', padding: 10, background: '#1f2937', borderRadius: 6, fontSize: 13 }}>{msg}</div>}

      <section style={{ marginTop: 16, padding: 16, border: '1px solid #374151', borderRadius: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Ingest RT-MINI structural source (§9)</h2>
        <p style={{ color: '#9ca3af', fontSize: 12 }}>All fields required. A generic brochure / flashing report will be rejected. Archived file + SHA-256 required.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
          {[
            ['title', 'Document title'], ['archivedFileIdentity', 'Archived file id/path'], ['sha256', 'SHA-256 (64 hex)'],
            ['exactModel', 'Exact model'], ['fastenerModel', 'Fastener model'], ['fastenerCount', 'Fastener count'],
            ['substrate', 'Substrate'], ['rafterDeckCondition', 'Rafter/deck condition'], ['embedmentIn', 'Embedment (in)'],
            ['railLFootAssembly', 'Rail/L-foot assembly'], ['loadBasis', 'Load basis'], ['jurisdiction', 'Jurisdiction'],
            ['asdAllowableLbs', 'ASD allowable (lbs)'], ['adjustmentFactors', 'Adjustment factors (JSON)'], ['source', 'Source URL'],
          ].map(([k, label]) => (
            <label key={k} style={{ fontSize: 12, display: 'flex', flexDirection: 'column' }}>
              <span style={{ color: '#9ca3af' }}>{label}</span>
              <input value={rt[k] ?? ''} onChange={set(k)} style={{ background: '#111827', border: '1px solid #374151', borderRadius: 4, padding: '4px 6px', color: '#e5e7eb' }} />
            </label>
          ))}
        </div>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <input type="checkbox" checked={rt.verifyNow} onChange={set('verifyNow')} /> verify immediately
        </label>
        <button disabled={busy} onClick={ingestRtMini} style={{ marginTop: 10, padding: '6px 14px', background: '#2563eb', color: '#fff', borderRadius: 6, border: 0 }}>Ingest structural source</button>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Documents ({docs.length})</h2>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 8 }}>
          <thead><tr style={{ color: '#9ca3af', textAlign: 'left' }}>
            <th>Class</th><th>Issuer</th><th>Model</th><th>Title</th><th>Status</th><th>Verif</th><th>SHA-256</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {docs.map(d => (
              <tr key={d.id} style={{ borderTop: '1px solid #1f2937' }}>
                <td>{d.documentClass}</td><td>{d.manufacturerOrIssuer}</td><td>{d.equipmentModelApplicability}</td>
                <td>{d.title}</td><td>{d.status}</td>
                <td style={{ color: d.verificationState === 'verified' ? '#34d399' : '#fbbf24' }}>{d.verificationState}</td>
                <td>{d.sha256 ? d.sha256.slice(0, 10) + '…' : '—'}</td>
                <td>
                  {d.verificationState !== 'verified' && <button disabled={busy} onClick={() => verify(d.id, 'verified')} style={{ marginRight: 4 }}>Verify</button>}
                  {d.verificationState !== 'rejected' && <button disabled={busy} onClick={() => verify(d.id, 'rejected')}>Reject</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
