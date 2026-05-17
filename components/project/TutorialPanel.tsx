'use client';

/**
 * TutorialPanel — Collapsible "How to use this tab" panel.
 *
 * Embeds a YouTube video (via nocookie iframe) in a collapsible section
 * at the top of each project tab. Persists collapsed state per tab in
 * localStorage so users aren't annoyed by repeated auto-opens.
 *
 * Props:
 *   tabId       — unique key for localStorage (e.g. 'bill', 'design')
 *   title       — short title shown in the collapsed bar
 *   description — 1-2 sentence description shown under the title
 *   videoId     — YouTube video ID (used in embed URL)
 *   duration    — video duration label (e.g. "1:20")
 *
 * Behaviour:
 *   - First time: expanded (localStorage key not set)
 *   - After user collapses once: stays collapsed for that tab (stored in
 *     localStorage as `tutorial_collapsed_<tabId>`)
 *   - User can re-expand manually at any time
 *   - The iframe only renders when expanded (no background loading)
 *   - Uses youtube-nocookie.com for privacy-enhanced mode
 *
 * Accessibility:
 *   - Toggle button has aria-expanded
 *   - Video panel has role="region" with aria-label
 *   - Keyboard navigable (no custom focus trapping needed)
 */

import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, PlayCircle, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TutorialPanelProps {
  /** Unique key for localStorage — must match the tab ID  */
  tabId: string;
  /** Short title shown in the collapsed bar */
  title: string;
  /** 1-2 sentence description shown under the title when expanded */
  description: string;
  /** YouTube video ID (e.g. "dQw4w9WgXcQ") */
  videoId: string;
  /** Human-readable video duration label (e.g. "1:20") */
  duration?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const storageKey = (tabId: string) => `tutorial_collapsed_${tabId}`;

function isCollapsedInStorage(tabId: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(storageKey(tabId)) === '1';
}

function setCollapsedInStorage(tabId: string, collapsed: boolean) {
  if (typeof window === 'undefined') return;
  if (collapsed) {
    localStorage.setItem(storageKey(tabId), '1');
  } else {
    localStorage.removeItem(storageKey(tabId));
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TutorialPanel({
  tabId,
  title,
  description,
  videoId,
  duration,
}: TutorialPanelProps) {
  // Start collapsed by default — user opens it when they want it
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted]   = useState(false);

  // Hydrate from localStorage after mount (client-only)
  // Only expand if user has explicitly opened it before (key set to '0')
  useEffect(() => {
    const stored = localStorage.getItem(storageKey(tabId));
    // null  = never touched → stay collapsed
    // '1'   = explicitly dismissed → stay collapsed
    // '0'   = user opened it → expand
    setExpanded(stored === '0');
    setMounted(true);
  }, [tabId]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      // User opened it — remember so it stays open on revisit
      localStorage.setItem(storageKey(tabId), '0');
    } else {
      // User closed it — mark dismissed
      localStorage.setItem(storageKey(tabId), '1');
    }
  };

  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(false);
    localStorage.setItem(storageKey(tabId), '1');
  };

  // Don't render until hydrated to avoid SSR mismatch
  if (!mounted) return null;

  return (
    <div
      data-testid={`tutorial-panel-${tabId}`}
      className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden"
    >
      {/* ── Toggle bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center w-full">
        <button
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={`tutorial-video-${tabId}`}
          data-testid={`tutorial-toggle-${tabId}`}
          className="flex-1 flex items-center gap-3 px-4 py-3 text-left hover:bg-amber-500/10 transition-colors group"
        >
          <PlayCircle size={16} className="text-amber-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-amber-300 font-semibold text-sm">{title}</span>
            {duration && (
              <span className="ml-2 text-amber-600 text-xs">· {duration}</span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 mr-1">
            {expanded ? (
              <ChevronUp size={14} className="text-amber-500" />
            ) : (
              <ChevronDown size={14} className="text-amber-600 group-hover:text-amber-400" />
            )}
          </div>
        </button>
        {expanded && (
          <button
            onClick={dismiss}
            data-testid={`tutorial-dismiss-${tabId}`}
            aria-label="Dismiss tutorial"
            className="px-3 py-3 rounded hover:bg-amber-500/20 transition-colors text-amber-600 hover:text-amber-400 flex-shrink-0"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Expanded content ─────────────────────────────────────────────── */}
      {expanded && (
        <div
          id={`tutorial-video-${tabId}`}
          role="region"
          aria-label={`${title} tutorial video`}
          data-testid={`tutorial-content-${tabId}`}
          className="px-4 pb-4"
        >
          <p className="text-amber-200/70 text-xs mb-3 leading-relaxed">{description}</p>

          {/* YouTube embed */}
          <div
            className="relative w-full rounded-lg overflow-hidden bg-slate-900 border border-amber-500/10"
            style={{ paddingBottom: '56.25%' /* 16:9 aspect ratio */ }}
          >
            <iframe
              data-testid={`tutorial-iframe-${tabId}`}
              src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`}
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              className="absolute inset-0 w-full h-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
