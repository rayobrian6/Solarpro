'use client';
import React from 'react';
import { XCircle, AlertTriangle, Info } from 'lucide-react';
import { getNecExplanation } from '@/lib/engineering-helpers';

export function IssueRow({ issue, expanded: defaultExpanded = false }: { issue: any; expanded?: boolean }) {
  const [open, setOpen] = React.useState(defaultExpanded);
  const cfg = {
    error:   { icon: <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />, bg: 'bg-red-500/5 border-red-500/20' },
    warning: { icon: <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />, bg: 'bg-amber-500/5 border-amber-500/20' },
    info:    { icon: <Info size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />, bg: 'bg-blue-500/5 border-blue-500/20' },
  }[issue.severity as string] || { icon: null, bg: '' };
  const explanation = getNecExplanation(issue);
  return (
    <div className={`rounded-lg border ${cfg.bg} overflow-hidden`}>
      <div
        className="flex gap-2 p-3 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => explanation && setOpen(!open)}
      >
        {cfg.icon}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white">{issue.message}</div>
          {issue.necReference && <div className="text-xs text-slate-500 mt-0.5">{issue.necReference}</div>}
          {issue.suggestion && <div className="text-xs text-amber-400/80 mt-0.5">\ud83d\udca1 {issue.suggestion}</div>}
        </div>
        {issue.code && <div className="text-xs text-slate-600 font-mono flex-shrink-0">{issue.code}</div>}
        {explanation ? (
          <div className="text-xs text-slate-600 flex-shrink-0 ml-1">
            {open ? '\u25b2' : '\u25bc'}
          </div>
        ) : null}
      </div>
      {open && explanation ? (
        <div className="px-3 pb-3 border-t border-slate-700/50 bg-slate-900/40">
          <div className="pt-2 space-y-2">
            <div className="text-xs font-semibold text-white">{explanation.title} \u2014 {explanation.ref}</div>
            <div className="text-xs text-slate-400 leading-relaxed">{explanation.plain}</div>
            <div className="flex items-start gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
              <span className="text-emerald-400 flex-shrink-0 mt-0.5">\u2192</span>
              <div className="text-xs text-emerald-300"><span className="font-semibold">Suggested Fix:</span> {explanation.fix}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
