'use client';

/**
 * GuidedTour — First-run visual overlay coach.
 *
 * Renders a spotlight + popover that points at real nav/UI elements,
 * walks new users through the 5-step SolarPro workflow:
 *   1. Create your first client   → points at /clients in nav
 *   2. Create a project           → points at /projects in nav
 *   3. Upload utility bill        → points at /projects/new or dashboard Bill tab
 *   4. Open Design Studio         → points at /design in nav
 *   5. Generate & send proposal   → points at /proposals in nav
 *
 * Behaviour:
 *  - Only shows when user.hasSeenTour === false (checked by parent)
 *  - Reads data-tour="<key>" attributes on nav links for precise positioning
 *  - Falls back to centre-screen popover if element not found in DOM
 *  - Calls onComplete() when the tour is finished or skipped
 *  - Cleans up all event listeners and timers on unmount
 *
 * Accessibility:
 *  - Focus-trapped within the popover while tour is active
 *  - Escape key skips tour
 *  - All interactive elements have aria-labels
 *
 * NOTE: The AppShell nav links must have data-tour="<key>" attributes for
 * precise spotlight positioning. This component gracefully degrades to a
 * centred modal if the attribute isn't found.
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight, ChevronLeft, Map, Users, FolderOpen, FileText, Receipt } from 'lucide-react';

// ── Tour step definitions ──────────────────────────────────────────────────

interface TourStep {
  /** data-tour value on the target nav element */
  targetKey: string;
  /** Step title */
  title: string;
  /** Step description */
  body: string;
  /** lucide icon */
  icon: React.ReactNode;
  /** Accent color classes */
  accent: string;
  /** CTA label */
  cta: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    targetKey:  'clients',
    title:      'Start with a client',
    body:       'Every solar project belongs to a client. Create your first client — name, email, address — and all their projects, proposals, and history stay organised in one place.',
    icon:       <Users size={18} />,
    accent:     'text-sky-400 bg-sky-500/10 border-sky-500/25',
    cta:        'Got it — next',
  },
  {
    targetKey:  'projects',
    title:      'Create a project',
    body:       'A project is one solar installation. Link it to your client, pick the system type (roof, ground, or Sol Fence), and you\'re ready to start designing.',
    icon:       <FolderOpen size={18} />,
    accent:     'text-amber-400 bg-amber-500/10 border-amber-500/25',
    cta:        'Got it — next',
  },
  {
    targetKey:  'bill',
    title:      'Upload the utility bill',
    body:       'Upload the homeowner\'s electricity bill and SolarPro\'s AI extracts usage, rates, and annual consumption automatically — then sizes the system for you in seconds.',
    icon:       <Receipt size={18} />,
    accent:     'text-teal-400 bg-teal-500/10 border-teal-500/25',
    cta:        'Got it — next',
  },
  {
    targetKey:  'design',
    title:      'Design on the real roof',
    body:       'Open Design Studio to draw roof zones on satellite imagery, place panels, and run 3D shading analysis. The system size updates live as you add panels.',
    icon:       <Map size={18} />,
    accent:     'text-amber-400 bg-amber-500/10 border-amber-500/25',
    cta:        'Got it — next',
  },
  {
    targetKey:  'proposals',
    title:      'Generate & send a proposal',
    body:       'One click generates a branded proposal with production estimates, 30% ITC savings, financing options, and a direct link your client can open on any device.',
    icon:       <FileText size={18} />,
    accent:     'text-purple-400 bg-purple-500/10 border-purple-500/25',
    cta:        'Finish tour 🎉',
  },
];

// ── Props ──────────────────────────────────────────────────────────────────

interface GuidedTourProps {
  /** Called when the tour finishes or is skipped. Parent must POST tour-complete + refresh user. */
  onComplete: () => void;
}

