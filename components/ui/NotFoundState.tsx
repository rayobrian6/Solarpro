'use client';
import React from 'react';
import Link from 'next/link';
import { ArrowLeft, SearchX } from 'lucide-react';

interface NotFoundStateProps {
  title: string;
  message?: string;
  backHref: string;
  backLabel: string;
}

export function NotFoundState({ title, message, backHref, backLabel }: NotFoundStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-center mb-5">
        <SearchX size={26} className="text-slate-500" />
      </div>
      <h2 className="text-lg font-bold text-white mb-1.5">{title}</h2>
      {message ? (
        <p className="text-sm text-slate-400 mb-6 max-w-sm">{message}</p>
      ) : null}
      <Link
        href={backHref}
        className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:bg-slate-700/60 hover:text-white transition-all"
      >
        <ArrowLeft size={14} />
        {backLabel}
      </Link>
    </div>
  );
}
