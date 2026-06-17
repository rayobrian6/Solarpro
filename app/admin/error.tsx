'use client';

import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default function AdminError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
      <AlertTriangle size={48} className="text-red-400 mb-4" />
      <h2 className="text-xl font-semibold text-red-400 mb-2">Admin Error</h2>
      <p className="text-sm text-slate-400 mb-6 text-center max-w-md">
        {error.message || 'Something went wrong loading the admin panel.'}
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-white hover:bg-blue-400 transition-colors"
        >
          <RefreshCw size={14} className="inline mr-1.5" />Try Again
        </button>
        <a
          href="/admin"
          className="px-5 py-2 rounded-lg text-sm font-semibold bg-white/10 text-slate-300 border border-white/15 hover:border-white/30 transition-colors"
        >
          <Home size={14} className="inline mr-1.5" />Admin Home
        </a>
      </div>
    </div>
  );
}
