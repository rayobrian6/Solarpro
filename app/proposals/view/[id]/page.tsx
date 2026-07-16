'use client';
import React, { useEffect, useState, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { Proposal } from '@/types';
import {
  Sun, Zap, DollarSign, Leaf, TrendingUp, Shield,
  Star, Phone, Mail, MapPin, Calendar, Award,
  ChevronRight, BarChart2, Home, Sprout, Fence,
  Percent, Tag, Download, Printer, CheckCircle,
  XCircle, Clock, AlertTriangle, ExternalLink, Info,
  Link2, Copy, PartyPopper, Sparkles, PenLine,
  Wind, TreePine, Car, Users,
} from 'lucide-react';
import SignatureModal from '@/components/SignatureModal';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine
} from 'recharts';
import { resolveEquipment, getSystemTypeLabel, getSystemDescription } from '@/lib/systemEquipmentResolver';
import { calculateIncentives } from '@/lib/incentives/stateIncentives';
import { buildArraysFromLayout, buildSystemConfig, getArrayProposalText } from '@/lib/multiArrayEngine';
import { resolveProposalSystemType, getPanelTypeCounts } from '@/lib/proposalSystemType';
import { UtilityRateGraph } from '@/components/proposal/UtilityRateGraph';
import { CashFlowStoryCard } from '@/components/proposal/CashFlowStoryCard';
import {
  buildUtilityProfile,
  validateProposalTruth,
  validatePanelIntegrity,
  getFailsafeMessage,
  calculateRemainingUtility,
} from '@/lib/proposalTruthEngine';
import {
  getInterconnectionProfile,
  getStateIcaFallback,
} from '@/lib/utilityInterconnection';
import { buildCanonicalProposal } from '@/lib/proposal/buildCanonicalProposal';
import { resolveActualAnnualBill, resolveMonthlyUsageHistory } from '@/lib/proposal/resolveActualBill';
import { deriveEcosystemSummary } from '@/lib/proposal/deriveEcosystemSummary';
import {
  GLOBAL_INCENTIVES_CONFIG,
  getIncentivesComplianceMessage,
  getIncentivesNotIncludedNotice,
  getIncentivesDebugLabel,
  isSection48eEnabled,
  getSection48eRate,
  getSection48eSafeHarborDeadline,
} from '@/lib/incentivesConfig';
import { useToast } from "@/components/ui/Toast";

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Section 12: validateProposalTruth imported from lib/proposalTruthEngine.ts
// (replaces local validateProposalFinancials — 6-assertion engine, dev-mode strict)

