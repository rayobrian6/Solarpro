'use client';
import { ClipboardList } from 'lucide-react';

export default function ProjectsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '60vh', padding: 32,
    }}>
      <ClipboardList size={48} style={{ marginBottom: 16, color: "#f87171" }} />
      <h2 style={{ color: '#f87171', fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
        Projects Error
      </h2>
      <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24, textAlign: 'center', maxWidth: 400 }}>
        {error.message || 'Something went wrong loading projects.'}
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={reset} style={{
          padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer',
        }}>Try Again</button>
        <button onClick={() => window.location.href = '/dashboard'} style={{
          padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: 'rgba(255,255,255,0.1)', color: '#e2e8f0',
          border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
        }}>Go to Dashboard</button>
      </div>
    </div>
  );
}