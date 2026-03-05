'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveStatusBarProps {
  status: SaveStatus;
  lastSavedAt?: Date | null;
  errorMessage?: string;
  className?: string;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function SaveStatusBar({ status, lastSavedAt, errorMessage, className = '' }: SaveStatusBarProps) {
  const [timeDisplay, setTimeDisplay] = useState<string>('');

  useEffect(() => {
    if (!lastSavedAt) return;
    setTimeDisplay(timeAgo(lastSavedAt));
    const interval = setInterval(() => {
      setTimeDisplay(timeAgo(lastSavedAt));
    }, 10000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);

  if (status === 'idle' && !lastSavedAt) return null;

  return (
    <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full transition-all duration-300 ${
      status === 'saving' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
      status === 'saved'  ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
      status === 'error'  ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
      'bg-gray-500/10 text-gray-400 border border-gray-500/20'
    } ${className}`}>
      {status === 'saving' && (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Saving...</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <CheckCircle className="w-3 h-3" />
          <span>Saved {timeDisplay}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="w-3 h-3" />
          <span>{errorMessage || 'Save failed — retrying...'}</span>
        </>
      )}
      {status === 'idle' && lastSavedAt && (
        <>
          <Clock className="w-3 h-3" />
          <span>Last saved {timeDisplay}</span>
        </>
      )}
    </div>
  );
}

export default SaveStatusBar;