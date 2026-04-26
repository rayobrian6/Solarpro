'use client';
import React, { useEffect, useState, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { Proposal } from '@/types';
import {
  Sun, Zap, DollarSign, Leaf, TrendingUp, Shield,
  Star, Phone, Mail, MapPin, Calendar, Award,
  ChevronRight, BarChart2, Home, Sprout, Fence,
  Percent, Tag, Download, Printer, CheckCircle,
  XCircle, Clock, AlertTriangle, ExternalLink, Info
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine
} from 'recharts';
import { resolveEquipment, getSystemTypeLabel, getSystemDescription } from '@/lib/systemEquipmentResolver';
import { calculateIncentives } from '@/lib/incentives/stateIncentives';
import { buildArraysFromLayout, buildSystemConfig, getArrayProposalText } from '@/lib/multiArrayEngine';
import { resolveProposalSystemType, getPanelTypeCounts } from '@/lib/proposalSystemType';
import {
  buildUtilityProfile,
  validateProposalTruth,
  validatePanelIntegrity,
  getFailsafeMessage,
  calculateRemainingUtility,
} from '@/lib/proposalTruthEngine';
import { buildCanonicalProposal } from '@/lib/proposal/buildCanonicalProposal';
import { deriveEcosystemSummary } from '@/lib/proposal/deriveEcosystemSummary';
import {
  GLOBAL_INCENTIVES_CONFIG,
  getIncentivesComplianceMessage,
  getIncentivesNotIncludedNotice,
  getIncentivesDebugLabel,
} from '@/lib/incentivesConfig';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Section 12: validateProposalTruth imported from lib/proposalTruthEngine.ts
// (replaces local validateProposalFinancials — 6-assertion engine, dev-mode strict)

// ── Inner component (uses useSearchParams) ─────────────────────────────────
function ProposalViewInner() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [proposal, setProposal] = useState<Proposal | null>(null);
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
    setAccepting(true);
    try {
      const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
      await fetch(`/api/proposals/${proposal.id}${tokenQuery}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' }),
      });
      setAccepted(true);
    } catch {
      setAccepted(true);
    } finally {
      setAccepting(false);
    }
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

  return <PublicProposalView
    proposal={proposal}
    branding={branding}
    pricingCfg={pricingCfg}
    accepted={accepted}
    accepting={accepting}
    onAccept={handleAccept}
  />;
}

// ── Public Proposal View ───────────────────────────────────────────────────
function PublicProposalView({
  proposal, branding, pricingCfg, accepted, accepting, onAccept
}: {
  proposal: Proposal;
  branding: any;
  pricingCfg: any;
  accepted: boolean;
  accepting: boolean;
  onAccept: () => void;
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
  const projectStateCode = ((proj as any)?.stateCode || client?.state || '').toUpperCase().trim().slice(0, 2);
  const isCommercial = pricingCfg?.isCommercial ?? false;

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
    // v48.4: Tier 1 — direct bill-extracted rate (primary: enriched, fallback: raw OCR)
    parsedBillRate:      (proj as any)?.billData?._utilityRatePerKwh
                           ?? (proj as any)?.billData?.electricityRate
                           ?? undefined,
    utilityRateOverride: (proj as any)?.utilityRatePerKwh,
    clientUtilityRate:   client?.utilityRate,
    dbUtilityRate:       proposal.dbUtilityRate ?? undefined,
    annualUsageKwh:      client?.annualKwh ?? 0,

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
  });

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
  const net_financial_difference_25yr = cp.truth25yr.netFinancialDifference;
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
  const DISPLAY_INCENTIVE_TYPES = ['state_tax_credit', 'state_rebate', 'utility_rebate', 'performance_payment'];
  const stateIncentives = incentiveCalc ? {
    stateIncentives: incentiveCalc.state
      .filter((s: any) => DISPLAY_INCENTIVE_TYPES.includes(s.type))
      .map((s: any) => ({ ...s, name: s.incentiveName, isCash: true })),
    cashTotal: incentiveCalc.cashTotal,
    netSystemCost: incentiveCalc.netSystemCost,
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
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 text-xs transition-colors"
            >
              <Printer size={12} /> Print
            </button>
            {!accepted && (
              <button
                onClick={onAccept}
                disabled={accepting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-slate-900 font-semibold text-xs transition-all"
                style={{ background: primaryColor }}
              >
                {accepting ? (
                  <span className="w-3 h-3 border border-slate-900 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <CheckCircle size={13} />
                )}
                Accept Proposal
              </button>
            )}
            {accepted && (
              <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
                <CheckCircle size={13} /> Accepted!
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Accepted Banner ── */}
      {accepted && (
        <div className="bg-emerald-500/10 border-b border-emerald-500/20 py-4 no-print">
          <div className="max-w-5xl mx-auto px-4 flex items-center gap-3">
            <CheckCircle size={20} className="text-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-emerald-300 font-semibold text-sm">Proposal Accepted!</p>
              <p className="text-emerald-400/70 text-xs mt-0.5">Your installer has been notified and will be in touch shortly to schedule next steps.</p>
            </div>
          </div>
        </div>
      )}

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
                {client && (
                  <p className="text-slate-400 text-sm">
                    Prepared for <span className="text-white font-medium">{client.name}</span>
                    {client.address && <span> &middot; {client.address}, {client.city}, {client.state}</span>}
                  </p>
                )}
                <p className="text-slate-500 text-xs mt-1 flex items-center gap-1">
                  <Calendar size={11} />
                  {new Date(proposal.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              {systemSizeKw > 0 && (
                <div className="text-right">
                  <div className="text-3xl font-black" style={{ color: primaryColor }}>{systemSizeKw.toFixed(1)}</div>
                  <div className="text-slate-400 text-sm font-medium">kW System</div>
                  {totalPanels > 0 && <div className="text-slate-500 text-xs mt-1">{totalPanels} panels</div>}
                </div>
              )}
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
            {systemDescription && (
              <div className="mt-2 px-3 py-2 rounded-lg border border-slate-700/40 bg-slate-800/30">
                <p className="text-slate-500 text-xs leading-snug">
                  <span className="font-semibold text-slate-400">System: </span>
                  {systemDescription}
                </p>
              </div>
            )}

            {/* Section 7: Fence system production disclaimer */}
            {isFenceSystem && (
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
            )}

            {/* ═══ v47.333: POWER PAGE — Inline Financial Framing ═══ */}
            {effectiveFinal > 0 && (
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
                      {purchaseMode === 'finance' ? `${financeTermYears}-yr loan` : 'One-time cost'} — you own the energy
                    </div>
                  </div>
                </div>

                {/* Payment Shift — compact single row */}
                {purchaseMode === 'finance' && solar_payment_monthly > 0 && avgMonthlyBillBefore > 0 && (
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
                        <div className="text-xs text-slate-400">Toward Ownership</div>
                        <div className="text-lg font-black" style={{ color: primaryColor }}>
                          ${ownership_delta_monthly > 0 ? `$${ownership_delta_monthly}` : `$${Math.abs(ownership_delta_monthly)}`}/mo
                        </div>
                      </div>
                    </div>
                    {ownership_delta_monthly > 0 && (
                      <p className="text-xs text-slate-500 mt-1.5 text-center">
                        Redirecting ${ownership_delta_monthly}/mo from utility expense toward energy ownership. Fixed payment — utility rates keep rising.
                      </p>
                    )}
                    {ownership_delta_monthly <= 0 && (
                      <p className="text-xs text-emerald-400/70 mt-1.5 text-center">
                        Immediate monthly savings of ${Math.abs(ownership_delta_monthly)}/mo — and it grows as utility rates increase.
                      </p>
                    )}
                  </div>
                )}

                {/* Cash mode — simple net advantage */}
                {purchaseMode === 'cash' && effectiveFinal > 0 && net_financial_difference_25yr !== 0 && (
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
                )}
              </div>
            )}

          </div>
        </div>

        {/* Section 13: Failsafe message — shown when utility data is unavailable */}
        {failsafeMessage && (
          <div className="proposal-sec rounded-xl p-4 border border-slate-600/30 bg-slate-800/20" data-block-id="failsafe">
            <div className="flex items-start gap-2">
              <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
              <p className="text-slate-400 text-xs leading-relaxed">{failsafeMessage}</p>
            </div>
          </div>
        )}

        {/* Section 5: Energy Policy Outlook — shown only when policy_effect is at_risk or changing */}
        {utilityProfile.policy_message && (
          <div className="proposal-sec rounded-xl p-4 border border-amber-500/20 bg-amber-500/5" data-block-id="energy-policy">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-300 text-xs font-semibold mb-1">Energy Policy Outlook</p>
                <p className="text-amber-300/80 text-xs leading-relaxed">{utilityProfile.policy_message}</p>
              </div>
            </div>
          </div>
        )}

        {/* Investment Section */}
        {effectiveFinal > 0 && (
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
                  {mode === 'finance' ? '\u26a1 Finance' : '\ud83d\udcb5 Cash'}
                </button>
              ))}
            </div>

            {purchaseMode === 'finance' ? (
              // ── Section 2: Finance mode — monthly cost truth panel ────────
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="md:col-span-1 rounded-xl p-3 border" style={{ background: `${primaryColor}10`, borderColor: `${primaryColor}30` }}>
                  <div className="text-xs text-slate-400 mb-1">Solar Loan Payment</div>
                  <div className="text-3xl font-black" style={{ color: primaryColor }}>
                    ${solar_payment_monthly > 0 ? solar_payment_monthly.toLocaleString() : '\u2014'}/mo
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{financeTermYears}-yr loan at {((pricingCfg?.loanApr ?? 7.99)).toFixed(2)}% APR</div>

                  {/* Section 2: Monthly cost breakdown — factual, not misleading */}
                  {solar_payment_monthly > 0 && avgMonthlyBillBefore > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-700/40 space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Solar payment</span>
                        <span className="text-white font-medium">${solar_payment_monthly}/mo</span>
                      </div>
                      {remaining_utility_monthly > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Est. remaining utility</span>
                          <span className="text-white font-medium">${remaining_utility_monthly}/mo</span>
                        </div>
                      )}
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
                      {ownership_delta_monthly > 0 && (
                        <p className="text-xs text-slate-500 pt-0.5">
                          Initial monthly difference. As utility rates rise, your solar payment stays fixed.
                        </p>
                      )}
                      {ownership_delta_monthly > 0 && (
                        <p className="text-xs text-slate-500 pt-0.5">
                          ${ownership_delta_monthly}/mo is being redirected toward energy ownership rather than utility expense.
                        </p>
                      )}
                    </div>
                  )}
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
        )}

        {/* v47.251: Incentives compliance notice — content driven by GLOBAL_INCENTIVES_CONFIG */}
        <div className="proposal-sec card p-3 border border-slate-700/30" data-block-id="incentives-notice">
          <div className="flex items-start gap-2">
            <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-slate-400 text-xs leading-relaxed">
                {getIncentivesComplianceMessage()}
              </p>
              {process.env.NODE_ENV === 'development' && (
                <p className="text-amber-500 text-xs mt-1 font-mono">
                  [{getIncentivesDebugLabel()}]
                </p>
              )}
            </div>
          </div>
        </div>

        {/* State Incentives — gated by GLOBAL_INCENTIVES_CONFIG.allow_state_incentives (v47.251) */}
        {GLOBAL_INCENTIVES_CONFIG.allow_state_incentives && stateIncentives && stateIncentives.stateIncentives.length > 0 && (
          <div className="proposal-sec card p-4" data-block-id="incentives-srec">
            <h2 className="text-base font-black text-white mb-3 flex items-center gap-2">
              <Award size={18} style={{ color: primaryColor }} /> Available Incentives
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {stateIncentives.stateIncentives.map((inc: any, i: number) => (
                <div key={i} className="rounded-xl p-4 border bg-emerald-500/5 border-emerald-500/20">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{inc.name}</div>
                      {inc.description && <div className="text-xs text-slate-400 mt-1">{inc.description}</div>}
                    </div>
                    <div className="text-sm font-black flex-shrink-0 text-emerald-400">
                      {inc.calculatedValue > 0 ? `$${Math.round(inc.calculatedValue).toLocaleString()}` : 'Eligible'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
            {cp.utility.netMeteringType !== 'none' && cp.utility.export_rate_monthly !== null && (
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
            )}

            {/* Annual true-up excess rate */}
            {cp.utility.true_up_period === 'annual' && cp.utility.export_rate_annual_excess !== null && (
              <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-700/40">
                <div>
                  <span className="text-xs text-slate-400 font-medium">Annual True-Up Excess</span>
                  <p className="text-xs text-slate-500 mt-0.5">Net surplus kWh settled at year-end</p>
                </div>
                <span className="text-xs text-amber-400 font-bold">
                  ${cp.utility.export_rate_annual_excess.toFixed(3)}/kWh
                </span>
              </div>
            )}

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
           cp.utility.export_rate_monthly < cp.utility.rate && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs text-amber-300 font-semibold mb-1">Not all energy is valued equally.</p>
              <p className="text-xs text-amber-200/80 leading-relaxed">
                Energy used directly in your home offsets electricity at full retail value
                (${cp.utility.rate.toFixed(3)}/kWh), while excess energy exported to the grid
                is compensated at a lower rate (${(cp.utility.export_rate_monthly ?? 0).toFixed(3)}/kWh).
                Maximizing self-consumption gives your solar system its best financial return.
              </p>
            </div>
          )}

          {/* System design guidance for non-retail_1to1 */}
          {cp.utility.netMeteringType !== 'retail_1to1' && (
            <div className="mt-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/30">
              <p className="text-xs text-slate-400 font-medium">System Design Guidance</p>
              <p className="text-xs text-slate-300 mt-1">{utilityProfile.system_design_guidance}</p>
            </div>
          )}

          {!utilityProfile.is_specific_match && (
            <p className="text-xs text-slate-500 mt-2 italic">
              * Based on {utilityProfile.profile.state || 'state'}-level utility data.
              Verify specific net metering terms with your utility.
            </p>
          )}
        </div>

        {/* v47.254: Energy Value Breakdown — Task 3+4+6 */}
        {/* Source: cp.financial.energyValueBreakdown (identity map from yearlyFlow[0]) */}
        {energyValueBreakdown.total > 0 && (
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
              {energyValueBreakdown.exported > 0 && (
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
              )}

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
            {payoffYear && (
              <div className="mt-4 pt-3 border-t border-slate-700/40 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-slate-300">System Payoff</div>
                  <div className="text-xs text-slate-500 mt-0.5">When cumulative energy value produced ≥ system cost</div>
                </div>
                <div className="text-base font-black text-blue-400">Year {payoffYear}</div>
              </div>
            )}
          </div>
        )}

        {/* Section 4: SREC Program — shown only when srec_available */}
        {utilityProfile.profile.srec_available && utilityProfile.srec_summary && (
          <div className="proposal-sec card p-5 border border-emerald-500/20" data-block-id="srec">
            <h3 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
              <Award size={15} className="text-emerald-400" /> Solar Performance Credits (SREC)
            </h3>
            <p className="text-slate-300 text-sm leading-relaxed">
              {utilityProfile.srec_summary}
            </p>
          </div>
        )}

        {/* Production + Monthly Bill Chart */}
        {production && mounted && (
          <div className="proposal-sec grid grid-cols-1 lg:grid-cols-2 gap-3" data-block-id="system-summary" data-keep-together="true">
            {/* Monthly Production */}
            <div className="card p-5">
              <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
                <Sun size={15} style={{ color: primaryColor }} /> Monthly Solar Production
              </h3>
              <div className="flex items-end gap-1 h-20 mb-1">
                {cp.production.monthlyKwh.map((kwh, i) => {
                  const max = Math.max(...cp.production.monthlyKwh, 1);
                  const pct = (kwh / max) * 100;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t-sm transition-all"
                        style={{ height: `${pct}%`, background: `${primaryColor}cc` }}
                        title={`${MONTHS[i]}: ${kwh.toLocaleString()} kWh`}
                      />
                      <span className="text-xs text-slate-500">{MONTHS[i].slice(0,1)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="text-center text-xs text-slate-400 mt-1">
                {annualProduction.toLocaleString()} kWh / year total
              </div>
            </div>

            {/* Monthly Bill Before/After */}
            <div className="card p-5">
              <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
                <DollarSign size={15} className="text-emerald-400" /> Monthly Bill: Before vs After Solar
              </h3>
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={monthlyBillData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v}`, '']} />
                  <Bar dataKey="before" fill="#ef4444" radius={[3, 3, 0, 0]} name="Before Solar" opacity={0.6} />
                  <Bar dataKey="after" fill="#22c55e" radius={[3, 3, 0, 0]} name="After Solar" opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Section 8: Offset messaging — shown when offset < 100% */}
        {energyOffset > 0 && energyOffset < 100 && (
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
        )}

        {/* v47.256: Your Savings Over Time — single green savings curve */}
        {/* Source: projectionData[i].cumulative = cumulative_without_solar - cumulative_with_solar (read-only) */}
        {annualProduction > 0 && mounted && projectionData.length > 0 && (
          <div className="proposal-sec card p-3" data-block-id="financial-timeline" data-keep-together="true">
            {/* Title */}
            <div className="flex items-start justify-between gap-4 mb-3">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <TrendingUp size={15} style={{ color: primaryColor }} /> Your Savings Over Time
              </h3>
              {/* Final savings callout — Task 3 */}
              {netDifference_25yr > 0 && (
                <div className="text-right flex-shrink-0">
                  <div className="text-xl font-black text-emerald-400">
                    +${Math.round(netDifference_25yr).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-500">total est. savings</div>
                </div>
              )}
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
                {payoffYear && (
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
                )}
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
        )}

        {/* v47.255: 25-Year Financial Summary — Task 7: de-emphasized large numbers, reordered for clarity */}
        {annualProduction > 0 && utility_cost_25yr > 0 && (
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
                  {purchaseMode === 'finance' ? `${financeTermYears}-yr loan total` : 'One-time cash purchase'}
                </div>
              </div>

              {/* Remaining utility cost */}
              <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                <div className="text-xs text-slate-500 mb-1">Est. Remaining Utility Bills</div>
                <div className="text-lg font-black text-slate-300">${remaining_utility_cost_total > 0 ? remaining_utility_cost_total.toLocaleString() : '0'}</div>
                <div className="text-xs text-slate-500 mt-1">{energyOffset}% offset — {100 - energyOffset}% still from grid</div>
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
        )}

        {/* v47.254: Task 2 — Financial Narrative section (from cp._meta.narrative) */}
        {narrative && narrative.fullNarrative && (
          <div className="proposal-sec card p-3" data-block-id="why-this-system" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)' }}>
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <TrendingUp size={15} style={{ color: primaryColor }} /> Your Financial Story
            </h3>
            <div className="space-y-2">
              {narrative.primaryStory && (
                <p className="text-slate-200 text-sm leading-relaxed">{narrative.primaryStory}</p>
              )}
              {narrative.monthlyImpact && (
                <p className="text-slate-300 text-sm leading-relaxed">{narrative.monthlyImpact}</p>
              )}
              {narrative.payoffStatement && (
                <p className="text-slate-300 text-sm leading-relaxed">{narrative.payoffStatement}</p>
              )}
              {narrative.outcomeStatement && (
                <p className="text-slate-200 text-sm leading-relaxed font-medium">{narrative.outcomeStatement}</p>
              )}
            </div>
          </div>
        )}

        {/* Section 6: Assumptions Block ── */}
        {(annualProduction > 0 || effectiveFinal > 0) && (
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
                  {a.note && <div className="text-slate-500 text-xs mt-0.5">{a.note}</div>}
                </div>
              ))}
            </div>
            <p className="text-slate-600 text-xs mt-4">
              All financial projections are estimates based on the assumptions above and are not guaranteed.
              Actual production, savings, and costs will vary. This proposal does not constitute tax advice.
              {' '}{getIncentivesComplianceMessage()}
            </p>
          </div>
        )}

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
              {resolvedPanelWattage > 0 && (
                <div className="text-xs text-slate-400 mt-1">{resolvedPanelWattage}W per panel</div>
              )}
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
              {(proj as any)?.selectedInverter?.efficiency && (
                <div className="text-xs text-slate-400 mt-1">{((proj as any).selectedInverter.efficiency * 100).toFixed(1)}% efficiency</div>
              )}
              <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                <CheckCircle size={10} /> 25-yr warranty
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
              {equipment.racking?.tiltRange && (
                <div className="text-xs text-slate-400 mt-1">{equipment.racking.tiltRange}</div>
              )}
              <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                <CheckCircle size={10} /> {equipment.racking?.warranty || '25-yr structural warranty'}
              </div>
            </div>
          </div>
        </div>

        {/* Why Solar / Trust section */}
        <div className="proposal-sec grid grid-cols-1 md:grid-cols-3 gap-2" data-block-id="trust-performance">
          {[
            { icon: <Shield size={20} />, title: '25-Year Warranty', desc: 'Full coverage on panels, inverter, and mounting system for complete peace of mind.' },
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

        {/* CTA */}
        {!accepted && (
          <div className="proposal-sec rounded-2xl p-5 text-center border" data-block-id="cta" data-keep-together="true" style={{ background: `${primaryColor}08`, borderColor: `${primaryColor}25` }}>
            <h2 className="text-xl font-black text-white mb-1">Ready to Go Solar?</h2>
            <p className="text-slate-400 text-sm mb-4 max-w-md mx-auto">
              Accept this proposal to get started. Your installer will contact you within 24 hours to schedule next steps.
            </p>
            <button
              onClick={onAccept}
              disabled={accepting}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-slate-900 font-black text-base transition-all hover:opacity-90 active:scale-95"
              style={{ background: primaryColor }}
            >
              {accepting ? (
                <span className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
              ) : (
                <CheckCircle size={20} />
              )}
              Accept This Proposal
            </button>
            <p className="text-slate-500 text-xs mt-4">No commitment required &mdash; accepting just notifies your installer.</p>
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
            {branding.companyPhone && (
              <span className="flex items-center gap-1"><Phone size={11} />{branding.companyPhone}</span>
            )}
            {branding.companyWebsite && (
              <a href={branding.companyWebsite} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-slate-300">
                <ExternalLink size={11} />{branding.companyWebsite.replace(/^https?:\/\//, '')}
              </a>
            )}
            {branding.companyAddress && (
              <span className="flex items-center gap-1"><MapPin size={11} />{branding.companyAddress}</span>
            )}
          </div>
          {branding.proposalFooterText && (
            <p className="text-slate-600 text-xs mt-3 max-w-2xl mx-auto">{branding.proposalFooterText}</p>
          )}
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
