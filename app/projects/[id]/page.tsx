'use client';
import React, { useEffect, useState, useCallback } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useParams } from 'next/navigation';
import type { Project } from '@/types';
import { useAppStore } from '@/store/appStore';
import {
  ArrowLeft, Upload, Map, FileText, Zap, DollarSign,
  User, Calendar, AlertTriangle, CheckCircle, ChevronRight,
  Settings, BarChart2, Shield, Sun, Wrench, Send, Package
} from 'lucide-react';
import Link from 'next/link';
import EngineeringTab from '@/components/engineering/EngineeringTab';
import BillTab from '@/components/project/BillTab';
import BillUploadFlow from '@/components/onboarding/BillUploadFlow';
import SystemSizeTab from '@/components/project/SystemSizeTab';
import DesignTab from '@/components/project/DesignTab';
import ProposalTab from '@/components/project/ProposalTab';

// ─── Types ────────────────────────────────────────────────────────────────────
type TabId = 'bill' | 'system' | 'design' | 'engineering' | 'proposal';

// ─── Workflow Steps ────────────────────────────────────────────────────────────
interface WorkflowStep {
  id: string;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  check: (p: Project) => boolean;
  tab: TabId;
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: 'bill',
    label: 'Bill Uploaded',
    shortLabel: 'Bill',
    icon: <Upload size={13} />,
    check: p => !!p.billAnalysis,
    tab: 'bill',
  },
  {
    id: 'system',
    label: 'System Sized',
    shortLabel: 'Sized',
    icon: <Zap size={13} />,
    check: p => !!(p.systemSizeKw || p.billAnalysis?.recommendedSystemKw),
    tab: 'system',
  },
  {
    id: 'design',
    label: 'Design Complete',
    shortLabel: 'Design',
    icon: <Map size={13} />,
    check: p => !!p.layout,
    tab: 'design',
  },
  {
    id: 'engineering',
    label: 'Engineering Done',
    shortLabel: 'Eng.',
    icon: <Wrench size={13} />,
    check: p => p.status === 'proposal' || p.status === 'approved' || p.status === 'installed',
    tab: 'engineering',
  },
  {
    id: 'proposal',
    label: 'Proposal Sent',
    shortLabel: 'Proposal',
    icon: <Send size={13} />,
    check: p => p.status === 'approved' || p.status === 'installed',
    tab: 'proposal',
  },
];

// ─── Tab Config ────────────────────────────────────────────────────────────────
interface TabConfig {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  badge?: (p: Project) => string | null;
}

const TABS: TabConfig[] = [
  {
    id: 'bill',
    label: 'Bill',
    icon: <Upload size={14} />,
    badge: p => !p.billAnalysis ? '!' : null,
  },
  {
    id: 'system',
    label: 'System Size',
    icon: <Zap size={14} />,
    badge: p => !(p.systemSizeKw || p.billAnalysis?.recommendedSystemKw) ? '!' : null,
  },
  {
    id: 'design',
    label: 'Design',
    icon: <Map size={14} />,
    badge: p => !p.layout ? '!' : null,
  },
  {
    id: 'engineering',
    label: 'Engineering',
    icon: <Wrench size={14} />,
  },
  {
    id: 'proposal',
    label: 'Proposal',
    icon: <FileText size={14} />,
  },
];

// ─── Missing Data Warnings ─────────────────────────────────────────────────────
function getMissingWarnings(project: Project): { label: string; action: string; tab: TabId }[] {
  const warnings: { label: string; action: string; tab: TabId }[] = [];
  if (!project.billAnalysis) {
    warnings.push({ label: 'No utility bill uploaded', action: 'Upload Bill', tab: 'bill' });
  }
  if (!project.utilityName) {
    warnings.push({ label: 'Utility provider not detected', action: 'Upload Bill', tab: 'bill' });
  }
  if (!project.systemSizeKw && !project.billAnalysis?.recommendedSystemKw) {
    warnings.push({ label: 'System size not calculated', action: 'View System Size', tab: 'system' });
  }
  if (!project.layout) {
    warnings.push({ label: 'No design created', action: 'Open Design Studio', tab: 'design' });
  }
  if (!project.selectedPanel) {
    warnings.push({ label: 'No panel selected', action: 'Edit Design', tab: 'design' });
  }
  if (!project.selectedInverter) {
    warnings.push({ label: 'No inverter selected', action: 'Edit Design', tab: 'design' });
  }
  if (!project.lat || !project.lng) {
    warnings.push({ label: 'Address not geocoded', action: 'Check Bill', tab: 'bill' });
  }
  return warnings;
}

