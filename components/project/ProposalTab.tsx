'use client';
import React, { useEffect, useState } from 'react';
import { FileText, Send, Eye, Download, CheckCircle, Clock, XCircle, ArrowRight, AlertTriangle, DollarSign, Zap } from 'lucide-react';
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

  useEffect(() => {
    fetch(`/api/proposals?projectId=${project.id}`)
      .then(r => r.json())
      .then(data => {
        setProposals(Array.isArray(data) ? data : data.proposals || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [project.id]);

  const hasDesign = !!project.layout;
  const hasBill = !!project.billAnalysis;
  const cost = project.costEstimate;

  const canGenerate = hasDesign && hasBill;

  return (
    <div className="space-y-5">

      {/* Readiness check */}
      {!canGenerate && (
        <div className="card p-4 border border-amber-500/20 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-amber-300 mb-1">Proposal Not Ready</div>
              <div className="text-xs text-slate-400 space-y-0.5">
                {!hasBill && <div>• Upload a utility bill to get usage data and financials</div>}
                {!hasDesign && <div>• Complete a design in Design Studio to get system specs</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Financial summary for proposal */}
      {cost && (
        <div className="card p-5">
          <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <DollarSign size={14} className="text-emerald-400" /> Financial Summary
          </h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Net Cost', value: `$${cost.netCost.toLocaleString()}`, color: 'text-amber-400' },
              { label: 'Annual Savings', value: `$${cost.annualSavings.toLocaleString()}/yr`, color: 'text-emerald-400' },
              { label: 'Payback Period', value: `${cost.paybackYears} years`, color: 'text-blue-400' },
              { label: '25-yr Savings', value: `$${cost.lifetimeSavings.toLocaleString()}`, color: 'text-emerald-400' },
            ].map(m => (
              <div key={m.label} className="bg-slate-800/60 rounded-xl p-3 text-center">
                <div className="text-xs text-slate-400 mb-1">{m.label}</div>
                <div className={`text-lg font-bold ${m.color}`}>{m.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="flex justify-between p-2 bg-slate-800/40 rounded-lg">
              <span className="text-slate-400">Gross Cost</span>
              <span className="text-white">${cost.grossCost.toLocaleString()}</span>
            </div>
            <div className="flex justify-between p-2 bg-slate-800/40 rounded-lg">
              <span className="text-slate-400">Tax Credit (30%)</span>
              <span className="text-emerald-400">-${cost.taxCredit.toLocaleString()}</span>
            </div>
            <div className="flex justify-between p-2 bg-slate-800/40 rounded-lg">
              <span className="text-slate-400">ROI</span>
              <span className="text-emerald-400">{cost.roi}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Generate proposal CTA */}
      <div className="card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h4 className="text-sm font-semibold text-white mb-1">Generate Proposal</h4>
            <p className="text-xs text-slate-400">Create a professional PDF proposal with system specs, financials, and environmental impact.</p>
          </div>
          <Link
            href={`/proposals?projectId=${project.id}`}
            className={`btn-sm flex items-center gap-2 ${canGenerate ? 'btn-primary' : 'btn-secondary opacity-60 pointer-events-none'}`}
          >
            <FileText size={14} /> Generate Proposal <ArrowRight size={13} />
          </Link>
        </div>
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
                      {new Date(proposal.createdAt).toLocaleDateString()} · {proposal.viewCount} views
                      {proposal.emailSent && ' · Email sent'}
                    </div>
                  </div>
                  <div className={`text-xs font-semibold ${sc.color} px-2 py-0.5 rounded-full border ${sc.bg}`}>
                    {sc.label}
                  </div>
                  <div className="flex gap-1">
                    {proposal.shareToken && (
                      <a
                        href={`/proposals/view/${proposal.shareToken}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost p-1.5 rounded-lg"
                        title="View proposal"
                      >
                        <Eye size={13} />
                      </a>
                    )}
                    {proposal.pdfUrl && (
                      <a
                        href={proposal.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost p-1.5 rounded-lg"
                        title="Download PDF"
                      >
                        <Download size={13} />
                      </a>
                    )}
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
    </div>
  );
}