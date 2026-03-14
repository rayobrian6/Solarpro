'use client';
/**
 * /debug/project
 * 
 * Visual debug page — proves layout pipeline end-to-end.
 * Shows full DB state, layout data, and pipeline status.
 * 
 * REMOVE THIS PAGE once pipeline is verified.
 */

import { useState, useEffect } from 'react';
import { BUILD_VERSION } from '@/lib/version';

interface DebugData {
  timestamp: string;
  userId: string;
  db: {
    schema: {
      hasLayouts: boolean;
      columns: string[];
      hasPanels: boolean;
      hasRoofPlanes: boolean;
      hasMapCenter: boolean;
    };
    totalLayouts: number;
    allLayouts: Array<{
      id: string;
      project_id: string;
      project_name: string;
      panel_count: number;
      roof_planes_status: string;
      total_panels: number;
      system_size_kw: number;
      updated_at: string;
    }>;
  };
  specificProject: any;
  specificLayout: any;
}

export default function DebugProjectPage() {
  const [projectId, setProjectId] = useState('');
  const [data, setData] = useState<DebugData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchDebug = async (pid?: string) => {
    setLoading(true);
    setError('');
    try {
      const url = pid
        ? `/api/debug/layout?projectId=${pid}`
        : `/api/debug/layout`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || 'Unknown error');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDebug();
  }, []);

  const s = (v: boolean | undefined) => v ? '✅' : '❌';

  return (
    <div style={{ fontFamily: 'monospace', background: '#0f172a', color: '#e2e8f0', minHeight: '100vh', padding: '24px' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ marginBottom: '24px', borderBottom: '1px solid #334155', paddingBottom: '16px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#f8fafc', marginBottom: '4px' }}>
            🔍 SolarPro Pipeline Debug
          </h1>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Build: {BUILD_VERSION} · Remove this page when debugging is complete
          </div>
        </div>

        {/* Project ID input */}
        <div style={{ marginBottom: '20px', display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Enter project ID (optional)"
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            style={{
              flex: 1, padding: '8px 12px', background: '#1e293b', border: '1px solid #334155',
              borderRadius: '6px', color: '#e2e8f0', fontSize: '13px', fontFamily: 'monospace',
            }}
          />
          <button
            onClick={() => fetchDebug(projectId || undefined)}
            style={{
              padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none',
              borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
            }}
          >
            {loading ? '...' : 'Query DB'}
          </button>
          <button
            onClick={() => fetchDebug()}
            style={{
              padding: '8px 16px', background: '#374151', color: '#d1d5db', border: 'none',
              borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
            }}
          >
            Reset
          </button>
        </div>

        {error && (
          <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: '6px', padding: '12px', marginBottom: '16px', color: '#fca5a5' }}>
            ❌ Error: {error}
          </div>
        )}

        {data && (
          <>
            {/* Status Bar */}
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#94a3b8', marginBottom: '8px' }}>PIPELINE STATUS</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                <div>{s(data.db.schema.hasPanels)} DB: panels column</div>
                <div>{s(data.db.schema.hasRoofPlanes)} DB: roof_planes column</div>
                <div>{s(data.db.schema.hasMapCenter)} DB: map_center column</div>
                <div>{s(data.db.totalLayouts > 0)} DB: layouts exist ({data.db.totalLayouts} total)</div>
                {data.specificLayout && (
                  <>
                    <div>{s(data.specificLayout.panelCount > 0)} Layout: has panels ({data.specificLayout.panelCount})</div>
                    <div>{s(data.specificLayout.hasRoofPlanes)} Layout: has roof planes ({data.specificLayout.roofPlaneCount})</div>
                    <div>{s(data.specificLayout.samplePanels?.[0]?.lat)} Panel: has lat/lng</div>
                  </>
                )}
              </div>
            </div>

            {/* DB Schema */}
            <Section title="1. DB SCHEMA — layouts table">
              <Row label="Columns" value={data.db.schema.columns.join(', ')} />
              <Row label="panels column" value={s(data.db.schema.hasPanels)} />
              <Row label="roof_planes column" value={s(data.db.schema.hasRoofPlanes)} />
              <Row label="map_center column" value={s(data.db.schema.hasMapCenter)} />
              <Row label="Total layouts in DB" value={String(data.db.totalLayouts)} />
            </Section>

            {/* All Layouts */}
            <Section title="2. ALL LAYOUTS (most recent 20)">
              {data.db.allLayouts.length === 0 ? (
                <div style={{ color: '#ef4444' }}>❌ NO LAYOUTS FOUND — nothing has been saved to DB</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ color: '#64748b', borderBottom: '1px solid #334155' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>Project</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>Panels</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>Roof Planes</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>kW</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.db.allLayouts.map((l, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '4px 8px' }}>
                          <div style={{ color: '#94a3b8' }}>{l.project_name || '(unnamed)'}</div>
                          <div style={{ color: '#475569', fontSize: '10px' }}>{l.project_id}</div>
                        </td>
                        <td style={{ padding: '4px 8px', color: l.panel_count > 0 ? '#4ade80' : '#ef4444' }}>
                          {l.panel_count}
                        </td>
                        <td style={{ padding: '4px 8px', color: l.roof_planes_status.includes('planes') ? '#4ade80' : '#ef4444' }}>
                          {l.roof_planes_status}
                        </td>
                        <td style={{ padding: '4px 8px' }}>{l.system_size_kw}</td>
                        <td style={{ padding: '4px 8px', color: '#64748b' }}>
                          {new Date(l.updated_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            {/* Specific Project */}
            {data.specificProject && (
              <Section title="3. SPECIFIC PROJECT">
                <Row label="ID" value={data.specificProject.id} />
                <Row label="Name" value={data.specificProject.name} />
                <Row label="Address" value={data.specificProject.address} />
                <Row label="System Type" value={data.specificProject.system_type} />
              </Section>
            )}

            {/* Specific Layout */}
            {data.specificLayout ? (
              <Section title="4. SPECIFIC LAYOUT — DB RAW DATA">
                <Row label="Layout ID" value={data.specificLayout.id} />
                <Row label="Panel Count (jsonb)" value={String(data.specificLayout.panelCount)} />
                <Row label="Total Panels (column)" value={String(data.specificLayout.totalPanels)} />
                <Row label="System Size kW" value={String(data.specificLayout.systemSizeKw)} />
                <Row label="Roof Plane Count" value={String(data.specificLayout.roofPlaneCount)} />
                <Row label="Has Roof Planes" value={s(data.specificLayout.hasRoofPlanes)} />
                <Row label="Updated At" value={new Date(data.specificLayout.updatedAt).toLocaleString()} />

                {data.specificLayout.samplePanels?.length > 0 && (
                  <>
                    <div style={{ marginTop: '12px', color: '#64748b', fontSize: '12px' }}>SAMPLE PANELS (first 3):</div>
                    {data.specificLayout.samplePanels.map((p: any, i: number) => (
                      <div key={i} style={{ marginLeft: '16px', fontSize: '12px', color: '#94a3b8' }}>
                        [{i}] lat={p.lat ?? '❌MISSING'} lng={p.lng ?? '❌MISSING'} tilt={p.tilt} az={p.azimuth}
                      </div>
                    ))}
                  </>
                )}

                {data.specificLayout.sampleRoofPlane && (
                  <>
                    <div style={{ marginTop: '12px', color: '#64748b', fontSize: '12px' }}>SAMPLE ROOF PLANE:</div>
                    <div style={{ marginLeft: '16px', fontSize: '12px', color: '#94a3b8' }}>
                      id={data.specificLayout.sampleRoofPlane.id} pitch={data.specificLayout.sampleRoofPlane.pitch} 
                      az={data.specificLayout.sampleRoofPlane.azimuth} vertices={data.specificLayout.sampleRoofPlane.vertexCount}
                    </div>
                  </>
                )}
              </Section>
            ) : projectId ? (
              <Section title="4. SPECIFIC LAYOUT">
                <div style={{ color: '#ef4444' }}>❌ No layout found for project ID: {projectId}</div>
              </Section>
            ) : null}

            {/* Raw JSON */}
            <Section title="5. RAW API RESPONSE">
              <pre style={{ fontSize: '11px', color: '#64748b', overflow: 'auto', maxHeight: '300px' }}>
                {JSON.stringify(data, null, 2)}
              </pre>
            </Section>
          </>
        )}

        <div style={{ marginTop: '32px', fontSize: '11px', color: '#334155', textAlign: 'center' }}>
          ⚠️ Debug page — remove app/debug/project/ and app/api/debug/layout/ when done
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#64748b', marginBottom: '10px', letterSpacing: '0.05em' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '16px', marginBottom: '4px', fontSize: '12px' }}>
      <span style={{ color: '#64748b', minWidth: '200px' }}>{label}:</span>
      <span style={{ color: '#e2e8f0' }}>{value}</span>
    </div>
  );
}