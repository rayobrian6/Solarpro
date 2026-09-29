'use client';
import React from 'react';
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

/**
 * 🚨 `NOT_EVALUATED` IS A STATUS, NOT A QUIET `null`.
 *
 * `null` here has always meant "not calculated" and renders as grey text — correct for an engine
 * that was never asked to run. `NOT_EVALUATED` is the different, louder thing: a check that WAS
 * asked, could not run, and knows what it is missing. Ray: "Do not fake NOT_EVALUATED as a warning
 * string sprinkled into outputs." So it gets its own badge, and the caller passes the missing input
 * beside it — a badge that cannot say what it needs is a dead end on screen.
 */
export function StatusBadge({ status, size = 'md' }: { status: 'PASS' | 'WARNING' | 'FAIL' | 'NOT_EVALUATED' | null; size?: 'sm' | 'md' | 'lg' }) {
  if (!status) return <span className="text-slate-500 text-xs">Not calculated</span>;
  const cfg = {
    PASS:    { bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400', icon: <CheckCircle size={size === 'lg' ? 18 : 13} />, label: 'PASS' },
    WARNING: { bg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',       icon: <AlertTriangle size={size === 'lg' ? 18 : 13} />, label: 'WARNING' },
    FAIL:    { bg: 'bg-red-500/15 border-red-500/30 text-red-400',             icon: <XCircle size={size === 'lg' ? 18 : 13} />, label: 'FAIL' },
    NOT_EVALUATED: { bg: 'bg-slate-500/15 border-amber-500/40 text-amber-300', icon: <AlertTriangle size={size === 'lg' ? 18 : 13} />, label: 'NOT EVALUATED' },
  }[status];
  const sizeClass = size === 'lg' ? 'px-4 py-2 text-sm font-black' : size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-xs font-bold';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border ${cfg.bg} ${sizeClass}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}
