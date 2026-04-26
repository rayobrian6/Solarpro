'use client';

export default function DesignError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '60vh', padding: 32,
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🎨</div>
      <h2 style={{ color: '#f87171', fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
        Design Studio Error
      </h2>
      <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24, textAlign: 'center', maxWidth: 400 }}>
        {error.message || 'The design studio encountered an error. Your layout data is safe.'}
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={reset} style={{
          padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer',
        }}>Try Again</button>
        <button onClick={() => window.location.href = '/projects'} style={{
          padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: 'rgba(255,255,255,0.1)', color: '#e2e8f0',
          border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
        }}>Back to Projects</button>
      </div>
    </div>
  );
}