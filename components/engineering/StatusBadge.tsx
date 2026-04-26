'use client';
import React from 'react';
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

export function StatusBadge({ status, size = 'md' }: { status: 'PASS' | 'WARNING' | 'FAIL' | null; size?: 'sm' | 'md' | 'lg' }) {
  if (!status) return <span className="text-slate-500 text-xs">Not calculated</span>;
  const cfg = {
    PASS:    { bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400', icon: <CheckCircle size={size === 'lg' ? 18 : 13} />, label: 'PASS' },
    WARNING: { bg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',       icon: <AlertTriangle size={size === 'lg' ? 18 : 13} />, label: 'WARNING' },
    FAIL:    { bg: 'bg-red-500/15 border-red-500/30 text-red-400',             icon: <XCircle size={size === 'lg' ? 18 : 13} />, label: 'FAIL' },
  }[status];
  const sizeClass = size === 'lg' ? 'px-4 py-2 text-sm font-black' : size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-xs font-bold';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border ${cfg.bg} ${sizeClass}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}