// ── Inner component (uses useSearchParams) ─────────────────────────────────
function ProposalViewInner() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const [pricingCfg, setPricingCfg] = useState<any>(null);
  const [accepted, setAccepted] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showSignModal, setShowSignModal] = useState(false);
  const [signerName, setSignerName] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/proposals/${id}?track=1`)
      .then(r => r.json())
      .then(d => {
        if (!d.success || !d.data) {
          setError('Proposal not found.');
          setLoading(false);
          return;
        }
        const raw = d.data;
        if (raw.share_token && token && raw.share_token !== token) {
          setError('This proposal link is invalid or has expired.');
          setLoading(false);
          return;
        }
        if (raw.share_expires_at && new Date(raw.share_expires_at) < new Date()) {
          setError('This proposal link has expired. Please contact your solar installer for a new link.');
          setLoading(false);
          return;
        }
        const dataJson = typeof raw.data_json === 'string' ? JSON.parse(raw.data_json) : (raw.data_json || {});
        const proposal: Proposal = {
          id: raw.id,
          projectId: raw.project_id,
          title: raw.title || raw.name || 'Solar Proposal',
          status: raw.status || 'sent',
          createdAt: raw.created_at,
          updatedAt: raw.updated_at,
          project: dataJson.project || null,
          ...dataJson,
          // v48.3: DB utility rate from server-side lookup (top-level on raw, not in dataJson)
          dbUtilityRate: (raw.dbUtilityRate as number | null | undefined) ?? null,
        };
        console.log('[ProposalView] Loaded proposal data:', {
          proposalId: raw.id,
          hasProjectSnapshot: !!dataJson.project,
          hasPricingSnapshot: !!dataJson.pricingSnapshot,
          snapshotAt: dataJson.snapshotAt || 'none (pre-v47.222 proposal)',
          hasLayout: !!dataJson.project?.layout,
          hasProduction: !!dataJson.project?.production,
          panelCount: dataJson.project?.layout?.totalPanels ?? 0,
          systemSizeKw: dataJson.project?.layout?.systemSizeKw ?? 0,
        });
        setProposal(proposal);

        if (dataJson.pricingSnapshot) {
          setPricingCfg(dataJson.pricingSnapshot);
          console.log('[ProposalView] Using frozen pricingSnapshot (immutable proposal).');
        }

        if (token) {
          fetch(`/api/proposals/${id}?token=${encodeURIComponent(token)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'viewed' }),
          }).catch(() => {});
        }

        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load proposal. Please try again.');
        setLoading(false);
      });

    fetch(`/api/settings/branding?proposalId=${id}`)
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

    fetch('/api/pricing')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setPricingCfg((current: unknown) => current ?? d.data);
        }
      })
      .catch(() => {});
  }, [id, token]);

  const handleAccept = async () => {
    if (!proposal) return;
    // Open the signature modal — actual acceptance happens after signing
    setShowSignModal(true);
  };

  const handleSignatureSuccess = (name: string) => {
    setShowSignModal(false);
    setSignerName(name);
    setAccepted(true);
  };

  const handleDownloadPdf = async () => {
    if (!proposal || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      // Use client-side html2canvas + jsPDF path — works on Vercel (no wkhtmltopdf needed).
      // generateProposalPDF reads #proposal-document from the live DOM, so the fully-rendered
      // view page gives much better fidelity than a headless server render.
      const { generateProposalPDF } = await import('@/lib/proposalPDF');
      await generateProposalPDF(proposal);
    } catch {
      toast.error('PDF generation failed. Please try again.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleCopyLink = () => {
    const url = window.location.href;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    } else {
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Loading your proposal...</p>
        </div>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <XCircle size={28} className="text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Proposal Unavailable</h1>
          <p className="text-slate-400 text-sm">{error || 'This proposal could not be found.'}</p>
          <p className="text-slate-500 text-xs mt-4">Please contact your solar installer for a new link.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <PublicProposalView
        proposal={proposal}
        branding={branding}
        pricingCfg={pricingCfg}
        accepted={accepted}
        accepting={accepting}
        signerName={signerName}
        onAccept={handleAccept}
        downloadingPdf={downloadingPdf}
        onDownloadPdf={handleDownloadPdf}
        copiedLink={copiedLink}
        onCopyLink={handleCopyLink}
      />
      {showSignModal ? (
        <SignatureModal
          proposalId={proposal.id}
          proposalTitle={proposal.title || 'Solar Proposal'}
          token={token}
          primaryColor={branding.brandPrimaryColor}
          onSuccess={handleSignatureSuccess}
          onClose={() => setShowSignModal(false)}
        />
      ) : null}
    </>
  );
}

// ── Public Proposal View ───────────────────────────────────────────────────
function PublicProposalView({
  proposal, branding, pricingCfg, accepted, accepting, signerName, onAccept,
  downloadingPdf, onDownloadPdf, copiedLink, onCopyLink
}: {
  proposal: Proposal;
  branding: any;
  pricingCfg: any;
  accepted: boolean;
  accepting: boolean;
  signerName?: string | null;
  onAccept: () => void;
  downloadingPdf?: boolean;
  onDownloadPdf?: () => void;
  copiedLink?: boolean;
  onCopyLink?: () => void;
}) {
  const proj = proposal.project;
  const client = proj?.client;
  const production = proj?.production;
  const cost = proj?.costEstimate as any;
  const layout = proj?.layout;

  const [purchaseMode, setPurchaseMode] = React.useState<'finance' | 'cash'>('finance');
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // ── System type resolution (v47.220) ─────────────────────────────────────
  const systemType: string = resolveProposalSystemType({
    panels:           layout?.panels,
    layoutSystemType: layout?.systemType,
    projSystemType:   proj?.systemType,
    projectName:      proj?.name,
  });
  if (typeof window !== 'undefined') {
    const _panelCounts = getPanelTypeCounts(layout?.panels || []);
    console.log('[PROPOSAL VIEW systemType v47.220]', {
      projectName:   proj?.name,
      panelCounts:   _panelCounts,
      typedPanels:   (layout?.panels || []).filter((p: import('@/types').PlacedPanel) => p.placementType || p.systemType).length,
      totalPanels:   (layout?.panels || []).length,
      layoutSysType: layout?.systemType,
      projSysType:   proj?.systemType,
      resolved:      systemType,
    });
  }
  const systemTypeLabel = getSystemTypeLabel(systemType);
  const systemDescription = getSystemDescription(systemType);
  const systemTypeIcon = { roof: <Home size={16} />, ground: <Sprout size={16} />, fence: <Fence size={16} />, carport: <Sun size={16} /> }[systemType] ?? <Home size={16} />;
  const isFenceSystem = systemType === 'fence';

  // ── v47.238: Canonical Proposal Pipeline ──────────────────────────────────
  // ALL financial calculations live in buildCanonicalProposal().
  // This component is a pure render layer — zero inline math below this point.
  const selectedPanel = (proj as any)?.selectedPanel;
  const layoutSystemSizeKw = (layout?.systemSizeKw && layout.systemSizeKw > 0)
    ? layout.systemSizeKw
    : ((proj as any)?.systemSizeKw ?? 0);
  const totalPanels = (layout?.totalPanels && layout.totalPanels > 0)
    ? layout.totalPanels
    : layoutSystemSizeKw > 0 ? Math.ceil(layoutSystemSizeKw / 0.44) : 0;
  // v48.10: extract stateCode from address as last resort (e.g. "Pocahontas, IL 62275")
  // v48.36: also check proposal-level stateCode (snapshot stored at creation time)
  const extractStateFromAddress = (addr?: string): string => {
    if (!addr) return '';
    const m = addr.match(/\b([A-Z]{2})\s+\d{5}/i) || addr.match(/,\s*([A-Z]{2})\s*$/i);
    return m ? m[1].toUpperCase() : '';
  };
  const projectStateCode = (
    proposal?.stateCode ||
    (proj as any)?.stateCode ||
    client?.state ||
    extractStateFromAddress((proj as any)?.address || client?.address || '') ||
    ''
  ).toUpperCase().trim().slice(0, 2);
  const isCommercial = pricingCfg?.isCommercial ?? false;

  // v1.shade: Compute system-level shade derate from per-panel annualShadeFactor values.
  // Stored in layout.panels[].annualShadeFactor by the shade analysis engine.
  // TSRF = 1 - shadeDeratePct/100. The kWh impact was already applied by PVWatts effectiveLosses.
  const panelsShadeDerateComputedPct = (() => {
    const panels = layout?.panels ?? [];
    const shadedPanels = panels.filter(
      (p: any) => typeof p.annualShadeFactor === 'number' &&
                  p.annualShadeFactor >= 0 &&
                  p.annualShadeFactor <= 1
    );
    if (shadedPanels.length === 0) return undefined;
    const avgFactor = shadedPanels.reduce(
      (sum: number, p: any) => sum + (p.annualShadeFactor as number), 0
    ) / shadedPanels.length;
    const derate = (1 - avgFactor) * 100;
    return derate > 0.01 ? Math.round(derate * 10) / 10 : undefined;
  })();

  const cp = buildCanonicalProposal({
    // Panel
    panelSpec: selectedPanel ? {
      manufacturer: selectedPanel.manufacturer || '',
      model:        selectedPanel.model || selectedPanel.name || '',
      wattage:      selectedPanel.wattage ?? 0,
      efficiency:   selectedPanel.efficiency ?? undefined,
      width:        selectedPanel.width ?? undefined,
      height:       selectedPanel.height ?? undefined,
    } : null,
    panelCount:          totalPanels,
    layoutSystemSizeKw,

    // Production
    annualProductionKwh:   production?.annualProductionKwh ?? 0,
    monthlyProductionKwh:  production?.monthlyProductionKwh ?? [],

    // Utility
    utilityName:         (proj as any)?.utilityName || '',
    stateCode:           projectStateCode,
    clientState:         client?.state || '',
    address:             (proj as any)?.address || client?.address || '',  // v48.17: for ZIP lookup
    zip:                 (proj as any)?.zip || '',
    // v48.14: parsedBillRate intentionally undefined — OCR-extracted rates (_utilityRatePerKwh,
    // electricityRate) are supply-only and exclude delivery/capacity charges. Passing them as
    // Tier 1 overrides EIA-verified profile rates (~$0.155 Ameren/SWEC) with a supply-only
    // rate (~$0.107), producing a wrong Year 18 payback. Profile rate always wins for named utilities.
    parsedBillRate:      undefined,
    utilityRateOverride: (proj as any)?.utilityRatePerKwh,
    clientUtilityRate:   client?.utilityRate,
    dbUtilityRate:       proposal.dbUtilityRate ?? undefined,
    annualUsageKwh:      client?.annualKwh ?? 0,
    actualAnnualBill:    resolveActualAnnualBill(client),  // real bill (same source as Bill tab)
    monthlyUsageHistoryKwh: resolveMonthlyUsageHistory(client), // real seasonal shape for the bill chart

    // Pricing
    systemType,
    storedCashPrice:         (proj?.costEstimate as any)?.cashPrice ?? (proj?.costEstimate as any)?.grossCost ?? 0,
    roofPricePerWatt:        pricingCfg?.roofPricePerWatt    ?? pricingCfg?.pricePerWatt,
    groundPricePerWatt:      pricingCfg?.groundPricePerWatt  ?? pricingCfg?.pricePerWatt,
    fencePricePerWatt:       pricingCfg?.fencePricePerWatt   ?? pricingCfg?.pricePerWatt,
    carportPricePerWatt:     pricingCfg?.carportPricePerWatt ?? pricingCfg?.pricePerWatt,
    defaultPricePerWatt:     pricingCfg?.pricePerWatt,

    // Financing
    loanApr:       pricingCfg?.loanApr,
    loanTermYears: pricingCfg?.loanTermYears,
    purchaseMode,

    // Policy
    isCommercial,

    // Shade analysis (v1.shade)
    panelsShadeDerateComputedPct,
  });

  // TEMP DIAGNOSTIC: surface exactly what bill value the proposal resolves, so a
  // $82-vs-$138 mismatch can be traced to the real field without guessing.
  if (typeof window !== 'undefined') {
    console.log('[PROPOSAL BILL DEBUG]', {
      resolvedActualAnnualBill: resolveActualAnnualBill(client),
      client_annualBill:        (client as any)?.annualBill,
      client_avgMonthlyBill:    (client as any)?.averageMonthlyBill,
      client_hasBillData:       !!(client as any)?.billData,
      client_billDataKeys:      (client as any)?.billData ? Object.keys((client as any).billData) : null,
      cp_currentMonthlyBill:    cp.financial.currentMonthlyBill,
    });
  }

  // ── ICA / PTO Profile Lookup (Tier 1 → Tier 2 → null) ────────────────────
  // Derive real utility_id from buildUtilityProfile (same inputs as canonical pipeline).
  // This gives us the authoritative `utility_id` (e.g. 'pge_ca', 'fpl_fl') used by
  // getInterconnectionProfile(), rather than the naive lowercased-name slug.
  const icaBuiltProfile = buildUtilityProfile({
    utilityName:              (proj as any)?.utilityName || '',
    stateCode:                projectStateCode,
    address:                  (proj as any)?.address || client?.address || '',
    zip:                      (proj as any)?.zip || '',
    clientUtilityRateFallback: client?.utilityRate,
    client:                   { state: client?.state },
  });
  const icaUtilityId = icaBuiltProfile.profile.utility_id;
  // Tier 1: exact utility profile (full steps, timeline, portal URL)
  const icaTier1Profile = getInterconnectionProfile(icaUtilityId);
  // Tier 2: state-level fallback (generic steps for co-ops/munis/unmatched utilities)
  const icaTier2Fallback = !icaTier1Profile && projectStateCode
    ? getStateIcaFallback(projectStateCode)
    : null;
  // The active ICA data source — Tier 1 takes priority
  const icaSteps: string[] = icaTier1Profile
    ? icaTier1Profile.pto_steps           // PTO steps are the homeowner-facing checklist
    : (icaTier2Fallback?.generic_steps ?? []);
  const icaTimeline = icaTier1Profile
    ? `${icaTier1Profile.ica_approval_days_min}–${icaTier1Profile.ica_approval_days_max} business days`
    : icaTier2Fallback
      ? `${icaTier2Fallback.typical_ica_days_min}–${icaTier2Fallback.typical_ica_days_max} business days`
      : null;
  const ptoTimeline = icaTier1Profile
    ? `${icaTier1Profile.pto_days_min}–${icaTier1Profile.pto_days_max} business days`
    : icaTier2Fallback
      ? `${icaTier2Fallback.typical_pto_days_min}–${icaTier2Fallback.typical_pto_days_max} business days`
      : null;
  const icaPortalUrl = icaTier1Profile?.application_url ?? null;
  const icaRulesUrl  = icaTier2Fallback?.rules_url ?? null;
  const icaTierLabel = icaTier1Profile
    ? icaTier1Profile.utility_name
    : icaTier2Fallback
      ? `${icaTier2Fallback.state_name} (${icaTier2Fallback.regulatory_body})`
      : null;

  // ── End ICA Lookup ────────────────────────────────────────────────────────

  // ── Destructure canonical values — UI reads ONLY from these ───────────────
  // Panel
  const systemSizeKw               = cp.panel.systemSizeKw;
  const systemSizeW                = systemSizeKw * 1000;
  const resolvedPanelWattage       = cp.panel.wattage;
  const panelIntegrity             = validatePanelIntegrity({
    panelSpec:    selectedPanel ? {
      manufacturer: selectedPanel.manufacturer || '',
      model:        selectedPanel.model || selectedPanel.name || '',
      wattage:      selectedPanel.wattage ?? 0,
      efficiency:   selectedPanel.efficiency ?? undefined,
    } : null,
    panelCount:   totalPanels,
    systemSizeKw: layoutSystemSizeKw,
  });

  // Financial
  const effectiveFinal             = cp.financial.systemCost;
  const utilityRate                = cp.utility.rate;
  const annualEnergyValue          = cp.financial.annualEnergyValue;
  // v47.254: payoffYear from _meta (iterative, escalation+degradation-aware) — replaces static paybackYears
  const payoffYear                 = cp._meta.payoffYear;
  const financeMonthlyPayment      = cp.financial.solarPaymentMonthly;
  const financeTermYears           = cp.financial.financeTermYears;
  const financeTermMonths          = cp.financial.financeTermMonths;
  const solar_payment_monthly      = cp.financial.solarPaymentMonthly;
  const remaining_utility_monthly  = cp.financial.utilityBillMonthly;
  const total_energy_cost_monthly  = cp.financial.totalMonthlyCost;
  const avgMonthlyBillBefore       = cp.financial.currentMonthlyBill;
  const ownership_delta_monthly    = cp.financial.ownershipDeltaMonthly;

  // Usage & production
  const annualUsage                = cp.utility.annualUsageKwh;
  const annualProduction           = cp.production.annualKwh;
  const energyOffset               = cp.offset.percentage;

  // 25yr truth — canonical savings definition
  const utility_cost_25yr            = cp.truth25yr.utilityCostWithoutSolar;
  const solar_cost_total             = cp.truth25yr.solarCostTotal;
  const remaining_utility_cost_total = cp.truth25yr.remainingUtilityCost;
  const estimated_energy_value_25yr  = cp.truth25yr.estimatedEnergyValue;
  // Canonical netDifference (SREC-inclusive), NOT the legacy netFinancialDifference:
  // the two disagreed by ~$10.5k and the proposal showed "+$130,198 total est.
  // savings" and "+$140,731 25-Yr Advantage" for the same concept on facing pages.
  const net_financial_difference_25yr = cp.truth25yr.netDifference;
  // CANONICAL SAVINGS — the only savings number:
  const netDifference_25yr           = cp.truth25yr.netDifference;

  // Energy value breakdown — v47.254: from canonical financial (yearlyFlow[0] identity map)
  const energyValueBreakdown       = cp.financial.energyValueBreakdown;

  // v47.255: with-vs-without comparison chart data — READ ONLY from yearlyFlow
  // cumulative_without_solar / cumulative_with_solar are pre-computed by calculate25yrProjection
  const comparisonChartData = cp.truth25yr.yearlyFlow.map(yr => ({
    year:           yr.year,
    withoutSolar:   yr.cumulative_without_solar,
    withSolar:      yr.cumulative_with_solar,
  }));

  // Financial narrative — v47.254: from _meta (financialNarrativeEngine output)
  const narrative                  = cp._meta.narrative;

  // Charts
  const projectionData             = cp.truth25yr.projectionChart;
  const monthlyBillData            = cp.truth25yr.monthlyBillChart;
  // Psychological framing for the before/after bar chart: surface the average
  // utility bill collapsing toward $0 as bold numbers, so the win still lands
  // even when a ~100%-offset system makes the green "after" bars zero-height.
  const avgMonthlyBefore           = monthlyBillData.length
    ? Math.round(monthlyBillData.reduce((s, m) => s + (m.before || 0), 0) / monthlyBillData.length)
    : 0;
  const avgMonthlyAfter            = monthlyBillData.length
    ? Math.round(monthlyBillData.reduce((s, m) => s + (m.after || 0), 0) / monthlyBillData.length)
    : 0;

  // Policy / utility
  const failsafeMessage            = cp.policy.failsafeMessage;
  // utilityProfile compatibility shim — maps to cp.policy for render sections
  const utilityProfile = {
    policy_message:       cp.policy.policyMessage,
    net_metering_summary: cp.policy.netMeteringSummary,
    srec_summary:         cp.policy.srecSummary,
    system_design_guidance: cp.utility.netMeteringType !== 'retail_1to1'
      ? 'Design system to maximize self-consumption. Export credits below retail rate.'
      : 'System designed for full retail net metering credit on all exported energy.',
    is_specific_match:    cp.policy.isSpecificUtilityMatch,
    profile: {
      net_metering_type: cp.utility.netMeteringType,
      srec_available:    cp.policy.srecAvailable,
      utility_id:        cp.utility.provider.toLowerCase().replace(/\s+/g, '_'),
      state:             cp.utility.provider,
    },
  };
  // Display constants (used in assumptions notes only)
  const utilityInflation = cp.utility.escalationRate;
  const panelDegradation = 0.005;

  // Incentives (state incentives computed here — non-financial-math, display only)
  const annualKwhForIncentives = annualProduction > 0
    ? annualProduction
    : systemSizeKw > 0 ? Math.round(systemSizeKw * 1250) : 0;
  const incentiveCalc = projectStateCode && (systemSizeKw > 0 || annualKwhForIncentives > 0)
    ? calculateIncentives(projectStateCode, effectiveFinal, systemSizeKw, annualKwhForIncentives, !isCommercial, systemType)
    : null;
  // Cash incentives — reduce net system cost (tax credits, rebates)
  const CASH_INCENTIVE_TYPES = ['state_tax_credit', 'state_rebate', 'utility_rebate', 'performance_payment'];
  // Non-cash benefits — shown as "additional benefits" (property/sales tax, SRECs)
  const NON_CASH_BENEFIT_TYPES = ['property_tax_exemption', 'sales_tax_exemption', 'srec', 'trec', 'net_metering'];
  const stateIncentives = incentiveCalc ? {
    stateIncentives: incentiveCalc.state
      .filter((s: any) => CASH_INCENTIVE_TYPES.includes(s.type))
      .map((s: any) => ({ ...s, name: s.incentiveName, isCash: true })),
    nonCashBenefits: incentiveCalc.state
      .filter((s: any) => NON_CASH_BENEFIT_TYPES.includes(s.type))
      .map((s: any) => ({ ...s, name: s.incentiveName, isCash: false })),
    cashTotal: incentiveCalc.cashTotal,
    netSystemCost: incentiveCalc.netSystemCost,
    nonCashStateTotal: incentiveCalc.nonCashStateTotal,
  } : null;

  // ── Canonical validation (dev assertion lock) ─────────────────────────────
  React.useEffect(() => {
    if (!mounted) return;
    if (cp._meta.hasWarnings) {
      console.warn('[CanonicalPipeline][v47.238] Pipeline warnings:', cp._meta.warnings);
    } else {
      console.log('[CanonicalPipeline][v47.238] All assertions passed. netDifference_25yr:', netDifference_25yr);
    }
    // v47.253: pass export/NEM/flow params for A9, A10, A11, A12 assertions
    const yearlyFlowForValidation = cp.truth25yr.yearlyFlow ?? [];
    const year1ExportKwh   = yearlyFlowForValidation.length > 0 ? yearlyFlowForValidation[0].exported_kwh : undefined;
    const result = validateProposalTruth({
      effectiveFinal,
      annualEnergyValue,
      paybackYears: payoffYear ?? 0,  // v47.254: pass payoffYear as paybackYears for assertion compat
      estimatedEnergyValue25yr: estimated_energy_value_25yr,
      annualProductionKwh:      annualProduction,
      utilityRate,
      energyOffset,
      annualUsageKwh:           annualUsage,
      financeMonthlyPayment,
      remainingUtilityMonthly:  remaining_utility_monthly,
      totalEnergyCostMonthly:   total_energy_cost_monthly,
      panelIntegrity,
      // v47.253: utility-driven assertion params
      exportRate:       cp.utility.exportRate,
      netMeteringType:  cp.utility.netMeteringType,
      yearlyFlow:       yearlyFlowForValidation,
      exportKwh:        year1ExportKwh,
      productionKwh:    annualProduction,
      escalationSource: cp.utility.escalationRateSource,
      escalationConfidence: cp.utility.confidence,
    });
    if (!result.passed) {
      console.warn('[ProposalTruthEngine][v47.238] Validation issues:', result.failures);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const equipment = resolveEquipment(systemType);

  const clientLat = (client as any)?.lat ?? 33.4484;
  const clientLng = (client as any)?.lng ?? -112.074;
  const derivedArrays = layout ? buildArraysFromLayout(layout as any, clientLat, clientLng) : [];
  const systemConfig = buildSystemConfig(derivedArrays);
  const isHybridSystem = systemConfig.isHybrid;
  const multiArraySystemLabel = isHybridSystem ? 'Hybrid System' : systemTypeLabel;

  const tooltipStyle = { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' };
  const primaryColor = branding.brandPrimaryColor || '#f59e0b';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* ── Public Header Bar ── */}
      <header className="bg-slate-900 border-b border-slate-700/50 sticky top-0 z-20 no-print">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {branding.companyLogoUrl ? (
              <img src={branding.companyLogoUrl} alt={branding.companyName} className="h-8 object-contain" />
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${primaryColor}20` }}>
                  <Sun size={16} style={{ color: primaryColor }} />
                </div>
                <span className="font-bold text-white text-sm">{branding.companyName}</span>
              </div>
            )}
            <div className="w-px h-5 bg-slate-700 hidden sm:block" />
            <span className="text-slate-400 text-sm hidden sm:block truncate max-w-xs">{proposal.title}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Share / copy link */}
            <button
              onClick={onCopyLink}
              title="Copy proposal link"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 text-xs transition-colors"
            >
              {copiedLink ? <CheckCircle size={12} className="text-emerald-400" /> : <Link2 size={12} />}
              <span className="hidden sm:inline">{copiedLink ? 'Copied!' : 'Share'}</span>
            </button>
            {/* Download PDF */}
            <button
              onClick={onDownloadPdf}
              disabled={downloadingPdf}
              title="Download PDF"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloadingPdf ? (
                <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Download size={12} />
              )}
              <span className="hidden sm:inline">{downloadingPdf ? 'Generating…' : 'PDF'}</span>
            </button>
            {/* Print */}
            <button
              onClick={() => window.print()}
              title="Print"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 text-xs transition-colors hidden sm:flex"
            >
              <Printer size={12} /> Print
            </button>
            {!accepted ? (
              <button
                onClick={onAccept}
                disabled={accepting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-slate-900 font-semibold text-xs transition-all hover:opacity-90 active:scale-95"
                style={{ background: primaryColor }}
              >
                {accepting ? (
                  <span className="w-3 h-3 border border-slate-900 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <PenLine size={13} />
                )}
                Sign &amp; Accept
              </button>
            ) : null}
            {accepted ? (
              <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
                <CheckCircle size={13} /> Signed!
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* ── Accepted Banner ── */}
      {accepted ? (
        <div className="no-print" style={{ background: 'linear-gradient(90deg, #064e3b 0%, #065f46 50%, #064e3b 100%)', borderBottom: '1px solid rgba(16,185,129,0.3)' }}>
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
            {/* Animated pulse ring */}
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <PartyPopper size={20} className="text-emerald-300" />
              </div>
              <div className="absolute inset-0 rounded-full border border-emerald-400/40 animate-ping" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-emerald-200 font-black text-sm tracking-wide">✨ Proposal Signed &amp; Accepted!</p>
              <p className="text-emerald-400/80 text-xs mt-0.5">
                {signerName ? `Signed by ${signerName}. ` : ''}Your installer has been notified and will be in touch within 24 hours to schedule next steps.
              </p>
            </div>
            <Sparkles size={18} className="text-emerald-400/50 flex-shrink-0 hidden sm:block" />
          </div>
        </div>
      ) : null}

      {/* ── Main Content ── */}
      <div id="proposal-document" className="max-w-5xl mx-auto px-4 py-4 space-y-4 print-content">

        {/* Hero Section */}
        <div className="proposal-sec rounded-2xl border border-slate-700/50 overflow-hidden" data-block-id="hero" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}>
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-900" style={{ background: primaryColor }}>
                    {systemTypeIcon}
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full border" style={{ color: primaryColor, borderColor: `${primaryColor}40`, background: `${primaryColor}15` }}>
                    {multiArraySystemLabel}
                  </span>
                </div>
                <h1 className="text-2xl font-black text-white mb-1">{proposal.title}</h1>
                {client ? (
                  <p className="text-slate-400 text-sm">
                    Prepared for <span className="text-white font-medium">{client.name}</span>
                    {client.address ? <span> &middot; {client.address}, {client.city}, {client.state}</span> : null}
                  </p>
                ) : null}
                <p className="text-slate-500 text-xs mt-1 flex items-center gap-1">
                  <Calendar size={11} />
                  {new Date(proposal.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              {systemSizeKw > 0 ? (
                <div className="text-right flex-shrink-0">
                  <div className="text-5xl font-black leading-none" style={{ color: primaryColor }}>{systemSizeKw.toFixed(1)}</div>
                  <div className="text-slate-300 text-sm font-bold tracking-wide mt-1">kW System</div>
                  {totalPanels > 0 ? <div className="text-slate-500 text-xs mt-1">{totalPanels} panels</div> : null}
                </div>
              ) : null}
            </div>

            {/* Section 3: Key metrics strip — accurate labels, no absolute "savings" language */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
              {[
                { label: 'Annual Production', value: annualProduction > 0 ? `${annualProduction.toLocaleString()} kWh` : '\u2014', icon: <Zap size={15} />, color: 'text-amber-400' },
                {
                  // Section 3: offset label is factual percentage, not absolute claim
                  label: 'Energy Offset',
                  value: energyOffset > 0 ? `~${energyOffset}%` : '\u2014',
                  icon: <Percent size={15} />,
                  color: 'text-emerald-400',
                },
                {
                  // v47.254: breakdown-aware label — shows total from canonical breakdown
                  label: 'Yr 1 Energy Value',
                  value: energyValueBreakdown.total > 0 ? `$${energyValueBreakdown.total.toLocaleString()}` : '\u2014',
                  icon: <DollarSign size={15} />,
                  color: 'text-green-400',
                },
                { label: 'System Payoff', value: payoffYear ? `Year ${payoffYear}` : '\u2014', icon: <TrendingUp size={15} />, color: 'text-blue-400' },
              ].map(m => (
                <div key={m.label} className="bg-slate-800/60 rounded-lg p-2 border border-slate-700/30">
                  <div className={`flex items-center gap-1 ${m.color}`}>{m.icon}<span className="text-xs text-slate-400">{m.label}</span></div>
                  <div className="text-lg font-black text-white">{m.value}</div>
                </div>
              ))}
            </div>

            {/* v47.217: System description — compressed for power page */}
            {systemDescription ? (
              <div className="mt-2 px-3 py-2 rounded-lg border border-slate-700/40 bg-slate-800/30">
                <p className="text-slate-500 text-xs leading-snug">
                  <span className="font-semibold text-slate-400">System: </span>
                  {systemDescription}
                </p>
              </div>
            ) : null}

            {/* ── Satellite property image ── */}
            {(() => {
              const hasCoords = clientLat && clientLng &&
                !(clientLat === 33.4484 && clientLng === -112.074);
              if (!hasCoords) return null;
              const GKEY = 'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';
              const satUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${clientLat},${clientLng}&zoom=19&size=800x320&maptype=satellite&key=${GKEY}`;
              return (
                <div className="mt-3 rounded-xl overflow-hidden border border-slate-700/40 relative" style={{ height: 160 }}>
                  <img
                    src={satUrl}
                    alt="Satellite view of your property"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/70 to-transparent pointer-events-none" />
                  <div className="absolute bottom-2 left-3 text-white text-xs font-semibold flex items-center gap-1">
                    <MapPin size={11} style={{ color: primaryColor }} />
                    Your Property — system designed for this site
                  </div>
                </div>
              );
            })()}

            {/* Section 7: Fence system production disclaimer */}
            {isFenceSystem ? (
              <div className="mt-2 p-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-amber-300/80 text-xs leading-relaxed">
                    <span className="font-semibold text-amber-300">Fence System Note: </span>
                    Production estimates for solar fence systems are approximations. Vertical bifacial panels
                    receive lower solar irradiance than tilted roof or ground-mount installations and are more
                    sensitive to shading, site orientation, and seasonal variation. Actual annual production
                    may differ materially from estimates shown. Consult your installer for a site-specific
                    energy analysis.
                  </p>
                </div>
              </div>
            ) : null}

            {/* ═══ v47.333: POWER PAGE — Inline Financial Framing ═══ */}
            {effectiveFinal > 0 ? (
              <div className="mt-3 space-y-2">
                {/* Utility Cost Reality — 2-column layout */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg p-3 border border-red-500/20 bg-red-500/5">
                    <div className="text-xs text-slate-400 mb-0.5">25-Yr Utility Cost (No Solar)</div>
                    <div className="text-xl font-black text-red-400">
                      {utility_cost_25yr > 0 ? `$${utility_cost_25yr.toLocaleString()}` : '\u2014'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">Projected at {(utilityInflation * 100).toFixed(0)}%/yr increases</div>
                  </div>
                  <div className="rounded-lg p-3 border border-emerald-500/20 bg-emerald-500/5">
                    <div className="text-xs text-slate-400 mb-0.5">Your Solar Investment</div>
                    <div className="text-xl font-black text-emerald-400">
                      ${effectiveFinal.toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {/* This value is the SYSTEM PRICE (cash basis) — calling it the
                          "25-yr loan" implied it was the financed total ($137k, not $59k). */}
                      {purchaseMode === 'finance' ? `System price, financed over ${financeTermYears} yrs` : 'One-time cost'} — you own the energy
                    </div>
                  </div>
                </div>

                {/* Payment Shift — compact single row */}
                {purchaseMode === 'finance' && solar_payment_monthly > 0 && avgMonthlyBillBefore > 0 ? (
                  <div className="rounded-lg p-3 border border-slate-600/30 bg-slate-800/40">
                    <div className="text-xs font-semibold text-slate-300 mb-2">What Changes Today</div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-center flex-1">
                        <div className="text-xs text-slate-500">Current Bill</div>
                        <div className="text-lg font-black text-white">${avgMonthlyBillBefore}/mo</div>
                      </div>
                      <div className="text-slate-500 text-sm">→</div>
                      <div className="text-center flex-1">
                        <div className="text-xs text-slate-500">Solar + Utility</div>
                        <div className="text-lg font-black text-white">${total_energy_cost_monthly}/mo</div>
                      </div>
                      <div className="text-slate-500 text-sm">→</div>
                      <div className="text-center flex-1 rounded-lg py-1 px-2" style={{ background: `${primaryColor}15` }}>
                        <div className="text-xs text-slate-400">
                          {ownership_delta_monthly <= 0 ? 'Monthly Savings' : 'Monthly Difference'}
                        </div>
                        <div className="text-lg font-black" style={{ color: ownership_delta_monthly <= 0 ? '#22c55e' : primaryColor }}>
                          {ownership_delta_monthly <= 0 ? '-' : '+'}${Math.abs(ownership_delta_monthly)}/mo
                        </div>
                      </div>
                    </div>
                    {ownership_delta_monthly > 0 ? (
                      <p className="text-xs text-slate-500 mt-1.5 text-center">
                        Your solar payment is fixed at ${solar_payment_monthly}/mo. As utility rates rise at {(cp.utility.escalationRate * 100).toFixed(0)}%/yr, this gap closes and reverses.
                      </p>
                    ) : null}
                    {ownership_delta_monthly <= 0 ? (
                      <p className="text-xs text-emerald-400/70 mt-1.5 text-center">
                        Immediate monthly savings of ${Math.abs(ownership_delta_monthly)}/mo — and it grows as utility rates increase.
                      </p>
                    ) : null}
                    {/* SREC cash context — the bill comparison above is bills-only; the REC
                        contract is real income paid as checks (50% upfront + 6 yrs), and
                        omitting it made "+$X/mo" contradict the SREC-driven payoff year. */}
                    {(cp.truth25yr.srec_income_25yr ?? 0) > 0 && (cp.truth25yr.yearlyFlow?.[0]?.srec_income ?? 0) > 0 ? (
                      <p className="text-xs mt-1.5 text-center" style={{ color: '#16a34a' }}>
                        Bills aren&apos;t the whole story: your REC contract also pays ~${Math.round(cp.truth25yr.yearlyFlow[0].srec_income).toLocaleString()} after energization
                        {(cp.truth25yr.yearlyFlow?.[1]?.srec_income ?? 0) > 0
                          ? <> + ~${Math.round((cp.truth25yr.yearlyFlow[1].srec_income) / 12).toLocaleString()}/mo equivalent (paid annually) for the following 6 years</>
                          : null}
                        {' '}— income the monthly comparison above doesn&apos;t include.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* Cash mode — simple net advantage */}
                {purchaseMode === 'cash' && effectiveFinal > 0 && net_financial_difference_25yr !== 0 ? (
                  <div className="rounded-lg p-3 border border-emerald-500/20 bg-emerald-500/5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-400">Est. 25-Year Net Advantage</div>
                        <div className="text-xs text-slate-500 mt-0.5">After system cost vs. paying utility 25 years</div>
                      </div>
                      <div className={`text-xl font-black ${net_financial_difference_25yr >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {net_financial_difference_25yr >= 0 ? '+' : ''}${Math.round(net_financial_difference_25yr).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

          </div>
        </div>

        {/* Section 13: Failsafe message — shown when utility data is unavailable */}
        {failsafeMessage ? (
          <div className="proposal-sec rounded-xl p-4 border border-slate-600/30 bg-slate-800/20" data-block-id="failsafe">
            <div className="flex items-start gap-2">
              <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
              <p className="text-slate-400 text-xs leading-relaxed">{failsafeMessage}</p>
            </div>
          </div>
        ) : null}

        {/* Section 5: Energy Policy Outlook — shown only when policy_effect is at_risk or changing */}
        {utilityProfile.policy_message ? (
          <div className="proposal-sec rounded-xl p-4 border border-amber-500/20 bg-amber-500/5" data-block-id="energy-policy">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-300 text-xs font-semibold mb-1">Energy Policy Outlook</p>
                <p className="text-amber-300/80 text-xs leading-relaxed">{utilityProfile.policy_message}</p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Investment Section */}
        {effectiveFinal > 0 ? (
          <div className="proposal-sec card p-4" data-block-id="cost-vs-value">
            <h2 className="text-base font-black text-white mb-3 flex items-center gap-2">
              <DollarSign size={18} style={{ color: primaryColor }} /> Your Investment
            </h2>

            {/* Purchase mode toggle */}
            <div className="flex gap-1 p-1 bg-slate-800/60 rounded-xl w-fit mb-3 no-print">
              {(['finance', 'cash'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setPurchaseMode(mode)}
                  className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${purchaseMode === mode ? 'text-slate-900' : 'text-slate-400 hover:text-white'}`}
                  style={purchaseMode === mode ? { background: primaryColor } : {}}
                >
                  {mode === 'finance' ? '\u26a1 Finance (recommended)' : '\ud83d\udcb5 Cash'}
                </button>
              ))}
            </div>

            {purchaseMode === 'finance' ? (
              <>
              {/* ── Section 2: Finance mode — monthly cost truth panel */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="md:col-span-1 rounded-xl p-3 border" style={{ background: `${primaryColor}10`, borderColor: `${primaryColor}30` }}>
                  <div className="text-xs text-slate-400 mb-1">Solar Loan Payment</div>
                  <div className="text-3xl font-black" style={{ color: primaryColor }}>
                    ${solar_payment_monthly > 0 ? solar_payment_monthly.toLocaleString() : '\u2014'}/mo
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{financeTermYears}-yr loan at {((pricingCfg?.loanApr ?? 7.99)).toFixed(2)}% APR</div>

                  {/* Section 2: Monthly cost breakdown — factual, not misleading */}
                  {solar_payment_monthly > 0 && avgMonthlyBillBefore > 0 ? (
                    <div className="mt-4 pt-3 border-t border-slate-700/40 space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Solar payment</span>
                        <span className="text-white font-medium">${solar_payment_monthly}/mo</span>
                      </div>
                      {remaining_utility_monthly > 0 ? (
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Est. remaining utility</span>
                          <span className="text-white font-medium">${remaining_utility_monthly}/mo</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between text-xs border-t border-slate-700/40 pt-1.5">
                        <span className="text-slate-300 font-medium">Total energy cost</span>
                        <span className="text-white font-bold">${total_energy_cost_monthly}/mo</span>
                      </div>
                      <div className="flex justify-between text-xs pt-0.5">
                        <span className="text-slate-400">vs. current bill (~${avgMonthlyBillBefore}/mo)</span>
                        {/* Section 2 & 8: "Initial monthly difference" — never "Monthly savings" unless confirmed negative */}
                        <span className={`font-semibold ${ownership_delta_monthly <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {ownership_delta_monthly <= 0
                            ? `-$${Math.abs(ownership_delta_monthly)}/mo`
                            : `+$${ownership_delta_monthly}/mo initial`}
                        </span>
                      </div>
                      {ownership_delta_monthly > 0 ? (
                        <p className="text-xs text-slate-500 pt-0.5">
                          Your solar payment is fixed at ${solar_payment_monthly}/mo. As utility rates rise at {(cp.utility.escalationRate * 100).toFixed(0)}%/yr, this gap closes and reverses.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="md:col-span-2 grid grid-cols-2 gap-2">
                  {[
                    { label: 'System Cost', value: `$${effectiveFinal.toLocaleString()}` },
                    { label: 'Current Avg. Monthly Bill', value: `$${avgMonthlyBillBefore}/mo` },
                    // Section 4: label "Est. 25-Yr Energy Value" — not "25-Year Savings"
                    { label: 'Est. 25-Yr Energy Value', value: estimated_energy_value_25yr > 0 ? `$${Math.round(estimated_energy_value_25yr).toLocaleString()}` : '\u2014' }, // v47.254: lump sum retained in grid; breakdown shown in dedicated section below
                    { label: 'System Payoff', value: payoffYear ? `Year ${payoffYear}` : '\u2014' },
                  ].map(item => (
                    <div key={item.label} className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                      <div className="text-xs text-slate-500 mb-1">{item.label}</div>
                      <div className="text-lg font-black text-white">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Loan term comparison table — shows 10/15/25-yr payments side by side */}
              {effectiveFinal > 0 && purchaseMode === 'finance' ? (
                <div className="mt-3 rounded-xl border border-slate-700/50 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-800/60 border-b border-slate-700/40">
                    <span className="text-xs font-semibold text-slate-300">Loan Term Comparison</span>
                    <span className="text-xs text-slate-500 ml-2">at {((pricingCfg?.loanApr ?? 7.99)).toFixed(2)}% APR</span>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-slate-700/40">
                    {([10, 15, 25] as const).map(termYears => {
                      const _r = ((pricingCfg?.loanApr ?? 7.99) / 100) / 12;
                      const _n = termYears * 12;
                      const _monthly = effectiveFinal > 0 && _r > 0
                        ? Math.round(effectiveFinal * (_r * Math.pow(1 + _r, _n)) / (Math.pow(1 + _r, _n) - 1))
                        : 0;
                      const _isCurrent = termYears === (pricingCfg?.loanTermYears ?? 25);
                      return (
                        <div key={termYears} className={`px-3 py-2.5 text-center ${_isCurrent ? 'bg-amber-500/10' : ''}`}>
                          <div className={`text-[10px] font-semibold mb-1 ${_isCurrent ? 'text-amber-400' : 'text-slate-500'}`}>
                            {termYears}-Year{_isCurrent ? ' ✓' : ''}
                          </div>
                          <div className={`text-base font-black ${_isCurrent ? 'text-amber-400' : 'text-white'}`}>
                            ${_monthly.toLocaleString()}/mo
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            ${Math.round(_monthly * _n).toLocaleString()} total
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              </>
            ) : (
              // ── Section 1 & 4: Cash mode — no ITC line, clean labels ─────
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[
                  { label: 'System Cost', value: `$${effectiveFinal.toLocaleString()}`, color: 'text-white' },
                  // Section 4: "Est. 25-Yr Energy Value" — not "25-Year Savings"
                  { label: 'Est. 25-Yr Energy Value', value: estimated_energy_value_25yr > 0 ? `$${Math.round(estimated_energy_value_25yr).toLocaleString()}` : '\u2014', color: 'text-emerald-400' },
                  // Section 4: net_financial_difference_25yr — clearly labeled
                  { label: 'Est. 25-Yr Net Difference', value: net_financial_difference_25yr !== 0 ? `${net_financial_difference_25yr >= 0 ? '+' : ''}$${Math.round(net_financial_difference_25yr).toLocaleString()}` : '\u2014', color: net_financial_difference_25yr >= 0 ? 'text-emerald-400' : 'text-amber-400' },
                ].map(item => (
                  <div key={item.label} className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                    <div className="text-xs text-slate-500 mb-1">{item.label}</div>
                    <div className={`text-xl font-black ${item.color}`}>{item.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Utility Rate Graph + 25-Year Cost Projection — v47.260 */}
        {cp.truth25yr.yearlyFlow && cp.truth25yr.yearlyFlow.length > 0 ? (
          <>
            <div className="proposal-sec card p-4" data-block-id="utility-rate-graph">
              <h3 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
                <Zap size={15} style={{ color: primaryColor }} /> Utility Rate Trajectory
              </h3>
              <p className="text-xs text-slate-400 mb-3">
                Your utility rate has been rising ~{(cp.utility.escalationRate * 100).toFixed(1)}%/year.
                Solar locks in your energy cost today.
              </p>
              <UtilityRateGraph utility={cp.utility} financial={cp.financial} annualProductionKwh={cp.production.annualKwh} />
            </div>
            <div data-block-id="cost-projection-chart">
              <CashFlowStoryCard
                utility={cp.utility}
                financial={cp.financial}
                truth25yr={cp.truth25yr}
              />
            </div>
          </>
        ) : null}

        {/* v47.251: Incentives compliance notice — content driven by GLOBAL_INCENTIVES_CONFIG */}
        <div className="proposal-sec card p-3 border border-slate-700/30" data-block-id="incentives-notice">
          <div className="flex items-start gap-2">
            <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-slate-400 text-xs leading-relaxed">
                {getIncentivesComplianceMessage()}
              </p>
              {process.env.NODE_ENV === 'development' ? (
                <p className="text-amber-500 text-xs mt-1 font-mono">
                  [{getIncentivesDebugLabel()}]
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* State Incentives — gated by GLOBAL_INCENTIVES_CONFIG.allow_state_incentives (v47.251) */}
        {GLOBAL_INCENTIVES_CONFIG.allow_state_incentives && stateIncentives && stateIncentives.stateIncentives.length > 0 ? (
          <div className="proposal-sec card p-4" data-block-id="incentives-srec">
            <h2 className="text-base font-black text-white mb-3 flex items-center gap-2">
              <Award size={18} style={{ color: primaryColor }} /> Available State Incentives
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {stateIncentives.stateIncentives.map((inc: any, i: number) => (
                <div key={i} className="rounded-xl p-4 border bg-emerald-500/5 border-emerald-500/20">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{inc.name}</div>
                      {inc.description ? <div className="text-xs text-slate-400 mt-1">{inc.description}</div> : null}
                    </div>
                    <div className="text-sm font-black flex-shrink-0 text-emerald-400">
                      {inc.calculatedValue > 0 ? `$${Math.round(inc.calculatedValue).toLocaleString()}` : 'Eligible'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {stateIncentives.cashTotal > 0 ? (
              <div className="mt-3 pt-3 border-t border-slate-700/40 flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Estimated Cash Incentives Total</span>
                <span className="text-sm font-black text-emerald-400">${stateIncentives.cashTotal.toLocaleString()}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Non-Cash State Benefits — property/sales tax exemptions, SRECs (v47.260) */}
        {GLOBAL_INCENTIVES_CONFIG.allow_state_incentives && stateIncentives && stateIncentives.nonCashBenefits && stateIncentives.nonCashBenefits.length > 0 ? (
          <div className="proposal-sec card p-4" data-block-id="incentives-noncash">
            <h2 className="text-base font-black text-white mb-1 flex items-center gap-2">
              <Award size={18} style={{ color: primaryColor }} /> Additional State Benefits
            </h2>
            <p className="text-xs text-slate-400 mb-3">These benefits reduce your long-term costs but are not subtracted from the system price above.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {stateIncentives.nonCashBenefits.map((inc: any, i: number) => (
                <div key={i} className="rounded-xl p-4 border bg-blue-500/5 border-blue-500/20">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{inc.name}</div>
                      {inc.notes ? <div className="text-xs text-slate-400 mt-1">{inc.notes}</div> : null}
                    </div>
                    <div className="text-xs font-bold flex-shrink-0 text-blue-400 text-right">
                      {inc.type === 'property_tax_exemption' || inc.type === 'sales_tax_exemption'
                        ? 'Exempt'
                        // SREC: the canonical truth engine (program-year REC price ×
                        // this system's contracted production, 50%-upfront schedule)
                        // is the ONE SREC number — never the catalog's generic $/kWh
                        // estimate, which contradicted the PDF on the same proposal.
                        : inc.type === 'srec' && (cp.truth25yr.srec_income_25yr ?? 0) > 0
                          ? `~$${Math.round(cp.truth25yr.srec_income_25yr).toLocaleString()} contract`
                          : inc.calculatedValue > 0
                            ? `~$${Math.round(inc.calculatedValue).toLocaleString()}`
                            : 'Eligible'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* §48E Lease/PPA Banner — v47.260 */}
        {isSection48eEnabled() ? (
          <div className="proposal-sec card p-5 border border-amber-500/30 bg-amber-500/5" data-block-id="section48e-banner">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <Zap size={16} className="text-amber-400" />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-black text-white mb-1">
                  $0-Down Lease &amp; PPA Options Available — Act Before July 4, 2026
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed mb-3">
                  Under federal §48E, solar companies that own the system can still claim
                  {/* P.L. 119-21: solar/wind §48E requires construction start by
                      2026-07-04 (or in-service by end of 2027) — "(through 2032)"
                      was the pre-repeal schedule and is false for solar. */}
                  a <span className="text-amber-400 font-bold">{getSection48eRate()}% federal tax credit</span> and
                  pass those savings directly to you through a lease or power purchase agreement (PPA).
                  This means lower monthly payments — sometimes $0 upfront.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div className="rounded-lg p-3 bg-slate-800/60 border border-slate-700/40">
                    <div className="text-xs font-bold text-amber-400 mb-1">Solar Lease</div>
                    <div className="text-xs text-slate-300">
                      Fixed monthly payment. You use the solar energy and the installer maintains the system.
                      Predictable costs for 20–25 years.
                    </div>
                  </div>
                  <div className="rounded-lg p-3 bg-slate-800/60 border border-slate-700/40">
                    <div className="text-xs font-bold text-amber-400 mb-1">Power Purchase Agreement (PPA)</div>
                    <div className="text-xs text-slate-300">
                      Pay only for the electricity the panels produce at a fixed rate below your utility&apos;s price.
                      No equipment cost — just lower energy bills.
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <span className="text-xs font-black text-red-400">⚡ Deadline:</span>
                  <span className="text-xs text-slate-300">
                    Construction must begin by <span className="font-bold text-white">July 4, 2026</span> for the
                    full {getSection48eRate()}% §48E credit — ask your installer to lock in your savings now.
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Section 4: How Your Utility Actually Works — SPEC §10 */}
        <div className="proposal-sec card p-3" data-block-id="utility-profile">
          <h3 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
            <Zap size={15} style={{ color: primaryColor }} /> How Your Utility Actually Works
          </h3>
          <p className="text-slate-300 text-sm leading-relaxed mb-4">
            {utilityProfile.net_metering_summary}
          </p>

          {/* Export compensation breakdown — SPEC §10 detail rows */}
          <div className="space-y-2">
            {/* Net metering type */}
            <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-700/40">
              <span className="text-xs text-slate-400 font-medium">Export Program</span>
              <span className="text-xs text-slate-200 text-right font-semibold capitalize">
                {({
                  retail_1to1:  'Full Retail Net Metering (NEM)',
                  net_billing:  'Net Billing (NEM 3.0 style)',
                  avoided_cost: 'Avoided Cost Compensation',
                  none:         'No Export Credit',
                } as Record<string, string>)[cp.utility.netMeteringType] ?? cp.utility.netMeteringType}
              </span>
            </div>

            {/* Self-consumption value */}
            <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-700/40">
              <div>
                <span className="text-xs text-slate-400 font-medium">Energy Used In Your Home</span>
                <p className="text-xs text-slate-500 mt-0.5">Offsets your bill at full retail value</p>
              </div>
              <span className="text-xs text-emerald-400 font-bold">${cp.utility.rate.toFixed(3)}/kWh</span>
            </div>

            {/* Export value */}
            {cp.utility.netMeteringType !== 'none' && cp.utility.export_rate_monthly !== null ? (
              <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-700/40">
                <div>
                  <span className="text-xs text-slate-400 font-medium">Energy Exported to Grid</span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {cp.utility.netMeteringType === 'retail_1to1'
                      ? 'Credited at full retail rate (1:1 net metering)'
                      : 'Credited at below-retail export rate'}
                  </p>
                </div>
                <span className={`text-xs font-bold ${
                  cp.utility.export_rate_monthly !== null && cp.utility.export_rate_monthly < cp.utility.rate
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}>
                  ${(cp.utility.export_rate_monthly ?? cp.utility.rate).toFixed(3)}/kWh
                </span>
              </div>
            ) : null}

            {/* Annual true-up excess rate */}
            {cp.utility.true_up_period === 'annual' && cp.utility.export_rate_annual_excess !== null ? (
              <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-700/40">
                <div>
                  <span className="text-xs text-slate-400 font-medium">Annual True-Up Excess</span>
                  <p className="text-xs text-slate-500 mt-0.5">Net surplus kWh settled at year-end</p>
                </div>
                <span className="text-xs text-amber-400 font-bold">
                  ${cp.utility.export_rate_annual_excess.toFixed(3)}/kWh
                </span>
              </div>
            ) : null}

            {/* True-up period */}
            <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-700/40">
              <span className="text-xs text-slate-400 font-medium">Settlement Period</span>
              <span className="text-xs text-slate-200 font-semibold capitalize">
                {cp.utility.true_up_period === 'annual'
                  ? 'Annual true-up'
                  : cp.utility.true_up_period === 'monthly'
                  ? 'Monthly settlement'
                  : 'No settlement'}
              </span>
            </div>

            {/* Rate escalation */}
            <div className="flex items-start justify-between gap-3 py-2">
              <div>
                <span className="text-xs text-slate-400 font-medium">Rate Escalation Assumption</span>
                <p className="text-xs text-slate-500 mt-0.5">{cp.utility.escalationRateSourceLabel}</p>
              </div>
              <span className="text-xs text-slate-200 font-semibold">
                {(cp.utility.escalationRate * 100).toFixed(1)}%/yr
              </span>
            </div>
          </div>

          {/* SPEC §11: Export < retail messaging — shown when export rate is below retail */}
          {cp.utility.netMeteringType !== 'retail_1to1' &&
           cp.utility.export_rate_monthly !== null &&
           cp.utility.export_rate_monthly < cp.utility.rate ? (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs text-amber-300 font-semibold mb-1">Not all energy is valued equally.</p>
              <p className="text-xs text-amber-200/80 leading-relaxed">
                Energy used directly in your home offsets electricity at full retail value
                (${cp.utility.rate.toFixed(3)}/kWh), while excess energy exported to the grid
                is compensated at a lower rate (${(cp.utility.export_rate_monthly ?? 0).toFixed(3)}/kWh).
                Maximizing self-consumption gives your solar system its best financial return.
              </p>
            </div>
          ) : null}

          {/* System design guidance for non-retail_1to1 */}
          {cp.utility.netMeteringType !== 'retail_1to1' ? (
            <div className="mt-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/30">
              <p className="text-xs text-slate-400 font-medium">System Design Guidance</p>
              <p className="text-xs text-slate-300 mt-1">{utilityProfile.system_design_guidance}</p>
            </div>
          ) : null}

          {!utilityProfile.is_specific_match ? (
            <p className="text-xs text-slate-500 mt-2 italic">
              * Based on {utilityProfile.profile.state || 'state'}-level utility data.
              Verify specific net metering terms with your utility.
            </p>
          ) : null}
        </div>

        {/* v47.254: Energy Value Breakdown — Task 3+4+6 */}
        {/* Source: cp.financial.energyValueBreakdown (identity map from yearlyFlow[0]) */}
        {energyValueBreakdown.total > 0 ? (
          <div className="proposal-sec card p-3" data-block-id="what-this-means">
            <h3 className="font-semibold text-white text-sm mb-1 flex items-center gap-2">
              <DollarSign size={15} style={{ color: primaryColor }} /> How Your Energy Value Is Calculated
            </h3>
            <p className="text-slate-400 text-xs mb-4 leading-relaxed">
              Energy used in your home offsets electricity at full retail value.
              Exported energy is compensated at your utility’s export rate, which is typically lower.
            </p>
            <div className="space-y-2">
              {/* Self-consumed row */}
              <div className="flex items-center justify-between gap-4 py-2.5 px-3 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
                <div>
                  <div className="text-xs font-semibold text-slate-200">Energy Used In Your Home</div>
                  <div className="text-xs text-slate-500 mt-0.5">Offsets utility bill at full retail rate — highest-value use of your solar</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-base font-black text-emerald-400">${energyValueBreakdown.selfConsumed.toLocaleString()}</div>
                  <div className="text-xs text-slate-500">yr 1 value</div>
                </div>
              </div>

              {/* Exported row — only shown when export value exists */}
              {energyValueBreakdown.exported > 0 ? (
                <div className="flex items-center justify-between gap-4 py-2.5 px-3 rounded-lg bg-blue-500/8 border border-blue-500/20">
                  <div>
                    <div className="text-xs font-semibold text-slate-200">Energy Exported to Grid</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {cp.utility.netMeteringType === 'retail_1to1'
                        ? 'Credited at full retail rate (1:1 net metering)'
                        : 'Credited at your utility’s export rate (below retail)'}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-base font-black text-blue-400">${energyValueBreakdown.exported.toLocaleString()}</div>
                    <div className="text-xs text-slate-500">yr 1 value</div>
                  </div>
                </div>
              ) : null}

              {/* Total row */}
              <div className="flex items-center justify-between gap-4 py-2.5 px-3 rounded-lg bg-slate-800/60 border border-slate-600/30">
                <div>
                  <div className="text-xs font-semibold text-slate-100">Total Year 1 Energy Value</div>
                  <div className="text-xs text-slate-500 mt-0.5">Self-consumption + export credits combined</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-base font-black text-white">${energyValueBreakdown.total.toLocaleString()}</div>
                  <div className="text-xs text-slate-500">yr 1 total</div>
                </div>
              </div>
            </div>

            {/* System payoff callout — from _meta.payoffYear (iterative model) */}
            {payoffYear ? (
              <div className="mt-4 pt-3 border-t border-slate-700/40 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-slate-300">System Payoff</div>
                  <div className="text-xs text-slate-500 mt-0.5">{utilityProfile.profile.srec_available ? 'Energy value + state incentives ≥ system cost' : 'When cumulative energy value produced ≥ system cost'}</div>
                </div>
                <div className="text-base font-black text-blue-400">Year {payoffYear}</div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Section 4: SREC Program — shown only when srec_available */}
        {utilityProfile.profile.srec_available && utilityProfile.srec_summary ? (
          <div className="proposal-sec card p-5 border border-emerald-500/20" data-block-id="srec">
            <h3 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
              <Award size={15} className="text-emerald-400" /> Solar Performance Credits (SREC)
            </h3>
            <p className="text-slate-300 text-sm leading-relaxed">
              {utilityProfile.srec_summary}
            </p>
          </div>
        ) : null}

        {/* Production + Monthly Bill Chart */}
        {production && mounted ? (
          <div className="proposal-sec grid grid-cols-1 lg:grid-cols-2 gap-3" data-block-id="system-summary" data-keep-together="true">
            {/* Monthly Production */}
            <div className="card p-5">
              <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
                <Sun size={15} style={{ color: primaryColor }} /> Monthly Solar Production
              </h3>
              <div className="relative flex items-end gap-1 mb-1" style={{ height: '80px' }}>
                {cp.production.monthlyKwh.map((kwh, i) => {
                  const max = Math.max(...cp.production.monthlyKwh, 1);
                  // 60px max: bar + ~16px month label must fit the 80px column —
                  // at 68px the flexbox shrank every tall bar to one identical
                  // height (May-Aug rendered flat despite distinct kWh).
                  const barH = Math.max(2, Math.round((kwh / max) * 60));
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end" style={{ height: '80px' }}>
                      <div
                        className="w-full rounded-t-sm transition-all"
                        style={{ height: `${barH}px`, background: `${primaryColor}cc`, minHeight: '2px' }}
                        title={`${MONTHS[i]}: ${kwh.toLocaleString()} kWh`}
                      />
                      <span className="text-xs text-slate-500 mt-0.5">{MONTHS[i].slice(0,1)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="text-center text-xs text-slate-400 mt-1">
                {annualProduction.toLocaleString()} kWh / year total
              </div>
              {/* v1.shade: TSRF badge — shown only when shade analysis has been run */}
              {cp.production.tsrf !== undefined ? (
                <div className="mt-2 flex items-center justify-center gap-1.5">
                  <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold border ${
                    cp.production.tsrf >= 0.95
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : cp.production.tsrf >= 0.85
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}>
                    <Sun size={11} />
                    TSRF {(cp.production.tsrf * 100).toFixed(1)}%
                  </div>
                  <span className="text-slate-500 text-xs">
                    shade analysis applied
                  </span>
                </div>
              ) : null}
            </div>

            {/* Monthly Bill Before/After */}
            <div className="card p-5">
              <h3 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
                <DollarSign size={15} className="text-emerald-400" /> Monthly Bill: Before vs After Solar
              </h3>
              {/* Honest before→after: solar cuts the energy bill, but the fixed
                  grid/meter charge survives — there is always a utility bill. */}
              <div className="mb-3 flex items-center gap-3">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">Utility bill now</div>
                  <div className="text-xl font-black text-red-400">${avgMonthlyBefore}/mo</div>
                </div>
                <span className="text-slate-600 text-lg font-bold">→</span>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">With solar</div>
                  <div className="text-xl font-black text-emerald-400">${avgMonthlyAfter}/mo</div>
                </div>
                {avgMonthlyBefore - avgMonthlyAfter > 0 ? (
                  <span className="ml-auto rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-emerald-300">
                    −${avgMonthlyBefore - avgMonthlyAfter}/mo utility bill
                  </span>
                ) : null}
              </div>
              {/* Bridge to "What Changes Today": this card is the UTILITY BILL only.
                  Without this line, "−$229/MO" here read as contradicting the
                  honest "+$228/mo" total-outlay figure on the summary (Ray, 07-16). */}
              {purchaseMode === 'finance' && solar_payment_monthly > 0 ? (
                <p className="text-xs text-slate-500 mb-2">
                  Utility bill only — your ${solar_payment_monthly}/mo solar payment is separate
                  (total ${total_energy_cost_monthly}/mo; see &ldquo;What Changes Today&rdquo;).
                </p>
              ) : null}
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={monthlyBillData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  {/* Explicit even ticks — recharts' auto axis dropped an interior
                      tick ($0/$85/$170/$340), printing a scale that reads nonlinear. */}
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`}
                    domain={[0, (dataMax: number) => Math.ceil(dataMax / 20) * 20]}
                    ticks={(() => { const m = Math.ceil(Math.max(...monthlyBillData.map(d => d.before), 1) / 20) * 20; return [0, m / 4, m / 2, (3 * m) / 4, m]; })()} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v}`, '']} />
                  <Bar dataKey="before" fill="#ef4444" radius={[3, 3, 0, 0]} name="Before Solar" opacity={0.6} />
                  <Bar dataKey="after" fill="#22c55e" radius={[3, 3, 0, 0]} name="After Solar" opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : null}

        {/* Section 8: Offset messaging — shown when offset < 100% */}
        {energyOffset > 0 && energyOffset < 100 ? (
          <div className="proposal-sec rounded-xl p-4 border border-blue-500/20 bg-blue-500/5" data-block-id="long-term-outcome">
            <div className="flex items-start gap-2">
              <Zap size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-blue-300 text-xs font-semibold mb-1">Partial Offset System</p>
                <p className="text-slate-300 text-xs leading-relaxed">
                  This system offsets approximately {energyOffset}% of your annual energy usage.
                  You will still have a reduced utility bill for the remaining {100 - energyOffset}%
                  of your energy needs.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* v47.256: Your Savings Over Time — single green savings curve */}
        {/* Source: projectionData[i].cumulative = cumulative_without_solar - cumulative_with_solar (read-only) */}
        {annualProduction > 0 && mounted && projectionData.length > 0 ? (
          <div className="proposal-sec card p-3" data-block-id="financial-timeline" data-keep-together="true">
            {/* Title */}
            <div className="flex items-start justify-between gap-4 mb-3">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <TrendingUp size={15} style={{ color: primaryColor }} /> Your Savings Over Time
              </h3>
              {/* Final savings callout — Task 3 */}
              {netDifference_25yr > 0 ? (
                <div className="text-right flex-shrink-0">
                  <div className="text-xl font-black text-emerald-400">
                    +${Math.round(netDifference_25yr).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-500">total est. savings</div>
                </div>
              ) : null}
            </div>

            {/* Task 4: Explanation above graph */}
            <p className="text-slate-400 text-xs mb-4 leading-relaxed">
              As utility rates increase over time, your savings grow each year.{' '}
              <span className="text-slate-500">Solar locks in your energy cost while utility prices continue to rise.</span>
            </p>

            {/* Single green savings area chart */}
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={projectionData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="savingsGrowthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="year"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval={4}
                  tickFormatter={(v: string) => `Yr ${v.replace('Yr ', '')}`}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`}
                  width={44}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`$${v.toLocaleString()}`, 'Cumulative Savings']}
                  labelFormatter={(label: string) => `${label}`}
                />
                {/* Task 5: Break-even reference line at payoffYear */}
                {payoffYear ? (
                  <ReferenceLine
                    x={`Yr ${payoffYear}`}
                    stroke="#f59e0b"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{
                      value: `Break-even Yr ${payoffYear}`,
                      position: 'insideTopRight',
                      fill: '#f59e0b',
                      fontSize: 9,
                      fontWeight: 600,
                    }}
                  />
                ) : null}
                {/* Single green savings line */}
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#22c55e"
                  strokeWidth={2.5}
                  fill="url(#savingsGrowthGrad)"
                  name="Cumulative Savings"
                  dot={false}
                  activeDot={{ r: 4, fill: '#22c55e', stroke: '#0f172a', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>

            {/* Caption below graph — Task 4 */}
            <p className="text-slate-500 text-xs mt-3 leading-relaxed">
              {purchaseMode === 'finance'
                ? 'While your solar payment may start slightly higher than your current bill, utility rates continue to rise — growing your savings each year.'
                : 'After your one-time investment, solar avoids thousands in future utility costs as rates continue to increase.'}
            </p>
          </div>
        ) : null}

        {/* v47.255: 25-Year Financial Summary — Task 7: de-emphasized large numbers, reordered for clarity */}
        {annualProduction > 0 && utility_cost_25yr > 0 ? (
          <div className="proposal-sec card p-3" data-block-id="financial-summary" data-keep-together="true">
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <BarChart2 size={15} style={{ color: primaryColor }} /> 25-Year Financial Summary
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {/* Solar Investment — shown first: this is what customer controls */}
              <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                <div className="text-xs text-slate-500 mb-1">Your Solar Investment</div>
                <div className="text-lg font-black text-white">${Math.round(solar_cost_total).toLocaleString()}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {/* Value is cash-basis system price (canonical savings basis) — the
                      old "25-yr loan total" label was false ($59,200 vs the real
                      $137,100 financed total shown in the loan comparison table). */}
                  {purchaseMode === 'finance'
                    ? `System price — financed @ $${solar_payment_monthly}/mo`
                    : 'One-time cash purchase'}
                </div>
              </div>

              {/* Remaining utility cost */}
              <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                <div className="text-xs text-slate-500 mb-1">Est. Remaining Utility Bills</div>
                <div className="text-lg font-black text-slate-300">${remaining_utility_cost_total > 0 ? remaining_utility_cost_total.toLocaleString() : '0'}</div>
                {/* "100% offset — 0% still from grid" next to a nonzero remaining-bills
                    figure read as a contradiction: fixed charges, delivery riders, and
                    true-up shortfalls remain even at full offset. Say so. */}
                <div className="text-xs text-slate-500 mt-1">
                  {energyOffset >= 100
                    ? `${energyOffset}% offset — fixed charges & riders still apply`
                    : `${energyOffset}% offset — ${100 - energyOffset}% still from grid`}
                </div>
              </div>

              {/* Net advantage — prominent */}
              <div className="bg-emerald-500/8 rounded-xl p-4 border border-emerald-500/25">
                <div className="text-xs text-slate-400 mb-1">Est. 25-Yr Advantage</div>
                <div className={`text-lg font-black ${net_financial_difference_25yr >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {net_financial_difference_25yr >= 0
                    ? `+$${Math.round(net_financial_difference_25yr).toLocaleString()}`
                    : `-$${Math.abs(Math.round(net_financial_difference_25yr)).toLocaleString()}`}
                </div>
                <div className="text-xs text-slate-500 mt-1">vs. paying utility rates 25 yrs</div>
              </div>

              {/* Utility cost without solar — de-emphasized, always with context (Task 7) */}
              <div className="bg-slate-800/20 rounded-xl p-4 border border-slate-700/20">
                <div className="text-xs text-slate-600 mb-1">If You Kept Paying Utility Bills</div>
                <div className="text-lg font-black text-slate-500">${utility_cost_25yr.toLocaleString()}</div>
                <div className="text-xs text-slate-600 mt-1">
                  Projected 25-yr cost with {(utilityInflation * 100).toFixed(0)}%/yr rate increases
                </div>
              </div>
            </div>
            <p className="text-slate-600 text-xs mt-3">
              All figures are estimates based on {(utilityInflation * 100).toFixed(0)}% annual utility rate escalation
              and {(panelDegradation * 100).toFixed(1)}%/yr panel degradation. Not a guarantee of future results.
            </p>
          </div>
        ) : null}

        {/* v47.254: Task 2 — Financial Narrative section (from cp._meta.narrative) */}
        {narrative && narrative.fullNarrative ? (
          <div className="proposal-sec card p-3" data-block-id="why-this-system" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)' }}>
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <TrendingUp size={15} style={{ color: primaryColor }} /> Your Financial Story
            </h3>
            <div className="space-y-2">
              {narrative.primaryStory ? (
                <p className="text-slate-200 text-sm leading-relaxed">{narrative.primaryStory}</p>
              ) : null}
              {narrative.monthlyImpact ? (
                <p className="text-slate-300 text-sm leading-relaxed">{narrative.monthlyImpact}</p>
              ) : null}
              {narrative.payoffStatement ? (
                <p className="text-slate-300 text-sm leading-relaxed">{narrative.payoffStatement}</p>
              ) : null}
              {narrative.outcomeStatement ? (
                <p className="text-slate-200 text-sm leading-relaxed font-medium">{narrative.outcomeStatement}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Section 6: Assumptions Block ── */}
        {(annualProduction > 0 || effectiveFinal > 0) ? (
          <div className="proposal-sec card p-3 border border-slate-700/30" data-block-id="next-steps">
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <Info size={15} className="text-slate-400" /> Proposal Assumptions
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              {[
                {
                  label: 'Utility Rate',
                  value: `$${utilityRate.toFixed(4)}/kWh`,
                  note: utilityProfile.is_specific_match
                    ? `${utilityProfile.profile.utility_id.replace(/_/g, ' ').toUpperCase()} — verified rate`
                    : 'Current blended rate used for estimates',
                },
                {
                  label: 'Net Metering Type',
                  value: ({
                    retail_1to1:  'Retail-rate (1:1)',
                    net_billing:  'Net billing',
                    avoided_cost: 'Avoided cost',
                    none:         'None',
                  } as Record<string, string>)[utilityProfile.profile.net_metering_type] || 'Retail-rate',
                  note: 'Export compensation structure',
                },
                {
                  label: 'Rate Escalation',
                  value: `${(utilityInflation * 100).toFixed(0)}% / yr`,
                  note: 'Historical avg. utility rate increase assumed',
                },
                {
                  label: 'Production Model',
                  value: 'PVWatts / layout-based',
                  note: 'Based on system design and location data',
                },
                {
                  label: 'Annual Usage',
                  value: annualUsage > 0 ? `${annualUsage.toLocaleString()} kWh` : 'Not provided',
                  note: 'From utility bill analysis',
                },
                {
                  label: 'Energy Offset',
                  value: energyOffset > 0 ? `~${energyOffset}% of annual usage` : 'Not calculated',
                  note: 'Estimated annual production vs. usage',
                },
                ...(purchaseMode === 'finance' ? [{
                  label: 'Loan Terms',
                  value: `${financeTermYears} yr @ ${((pricingCfg?.loanApr ?? 7.99)).toFixed(2)}% APR`,
                  note: 'Subject to lender approval',
                }] : []),
                {
                  label: 'Panel Degradation',
                  value: `${(panelDegradation * 100).toFixed(1)}% / yr`,
                  note: 'Industry standard annual output reduction',
                },
              ].map(a => (
                <div key={a.label} className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/20">
                  <div className="text-slate-400 mb-0.5">{a.label}</div>
                  <div className="text-white font-semibold">{a.value}</div>
                  {a.note ? <div className="text-slate-500 text-xs mt-0.5">{a.note}</div> : null}
                </div>
              ))}
            </div>
            <p className="text-slate-600 text-xs mt-4">
              All financial projections are estimates based on the assumptions above and are not guaranteed.
              Actual production, savings, and costs will vary. This proposal does not constitute tax advice.
              {' '}{getIncentivesComplianceMessage()}
            </p>
          </div>
        ) : null}

        {/* Equipment */}
        <div className="proposal-sec card p-4" data-block-id="equipment">
          <h2 className="text-base font-black text-white mb-3 flex items-center gap-2">
            <Shield size={18} style={{ color: primaryColor }} /> System Equipment
          </h2>
          {/* v47.398 — Ecosystem summary (shown only when confidence is high) */}
          {(() => {
            const ecoSummary = deriveEcosystemSummary({
              panels: (proj as any)?.selectedPanel ? [{
                manufacturer: (proj as any).selectedPanel.manufacturer,
                model: (proj as any).selectedPanel.model || (proj as any).selectedPanel.name,
                ecosystemBrand: (proj as any).selectedPanel.ecosystemBrand,
              }] : [],
              inverters: (proj as any)?.selectedInverter ? [{
                manufacturer: (proj as any).selectedInverter.manufacturer,
                model: (proj as any).selectedInverter.model || (proj as any).selectedInverter.name,
                ecosystemBrand: (proj as any).selectedInverter.ecosystemBrand || (proj as any).selectedInverter.manufacturer,
              }] : [],
              batteries: (proj as any)?.selectedBattery ? [{
                manufacturer: (proj as any).selectedBattery.manufacturer,
                model: (proj as any).selectedBattery.model || (proj as any).selectedBattery.name,
                ecosystemBrand: (proj as any).selectedBattery.ecosystemBrand,
              }] : [],
            });
            if (!ecoSummary.showEcosystemCopy || !ecoSummary.sentence) return null;
            return (
              <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-indigo-500/5 to-purple-500/5 border border-indigo-500/20">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Shield size={11} className="text-indigo-300" />
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{ecoSummary.sentence}</p>
                </div>
              </div>
            );
          })()}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Panel */}
            <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${primaryColor}20`, color: primaryColor }}>
                  <Sun size={18} />
                </div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Solar Panels</span>
              </div>
              <div className="text-sm font-semibold text-white">
                {(proj as any)?.selectedPanel?.model || (proj as any)?.selectedPanel?.name || 'High-efficiency solar panels'}
              </div>
              {/* Section 2: Use resolvedPanelWattage from panelIntegrity — single source of truth */}
              {resolvedPanelWattage > 0 ? (
                <div className="text-xs text-slate-400 mt-1">{resolvedPanelWattage}W per panel</div>
              ) : null}
              <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                <CheckCircle size={10} /> 25-yr product warranty
              </div>
            </div>

            {/* Inverter */}
            <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${primaryColor}20`, color: primaryColor }}>
                  <Zap size={18} />
                </div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Inverter</span>
              </div>
              <div className="text-sm font-semibold text-white">
                {(proj as any)?.selectedInverter?.model || (proj as any)?.selectedInverter?.name || 'Premium grid-tie inverter'}
              </div>
              {(proj as any)?.selectedInverter?.efficiency ? (
                // Efficiency is stored as a FRACTION (0.965) in some records and a
                // PERCENT (96.5) in others (equipment-db vs engineering snapshots) —
                // blind ×100 rendered "9650.0% efficiency". Normalize: >1.5 = already %.
                <div className="text-xs text-slate-400 mt-1">
                  {((proj as any).selectedInverter.efficiency > 1.5
                    ? (proj as any).selectedInverter.efficiency
                    : (proj as any).selectedInverter.efficiency * 100).toFixed(1)}% efficiency
                </div>
              ) : null}
              <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                {/* Warranty was hardcoded "25-yr" — SMA string inverters carry 10yr,
                    Enphase micros 25yr. Read the snapshot; only claim when known. */}
                <CheckCircle size={10} /> {(proj as any)?.selectedInverter?.warranty
                  ? `${(proj as any).selectedInverter.warranty}-yr warranty`
                  : 'Manufacturer warranty'}
              </div>
            </div>

            {/* Racking */}
            <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${primaryColor}20`, color: primaryColor }}>
                  <Shield size={18} />
                </div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Mounting System</span>
              </div>
              <div className="text-sm font-semibold text-white">
                {equipment.racking?.rackingBrand
                  ? `${equipment.racking.rackingBrand} ${equipment.racking.rackingModel}`
                  : 'Engineered mounting system'}
              </div>
              {equipment.racking?.tiltRange ? (
                <div className="text-xs text-slate-400 mt-1">{equipment.racking.tiltRange}</div>
              ) : null}
              <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                <CheckCircle size={10} /> {equipment.racking?.warranty || '25-yr structural warranty'}
              </div>
            </div>
          </div>
        </div>

        {/* ── Environmental Impact ─────────────────────────────────────────── */}
        {annualProduction > 0 ? ((() => {
          // EPA eGRID national average: 0.386 kg CO₂ per kWh (2023)
          const CO2_PER_KWH_KG   = 0.386;
          const TREE_KG_CO2_YR   = 21.77;  // avg tree absorbs ~21.77 kg CO₂/yr
          const CAR_KG_CO2_MILE  = 0.404;  // avg car 404g CO₂/mile
          const HOME_KWH_YR      = 10632;  // avg US home annual usage (EIA 2023)
          const annualCO2Kg      = Math.round(annualProduction * CO2_PER_KWH_KG);
          const annualCO2Lbs     = Math.round(annualCO2Kg * 2.205);
          const treesEquiv       = Math.round(annualCO2Kg / TREE_KG_CO2_YR);
          const milesEquiv       = Math.round(annualCO2Kg / CAR_KG_CO2_MILE);
          const homesEquiv       = parseFloat((annualProduction / HOME_KWH_YR).toFixed(1));
          const lifetime25CO2Lbs = Math.round(annualCO2Lbs * 25 * 0.9); // ~10% degradation avg
          return (
            <div className="proposal-sec card p-4" data-block-id="environmental-impact">
              <h3 className="font-semibold text-white text-sm mb-1 flex items-center gap-2">
                <Leaf size={15} className="text-emerald-400" /> Your Environmental Impact
              </h3>
              <p className="text-slate-400 text-xs mb-4">
                Every kWh of solar energy offsets CO₂ that would otherwise come from the grid.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                {[
                  {
                    icon: <Wind size={18} className="text-sky-400" />,
                    value: `${annualCO2Lbs.toLocaleString()} lbs`,
                    label: 'CO₂ Avoided / Year',
                    sub: `${annualCO2Kg.toLocaleString()} kg`,
                    color: 'border-sky-500/20 bg-sky-500/5',
                  },
                  {
                    icon: <TreePine size={18} className="text-emerald-400" />,
                    value: `${treesEquiv.toLocaleString()}`,
                    label: 'Trees Equivalent / Year',
                    sub: 'absorbing the same CO₂',
                    color: 'border-emerald-500/20 bg-emerald-500/5',
                  },
                  {
                    icon: <Car size={18} className="text-violet-400" />,
                    value: `${milesEquiv.toLocaleString()}`,
                    label: 'Car Miles Offset / Year',
                    sub: 'not driven equivalent',
                    color: 'border-violet-500/20 bg-violet-500/5',
                  },
                  {
                    icon: <Users size={18} className="text-amber-400" />,
                    value: `${homesEquiv}`,
                    label: 'Homes Powered',
                    sub: 'avg US home annual usage',
                    color: 'border-amber-500/20 bg-amber-500/5',
                  },
                ].map(m => (
                  <div key={m.label} className={`rounded-xl p-3 border ${m.color} text-center`}>
                    <div className="flex justify-center mb-1.5">{m.icon}</div>
                    <div className="text-lg font-black text-white">{m.value}</div>
                    <div className="text-xs text-slate-400 mt-0.5 leading-tight">{m.label}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{m.sub}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg px-3 py-2 bg-emerald-500/5 border border-emerald-500/15 flex items-center gap-3">
                <Leaf size={14} className="text-emerald-400 flex-shrink-0" />
                <p className="text-xs text-slate-400">
                  Over 25 years this system will offset an estimated{' '}
                  <span className="text-emerald-400 font-semibold">{lifetime25CO2Lbs.toLocaleString()} lbs of CO₂</span>
                  {' '}— equivalent to planting{' '}
                  <span className="text-emerald-400 font-semibold">{Math.round(treesEquiv * 25 * 0.9).toLocaleString()} trees</span>.
                  Based on EPA eGRID national average emissions factor.
                </p>
              </div>
            </div>
          );
        })()) : null}

        {/* ── What Happens Next — post-sign timeline ────────────────────────── */}
        <div className="proposal-sec card p-4" data-block-id="next-steps-timeline">
          <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
            <ChevronRight size={15} style={{ color: primaryColor }} /> What Happens After You Sign
          </h3>
          <div className="space-y-0">
            {[
              {
                step: 1,
                title: 'Proposal Signed',
                desc: 'Your installer is notified immediately and will contact you within 24 hours.',
                time: 'Today',
                color: 'text-emerald-400',
                dot: 'bg-emerald-400',
              },
              {
                step: 2,
                title: 'Site Survey',
                desc: 'A technician visits to measure your roof, check your electrical panel, and confirm the design.',
                time: '1–5 business days',
                color: 'text-sky-400',
                dot: 'bg-sky-400',
              },
              {
                step: 3,
                title: 'Permits & Engineering',
                desc: 'Your installer submits permits to the city and files interconnection paperwork with your utility.',
                time: '2–6 weeks',
                color: 'text-violet-400',
                dot: 'bg-violet-400',
              },
              {
                step: 4,
                title: 'Installation Day',
                desc: 'Your system is installed — typically 1–2 days. Panels, wiring, inverter, and monitoring.',
                time: '1–2 days on-site',
                color: 'text-amber-400',
                dot: 'bg-amber-400',
              },
              {
                step: 5,
                title: 'Inspection & Permission to Operate',
                desc: 'City inspection is completed and your utility grants Permission to Operate (PTO). System turns on.',
                time: '1–3 weeks after install',
                color: 'text-orange-400',
                dot: 'bg-orange-400',
              },
              {
                step: 6,
                title: 'You\'re Generating Solar Energy',
                desc: 'Your system is live. Monitor production from your phone and watch your bill drop.',
                time: 'Ongoing',
                color: 'text-green-400',
                dot: 'bg-green-400',
              },
            ].map((s, idx, arr) => (
              <div key={s.step} className="flex gap-3">
                {/* Timeline spine */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className={`w-7 h-7 rounded-full border-2 border-slate-700 flex items-center justify-center text-xs font-black ${s.color}`}>
                    {s.step}
                  </div>
                  {idx < arr.length - 1 ? (
                    <div className="w-px flex-1 bg-slate-700/50 my-1" />
                  ) : null}
                </div>
                {/* Content */}
                <div className={`pb-${idx < arr.length - 1 ? '4' : '0'} flex-1 min-w-0`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${s.color}`}>{s.title}</span>
                    <span className="text-xs text-slate-500 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/50">{s.time}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── ICA / PTO Roadmap section (Tier 1 or Tier 2) ─────────────────── */}
        {(icaSteps.length > 0 || icaTimeline || ptoTimeline) ? (
          <div className="proposal-sec card p-4" data-block-id="ica-pto-roadmap">
            <h3 className="font-semibold text-white text-sm mb-1 flex items-center gap-2">
              <Zap size={15} style={{ color: primaryColor }} /> Utility Interconnection &amp; Permission to Operate
            </h3>
            {icaTierLabel ? (
              <p className="text-xs text-slate-400 mb-3 flex items-center gap-1.5">
                <Info size={11} className="text-slate-500 flex-shrink-0" />
                <span>
                  {icaTier1Profile
                    ? `Specific process for ${icaTierLabel}`
                    : `General process — ${icaTierLabel}`
                  }
                </span>
              </p>
            ) : null}
            {/* Timeline badges */}
            {(icaTimeline || ptoTimeline) ? (
              <div className="flex flex-wrap gap-2 mb-4">
                {icaTimeline ? (
                  <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-violet-500/10 border border-violet-500/20">
                    <Clock size={11} className="text-violet-400" />
                    <span className="text-xs text-violet-300 font-medium">ICA approval: {icaTimeline}</span>
                  </div>
                ) : null}
                {ptoTimeline ? (
                  <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-emerald-500/10 border border-emerald-500/20">
                    <CheckCircle size={11} className="text-emerald-400" />
                    <span className="text-xs text-emerald-300 font-medium">PTO: {ptoTimeline}</span>
                  </div>
                ) : null}
                {icaPortalUrl ? (
                  <a
                    href={icaPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 transition-colors"
                  >
                    <ExternalLink size={11} className="text-sky-400" />
                    <span className="text-xs text-sky-300 font-medium">Utility portal</span>
                  </a>
                ) : null}
                {!icaPortalUrl && icaRulesUrl ? (
                  <a
                    href={icaRulesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 transition-colors"
                  >
                    <ExternalLink size={11} className="text-sky-400" />
                    <span className="text-xs text-sky-300 font-medium">State rules</span>
                  </a>
                ) : null}
              </div>
            ) : null}
            {/* Steps */}
            {icaSteps.length > 0 ? (
              <div className="space-y-0">
                {icaSteps.map((step, idx) => (
                  <div key={idx} className="flex gap-3">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div
                        className="w-6 h-6 rounded-full border-2 border-slate-700 flex items-center justify-center text-xs font-black"
                        style={{ color: primaryColor }}
                      >
                        {idx + 1}
                      </div>
                      {idx < icaSteps.length - 1 ? (
                        <div className="w-px flex-1 bg-slate-700/50 my-1" />
                      ) : null}
                    </div>
                    <div className={`pb-${idx < icaSteps.length - 1 ? '3' : '0'} flex-1 min-w-0`}>
                      <p className="text-xs text-slate-300 leading-relaxed">{step}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {/* Data source note */}
            <div className="mt-3 rounded-lg px-3 py-2 bg-slate-800/40 border border-slate-700/30">
              <p className="text-xs text-slate-500 leading-relaxed">
                {icaTier1Profile
                  ? `Timelines and steps are specific to ${icaTier1Profile.utility_name}. Actual timeline may vary based on application completeness and grid capacity.`
                  : icaTier2Fallback
                    ? `These are typical steps for utilities regulated by the ${icaTier2Fallback.regulatory_body}. Your specific utility may have additional requirements.`
                    : 'Timeline and process steps are estimates. Your installer will coordinate the interconnection and PTO process.'
                }
              </p>
            </div>
          </div>
        ) : null}

        {/* Why Solar / Trust section */}
        <div className="proposal-sec grid grid-cols-1 md:grid-cols-3 gap-2" data-block-id="trust-performance">
          {[
            // Honest scope (audit 2026-07-16): "full coverage on panels, inverter,
            // and mounting" was false whenever the inverter carries 10yr (SMA).
            { icon: <Shield size={20} />, title: '25-Year Panel Warranty', desc: 'Panels carry a 25-year manufacturer warranty; inverter and racking carry their own manufacturer terms — see the equipment section.' },
            { icon: <Award size={20} />, title: 'Licensed & Insured', desc: 'Fully licensed installers with comprehensive insurance coverage on every job.' },
            { icon: <Star size={20} />, title: 'Local Expertise', desc: 'Deep knowledge of local utility rules, incentives, and permitting requirements.' },
          ].map(t => (
            <div key={t.title} className="card p-3 text-center">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: `${primaryColor}20`, color: primaryColor }}>
                {t.icon}
              </div>
              <div className="font-semibold text-white text-sm mb-1">{t.title}</div>
              <div className="text-xs text-slate-400">{t.desc}</div>
            </div>
          ))}
        </div>


        {/* Company Intro block */}
        <div className="proposal-sec card p-5" data-block-id="testimonial">
          <div className="text-center mb-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/60 border border-slate-700/30 mb-3">
              {branding.companyLogoUrl ? (
                <img src={branding.companyLogoUrl} alt={branding.companyName} className="h-5 object-contain" />
              ) : (
                <Sun size={13} style={{ color: primaryColor }} />
              )}
              <span className="text-xs font-semibold text-slate-300">{branding.companyName}</span>
            </div>
            <h2 className="text-lg font-black text-white mb-1">Why Homeowners Choose Us</h2>
            <p className="text-slate-400 text-sm max-w-xl mx-auto">
              We&apos;ve helped hundreds of families take control of their energy costs with clean, locally-installed solar.
            </p>
          </div>

          {/* Company footer text (configured in Settings) or professional close */}
          {branding.proposalFooterText ? (
            <div className="relative rounded-xl p-4 border border-slate-700/40" style={{ background: `${primaryColor}08` }}>
              <div className="text-3xl leading-none mb-2" style={{ color: primaryColor, opacity: 0.4 }}>&ldquo;</div>
              <p className="text-slate-300 text-sm leading-relaxed italic">
                {branding.proposalFooterText}
              </p>
              <div className="flex items-center gap-2 mt-3">
                {branding.companyLogoUrl ? (
                  <img src={branding.companyLogoUrl} alt={branding.companyName} className="h-6 object-contain" />
                ) : (
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 text-xs font-bold flex-shrink-0" style={{ background: `${primaryColor}20` }}>
                    {branding.companyName.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-white text-xs font-semibold">{branding.companyName}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl p-4 border border-slate-700/40 text-center" style={{ background: `${primaryColor}08` }}>
              <div className="flex items-center justify-center gap-2 mb-2">
                {[1,2,3,4,5].map(s => (
                  <Star key={s} size={14} className="text-amber-400 fill-amber-400" />
                ))}
              </div>
              <p className="text-slate-400 text-xs">
                Licensed solar professionals committed to quality installation and long-term customer support.
              </p>
            </div>
          )}

          {/* Company details */}
          {(branding.companyAddress || branding.companyPhone || branding.companyWebsite) ? (
            <div className="flex flex-wrap items-center justify-center gap-4 mt-4 pt-3 border-t border-slate-700/40">
              {branding.companyAddress ? (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <MapPin size={11} className="text-slate-600" />
                  {branding.companyAddress}
                </div>
              ) : null}
              {branding.companyPhone ? (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Phone size={11} className="text-slate-600" />
                  {branding.companyPhone}
                </div>
              ) : null}
              {branding.companyWebsite ? (
                <a href={branding.companyWebsite} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs hover:text-white transition-colors"
                  style={{ color: primaryColor }}>
                  <ExternalLink size={11} />
                  {branding.companyWebsite.replace(/^https?:\/\//, '')}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* CTA */}
        {!accepted ? (
          <div className="proposal-sec rounded-2xl p-6 text-center border" data-block-id="cta" data-keep-together="true" style={{ background: `${primaryColor}08`, borderColor: `${primaryColor}25` }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: `${primaryColor}20`, border: `1px solid ${primaryColor}40` }}>
              <Sun size={22} style={{ color: primaryColor }} />
            </div>
            <h2 className="text-2xl font-black text-white mb-2">Ready to Go Solar?</h2>
            <p className="text-slate-400 text-sm mb-5 max-w-md mx-auto">
              Sign this proposal to get started. Your installer will contact you within 24 hours to schedule next steps.
            </p>
            <button
              onClick={onAccept}
              disabled={accepting}
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-slate-900 font-black text-base transition-all hover:opacity-90 active:scale-95 shadow-lg"
              style={{ background: primaryColor, boxShadow: `0 8px 24px ${primaryColor}40` }}
            >
              {accepting ? (
                <span className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
              ) : (
                <PenLine size={20} />
              )}
              Sign &amp; Accept Proposal
            </button>
            <div className="flex items-center justify-center gap-4 mt-4">
              <p className="text-slate-500 text-xs">Legally binding e-signature · No DocuSign needed</p>
            </div>
            {/* Secondary: Download PDF — data-html2canvas-ignore keeps the
                "Generating PDF…" spinner state from being baked into the PDF
                itself (generateProposalPDF screenshots the live DOM). */}
            <div className="border-t border-slate-700/40 mt-5 pt-4" data-html2canvas-ignore="true">
              <button
                onClick={onDownloadPdf}
                disabled={downloadingPdf}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm transition-colors disabled:opacity-50"
              >
                {downloadingPdf ? (
                  <span className="w-4 h-4 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                {downloadingPdf ? 'Generating PDF…' : 'Download as PDF'}
              </button>
            </div>
          </div>
        ) : (
          <div className="proposal-sec rounded-2xl p-6 text-center border border-emerald-500/30" data-block-id="cta" style={{ background: 'linear-gradient(135deg, #064e3b10 0%, #065f4620 100%)' }}>
            <div className="relative w-16 h-16 mx-auto mb-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <PartyPopper size={28} className="text-emerald-300" />
              </div>
              <div className="absolute inset-0 rounded-full border border-emerald-400/30 animate-ping" />
            </div>
            <h2 className="text-2xl font-black text-emerald-300 mb-2">✨ You’re Going Solar!</h2>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              {signerName ? `Thank you, ${signerName}! ` : ''}ÜYour proposal has been signed & accepted. Your installer will be in touch within 24 hours to schedule your site visit and next steps.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3 flex-wrap">
              <button
                onClick={onDownloadPdf}
                disabled={downloadingPdf}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {downloadingPdf ? (
                  <span className="w-4 h-4 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Download size={15} />
                )}
                {downloadingPdf ? 'Generating…' : 'Save a Copy (PDF)'}
              </button>
              <button
                onClick={onCopyLink}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm font-semibold transition-colors"
              >
                {copiedLink ? <CheckCircle size={15} className="text-emerald-400" /> : <Copy size={15} />}
                {copiedLink ? 'Link Copied!' : 'Share Proposal'}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-slate-700/50 pt-4 pb-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            {branding.companyLogoUrl ? (
              <img src={branding.companyLogoUrl} alt={branding.companyName} className="h-6 object-contain opacity-60" />
            ) : (
              <span className="text-slate-400 font-semibold text-sm">{branding.companyName}</span>
            )}
          </div>
          <div className="flex items-center justify-center gap-4 text-xs text-slate-500 flex-wrap">
            {branding.companyPhone ? (
              <span className="flex items-center gap-1"><Phone size={11} />{branding.companyPhone}</span>
            ) : null}
            {branding.companyWebsite ? (
              <a href={branding.companyWebsite} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-slate-300">
                <ExternalLink size={11} />{branding.companyWebsite.replace(/^https?:\/\//, '')}
              </a>
            ) : null}
            {branding.companyAddress ? (
              <span className="flex items-center gap-1"><MapPin size={11} />{branding.companyAddress}</span>
            ) : null}
          </div>
          {branding.proposalFooterText ? (
            <p className="text-slate-600 text-xs mt-3 max-w-2xl mx-auto">{branding.proposalFooterText}</p>
          ) : null}
          <p className="text-slate-700 text-xs mt-4">
            Powered by SolarPro &middot; Proposal generated {new Date(proposal.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>


      {/* v47.332: PDF Density Optimization Styles */}
      <style>{`
        #proposal-document .proposal-sec {
          margin-bottom: 10px;
        }
        #proposal-document .proposal-sec[data-block-id="hero"] {
          margin-bottom: 8px;
        }
        #proposal-document .proposal-sec .card,
        #proposal-document .proposal-sec.card {
          padding: 14px;
        }
        #proposal-document h2 {
          font-size: 0.95rem;
          margin-bottom: 8px;
        }
        #proposal-document h3 {
          font-size: 0.82rem;
          margin-bottom: 6px;
        }
        @media print {
          #proposal-document .proposal-sec {
            margin-bottom: 8px;
            page-break-inside: avoid;
          }
          #proposal-document {
            padding: 0 !important;
          }
        }
      `}</style>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-content { padding: 0 !important; }
          body { background: white !important; color: black !important; }
        }
      `}</style>
    </div>
  );
}

// ── Page Export (Suspense boundary for useSearchParams) ────────────────────
export default function ProposalViewPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ProposalViewInner />
    </Suspense>
  );
}
