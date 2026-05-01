'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Lock, ArrowRight, X, Zap } from 'lucide-react';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  requiredPlan: string;
}

export default function UpgradeModal({ isOpen, onClose, title, description, requiredPlan }: UpgradeModalProps) {
  const router = useRouter();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl shadow-black/50 animate-in fade-in zoom-in-95 duration-200">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>

        {/* Icon */}
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-5">
          <Lock size={24} className="text-amber-400" />
        </div>

        {/* Content */}
        <h2 className="text-xl font-black text-white mb-2">{title}</h2>
        <p className="text-slate-400 text-sm leading-relaxed mb-6">{description}</p>

        {/* Required plan badge */}
        <div className="flex items-center gap-2 mb-6 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
          <Zap size={14} className="text-amber-400 flex-shrink-0" />
          <span className="text-amber-300 text-sm font-medium">
            Available on <strong>{requiredPlan}</strong> plan and above
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => { router.push('/subscribe'); onClose(); }}
            className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2"
          >
            Upgrade Plan <ArrowRight size={14} />
          </button>
          <button
            onClick={() => { router.push('/subscribe'); onClose(); }}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-3 rounded-xl text-sm transition-all border border-slate-700"
          >
            Compare Plans
          </button>
        </div>
      </div>
    </div>
  );
}
