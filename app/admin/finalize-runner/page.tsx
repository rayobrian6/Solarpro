'use client';

import { useState } from 'react';

export default function FinalizeRunnerPage() {
  const [surveyId, setSurveyId] = useState('3021741c-5c96-48f6-bf1a-188bc1aa7f5d');
  const [jobId, setJobId] = useState('job_3021741c-5c96-48f6-bf1a-188bc1aa7f5d_177602817888_query1');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runFinalize = async () => {
    setLoading(true);
    setResult(null);
    setError('');
    try {
      const url = `/api/site-surveys/${surveyId}/open-source-photo-vision-pass/finalize?retry=1`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>🔄 Rerun Photo Vision Finalize</h1>
      <p style={{ color: '#888', marginBottom: 24, fontSize: 14 }}>
        Calls <code>/finalize?retry=1</code> to re-execute Stage 1.5 (unify) and adapt candidates into unified geometry.
        This runs inside the app so auth cookies are included automatically.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 4 }}>Survey ID</label>
        <input
          value={surveyId}
          onChange={e => setSurveyId(e.target.value)}
          style={{ width: '100%', padding: 8, fontSize: 13, fontFamily: 'monospace', background: '#1a1a1a', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6 }}
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 4 }}>Job ID</label>
        <input
          value={jobId}
          onChange={e => setJobId(e.target.value)}
          style={{ width: '100%', padding: 8, fontSize: 13, fontFamily: 'monospace', background: '#1a1a1a', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6 }}
        />
      </div>

      <button
        onClick={runFinalize}
        disabled={loading}
        style={{
          background: loading ? '#333' : '#0070f3',
          color: loading ? '#666' : '#fff',
          border: 'none',
          borderRadius: 8,
          padding: '12px 32px',
          fontSize: 16,
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? '⏳ Running... (may take 30-60s)' : '▶ Run Finalize (retry=1)'}
      </button>

      {error ? (
        <div style={{ marginTop: 24, color: '#f44336' }}>
          ❌ Error: {error}
        </div>
      ) : null}

      {result ? (
        <div style={{ marginTop: 24 }}>
          <p style={{ color: result.success ? '#4caf50' : '#f44336', fontWeight: 600, marginBottom: 12 }}>
            {result.success ? '✅ Finalize completed!' : '❌ Finalize failed'}
          </p>
          <pre style={{
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 16,
            overflow: 'auto',
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
          }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
