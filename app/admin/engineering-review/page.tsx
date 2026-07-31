'use client';
// AAC WS-8 / WS-9 — DIGEST-BOUND ENGINEERING REVIEW (the professional-release surface).
//
// WHY THIS PAGE EXISTS: ENGINEERING-REVIEW-PENDING is a legitimate and permanent
// PROFESSIONAL_APPROVAL requirement — and until now it was structurally
// UNCLEARABLE. There was no table, no API and no UI, and
// `certification.engineeringReviewApproved` was hardcoded false, so no licensed
// engineer could ever release a set no matter what they reviewed. An unclearable
// requirement is not honesty, it is a missing feature. This is the feature.
//
// WHAT IT CANNOT DO: the engine never writes here. A review is bound to an EXACT
// snapshot digest, recorded by a LICENSED role with a licence number and state,
// and carries a stated scope. Records are append-only — a re-review or a
// withdrawal supersedes, it never edits. Any change to the design moves the
// digest and the approval stops covering the set automatically.
//
// Same visual language + fetch pattern as app/admin/personnel/page.tsx.
import React, { useCallback, useEffect, useState } from 'react';

const LICENSED_ROLES = ['engineer_of_record', 'approving_engineer'] as const;
const ROLE_LABEL: Record<string, string> = {
  engineer_of_record: 'Engineer of Record',
  approving_engineer: 'Approving Engineer',
};
const DECISIONS = ['approved', 'rejected', 'withdrawn'] as const;
const DIGEST_RE = /^[0-9a-f]{64}$/i;

