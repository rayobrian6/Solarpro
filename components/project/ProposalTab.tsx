'use client';
import React, { useEffect, useState } from 'react';
import {
  FileText, Send, Eye, Download, CheckCircle, Clock, XCircle,
  ArrowRight, AlertTriangle, DollarSign, Loader2, Sparkles, ExternalLink,
  ShieldOff, Home, ChevronRight,
} from 'lucide-react';
import {
  GLOBAL_INCENTIVES_CONFIG,
  getIncentivesDebugLabel,
} from '@/lib/incentivesConfig';
import type { Project, Proposal } from '@/types';
import Link from 'next/link';

interface ProposalTabProps {
  project: Project;
}

const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  draft:    { icon: <Clock size={14} />,       label: 'Draft',    color: 'text-slate-400',   bg: 'bg-slate-500/10 border-slate-500/20' },
  sent:     { icon: <Send size={14} />,        label: 'Sent',     color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20' },
  accepted: { icon: <CheckCircle size={14} />, label: 'Accepted', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  rejected: { icon: <XCircle size={14} />,     label: 'Rejected', color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20' },
};

export default function ProposalTab({ project }: ProposalTabProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);

  // Inline generation state
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [newProposal, setNewProposal] = useState<Proposal | null>(null);
  // v47.251: noItc state retained for API compatibility (passed to proposal generator)
  // but the ITC toggle UI is removed — global config governs incentive display.
  // When GLOBAL_INCENTIVES_CONFIG.allow_itc=false, noItc is effectively always true.
  const noItc = !GLOBAL_INCENTIVES_CONFIG.allow_itc || (project.noItc ?? false);

  useEffect(() => {
    fetch(`/api/proposals?projectId=${project.id}`)
      .then(r => r.json())
      .then(data => {
        setProposals(Array.isArray(data) ? data : (data.data || data.proposals || []));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [project.id]);

  const hasDesign = !!project.layout;
  const hasBill = !!project.billAnalysis;
  const canGenerate = hasDesign && hasBill;

  // FIX v47.225: Financial summary MUST come from the frozen proposal snapshot,
  // not from live project.costEstimate — which may have changed since the proposal was generated.
  // Priority: latestProposal snapshot → project.costEstimate (legacy fallback)
  const allProposals = [...proposals, ...(newProposal ? [newProposal] : [])];
  const latestProposal = allProposals.length > 0
    ? allProposals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    : null;
  const snapshotProject = latestProposal?.project;
  const cost = snapshotProject?.costEstimate ?? project.costEstimate;
  const snapshotLayout = snapshotProject?.layout ?? project.layout;
  const snapshotProduction = snapshotProject?.production ?? project.production;

  // Debug log — shows data source for financial summary
  if (typeof window !== 'undefined' && latestProposal) {
    console.log('[ProposalTab] Financial summary source:', {
      proposalId: latestProposal.id,
      snapshotAt: latestProposal.snapshotAt ?? 'none (legacy)',
      usingSnapshot: !!snapshotProject?.costEstimate,
      grossCost: cost?.grossCost,
      annualSavings: cost?.annualSavings,
      panelCount: snapshotLayout?.totalPanels,
      systemSizeKw: snapshotLayout?.systemSizeKw,
    });
  }

  // v47.251: handleToggleNoItc removed — ITC toggle replaced by global config.
  // ITC is now governed exclusively by GLOBAL_INCENTIVES_CONFIG.allow_itc (default: false).

  async function handleGenerate() {
    if (!canGenerate || generating) return;
    setGenerating(true);
    setGenError(null);
    setNewProposal(null);

    // Fetch branding so we can pass preparedBy (company name) to the proposal
    let preparedBy: string | undefined;
    try {
      const brandRes = await fetch('/api/settings/branding');
      const brandJson = await brandRes.json();
      if (brandJson.success && brandJson.data?.companyName) {
        preparedBy = brandJson.data.companyName;
      }
    } catch {
      // Non-fatal — proposal will use fallback company name
    }

    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, ...(preparedBy ? { preparedBy } : {}) }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setGenError(json.error || 'Failed to generate proposal. Please try again.');
        return;
      }

      const created: Proposal = json.data;
      setNewProposal(created);
      // Prepend to the proposals list so it shows immediately
      setProposals(prev => [created, ...prev]);
    } catch {
      setGenError('Network error — please check your connection and try again.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-5">

      {/* Readiness check */}
      {!canGenerate ? (
        <div className="card p-4 border border-amber-500/20 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-amber-300 mb-1">Proposal Not Ready</div>
              <div className="text-xs text-slate-400 space-y-0.5">
                {!hasBill && <div>&bull; Upload a utility bill to get usage data and financials</div>}
                {!hasDesign && <div>&bull; Complete a design in Design Studio to get system specs</div>}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Financial summary — sourced from latest proposal snapshot (v47.225) */}
      {cost ? (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <DollarSign size={14} className="text-emerald-400" /> Financial Summary
            </h4>
            {latestProposal ? (
              <span className="text-xs text-slate-500">
                {latestProposal.snapshotAt
                  ? `From proposal \u00b7 ${new Date(latestProposal.snapshotAt).toLocaleDateString()}`
                  : 'From latest proposal'}
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              // Section 1: "System Cost" not "Net Cost" — no ITC deduction implied
              { label: 'System Cost',     value: `$${cost.grossCost.toLocaleString()}`,          color: 'text-amber-400' },
              // Section 4: "Annual Energy Value" not "Annual Savings"
              { label: 'Annual Energy Value', value: `$${cost.annualSavings.toLocaleString()}/yr`, color: 'text-emerald-400' },
              { label: 'Payback Period',  value: `${cost.paybackYears} years`,                    color: 'text-blue-400' },
              // Section 4: "Est. 25-Yr Energy Value" not "25-yr Savings"
              { label: 'Est. 25-Yr Energy Value', value: `$${cost.lifetimeSavings.toLocaleString()}`, color: 'text-emerald-400' },
            ].map(m => (
              <div key={m.label} className="bg-slate-800/60 rounded-xl p-3 text-center">
                <div className="text-xs text-slate-400 mb-1">{m.label}</div>
                <div className={`text-lg font-bold ${m.color}`}>{m.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between p-2 bg-slate-800/40 rounded-lg">
              <span className="text-slate-400">Gross Cost</span>
              <span className="text-white">${cost.grossCost.toLocaleString()}</span>
            </div>
            {/* Section 1: Removed "Tax Credit (30%)" row — federal ITC not displayed */}
            <div className="flex justify-between p-2 bg-slate-800/40 rounded-lg">
              <span className="text-slate-400">ROI</span>
              <span className="text-emerald-400">{cost.roi}%</span>
            </div>
          </div>
          {/* System snapshot summary */}
          {(snapshotLayout || snapshotProduction) ? (
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              {snapshotLayout?.systemSizeKw && snapshotLayout.systemSizeKw > 0 ? (
                <div className="flex justify-between p-2 bg-slate-800/40 rounded-lg">
                  <span className="text-slate-400">System Size</span>
                  <span className="text-white">{snapshotLayout.systemSizeKw.toFixed(2)} kW</span>
                </div>
              ) : null}
              {snapshotLayout?.totalPanels && snapshotLayout.totalPanels > 0 ? (
                <div className="flex justify-between p-2 bg-slate-800/40 rounded-lg">
                  <span className="text-slate-400">Panel Count</span>
                  <span className="text-white">{snapshotLayout.totalPanels} panels</span>
                </div>
              ) : null}
              {snapshotProduction?.annualProductionKwh && snapshotProduction.annualProductionKwh > 0 ? (
                <div className="flex justify-between p-2 bg-slate-800/40 rounded-lg">
                  <span className="text-slate-400">Annual Production</span>
                  <span className="text-white">{snapshotProduction.annualProductionKwh.toLocaleString()} kWh</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* v47.251: Incentives Status — controlled by global config, no per-project toggle */}
      <div className="card p-4 flex items-start gap-3">
        <ShieldOff size={16} className="text-slate-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">
            Incentives Not Included
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Tax incentives are not included in this proposal. Consult a tax professional for eligibility.
          </p>
          {/* Dev mode: show global config label */}
          {process.env.NODE_ENV === 'development' ? (
            <p className="text-xs text-amber-500 mt-1 font-mono">
              [{getIncentivesDebugLabel()}]
            </p>
          ) : null}
        </div>
      </div>

      {/* Generate proposal CTA */}
      <div className="card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h4 className="text-sm font-semibold text-white mb-1">Generate Proposal</h4>
            <p className="text-xs text-slate-400">
              Create a professional proposal with system specs, financials, and environmental impact.
            </p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || generating}
            className={`btn-sm flex items-center gap-2 ${
              canGenerate && !generating
                ? 'btn-primary'
                : 'btn-secondary opacity-60 cursor-not-allowed'
            }`}
          >
            {generating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generating&hellip;
              </>
            ) : (
              <>
                <Sparkles size={14} /> Generate Proposal
              </>
            )}
          </button>
        </div>

        {/* Error banner */}
        {genError ? (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{genError}</p>
          </div>
        ) : null}

        {/* Success banner */}
        {newProposal && !genError ? (
          <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-emerald-300">Proposal created successfully!</p>
              <p className="text-xs text-slate-400 truncate mt-0.5">{newProposal.title}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {newProposal.shareToken ? (
                <a
                  href={`/proposals/view/${newProposal.id}?token=${newProposal.shareToken}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-sm btn-primary flex items-center gap-1.5 text-xs"
                >
                  <Eye size={12} /> Preview <ExternalLink size={11} />
                </a>
              ) : null}
              <Link
                href={`/proposals`}
                className="btn-sm btn-secondary flex items-center gap-1.5 text-xs"
              >
                All Proposals <ArrowRight size={11} />
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      {/* Existing proposals */}
      {loading ? (
        <div className="card p-6 flex items-center justify-center">
          <div className="spinner w-6 h-6" />
        </div>
      ) : proposals.length > 0 ? (
        <div className="card p-5">
          <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <FileText size={14} className="text-blue-400" /> Proposals ({proposals.length})
          </h4>
          <div className="space-y-3">
            {proposals.map(proposal => {
              const sc = statusConfig[proposal.status] || statusConfig.draft;
              return (
                <div key={proposal.id} className={`flex items-center gap-3 p-3 rounded-xl border ${sc.bg}`}>
                  <div className={`${sc.color} flex-shrink-0`}>{sc.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{proposal.title}</div>
                    <div className="text-xs text-slate-400">
                      {new Date(proposal.createdAt).toLocaleDateString()} &middot; {proposal.viewCount} views
                      {proposal.emailSent && ' \u00b7 Email sent'}
                    </div>
                  </div>
                  <div className={`text-xs font-semibold ${sc.color} px-2 py-0.5 rounded-full border ${sc.bg}`}>
                    {sc.label}
                  </div>
                  <div className="flex gap-1">
                    {proposal.shareToken ? (
                      <a
                        href={`/proposals/view/${proposal.id}?token=${proposal.shareToken}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost p-1.5 rounded-lg"
                        title="View proposal (client link)"
                      >
                        <Eye size={13} />
                      </a>
                    ) : null}
                    {proposal.pdfUrl ? (
                      <a
                        href={proposal.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost p-1.5 rounded-lg"
                        title="Download PDF"
                      >
                        <Download size={13} />
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card p-6 text-center">
          <FileText size={24} className="text-slate-600 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">No proposals yet</p>
          <p className="text-slate-600 text-xs mt-1">Generate your first proposal above</p>
        </div>
      )}

      {/* ── Homeowner Portal Status ── */}
      <PortalStageCard project={project} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PortalStageCard — lets the installer manually set homeowner_stage
// ─────────────────────────────────────────────────────────────────────────────

type HomeownerStage =
  | 'lead_submitted'
  | 'under_review'
  | 'site_survey'
  | 'design'
  | 'proposal'
  | 'installation'
  | 'completed';

const PORTAL_STAGES: {
  value: HomeownerStage;
  label: string;
  color: string;         // text + border + bg (Tailwind classes, space-separated)
  dot: string;           // solid dot colour
  desc: string;
}[] = [
  {
    value: 'lead_submitted',
    label: 'Lead Submitted',
    color: 'text-slate-300  border-slate-500/30  bg-slate-500/10',
    dot: 'bg-slate-400',
    desc: 'Initial enquiry received.',
  },
  {
    value: 'under_review',
    label: 'Under Review',
    color: 'text-blue-300   border-blue-500/30   bg-blue-500/10',
    dot: 'bg-blue-400',
    desc: 'Your team is reviewing the project.',
  },
  {
    value: 'site_survey',
    label: 'Site Survey',
    color: 'text-cyan-300   border-cyan-500/30   bg-cyan-500/10',
    dot: 'bg-cyan-400',
    desc: 'On-site assessment scheduled or complete.',
  },
  {
    value: 'design',
    label: 'Design',
    color: 'text-violet-300 border-violet-500/30 bg-violet-500/10',
    dot: 'bg-violet-400',
    desc: 'System design in progress.',
  },
  {
    value: 'proposal',
    label: 'Proposal',
    color: 'text-amber-300  border-amber-500/30  bg-amber-500/10',
    dot: 'bg-amber-400',
    desc: 'Proposal shared — awaiting signature.',
  },
  {
    value: 'installation',
    label: 'Installation',
    color: 'text-orange-300 border-orange-500/30 bg-orange-500/10',
    dot: 'bg-orange-400',
    desc: 'System being installed.',
  },
  {
    value: 'completed',
    label: 'Completed',
    color: 'text-green-300  border-green-500/30  bg-green-500/10',
    dot: 'bg-green-400',
    desc: 'Installation complete.',
  },
];

function portalStageMeta(stage: HomeownerStage | null) {
  return PORTAL_STAGES.find(s => s.value === stage) ?? null;
}

interface PortalStageCardProps {
  project: import('@/types').Project;
}

function PortalStageCard({ project }: PortalStageCardProps) {
  const [stage, setStage]           = useState<HomeownerStage | null>(null);
  const [fetchDone, setFetchDone]   = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [selected, setSelected]     = useState<HomeownerStage | ''>('');
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null);

  // Load current stage from dedicated endpoint
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${project.id}/homeowner-stage`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.success) {
          const s = (d.stage as HomeownerStage | null) ?? null;
          setStage(s);
          setSelected(s ?? '');
        } else {
          setFetchError(true);
        }
      })
      .catch(() => { if (!cancelled) setFetchError(true); })
      .finally(() => { if (!cancelled) setFetchDone(true); });
    return () => { cancelled = true; };
  }, [project.id]);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleSave() {
    if (!selected || selected === stage || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/homeowner-stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: selected }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        showToast(d.error ?? 'Failed to update stage', false);
        return;
      }
      setStage(selected as HomeownerStage);
      showToast(`Stage updated to "${portalStageMeta(selected as HomeownerStage)?.label ?? selected}"`);
    } catch {
      showToast('Network error — please try again', false);
    } finally {
      setSaving(false);
    }
  }

  const currentMeta = portalStageMeta(stage);
  const isDirty     = selected !== '' && selected !== stage;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="card p-5 border border-white/[0.06]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Home size={14} className="text-slate-400 flex-shrink-0" />
        <h4 className="text-sm font-semibold text-white">Homeowner Portal Stage</h4>
      </div>

      {/* Loading skeleton */}
      {!fetchDone ? (
        <div className="flex items-center gap-2 py-1">
          <div className="w-5 h-5 rounded-full bg-slate-700 animate-pulse" />
          <div className="h-4 w-28 rounded bg-slate-700 animate-pulse" />
        </div>
      ) : null}

      {/* Fetch error */}
      {fetchDone && fetchError ? (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">Could not load portal stage. Refresh and try again.</p>
        </div>
      ) : null}

      {/* Main UI — once loaded with no error */}
      {fetchDone && !fetchError ? (
        <>
          {/* Current stage badge */}
          <div className="mb-4">
            <p className="text-xs text-slate-500 mb-1.5">Current stage</p>
            {currentMeta ? (
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${currentMeta.color}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${currentMeta.dot}`} />
                {currentMeta.label}
              </span>
            ) : (
              <span className="text-xs text-slate-500 italic">Not set</span>
            )}
            {currentMeta?.desc ? (
              <p className="text-xs text-slate-500 mt-1">{currentMeta.desc}</p>
            ) : null}
          </div>

          {/* Stage pipeline — visual stepper */}
          <div className="flex items-center gap-0 mb-5 overflow-x-auto pb-1">
            {PORTAL_STAGES.map((s, idx) => {
              const stageIdx    = stage ? PORTAL_STAGES.findIndex(x => x.value === stage) : -1;
              const isCurrent   = s.value === stage;
              const isPast      = stageIdx >= 0 && idx < stageIdx;
              const isFuture    = stageIdx < 0 || idx > stageIdx;
              const isLast      = idx === PORTAL_STAGES.length - 1;

              return (
                <React.Fragment key={s.value}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.value)}
                    title={s.label}
                    className={`
                      flex flex-col items-center gap-1 px-1.5 py-1 rounded-lg transition-colors flex-shrink-0
                      ${selected === s.value ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}
                    `}
                  >
                    {/* Dot */}
                    <span
                      className={`
                        w-3 h-3 rounded-full border-2 flex-shrink-0 transition-all
                        ${isCurrent
                          ? `${s.dot} border-transparent ring-2 ring-offset-1 ring-offset-slate-900 ring-white/30`
                          : isPast
                            ? `${s.dot} border-transparent opacity-60`
                            : isFuture
                              ? 'bg-transparent border-slate-600'
                              : 'bg-transparent border-slate-600'
                        }
                        ${selected === s.value && !isCurrent ? 'ring-2 ring-offset-1 ring-offset-slate-900 ring-blue-400/50' : ''}
                      `}
                    />
                    {/* Label */}
                    <span
                      className={`text-[9px] font-medium text-center leading-tight whitespace-nowrap
                        ${isCurrent ? 'text-white' : isPast ? 'text-slate-400' : 'text-slate-600'}
                        ${selected === s.value && !isCurrent ? '!text-blue-300' : ''}
                      `}
                    >
                      {s.label.split(' ').join('\n')}
                    </span>
                  </button>
                  {!isLast ? (
                    <ChevronRight
                      size={10}
                      className={`flex-shrink-0 mx-0.5 ${
                        stageIdx >= 0 && idx < stageIdx ? 'text-slate-500' : 'text-slate-700'
                      }`}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
          </div>

          {/* Dropdown + Save row */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selected}
              onChange={e => setSelected(e.target.value as HomeownerStage | '')}
              className="flex-1 min-w-0 text-xs rounded-lg bg-slate-800 border border-white/[0.08]
                         text-slate-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500/50
                         cursor-pointer"
            >
              <option value="" disabled>Select a stage…</option>
              {PORTAL_STAGES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || saving}
              className={`btn-sm flex items-center gap-1.5 flex-shrink-0 ${
                isDirty && !saving ? 'btn-primary' : 'btn-secondary opacity-50 cursor-not-allowed'
              }`}
            >
              {saving ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <CheckCircle size={12} /> Update Stage
                </>
              )}
            </button>
          </div>

          {/* Informational note */}
          <p className="text-xs text-slate-600 mt-2.5">
            Stages also advance automatically when you share a proposal (→ Proposal)
            or the homeowner signs (→ Installation).
          </p>
        </>
      ) : null}

      {/* Toast */}
      {toast ? (
        <div
          className={`mt-3 flex items-center gap-2 p-2.5 rounded-xl text-xs font-medium border
            ${toast.ok
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-red-500/10    border-red-500/20    text-red-300'
            }`}
        >
          {toast.ok
            ? <CheckCircle size={13} className="flex-shrink-0" />
            : <AlertTriangle size={13} className="flex-shrink-0" />
          }
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}
