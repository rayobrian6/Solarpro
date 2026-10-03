'use client';

// ═══════════════════════════════════════════════════════════════════════════
// GUIDED MODE — one line, not a second layout.
//
// Ray (System Config UX correction V3): "Guided: a one-line strip near the top of the tab:
// 'GUIDED MODE · N required answers · Next: PV string assignment [Answer]' — [Answer] scrolls to and
// highlights the home card (ring) and opens that card's dialog. No separate layout."
//
// The count and the next item are `requiredQueue` — the same list the readiness panel reads, so the
// strip and the panel can never disagree. The mode changes nothing else: the answers, the sources and
// the release state come from the interview, which takes no mode.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useMemo } from 'react';
import type { InterviewItem, SystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import {
  CARD_ANCHOR, anchorOf, nextActionLabel, releaseStatus, requiredQueue,
} from '@/lib/electrical/systemConfigPlacement';

export function GuidedStrip({ interview, onAnswer }: {
  interview: Pick<SystemConfigInterview, 'sections' | 'openQuestions' | 'release'>;
  /** Called with the next required item. The page reveals its home card and opens its dialog. */
  onAnswer: (item: InterviewItem) => void;
}) {
  const queue = useMemo(() => requiredQueue(interview), [interview]);
  const next = queue[0] ?? null;
  const n = queue.length;
  return (
    <div data-testid="guided-strip" data-next={next?.id ?? ''}
         className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-1.5 text-xs text-slate-300">
      <span className="font-black tracking-wide text-sky-300">GUIDED MODE</span>
      <span className="text-slate-600">·</span>
      <span data-testid="guided-count">{n} required answer{n === 1 ? '' : 's'}</span>
      {next ? (
        <>
          <span className="text-slate-600">·</span>
          <span>Next: <span data-testid="guided-next" className="font-bold text-slate-100">{nextActionLabel(next)}</span></span>
          <button type="button" data-testid="guided-answer" onClick={() => onAnswer(next)}
                  className="ml-1 rounded bg-sky-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-sky-500">
            Answer
          </button>
        </>
      ) : (
        <>
          <span className="text-slate-600">·</span>
          <span data-testid="guided-done">{releaseStatus(interview, queue).label}</span>
        </>
      )}
    </div>
  );
}

/** The ring a revealed card wears for a few seconds. */
export const HIGHLIGHT_CLASSES = ['ring-2', 'ring-sky-400', 'ring-offset-2', 'ring-offset-slate-950'] as const;

/**
 * Scroll to the card an item is asked in and ring it for `ms`. A card that is not on the page (yet)
 * falls back to the readiness panel, which always is. Returns the element revealed, or null.
 */
export function revealHomeCard(itemId: string, ms = 3000): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(anchorOf(itemId)) ?? document.getElementById(CARD_ANCHOR.readiness);
  if (!el) return null;
  el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  el.classList.add(...HIGHLIGHT_CLASSES);
  el.setAttribute('data-highlight', 'true');
  window.setTimeout(() => {
    el.classList.remove(...HIGHLIGHT_CLASSES);
    el.removeAttribute('data-highlight');
  }, ms);
  return el;
}

export default GuidedStrip;
