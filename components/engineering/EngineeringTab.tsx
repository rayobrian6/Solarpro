'use client';
// ============================================================
// Engineering Tab — Project Dashboard
// Shows auto-generated engineering report derived from design engine
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, FileText, Download, RefreshCw, CheckCircle, AlertTriangle,
  Clock, ChevronDown, ChevronRight, Shield, Wind, Snowflake,
  Cpu, Package, Ruler, Home, Sun, Activity, ClipboardList,
  ExternalLink, Info, BarChart2, Layers, Grid, FolderOpen, Eye
} from 'lucide-react';
import type { EngineeringReport } from '@/lib/engineering/types';

interface ProjectFile {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number | null;
  mime_type: string | null;
  upload_date: string;
  notes: string | null;
}

interface EngineeringTabProps {
  projectId: string;
  projectName?: string;
  onGenerateProposal?: () => void;
}

type SectionKey = 'summary' | 'electrical' | 'structural' | 'equipment' | 'permit';

export default function EngineeringTab({ projectId, projectName }: EngineeringTabProps) {
  const [report, setReport] = useState<EngineeringReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [needsDesign, setNeedsDesign] = useState(false);
  const [preliminaryFiles, setPreliminaryFiles] = useState<ProjectFile[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(
    new Set(['summary', 'electrical'])
  );

  const fetchPreliminaryFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/project-files?projectId=${projectId}`);
      const data = await res.json();
      if (data.success) {
        // Show engineering + utility_bill files as preliminary packet
        const relevant = (data.data || []).filter((f: ProjectFile) =>
          f.file_type === 'engineering' || f.file_type === 'utility_bill'
        );
        setPreliminaryFiles(relevant);
      }
    } catch { /* ignore */ }
  }, [projectId]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsDesign(false);
    try {
      const res = await fetch(`/api/engineering/report?projectId=${projectId}`);
      const data = await res.json();
      if (data.success) {
        setReport(data.data.report);
        setIsStale(data.data.isStale || false);
      } else if (data.needsDesign) {
        setNeedsDesign(true);
        setError('No panel layout found. Please place panels in the Design Studio first.');
        // Load any preliminary files saved during bill upload
        await fetchPreliminaryFiles();
      } else {
        setError(data.error || 'Failed to load engineering report');
      }
    } catch (e) {
      setError('Failed to connect to engineering service');
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchPreliminaryFiles]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleRegenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/engineering/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, force: true }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchReport();
        setIsStale(false);
      } else {
        setError(data.error || 'Regeneration failed');
      }
    } catch (e) {
      setError('Failed to regenerate engineering report');
    } finally {
      setGenerating(false);
    }
  };

  const toggleSection = (key: SectionKey) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDownload = () => {
    if (!report) return;
    const ss = report.systemSummary;
    const el = report.electrical;
    const st = report.structural;
    const eq = report.equipmentSchedule;
    const pp = report.permitPackage;
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Engineering Report — ${projectName || projectId}</title>
<style>
  @page { size: letter; margin: 0.75in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1e293b; background: #fff; }
  .cover { text-align: center; padding: 60px 0 40px; border-bottom: 3px solid #f59e0b; margin-bottom: 32px; }
  .cover h1 { font-size: 24pt; font-weight: 900; color: #0f172a; }
  .cover h2 { font-size: 14pt; color: #64748b; margin-top: 8px; }
  .cover .meta { margin-top: 20px; font-size: 9pt; color: #94a3b8; }
  .cover .badge { display: inline-block; background: #f59e0b; color: #fff; font-weight: 700; font-size: 9pt; padding: 4px 12px; border-radius: 20px; margin-top: 12px; }
  h2.section { font-size: 13pt; font-weight: 800; color: #0f172a; border-bottom: 2px solid #f59e0b; padding-bottom: 6px; margin: 28px 0 14px; page-break-after: avoid; }
  h3.sub { font-size: 10pt; font-weight: 700; color: #334155; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 9.5pt; }
  th { background: #1e293b; color: #fff; padding: 7px 10px; text-align: left; font-weight: 700; font-size: 9pt; }
  td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; }
  .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 16px; }
  .kv { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #e2e8f0; font-size: 9.5pt; }
  .kv .label { color: #64748b; }
  .kv .value { font-weight: 600; color: #0f172a; }
  .pass { color: #16a34a; font-weight: 700; }
  .warn { color: #d97706; font-weight: 700; }
  .fail { color: #dc2626; font-weight: 700; }
  .badge-pass { background: #dcfce7; color: #16a34a; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 8.5pt; }
  .badge-warn { background: #fef3c7; color: #d97706; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 8.5pt; }
  .badge-fail { background: #fee2e2; color: #dc2626; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 8.5pt; }
  .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 8pt; color: #94a3b8; text-align: center; }
  .page-break { page-break-before: always; }
  .highlight-box { background: #fffbeb; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }
  .highlight-box .title { font-weight: 700; color: #92400e; font-size: 9pt; margin-bottom: 6px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>

<!-- COVER -->
<div class="cover">
  <div class="badge">⚡ ENGINEERING REPORT</div>
  <h1>${projectName || 'Solar PV System'}</h1>
  <h2>${ss?.address || ''}</h2>
  <div class="meta">
    Generated: ${now} &nbsp;|&nbsp; 
    System: ${ss?.systemSizeKw?.toFixed(2) || '—'} kW DC &nbsp;|&nbsp; 
    ${ss?.panelCount || '—'} Panels &nbsp;|&nbsp;
    ${ss?.mountType || 'Roof Mount'}
  </div>
</div>

<!-- SYSTEM SUMMARY -->
<h2 class="section">1. System Summary</h2>
<div class="kv-grid">
  <div>
    <div class="kv"><span class="label">System Size (DC)</span><span class="value">${ss?.systemSizeKw?.toFixed(2) || '—'} kW</span></div>
    <div class="kv"><span class="label">Panel Count</span><span class="value">${ss?.panelCount || '—'} panels</span></div>
    <div class="kv"><span class="label">Panel Model</span><span class="value">${ss?.panelModel || '—'}</span></div>
    <div class="kv"><span class="label">Inverter</span><span class="value">${ss?.inverterModel || '—'}</span></div>
    <div class="kv"><span class="label">Mount Type</span><span class="value">${ss?.mountType || '—'}</span></div>
  </div>
  <div>
    <div class="kv"><span class="label">Address</span><span class="value">${ss?.address || '—'}</span></div>
    <div class="kv"><span class="label">AHJ</span><span class="value">${ss?.ahj || '—'}</span></div>
    <div class="kv"><span class="label">Utility</span><span class="value">${ss?.utilityName || '—'}</span></div>
    <div class="kv"><span class="label">Annual Production</span><span class="value">${ss?.estimatedAnnualKwh?.toLocaleString() || '—'} kWh/yr</span></div>
    <div class="kv"><span class="label">Report Version</span><span class="value">${report.version || '1.0'}</span></div>
  </div>
</div>

<!-- ELECTRICAL -->
<h2 class="section">2. Electrical Engineering (NEC 690)</h2>
<h3 class="sub">DC System</h3>
<div class="kv-grid">
  <div>
    <div class="kv"><span class="label">String Configuration</span><span class="value">${el?.stringCount || '—'} strings × ${el?.panelsPerString || '—'} panels</span></div>
    <div class="kv"><span class="label">DC System Size</span><span class="value">${el?.dcSystemSizeKw || '—'} kW</span></div>
    <div class="kv"><span class="label">DC Voltage (Vmp)</span><span class="value">${el?.dcVoltage || '—'} V</span></div>
  </div>
  <div>
    <div class="kv"><span class="label">DC Wire Size</span><span class="value">${el?.dcWireGauge || '—'}</span></div>
    <div class="kv"><span class="label">DC Conduit</span><span class="value">${el?.dcConduitSize || '—'}</span></div>
    <div class="kv"><span class="label">DC Disconnect</span><span class="value">${el?.dcDisconnectAmps || '—'} A</span></div>
  </div>
</div>
<h3 class="sub">AC System</h3>
<div class="kv-grid">
  <div>
    <div class="kv"><span class="label">AC System Size</span><span class="value">${el?.acSystemSizeKw || '—'} kW</span></div>
    <div class="kv"><span class="label">AC Wire Size</span><span class="value">${el?.acWireGauge || '—'}</span></div>
    <div class="kv"><span class="label">AC Conduit</span><span class="value">${el?.acConduitSize || '—'}</span></div>
  </div>
  <div>
    <div class="kv"><span class="label">AC Breaker</span><span class="value">${el?.acBreakerAmps || '—'} A</span></div>
    <div class="kv"><span class="label">Backfeed Breaker</span><span class="value">${el?.backfeedBreakerAmps || '—'} A</span></div>
    <div class="kv"><span class="label">Interconnection</span><span class="value">${el?.interconnectionMethod || '—'}</span></div>
  </div>
</div>
<h3 class="sub">Interconnection — NEC 705.12</h3>
<div class="kv-grid">
  <div>
    <div class="kv"><span class="label">Method</span><span class="value">${el?.interconnectionType || '—'}</span></div>
    <div class="kv"><span class="label">Main Panel Rating</span><span class="value">${el?.mainPanelBusAmps || '—'} A</span></div>
    <div class="kv"><span class="label">String Fuse</span><span class="value">${el?.stringFuseAmps || '—'} A</span></div>
  </div>
  <div>
    <div class="kv"><span class="label">Backfeed Breaker</span><span class="value">${el?.backfeedBreakerAmps || '—'} A</span></div>
    <div class="kv"><span class="label">Rapid Shutdown</span><span class="value">${el?.rapidShutdownRequired ? 'Required' : 'Not Required'}</span></div>
    <div class="kv"><span class="label">NEC Version</span><span class="value">${el?.necVersion || '—'}</span></div>
  </div>
</div>

<!-- STRUCTURAL -->
<h2 class="section page-break">3. Structural Engineering (ASCE 7-22)</h2>
<div class="kv-grid">
  <div>
    <div class="kv"><span class="label">Wind Speed (Vult)</span><span class="value">${st?.windSpeedMph || '—'} mph</span></div>
    <div class="kv"><span class="label">Ground Snow Load (Pg)</span><span class="value">${st?.groundSnowLoadPsf || '—'} psf</span></div>
    <div class="kv"><span class="label">Seismic Zone</span><span class="value">${st?.seismicZone || '—'}</span></div>
    <div class="kv"><span class="label">Dead Load</span><span class="value">${st?.deadLoadPsf || '—'} psf</span></div>
  </div>
  <div>
    <div class="kv"><span class="label">Roof Type</span><span class="value">${st?.roofType || '—'}</span></div>
    <div class="kv"><span class="label">Roof Pitch</span><span class="value">${st?.roofPitch || '—'}°</span></div>
    <div class="kv"><span class="label">Rafter Size</span><span class="value">${st?.rafterSize || '—'} @ ${st?.rafterSpacingIn || '—'}" o.c.</span></div>
    <div class="kv"><span class="label">Total Array Weight</span><span class="value">${st?.totalArrayWeightLbs || '—'} lbs</span></div>
  </div>
</div>
<h3 class="sub">Attachment Design</h3>
<div class="kv-grid">
  <div>
    <div class="kv"><span class="label">Attachment Type</span><span class="value">${st?.attachmentType || '—'}</span></div>
    <div class="kv"><span class="label">Attachment Spacing</span><span class="value">${st?.attachmentSpacingFt || '—'} ft</span></div>
    <div class="kv"><span class="label">Mounting System</span><span class="value">${st?.mountingSystem || '—'}</span></div>
  </div>
  <div>
    <div class="kv"><span class="label">Rail Spacing</span><span class="value">${st?.railSpacingIn || '—'}"</span></div>
    <div class="kv"><span class="label">IBC Version</span><span class="value">${st?.ibc || '—'}</span></div>
    <div class="kv"><span class="label">ASCE Version</span><span class="value">${st?.asce || '—'}</span></div>
  </div>
</div>

<!-- EQUIPMENT SCHEDULE -->
<h2 class="section">4. Equipment Schedule</h2>
<table>
  <thead><tr><th>Tag</th><th>Description</th><th>Manufacturer / Model</th><th>Qty</th><th>Specs</th></tr></thead>
  <tbody>
    ${[...(eq?.panels || []), ...(eq?.inverters || []), ...(eq?.mounting || []), ...(eq?.electrical || []), ...(eq?.batteries || []), ...(eq?.other || [])].map((item: any) => `
    <tr>
      <td>${item.tag || '—'}</td>
      <td>${item.description || '—'}</td>
      <td>${item.manufacturer || ''} ${item.model || '—'}</td>
      <td>${item.quantity || '—'} ${item.unit || ''}</td>
      <td>${item.specs || '—'}</td>
    </tr>`).join('')}
  </tbody>
</table>

<!-- PERMIT PACKAGE -->
<h2 class="section page-break">5. Permit Package Summary</h2>
<div class="highlight-box">
  <div class="title">📋 Required Permit Documents</div>
  <p style="font-size:9pt;color:#78350f;">The following documents are required for permit submission. Verify requirements with your local AHJ.</p>
</div>
<table>
  <thead><tr><th>Document</th><th>Status</th></tr></thead>
  <tbody>
    ${(pp?.requiredDocuments || []).map((doc: string) => `
    <tr>
      <td>${doc}</td>
      <td><span class="badge-pass">Required</span></td>
    </tr>`).join('')}
  </tbody>
</table>
${(pp?.specialConditions?.length) ? `
<h3 class="sub">Special Conditions</h3>
<table>
  <thead><tr><th>Condition</th></tr></thead>
  <tbody>
    ${(pp?.specialConditions || []).map((cond: string) => `
    <tr><td>${cond}</td></tr>`).join('')}
  </tbody>
</table>` : ''}

<div class="footer">
  Engineering Report generated by SolarPro &nbsp;|&nbsp; ${now} &nbsp;|&nbsp; 
  For permit submission — verify all calculations with licensed engineer &nbsp;|&nbsp;
  NEC 2023 / ASCE 7-22
</div>

<script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      // Fallback: direct download
      const a = document.createElement('a');
      a.href = url;
      a.download = `engineering-report-${projectId}.html`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // ── Loading State ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Generating engineering report...</p>
        </div>
      </div>
    );
  }

  // ── Error State ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="p-6 space-y-4">
        {/* Preliminary packet files — shown when no design exists yet */}
        {needsDesign && preliminaryFiles.length > 0 && (
          <div className="bg-slate-800/60 border border-amber-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen className="w-4 h-4 text-amber-400" />
              <span className="text-amber-300 font-medium text-sm">Preliminary Engineering Packet</span>
              <span className="text-xs text-slate-400 ml-1">— generated from bill upload</span>
            </div>
            <div className="space-y-2">
              {preliminaryFiles.map(f => (
                <div key={f.id} className="flex items-center justify-between bg-slate-700/40 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                      f.file_type === 'engineering' ? 'bg-green-500/20 text-green-300' : 'bg-blue-500/20 text-blue-300'
                    }`}>
                      {f.file_type === 'engineering' ? 'Engineering' : 'Utility Bill'}
                    </span>
                    <span className="text-sm text-white truncate">{f.file_name}</span>
                  </div>
                  <a
                    href={`/api/project-files/download?id=${f.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 flex-shrink-0 ml-2"
                  >
                    <Eye className="w-3.5 h-3.5" /> View
                  </a>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Place panels in Design Studio to generate a full permit-grade engineering report.
            </p>
          </div>
        )}

        <div className="bg-slate-800/60 border border-red-500/30 rounded-xl p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-red-300 font-medium mb-2">Engineering Report Unavailable</p>
          <p className="text-slate-400 text-sm mb-4">{error}</p>
          {!error.includes('Design Studio') && (
            <button onClick={fetchReport} className="btn-secondary text-sm">
              <RefreshCw className="w-4 h-4 mr-2" /> Try Again
            </button>
          )}
          {error.includes('Design Studio') && (
            <a href={`/design?projectId=${projectId}`} className="btn-primary text-sm inline-flex items-center">
              <Layers className="w-4 h-4 mr-2" /> Open Design Studio
            </a>
          )}
        </div>
      </div>
    );
  }

  if (!report) return null;

  const { systemSummary: ss, electrical: el, structural: st, equipmentSchedule: eq, permitPackage: pp } = report;

  // ── Main Report View ───────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" />
            Engineering Report
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            Auto-generated from Design Engine · {new Date(report.generatedAt).toLocaleDateString()}
            {isStale && <span className="ml-2 text-amber-400">⚠ Design changed — regenerate</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRegenerate}
            disabled={generating}
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Generating...' : 'Regenerate'}
          </button>
          <button onClick={handleDownload} className="btn-secondary text-xs flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> Download PDF
          </button>
        </div>
      </div>

      {/* Status Banner */}
      {isStale && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="text-amber-300 text-sm">
            Design has changed since this report was generated. Click <strong>Regenerate</strong> to update.
          </p>
        </div>
      )}

      {/* System Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={<Sun className="w-4 h-4 text-amber-400" />} label="System Size" value={`${ss.systemSizeKw} kW`} sub="DC" />
        <SummaryCard icon={<Grid className="w-4 h-4 text-blue-400" />} label="Panel Count" value={`${ss.panelCount}`} sub={`${ss.panelWattage}W each`} />
        <SummaryCard icon={<Activity className="w-4 h-4 text-green-400" />} label="Est. Annual" value={`${ss.estimatedAnnualKwh.toLocaleString()}`} sub="kWh/year" />
        <SummaryCard icon={<Home className="w-4 h-4 text-purple-400" />} label="Mount Type" value={ss.mountType} sub={ss.systemType} />
      </div>

      {/* Section: System Summary */}
      <Section
        title="System Summary"
        icon={<BarChart2 className="w-4 h-4 text-amber-400" />}
        sectionKey="summary"
        expanded={expandedSections.has('summary')}
        onToggle={toggleSection}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <DataRow label="Panel Model" value={ss.panelModel} />
          <DataRow label="Inverter Model" value={ss.inverterModel} />
          <DataRow label="Inverter Type" value={ss.inverterType.toUpperCase()} />
          <DataRow label="Mounting System" value={ss.mountType} />
          <DataRow label="System Size (DC)" value={`${ss.systemSizeDcKw} kW`} />
          <DataRow label="System Size (AC)" value={`${ss.systemSizeAcKw} kW`} />
          <DataRow label="Est. Annual Production" value={`${ss.estimatedAnnualKwh.toLocaleString()} kWh`} />
          <DataRow label="CO₂ Offset" value={`${ss.co2OffsetTons} tons/year`} />
          <DataRow label="Utility Provider" value={ss.utilityName} />
          <DataRow label="AHJ" value={ss.ahj} />
          {ss.roofSegmentCount > 0 && <DataRow label="Roof Segments" value={`${ss.roofSegmentCount}`} />}
          {ss.groundArrayCount > 0 && <DataRow label="Ground Arrays" value={`${ss.groundArrayCount}`} />}
        </div>
      </Section>

      {/* Section: Electrical Engineering */}
      <Section
        title="Electrical Engineering"
        icon={<Zap className="w-4 h-4 text-yellow-400" />}
        sectionKey="electrical"
        expanded={expandedSections.has('electrical')}
        onToggle={toggleSection}
      >
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">DC System</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <DataRow label="DC System Size" value={`${el.dcSystemSizeKw} kW`} />
              <DataRow label="String Count" value={`${el.stringCount} strings`} />
              <DataRow label="Panels per String" value={`${el.panelsPerString}`} />
              <DataRow label="String Voc" value={`${el.stringVoc}V`} />
              <DataRow label="String Vmp" value={`${el.stringVmp}V`} />
              <DataRow label="String Isc" value={`${el.stringIsc}A`} />
              <DataRow label="DC Wire" value={el.dcWireGauge} />
              <DataRow label="DC Conduit" value={el.dcConduitSize} />
              <DataRow label="DC Disconnect" value={`${el.dcDisconnectAmps}A, 600VDC`} />
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">AC System</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <DataRow label="AC System Size" value={`${el.acSystemSizeKw} kW`} />
              <DataRow label="AC Voltage" value={`${el.acVoltage}V / ${el.acFrequency}Hz`} />
              <DataRow label="AC Wire" value={el.acWireGauge} />
              <DataRow label="AC Conduit" value={el.acConduitSize} />
              <DataRow label="AC Breaker" value={`${el.acBreakerAmps}A`} />
              <DataRow label="Backfeed Breaker" value={`${el.backfeedBreakerAmps}A`} />
              <DataRow label="Main Panel Bus" value={`${el.mainPanelBusAmps}A`} />
              <DataRow label="Interconnection" value={el.interconnectionMethod} />
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Compliance</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <DataRow label="NEC Version" value={el.necVersion} />
              <DataRow label="Rapid Shutdown" value={el.rapidShutdownRequired ? `Required — ${el.rapidShutdownDevice}` : 'Not Required'} highlight={el.rapidShutdownRequired} />
            </div>
            <div className="mt-2 space-y-1">
              {el.complianceNotes.map((note, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-slate-400">
                  <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0 mt-0.5" />
                  {note}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* Section: Structural Engineering */}
      <Section
        title="Structural Engineering"
        icon={<Shield className="w-4 h-4 text-blue-400" />}
        sectionKey="structural"
        expanded={expandedSections.has('structural')}
        onToggle={toggleSection}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <DataRow label="Roof Type" value={st.roofType} />
          <DataRow label="Roof Pitch" value={`${st.roofPitch}°`} />
          <DataRow label="Rafter Size" value={st.rafterSize} />
          <DataRow label="Rafter Span" value={`${st.rafterSpanFt} ft`} />
          <DataRow label="Rafter Spacing" value={`${st.rafterSpacingIn}" O.C.`} />
          <DataRow label="Wind Speed" value={`${st.windSpeedMph} mph (ASCE 7-22)`} />
          <DataRow label="Snow Load" value={`${st.groundSnowLoadPsf} psf`} />
          <DataRow label="Seismic Zone" value={st.seismicZone} />
          <DataRow label="Panel Weight" value={`${st.panelWeightLbs} lbs each`} />
          <DataRow label="Total Array Weight" value={`${st.totalArrayWeightLbs} lbs`} />
          <DataRow label="Dead Load" value={`${st.deadLoadPsf} psf`} />
          <DataRow label="Mounting System" value={st.mountingSystem} />
          <DataRow label="Attachment Type" value={st.attachmentType} />
          <DataRow label="Attachment Spacing" value={`${st.attachmentSpacingFt} ft O.C.`} />
          <DataRow label="Rail Spacing" value={`${st.railSpacingIn}" O.C.`} />
          <DataRow label="Code" value={`${st.ibc} / ${st.asce}`} />
        </div>
        {st.complianceNotes.length > 0 && (
          <div className="mt-3 space-y-1">
            {st.complianceNotes.map((note, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-slate-400">
                <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                {note}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Section: Equipment Schedule */}
      <Section
        title="Equipment Schedule"
        icon={<Package className="w-4 h-4 text-green-400" />}
        sectionKey="equipment"
        expanded={expandedSections.has('equipment')}
        onToggle={toggleSection}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-2 pr-3 text-slate-400 font-medium">Tag</th>
                <th className="text-left py-2 pr-3 text-slate-400 font-medium">Description</th>
                <th className="text-left py-2 pr-3 text-slate-400 font-medium">Manufacturer</th>
                <th className="text-left py-2 pr-3 text-slate-400 font-medium">Model</th>
                <th className="text-right py-2 pr-3 text-slate-400 font-medium">Qty</th>
                <th className="text-left py-2 text-slate-400 font-medium">Specs</th>
              </tr>
            </thead>
            <tbody>
              {[...eq.panels, ...eq.inverters, ...eq.mounting, ...eq.electrical, ...eq.batteries, ...eq.other].map((item, i) => (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/30">
                  <td className="py-2 pr-3 font-mono text-amber-400">{item.tag}</td>
                  <td className="py-2 pr-3 text-white">{item.description}</td>
                  <td className="py-2 pr-3 text-slate-300">{item.manufacturer}</td>
                  <td className="py-2 pr-3 text-slate-300">{item.model}</td>
                  <td className="py-2 pr-3 text-right text-white">{item.quantity} {item.unit}</td>
                  <td className="py-2 text-slate-400">{item.specs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Section: Permit Package */}
      <Section
        title="Permit Package"
        icon={<ClipboardList className="w-4 h-4 text-purple-400" />}
        sectionKey="permit"
        expanded={expandedSections.has('permit')}
        onToggle={toggleSection}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm mb-4">
          <DataRow label="AHJ" value={pp.ahj} />
          <DataRow label="Utility" value={pp.utilityName} />
          <DataRow label="NEC Version" value={pp.necVersion} />
          <DataRow label="Interconnection" value={pp.interconnectionType} />
          <DataRow label="Est. Permit Fee" value={`$${pp.estimatedPermitFee.toLocaleString()}`} />
          <DataRow label="Prepared Date" value={pp.preparedDate} />
        </div>

        <div className="space-y-3">
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Required Documents</h4>
            <div className="space-y-1">
              {pp.requiredDocuments.map((doc, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-300">
                  <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  {doc}
                </div>
              ))}
            </div>
          </div>

          {pp.specialConditions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Special Conditions</h4>
              <div className="space-y-1">
                {pp.specialConditions.map((cond, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    {cond}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Workflow Footer */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Installer Workflow</h4>
        <div className="flex items-center gap-2 flex-wrap">
          {['Bill Upload', 'System Design', 'Proposal', 'Engineering ✓', 'Permit Submission'].map((step, i, arr) => (
            <React.Fragment key={step}>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                step.includes('✓') ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
                step === 'System Design' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                'bg-slate-700/50 text-slate-400'
              }`}>
                {step}
              </span>
              {i < arr.length - 1 && <span className="text-slate-600">→</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}

function Section({
  title, icon, sectionKey, expanded, onToggle, children
}: {
  title: string;
  icon: React.ReactNode;
  sectionKey: SectionKey;
  expanded: boolean;
  onToggle: (key: SectionKey) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
      <button
        onClick={() => onToggle(sectionKey)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-white text-sm">{title}</span>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-700/50 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

function DataRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-0.5">
      <span className="text-slate-400 flex-shrink-0">{label}</span>
      <span className={`text-right font-medium ${highlight ? 'text-amber-300' : 'text-white'}`}>{value}</span>
    </div>
  );
}