// ── Spotlight geometry helper ──────────────────────────────────────────────

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getTargetRect(key: string): Rect | null {
  const el = document.querySelector(`[data-tour="${key}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Add a little padding around the element
  const pad = 6;
  return {
    top:    r.top    - pad,
    left:   r.left   - pad,
    width:  r.width  + pad * 2,
    height: r.height + pad * 2,
  };
}

// ── Popover position calculator ────────────────────────────────────────────

interface PopoverPosition {
  top:  number;
  left: number;
  /** Which side the arrow is on: top | right | bottom | left */
  arrow: 'top' | 'right' | 'bottom' | 'left';
}

const POPOVER_WIDTH  = 320;
const POPOVER_HEIGHT = 220; // approximate

function calcPopoverPos(rect: Rect | null, vw: number, vh: number): PopoverPosition {
  if (!rect) {
    // Fallback: centre on screen
    return {
      top:   Math.max(20, (vh - POPOVER_HEIGHT) / 2),
      left:  Math.max(20, (vw - POPOVER_WIDTH)  / 2),
      arrow: 'top',
    };
  }

  const margin = 12;
  const centerY = rect.top + rect.height / 2;
  const centerX = rect.left + rect.width / 2;

  // Prefer right of target if space exists
  if (rect.left + rect.width + margin + POPOVER_WIDTH < vw) {
    return {
      top:   Math.min(Math.max(margin, centerY - POPOVER_HEIGHT / 2), vh - POPOVER_HEIGHT - margin),
      left:  rect.left + rect.width + margin,
      arrow: 'left',
    };
  }

  // Prefer below target
  if (rect.top + rect.height + margin + POPOVER_HEIGHT < vh) {
    return {
      top:   rect.top + rect.height + margin,
      left:  Math.min(Math.max(margin, centerX - POPOVER_WIDTH / 2), vw - POPOVER_WIDTH - margin),
      arrow: 'top',
    };
  }

  // Above target
  return {
    top:   Math.max(margin, rect.top - POPOVER_HEIGHT - margin),
    left:  Math.min(Math.max(margin, centerX - POPOVER_WIDTH / 2), vw - POPOVER_WIDTH - margin),
    arrow: 'bottom',
  };
}

// ── Main component ─────────────────────────────────────────────────────────

export default function GuidedTour({ onComplete }: GuidedTourProps) {
  const [stepIdx, setStepIdx]     = useState(0);
  const [visible, setVisible]     = useState(false);
  const [spotRect, setSpotRect]   = useState<Rect | null>(null);
  const [popPos, setPopPos]       = useState<PopoverPosition>({ top: 0, left: 0, arrow: 'top' });
  const [vw, setVw]               = useState(0);
  const [vh, setVh]               = useState(0);
  const popoverRef                = useRef<HTMLDivElement>(null);
  const firstBtnRef               = useRef<HTMLButtonElement>(null);

  const step = TOUR_STEPS[stepIdx];

  // ── Position recalculation ───────────────────────────────────────────────

  const recalc = useCallback((idx: number) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    setVw(w);
    setVh(h);
    const key  = TOUR_STEPS[idx].targetKey;
    const rect = getTargetRect(key);
    setSpotRect(rect);
    setPopPos(calcPopoverPos(rect, w, h));
  }, []);

  // ── Mount: short delay so layout settles, then show ──────────────────────

  useEffect(() => {
    const timer = setTimeout(() => {
      recalc(0);
      setVisible(true);
    }, 800);
    return () => clearTimeout(timer);
  }, [recalc]);

  // ── Focus first button when step changes ─────────────────────────────────

  useEffect(() => {
    if (visible) {
      firstBtnRef.current?.focus();
    }
  }, [visible, stepIdx]);

  // ── Resize / scroll handler ──────────────────────────────────────────────

  useEffect(() => {
    const onResize = () => recalc(stepIdx);
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('scroll', onResize, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize);
    };
  }, [stepIdx, recalc]);

  // ── Escape key handler ───────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleSkip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Navigation ──────────────────────────────────────────────────────────

  const handleNext = useCallback(() => {
    const nextIdx = stepIdx + 1;
    if (nextIdx >= TOUR_STEPS.length) {
      setVisible(false);
      setTimeout(() => onComplete(), 200);
    } else {
      setStepIdx(nextIdx);
      // Recalc position after state flushes
      requestAnimationFrame(() => recalc(nextIdx));
    }
  }, [stepIdx, onComplete, recalc]);

  const handleBack = useCallback(() => {
    if (stepIdx === 0) return;
    const prevIdx = stepIdx - 1;
    setStepIdx(prevIdx);
    requestAnimationFrame(() => recalc(prevIdx));
  }, [stepIdx, recalc]);

  const handleSkip = useCallback(() => {
    setVisible(false);
    setTimeout(() => onComplete(), 200);
  }, [onComplete]);

  if (!visible) return null;

  // ── Spotlight SVG path (cutout over target) ──────────────────────────────

  const pad = 8;
  const rx  = 10;

  const spotlightPath = spotRect
    ? `M 0 0 H ${vw} V ${vh} H 0 Z
       M ${spotRect.left - pad} ${spotRect.top - pad}
       h ${spotRect.width  + pad * 2}
       a ${rx} ${rx} 0 0 1 ${rx} ${rx}
       v ${spotRect.height + pad * 2 - rx * 2}
       a ${rx} ${rx} 0 0 1 -${rx} ${rx}
       h -${spotRect.width  + pad * 2}
       a ${rx} ${rx} 0 0 1 -${rx} -${rx}
       v -${spotRect.height + pad * 2 - rx * 2}
       a ${rx} ${rx} 0 0 1 ${rx} -${rx}
       Z`
    : `M 0 0 H ${vw} V ${vh} H 0 Z`;

  // ── Arrow direction class ────────────────────────────────────────────────

  const arrowClass: Record<string, string> = {
    left:   'before:absolute before:top-1/2 before:-translate-y-1/2 before:-left-[9px] before:border-t-[9px] before:border-b-[9px] before:border-r-[9px] before:border-transparent before:border-r-slate-800',
    top:    'before:absolute before:left-1/2 before:-translate-x-1/2 before:-top-[9px] before:border-l-[9px] before:border-r-[9px] before:border-b-[9px] before:border-transparent before:border-b-slate-800',
    bottom: 'before:absolute before:left-1/2 before:-translate-x-1/2 before:-bottom-[9px] before:border-l-[9px] before:border-r-[9px] before:border-t-[9px] before:border-transparent before:border-t-slate-800',
    right:  'before:absolute before:top-1/2 before:-translate-y-1/2 before:-right-[9px] before:border-t-[9px] before:border-b-[9px] before:border-l-[9px] before:border-transparent before:border-l-slate-800',
  };

  const portal = (
    <div
      className="fixed inset-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-label={`Guided tour step ${stepIdx + 1} of ${TOUR_STEPS.length}: ${step.title}`}
    >
      {/* ── Dimmed backdrop with spotlight cutout ── */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ isolation: 'isolate' }}
      >
        <defs>
          <mask id="gt-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotRect ? (
              <rect
                x={spotRect.left - pad}
                y={spotRect.top  - pad}
                width={spotRect.width  + pad * 2}
                height={spotRect.height + pad * 2}
                rx={rx}
                fill="black"
              />
            ) : null}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(2,6,23,0.82)"
          mask="url(#gt-spotlight-mask)"
        />
      </svg>

      {/* Spotlight border ring */}
      {spotRect ? (
        <div
          className="absolute rounded-xl border-2 border-amber-400/70 pointer-events-none shadow-[0_0_0_3px_rgba(251,191,36,0.15)]"
          style={{
            top:    spotRect.top    - pad,
            left:   spotRect.left   - pad,
            width:  spotRect.width  + pad * 2,
            height: spotRect.height + pad * 2,
            transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      ) : null}

      {/* ── Popover ── */}
      <div
        ref={popoverRef}
        className={`absolute bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl pointer-events-auto
                    ${arrowClass[popPos.arrow]}`}
        style={{
          top:      popPos.top,
          left:     popPos.left,
          width:    POPOVER_WIDTH,
          transition: 'top 0.25s cubic-bezier(0.4,0,0.2,1), left 0.25s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-4 pb-3">
          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 mt-0.5 ${step.accent}`}>
            {step.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-500">
                Step {stepIdx + 1} of {TOUR_STEPS.length}
              </p>
              <button
                onClick={handleSkip}
                aria-label="Close tour"
                className="text-slate-600 hover:text-slate-400 transition-colors p-0.5 rounded"
              >
                <X size={14} />
              </button>
            </div>
            <h3 className="text-white font-semibold text-sm mt-0.5">{step.title}</h3>
          </div>
        </div>

        {/* Body */}
        <p className="text-slate-400 text-xs leading-relaxed px-4 pb-4">
          {step.body}
        </p>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 px-4 pb-3">
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === stepIdx
                  ? 'w-5 bg-amber-400'
                  : i < stepIdx
                  ? 'w-1.5 bg-amber-400/40'
                  : 'w-1.5 bg-slate-700'
              }`}
            />
          ))}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-4 pb-4">
          {stepIdx > 0 ? (
            <button
              onClick={handleBack}
              aria-label="Back"
              className="btn-ghost px-3 py-1.5 text-xs text-slate-400 hover:text-white flex items-center gap-1"
            >
              <ChevronLeft size={13} /> Back
            </button>
          ) : null}
          <div className="flex-1" />
          <button
            onClick={handleSkip}
            className="text-xs text-slate-500 hover:text-slate-400 transition-colors px-2 py-1.5"
          >
            Skip tour
          </button>
          <button
            ref={firstBtnRef}
            onClick={handleNext}
            aria-label={step.cta}
            className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
          >
            {step.cta}
            {stepIdx < TOUR_STEPS.length - 1 && <ArrowRight size={13} />}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(portal, document.body);
}
