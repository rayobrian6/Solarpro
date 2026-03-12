'use client';
import React, { useEffect } from 'react';
import { Zap, Sun, AlertTriangle, CheckCircle, Info, ExternalLink, Shield, TrendingUp, Settings } from 'lucide-react';
import type { Project } from '@/types';
import { getUtilityRules, checkNetMeteringLimit, getProductionFactor } from '@/lib/utility-rules';

interface SystemSizeTabProps {
  project: Project;
  onRunAutoSize: () => void;
}

export default function SystemSizeTab({ project, onRunAutoSize }: SystemSizeTabProps) {
  const bill = project.billAnalysis;

  // FIX v47.8: structured pipeline logging for SYSTEM_SIZE_LOADED
  useEffect(() => {
    console.log('[SYSTEM_SIZE_LOADED] projectId=%s annualKwh=%s utilityRate=%s stateCode=%s city=%s utilityName=%s systemKw=%s billAnalysis=%s',
      project.id,
      bill?.annualKwh ?? 'MISSING',
      project.utilityRatePerKwh ?? 'MISSING',
      project.stateCode ?? 'NOT_SET',
      project.city ?? 'NOT_SET',
      project.utilityName ?? 'NOT_DETECTED',
      project.systemSizeKw ?? bill?.recommendedSystemKw ?? 'NONE',
      bill ? 'PRESENT' : 'MISSING'
    );
  }, [project.id, bill, project.utilityRatePerKwh, project.stateCode, project.city, project.utilityName, project.systemSizeKw]);
  const utilityRules = project.utilityName ? getUtilityRules(project.utilityName) : null;
  const systemKw = project.systemSizeKw || bill?.recommendedSystemKw;
  const productionFactor = getProductionFactor(project.utilityName);
  const netMeteringWarning = systemKw && project.utilityName
    ? checkNetMeteringLimit(systemKw, project.utilityName)
    : null;

  // Confidence scoring
  const confidenceItems = [
    {
      label: 'Annual Usage',
      value: bill?.annualKwh ? `${bill.annualKwh.toLocaleString()} kWh` : null,
      source: bill?.annualKwh ? 'From utility bill' : null,
      required: true,
    },
    {
      label: 'Utility Rate',
      value: project.utilityRatePerKwh ? `$${project.utilityRatePerKwh.toFixed(3)}/kWh` : null,
      source: project.utilityRatePerKwh ? 'Validated from utility rules' : null,
      required: true,
    },
    {
      label: 'Production Factor',
      value: `${productionFactor.toLocaleString()} kWh/kW/yr`,
      source: project.utilityName ? `Based on ${project.stateCode || 'location'}` : 'Default estimate',
      required: false,
    },
    {
      label: 'Offset Target',
      value: bill?.offsetTarget ? `${bill.offsetTarget}%` : '100%',
      source: 'Default (100% offset)',
      required: false,
    },
    {
      label: 'Location',
      value: project.stateCode ? `${project.city || ''} ${project.stateCode}`.trim() : null,
      source: project.lat ? 'Geocoded from address' : null,
      required: false,
    },
  ];

  const filledCount = confidenceItems.filter(c => c.value).length;
  const confidencePct = Math.round((filledCount / confidenceItems.length) * 100);
  const confidenceColor = confidencePct >= 80 ? 'text-emerald-400' : confidencePct >= 60 ? 'text-amber-400' : 'text-red-400';
  const confidenceBg = confidencePct >= 80 ? 'bg-emerald-500' : confidencePct >= 60 ? 'bg-amber-500' : 'bg-red-500';

  if (!bill && !systemKw) {
    return (
      <div className="card p-10 text-center border-2 border-dashed border-slate-700">
        <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
          <Zap size={28} className="text-blue-400" />
        </div>
        <h3 className="text-white font-semibold text-lg mb-2">No System Size Calculated</h3>
        <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
          Upload a utility bill first to automatically calculate the recommended system size, or manually trigger auto-sizing.
        </p>
        <button onClick={onRunAutoSize} className="btn-primary inline-flex items-center gap-2">
          <Zap size={15} /> Run Auto-Size
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* System Size Hero */}
      <div className="card p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
              <Zap size={11} className="text-amber-400" /> Recommended System Size
            </div>
            <div className="text-5xl font-black text-amber-400">
              {systemKw ? systemKw.toFixed(2) : '—'}
              <span className="text-2xl font-semibold text-slate-400 ml-1">kW</span>
            </div>
            {bill?.recommendedPanelCount && (
              <div className="text-sm text-slate-400 mt-1">
                ≈ {bill.recommendedPanelCount} panels @ 400W
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400 mb-1">Data Confidence</div>
            <div className={`text-3xl font-bold ${confidenceColor}`}>{confidencePct}%</div>
            <div className="w-24 h-1.5 bg-slate-700 rounded-full mt-1.5 ml-auto">
              <div className={`h-full rounded-full ${confidenceBg} transition-all`} style={{ width: `${confidencePct}%` }} />
            </div>
          </div>
        </div>

        {/* Calculation formula */}
        <div className="mt-5 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
          <div className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">How this was calculated</div>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <div className="bg-slate-700/60 rounded-lg px-3 py-1.5 text-center">
              <div className="text-xs text-slate-400">Annual Usage</div>
              <div className="font-bold text-white">{bill?.annualKwh?.toLocaleString() || '—'} kWh</div>
            </div>
            <span className="text-slate-500 font-bold">÷</span>
            <div className="bg-slate-700/60 rounded-lg px-3 py-1.5 text-center">
              <div className="text-xs text-slate-400">Production Factor</div>
              <div className="font-bold text-white">{productionFactor.toLocaleString()} kWh/kW</div>
            </div>
            <span className="text-slate-500 font-bold">×</span>
            <div className="bg-slate-700/60 rounded-lg px-3 py-1.5 text-center">
              <div className="text-xs text-slate-400">Offset Target</div>
              <div className="font-bold text-white">{bill?.offsetTarget || 100}%</div>
            </div>
            <span className="text-slate-500 font-bold">=</span>
            <div className="bg-amber-500/15 border border-amber-500/30 rounded-lg px-3 py-1.5 text-center">
              <div className="text-xs text-amber-400/70">Result</div>
              <div className="font-bold text-amber-400">{systemKw?.toFixed(2) || '—'} kW</div>
            </div>
          </div>
        </div>
      </div>

      {/* Data Confidence Layer */}
      <div className="card p-5">
        <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Shield size={14} className="text-blue-400" /> Data Confidence Layer
          <span className={`ml-auto text-xs font-bold ${confidenceColor}`}>{filledCount}/{confidenceItems.length} inputs verified</span>
        </h4>
        <div className="space-y-2">
          {confidenceItems.map(item => (
            <div key={item.label} className={`flex items-center gap-3 p-3 rounded-lg ${item.value ? 'bg-slate-800/40' : 'bg-red-500/5 border border-red-500/20'}`}>
              {item.value
                ? <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                : <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white">{item.label}</div>
                {item.source && <div className="text-xs text-slate-500">{item.source}</div>}
              </div>
              <div className={`text-sm font-semibold ${item.value ? 'text-white' : 'text-red-400'}`}>
                {item.value || (item.required ? 'Missing — required' : 'Not set')}
              </div>
            </div>
          ))}
        </div>
        <button onClick={onRunAutoSize} className="btn-secondary btn-sm mt-4 flex items-center gap-1.5">
          <Zap size={13} /> Recalculate System Size
        </button>
      </div>

      {/* Utility Rules Panel */}
      {utilityRules && utilityRules.id !== 'default' && (
        <div className="card p-5">
          <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Sun size={14} className="text-amber-400" /> Utility Rules — {utilityRules.name}
            {utilityRules.interconnectionApplicationUrl && (
              <a
                href={utilityRules.interconnectionApplicationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                Application <ExternalLink size={10} />
              </a>
            )}
          </h4>

          {/* Net Metering */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <div className="text-xs text-slate-400 mb-1">Net Metering Program</div>
              <div className={`text-sm font-semibold ${utilityRules.netMeteringAvailable ? 'text-emerald-400' : 'text-red-400'}`}>
                {utilityRules.netMeteringAvailable ? utilityRules.netMeteringProgram : 'Not Available'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <div className="text-xs text-slate-400 mb-1">Max System Size (NEM)</div>
              <div className="text-sm font-semibold text-white">
                {utilityRules.netMeteringMaxKw >= 1000 ? 'No cap' : `${utilityRules.netMeteringMaxKw} kW`}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <div className="text-xs text-slate-400 mb-1">Interconnection Method</div>
              <div className="text-sm font-semibold text-white">
                {utilityRules.preferredInterconnection.replace(/_/g, ' ')}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <div className="text-xs text-slate-400 mb-1">Study Required Above</div>
              <div className="text-sm font-semibold text-white">
                {utilityRules.studyRequiredAboveKw >= 1000 ? 'N/A' : `${utilityRules.studyRequiredAboveKw} kW`}
              </div>
            </div>
          </div>

          {/* Requirements checklist */}
          <div className="space-y-1.5">
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">Requirements</div>
            {[
              { label: 'Smart Inverter Required', value: utilityRules.requiresSmartInverter, warn: true },
              { label: 'Production Meter Required', value: utilityRules.requiresProductionMeter, warn: true },
              { label: 'Visible Disconnect Required', value: utilityRules.requiresVisibleDisconnect, warn: false },
              { label: 'Anti-Islanding Required', value: utilityRules.requiresAntiIslanding, warn: false },
              { label: 'Pre-Application Required', value: utilityRules.preApplicationRequired, warn: true },
              { label: 'Rule 21 Compliant', value: utilityRules.rule21Compliant, warn: false },
            ].map(req => (
              <div key={req.label} className="flex items-center gap-2 text-sm">
                {req.value
                  ? <CheckCircle size={13} className={req.warn ? 'text-amber-400' : 'text-emerald-400'} />
                  : <div className="w-3.5 h-3.5 rounded-full border border-slate-600 flex-shrink-0" />
                }
                <span className={req.value ? 'text-white' : 'text-slate-500'}>{req.label}</span>
              </div>
            ))}
          </div>

          {/* Notes */}
          {utilityRules.notes && (
            <div className="mt-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <div className="flex items-start gap-2">
                <Info size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-400">{utilityRules.notes}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No utility rules fallback */}
      {(!utilityRules || utilityRules.id === 'default') && (
        <div className="card p-4 border border-amber-500/20 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-amber-300 mb-1">Utility Rules Not Found</div>
              <p className="text-xs text-slate-400">
                {project.utilityName
                  ? `No specific rules found for "${project.utilityName}". Using default interconnection rules. Verify net metering limits manually.`
                  : 'No utility provider detected. Upload a utility bill to automatically identify the utility and load interconnection rules.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Net metering warning */}
      {netMeteringWarning && (
        <div className="card p-4 border border-red-500/30 bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-300 mb-1">Net Metering Limit Warning</div>
              <p className="text-xs text-slate-400">{netMeteringWarning}</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}