'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Info } from 'lucide-react';

/**
 * Operations has been merged into the Dashboard.
 * This page shows a brief explanatory message before redirecting so users
 * aren't confused by a silent navigation change.
 */
export default function OperationsRedirect() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/dashboard');
    }, 2500);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <div className="card max-w-sm w-full p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
          <Info size={22} className="text-blue-400" />
        </div>
        <h2 className="text-white font-semibold text-base mb-2">Operations moved to Dashboard</h2>
        <p className="text-slate-400 text-sm mb-5 leading-relaxed">
          Project tracking, pipeline stages, and operations are now part of the <span className="text-white font-medium">Dashboard</span> for a single unified view of your work.
        </p>
        <div className="flex items-center justify-center gap-2 text-amber-400 text-sm font-medium">
          <span>Redirecting you now</span>
          <ArrowRight size={14} className="animate-pulse" />
        </div>
        <button
          onClick={() => router.replace('/dashboard')}
          className="btn-primary w-full justify-center mt-4 text-sm"
        >
          Go to Dashboard <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
