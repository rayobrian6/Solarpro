'use client';
import React, { useEffect, useState, useCallback, Component } from 'react';

// ── Error boundary for bill upload modal ──────────────────────────────────────
// Catches render errors inside BillUploadFlow / BillTab so they don't
// take down the entire project page.
class BillErrorBoundary extends Component<
  { children: React.ReactNode; onError?: (err: Error) => void },
  { hasError: boolean; message: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, message: err?.message || 'Unknown error' };
  }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('[BillErrorBoundary] caught render error:', err, info.componentStack);
    this.props.onError?.(err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-center space-y-3">
          <div className="text-red-400 font-semibold text-sm">
            Something went wrong loading this view.
          </div>
          <div className="text-slate-500 text-xs font-mono bg-slate-800 rounded p-2">
            {this.state.message}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="btn-secondary text-xs py-1.5 px-4"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import AppShell from '@/components/ui/AppShell';
import { useParams, useSearchParams } from 'next/navigation';
import type { Project } from '@/types';
import { useAppStore } from '@/store/appStore';
import {
  ArrowLeft, Upload, Map, FileText, Zap, DollarSign,
  User, Calendar, AlertTriangle, CheckCircle, ChevronRight,
  Settings, BarChart2, Shield, Sun, Wrench, Send, Package, Camera,
  Pencil, X
} from 'lucide-react';
import Link from 'next/link';
import EngineeringTab from '@/components/engineering/EngineeringTab';
import BillTab from '@/components/project/BillTab';
import BillUploadFlow from '@/components/onboarding/BillUploadFlow';
import SystemSizeTab from '@/components/project/SystemSizeTab';
import DesignTab from '@/components/project/DesignTab';
import ProposalTab from '@/components/project/ProposalTab';
import OperationsTab from '@/components/project/OperationsTab';
import FieldSurveyPanel from '@/components/project/FieldSurveyPanel';
import FieldSurveyCard from '@/components/project/FieldSurveyCard';
import TutorialPanel from '@/components/project/TutorialPanel';

// ─── Types ────────────────────────────────────────────────────────────────────
type TabId = 'bill' | 'system' | 'design' | 'engineering' | 'proposal' | 'operations' | 'survey';

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
    // FIX v47.54: check actual panel count from layout, not just truthy layout object.
    // p.layout exists if a layout row exists in DB. p.layout.panels.length > 0 means
    // panels were actually placed in Design Studio.
    check: p => !!(p.layout && (p.layout as any).panels && (p.layout as any).panels.length > 0),
    tab: 'design',
  },
  {
    id: 'engineering',
    label: 'Engineering Done',
    shortLabel: 'Eng.',
    icon: <Wrench size={13} />,
    // FIX v47.54: engineering complete when layout has panels (engineering model is
    // auto-generated on layout save via syncProjectPipeline). Do NOT depend on
    // p.status === 'proposal' which is a manual field never set automatically.
    // Also accept legacy status-based check for backwards compatibility.
    check: p =>
      !!(p.layout && (p.layout as any).panels && (p.layout as any).panels.length > 0) ||
      p.status === 'proposal' || p.status === 'approved' || p.status === 'installed',
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
  {
    id: 'operations',
    label: 'Operations',
    icon: <Package size={14} />,
  },
  {
    id: 'survey',
    label: 'Field Survey',
    icon: <Camera size={14} />,
  },
];

