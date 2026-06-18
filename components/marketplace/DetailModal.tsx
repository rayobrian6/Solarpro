"use client";

import React from "react";
import {
  X,
  Sparkles,
  CheckCircle,
  TrendingUp,
  MapPin,
  AlertTriangle,
} from "lucide-react";
import {
  type Opportunity,
  type MarketplaceBadge,
  type MarketplaceBillVisualsProjection,
  type IntelligenceRange,
  type IntelligenceLevel,
  type MarketplaceValueSource,
  fmtKw,
  fmtKwh,
  fmtCurrency,
  fmtRate,
  fmtPct,
  moneyRange,
  sourceLabel,
  intelligenceTone,
  intelligenceBadgeTone,
  confidenceClasses,
  formatDisplayValue,
} from "@/lib/network/marketplaceHelpers";
import {
  RevenueMetric,
  EvidencePanel,
  BillVisualsPanel,
  ContractorEnrichmentDetails,
} from "@/lib/network/marketplaceSharedComponents";

export default function DetailModal({
  opp,
  onClaim,
  onClose,
  isClaimed,
}: {
  opp: Opportunity;
  onClaim: (id: string) => void;
  onClose: () => void;
  isClaimed: boolean;
}) {
  const intelligence = opp.marketplace_intelligence;
  const revenue = intelligence?.revenue;
  const confidence = intelligence?.confidence;
  const evidence = intelligence?.evidence;
  const release = intelligence?.release;
  const narrative = intelligence?.narrative;
  const billVisuals = intelligence?.bill_visuals;
  const revenueProjection = revenue?.projection;
  const purchaseProfile = intelligence?.purchase_profile;
  const purchaseBehavior = intelligence?.purchase_behavior;
  const projectIntelligence = intelligence?.project_value;
  const financing = intelligence?.financing;
  const salesComplexity = intelligence?.sales_complexity;
  const installComplexity = intelligence?.install_complexity;
  const opportunityScore = intelligence?.opportunity_score;
  const experience = intelligence?.experience;
  const revenueItems = [
    {
      label: "Project Value",
      value: revenue?.estimated_project_value
        ? fmtCurrency(revenue.estimated_project_value.value)
        : fmtCurrency(opp.estimated_system_cost),
      accent: "text-emerald-300",
      source: sourceLabel(
        revenue?.estimated_project_value?.source ?? "estimated",
      ),
    },
    {
      label: "System Size",
      value: revenue?.estimated_system_size_kw
        ? fmtKw(revenue.estimated_system_size_kw.value)
        : fmtKw(opp.system_size_kw),
      accent: "text-amber-300",
      source: sourceLabel(
        revenue?.estimated_system_size_kw?.source ?? "estimated",
      ),
    },
    {
      label: "Monthly Bill",
      value: revenue?.monthly_bill_amount
        ? fmtCurrency(revenue.monthly_bill_amount.value)
        : fmtCurrency(opp.monthly_bill_amount ?? null),
      source: sourceLabel(
        revenue?.monthly_bill_amount?.source ?? "homeowner_entered",
      ),
    },
    {
      label: "Annual Usage",
      value: revenue?.annual_usage_kwh
        ? fmtKwh(revenue.annual_usage_kwh.value)
        : fmtKwh(opp.annual_kwh),
      source: sourceLabel(revenue?.annual_usage_kwh?.source ?? "estimated"),
    },
    {
      label: "Utility Rate",
      value: revenue?.utility_rate_per_kwh
        ? fmtRate(revenue.utility_rate_per_kwh.value)
        : fmtRate(opp.utility_rate_per_kwh),
      accent: "text-emerald-300",
      source: sourceLabel(revenue?.utility_rate_per_kwh?.source ?? "estimated"),
    },
    {
      label: "Annual Savings",
      value: revenue?.estimated_annual_savings
        ? fmtCurrency(revenue.estimated_annual_savings.value)
        : fmtCurrency(opp.estimated_annual_savings ?? null),
      source: "Estimated",
    },
    {
      label: "Offset",
      value: revenue?.estimated_offset_pct
        ? fmtPct(revenue.estimated_offset_pct.value)
        : fmtPct(opp.estimated_offset_pct),
      source: "Estimated",
    },
    {
      label: "Payback",
      value: revenue?.estimated_payback_yrs
        ? `${revenue.estimated_payback_yrs.value.toFixed(1)} yrs`
        : opp.estimated_payback_yrs
          ? `${opp.estimated_payback_yrs.toFixed(1)} yrs`
          : "Payback awaiting validation",
      source: "Estimated",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-[#0f1623] border border-slate-700 rounded-3xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">
                <Sparkles size={12} /> Mini deal room
              </div>
              <h2 className="text-white font-black text-2xl leading-tight">
                {narrative?.headline ?? "Opportunity Intelligence"}
              </h2>
              <p className="text-slate-500 text-xs mt-1">
                {opp.city && opp.state_code
                  ? `${opp.city}, ${opp.state_code}`
                  : "Full address revealed after claim"}
              </p>
            </div>
            <div className="flex items-start gap-3">
              {confidence ? (
                <div
                  className={`rounded-2xl border px-3 py-2 text-right ${confidenceClasses(confidence.level)}`}
                >
                  <div className="text-xl font-black tabular-nums">
                    {confidence.score}
                  </div>
                  <div className="text-[9px] font-bold uppercase tracking-widest">
                    {confidence.label}
                  </div>
                </div>
              ) : null}
              <button
                onClick={onClose}
                className="text-slate-500 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {narrative?.summary ? (
            <div className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-4">
              <p className="text-sm leading-relaxed text-slate-200">
                {narrative.summary}
              </p>
              {narrative.bullets.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {narrative.bullets.map((bullet) => (
                    <div
                      key={bullet}
                      className="flex items-start gap-2 text-xs text-slate-300"
                    >
                      <CheckCircle
                        size={12}
                        className="mt-0.5 flex-shrink-0 text-emerald-300"
                      />
                      {bullet}
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="mt-3 text-[10px] text-slate-600">
                {narrative.source_note}
              </p>
            </div>
          ) : null}

          {experience?.deal_attractiveness?.length ? (
            <section className="mb-4 rounded-2xl border border-emerald-400/25 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_36%),rgba(16,185,129,0.08)] p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-emerald-300 text-[10px] uppercase tracking-[0.2em] font-black">
                    Why this deal is attractive
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Canonical acquisition story derived from verified evidence
                    and estimated marketplaceRevenueProjection outputs.
                  </p>
                </div>
                <span className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-200">
                  {experience.liquidity_label}
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {experience.deal_attractiveness.map((reason) => (
                  <div
                    key={reason}
                    className="flex items-start gap-2 rounded-xl border border-slate-800/70 bg-slate-950/30 p-3 text-xs text-slate-200"
                  >
                    <CheckCircle
                      size={13}
                      className="mt-0.5 flex-shrink-0 text-emerald-300"
                    />
                    {reason}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] text-slate-600">
                {experience.source_note}
              </p>
            </section>
          ) : null}

          {experience?.trust_signals?.length ? (
            <section className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/25 p-4">
              <p className="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
                Verified trust system
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {experience.trust_signals.map((signal) => (
                  <div
                    key={signal.label}
                    className={`rounded-xl border p-3 ${signal.verified ? "border-emerald-500/30 bg-emerald-500/10" : "border-slate-800 bg-slate-900/50"}`}
                  >
                    <div
                      className={`text-[10px] font-black uppercase tracking-wider ${signal.verified ? "text-emerald-300" : "text-slate-500"}`}
                    >
                      {signal.label}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {signal.reason}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] text-slate-600">
                {experience.confidence_story}
              </p>
            </section>
          ) : null}

          <section className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-4">
            <p className="text-emerald-300 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
              AI-ranked acquisition snapshot
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <RevenueMetric
                label="Opportunity score"
                value={opportunityScore?.label ?? "Score awaiting validation"}
                source={
                  opportunityScore
                    ? `${opportunityScore.tier} opportunity`
                    : "Requires release and bill evidence"
                }
                accent={
                  opportunityScore
                    ? intelligenceTone(opportunityScore.tier)
                    : "text-slate-500"
                }
              />
              <RevenueMetric
                label="Project value range"
                value={moneyRange(
                  revenueProjection?.project_value_range ??
                    projectIntelligence?.project_value_range,
                  "Project value awaiting validation",
                )}
                source={
                  revenueProjection?.basis ??
                  projectIntelligence?.basis ??
                  "No fake economics shown"
                }
                accent="text-emerald-300"
              />
              <RevenueMetric
                label="Purchase profile"
                value={
                  purchaseProfile?.purchase_method_label ??
                  "Purchase method undetermined"
                }
                source={
                  purchaseProfile?.readiness_label ?? "Qualification pending"
                }
              />
              <RevenueMetric
                label="Urgency"
                value={purchaseProfile?.urgency_label ?? "Timeline pending"}
                source={purchaseProfile?.seriousness_label}
                accent={intelligenceTone(purchaseProfile?.urgency)}
              />
            </div>
            {opportunityScore?.reasons?.length ? (
              <div className="mt-3 grid gap-1.5 text-xs text-emerald-100/80">
                {opportunityScore.reasons.slice(0, 4).map((reason) => (
                  <div key={reason} className="flex items-center gap-2">
                    <CheckCircle size={12} className="text-emerald-300" />{" "}
                    {reason}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <EvidencePanel
            title="Estimated revenue projection"
            subtitle="ESTIMATED only: state pricing assumptions, payment ranges, and opportunity attractiveness. Not a proposal, quote, lender offer, or profit model."
            items={[
              {
                label: "Project Value",
                value: moneyRange(
                  revenueProjection?.project_value_range,
                  "Project value awaiting system size",
                ),
                accent: "text-emerald-300",
              },
              {
                label: "Financed Payment",
                value: moneyRange(
                  revenueProjection?.financed_payment_range,
                  "Financed payment awaiting project value",
                ),
              },
              {
                label: "PPA / Lease Payment",
                value: moneyRange(
                  revenueProjection?.ppa_lease_payment_range,
                  "PPA/lease payment awaiting bill data",
                ),
                accent: "text-blue-300",
              },
              {
                label: "Battery Attachment",
                value: moneyRange(
                  revenueProjection?.battery_attachment_value,
                  "Battery attachment not signaled",
                ),
                accent: "text-amber-300",
              },
              {
                label: "Value With Battery",
                value:
                  revenueProjection?.battery_inclusive_display_label ??
                  "Battery-inclusive range not signaled",
                accent: "text-emerald-300",
              },
              {
                label: "Install Modifier",
                value:
                  revenueProjection?.install_complexity_modifier?.label ??
                  "Install complexity awaiting site validation",
              },
              {
                label: "Gross Opportunity",
                value:
                  revenueProjection?.gross_opportunity_label ??
                  "Opportunity tier awaiting sizing",
                accent: intelligenceTone(
                  revenueProjection?.gross_opportunity_tier,
                ),
              },
              {
                label: "Score Contribution",
                value: revenueProjection
                  ? `${revenueProjection.opportunity_score_contribution}/22 estimated`
                  : "Awaiting revenue projection",
              },
              {
                label: "Pricing Basis",
                value:
                  revenueProjection?.pricing_assumption?.source_label ??
                  "State assumption unavailable",
              },
              {
                label: "Payment Basis",
                value:
                  revenueProjection?.payment_profile_label ??
                  "Payment profile awaiting evidence",
              },
              {
                label: "Payment Replacement",
                value:
                  revenueProjection?.payment_replacement_label ??
                  "Payment replacement awaiting evidence",
                accent: "text-blue-300",
              },
              {
                label: "Utility Arbitrage",
                value:
                  revenueProjection?.utility_arbitrage_label ??
                  "Utility arbitrage awaiting rate evidence",
                accent: "text-amber-300",
              },
            ]}
          />

          {experience?.economic_story?.length ||
          experience?.payment_paths?.length ? (
            <section className="mb-4 rounded-2xl border border-blue-500/20 bg-blue-500/8 p-4">
              <p className="text-blue-300 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
                Economic storytelling + payment paths
              </p>
              {experience?.economic_story?.length ? (
                <div className="mb-3 grid gap-2">
                  {experience.economic_story.map((line) => (
                    <div
                      key={line}
                      className="flex items-start gap-2 text-xs text-slate-200"
                    >
                      <TrendingUp
                        size={12}
                        className="mt-0.5 flex-shrink-0 text-blue-300"
                      />
                      {line}
                    </div>
                  ))}
                </div>
              ) : null}
              {experience?.payment_paths?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {experience.payment_paths.map((path) => (
                    <RevenueMetric
                      key={path.key}
                      label={path.label}
                      value={path.value}
                      source={path.sales_copy}
                      accent={
                        path.tone === "blue"
                          ? "text-blue-300"
                          : path.tone === "amber"
                            ? "text-amber-300"
                            : path.tone === "emerald"
                              ? "text-emerald-300"
                              : undefined
                      }
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <EvidencePanel
            title="Purchase behavior"
            subtitle="Sales/acquisition intelligence only. Behavior tags are not underwriting and must be validated in contractor discovery."
            items={[
              {
                label: "Primary Behavior",
                value:
                  purchaseBehavior?.behavior_label ??
                  "Purchase behavior awaiting evidence",
                accent: intelligenceTone(purchaseBehavior?.confidence),
              },
              {
                label: "Behavior Tags",
                value: purchaseBehavior?.tags?.length
                  ? purchaseBehavior.tags.join(" · ")
                  : "No behavior tags validated yet",
              },
              {
                label: "Sales Fit",
                value: purchaseBehavior
                  ? `${purchaseBehavior.sales_fit_score}/100`
                  : "Sales fit awaiting evidence",
              },
              {
                label: "Closeability",
                value:
                  purchaseBehavior?.closeability_label ??
                  "Closeability awaiting qualification evidence",
              },
            ]}
          />

          <EvidencePanel
            title="Purchase intelligence"
            subtitle="Deterministic purchase-readiness signals from intake, qualification, and operator review only."
            items={[
              {
                label: "Likely Purchase Method",
                value:
                  purchaseProfile?.purchase_method_label ??
                  "Purchase method undetermined",
              },
              {
                label: "Homeowner Seriousness",
                value:
                  purchaseProfile?.seriousness_label ??
                  "Homeowner seriousness awaiting validation",
              },
              {
                label: "Urgency",
                value: purchaseProfile?.urgency_label ?? "Timeline pending",
              },
              {
                label: "Readiness",
                value:
                  purchaseProfile?.readiness_label ?? "Qualification pending",
              },
            ]}
          />

          <EvidencePanel
            title="Financing intelligence"
            subtitle="This is not a credit approval or loan quote; it is a deterministic readiness signal."
            items={[
              {
                label: "Likelihood",
                value:
                  financing?.likelihood_label ??
                  "Financing likelihood awaiting validation",
                accent: intelligenceTone(financing?.likelihood),
              },
              {
                label: "Readiness Score",
                value: financing
                  ? `${financing.score}/100`
                  : "Financing score awaiting validation",
              },
              {
                label: "Payment Path",
                value:
                  financing?.payment_readiness_label ??
                  "Payment path not yet validated",
              },
              {
                label: "Disclaimer",
                value:
                  financing?.disclaimers?.[0] ??
                  "No financing terms are invented.",
              },
            ]}
          />

          <EvidencePanel
            title="Sales and install complexity"
            subtitle="Complexity is derived from known sales, bill, qualification, roof, AHJ, and install signals."
            items={[
              {
                label: "Sales Complexity",
                value:
                  salesComplexity?.label ??
                  "Sales complexity awaiting validation",
                accent: intelligenceTone(salesComplexity?.level),
              },
              {
                label: "Closing Difficulty",
                value:
                  salesComplexity?.closing_difficulty_label ??
                  "Closing difficulty awaiting validation",
              },
              {
                label: "Install Complexity",
                value:
                  installComplexity?.label ??
                  "Install complexity awaiting validation",
                accent: intelligenceTone(installComplexity?.level),
              },
              {
                label: "Profitability",
                value:
                  installComplexity?.profitability_label ??
                  "Profitability awaiting install evidence",
              },
            ]}
          />

          <section className="mb-4">
            <p className="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
              Revenue intelligence
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {revenueItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3"
                >
                  <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">
                    {item.label}
                  </div>
                  <div
                    className={`font-black text-lg tabular-nums ${item.accent ?? "text-white"}`}
                  >
                    {item.value}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-600">
                    {item.source}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {intelligence?.badges?.length ? (
            <section className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/25 p-4">
              <p className="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
                Intelligence badges
              </p>
              <div className="flex flex-wrap gap-2">
                {intelligence.badges.map((badge) => (
                  <span
                    key={`${badge.source}-${badge.label}`}
                    title={badge.reason}
                    className={`px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wide ${intelligenceBadgeTone(badge.tone)}`}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          <EvidencePanel
            title="Homeowner intake"
            subtitle="Homeowner-entered values are shown as their own source and are not overwritten by parsed bill data."
            items={[
              {
                label: "Intake Present",
                value: evidence?.homeowner_intake?.present,
              },
              {
                label: "Monthly Bill",
                value: evidence?.homeowner_intake?.monthly_bill_amount
                  ? fmtCurrency(
                      Number(evidence.homeowner_intake.monthly_bill_amount),
                    )
                  : fmtCurrency(opp.monthly_bill_amount ?? null),
                accent: "text-emerald-300",
              },
              {
                label: "Utility",
                value:
                  evidence?.homeowner_intake?.utility_provider ??
                  opp.utility_name,
              },
              {
                label: "Timeline",
                value: evidence?.homeowner_intake?.timeline ?? opp.timeline,
              },
              {
                label: "Financing Interest",
                value:
                  evidence?.homeowner_intake?.financing_interest ??
                  opp.finance_readiness,
              },
              {
                label: "Source",
                value: evidence?.homeowner_intake?.source ?? "opportunity",
              },
            ]}
          />

          <BillVisualsPanel visuals={billVisuals} />

          <EvidencePanel
            title="Bill intelligence"
            subtitle="Parsed bill values support or challenge intake values, but do not silently replace homeowner-entered truth."
            items={[
              {
                label: "Stored Bill",
                value: evidence?.bill_evidence?.stored_attachment,
              },
              {
                label: "Storage Status",
                value: evidence?.bill_evidence?.storage_status,
              },
              {
                label: "Bill Parsed",
                value: evidence?.parsed_bill?.has_real_parser_output,
              },
              {
                label: "Parsed Utility",
                value: evidence?.parsed_bill?.utility_provider,
              },
              {
                label: "Parsed Annual Usage",
                value: evidence?.parsed_bill?.annual_usage_kwh
                  ? fmtKwh(Number(evidence.parsed_bill.annual_usage_kwh))
                  : "—",
              },
              {
                label: "Parsed Rate",
                value: evidence?.parsed_bill?.utility_rate_per_kwh
                  ? fmtRate(Number(evidence.parsed_bill.utility_rate_per_kwh))
                  : "—",
              },
              {
                label: "Parsed Bill Total",
                value: evidence?.parsed_bill?.total_amount
                  ? fmtCurrency(Number(evidence.parsed_bill.total_amount))
                  : "—",
              },
              { label: "Parsed Source", value: evidence?.parsed_bill?.source },
            ]}
          />

          <EvidencePanel
            title="Qualification and financing"
            items={[
              {
                label: "Lead Grade",
                value: evidence?.qualification?.lead_grade ?? opp.lead_grade,
                accent: "text-amber-300",
              },
              {
                label: "Qualification",
                value:
                  evidence?.qualification?.status ?? opp.qualification_status,
              },
              {
                label: "Finance Ready",
                value:
                  evidence?.qualification?.finance_readiness ??
                  opp.finance_readiness,
              },
              { label: "Income Band", value: opp.estimated_income_band },
              { label: "Credit Band", value: opp.estimated_credit_band },
              { label: "Sunlight", value: opp.sunlight_confidence },
              { label: "Owner Status", value: opp.homeowner_status },
              { label: "Battery Interest", value: opp.battery_interest },
            ]}
          />

          <EvidencePanel
            title="Operator review and release readiness"
            items={[
              {
                label: "Contacted",
                value: evidence?.operator_review?.contacted,
              },
              {
                label: "Qualified",
                value: evidence?.operator_review?.qualified,
              },
              {
                label: "Financing Ready",
                value: evidence?.operator_review?.financing_ready,
              },
              {
                label: "Marketplace Approved",
                value: evidence?.operator_review?.approved_for_marketplace,
              },
              {
                label: "Screening Approved",
                value: evidence?.screening?.approved,
              },
              {
                label: "Release Gate",
                value: release
                  ? release.ok
                    ? "Passed"
                    : "Warnings / blockers"
                  : "—",
                accent: release?.ok ? "text-emerald-300" : "text-amber-300",
              },
              { label: "Claim Mode", value: opp.claim_mode ?? "—" },
              {
                label: "Claim Capacity",
                value: opp.max_claims
                  ? `${opp.claim_count ?? 0}/${opp.max_claims}`
                  : "—",
              },
            ]}
          />

          {release?.warnings?.length ||
          release?.blockers?.length ||
          confidence?.warnings?.length ? (
            <section className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
              <p className="text-amber-300 text-[10px] uppercase tracking-[0.2em] font-black mb-3">
                Evidence warnings
              </p>
              <div className="space-y-1.5">
                {[
                  ...(release?.warnings ?? []),
                  ...(release?.blockers ?? []),
                  ...(confidence?.warnings ?? []),
                ]
                  .slice(0, 8)
                  .map((warning) => (
                    <div
                      key={warning}
                      className="text-xs text-amber-100/80 flex items-center gap-2"
                    >
                      <AlertTriangle size={12} className="text-amber-300" />
                      {formatDisplayValue(warning)}
                    </div>
                  ))}
              </div>
            </section>
          ) : null}

          <EvidencePanel
            title="Roof and fit signals"
            items={[
              { label: "Material", value: opp.roof_material },
              {
                label: "Pitch",
                value: opp.roof_pitch,
                accent: opp.steep_roof ? "text-rose-300" : undefined,
              },
              { label: "Condition", value: opp.roof_condition },
              {
                label: "Age",
                value: opp.roof_age_years ? `${opp.roof_age_years} yrs` : "—",
              },
              { label: "Structure", value: opp.structure_type },
              {
                label: "Usable Roof",
                value: opp.usable_roof_pct ? `${opp.usable_roof_pct}%` : "—",
              },
              { label: "Battery Candidate", value: opp.battery_candidate },
              {
                label: "Complex AHJ",
                value: opp.complex_ahj ? opp.ahj_name || "Yes" : false,
              },
            ]}
          />

          <ContractorEnrichmentDetails opp={opp} />

          {opp.address ? (
            <section className="mb-5">
              <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-2">
                Full Address
              </p>
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-emerald-400 font-medium text-sm">
                <MapPin size={13} />
                {opp.address}
              </div>
            </section>
          ) : null}

          {opp.listing_notes ? (
            <section className="mb-5">
              <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-2">
                Notes
              </p>
              <p className="text-slate-300 text-sm italic bg-slate-800/50 rounded-lg p-3">
                &quot;{opp.listing_notes}&quot;
              </p>
            </section>
          ) : null}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
            >
              Close
            </button>
            {!isClaimed ? (
              <button
                onClick={() => {
                  onClose();
                  onClaim(opp.id);
                }}
                className="flex-1 py-2.5 text-sm font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle size={15} />{" "}
                {opp.claim_mode === "shared"
                  ? "Pay & Claim Shared Lead"
                  : opp.claim_mode === "exclusive"
                    ? "Pay & Claim Exclusively"
                    : "Pay & Claim Lead"}
              </button>
            ) : (
              <span className="flex-1 py-2.5 text-sm font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center gap-2">
                <CheckCircle size={15} />{" "}
                {opp.claim_mode === "shared"
                  ? "Claimed by You"
                  : opp.claim_mode === "exclusive"
                    ? "You Own This"
                    : "Claimed by You"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Profile Tab ─────────────────────────────────────────────────────────────
