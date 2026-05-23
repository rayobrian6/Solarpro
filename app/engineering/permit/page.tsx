'use client';
// ============================================================
// app/engineering/permit/page.tsx
// Permit Plan Viewer — /engineering/permit?projectId=xxx
//
// Features:
//   - Sheet navigation (all 11 permit sheets)
//   - Iframe preview of rendered HTML per sheet
//   - Zoom controls
//   - PDF export (downloads from /api/engineering/permit)
//   - "Run Pipeline" shortcut to generate/refresh artifacts
// ============================================================

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import AppShell from '@/components/ui/AppShell';
import {
  FileText, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Download, RefreshCw, AlertTriangle, Loader2, ExternalLink,
  Home, ChevronDown,
} from 'lucide-react';
import { PERMIT_SHEET_INDEX } from '@/lib/permit/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectInfo {
  id:   string;
  name: string;
}

// ── Sheet nav item ─────────────────────────────────────────────────────────────

function SheetNavItem({
  id, title, description, active, onClick,
}: {
  id: string; title: string; description?: string;
  active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`sheet-nav-item ${active ? 'active' : ''}`}
    >
      <span className="sheet-nav-id">{id}</span>
      <div className="sheet-nav-info">
        <div className="sheet-nav-title">{title}</div>
        {description && <div className="sheet-nav-desc">{description}</div>}
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function PermitViewerPageInner() {
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const iframeRef     = useRef<HTMLIFrameElement>(null);

  const projectId     = searchParams.get('projectId') ?? '';
  const [project, setProject]         = useState<ProjectInfo | null>(null);
  // v47.259: Default to PV-0 (14-sheet canonical permit system)
  const [activeSheet, setActiveSheet] = useState<string>('PV-0');
  const [zoom, setZoom]               = useState<number>(1.0);
  const [loading, setLoading]         = useState<boolean>(false);
  const [previewUrl, setPreviewUrl]   = useState<string>('');
  const [error, setError]             = useState<string>('');
  const [running]                     = useState<boolean>(false);

  const activeIndex = PERMIT_SHEET_INDEX.findIndex(s => s.id === activeSheet);

  // ── Load project info ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/engineering/latest-run?projectId=${projectId}`)
      .then(r => r.json())
      .then(data => {
        if (data.projectName) {
          setProject({ id: projectId, name: data.projectName });
        }
      })
      .catch(() => {});
  }, [projectId]);

  // ── Build preview URL when sheet changes ─────────────────────────────────

  useEffect(() => {
    if (!projectId) {
      setError('No projectId in URL. Navigate here from a project.');
      return;
    }
    setPreviewUrl(`/api/engineering/permit-preview?projectId=${projectId}&sheet=${activeSheet}`);
    setError('');
  }, [projectId, activeSheet]);

  // ── Iframe load handlers ──────────────────────────────────────────────────

  const handleIframeLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const handleIframeLoadStart = useCallback(() => {
    setLoading(true);
  }, []);

  // ── Sheet navigation ──────────────────────────────────────────────────────

  const goToSheet = useCallback((id: string) => {
    setActiveSheet(id);
    setLoading(true);
  }, []);

  const goPrev = useCallback(() => {
    if (activeIndex > 0) goToSheet(PERMIT_SHEET_INDEX[activeIndex - 1].id);
  }, [activeIndex, goToSheet]);

  const goNext = useCallback(() => {
    if (activeIndex < PERMIT_SHEET_INDEX.length - 1) goToSheet(PERMIT_SHEET_INDEX[activeIndex + 1].id);
  }, [activeIndex, goToSheet]);

  // ── Zoom ─────────────────────────────────────────────────────────────────

  const zoomIn  = () => setZoom(z => Math.min(z + 0.1, 2.0));
  const zoomOut = () => setZoom(z => Math.max(z - 0.1, 0.4));
  const zoomReset = () => setZoom(1.0);

  // ── PDF Export ────────────────────────────────────────────────────────────

  const handleExportPDF = useCallback(async () => {
    if (!projectId) return;
    // Fetch with error handling so we can catch PERMIT_STALE (409) gracefully
    const res = await fetch(`/api/engineering/permit?projectId=${projectId}&format=pdf`);
    if (res.status === 409) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'PERMIT_STALE') {
        alert(`\u26a0\ufe0f Permit Package Outdated\n\n${errData.error}\n\nClick "Generate Permit" to regenerate with the latest fixes.`);
        return;
      }
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      alert(`Download failed (${res.status}). Please regenerate the permit package.\n\n${errText.slice(0, 200)}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const contentType = res.headers.get('Content-Type') || '';
    link.download = contentType.includes('text/html')
      ? `PermitPackage-${projectId}.html`
      : `Permit_Planset_${projectId}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }, [projectId]);

  // ── Run Pipeline ─────────────────────────────────────────────────────────

  // Navigate to the Engineering page to regenerate the permit
  const handleRunPipeline = useCallback(() => {
    if (!projectId) return;
    router.push(`/engineering?projectId=${projectId}`);
  }, [projectId, router]);

  // Reload the current sheet preview (e.g. after permit generation)
  const handleRefreshPreview = useCallback(() => {
    if (!projectId) return;
    setPreviewUrl(`/api/engineering/permit-preview?projectId=${projectId}&sheet=${activeSheet}&t=${Date.now()}`);
  }, [projectId, activeSheet]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="permit-viewer">

        {/* ── TOP BAR ─────────────────────────────────────────────────── */}
        <div className="pv-topbar">
          <div className="pv-topbar-left">
            <button className="pv-back-btn" onClick={() => router.back()}>
              <ChevronLeft size={16} />
            </button>
            <FileText size={18} style={{ color: '#f59e0b' }} />
            <span className="pv-project-name">
              {project?.name ?? (projectId ? `Project ${projectId.slice(0, 8)}…` : 'Permit Plan Set')}
            </span>
            <span className="pv-badge">PERMIT PLAN SET</span>
          </div>

          <div className="pv-topbar-right">
            <button
              className="pv-btn pv-btn-secondary"
              onClick={handleRefreshPreview}
              disabled={!projectId}
              title="Reload the current sheet preview"
            >
              <RefreshCw size={14} />
              Refresh
            </button>

            <button
              className="pv-btn pv-btn-secondary"
              onClick={() => projectId && router.push(`/admin/engineering-intelligence/project/${projectId}`)}
              disabled={!projectId}
              title="Open deterministic project Engineering Intelligence workspace"
            >
              <ExternalLink size={14} />
              Intelligence
            </button>

            <button
              className="pv-btn pv-btn-secondary"
              onClick={handleRunPipeline}
              disabled={!projectId}
              title="Go to Engineering page to regenerate the permit package"
            >
              <ExternalLink size={14} />
              Generate Permit
            </button>

            <button
              className="pv-btn pv-btn-primary"
              onClick={handleExportPDF}
              disabled={!projectId}
              title="Download full permit plan set as PDF"
            >
              <Download size={14} />
              Export PDF
            </button>
          </div>
        </div>

        {/* ── MAIN LAYOUT ─────────────────────────────────────────────── */}
        <div className="pv-layout">

          {/* Sheet navigation sidebar */}
          <div className="pv-sidebar">
            <div className="pv-sidebar-header">SHEET INDEX</div>
            {PERMIT_SHEET_INDEX.map(s => (
              <SheetNavItem
                key={s.id}
                id={s.id}
                title={s.title}
                description={s.description}
                active={s.id === activeSheet}
                onClick={() => goToSheet(s.id)}
              />
            ))}
          </div>

          {/* Preview area */}
          <div className="pv-preview-area">

            {/* Sheet toolbar */}
            <div className="pv-sheet-toolbar">
              <div className="pv-sheet-nav">
                <button
                  className="pv-icon-btn"
                  onClick={goPrev}
                  disabled={activeIndex === 0}
                  title="Previous sheet"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="pv-sheet-indicator">
                  {activeSheet} — {PERMIT_SHEET_INDEX[activeIndex]?.title ?? ''}
                  &nbsp;&nbsp;
                  <span className="pv-sheet-count">
                    {activeIndex + 1} / {PERMIT_SHEET_INDEX.length}
                  </span>
                </span>
                <button
                  className="pv-icon-btn"
                  onClick={goNext}
                  disabled={activeIndex === PERMIT_SHEET_INDEX.length - 1}
                  title="Next sheet"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="pv-zoom-controls">
                <button className="pv-icon-btn" onClick={zoomOut} title="Zoom out">
                  <ZoomOut size={14} />
                </button>
                <button className="pv-zoom-label" onClick={zoomReset} title="Reset zoom">
                  {Math.round(zoom * 100)}%
                </button>
                <button className="pv-icon-btn" onClick={zoomIn} title="Zoom in">
                  <ZoomIn size={14} />
                </button>
                <a
                  className="pv-icon-btn"
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in new tab"
                >
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>

            {/* Error banner */}
            {error && (
              <div className="pv-error-banner">
                <AlertTriangle size={14} />
                &nbsp;{error}
              </div>
            )}

            {/* Loading indicator overlay */}
            {loading && (
              <div className="pv-loading-overlay">
                <Loader2 size={24} className="spin" />
                <span>Loading sheet…</span>
              </div>
            )}

            {/* Sheet iframe */}
            {previewUrl && !error && (
              <div
                className="pv-iframe-container"
                style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
              >
                <iframe
                  ref={iframeRef}
                  src={previewUrl}
                  className="pv-iframe"
                  title={`Permit Sheet ${activeSheet}`}
                  onLoadStart={handleIframeLoadStart}
                  onLoad={handleIframeLoad}
                  sandbox="allow-same-origin allow-scripts"
                />
              </div>
            )}

            {!previewUrl && !error && (
              <div className="pv-empty-state">
                <FileText size={40} style={{ color: '#444' }} />
                <p>Select a sheet from the sidebar to preview it.</p>
              </div>
            )}
          </div>
        </div>

        {/* ── STYLES ──────────────────────────────────────────────────── */}
        <style>{`
          .permit-viewer {
            display: flex;
            flex-direction: column;
            height: 100vh;
            background: #111;
            color: #e5e7eb;
            font-family: Arial, Helvetica, sans-serif;
            overflow: hidden;
          }

          /* Top bar */
          .pv-topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 16px;
            height: 52px;
            background: #1a1a1a;
            border-bottom: 2px solid #f59e0b;
            flex-shrink: 0;
          }
          .pv-topbar-left  { display: flex; align-items: center; gap: 10px; }
          .pv-topbar-right { display: flex; align-items: center; gap: 8px; }

          .pv-back-btn {
            background: #333; border: none; color: #ccc; border-radius: 4px;
            width: 28px; height: 28px; cursor: pointer; display: flex;
            align-items: center; justify-content: center;
          }
          .pv-back-btn:hover { background: #444; }

          .pv-project-name {
            font-size: 14px; font-weight: 700; color: #fff;
          }
          .pv-badge {
            background: #f59e0b; color: #1a1a1a; font-size: 10px;
            font-weight: 700; padding: 2px 6px; border-radius: 3px;
            letter-spacing: 0.5px;
          }

          .pv-run-status {
            font-size: 11px; color: #aaa; display: flex; align-items: center; gap: 4px;
          }
          .pv-run-status.running { color: #f59e0b; }

          .pv-btn {
            display: flex; align-items: center; gap: 6px;
            padding: 6px 12px; border-radius: 5px; border: none;
            font-size: 12px; font-weight: 600; cursor: pointer;
            transition: background 0.15s;
          }
          .pv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .pv-btn-secondary { background: #333; color: #ccc; }
          .pv-btn-secondary:hover:not(:disabled) { background: #444; }
          .pv-btn-primary { background: #f59e0b; color: #1a1a1a; }
          .pv-btn-primary:hover:not(:disabled) { background: #fbbf24; }

          /* Layout */
          .pv-layout {
            display: flex;
            flex: 1;
            overflow: hidden;
          }

          /* Sidebar */
          .pv-sidebar {
            width: 220px;
            background: #1a1a1a;
            border-right: 1px solid #333;
            overflow-y: auto;
            flex-shrink: 0;
          }
          .pv-sidebar-header {
            padding: 10px 12px;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 1.5px;
            color: #666;
            text-transform: uppercase;
            border-bottom: 1px solid #333;
          }
          .sheet-nav-item {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            width: 100%;
            padding: 8px 12px;
            background: none;
            border: none;
            border-bottom: 1px solid #222;
            color: #aaa;
            cursor: pointer;
            text-align: left;
            transition: background 0.1s;
          }
          .sheet-nav-item:hover { background: #252525; color: #ddd; }
          .sheet-nav-item.active {
            background: #2a2000;
            border-left: 3px solid #f59e0b;
            color: #fff;
          }
          .sheet-nav-id {
            font-size: 9px;
            font-weight: 700;
            color: #f59e0b;
            min-width: 34px;
            padding-top: 1px;
            letter-spacing: 0.5px;
          }
          .sheet-nav-info { flex: 1; }
          .sheet-nav-title { font-size: 11px; font-weight: 600; }
          .sheet-nav-desc  { font-size: 9px; color: #666; margin-top: 1px; }

          /* Preview area */
          .pv-preview-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
            background: #2a2a2a;
          }

          /* Sheet toolbar */
          .pv-sheet-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 12px;
            background: #1e1e1e;
            border-bottom: 1px solid #333;
            flex-shrink: 0;
          }
          .pv-sheet-nav   { display: flex; align-items: center; gap: 8px; }
          .pv-zoom-controls { display: flex; align-items: center; gap: 4px; }

          .pv-sheet-indicator {
            font-size: 12px; font-weight: 600; color: #ddd;
          }
          .pv-sheet-count { color: #666; font-size: 11px; }

          .pv-icon-btn {
            background: #333; border: none; color: #ccc; border-radius: 4px;
            width: 26px; height: 26px; cursor: pointer; display: flex;
            align-items: center; justify-content: center;
            text-decoration: none;
          }
          .pv-icon-btn:hover:not(:disabled) { background: #444; color: #fff; }
          .pv-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

          .pv-zoom-label {
            background: #222; border: 1px solid #444; color: #ccc;
            border-radius: 3px; padding: 2px 8px; font-size: 11px;
            cursor: pointer; min-width: 44px; text-align: center;
          }
          .pv-zoom-label:hover { background: #333; }

          /* Error banner */
          .pv-error-banner {
            display: flex; align-items: center; gap: 6px;
            background: #3a1a00; border-bottom: 1px solid #f59e0b;
            color: #fbbf24; padding: 8px 14px; font-size: 12px;
          }

          /* Loading overlay */
          .pv-loading-overlay {
            position: absolute;
            top: 40px; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.6);
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 10px; color: #aaa; font-size: 13px;
            z-index: 10;
          }

          /* Iframe container */
          .pv-iframe-container {
            flex: 1;
            overflow: auto;
            width: 100%;
            height: 100%;
          }
          .pv-iframe {
            width: 100%;
            height: 100%;
            min-height: 900px;
            border: none;
            background: #fff;
            display: block;
          }

          /* Empty state */
          .pv-empty-state {
            flex: 1; display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 12px; color: #555; font-size: 13px;
          }

          /* Spin animation */
          @keyframes spin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }
          .spin { animation: spin 1s linear infinite; }
        `}</style>
      </div>
    </AppShell>
  );
}

// ── Default export with Suspense boundary ────────────────────────────────────
export default function PermitViewerPage() {
  return (
    <Suspense fallback={
      <div style={{ background: '#111', color: '#aaa', height: '100vh',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'Arial', fontSize: '14px' }}>
        Loading permit viewer…
      </div>
    }>
      <PermitViewerPageInner />
    </Suspense>
  );
}