// ─── Missing Data Warnings ─────────────────────────────────────────────────────
// ─── Tutorial Panel Config ─────────────────────────────────────────────────────────
// Placeholder YouTube video IDs — replace with real unlisted IDs once recorded.
const TUTORIAL_CONFIG: Partial<Record<TabId, {
  title:       string;
  description: string;
  videoId:     string;
  duration:    string;
}>> = {
  bill: {
    title:       'How to upload a utility bill',
    description: 'Upload a PDF or photo of the homeowner\'s electric bill. SolarPro automatically extracts annual kWh, monthly usage, and utility rate \u2014 no manual entry required.',
    videoId:     'PLACEHOLDER_BILL',
    duration:    '1:15',
  },
  system: {
    title:       'How to read and adjust the auto-sized system',
    description: 'After bill upload, SolarPro sizes the system from annual usage and local irradiance. Review the recommended size and override it if needed.',
    videoId:     'PLACEHOLDER_SYSTEM',
    duration:    '1:30',
  },
  design: {
    title:       'How to use the Design Studio',
    description: 'Draw roof zones on the 3D map and place panels with one click. The studio respects setbacks, obstructions, and equipment constraints automatically.',
    videoId:     'PLACEHOLDER_DESIGN',
    duration:    '1:45',
  },
  engineering: {
    title:       'How SLD and BOM are generated',
    description: 'SolarPro auto-generates a NEC-compliant single-line diagram and full bill of materials from your design. Review, customize, and export these documents.',
    videoId:     'PLACEHOLDER_ENGINEERING',
    duration:    '1:20',
  },
  proposal: {
    title:       'How to customize and send a proposal',
    description: 'Generate a branded proposal, customize pricing and incentives, then send for digital signature \u2014 no DocuSign required.',
    videoId:     'PLACEHOLDER_PROPOSAL',
    duration:    '1:30',
  },
  operations: {
    title:       'How to track a project to completion',
    description: 'The Operations tab gives a live pipeline view: permit status, inspection dates, installation milestones, and final sign-off in one place.',
    videoId:     'PLACEHOLDER_OPERATIONS',
    duration:    '1:10',
  },
};

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
  const searchParams = useSearchParams();

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
  const [showChangeTypeModal, setShowChangeTypeModal] = useState(false);
  const [changingType, setChangingType] = useState(false);

  // Auto-open change-type modal when navigated here with ?changeType=1
  useEffect(() => {
    if (searchParams.get('changeType') === '1') {
      setShowChangeTypeModal(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const existing = projects.find(p => p.id === id);
    // FIX v47.168: bypass stale cache when utilityRatePerKwh is missing/zero --
    // provision-created projects may have been cached before the rate was corrected.
    // FIX v47.221: also bypass cache when layout is absent -- cached project may predate
    // Design Studio save (user designed then navigated back to project page).
    const cacheValid = existing
      && (existing.utilityRatePerKwh ?? 0) > 0
      && existing.layout !== undefined;
    if (cacheValid) {
      setProject(existing!);
      setLoading(false);
      // Auto-navigate to first incomplete step
      autoSelectTab(existing!);
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

  const handleChangeSystemType = useCallback(async (newType: 'roof' | 'ground' | 'fence') => {
    if (!project || newType === project.systemType) {
      setShowChangeTypeModal(false);
      return;
    }
    setChangingType(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/repair-system-type`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemType: newType }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to change system type');
      // Reload from server so all state is fresh
      const updated = await loadActiveProject(project.id);
      if (updated) {
        setProject(updated);
        syncProjectToStore(updated);
      }
      setShowChangeTypeModal(false);
    } catch (e: unknown) {
      console.error('[ChangeSystemType]', e);
      alert((e as Error)?.message || 'Failed to change system type. Please try again.');
    } finally {
      setChangingType(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

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
    // ── Pipeline Stage 9: Data propagation diagnostic ─────────────────────────
    console.log('[PIPELINE_STAGE_9] handleBillComplete entered');
    console.log('[PARSED_DATA_OBJECT] result shape:', JSON.stringify({
      hasBillData: !!result.billData,
      hasLocationData: !!result.locationData,
      hasUtilityData: !!result.utilityData,
      hasMatchedUtility: !!result.matchedUtility,
      hasSystemSizing: !!result.systemSizing,
      systemKw: result.systemKw,
      offsetPercent: result.offsetPercent,
      billData: {
        monthlyKwh: result.billData?.monthlyKwh,
        estimatedAnnualKwh: result.billData?.estimatedAnnualKwh,
        electricityRate: result.billData?.electricityRate,
        utilityProvider: result.billData?.utilityProvider,
        serviceAddress: result.billData?.serviceAddress,
        customerName: result.billData?.customerName,
        monthlyHistoryLength: result.billData?.monthlyUsageHistory?.length ?? 0,
      },
      locationData: result.locationData ? {
        stateCode: result.locationData.stateCode,
        city: result.locationData.city,
      } : null,
      matchedUtility: result.matchedUtility ? {
        effectiveRate: result.matchedUtility.effectiveRate,
        source: result.matchedUtility.source,
      } : null,
    }));
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
      // NOTE: This is a UI sizing ESTIMATE for the bill analysis card only.
      // It is NOT used for engineering, planset, or proposal rendering.
      // Canonical panel count comes from canonicalSnapshot.engineering.panelCount via pipeline.
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
      console.log('[DB_SAVE_STARTED] projectId=' + project.id + ' utilityRate=' + utilityRatePerKwh + ' annualKwh=' + annualKwh + ' systemKw=' + systemKw);

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
      console.log('[DB_SAVE_COMPLETE] projectId=' + project.id + ' success=true');

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
      action: 'tab',
      target: 'proposal',
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

        {/* ── Change System Type Modal ─────────────────────────────────────── */}
        {showChangeTypeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl animate-fade-in">
              <div className="flex items-center justify-between p-5 border-b border-slate-700">
                <div>
                  <h2 className="text-white font-bold text-base">Change System Type</h2>
                  <p className="text-slate-400 text-xs mt-0.5">
                    Currently: <span className="text-white font-medium">{typeLabel}</span>
                    {project.layout && (
                      <span className="ml-2 text-amber-400">⚠ Existing design will be cleared</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setShowChangeTypeModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                  disabled={changingType}
                >
                  <X size={16} />
                </button>
              </div>
              {project.layout && (
                <div className="mx-5 mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">
                    This project has an existing design with <strong>{project.layout.totalPanels} panels</strong>.
                    Changing the system type will clear the current panel layout so you can start fresh with the correct mount type.
                    Bill data, system size, and engineering settings are kept.
                  </p>
                </div>
              )}
              <div className="p-5 grid grid-cols-1 gap-3">
                {([
                  { type: 'roof' as const, label: 'Roof Mount', icon: '🏠', desc: 'Standard rooftop installation with auto roof detection, pitch & azimuth optimization.' },
                  { type: 'ground' as const, label: 'Ground Mount', icon: '🌱', desc: 'Fixed or adjustable tilt ground array. Adjustable tilt 0–45°, row spacing optimization.' },
                  { type: 'fence' as const, label: 'Sol Fence (Vertical)', icon: '🔲', desc: 'Vertical bifacial fence-integrated system. 90° mounting, bifacial E-W optimization.' },
                ] as const).map(({ type, label, icon, desc }) => {
                  const isCurrent = type === project.systemType;
                  return (
                    <button
                      key={type}
                      onClick={() => !isCurrent && handleChangeSystemType(type)}
                      disabled={isCurrent || changingType}
                      className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                        isCurrent
                          ? 'border-slate-600 bg-slate-800/60 opacity-60 cursor-default'
                          : 'border-slate-700 bg-slate-800/40 hover:border-slate-500 hover:bg-slate-700/60 cursor-pointer'
                      }`}
                    >
                      <span className="text-2xl mt-0.5 flex-shrink-0">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white text-sm">{label}</span>
                          {isCurrent && <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-300">Current</span>}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{desc}</p>
                      </div>
                      {changingType && !isCurrent && <span className="spinner w-4 h-4 flex-shrink-0 mt-0.5" />}
                    </button>
                  );
                })}
              </div>
              <div className="px-5 pb-5">
                <button onClick={() => setShowChangeTypeModal(false)} disabled={changingType} className="btn-secondary w-full text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 flex-wrap">
          <Link href="/projects" className="btn-ghost p-2 rounded-lg mt-0.5">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-black text-white">{project.name}</h1>
              <span className={`badge ${statusColors[project.status]}`}>{project.status}</span>
              {/* System type badge — click pencil to change type */}
              <button
                onClick={() => setShowChangeTypeModal(true)}
                title="Change system type"
                className={`badge ${project.systemType === 'roof' ? 'badge-roof' : project.systemType === 'ground' ? 'badge-ground' : 'badge-fence'} inline-flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity`}
              >
                {typeLabel}
                <Pencil size={10} className="opacity-60" />
              </button>
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
          <div className="card-warning p-4">
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

        {/* -- Field Survey Card (always visible, above tabs) -- */}
        <FieldSurveyCard projectId={id} />

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
            <div className="space-y-0">
              {TUTORIAL_CONFIG.bill && (
                <TutorialPanel tabId="bill" {...TUTORIAL_CONFIG.bill} />
              )}
              <BillErrorBoundary>
                <BillTab
                  project={project}
                  onUploadBill={handleUploadBill}
                  onBillUpdate={(updates) => setProject(prev => prev ? { ...prev, ...updates } : prev)}
                />
              </BillErrorBoundary>
            </div>
          )}
          {activeTab === 'system' && (
            <div className="space-y-0">
              {TUTORIAL_CONFIG.system && (
                <TutorialPanel tabId="system" {...TUTORIAL_CONFIG.system} />
              )}
              <SystemSizeTab
                project={project}
                onRunAutoSize={handleRunAutoSize}
                onSizeOverride={newKw => setProject(prev => prev ? { ...prev, systemSizeKw: newKw } : prev)}
              />
            </div>
          )}
          {activeTab === 'design' && (
            <div className="space-y-0">
              {TUTORIAL_CONFIG.design && (
                <TutorialPanel tabId="design" {...TUTORIAL_CONFIG.design} />
              )}
              <DesignTab
                project={project}
                onEquipmentUpdate={(updates) => setProject(prev => prev ? { ...prev, ...updates } : prev)}
              />
            </div>
          )}
          {activeTab === 'engineering' && (
            <div className="space-y-0">
              {TUTORIAL_CONFIG.engineering && (
                <TutorialPanel tabId="engineering" {...TUTORIAL_CONFIG.engineering} />
              )}
              <div className="card p-0 overflow-hidden">
                <EngineeringTab projectId={id} projectName={project.name} />
              </div>
            </div>
          )}
          {activeTab === 'proposal' && (
            <div className="space-y-0">
              {TUTORIAL_CONFIG.proposal && (
                <TutorialPanel tabId="proposal" {...TUTORIAL_CONFIG.proposal} />
              )}
              <ProposalTab project={project} />
            </div>
          )}
          {activeTab === 'operations' && (
            <div className="space-y-0">
              {TUTORIAL_CONFIG.operations && (
                <TutorialPanel tabId="operations" {...TUTORIAL_CONFIG.operations} />
              )}
              <OperationsTab projectId={id} />
            </div>
          )}
          {activeTab === 'survey' && (
            <FieldSurveyPanel projectId={id} />
          )}
        </div>

      </div>

      {/* ── Bill Upload Modal ──────────────────────────────────────────── */}
      {showBillModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-xl">
            <BillErrorBoundary onError={() => setShowBillModal(false)}>
              <BillUploadFlow
                onComplete={handleBillComplete}
                onClose={() => setShowBillModal(false)}
              />
            </BillErrorBoundary>
          </div>
        </div>
      )}

      

    </AppShell>
  );
}