export default function EngineeringReviewPage() {
  const [projectId, setProjectId] = useState('');
  const [digest, setDigest] = useState('');
  const [records, setRecords] = useState<any[]>([]);
  const [coverage, setCoverage] = useState<any>(null);
  const [role, setRole] = useState<string>('engineer_of_record');
  const [decision, setDecision] = useState<string>('approved');
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerLicense, setReviewerLicense] = useState('');
  const [reviewerLicenseState, setReviewerLicenseState] = useState('');
  const [reviewerLicenseExpiresOn, setExpires] = useState('');
  const [scopeStatement, setScope] = useState('');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId.trim()) { setRecords([]); setCoverage(null); return; }
    const qs = new URLSearchParams({ project_id: projectId.trim() });
    if (digest.trim()) qs.set('digest', digest.trim().toLowerCase());
    const j = await fetch(`/api/admin/engineering-review?${qs}`, { credentials: 'include' }).then(r => r.json());
    if (j.success) { setRecords(j.records ?? []); setCoverage(j.coverage ?? null); setMsg(''); }
    else setMsg(j.error || 'could not read the review store — has migration 116 been run?');
  }, [projectId, digest]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    setBusy(true); setMsg('');
    try {
      const j = await fetch('/api/admin/engineering-review', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: projectId.trim(), snapshotDigest: digest.trim().toLowerCase(),
          reviewerRole: role, decision, reviewerName, reviewerLicense, reviewerLicenseState,
          reviewerLicenseExpiresOn: reviewerLicenseExpiresOn || null,
          scopeStatement, notes: notes || null,
        }),
      }).then(r => r.json());
      setMsg(j.success ? `Recorded ${decision} — record ${j.record?.id}` : (j.error || 'refused'));
      if (j.success) await load();
    } finally { setBusy(false); }
  };

  const digestValid = DIGEST_RE.test(digest.trim());
  const canSubmit = !busy && projectId.trim() && digestValid && reviewerName.trim()
    && reviewerLicense.trim() && reviewerLicenseState.trim()
    && (decision !== 'approved' || scopeStatement.trim());

  const field = 'w-full border border-gray-300 rounded px-2 py-1 text-sm';
  const label = 'block text-xs font-semibold text-gray-600 mb-1';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Engineering review — digest-bound release</h1>
      <p className="text-sm text-gray-600 mb-4">
        An approval covers ONE snapshot digest, exactly. Only a licensed engineer of record or approving engineer may
        record one, a licence number and state are mandatory, and an approval must state its scope. Records are
        append-only: a re-review or a withdrawal supersedes the prior record and never edits it. Any design change moves
        the digest, and the approval stops covering the set automatically — that is the point.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className={label}>Project id</label>
          <input className={field} value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="UUID" />
        </div>
        <div>
          <label className={label}>Snapshot digest (64-char SHA-256, from the generated set)</label>
          <input className={field} value={digest} onChange={e => setDigest(e.target.value)} placeholder="sha256…" />
          {digest.trim() && !digestValid && (
            <div className="text-xs text-red-700 mt-1">Not a 64-char hex digest — an approval that names no snapshot covers nothing.</div>
          )}
        </div>
      </div>

      {coverage && (
        <div className={`mb-4 p-3 rounded text-sm border ${coverage.covered ? 'bg-green-50 border-green-300' : 'bg-amber-50 border-amber-300'}`}>
          <div className="font-semibold">{coverage.covered ? 'COVERED' : 'NOT COVERED'}</div>
          <div className="text-xs text-gray-700 mt-1">{coverage.basis}</div>
          {coverage.storeUnavailable && (
            <div className="text-xs text-red-700 mt-1">
              The review store could not be read. Run migration 116 through Admin → System Tools → Migrations. An
              unreadable store is never coverage.
            </div>
          )}
        </div>
      )}

      <div className="border border-gray-300 rounded p-4 mb-4">
        <h2 className="font-semibold mb-3 text-sm">Record a decision</h2>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className={label}>Role (licensed only)</label>
            <select className={field} value={role} onChange={e => setRole(e.target.value)}>
              {LICENSED_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Decision</label>
            <select className={field} value={decision} onChange={e => setDecision(e.target.value)}>
              {DECISIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Reviewer name</label>
            <input className={field} value={reviewerName} onChange={e => setReviewerName(e.target.value)} />
          </div>
          <div>
            <label className={label}>Licence number</label>
            <input className={field} value={reviewerLicense} onChange={e => setReviewerLicense(e.target.value)} />
          </div>
          <div>
            <label className={label}>Licence state</label>
            <input className={field} value={reviewerLicenseState} onChange={e => setReviewerLicenseState(e.target.value)} maxLength={2} />
          </div>
          <div>
            <label className={label}>Licence expires (optional)</label>
            <input className={field} type="date" value={reviewerLicenseExpiresOn} onChange={e => setExpires(e.target.value)} />
          </div>
        </div>
        <div className="mb-3">
          <label className={label}>Scope accepted (required for an approval — &quot;approved&quot; is never a bare boolean)</label>
          <textarea className={field} rows={2} value={scopeStatement} onChange={e => setScope(e.target.value)} />
        </div>
        <div className="mb-3">
          <label className={label}>Notes (optional)</label>
          <textarea className={field} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <button
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`px-3 py-1.5 rounded text-sm font-semibold ${canSubmit ? 'bg-blue-700 text-white' : 'bg-gray-200 text-gray-500'}`}
        >
          {busy ? 'Recording…' : `Record ${decision}`}
        </button>
      </div>

      {msg && <div className="mb-4 text-sm p-2 rounded bg-gray-100 border border-gray-300">{msg}</div>}

      <h2 className="font-semibold mb-2 text-sm">Review history (append-only)</h2>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border p-1">Decided</th><th className="border p-1">Decision</th>
            <th className="border p-1">Digest</th><th className="border p-1">Reviewer</th>
            <th className="border p-1">Licence</th><th className="border p-1">Superseded</th>
          </tr>
        </thead>
        <tbody>
          {records.length === 0 && (
            <tr><td className="border p-2 text-gray-500" colSpan={6}>No review records for this project.</td></tr>
          )}
          {records.map(r => (
            <tr key={r.id} className={r.supersededAt ? 'text-gray-400' : ''}>
              <td className="border p-1">{String(r.decidedAt).slice(0, 19)}</td>
              <td className="border p-1 font-semibold">{r.decision}</td>
              <td className="border p-1 font-mono">{String(r.snapshotDigest).slice(0, 12)}…</td>
              <td className="border p-1">{r.reviewerName} ({ROLE_LABEL[r.reviewerRole] ?? r.reviewerRole})</td>
              <td className="border p-1">{r.reviewerLicense} {r.reviewerLicenseState}</td>
              <td className="border p-1">{r.supersededAt ? String(r.supersededAt).slice(0, 19) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
