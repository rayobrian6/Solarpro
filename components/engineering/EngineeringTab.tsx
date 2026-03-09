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
  ExternalLink, Info, BarChart2, Layers, Grid
} from 'lucide-react';
import type { EngineeringReport } from '@/lib/engineering/types';

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
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(
    new Set(['summary', 'electrical'])
  );

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/engineering/report?projectId=${projectId}`);
      const data = await res.json();
      if (data.success) {
        setReport(data.data.report);
        setIsStale(data.data.isStale || false);
      } else if (data.needsDesign) {
        setError('No panel layout found. Please place panels in the Design Studio first.');
      } else {
        setError(data.error || 'Failed to load engineering report');
      }
    } catch (e) {
      setError('Failed to connect to engineering service');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

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
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `engineering-report-${projectId}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
      <div className="p-6">
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
            <Download className="w-3.5 h-3.5" /> Download
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