// ─── Status Colors ─────────────────────────────────────────────────────────────
const statusColors: Record<string, string> = {
  lead: 'badge-lead', design: 'badge-design', proposal: 'badge-proposal',
  approved: 'badge-approved', installed: 'badge-installed',
};

// ─── Quick Actions ─────────────────────────────────────────────────────────────
interface QuickAction {
  label: string;
  icon: React.ReactNode;
  color: string;
  action: 'tab' | 'link';
  target: string;
  enabled: (p: Project) => boolean;
  disabledReason?: string;
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();

  const loadActiveProject = useAppStore(s => s.loadActiveProject);
  const projects = useAppStore(s => s.projects);
  // FIX v47.8: sync updated project to store cache after bill save
  const syncProjectToStore = useAppStore(s => s.syncProjectToStore);

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('bill');
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const [showBillModal, setShowBillModal] = useState(false);
  const [savingBill, setSavingBill] = useState(false);

  useEffect(() => {
    const existing = projects.find(p => p.id === id);
    if (existing) {
      setProject(existing);
      setLoading(false);
      // Auto-navigate to first incomplete step
      autoSelectTab(existing);
      return;
    }
    loadActiveProject(id)
      .then(p => {
        setProject(p);
        setLoading(false);
        if (p) autoSelectTab(p);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const autoSelectTab = (p: Project) => {
    // Start at first incomplete workflow step
    for (const step of WORKFLOW_STEPS) {
      if (!step.check(p)) {
        setActiveTab(step.tab);
        return;
      }
    }
    // All complete — show proposal
    setActiveTab('proposal');
  };

  const handleUploadBill = useCallback(() => {
    setShowBillModal(true);
  }, []);

  // ─── Bill upload complete: build BillAnalysis + persist to project ───────
  const handleBillComplete = useCallback(async (result: {
    billData: {
      monthlyKwh?: number;
      estimatedAnnualKwh?: number;
      electricityRate?: number;
      estimatedMonthlyBill?: number;
      totalAmount?: number;
      utilityProvider?: string;
      monthlyUsageHistory?: number[];
      customerName?: string;
      serviceAddress?: string;
    };
    locationData?: { stateCode?: string; lat?: number; lng?: number; city?: string; state?: string };
    utilityData?: { utilityName?: string; avgRatePerKwh?: number };
    // v47.11: matchedUtility carries accurate DB retail rate
    matchedUtility?: { effectiveRate?: number; retailRate?: number; defaultResidentialRate?: number; source?: string };
    systemSizing?: { recommendedKw?: number };
    systemKw: number;
    offsetPercent: number;
  }) => {
    if (!project) return;
    setSavingBill(true);

    try {
      // Build 12-month array — use history if available, else fill from monthly avg
      const rawHistory = result.billData.monthlyUsageHistory || [];
      const monthlyKwh: number[] = rawHistory.length >= 12
        ? rawHistory.slice(0, 12)
        : Array(12).fill(result.billData.monthlyKwh || 0);

      const annualKwh = result.billData.estimatedAnnualKwh
        || (result.billData.monthlyKwh ? result.billData.monthlyKwh * 12 : monthlyKwh.reduce((a, b) => a + b, 0));
      const avgMonthlyKwh = annualKwh / 12;
      const utilityRate = result.billData.electricityRate
        || result.utilityData?.avgRatePerKwh
        || 0.13;
      const avgMonthlyBill = result.billData.estimatedMonthlyBill
        || result.billData.totalAmount
        || (avgMonthlyKwh * utilityRate);
      const annualBill = avgMonthlyBill * 12;
      const peakIdx = monthlyKwh.indexOf(Math.max(...monthlyKwh));
      const systemKw = result.systemKw || result.systemSizing?.recommendedKw || 0;
      const panelCount = Math.ceil(systemKw * 1000 / 440);

      // Build typed BillAnalysis
      const billAnalysis = {
        monthlyKwh,
        annualKwh,
        averageMonthlyKwh: avgMonthlyKwh,
        averageMonthlyBill: avgMonthlyBill,
        annualBill,
        utilityRate,
        peakMonthKwh: monthlyKwh[peakIdx] || 0,
        peakMonth: peakIdx,
        recommendedSystemKw: systemKw,
        recommendedPanelCount: panelCount,
        offsetTarget: result.offsetPercent || 100,
      };

      const utilityName = result.billData.utilityProvider
        || result.utilityData?.utilityName
        || undefined;
      // v47.11 rate fallback: bill extracted rate > DB retail rate > state average > national default
      // result.matchedUtility?.effectiveRate is the accurate 2024/2025 all-in retail rate from DB
      const dbRetailRate = (result as { matchedUtility?: { effectiveRate?: number } }).matchedUtility?.effectiveRate;
      const utilityRatePerKwh = (utilityRate > 0 && utilityRate !== 0.13)
        ? utilityRate            // Bill extracted rate wins if non-default
        : dbRetailRate           // DB retail rate is next priority
          ?? result.utilityData?.avgRatePerKwh  // state average fallback
          ?? utilityRate;        // hardcoded 0.13 last resort
      const stateCode = result.locationData?.stateCode || undefined;
      // FIX v47.8: capture city from locationData so it persists to DB
      const city = result.locationData?.city || undefined;

      console.log('[BILL_PARSED] annualKwh=%s utilityName=%s utilityRate=%s stateCode=%s city=%s dbRetailRate=%s',
        annualKwh, utilityName, utilityRatePerKwh, stateCode, city, dbRetailRate ?? 'none');

      // Structured bill_data that rowToProject can hydrate — includes _city now
      const billData = {
        _billAnalysis: billAnalysis,
        _utilityName: utilityName,
        _utilityRatePerKwh: utilityRatePerKwh,
        _stateCode: stateCode,
        // FIX v47.8: store city in JSONB so rowToProject can hydrate it on reload
        _city: city,
        // Also keep raw fields for engineering engine / proposals
        ...result.billData,
      };

      console.log('[BILL_SAVING] PUT /api/projects/' + project.id, { systemKw, utilityName, annualKwh, stateCode, city });

      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billData,
          systemSizeKw: systemKw || undefined,
          // Update lat/lng if we got location from bill
          ...(result.locationData?.lat && result.locationData?.lng ? {
            lat: result.locationData.lat,
            lng: result.locationData.lng,
          } : {}),
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to save bill');

      console.log('[BILL_SAVED_TO_PROJECT] projectId=%s utilityName=%s annualKwh=%s stateCode=%s city=%s systemKw=%s',
        project.id, utilityName, annualKwh, stateCode, city, systemKw);

      // FIX v47.12 Issue 1: If bill OCR extracted a customerName AND the client record
      // still has a placeholder name (e.g. "Skowhegan Customer"), update it now.
      const extractedCustomerName = result.billData.customerName?.trim();
      const currentClientName = project.client?.name?.trim() || '';
      const isPlaceholder = !currentClientName
        || currentClientName.toLowerCase().includes('customer')
        || currentClientName.toLowerCase().includes('placeholder')
        || currentClientName.length < 3;
      if (extractedCustomerName && extractedCustomerName.length >= 2 && isPlaceholder && project.clientId) {
        try {
          await fetch(`/api/clients/${project.clientId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: extractedCustomerName }),
          });
          console.log('[CLIENT_NAME_UPDATED] clientId=%s name=%s', project.clientId, extractedCustomerName);
        } catch (nameErr) {
          console.warn('[CLIENT_NAME_UPDATE_FAILED]', nameErr);
        }
      }

      // FIX v47.8: after save the server runs rowToProject() which hydrates all fields from bill_data JSONB.
      // json.data already has billAnalysis/utilityName/utilityRatePerKwh/stateCode/city hydrated.
      // We still merge client-side values as fallback in case server hydration is incomplete.
      const updatedProject: Project = {
        ...json.data,
        billAnalysis: billAnalysis,
        utilityName: utilityName || json.data.utilityName,
        utilityRatePerKwh: utilityRatePerKwh || json.data.utilityRatePerKwh,
        stateCode: stateCode || json.data.stateCode,
        // FIX v47.8: city was missing from this merge — now included
        city: city || json.data.city,
        // FIX v47.12 Issue 1: merge updated client name into local state
        client: json.data.client
          ? {
              ...json.data.client,
              name: (extractedCustomerName && isPlaceholder)
                ? extractedCustomerName
                : (json.data.client.name || currentClientName),
            }
          : json.data.client,
      };

      console.log('[PROJECT_STATE_UPDATED] billAnalysis=%s utilityName=%s stateCode=%s city=%s utilityRate=%s',
        !!updatedProject.billAnalysis, updatedProject.utilityName, updatedProject.stateCode, updatedProject.city, updatedProject.utilityRatePerKwh);
      setProject(updatedProject);
      // FIX v47.8: keep store cache in sync so navigation back to this project
      // does not return stale data (loadActiveProject checks store first)
      syncProjectToStore(updatedProject);
      setShowBillModal(false);

      // Auto-advance to system size tab
      setActiveTab('system');
      console.log('[PROJECT_REFRESHED] UI updated, navigated to system tab');

    } catch (err) {
      console.error('[BILL_SAVE_ERROR]', err instanceof Error ? err.message : err);
      // Close modal even on error — don't leave user stuck
      setShowBillModal(false);
    } finally {
      setSavingBill(false);
    }
  }, [project]);

  const handleRunAutoSize = useCallback(() => {
    setActiveTab('system');
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="p-6 flex items-center justify-center h-64">
          <div className="spinner w-8 h-8" />
        </div>
      </AppShell>
    );
  }

  if (!project) {
    return (
      <AppShell>
        <div className="p-6 text-center">
          <p className="text-slate-400 mb-4">Project not found</p>
          <Link href="/projects" className="btn-primary">Back to Projects</Link>
        </div>
      </AppShell>
    );
  }

  const warnings = getMissingWarnings(project);
  const visibleWarnings = showAllWarnings ? warnings : warnings.slice(0, 3);
  const completedSteps = WORKFLOW_STEPS.filter(s => s.check(project)).length;
  const progressPct = Math.round((completedSteps / WORKFLOW_STEPS.length) * 100);
  const typeLabel = { roof: 'Roof Mount', ground: 'Ground Mount', fence: 'Sol Fence' }[project.systemType];

  const quickActions: QuickAction[] = [
    {
      label: 'Upload Bill',
      icon: <Upload size={14} />,
      color: 'text-amber-400',
      action: 'tab',
      target: 'bill',
      enabled: () => true,
    },
    {
      label: 'Design Studio',
      icon: <Map size={14} />,
      color: 'text-blue-400',
      action: 'link',
      target: `/design?projectId=${id}`,
      enabled: p => !!p.billAnalysis,
      disabledReason: 'Upload bill first',
    },
    {
      label: 'Engineering',
      icon: <Wrench size={14} />,
      color: 'text-purple-400',
      action: 'tab',
      target: 'engineering',
      enabled: p => !!p.layout,
      disabledReason: 'Complete design first',
    },
    {
      label: 'Generate Proposal',
      icon: <FileText size={14} />,
      color: 'text-emerald-400',
      action: 'link',
      target: `/proposals?projectId=${id}`,
      enabled: p => !!p.layout && !!p.billAnalysis,
      disabledReason: 'Need bill + design',
    },
    {
      label: 'Permit Packet',
      icon: <Package size={14} />,
      color: 'text-slate-400',
      action: 'tab',
      target: 'engineering',
      enabled: p => p.status === 'proposal' || p.status === 'approved' || p.status === 'installed',
      disabledReason: 'Complete engineering first',
    },
  ];

  return (
    <AppShell>
      <div className="p-4 md:p-6 space-y-4 animate-fade-in">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 flex-wrap">
          <Link href="/projects" className="btn-ghost p-2 rounded-lg mt-0.5">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-white">{project.name}</h1>
              <span className={`badge ${statusColors[project.status]}`}>{project.status}</span>
              <span className={`badge ${project.systemType === 'roof' ? 'badge-roof' : project.systemType === 'ground' ? 'badge-ground' : 'badge-fence'}`}>
                {typeLabel}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
              {project.client?.name && (
                <span className="flex items-center gap-1"><User size={10} />{project.client.name}</span>
              )}
              <span className="flex items-center gap-1"><Calendar size={10} />{new Date(project.createdAt).toLocaleDateString()}</span>
              {project.address && (
                <span className="text-slate-500 truncate max-w-xs">{project.address}</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Workflow Progress Tracker ───────────────────────────────────── */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Workflow Progress</div>
            <div className="text-xs text-slate-400">
              <span className={progressPct === 100 ? 'text-emerald-400 font-semibold' : 'text-white font-semibold'}>
                {completedSteps}/{WORKFLOW_STEPS.length}
              </span> steps complete
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1.5 bg-slate-700 rounded-full mb-4">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressPct === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Steps */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {WORKFLOW_STEPS.map((step, i) => {
              const done = step.check(project);
              const isActive = activeTab === step.tab;
              const isCurrent = !done && (i === 0 || WORKFLOW_STEPS[i - 1].check(project));
              return (
                <React.Fragment key={step.id}>
                  <button
                    onClick={() => setActiveTab(step.tab)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                      done
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25'
                        : isCurrent
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse-subtle'
                          : isActive
                            ? 'bg-slate-700 text-white border border-slate-600'
                            : 'text-slate-500 hover:text-slate-300 border border-transparent'
                    }`}
                  >
                    {done ? <CheckCircle size={12} className="text-emerald-400" /> : step.icon}
                    <span className="hidden sm:inline">{step.label}</span>
                    <span className="sm:hidden">{step.shortLabel}</span>
                  </button>
                  {i < WORKFLOW_STEPS.length - 1 && (
                    <ChevronRight size={12} className={`flex-shrink-0 ${done ? 'text-emerald-500/40' : 'text-slate-700'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* ── Quick Actions Bar ───────────────────────────────────────────── */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {quickActions.map(qa => {
            const enabled = qa.enabled(project);
            if (qa.action === 'link' && enabled) {
              return (
                <Link
                  key={qa.label}
                  href={qa.target}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-slate-600 text-xs font-medium text-white transition-all whitespace-nowrap flex-shrink-0 hover:bg-slate-700"
                >
                  <span className={qa.color}>{qa.icon}</span>
                  {qa.label}
                </Link>
              );
            }
            if (qa.action === 'tab' && enabled) {
              return (
                <button
                  key={qa.label}
                  onClick={() => setActiveTab(qa.target as TabId)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-slate-600 text-xs font-medium text-white transition-all whitespace-nowrap flex-shrink-0 hover:bg-slate-700"
                >
                  <span className={qa.color}>{qa.icon}</span>
                  {qa.label}
                </button>
              );
            }
            return (
              <div
                key={qa.label}
                title={qa.disabledReason}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/40 border border-slate-700/40 text-xs font-medium text-slate-600 whitespace-nowrap flex-shrink-0 cursor-not-allowed"
              >
                <span className="opacity-40">{qa.icon}</span>
                {qa.label}
              </div>
            );
          })}
        </div>

        {/* ── Missing Data Warnings ───────────────────────────────────────── */}
        {warnings.length > 0 && (
          <div className="card p-4 border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={14} className="text-amber-400" />
              <span className="text-sm font-semibold text-amber-300">
                {warnings.length} item{warnings.length !== 1 ? 's' : ''} need attention
              </span>
            </div>
            <div className="space-y-2">
              {visibleWarnings.map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  <span className="text-xs text-slate-400 flex-1">{w.label}</span>
                  <button
                    onClick={() => setActiveTab(w.tab)}
                    className="text-xs text-amber-400 hover:text-amber-300 transition-colors whitespace-nowrap"
                  >
                    {w.action} →
                  </button>
                </div>
              ))}
            </div>
            {warnings.length > 3 && (
              <button
                onClick={() => setShowAllWarnings(!showAllWarnings)}
                className="text-xs text-slate-500 hover:text-slate-300 mt-2 transition-colors"
              >
                {showAllWarnings ? 'Show less' : `+${warnings.length - 3} more`}
              </button>
            )}
          </div>
        )}

        {/* ── Tab Navigation ──────────────────────────────────────────────── */}
        <div className="flex gap-0.5 border-b border-slate-700/50 overflow-x-auto">
          {TABS.map(tab => {
            const badge = tab.badge?.(project);
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap relative flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-slate-800 text-white border border-slate-700/50 border-b-slate-800'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span className={activeTab === tab.id ? 'text-amber-400' : 'text-slate-500'}>
                  {tab.icon}
                </span>
                {tab.label}
                {badge && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-slate-900 text-xs font-bold flex items-center justify-center">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Tab Content ─────────────────────────────────────────────────── */}
        <div className="min-h-[400px]">
          {activeTab === 'bill' && (
            <BillTab project={project} onUploadBill={handleUploadBill} />
          )}
          {activeTab === 'system' && (
            <SystemSizeTab project={project} onRunAutoSize={handleRunAutoSize} />
          )}
          {activeTab === 'design' && (
            <DesignTab project={project} />
          )}
          {activeTab === 'engineering' && (
            <div className="card p-0 overflow-hidden">
              <EngineeringTab projectId={id} projectName={project.name} />
            </div>
          )}
          {activeTab === 'proposal' && (
            <ProposalTab project={project} />
          )}
        </div>

      </div>

      {/* ── Bill Upload Modal ──────────────────────────────────────────── */}
      {showBillModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-xl">
            <BillUploadFlow
              onComplete={handleBillComplete}
              onClose={() => setShowBillModal(false)}
            />
          </div>
        </div>
      )}

    </AppShell>
  );
}