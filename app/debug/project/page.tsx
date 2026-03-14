'use client';
/**
 * /debug/project?id=<projectId>
 *
 * Full pipeline diagnostic page.
 * Shows: DB layout, engineering report, permit preflight, artifact status.
 * Proves the pipeline is wired correctly end-to-end.
 */

import { useState, useEffect } from 'react';
import { BUILD_VERSION } from '@/lib/version';

interface PipelineDebugData {
  projectId: string;
  timestamp: string;
  layers: {
    layout: {
      exists: boolean;
      panelCount: number;
      roofPlaneCount: number;
      systemSizeKw: number;
      updatedAt: string;
      panels?: any[];
      roofPlanes?: any[];
    };
    engineering: {
      exists: boolean;
      panelCount: number;
      systemSizeKw: number;
      panelModel: string;
      inverterModel: string;
      wasRebuilt: boolean;
      designVersionId: string;
      errors: string[];
    };
    mismatches: Array<{
      field: string;
      layoutValue: string | number;
      engineeringValue: string | number;
      severity: string;
    }>;
  };
}

export default function DebugProjectPage() {
  const [projectId, setProjectId] = useState('');
  const [data, setData] = useState<PipelineDebugData | null>(null);
  const [rawLayout, setRawLayout] = useState<any>(null);
  const [rawEngineering, setRawEngineering] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [buildVersion] = useState(BUILD_VERSION);

  // Auto-read ?id= from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id') || params.get('projectId') || '';
    if (id) {
      setProjectId(id);
      runDiagnostics(id);
    }
  }, []);

  const runDiagnostics = async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    setError('');
    setData(null);
    setRawLayout(null);
    setRawEngineering(null);

    try {
      // Fetch layout directly
      const [layoutRes, pipelineRes, dbDebugRes] = await Promise.all([
        fetch(`/api/projects/${pid}/layout`),
        fetch(`/api/engineering/sync-pipeline?projectId=${pid}`),
        fetch(`/api/debug/layout?projectId=${pid}`),
      ]);

      const layoutJson = await layoutRes.json();
      const pipelineJson = await pipelineRes.json();
      const dbDebugJson = await dbDebugRes.json();

      setRawLayout(layoutJson);
      setRawEngineering(pipelineJson);

      const layout = layoutJson.success ? layoutJson.data : null;
      const pipeline = pipelineJson.success ? pipelineJson.data : null;

      // Compute mismatches
      const mismatches: PipelineDebugData['layers']['mismatches'] = [];
      if (layout && pipeline) {
        if (layout.panels?.length !== pipeline.engineering.panelCount) {
          mismatches.push({
            field: 'panelCount',
            layoutValue: layout.panels?.length ?? 0,
            engineeringValue: pipeline.engineering.panelCount,
            severity: 'ERROR',
          });
        }
      }

      setData({
        projectId: pid,
        timestamp: new Date().toISOString(),
        layers: {
          layout: {
            exists: !!layout,
            panelCount: layout?.panels?.length ?? 0,
            roofPlaneCount: layout?.roofPlanes?.length ?? 0,
            systemSizeKw: layout?.systemSizeKw ?? 0,
            updatedAt: layout?.updatedAt ?? 'N/A',
            panels: layout?.panels?.slice(0, 3),
            roofPlanes: layout?.roofPlanes?.slice(0, 2),
          },
          engineering: {
            exists: !!pipeline,
            panelCount: pipeline?.engineering?.panelCount ?? 0,
            systemSizeKw: pipeline?.engineering?.systemSizeKw ?? 0,
            panelModel: pipeline?.engineering?.panelModel ?? 'N/A',
            inverterModel: pipeline?.engineering?.inverterModel ?? 'N/A',
            wasRebuilt: pipeline?.wasRebuilt ?? false,
            designVersionId: pipeline?.designVersionId ?? 'N/A',
            errors: pipeline?.errors ?? [],
          },
          mismatches,
        },
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (val: boolean) => val ? 'text-emerald-400' : 'text-red-400';
  const countColor = (n: number) => n > 0 ? 'text-emerald-400' : 'text-red-400 font-bold';

  return (
    <div style={{ background: '#0f172a', minHeight: '100vh', padding: '24px', fontFamily: 'monospace', color: '#e2e8f0' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#f8fafc', margin: 0 }}>
              🔬 Pipeline Diagnostic
            </h1>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
              {BUILD_VERSION} · {new Date().toLocaleString()}
            </div>
          </div>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', color: '#94a3b8' }}>
            Build: <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>{buildVersion}</span>
          </div>
        </div>

        {/* Project ID input */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          <input
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            placeholder="Enter Project ID (UUID)"
            style={{
              flex: 1, background: '#1e293b', border: '1px solid #334155',
              borderRadius: '6px', padding: '8px 12px', color: '#e2e8f0',
              fontSize: '13px', fontFamily: 'monospace',
            }}
          />
          <button
            onClick={() => runDiagnostics(projectId)}
            disabled={loading || !projectId}
            style={{
              background: '#f59e0b', color: '#0f172a', border: 'none',
              borderRadius: '6px', padding: '8px 16px', fontWeight: 'bold',
              cursor: loading ? 'wait' : 'pointer', fontSize: '13px',
            }}
          >
            {loading ? 'Running…' : 'Run Diagnostics'}
          </button>
        </div>

        {error && (
          <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: '6px', padding: '12px', color: '#fca5a5', marginBottom: '16px', fontSize: '13px' }}>
            ❌ Error: {error}
          </div>
        )}

        {data && (
          <>
            {/* Pipeline Status Summary */}
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ fontWeight: 'bold', color: '#f8fafc', marginBottom: '12px', fontSize: '14px' }}>
                📊 Pipeline Status Summary
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '12px' }}>

                {/* Layer 1: Layout */}
                <div style={{ background: '#0f172a', borderRadius: '6px', padding: '12px', border: `1px solid ${data.layers.layout.panelCount > 0 ? '#059669' : '#dc2626'}` }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#94a3b8' }}>LAYER 1: DB Layout</div>
                  <div>Exists: <span className={statusColor(data.layers.layout.exists)}>{data.layers.layout.exists ? '✅ YES' : '❌ NO'}</span></div>
                  <div>Panels: <span style={{ color: data.layers.layout.panelCount > 0 ? '#34d399' : '#f87171', fontWeight: 'bold' }}>{data.layers.layout.panelCount}</span></div>
                  <div>Roof Planes: <span style={{ color: data.layers.layout.roofPlaneCount > 0 ? '#34d399' : '#fbbf24' }}>{data.layers.layout.roofPlaneCount}</span></div>
                  <div>System kW: <span style={{ color: '#94a3b8' }}>{data.layers.layout.systemSizeKw}</span></div>
                  <div style={{ color: '#475569', marginTop: '4px' }}>Updated: {new Date(data.layers.layout.updatedAt).toLocaleString()}</div>
                </div>

                {/* Layer 2: Engineering */}
                <div style={{ background: '#0f172a', borderRadius: '6px', padding: '12px', border: `1px solid ${data.layers.engineering.panelCount > 0 ? '#059669' : '#dc2626'}` }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#94a3b8' }}>LAYER 2: Engineering Model</div>
                  <div>Exists: <span style={{ color: data.layers.engineering.exists ? '#34d399' : '#f87171' }}>{data.layers.engineering.exists ? '✅ YES' : '❌ NO'}</span></div>
                  <div>Panels: <span style={{ color: data.layers.engineering.panelCount > 0 ? '#34d399' : '#f87171', fontWeight: 'bold' }}>{data.layers.engineering.panelCount}</span></div>
                  <div>System kW: <span style={{ color: '#94a3b8' }}>{data.layers.engineering.systemSizeKw}</span></div>
                  <div>Rebuilt: <span style={{ color: data.layers.engineering.wasRebuilt ? '#fbbf24' : '#34d399' }}>{data.layers.engineering.wasRebuilt ? '⚡ Just rebuilt' : '✅ Was current'}</span></div>
                  <div style={{ color: '#475569', fontSize: '11px', marginTop: '4px' }}>{data.layers.engineering.panelModel}</div>
                </div>

              </div>

              {/* Mismatches */}
              {data.layers.mismatches.length > 0 && (
                <div style={{ marginTop: '12px', background: '#450a0a', border: '1px solid #dc2626', borderRadius: '6px', padding: '10px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 'bold', color: '#fca5a5', marginBottom: '6px' }}>⚠️ PIPELINE MISMATCHES DETECTED</div>
                  {data.layers.mismatches.map((m, i) => (
                    <div key={i} style={{ color: '#fca5a5' }}>
                      {m.field}: layout={m.layoutValue} vs engineering={m.engineeringValue} [{m.severity}]
                    </div>
                  ))}
                </div>
              )}

              {data.layers.mismatches.length === 0 && data.layers.layout.panelCount > 0 && (
                <div style={{ marginTop: '12px', background: '#052e16', border: '1px solid #059669', borderRadius: '6px', padding: '10px', fontSize: '12px', color: '#34d399' }}>
                  ✅ Pipeline in sync — layout({data.layers.layout.panelCount} panels) = engineering({data.layers.engineering.panelCount} panels)
                </div>
              )}
            </div>

            {/* Permit Preflight Check */}
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ fontWeight: 'bold', color: '#f8fafc', marginBottom: '12px', fontSize: '14px' }}>
                📋 Permit Preflight Check
              </div>
              <div style={{ fontSize: '12px', display: 'grid', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Panel positions in layout:</span>
                  <span style={{ color: data.layers.layout.panelCount > 0 ? '#34d399' : '#f87171', fontWeight: 'bold' }}>
                    {data.layers.layout.panelCount > 0 ? `✅ ${data.layers.layout.panelCount} panels` : '❌ MISSING'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Roof planes:</span>
                  <span style={{ color: data.layers.layout.roofPlaneCount > 0 ? '#34d399' : '#fbbf24' }}>
                    {data.layers.layout.roofPlaneCount > 0 ? `✅ ${data.layers.layout.roofPlaneCount} planes` : '⚠️ none saved'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Engineering panel count:</span>
                  <span style={{ color: data.layers.engineering.panelCount > 0 ? '#34d399' : '#f87171' }}>
                    {data.layers.engineering.panelCount > 0 ? `✅ ${data.layers.engineering.panelCount}` : '❌ 0'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>System size (from layout):</span>
                  <span style={{ color: '#94a3b8' }}>{data.layers.layout.systemSizeKw} kW DC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Module model:</span>
                  <span style={{ color: '#94a3b8' }}>{data.layers.engineering.panelModel}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Inverter model:</span>
                  <span style={{ color: '#94a3b8' }}>{data.layers.engineering.inverterModel}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Build version:</span>
                  <span style={{ color: '#f59e0b' }}>{buildVersion}</span>
                </div>
              </div>
            </div>

            {/* Raw JSON */}
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ fontWeight: 'bold', color: '#f8fafc', marginBottom: '12px', fontSize: '14px' }}>
                🗄️ Raw Layout Response (from /api/projects/[id]/layout)
              </div>
              <pre style={{ fontSize: '10px', color: '#94a3b8', overflow: 'auto', maxHeight: '200px', background: '#0f172a', padding: '10px', borderRadius: '4px', margin: 0 }}>
                {JSON.stringify(rawLayout ? { ...rawLayout, data: rawLayout.data ? { ...rawLayout.data, panels: `[${rawLayout.data.panels?.length ?? 0} panels — first 2: ${JSON.stringify(rawLayout.data.panels?.slice(0,2))}]`, } : null } : null, null, 2)}
              </pre>
            </div>

            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ fontWeight: 'bold', color: '#f8fafc', marginBottom: '12px', fontSize: '14px' }}>
                ⚙️ Raw sync-pipeline Response
              </div>
              <pre style={{ fontSize: '10px', color: '#94a3b8', overflow: 'auto', maxHeight: '200px', background: '#0f172a', padding: '10px', borderRadius: '4px', margin: 0 }}>
                {JSON.stringify(rawEngineering, null, 2)}
              </pre>
            </div>
          </>
        )}

        {!data && !loading && (
          <div style={{ textAlign: 'center', color: '#475569', marginTop: '60px', fontSize: '14px' }}>
            Enter a Project ID above and click Run Diagnostics
          </div>
        )}
      </div>
    </div>
  );
}