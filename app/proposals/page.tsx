'use client';
import React, { useEffect, useState, Suspense } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useSearchParams } from 'next/navigation';
import type { Project, Proposal } from '@/types';
import {
  FileText, Plus, Download, Share2, Eye,
  CheckCircle, Clock, XCircle, ArrowLeft, Printer,
  Sun, Zap, DollarSign, Leaf, TrendingUp, Shield,
  Star, Phone, Mail, MapPin, Calendar, Award,
  ChevronRight, BarChart2, Home, Sprout, Fence, Users,
  Settings, Percent, Tag, Lock
} from 'lucide-react';
import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { resolveEquipment, getSystemTypeLabel } from '@/lib/systemEquipmentResolver';
import { calculateIncentives } from '@/lib/incentives/stateIncentives';
import { useSubscription } from '@/hooks/useSubscription';
import UpgradeModal from '@/components/ui/UpgradeModal';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// FIX v47.12 Issue 6: States with active SREC or TREC markets.
// Maine has no SREC market — do NOT show SREC section for ME.
// Sources: DSIRE 2024, SEIA state policy map.
const SREC_STATES = new Set([
  'DC', 'MA', 'MD', 'NJ', 'PA', 'OH', 'IL', 'DE', 'CT', 'RI',
  'NY', 'VA', 'NC', 'MI', 'MO', 'IN',
]);
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ProposalContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeProposal, setActiveProposal] = useState<Proposal | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'preview'>('list');
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Plan gating — Starter = preview only (no generate, no download, no e-sign)
  const { can, loading: subLoading, isFreePass } = useSubscription();
  // While subscription is loading, never show upgrade walls (avoids flash for free pass / paid users)
  const canGenerate = subLoading ? true : can('proposalEsigning'); // Professional+ can generate & e-sign
  const isPreviewOnly = !canGenerate;

  useEffect(() => {
    const load = async () => {
      if (projectId) {
        // Pass ?projectId= so the API only returns proposals for this project
        const [projRes, propRes] = await Promise.all([
          fetch(`/api/projects/${projectId}`).then(r => r.json()),
          fetch(`/api/proposals?projectId=${projectId}`).then(r => r.json()),
        ]);
        setProject(projRes.data);
        setProposals(propRes.data || []);
      } else {
        const res = await fetch('/api/proposals');
        const data = await res.json();
        setProposals(data.data || []);
      }
      setLoading(false);
    };
    load();
  }, [projectId]);

  const generateProposal = async () => {
    if (!projectId) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, preparedBy: 'SolarPro Design Team' }),
      });
      const data = await res.json();
      if (data.success) {
        setProposals(prev => [data.data, ...prev]);
        setActiveProposal(data.data);
        setViewMode('preview');
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadPDF = async (proposal: Proposal) => {
    const { generateProposalPDF } = await import('@/lib/proposalPDF');
    await generateProposalPDF(proposal);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="spinner w-8 h-8" />
    </div>
  );

  if (viewMode === 'preview' && activeProposal) {
    // Merge the separately-fetched full project (with layout/production/costEstimate)
    // into the proposal so ProposalPreview has all the data it needs
    const enrichedProposal = project
      ? { ...activeProposal, project }
      : activeProposal;
    return (
      <ProposalPreview
        proposal={enrichedProposal}
        onBack={() => setViewMode('list')}
        onDownload={() => handleDownloadPDF(activeProposal)}
        isPreviewOnly={isPreviewOnly}
        onUpgrade={() => setUpgradeOpen(true)}
      />
    );
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Upgrade modal for Starter users */}
      <UpgradeModal
        isOpen={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        title="Proposal Generation Locked"
        description="Generating and downloading proposals requires Professional plan or above. Starter plan allows preview only."
        requiredPlan="Professional"
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Proposals</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {project ? `Project: ${project.name}` : `${proposals.length} total proposals`}
          </p>
        </div>
        <div className="flex gap-3">
          {/* Preview-only banner for Starter */}
          {isPreviewOnly && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
              <Lock size={12} /> Preview Only — <button onClick={() => setUpgradeOpen(true)} className="underline font-semibold hover:text-amber-200">Upgrade to generate</button>
            </div>
          )}
          {projectId && !isPreviewOnly && (
            <button onClick={generateProposal} disabled={generating} className="btn-primary">
              {generating ? <><span className="spinner w-4 h-4" /> Generating...</> : <><Plus size={16} /> Generate Proposal</>}
            </button>
          )}
          {projectId && isPreviewOnly && (
            <button onClick={() => setUpgradeOpen(true)} className="btn-secondary opacity-60 cursor-not-allowed" disabled>
              <Lock size={14} /> Generate Proposal
            </button>
          )}
        </div>
      </div>

      {proposals.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <FileText size={28} className="text-blue-400" />
          </div>
          <p className="text-white font-semibold text-lg mb-1">No proposals yet</p>
          {projectId ? (
            <>
              <p className="text-slate-400 text-sm mb-6">Generate a professional proposal for this project</p>
              {isPreviewOnly ? (
                <button onClick={() => setUpgradeOpen(true)} className="btn-secondary inline-flex gap-2 opacity-70">
                  <Lock size={14} /> Upgrade to Generate Proposals
                </button>
              ) : (
                <button onClick={generateProposal} className="btn-primary inline-flex">
                  <Plus size={16} /> Generate First Proposal
                </button>
              )}
            </>
          ) : (
            <p className="text-slate-500 text-sm mt-1">Open a project to generate proposals</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map(proposal => (
            <div key={proposal.id} className="card-hover p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                <FileText size={20} className="text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white">{proposal.title}</h3>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><Calendar size={10} />{new Date(proposal.preparedDate).toLocaleDateString()}</span>
                  <span>By {proposal.preparedBy}</span>
                  <span className="flex items-center gap-1"><Eye size={10} /> {proposal.viewCount} views</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${
                  proposal.status === 'accepted' ? 'badge-approved' :
                  proposal.status === 'sent' ? 'badge-design' :
                  proposal.status === 'rejected' ? 'bg-red-900/60 text-red-300 border border-red-700/40' :
                  'badge-lead'
                }`}>{proposal.status}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => { setActiveProposal(proposal); setViewMode('preview'); }} className="btn-primary btn-sm">
                  <Eye size={13} /> Preview
                </button>
                {isPreviewOnly ? (
                  <button onClick={() => setUpgradeOpen(true)} className="btn-secondary btn-sm opacity-50" title="Upgrade to download PDF">
                    <Lock size={13} /> PDF
                  </button>
                ) : (
                  <button onClick={() => handleDownloadPDF(proposal)} className="btn-secondary btn-sm" title="Download PDF">
                    <Download size={13} /> PDF
                  </button>
                )}
                <button className="btn-ghost p-2 rounded-lg" title="Share">
                  <Share2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Beautiful Proposal Preview ──────────────────────────────────────────────
function ProposalPreview({ proposal, onBack, onDownload, isPreviewOnly = false, onUpgrade }: {
  proposal: Proposal; onBack: () => void; onDownload: () => void;
  isPreviewOnly?: boolean; onUpgrade?: () => void;
}) {
  const proj = proposal.project;
  const client = proj?.client;
  const production = proj?.production;
  const cost = proj?.costEstimate as any;
  const layout = proj?.layout;

  // Pricing config from DB (fetched on mount)
  const [pricingCfg, setPricingCfg] = useState<any>(null);
  // White-label branding
  const [branding, setBranding] = useState<{
    companyName: string;
    companyLogoUrl: string | null;
    companyWebsite: string | null;
    companyAddress: string | null;
    companyPhone: string | null;
    brandPrimaryColor: string;
    proposalFooterText: string | null;
  }>({
    companyName: 'SolarPro',
    companyLogoUrl: null,
    companyWebsite: null,
    companyAddress: null,
    companyPhone: null,
    brandPrimaryColor: '#f59e0b',
    proposalFooterText: null,
  });

  useEffect(() => {
    fetch('/api/pricing')
      .then(r => r.json())
      .then(d => { if (d.success) setPricingCfg(d.data); })
      .catch(() => {});
    // Load branding
    fetch('/api/settings/branding')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setBranding({
            companyName: d.data.companyName || 'SolarPro',
            companyLogoUrl: d.data.companyLogoUrl || null,
            companyWebsite: d.data.companyWebsite || null,
            companyAddress: d.data.companyAddress || null,
            companyPhone: d.data.companyPhone || null,
            brandPrimaryColor: d.data.brandPrimaryColor || '#f59e0b',
            proposalFooterText: d.data.proposalFooterText || null,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Shareable link state
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);

  const handleShare = async () => {
    setShareLoading(true);
    try {
      // Generate a shareable token via API
      const res = await fetch(`/api/proposals/${proposal.id}/share`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.shareUrl) {
        setShareLink(data.shareUrl);
        await navigator.clipboard.writeText(data.shareUrl);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 3000);
      } else {
        // Fallback: copy current URL
        const url = `${window.location.origin}/proposals/view/${proposal.id}`;
        setShareLink(url);
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 3000);
      }
    } catch {
      const url = `${window.location.origin}/proposals/view/${proposal.id}`;
      setShareLink(url);
    } finally {
      setShareLoading(false);
    }
  };

  // Sales override state
  const [showOverrides, setShowOverrides] = useState(false);
  const [overridePpw, setOverridePpw]         = useState<string>('');
  const [overrideMargin, setOverrideMargin]   = useState<string>('');
  const [overrideFinal, setOverrideFinal]     = useState<string>('');

  // Compute effective pricing — priority: sales override > stored costEstimate > live calc
  // Fall back to project.systemSizeKw if layout not yet placed (preliminary mode)
  const systemSizeKw = (layout?.systemSizeKw && layout.systemSizeKw > 0)
    ? layout.systemSizeKw
    : ((proj as any)?.systemSizeKw ?? 0);
  const systemSizeW = systemSizeKw * 1000;
  const storedCashPrice = cost?.cashPrice ?? cost?.grossCost ?? 0;
  // FIX v47.12 Issue 2: Derive system type from layout (most accurate) > project > fallback
  // Never hardcode 'roof' — layout.systemType reflects actual 3D design placement
  const systemType: string =
    (layout?.systemType ? String(layout.systemType) : '') ||
    (proj?.systemType   ? String(proj.systemType)   : '') ||
    'roof'; // genuine last-resort fallback only

  // Live price-per-watt from admin pricing config
  const livePpw = pricingCfg
    ? (({
        roof:    pricingCfg.roofPricePerWatt    ?? pricingCfg.pricePerWatt ?? 3.10,
        ground:  pricingCfg.groundPricePerWatt  ?? pricingCfg.pricePerWatt ?? 2.35,
        fence:   pricingCfg.fencePricePerWatt   ?? pricingCfg.pricePerWatt ?? 4.25,
        carport: pricingCfg.carportPricePerWatt ?? pricingCfg.pricePerWatt ?? 3.75,
      } as Record<string, number>)[systemType] ?? pricingCfg.pricePerWatt ?? 3.10)
    : 3.10;

  const liveCalculatedPrice = systemSizeW > 0 ? Math.round(systemSizeW * livePpw) : 0;
  const baseCashPrice = storedCashPrice > 0 ? storedCashPrice : liveCalculatedPrice;

  const effectiveFinal = overrideFinal ? parseFloat(overrideFinal) : baseCashPrice;

  // ITC rate: use commercial vs residential split from config
  // Residential ITC was repealed (P.L. 119-21) — default to 0 for residential
  const isCommercial = pricingCfg?.isCommercial ?? false;
  const configItcRate = isCommercial
    ? (pricingCfg?.itcRateCommercial ?? 30)
    : (pricingCfg?.itcRateResidential ?? 0);
  const itcRate    = (cost?.taxCredit && cost?.totalBeforeCredit && cost.totalBeforeCredit > 0)
    ? Math.round((cost.taxCredit / cost.totalBeforeCredit) * 100)
    : configItcRate;
  const itcAmount  = Math.round(effectiveFinal * itcRate / 100);
  const effectiveNet = effectiveFinal - itcAmount;

  const effectivePpw = overridePpw
    ? parseFloat(overridePpw)
    : (systemSizeW > 0 ? parseFloat((effectiveFinal / systemSizeW).toFixed(2)) : (cost?.pricePerWatt ?? livePpw));

  // Savings — use stored values or estimate
  // FIX v47.12 Issue 4: use effectiveUtilityRate (set below after utilityRate computed) — reference same priority chain
  const annualSavings   = cost?.annualSavings   ?? Math.round((production?.annualProductionKwh ?? 0) * (((proj as any)?.utilityRatePerKwh && (proj as any).utilityRatePerKwh > 0.06) ? (proj as any).utilityRatePerKwh : (client?.utilityRate ?? 0.13)));
  const paybackYears    = cost?.paybackYears    ?? (annualSavings > 0 ? parseFloat((effectiveNet / annualSavings).toFixed(1)) : 0);
  const lifetimeSavings = cost?.lifetimeSavings ?? 0;

  // State incentives — computed from project stateCode
  const projectStateCode = (proj as any)?.stateCode || client?.state || '';
  const incentiveCalc = projectStateCode && systemSizeKw > 0
    ? calculateIncentives(projectStateCode, effectiveFinal, systemSizeKw, production?.annualProductionKwh ?? 0, !isCommercial, systemType)
    : null;
  // Normalize to a consistent shape for the UI
  // IMPORTANT: Only CASH incentives (ITC, tax credits, rebates) reduce net cost.
  // Property/sales tax exemptions and SRECs are non-cash benefits shown separately.
  const CASH_INCENTIVE_TYPES = ['federal_itc', 'state_tax_credit', 'state_rebate', 'utility_rebate', 'performance_payment'];
  const NON_CASH_INCENTIVE_TYPES = ['property_tax_exemption', 'sales_tax_exemption', 'srec', 'trec', 'net_metering', 'loan_program'];
  const stateIncentives = incentiveCalc ? {
    stateIncentives: incentiveCalc.state.map((s: any) => ({
      ...s,
      name: s.incentiveName,
      type: s.type,
      description: s.notes || s.description,
      calculatedValue: s.calculatedValue,
      isCash: CASH_INCENTIVE_TYPES.includes(s.type),
      isNonCash: NON_CASH_INCENTIVE_TYPES.includes(s.type),
      stackable: true,
    })),
    cashStateValue: incentiveCalc.cashTotal - incentiveCalc.federal.calculatedValue,
    totalStateValue: incentiveCalc.state.reduce((sum: number, s: any) => sum + s.calculatedValue, 0),
    federalValue: incentiveCalc.federal.calculatedValue,
    cashTotal: incentiveCalc.cashTotal,
    totalCombinedValue: incentiveCalc.total,
    netSystemCost: incentiveCalc.netSystemCost,
    solarFriendlyRating: 3,
    notes: incentiveCalc.summary,
  } : null;


  // ── Financial chart data ──────────────────────────────────────────────────
  // FIX v47.12 Issue 4: Priority: project.utilityRatePerKwh (bill-pipeline retail rate) >
  // client.utilityRate (may be stale 0.13 default) > national fallback 0.15
  const utilityRate =
    ((proj as any)?.utilityRatePerKwh && (proj as any).utilityRatePerKwh > 0.06)
      ? (proj as any).utilityRatePerKwh
      : (client?.utilityRate && client.utilityRate > 0.06)
        ? client.utilityRate
        : 0.15;
  const utilityInflation = 0.03;
  const panelDegradation = 0.005;

  // Monthly bill before/after solar
  const monthlyBillData = MONTHS.map((month, i) => {
    const seasonal = [0.85, 0.80, 0.90, 0.95, 1.05, 1.15, 1.25, 1.20, 1.10, 1.00, 0.88, 0.87];
    const annualUsageKwh = client?.annualKwh ?? (annualSavings > 0 ? annualSavings / utilityRate : 12000);
    const monthlyUsage = (annualUsageKwh / 12) * seasonal[i];
    const monthlyProduced = production?.monthlyProductionKwh?.[i] ?? 0;
    const before = Math.round(monthlyUsage * utilityRate);
    const after = Math.max(0, Math.round((monthlyUsage - monthlyProduced) * utilityRate));
    return { month, before, after, savings: before - after };
  });

  // 25-year projection
  const projectionData = Array.from({ length: 25 }, (_, i) => {
    const year = i + 1;
    const rate = utilityRate * Math.pow(1 + utilityInflation, i);
    const annualProd = (production?.annualProductionKwh ?? 0) * Math.pow(1 - panelDegradation, i);
    const yearlySavings = Math.round(annualProd * rate);
    const cumulative = Array.from({ length: year }, (_, j) => {
      const r = utilityRate * Math.pow(1 + utilityInflation, j);
      const p = (production?.annualProductionKwh ?? 0) * Math.pow(1 - panelDegradation, j);
      return p * r;
    }).reduce((a, b) => a + b, 0);
    return { year: `Yr ${year}`, savings: yearlySavings, cumulative: Math.round(cumulative) };
  });

  const totalLifetimeSavings = projectionData[24]?.cumulative ?? lifetimeSavings;

  // ── Energy offset ────────────────────────────────────────────────────────────────────────
  const annualProduction = production?.annualProductionKwh ?? 0;
  const annualUsage      = client?.annualKwh ?? 0;
  const energyOffset     = annualUsage > 0
    ? Math.min(Math.round((annualProduction / annualUsage) * 100), 100)
    : (production?.offsetPercentage ?? 0);

  // ── Equipment resolver ────────────────────────────────────────────────────────────────────────
  const equipment       = resolveEquipment(systemType);
  const racking         = equipment.racking;

  const systemTypeLabel = getSystemTypeLabel(systemType);
  const systemTypeIcon  = { roof: <Home size={16} />, ground: <Sprout size={16} />, fence: <Fence size={16} />, carport: <Sun size={16} /> }[systemType] ?? <Home size={16} />;

  const maxMonthly = production ? Math.max(...production.monthlyProductionKwh) : 1;

  return (
    <div className="flex flex-col">
      {/* Preview toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 bg-slate-900 border-b border-slate-700/50 no-print sticky top-0 z-10">
        <button onClick={onBack} className="btn-ghost p-2 rounded-lg flex items-center gap-2 text-sm">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-sm font-medium text-white truncate">{proposal.title}</span>
        <div className="ml-auto flex gap-2">
          {isPreviewOnly ? (
            <button onClick={onUpgrade} className="btn-secondary btn-sm opacity-60 flex items-center gap-1.5" title="Upgrade to download">
              <Lock size={13} /> Download PDF
            </button>
          ) : (
            <button onClick={onDownload} className="btn-primary btn-sm"><Download size={13} /> Download PDF</button>
          )}
          <button
            onClick={handleShare}
            disabled={shareLoading}
            className="btn-secondary btn-sm flex items-center gap-1.5"
          >
            {shareLoading ? <span className="spinner w-3 h-3" /> : <Share2 size={13} />}
            {shareCopied ? 'Link Copied!' : 'Share'}
          </button>
          {shareLink && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 max-w-xs">
              <span className="truncate">{shareLink}</span>
            </div>
          )}
          <button onClick={() => window.print()} className="btn-secondary btn-sm hidden md:flex"><Printer size={13} /> Print</button>
        </div>
      </div>

      {/* Proposal document */}
      <div className="bg-slate-950 p-4 md:p-8">
        <div id="proposal-document" className="max-w-4xl mx-auto bg-white text-slate-900 rounded-2xl overflow-hidden shadow-2xl shadow-black/50">

          {/* ── Cover Page ── */}
          <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white overflow-hidden">
            {/* Background decoration */}
            <div className="absolute inset-0">
              <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-amber-500/8 rounded-full -translate-y-1/2 translate-x-1/4" />
              <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/8 rounded-full translate-y-1/2 -translate-x-1/4" />
              <div className="absolute inset-0 opacity-[0.03]"
                style={{
                  backgroundImage: 'linear-gradient(#f59e0b 1px, transparent 1px), linear-gradient(90deg, #f59e0b 1px, transparent 1px)',
                  backgroundSize: '40px 40px'
                }}
              />
            </div>

            <div className="relative z-10 p-10 md:p-14">
              {/* Header — white-label branding */}
              <div className="flex items-center justify-between mb-12">
                <div className="flex items-center gap-3">
                  {branding.companyLogoUrl ? (
                    <img
                      src={branding.companyLogoUrl}
                      alt={branding.companyName}
                      className="h-12 max-w-[180px] object-contain"
                    />
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: branding.brandPrimaryColor }}>
                        <Sun size={24} className="text-slate-900" />
                      </div>
                      <div>
                        <div className="font-black text-xl tracking-tight">{branding.companyName}</div>
                        <div className="text-sm font-medium" style={{ color: branding.brandPrimaryColor }}>Solar Design Platform</div>
                      </div>
                    </>
                  )}
                </div>
                <div className="text-right text-sm text-slate-400">
                  <div>Proposal #{proposal.id?.substring(0, 8).toUpperCase()}</div>
                  <div>{new Date(proposal.preparedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                  {branding.companyPhone && <div className="mt-1">{branding.companyPhone}</div>}
                  {branding.companyWebsite && <div><a href={branding.companyWebsite} className="hover:underline" style={{ color: branding.brandPrimaryColor }}>{branding.companyWebsite.replace(/^https?:\/\//, '')}</a></div>}
                </div>
              </div>

              {/* Main headline */}
              <div className="mb-10">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-400 text-xs font-medium mb-4">
                  <Star size={11} /> Solar Energy Proposal
                </div>
                <h1 className="text-4xl md:text-5xl font-black mb-3 leading-tight">
                  {client?.name || 'Solar Energy'}<br />
                  <span className="text-amber-400">Proposal</span>
                </h1>
                <p className="text-slate-400 text-lg">
                  {client?.address && `${client.address}, ${client.city}, ${client.state} ${client.zip}`}
                </p>
              </div>

              {/* Key metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'System Type', value: systemTypeLabel, icon: systemTypeIcon, color: 'border-amber-500/30 bg-amber-500/10' },
                  { label: 'System Size', value: systemSizeKw > 0 ? `${systemSizeKw.toFixed(1)} kW` : '—', icon: <Zap size={16} />, color: 'border-blue-500/30 bg-blue-500/10' },
                  { label: 'Annual Production', value: production ? `${(production.annualProductionKwh / 1000).toFixed(1)} MWh` : (systemSizeKw > 0 ? `${(systemSizeKw * 1.25).toFixed(1)} MWh est.` : '—'), icon: <Sun size={16} />, color: 'border-emerald-500/30 bg-emerald-500/10' },
                  { label: 'Cash Price', value: effectiveFinal > 0 ? `$${effectiveFinal.toLocaleString()}` : '—', icon: <DollarSign size={16} />, color: 'border-purple-500/30 bg-purple-500/10' },
                ].map(item => (
                  <div key={item.label} className={`rounded-xl p-4 border ${item.color} backdrop-blur-sm`}>
                    <div className="text-slate-400 mb-2">{item.icon}</div>
                    <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{item.label}</div>
                    <div className="font-bold text-lg text-white">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Client Information ── */}
          <div className="p-8 md:p-10 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                <Users size={16} className="text-blue-600" />
              </div>
              <h2 className="text-xl font-black text-slate-900">Client Information</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Full Name</div>
                  <div className="font-semibold text-slate-900 text-lg">{client?.name || '—'}</div>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Mail size={14} className="text-slate-400" />
                  {client?.email || '—'}
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Phone size={14} className="text-slate-400" />
                  {client?.phone || '—'}
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Installation Address</div>
                  <div className="flex items-start gap-2 text-sm text-slate-600">
                    <MapPin size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-900">{client?.address}</div>
                      <div>{client?.city}, {client?.state} {client?.zip}</div>
                    </div>
                  </div>
                </div>
                {client?.utilityProvider && (
                  <div>
                    <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Utility Provider</div>
                    <div className="font-semibold text-slate-900">{client.utilityProvider}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── System Overview ── */}
          <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
                <Sun size={16} className="text-amber-600" />
              </div>
              <h2 className="text-xl font-black text-slate-900">System Overview</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { icon: systemTypeIcon, label: 'System Type', value: systemTypeLabel, color: 'bg-amber-50 text-amber-700 border-amber-200' },
                { icon: <Zap size={18} />, label: 'System Size', value: systemSizeKw > 0 ? `${systemSizeKw.toFixed(2)} kW` : '—', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                { icon: <Sun size={18} />, label: 'Panel Count', value: (layout?.totalPanels && layout.totalPanels > 0) ? `${layout.totalPanels} panels` : (systemSizeKw > 0 ? `${Math.ceil(systemSizeKw / 0.44)} panels` : '—'), color: 'bg-orange-50 text-orange-700 border-orange-200' },
                { icon: <TrendingUp size={18} />, label: 'Annual Production', value: production ? `${production.annualProductionKwh.toLocaleString()} kWh` : (systemSizeKw > 0 ? `${Math.round(systemSizeKw * 1250).toLocaleString()} kWh est.` : '—'), color: 'bg-green-50 text-green-700 border-green-200' },
              ].map(item => (
                <div key={item.label} className={`rounded-xl p-4 border ${item.color}`}>
                  <div className="mb-2 opacity-70">{item.icon}</div>
                  <div className="text-xs uppercase tracking-wide opacity-60 mb-1">{item.label}</div>
                  <div className="font-bold text-base">{item.value}</div>
                </div>
              ))}
            </div>

            {/* Equipment Specifications */}
            {layout && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h4 className="font-semibold text-slate-700 text-sm mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center text-xs">⚙️</span>
                  Equipment Specifications
                </h4>

                {/* Solar Panels */}
                <div className="mb-4">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Solar Panels</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Manufacturer', value: (proj?.selectedPanel?.manufacturer) || 'SunPower' },
                      { label: 'Model', value: (proj?.selectedPanel?.model) || 'Maxeon 7 440W' },
                      { label: 'Wattage', value: `${(proj?.selectedPanel?.wattage) || (layout as any).wattage || 400}W` },
                      { label: 'Efficiency', value: `${(proj?.selectedPanel?.efficiency) || 22.8}%` },
                      { label: 'Cell Type', value: (proj?.selectedPanel?.cellType) || 'Mono PERC' },
                      { label: 'Bifacial', value: (proj?.selectedPanel?.bifacial) ? `Yes (×${proj?.selectedPanel?.bifacialFactor})` : 'No' },
                      { label: 'Temp. Coefficient', value: `${(proj?.selectedPanel?.temperatureCoeff) || -0.27}%/°C` },
                      { label: 'Warranty', value: `${(proj?.selectedPanel?.warranty) || 25} years` },
                    ].map(item => (
                      <div key={item.label} className="bg-amber-50 rounded-lg p-2.5 border border-amber-100">
                        <div className="text-xs text-slate-400 mb-0.5">{item.label}</div>
                        <div className="text-xs font-bold text-slate-800">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Inverter */}
                {proj?.selectedInverter && (
                  <div className="mb-4">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Inverter</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'Manufacturer', value: proj.selectedInverter.manufacturer },
                        { label: 'Model', value: proj.selectedInverter.model },
                        { label: 'Capacity', value: `${proj.selectedInverter.capacity} kW` },
                        { label: 'Efficiency', value: `${proj.selectedInverter.efficiency}%` },
                        { label: 'Type', value: proj.selectedInverter.type === 'micro' ? 'Microinverter' : proj.selectedInverter.type === 'optimizer' ? 'String + Optimizer' : 'String Inverter' },
                        { label: 'MPPT Channels', value: `${proj.selectedInverter.mpptChannels || 2}` },
                        { label: 'Battery Ready', value: proj.selectedInverter.batteryCompatible ? 'Yes' : 'No' },
                        { label: 'Warranty', value: `${proj.selectedInverter.warranty || 12} years` },
                      ].map(item => (
                        <div key={item.label} className="bg-blue-50 rounded-lg p-2.5 border border-blue-100">
                          <div className="text-xs text-slate-400 mb-0.5">{item.label}</div>
                          <div className="text-xs font-bold text-slate-800">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mounting & Railing — system-type-aware via systemEquipmentResolver */}
                <div className="mb-4">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Railing & Mounting System</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { label: 'Racking Brand',  value: racking.rackingBrand },
                      { label: 'Racking Model',  value: racking.rackingModel },
                      { label: 'System Type',    value: systemTypeLabel },
                      { label: 'Tilt Range',     value: racking.tiltRange },
                      { label: 'Rail Material',  value: racking.railMaterial },
                      { label: 'Hardware',       value: racking.hardware },
                      { label: 'Attachment',     value: racking.attachmentType },
                      { label: 'Warranty',       value: racking.warranty },
                      { label: 'Certifications', value: racking.certifications },
                    ].map(item => (
                      <div key={item.label} className="bg-emerald-50 rounded-lg p-2.5 border border-emerald-100">
                        <div className="text-xs text-slate-400 mb-0.5">{item.label}</div>
                        <div className="text-xs font-bold text-slate-800">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Attachment Hardware — system-type-aware */}
                <div>
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">{equipment.sectionTitle}</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {equipment.attachmentCards.map(item => (
                      <div key={item.label} className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-sm">{item.icon}</span>
                          <div className="text-xs font-bold text-slate-700">{item.label}</div>
                        </div>
                        <div className="text-xs text-slate-600 mb-0.5">{item.hardware}</div>
                        <div className="text-xs text-slate-400">{item.note}</div>
                      </div>
                    ))}
                  </div>
                </div>


                {/* FIX v47.12 Issue 3: Roof Attachment Hardware — only for roof systems */}
                {(systemType === 'roof' || systemType === 'ROOF_MOUNT') && (
                <div>
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Roof Attachment Hardware</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      {
                        label: 'Asphalt Shingle',
                        hardware: 'Flashed L-Foot + 5/16" × 3" lag bolt into rafter',
                        note: 'EPDM flashing, min. 2.5" rafter embedment',
                        icon: '🏠',
                      },
                      {
                        label: 'Tile Roof',
                        hardware: 'QuickMount PV Tile Hook or tile replacement mount',
                        note: 'Remove tile, install flashing, replace tile',
                        icon: '🏛️',
                      },
                      {
                        label: 'Metal Roof',
                        hardware: 'S-5! PVKIT 2.0 clamp — no penetrations',
                        note: 'Clamp to standing seam, no roof penetrations',
                        icon: '🏗️',
                      },
                      {
                        label: 'Flat TPO/EPDM',
                        hardware: 'Esdec FlatFix Fusion ballasted system',
                        note: 'No penetrations, ballasted tray system',
                        icon: '🏢',
                      },
                      {
                        label: 'Corrugated Metal',
                        hardware: 'SnapNrack Series 100 + EPDM washers',
                        note: 'Self-tapping screws into structural purlins',
                        icon: '🏭',
                      },
                      {
                        label: 'Ground Mount',
                        hardware: 'Unirac RM10 or IronRidge driven pier system',
                        note: 'Adjustable tilt 10–30°, galvanized steel piers',
                        icon: '🌱',
                      },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-sm">{item.icon}</span>
                          <div className="text-xs font-bold text-slate-700">{item.label}</div>
                        </div>
                        <div className="text-xs text-slate-600 mb-0.5">{item.hardware}</div>
                        <div className="text-xs text-slate-400">{item.note}</div>
                      </div>
                    ))}
                  </div>
                </div>
                )}

                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <span>Prepared by: {proposal.preparedBy}</span>
                  <span>Valid until: {new Date(proposal.validUntil).toLocaleDateString()}</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Production Analysis ── */}
          {production && (
            <div className="p-8 md:p-10 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                  <BarChart2 size={16} className="text-emerald-600" />
                </div>
                <h2 className="text-xl font-black text-slate-900">Production Analysis</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Monthly chart */}
                <div>
                  <h4 className="font-semibold text-slate-700 mb-4 text-sm">Monthly Production (kWh)</h4>
                  <div className="flex items-end gap-1 h-28 mb-2">
                    {production.monthlyProductionKwh.map((kwh: number, i: number) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t-sm transition-all"
                          style={{
                            height: `${(kwh / maxMonthly) * 100}px`,
                            background: `linear-gradient(to top, #f59e0b, #fbbf24)`
                          }}
                        />
                        <span className="text-slate-400" style={{ fontSize: '8px' }}>{MONTHS[i][0]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-slate-400 text-center">
                    Peak: {MONTHS[production.monthlyProductionKwh.indexOf(Math.max(...production.monthlyProductionKwh))]} — {Math.max(...production.monthlyProductionKwh).toLocaleString()} kWh
                  </div>
                </div>

                {/* Stats */}
                <div className="space-y-2.5">
                  {[
                    { label: 'Annual Production', value: `${production.annualProductionKwh.toLocaleString()} kWh`, highlight: true },
                    { label: 'Energy Offset', value: `${energyOffset}%` },
                    { label: 'Specific Yield', value: `${production.specificYield} kWh/kWp` },
                    { label: 'Performance Ratio', value: `${(production.performanceRatio * 100).toFixed(0)}%` },
                    { label: 'CO₂ Offset', value: `${production.co2OffsetTons} tons/year`, green: true },
                    { label: 'Trees Equivalent', value: `${production.treesEquivalent} trees`, green: true },
                  ].map(item => (
                    <div key={item.label} className={`flex justify-between items-center text-sm py-2 px-3 rounded-lg ${
                      (item as any).highlight ? 'bg-amber-50 border border-amber-200' :
                      (item as any).green ? 'bg-emerald-50 border border-emerald-200' :
                      'bg-slate-50 border border-slate-100'
                    }`}>
                      <span className="text-slate-600">{item.label}</span>
                      <span className={`font-bold ${(item as any).highlight ? 'text-amber-700' : (item as any).green ? 'text-emerald-700' : 'text-slate-900'}`}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Utility Bill Comparison ── */}
          {production && monthlyBillData.some(m => m.before > 0) && (
            <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-green-50/30 to-white">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center">
                  <DollarSign size={16} className="text-green-600" />
                </div>
                <h2 className="text-xl font-black text-slate-900">Utility Bill: Before vs After Solar</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                  <div className="text-xs font-bold text-red-600 uppercase tracking-wide mb-1">Current Annual Bill</div>
                  <div className="text-2xl font-black text-red-700">
                    ${monthlyBillData.reduce((s, m) => s + m.before, 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-red-500 mt-1">Without solar</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                  <div className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-1">After Solar Annual Bill</div>
                  <div className="text-2xl font-black text-emerald-700">
                    ${monthlyBillData.reduce((s, m) => s + m.after, 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-emerald-500 mt-1">With solar system</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                  <div className="text-xs font-bold text-amber-600 uppercase tracking-wide mb-1">Year 1 Savings</div>
                  <div className="text-2xl font-black text-amber-700">
                    ${monthlyBillData.reduce((s, m) => s + m.savings, 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-amber-500 mt-1">First year reduction</div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-sm font-semibold text-slate-700 mb-3">Monthly Bill Comparison</div>
                <div className="flex items-end gap-1 h-32 mb-2">
                  {monthlyBillData.map((m, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="w-full flex flex-col justify-end gap-0.5" style={{ height: '112px' }}>
                        <div
                          className="w-full bg-red-400/60 rounded-t-sm"
                          style={{ height: `${(m.before / Math.max(...monthlyBillData.map(x => x.before), 1)) * 56}px` }}
                          title={`Before: $${m.before}`}
                        />
                        <div
                          className="w-full bg-emerald-500 rounded-t-sm"
                          style={{ height: `${(m.after / Math.max(...monthlyBillData.map(x => x.before), 1)) * 56}px` }}
                          title={`After: $${m.after}`}
                        />
                      </div>
                      <span className="text-slate-400" style={{ fontSize: '8px' }}>{MONTHS[i][0]}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500 justify-center">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-400/60 inline-block" />Before Solar</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />After Solar</span>
                </div>
              </div>
            </div>
          )}

          {/* ── 25-Year Savings Projection ── */}
          {production && (production.annualProductionKwh ?? 0) > 0 && (
            <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-blue-50/30 to-white">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                  <TrendingUp size={16} className="text-blue-600" />
                </div>
                <h2 className="text-xl font-black text-slate-900">25-Year Savings Projection</h2>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {[
                  { label: 'Year 1 Savings', value: `$${projectionData[0]?.savings.toLocaleString() ?? 0}`, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
                  { label: 'Year 10 Savings', value: `$${projectionData[9]?.savings.toLocaleString() ?? 0}`, color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
                  { label: 'Year 25 Savings', value: `$${projectionData[24]?.savings.toLocaleString() ?? 0}`, color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
                  { label: '25-Year Total', value: `$${totalLifetimeSavings.toLocaleString()}`, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
                ].map(item => (
                  <div key={item.label} className={`${item.bg} border rounded-xl p-4 text-center`}>
                    <div className={`text-xl font-black ${item.color}`}>{item.value}</div>
                    <div className="text-xs text-slate-500 mt-1">{item.label}</div>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-sm font-semibold text-slate-700 mb-3">Cumulative Savings Over 25 Years</div>
                <div className="flex items-end gap-0.5 h-28 mb-2">
                  {projectionData.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div
                        className="w-full rounded-t-sm transition-all"
                        style={{
                          height: `${(d.cumulative / (projectionData[24]?.cumulative || 1)) * 100}px`,
                          background: `linear-gradient(to top, #3b82f6, #6366f1)`
                        }}
                        title={`Year ${i + 1}: $${d.cumulative.toLocaleString()} cumulative`}
                      />
                      {(i + 1) % 5 === 0 && (
                        <span className="text-slate-400" style={{ fontSize: '8px' }}>Yr{i + 1}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="text-xs text-slate-400 text-center">
                  Assumes 3% annual utility rate increase · 0.5% panel degradation per year
                </div>
              </div>
            </div>
          )}

          {/* ── Sales Override Panel (no-print) ── */}
          <div className="no-print p-4 md:p-6 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Settings size={15} className="text-slate-500" />
                <span className="text-sm font-bold text-slate-700">Sales Rep Pricing Controls</span>
                <span className="text-xs text-slate-400">(internal only — not shown on PDF)</span>
              </div>
              <button
                onClick={() => setShowOverrides(!showOverrides)}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                {showOverrides ? 'Hide' : 'Show'} Overrides
              </button>
            </div>
            {showOverrides && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    <Tag size={11} className="inline mr-1" />Override Price Per Watt ($/W)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="1"
                    max="10"
                    placeholder={`Default: $${(cost?.pricePerWatt ?? 3.10).toFixed(2)}/W`}
                    value={overridePpw}
                    onChange={e => {
                      setOverridePpw(e.target.value);
                      if (e.target.value && systemSizeW > 0) {
                        setOverrideFinal(String(Math.round(parseFloat(e.target.value) * systemSizeW)));
                      }
                    }}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    <Percent size={11} className="inline mr-1" />Override Margin %
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="80"
                    placeholder="Default: 40%"
                    value={overrideMargin}
                    onChange={e => setOverrideMargin(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    <DollarSign size={11} className="inline mr-1" />Override Final Price ($)
                  </label>
                  <input
                    type="number"
                    step="100"
                    min="0"
                    placeholder={`Default: $${baseCashPrice.toLocaleString()}`}
                    value={overrideFinal}
                    onChange={e => {
                      setOverrideFinal(e.target.value);
                      if (e.target.value && systemSizeW > 0) {
                        setOverridePpw(String((parseFloat(e.target.value) / systemSizeW).toFixed(2)));
                      }
                    }}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {/* Internal profit display */}
                {cost?.internalProfit !== undefined && (
                  <div className="md:col-span-3 bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Revenue</div>
                      <div className="font-black text-slate-800">${effectiveFinal.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Est. Cost</div>
                      <div className="font-black text-slate-800">${(cost?.internalCost ?? cost?.estimatedCost ?? 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Gross Profit</div>
                      <div className={`font-black ${(effectiveFinal - (cost?.internalCost ?? 0)) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        ${(effectiveFinal - (cost?.internalCost ?? cost?.estimatedCost ?? 0)).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Margin %</div>
                      <div className={`font-black ${(effectiveFinal - (cost?.internalCost ?? 0)) / effectiveFinal * 100 > 20 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {effectiveFinal > 0 ? (((effectiveFinal - (cost?.internalCost ?? cost?.estimatedCost ?? 0)) / effectiveFinal) * 100).toFixed(1) : '0'}%
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Financial Analysis ── */}
          {cost && (
            <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center">
                  <DollarSign size={16} className="text-green-600" />
                </div>
                <h2 className="text-xl font-black text-slate-900">Financial Analysis</h2>
              </div>

              {/* Pricing summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-300 rounded-2xl p-5 text-center">
                  <div className="text-xs font-bold text-amber-600 uppercase tracking-wide mb-1">Cash Price</div>
                  <div className="text-3xl font-black text-amber-700">${effectiveFinal.toLocaleString()}</div>
                  <div className="text-xs text-amber-500 mt-1">Before incentives</div>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-300 rounded-2xl p-5 text-center">
                  <div className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-1">Cost After Incentives</div>
                  <div className="text-3xl font-black text-emerald-700">${effectiveNet.toLocaleString()}</div>
                  <div className="text-xs text-emerald-500 mt-1">
                    {itcRate > 0
                      ? `After ${itcRate}% ITC ($${itcAmount.toLocaleString()} credit)`
                      : 'No ITC applied (residential)'}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-2xl p-5 text-center">
                  <div className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-1">Price Per Watt</div>
                  <div className="text-3xl font-black text-blue-700">${effectivePpw.toFixed(2)}/W</div>
                  <div className="text-xs text-blue-500 mt-1">{systemSizeKw.toFixed(1)} kW system</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Investment breakdown — itemized by installation type */}
                <div>
                  <h4 className="font-semibold text-slate-700 mb-4 text-sm">Investment Breakdown</h4>
                  <div className="space-y-2">
                    {/* Itemized line items by installation type */}
                    {cost?.lineItems && cost.lineItems.length > 0 ? (
                      <>
                        {cost.lineItems.map((item: { type: string; label: string; panelCount: number; pricePerPanel: number; subtotal: number }) => (
                          <div key={item.type} className="py-2 border-b border-slate-100">
                            <div className="flex justify-between text-sm">
                              <span className="font-semibold text-slate-700">{item.label}</span>
                              <span className="font-bold text-slate-900">${item.subtotal.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                              <span>{item.panelCount} panels × ${item.pricePerPanel.toLocaleString()}/panel</span>
                              <span>${(item.pricePerPanel / (pricingCfg?.defaultPanelWattage ?? 440)).toFixed(2)}/W</span>
                            </div>
                          </div>
                        ))}
                        {cost.fixedCosts > 0 && (
                          <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                            <span className="text-slate-500">Fixed Project Cost</span>
                            <span className="font-medium text-slate-700">${cost.fixedCosts.toLocaleString()}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      /* Fallback: no line items — show simple total */
                      <div className="py-2 border-b border-slate-100">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">System Installation</span>
                          <span className="font-medium text-slate-900">${effectiveFinal.toLocaleString()}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {layout?.totalPanels ?? 0} panels · {systemSizeKw.toFixed(1)} kW
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between text-sm py-2 border-b border-slate-200 font-bold">
                      <span className="text-slate-700">Cash Price</span>
                      <span className="text-slate-900">${effectiveFinal.toLocaleString()}</span>
                    </div>
                    {itcRate > 0 ? (
                      <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                        <span className="text-slate-500 font-medium">
                          {isCommercial ? 'Commercial' : 'Federal'} Tax Credit ({itcRate}% ITC)
                        </span>
                        <span className="text-emerald-600 font-bold">-${itcAmount.toLocaleString()}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                        <span className="text-slate-400 font-medium">Federal ITC (Residential — Not Available)</span>
                        <span className="text-slate-400">$0</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-black py-3 bg-amber-50 rounded-xl px-3 border border-amber-200 mt-2">
                      <span className="text-slate-900">Cost After Incentives</span>
                      <span className="text-amber-700">${effectiveNet.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm py-2 text-slate-500">
                      <span>Price Per Watt</span>
                      <span className="font-bold text-blue-700">${effectivePpw.toFixed(2)}/W</span>
                    </div>
                  </div>
                </div>

                {/* ROI */}
                <div>
                  <h4 className="font-semibold text-slate-700 mb-4 text-sm">Return on Investment</h4>
                  <div className="space-y-3">
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                      <div className="text-3xl font-black text-green-700">${annualSavings.toLocaleString()}</div>
                      <div className="text-sm text-green-600 font-medium">Annual Savings</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                        <div className="text-xl font-black text-blue-700">{paybackYears}</div>
                        <div className="text-xs text-blue-600">Year Payback</div>
                      </div>
                      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
                        <div className="text-xl font-black text-purple-700">{cost.roi}%</div>
                        <div className="text-xs text-purple-600">Total ROI</div>
                      </div>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                      <div className="text-2xl font-black text-emerald-700">${lifetimeSavings.toLocaleString()}</div>
                      <div className="text-sm text-emerald-600 font-medium">25-Year Total Savings</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── State-Specific Incentives (dynamic by project location) ── */}
          {stateIncentives && stateIncentives.stateIncentives.length > 0 && (
            <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-emerald-50/30 to-white">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                  <MapPin size={16} className="text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">
                    {projectStateCode} State Incentives
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Auto-detected for {projectStateCode} — Solar Friendliness Rating: {'⭐'.repeat(stateIncentives.solarFriendlyRating || 3)}
                  </p>
                </div>
              </div>

              {/* Total state savings summary — only CASH incentives reduce net cost */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                  <div className="text-2xl font-black text-blue-700">
                    ${(stateIncentives.federalValue || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-blue-600 font-medium">Federal ITC (30%)</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                  <div className="text-2xl font-black text-emerald-700">
                    ${(stateIncentives.cashStateValue || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-emerald-600 font-medium">State Cash Incentives</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                  <div className="text-2xl font-black text-amber-700">
                    ${(stateIncentives.cashTotal || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-amber-600 font-medium">Total Cash Savings</div>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-center">
                  <div className="text-2xl font-black text-purple-700">
                    ${(stateIncentives.netSystemCost || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-purple-600 font-medium">Net System Cost</div>
                </div>
              </div>
              <p className="text-xs text-slate-400 mb-4 italic">* Net cost reflects Federal ITC + cash rebates/credits only. Property tax exemptions, sales tax exemptions, and SRECs are additional ongoing benefits shown below.</p>

              {/* Individual incentives */}
              <div className="space-y-3">
                {stateIncentives.stateIncentives.map((inc: any, i: number) => (
                  <div key={i} className={`bg-white border rounded-xl p-4 flex items-start justify-between gap-4 ${inc.isNonCash ? 'border-slate-200 opacity-90' : 'border-emerald-200'}`}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                          inc.type === 'state_tax_credit' ? 'bg-blue-100 text-blue-700' :
                          inc.type === 'state_rebate' ? 'bg-emerald-100 text-emerald-700' :
                          inc.type === 'srec' ? 'bg-amber-100 text-amber-700' :
                          inc.type === 'property_tax_exemption' ? 'bg-purple-100 text-purple-700' :
                          inc.type === 'sales_tax_exemption' ? 'bg-teal-100 text-teal-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {inc.type.replace(/_/g, ' ').toUpperCase()}
                        </span>
                        {inc.isNonCash && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500">
                            Additional Benefit
                          </span>
                        )}
                        {inc.stackable && (
                          <span className="text-xs text-slate-400">Stackable</span>
                        )}
                      </div>
                      <div className="font-semibold text-slate-800 text-sm">{inc.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{inc.description}</div>
                      {inc.expirationDate && (
                        <div className="text-xs text-amber-600 mt-1">⏰ Expires: {inc.expirationDate}</div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {inc.isCash ? (
                        <>
                          <div className="text-lg font-black text-emerald-700">
                            ${(inc.calculatedValue || 0).toLocaleString()}
                          </div>
                          <div className="text-xs text-slate-400">cash savings</div>
                        </>
                      ) : inc.type === 'srec' || inc.type === 'trec' ? (
                        <>
                          <div className="text-lg font-black text-amber-600">
                            ${(inc.calculatedValue || 0).toLocaleString()}
                          </div>
                          <div className="text-xs text-slate-400">est. 15-yr income*</div>
                        </>
                      ) : (
                        <>
                          <div className="text-lg font-black text-purple-600">
                            Ongoing
                          </div>
                          <div className="text-xs text-slate-400">tax benefit</div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {stateIncentives.stateIncentives.some((inc: any) => inc.type === 'srec' || inc.type === 'trec') && (
                  <p className="text-xs text-slate-400 mt-2 italic">* SREC/TREC values are market-dependent and not guaranteed. Actual income may vary.</p>
                )}
              </div>

              {stateIncentives.notes && (
                <p className="text-xs text-slate-400 mt-4">{stateIncentives.notes}</p>
              )}
            </div>
          )}

          {/* ── ITC + SREC Incentives ── */}
          <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-blue-50/50 to-white">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                <TrendingUp size={16} className="text-blue-600" />
              </div>
              <h2 className="text-xl font-black text-slate-900">Available Incentives & Tax Credits</h2>
            </div>

              {/* Federal ITC — Updated per P.L. 119-21 (One Big Beautiful Bill Act, July 4, 2025) */}
              <div className="mb-5">

                {/* Commercial ITC — Still Available under §48E */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-6 mb-4">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-600 text-white">COMMERCIAL</span>
                        <span className="text-xs text-blue-700 font-medium">Clean Electricity ITC — IRC §48E (Still Available)</span>
                      </div>
                      <h3 className="text-2xl font-black text-blue-700">30% Commercial Solar ITC</h3>
                      <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                        The <strong>commercial Investment Tax Credit (IRC §48E)</strong> remains available for qualifying projects.
                        To receive the full 30% credit, construction must begin before <strong>July 4, 2026</strong>, and prevailing
                        wage &amp; apprenticeship requirements must be met. Projects beginning construction after that date face accelerated phase-out.
                      </p>
                    </div>
                    <div className="text-center flex-shrink-0 bg-blue-100 rounded-xl p-4">
                      <div className="text-4xl font-black text-blue-600">30%</div>
                      <div className="text-xs text-blue-700 font-semibold">commercial ITC</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { label: 'Begin Construction', detail: 'Must begin before July 4, 2026 for full IRA-era credit rates', icon: '🏗️' },
                      { label: 'Prevailing Wage', detail: 'Full 30% requires prevailing wage & apprenticeship compliance (IRC §48E)', icon: '👷' },
                      { label: 'Foreign Entity Rules', detail: 'Projects with prohibited foreign entity (PFE) content may be disqualified', icon: '🌐' },
                    ].map(item => (
                      <div key={item.label} className="bg-white/70 rounded-xl p-3 border border-blue-100">
                        <div className="text-lg mb-1">{item.icon}</div>
                        <div className="text-xs font-bold text-slate-800 mb-1">{item.label}</div>
                        <div className="text-xs text-slate-500 leading-relaxed">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-3">Source: P.L. 119-21 §70501 (July 4, 2025); IRC §48E. Consult a qualified tax professional for project-specific eligibility.</p>
                </div>

                {/* Residential ITC — Repealed Notice */}
                <div className="bg-gradient-to-r from-slate-50 to-gray-50 border border-slate-200 rounded-2xl p-6">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-slate-200 flex items-center justify-center text-xl">⚠️</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-500 text-white">RESIDENTIAL</span>
                        <span className="text-xs text-slate-600 font-medium">IRC §25D — Repealed by P.L. 119-21 (July 4, 2025)</span>
                      </div>
                      <h3 className="text-lg font-black text-slate-700">Residential Solar ITC: No Longer Available for 2026+ Installs</h3>
                      <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                        The <strong>residential solar tax credit (IRC §25D)</strong> was <strong>permanently repealed</strong> by the
                        One Big Beautiful Bill Act (P.L. 119-21, signed July 4, 2025) for all installations completed after
                        <strong> December 31, 2025</strong>. The IRS has confirmed (FAQ FS-2025-05, Aug 21, 2025) that paying a
                        deposit or signing a contract before that date does <em>not</em> preserve the credit — only completed
                        installations qualify.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    {[
                      { label: 'Installed by 12/31/2025', detail: '30% credit available — installation must be physically complete by this date', icon: '✅', ok: true },
                      { label: 'Installed in 2026+', detail: 'No federal residential ITC — §25D was repealed by P.L. 119-21', icon: '❌', ok: false },
                      { label: 'Contract/Deposit Only', detail: 'Does NOT preserve the credit — installation completion date controls per IRS FAQ FS-2025-05', icon: '⚠️', ok: false },
                    ].map(item => (
                      <div key={item.label} className={`rounded-xl p-3 border ${item.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                        <div className="text-lg mb-1">{item.icon}</div>
                        <div className={`text-xs font-bold mb-1 ${item.ok ? 'text-emerald-800' : 'text-red-800'}`}>{item.label}</div>
                        <div className="text-xs text-slate-500 leading-relaxed">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3">
                    <p className="text-xs text-blue-800 font-semibold mb-1">💡 What to do instead — State & Local Incentives:</p>
                    <p className="text-xs text-blue-700">Many states offer their own solar tax credits, rebates, and net metering programs independent of federal law.
                      Check <strong>dsireusa.org</strong> for your state. SREC income (below) may also apply. Ohio, for example, has net metering and SREC programs through AEP/FirstEnergy.</p>
                  </div>
                  <p className="text-xs text-slate-400">Sources: P.L. 119-21 §70501 (July 4, 2025) · IRS FAQ FS-2025-05 (Aug 21, 2025) · CRS Report R48611 (July 29, 2025)</p>
                </div>
              </div>

            {/* SREC Section — FIX v47.12 Issue 6: only show for states with active SREC/TREC markets */}
          {SREC_STATES.has((projectStateCode || '').toUpperCase()) && (
            <div>
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-600 text-white">STATE</span>
                      <span className="text-xs text-emerald-700 font-medium">Solar Renewable Energy Credits (SRECs)</span>
                    </div>
                    <h3 className="text-xl font-black text-emerald-700">Earn Passive Income from SRECs</h3>
                    <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                      In eligible states, your system earns <strong>1 SREC per 1,000 kWh</strong> produced. These credits are sold to utilities required to meet state Renewable Portfolio Standards — creating a <strong>second income stream</strong> beyond electricity savings.
                    </p>
                  </div>
                  <div className="text-center flex-shrink-0 bg-emerald-100 rounded-xl p-4">
                    <div className="text-3xl font-black text-emerald-600">+$$</div>
                    <div className="text-xs text-emerald-700 font-semibold">extra income</div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-emerald-200">
                        <th className="text-left py-2 px-2 text-slate-500 font-semibold">State / Market</th>
                        <th className="text-right py-2 px-2 text-slate-500 font-semibold">SREC Price (2025)</th>
                        <th className="text-right py-2 px-2 text-slate-500 font-semibold">Est. Annual Income†</th>
                        <th className="text-left py-2 px-2 text-slate-500 font-semibold">Program Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { state: 'Washington D.C. ★', price: '$380–$435', income: '$4,600–$5,700', program: 'Active — Premium Market', hi: true },
                        { state: 'Maryland', price: '$50–$74.50', income: '$600–$900', program: 'Active — Certified SREC', hi: false },
                        { state: 'Virginia', price: '$35–$45', income: '$420–$540', program: 'Active (policy review)', hi: false },
                        { state: 'Pennsylvania', price: '$30–$50', income: '$360–$600', program: 'Active SREC Market', hi: false },
                        { state: 'New Jersey', price: 'SuSI Program', income: 'Fixed incentive', program: 'Successor Solar Incentive', hi: false },
                        { state: 'Massachusetts', price: 'SMART Program', income: 'Declining block', program: 'Replaced SREC in 2018', hi: false },
                        { state: 'Ohio', price: '$3–$6', income: '$36–$72', program: 'Active (low value)', hi: false },
                        { state: 'Other States', price: 'Varies', income: 'Check DSIRE.org', program: 'State-specific programs', hi: false },
                      ].map(row => (
                        <tr key={row.state} className={`border-b border-emerald-100 ${row.hi ? 'bg-emerald-100/60 font-semibold' : ''}`}>
                          <td className="py-2 px-2 text-slate-800">{row.state}</td>
                          <td className="py-2 px-2 text-right font-bold text-emerald-700">{row.price}</td>
                          <td className="py-2 px-2 text-right text-slate-700">{row.income}</td>
                          <td className="py-2 px-2 text-slate-500">{row.program}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-400 mt-3">† Estimates for a 10kW system generating ~12 SRECs/year. Prices from Flett Exchange & SRECTrade, 2025. SREC availability depends on your state. Source: SRECTrade.com, DSIRE.org.</p>
              </div>
            </div>
          )}
          </div>

          {/* ── Why Solar ── */}
          <div className="p-8 md:p-10 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
                <Award size={16} className="text-amber-600" />
              </div>
              <h2 className="text-xl font-black text-slate-900">Why Go Solar?</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { icon: <DollarSign size={24} />, title: 'Save Money', desc: 'Reduce or eliminate your monthly electric bill and protect against rising utility rates for 25+ years.', color: 'text-green-600 bg-green-50 border-green-200', stat: '25yr', statLabel: 'Panel Warranty' },
                { icon: <Shield size={24} />, title: 'Energy Independence', desc: 'Generate your own clean energy and reduce dependence on the utility grid and volatile energy prices.', color: 'text-blue-600 bg-blue-50 border-blue-200', stat: '25yr', statLabel: 'Panel Warranty' },
                { icon: <Leaf size={24} />, title: 'Go Green', desc: 'Reduce your carbon footprint and contribute to a cleaner, more sustainable future for generations.', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', stat: '0', statLabel: 'Emissions' },
              ].map(item => (
                <div key={item.title} className={`rounded-xl p-5 border ${item.color}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="opacity-70">{item.icon}</div>
                    <div className="text-right">
                      <div className="text-xl font-black">{item.stat}</div>
                      <div className="text-xs opacity-60">{item.statLabel}</div>
                    </div>
                  </div>
                  <h4 className="font-bold text-slate-900 mb-2">{item.title}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Next Steps ── */}
          <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
            <h2 className="text-xl font-black text-slate-900 mb-6">Next Steps</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { step: '1', title: 'Review & Approve', desc: 'Review this proposal and let us know if you have any questions or need adjustments.', icon: <CheckCircle size={18} className="text-blue-500" /> },
                { step: '2', title: 'Site Assessment', desc: 'We\'ll schedule a professional site visit to confirm measurements and finalize the design.', icon: <MapPin size={18} className="text-amber-500" /> },
                { step: '3', title: 'Installation', desc: 'Our certified team will install your system with minimal disruption to your daily routine.', icon: <Zap size={18} className="text-emerald-500" /> },
              ].map(item => (
                <div key={item.step} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-black text-sm flex-shrink-0">
                    {item.step}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {item.icon}
                      <h4 className="font-bold text-slate-900 text-sm">{item.title}</h4>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Footer — white-label branding ── */}
          <div className="p-8 md:p-10 text-white" style={{ background: `linear-gradient(135deg, ${branding.brandPrimaryColor}22, #0f172a)`, backgroundColor: '#0f172a' }}>
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-3">
                {branding.companyLogoUrl ? (
                  <img src={branding.companyLogoUrl} alt={branding.companyName} className="h-10 max-w-[160px] object-contain brightness-0 invert" />
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: branding.brandPrimaryColor }}>
                      <Sun size={24} className="text-slate-900" />
                    </div>
                    <div>
                      <div className="font-black text-lg">{branding.companyName}</div>
                      <div className="text-sm" style={{ color: branding.brandPrimaryColor }}>Professional Solar Solutions</div>
                    </div>
                  </>
                )}
              </div>
              <div className="text-center md:text-right">
                <p className="text-slate-300 text-sm font-medium">This proposal is valid until</p>
                <p className="font-bold" style={{ color: branding.brandPrimaryColor }}>{new Date(proposal.validUntil).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-slate-700 text-center space-y-2">
              {branding.proposalFooterText && (
                <p className="text-slate-300 text-sm font-medium">{branding.proposalFooterText}</p>
              )}
              {branding.companyAddress && (
                <p className="text-slate-500 text-xs">{branding.companyAddress}</p>
              )}
              <p className="text-slate-500 text-xs">Production estimates based on NREL PVWatts data and Google Solar API analysis. Actual results may vary based on weather, shading, and system performance. Federal tax credit eligibility subject to individual tax situation.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



export default function ProposalsPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="spinner w-8 h-8" /></div>}>
        <ProposalContent />
      </Suspense>
    </AppShell>
  );
}