'use client';

/**
 * SolarDog v10.2 — Selective Learning + Real Conversation
 *
 * Upgrades vs v10.1:
 * - Strict learn discipline: ONLY learns on explicit "X is Y" / "X means Y" / "X = Y"
 * - Confirmation flow: asks before saving any alias (pendingLearnPhrase/pendingLearnRoute)
 * - Unlearn support: "forget that", "unlearn X", "remove mapping for X"
 * - Platform identity: full platform assistant, not just solar calc
 * - Personality: dry humor, never corporate tone
 * - Response priority: Answer → Explain → Suggest → Offer → Execute
 * - Response type handling: chat | navigate | action | learn | observation | conversation | correction
 * - Developer mode: diagnostics, alias dump, context inspector
 * - Voice: /api/tts proxy, volume slider, mute, no blocking on voice fail
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAppStore } from '@/store/appStore';
import { useEngineeringStore, selectEngineeringSnapshot } from '@/store/engineeringStore';
import type { AssistantResponse, SolarDogMode } from '@/app/api/assistant/route';
import type { UIEvent as SolarDogUIEvent } from '@/lib/solardog/buildContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const HIDE_KEY   = 'solardog_hidden';
const VOLUME_KEY = 'solardog_volume';

const IMG: Record<string, string> = {
  idle:      '/solardog/dog-sit-crop.png',
  talk:      '/solardog/dog-talk-crop.png',
  celebrate: '/solardog/dog-celebrate-crop.png',
};

// Guided workflows — step sequences
const GUIDED_WORKFLOWS: Record<string, string[]> = {
  start_guided_design: [
    "Let's build your system from scratch — follow me. First up: navigate to Projects and create a new project.",
    "Got a project? Now open Design and place your panels on the roof. I'll wait.",
    "Roof layout done? Head to Engineering — I'll validate your strings and wires.",
    "Engineering's good. Last step: generate your Proposal. One click, done.",
    "That's the full flow. You've got a complete system — panels, engineering, proposal. 🐾",
  ],
  start_guided_engineering: [
    "Engineering walkthrough — let's go. Start with string sizing: how many modules per string do you want?",
    "Good. Now check your Voc × temp correction vs inverter max input voltage. NEC 690.7 requires <600V or <1000V depending on system class.",
    "Wire sizing next: 690.8 says size conductors at 125% of Isc. Check your conduit fill too — 40% max.",
    "Run the NEC validation now. I'll flag anything that's off.",
    "Clean validation? Generate your BOM. Every component, every quantity, every cost. Done. 🐾",
  ],
  start_guided_proposal: [
    "Proposal flow — quick and clean. Make sure your project has a system size and production estimate loaded.",
    "Open Proposals and select your project. The system pulls production, financials, and ITC 30% automatically.",
    "Review the numbers — check offset %, payback period, and net cost after incentives.",
    "Add your company branding in Settings if you haven't yet.",
    "Generate it. Send it. Close it. 🐾",
  ],
};

const TOUR_STEPS = [
  "Hey! I'm SolarDog — your AI agent. I run on a real language model. I can navigate anywhere, take actions, and remember what you tell me. Ask me anything.",
  "Dashboard is your command center — pipeline stats, revenue, quick links.",
  "Projects: every job from lead to install. I can take you there anytime — just say 'go to projects'.",
  "Engineering is where the real work happens — string sizing, wire sizing, NEC validation, BOM. I can run calcs for you.",
  "Design: place panels on the actual roof. I can take you straight there with your project loaded.",
  "Proposals: branded one-click docs with production, savings, ITC 30%. I can generate one for you.",
  "You can also teach me shortcuts — say 'command center is dashboard' and I'll remember it forever. Woof! 🐾",
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role:       'user' | 'assistant';
  content:    string;
  severity?:  'info' | 'warning' | 'error' | 'success';
  highlight?: string | null;
  action?:    string | null;
  type?:      string;
  // v61.16: Structured suggested actions from LLM
  suggestedActions?: Array<{ id: string; label: string; confidence: number }>;
  nextStep?:  string | null;
}

type VoiceStatus =
  | 'ready'
  | 'blocked'
  | 'no_key'
  | 'quota_exceeded'
  | 'invalid_key'
  | 'muted'
  | 'error';

interface LearnedAlias {
  phrase:    string;
  route:     string;
  label:     string;
  createdAt: string;
}

// Guided workflow state
interface GuidedState {
  workflowKey: string;
  step:        number;
  steps:       string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, val: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, val); } catch { /* ignore */ }
}
function lsDel(key: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function getPageName(pathname: string): string {
  const p = pathname.toLowerCase();
  if (p === '/' || p.includes('dashboard'))             return 'dashboard';
  if (p.includes('project'))                            return 'projects';
  if (p.includes('engineer') || p.includes('string'))  return 'engineering';
  if (p.includes('design') || p.includes('roof'))      return 'design';
  if (p.includes('proposal') || p.includes('quote'))   return 'proposals';
  if (p.includes('bom') || p.includes('material'))     return 'engineering';
  if (p.includes('client'))                             return 'clients';
  if (p.includes('hardware'))                           return 'hardware';
  if (p.includes('analytic'))                           return 'analytics';
  if (p.includes('setting'))                            return 'settings';
  if (p.includes('admin'))                              return 'admin';
  return 'general';
}

function resolveProjectId(storeId: string | null): string | null {
  if (storeId) return storeId;
  if (typeof window === 'undefined') return null;
  const urlPid = new URLSearchParams(window.location.search).get('projectId');
  if (urlPid) return urlPid;
  return lsGet('eng:lastProjectId');
}

function renderMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} style={{ color: '#fbbf24' }}>{part.slice(2, -2)}</strong>
      : part
  );
}

function highlightElement(selector: string): void {
  if (!selector) return;
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const prev = el.style.outline;
    const prevBg = el.style.background;
    el.style.outline      = '3px solid #f59e0b';
    el.style.background   = 'rgba(245,158,11,0.12)';
    el.style.borderRadius = '8px';
    el.style.transition   = 'outline 0.3s, background 0.3s';
    setTimeout(() => { el.style.outline = prev; el.style.background = prevBg; }, 3500);
  } catch { /* invalid selector */ }
}

const VOICE_STATUS_LABEL: Record<VoiceStatus, string> = {
  ready:          '🔊 VOICE ON',
  blocked:        '🔕 CLICK TO ENABLE',
  no_key:         '🔇 VOICE UNAVAILABLE',
  quota_exceeded: '🔇 VOICE PAUSED',
  invalid_key:    '🔇 VOICE ERROR',
  muted:          '🔇 MUTED',
  error:          '🔇 VOICE ERROR',
};

const VOICE_STATUS_HINT: Partial<Record<VoiceStatus, string>> = {
  no_key:         'ELEVENLABS_API_KEY not configured on server',
  quota_exceeded: 'ElevenLabs out of credits — add credits at elevenlabs.io',
  invalid_key:    'ElevenLabs API key invalid — check ELEVENLABS_API_KEY env var',
  blocked:        'Browser blocked autoplay — click to enable',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface SolarDogProps {
  /** When true, automatically starts the onboarding tour once on first render */
  autoStartTour?: boolean;
  /** Called when the tour finishes or is skipped — parent can mark tour complete */
  onTourComplete?: () => void;
}

export default function SolarDog({ autoStartTour = false, onTourComplete }: SolarDogProps = {}) {
  const pathname    = usePathname();
  const router      = useRouter();
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  // Zustand store
  const storeActiveId      = useAppStore(s => s.activeProjectId);
  const storeActiveProject = useAppStore(s =>
    s.activeProjectId ? s.projects.find(p => p.id === s.activeProjectId) ?? null : null
  );
  // Phase 7: engineering page snapshot (control-plane awareness)
  const engineeringSnapshot = useEngineeringStore(selectEngineeringSnapshot);

  // Resolved project ID
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(null);
  useEffect(() => {
    setResolvedProjectId(resolveProjectId(storeActiveId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeActiveId, pathname]);

  // ── Core UI state ──────────────────────────────────────────────────────────
  const [isHidden,    setIsHidden]    = useState<boolean>(false);
  const [chatOpen,    setChatOpen]    = useState(false);
  const [messages,    setMessages]    = useState<ChatMessage[]>([]);
  const [input,       setInput]       = useState('');
  const [isLoading,   setIsLoading]   = useState(false);
  const [dogPose,     setDogPose]     = useState<'idle' | 'talk' | 'celebrate'>('idle');
  const [isSpeaking,  setIsSpeaking]  = useState(false);
  const [isTour,      setIsTour]      = useState(false);
  const [tourStep,    setTourStep]    = useState(0);
  const [subtitle,    setSubtitle]    = useState('');
  const [subVisible,  setSubVisible]  = useState(false);

  // ── Voice state ────────────────────────────────────────────────────────────
  const [isMuted,         setIsMuted]         = useState(false);
  const [volume,          setVolume]          = useState<number>(0.8);
  const [voiceStatus,     setVoiceStatus]     = useState<VoiceStatus>('ready');
  const [showVoicePanel,  setShowVoicePanel]  = useState(false);
  const [serverVoiceEnabled, setServerVoiceEnabled] = useState<boolean | null>(null);

  // ── Agent state ────────────────────────────────────────────────────────────
  const [currentMode,      setCurrentMode]    = useState<SolarDogMode>('user');
  const [learnedAliases,   setLearnedAliases] = useState<LearnedAlias[]>([]);
  const [guidedState,      setGuidedState]    = useState<GuidedState | null>(null);
  const [showAliases,      setShowAliases]    = useState(false);
  const [pendingConfirm,   setPendingConfirm] = useState<{ route: string; label: string; msg: string } | null>(null);
  // v10.2: pending learn confirmation — set when SolarDog asks "Just to confirm — map X → Y?"
  const [pendingLearnData, setPendingLearnData] = useState<{ phrase: string; route: string } | null>(null);

  // v61.16: Recent UI events — buffer of actions user has clicked, sent on next message
  const [recentEvents, setRecentEvents] = useState<SolarDogUIEvent[]>([]);

  // v61.16: Post a UI event (called when user clicks a suggested action button)
  const postUIEvent = useCallback((actionId: string, result?: string) => {
    const ev: SolarDogUIEvent = {
      actionId,
      page: getPageName(pathnameRef.current),
      timestamp: new Date().toISOString(),
      result,
    };
    setRecentEvents(prev => [...prev.slice(-9), ev]); // keep last 10
  }, []);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const abortTourRef  = useRef(false);
  const isTourRef     = useRef(false);
  const isMutedRef    = useRef(false);
  const volumeRef     = useRef(volume);
  const messagesRef   = useRef<ChatMessage[]>([]);
  const inputRef      = useRef<HTMLInputElement>(null);
  const endRef        = useRef<HTMLDivElement>(null);
  const audioRef      = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isMutedRef.current  = isMuted;  }, [isMuted]);
  useEffect(() => { volumeRef.current   = volume;   }, [volume]);

  // On mount: load learned aliases
  useEffect(() => {
    lsDel('solardog_muted'); // clear stale mute
    fetch('/api/solardog/aliases')
      .then(r => r.ok ? r.json() : { aliases: [] })
      .then(data => {
        if (Array.isArray(data.aliases)) setLearnedAliases(data.aliases);
      })
      .catch(() => {/* silent */});
  }, []);

  // Sync hidden + volume from localStorage after mount (SSR-safe)
  useEffect(() => {
    if (lsGet(HIDE_KEY) === '1') setIsHidden(true);
    const saved = lsGet(VOLUME_KEY);
    if (saved) {
      const v = parseFloat(saved);
      if (!isNaN(v)) setVolume(Math.max(0, Math.min(1, v)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist hidden
  useEffect(() => {
    if (isHidden) lsSet(HIDE_KEY, '1');
    else          lsDel(HIDE_KEY);
  }, [isHidden]);

  // Persist volume
  useEffect(() => {
    lsSet(VOLUME_KEY, String(volume));
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Scroll to bottom
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ESC handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isTourRef.current) {
        abortTourRef.current = true;
        isTourRef.current    = false;
        setIsTour(false);
        setIsSpeaking(false);
        setSubVisible(false);
        setDogPose('idle');
        if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      } else {
        setChatOpen(false);
        setShowVoicePanel(false);
        setPendingConfirm(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // — Auto-start tour on first login (when autoStartTour prop is true) ——————————
  // Small delay so the page finishes rendering before the tour begins.
  useEffect(() => {
    if (!autoStartTour) return;
    const t = setTimeout(() => { runTour(); }, 1200);
    return () => clearTimeout(t);
  // runTour is stable (useCallback) — safe to include
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartTour]);

  // — Window event trigger: 'solardog:start-tour' ———————————————————————————
  // Allows any component to fire: window.dispatchEvent(new Event('solardog:start-tour'))
  useEffect(() => {
    const onStartTour = () => { runTour(); };
    window.addEventListener('solardog:start-tour', onStartTour);
    return () => window.removeEventListener('solardog:start-tour', onStartTour);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Subtitle helpers ───────────────────────────────────────────────────────
  const showSubtitle = useCallback((text: string) => {
    setSubtitle(text); setSubVisible(true);
  }, []);
  const hideSubtitle = useCallback(() => {
    setSubVisible(false);
    setTimeout(() => setSubtitle(''), 400);
  }, []);

  // ── ElevenLabs speak (via /api/tts proxy) ─────────────────────────────────
  const speak = useCallback(async (text: string): Promise<void> => {
    if (!text) return;
    const clean = text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/[*_`#]/g, '')
      .substring(0, 500);

    setIsSpeaking(true);
    setDogPose('talk');
    showSubtitle(clean);

    if (!isMutedRef.current && voiceStatus !== 'no_key' && voiceStatus !== 'quota_exceeded' && voiceStatus !== 'invalid_key') {
      console.info('[SOLARDOG VOICE] tts start', { chars: clean.length });
      try {
        const resp = await fetch('/api/tts', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ text: clean }),
        });

        if (resp.ok) {
          const blob  = await resp.blob();
          const url   = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.volume = volumeRef.current;
          audioRef.current = audio;

          await new Promise<void>(resolve => {
            const cleanup = () => {
              URL.revokeObjectURL(url);
              audioRef.current = null;
              resolve();
            };
            audio.addEventListener('ended', cleanup, { once: true });
            audio.addEventListener('error', cleanup, { once: true });

            const playPromise = audio.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => {
                  console.info('[SOLARDOG VOICE] tts complete — audio playing');
                  setVoiceStatus('ready');
                })
                .catch((err: unknown) => {
                  const name = (err as DOMException)?.name ?? '';
                  console.warn('[SOLARDOG VOICE] audio.play() rejected', name);
                  if (name === 'NotAllowedError') setVoiceStatus('blocked');
                  setTimeout(cleanup, Math.min(clean.length * 55, 8000));
                });
            }
          });
        } else {
          let errCode = 'error';
          try {
            const errData = await resp.json();
            errCode = errData.code ?? 'error';
            console.warn('[SOLARDOG VOICE] tts failed', { status: resp.status, code: errCode });
          } catch { /* ignore */ }
          if (errCode === 'quota_exceeded') setVoiceStatus('quota_exceeded');
          else if (errCode === 'no_key')    setVoiceStatus('no_key');
          else if (errCode === 'invalid_key') setVoiceStatus('invalid_key');
          else                              setVoiceStatus('error');
          await sleep(Math.min(clean.length * 55, 8000));
        }
      } catch (e) {
        console.warn('[SOLARDOG VOICE] tts network error', e);
        await sleep(Math.min(clean.length * 55, 8000));
      }
    } else {
      await sleep(Math.min(clean.length * 40, 6000));
    }

    setIsSpeaking(false);
    setDogPose('idle');
    setTimeout(hideSubtitle, 1200);
  }, [showSubtitle, hideSubtitle, voiceStatus]);

  // ── Stop tour ──────────────────────────────────────────────────────────────
  const stopTour = useCallback(() => {
    abortTourRef.current = true;
    isTourRef.current    = false;
    setIsTour(false);
    setIsSpeaking(false);
    setDogPose('idle');
    setSubVisible(false);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    // Notify parent (e.g. to mark tour complete in DB)
    onTourComplete?.();
  }, [onTourComplete]);

  // ── Hide / show ────────────────────────────────────────────────────────────
  const hideDog = useCallback(() => {
    stopTour();
    setChatOpen(false);
    setIsHidden(true);
  }, [stopTour]);
  const showDog = useCallback(() => { setIsHidden(false); }, []);

  // ── Voice controls ─────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (voiceStatus === 'blocked') setVoiceStatus('ready');
    setIsMuted(prev => {
      const next = !prev;
      isMutedRef.current = next;
      if (next && audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
        setIsSpeaking(false);
        setDogPose('idle');
      }
      return next;
    });
  }, [voiceStatus]);

  // ── Navigation executor ────────────────────────────────────────────────────
  const executeNavigation = useCallback((route: string) => {
    if (!route) return;
    console.info('[SOLARDOG] navigating to', route);
    router.push(route);
  }, [router]);

  // ── Action executor ────────────────────────────────────────────────────────
  const executeAction = useCallback((action: string | null | undefined) => {
    if (!action) return;
    const pid = resolvedProjectId;

    console.info('[SOLARDOG] executing action', action, { pid });

    switch (action) {
      // Navigation actions
      case 'navigate':
        break; // handled separately via route field
      case 'open_dashboard':
        router.push('/dashboard');
        break;
      case 'open_projects':
        router.push('/projects');
        break;
      case 'open_engineering':
        router.push(pid ? `/engineering?projectId=${pid}` : '/engineering');
        break;
      case 'open_bom':
        router.push(pid ? `/engineering?projectId=${pid}&tab=bom` : '/engineering?tab=bom');
        break;
      case 'open_design':
        router.push(pid ? `/design?projectId=${pid}` : '/design');
        break;
      case 'open_proposals':
        router.push('/proposals');
        break;
      case 'open_clients':
        router.push('/clients');
        break;
      case 'open_hardware':
        router.push('/hardware');
        break;
      case 'open_analytics':
        router.push('/analytics');
        break;
      case 'open_settings':
        router.push('/settings');
        break;
      case 'open_permit':
        router.push('/engineering/permit');
        break;
      case 'new_project':
        router.push('/projects/new');
        break;

      // Engineering actions — dispatch custom events for the engineering page to handle
      case 'run_string_sizing':
        window.dispatchEvent(new CustomEvent('solardog:action', { detail: { action: 'run_string_sizing', projectId: pid } }));
        break;
      case 'run_wire_sizing':
        window.dispatchEvent(new CustomEvent('solardog:action', { detail: { action: 'run_wire_sizing', projectId: pid } }));
        break;
      case 'run_nec_validation':
        window.dispatchEvent(new CustomEvent('solardog:action', { detail: { action: 'run_nec_validation', projectId: pid } }));
        break;
      case 'auto_fix_string':
        window.dispatchEvent(new CustomEvent('solardog:action', { detail: { action: 'auto_fix_string', projectId: pid } }));
        break;
      case 'auto_fix_wire':
        window.dispatchEvent(new CustomEvent('solardog:action', { detail: { action: 'auto_fix_wire', projectId: pid } }));
        break;
      case 'generate_bom':
        window.dispatchEvent(new CustomEvent('solardog:action', { detail: { action: 'generate_bom', projectId: pid } }));
        break;
      case 'generate_sld':
        window.dispatchEvent(new CustomEvent('solardog:action', { detail: { action: 'generate_sld', projectId: pid } }));
        break;
      case 'generate_proposal':
        window.dispatchEvent(new CustomEvent('solardog:action', { detail: { action: 'generate_proposal', projectId: pid } }));
        break;
      case 'flag_review':
        window.dispatchEvent(new CustomEvent('solardog:action', { detail: { action: 'flag_review', projectId: pid } }));
        break;

      // Guided mode
      case 'start_guided_design':
      case 'start_guided_engineering':
      case 'start_guided_proposal':
        startGuidedWorkflow(action);
        break;

      default:
        console.info('[SOLARDOG] unknown action:', action);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, resolvedProjectId]);

  // ── Guided workflow ────────────────────────────────────────────────────────
  const startGuidedWorkflow = useCallback((workflowKey: string) => {
    const steps = GUIDED_WORKFLOWS[workflowKey];
    if (!steps) return;
    const state: GuidedState = { workflowKey, step: 0, steps };
    setGuidedState(state);
    setMessages(prev => [...prev, {
      role:    'assistant',
      content: steps[0],
      type:    'guided',
      severity: 'info',
    }]);
    speak(steps[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speak]);

  const advanceGuided = useCallback(() => {
    if (!guidedState) return;
    const nextStep = guidedState.step + 1;
    if (nextStep >= guidedState.steps.length) {
      setGuidedState(null);
      const doneMsg = "Guided flow complete 🐾 What's next?";
      setMessages(prev => [...prev, { role: 'assistant', content: doneMsg, type: 'chat', severity: 'success' }]);
      speak(doneMsg);
      return;
    }
    const updatedState = { ...guidedState, step: nextStep };
    setGuidedState(updatedState);
    const nextMsg = guidedState.steps[nextStep];
    setMessages(prev => [...prev, { role: 'assistant', content: nextMsg, type: 'guided', severity: 'info' }]);
    speak(nextMsg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedState, speak]);

  // ── Learn alias ────────────────────────────────────────────────────────────
  const handleLearnResponse = useCallback(async (data: AssistantResponse) => {
    if (!data.learnedPhrase || !data.learnedRoute) return;
    // Update local state immediately for instant resolution
    setLearnedAliases(prev => {
      const filtered = prev.filter(a => a.phrase !== data.learnedPhrase);
      return [...filtered, {
        phrase:    data.learnedPhrase!,
        route:     data.learnedRoute!,
        label:     data.routeLabel ?? data.learnedRoute!,
        createdAt: new Date().toISOString(),
      }];
    });
  }, []);

  // ── Tour ───────────────────────────────────────────────────────────────────
  const runTour = useCallback(async () => {
    if (isTourRef.current) return;
    abortTourRef.current = false;
    isTourRef.current    = true;
    setIsTour(true);
    setChatOpen(false);
    setDogPose('idle');
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      if (abortTourRef.current) break;
      setTourStep(i);
      await speak(TOUR_STEPS[i]);
      if (abortTourRef.current) break;
      if (i === TOUR_STEPS.length - 1) {
        setDogPose('celebrate');
        await sleep(1000);
        setDogPose('idle');
      }
      await sleep(200);
    }
    if (!abortTourRef.current) {
      isTourRef.current = false;
      setIsTour(false);
      // Notify parent that tour completed naturally
      onTourComplete?.();
    }
    abortTourRef.current = false;
  }, [speak, onTourComplete]);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (overrideText?: string) => {
    const msg = (overrideText ?? input).trim();
    if (!msg || isLoading) return;

    // Stop current speech
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsSpeaking(false);
      setDogPose('idle');
      setSubVisible(false);
    }

    // Clear pending confirm + pending learn
    setPendingConfirm(null);
    // Note: pendingLearnData is NOT cleared here — the current message may be a confirmation

    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setInput('');
    setIsLoading(true);
    setDogPose('talk');

    const pid  = resolvedProjectId;
    const page = getPageName(pathnameRef.current);

    // Build rich context payload (v10.3: extended screen context)
    const richContext: Record<string, unknown> = {
      page,
      currentRoute: typeof window !== 'undefined' ? window.location.pathname : page,
    };
    if (pid) {
      richContext.projectId        = pid;
      richContext.currentProjectId = pid;
    }
    if (typeof window !== 'undefined') {
      const tab = new URLSearchParams(window.location.search).get('tab');
      if (tab) {
        richContext.currentTab = tab;
        richContext.activeTab  = tab;
      }
    }
    if (storeActiveProject) {
      richContext.projectName        = storeActiveProject.name;
      richContext.currentProjectName = storeActiveProject.name;
      if (storeActiveProject.systemSizeKw) richContext.systemSizeKw = storeActiveProject.systemSizeKw;
    }
    // Phase 7: inject engineering page snapshot when it's fresh (updatedAt > 0)
    // so SolarDog knows controlMode, displayMode, userHasEditedInverters, etc.
    if (engineeringSnapshot.updatedAt > 0) {
      richContext.engineeringState = {
        controlMode:            engineeringSnapshot.controlMode,
        sizingAutoApply:        engineeringSnapshot.sizingAutoApply,
        userHasEditedInverters: engineeringSnapshot.userHasEditedInverters,
        displayMode:            engineeringSnapshot.displayMode,
        panelCountSource:       engineeringSnapshot.panelCountSource,
        panelCount:             engineeringSnapshot.panelCount,
        panelCountMismatch:     engineeringSnapshot.panelCountMismatch,
        systemKwDc:             engineeringSnapshot.systemKwDc,
        systemKwAc:             engineeringSnapshot.systemKwAc,
        topology:               engineeringSnapshot.topology,
        inverterModel:          engineeringSnapshot.inverterModel,
        stringCount:            engineeringSnapshot.stringCount,
        complianceStatus:       engineeringSnapshot.complianceStatus,
      };
    }
    // visibleButtons / visibleWarnings / visibleCounts / visibleCards / selectedEquipment
    // are injected by individual page components via props or a global context bridge.
    // Until wired, they are omitted so SolarDog knows not to claim screen visibility.

    console.info('[SOLARDOG] sending message', { page, pid, msgLen: msg.length });

    try {
      const res = await fetch('/api/assistant', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          message:   msg,
          projectId: pid,
          page,
          context:   richContext,
          // v10.2: pass pending learn data so backend can confirm-then-save
          ...(pendingLearnData ? {
            pendingLearnPhrase: pendingLearnData.phrase,
            pendingLearnRoute:  pendingLearnData.route,
          } : {}),
          // v61.16: pass recent UI events buffer
          ...(recentEvents.length > 0 ? { recentEvents } : {}),
        }),
      });

      const data: AssistantResponse = await res.json();

      if (!res.ok) {
        const errMsg = (data as any)?.error === 'Unauthorized'
          ? "You need to be logged in for me to work 🐾"
          : "Something went wrong — try again 🐾";
        setMessages(prev => [...prev, { role: 'assistant', content: errMsg, severity: 'error' }]);
        setIsLoading(false);
        setDogPose('idle');
        return;
      }

      console.info('[SOLARDOG] response received', {
        type:    data.type,
        mode:    data.mode,
        confidence: data.confidence,
        voice:   data.voiceEnabled,
        memory:  data.memoryAvailable,
        route:   data.route,
        action:  data.action,
      });

      const reply     = data.message || "Woof — empty reply 🐾";
      const severity  = (data.severity as ChatMessage['severity']) ?? 'info';
      const highlight = data.highlight ?? null;

      // Update mode + server voice
      if (data.mode)                              setCurrentMode(data.mode);
      if (typeof data.voiceEnabled === 'boolean') setServerVoiceEnabled(data.voiceEnabled);

      // Add assistant message
      setMessages(prev => [...prev, {
        role:     'assistant',
        content:  reply,
        severity,
        highlight,
        action:   data.action ?? data.type,
        type:     data.type,
        // v61.16: context suggestions
        suggestedActions: data.suggestedActions ?? undefined,
        nextStep:         data.nextStep ?? null,
      }]);
      setIsLoading(false);
      setRecentEvents([]);          // v61.16: clear after send

      if (highlight) setTimeout(() => highlightElement(highlight), 300);

      // ── Handle by response type ────────────────────────────────────────────
      switch (data.type) {

        case 'navigate':
          // High confidence → navigate immediately
          // Medium confidence → navigate with brief confirmation
          if (data.route) {
            if (data.confidence === 'medium') {
              // Show confirmation for 1.5s then navigate
              setPendingConfirm({
                route: data.route,
                label: data.routeLabel ?? data.route,
                msg:   reply,
              });
              setTimeout(() => {
                executeNavigation(data.route!);
                setPendingConfirm(null);
              }, 1800);
            } else {
              // High confidence — go immediately
              setTimeout(() => executeNavigation(data.route!), 600);
            }
          }
          break;

        case 'action':
          if (data.action) {
            setTimeout(() => executeAction(data.action!), 400);
          }
          break;

        case 'learn':
        case 'correction':
          // v10.2: Check for pending learn confirmation state
          if (data.pendingLearnPhrase && data.pendingLearnRoute) {
            // Backend is asking for confirmation — store pending state
            setPendingLearnData({ phrase: data.pendingLearnPhrase, route: data.pendingLearnRoute });
          } else if (data.learnedPhrase && data.learnedRoute) {
            // Alias was saved (either confirmed or unlearned)
            setPendingLearnData(null);
            await handleLearnResponse(data);
          } else {
            // No learn data — clear pending
            setPendingLearnData(null);
          }
          break;

        case 'observation':
        case 'conversation':
        case 'correction':
        case 'chat':
        default:
          // Non-nav/action types: never navigate, never auto-fire actions
          // Correction with learn alias already handled by handleLearnResponse flow above
          break;
      }

      // ── Voice ──────────────────────────────────────────────────────────────
      if (data.voiceEnabled !== false) {
        await speak(reply);
      } else {
        showSubtitle(reply.substring(0, 200));
        await sleep(4000);
        hideSubtitle();
      }

    } catch {
      setMessages(prev => [{
        role: 'assistant',
        content: "Network error — I'm temporarily offline 🐾",
        severity: 'warning',
      }, ...messagesRef.current.slice(0, -1)]);
      setIsLoading(false);
      setDogPose('idle');
    }
  }, [input, isLoading, speak, resolvedProjectId, executeNavigation, executeAction,
      handleLearnResponse, storeActiveProject, showSubtitle, hideSubtitle, pendingLearnData,
      recentEvents, postUIEvent, setRecentEvents]);

  // ── Dog click ──────────────────────────────────────────────────────────────
  const handleDogClick = useCallback(() => {
    if (isTourRef.current) { stopTour(); return; }
    if (voiceStatus === 'blocked') setVoiceStatus('ready');
    setChatOpen(o => !o);
    setShowVoicePanel(false);
    setTimeout(() => inputRef.current?.focus(), 120);
  }, [stopTour, voiceStatus]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }, [sendMessage]);

  const severityColor = (s?: string) => ({
    error: '#f87171', warning: '#fbbf24', success: '#34d399', info: '#64748b',
  }[s ?? 'info'] ?? '#64748b');

  // Type badge colors
  const typeBadge = (type?: string) => {
    if (type === 'navigate')    return { bg: '#1e3a5f', color: '#60a5fa', label: '↗ NAV' };
    if (type === 'action')      return { bg: '#1a2e1a', color: '#4ade80', label: '⚡ ACT' };
    if (type === 'learn')       return { bg: '#2e1a2e', color: '#c084fc', label: '🧠 LEARN' };
    if (type === 'guided')      return { bg: '#2e2a1a', color: '#fbbf24', label: '📍 GUIDE' };
    if (type === 'observation') return { bg: '#1a2a2e', color: '#38bdf8', label: '👁 OBS' };
    if (type === 'conversation') return { bg: '#1e1e2e', color: '#a78bfa', label: '💬 CHAT' };
    if (type === 'correction')  return { bg: '#2e1a1a', color: '#fb923c', label: '✏️ FIX' };
    return null;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  if (isHidden) {
    return (
      <>
        <style>{RECALL_CSS}</style>
        <button id="sd-recall" onClick={showDog} title="Show SolarDog" aria-label="Show SolarDog">🐾</button>
      </>
    );
  }

  const activeProjectName = storeActiveProject?.name ?? null;
  const projectPill = activeProjectName
    ? `📁 ${activeProjectName.length > 24 ? activeProjectName.slice(0, 24) + '…' : activeProjectName}`
    : resolvedProjectId
    ? `📁 Project context loaded`
    : null;

  const effectiveVoiceStatus: VoiceStatus = isMuted ? 'muted' : voiceStatus;
  const voiceLabel = VOICE_STATUS_LABEL[effectiveVoiceStatus] ?? '🔊 VOICE ON';
  const voiceHint  = VOICE_STATUS_HINT[effectiveVoiceStatus];
  const voiceIsOff = effectiveVoiceStatus !== 'ready';

  const modeBadge = currentMode === 'developer'          ? '⚙️ DEV'
    : currentMode === 'debug'                            ? '🔬 DEBUG'
    : currentMode === 'engineering_helper'               ? '⚡ ENG'
    : currentMode === 'project_helper'                   ? '📁 PROJ'
    : null;

  return (
    <>
      <style>{WIDGET_CSS}</style>

      {/* Subtitle bar */}
      {subVisible && subtitle && (
        <div id="sd-subtitle" role="status" aria-live="polite">
          <span className="sd-sub-text">{subtitle}</span>
          {isTour && (
            <button className="sd-sub-skip" onClick={stopTour}>Skip ✕</button>
          )}
        </div>
      )}

      {/* Dog sprite */}
      <div
        id="sd-widget"
        title="SolarDog AI Agent"
        aria-label="SolarDog AI Agent"
        onClick={handleDogClick}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleDogClick()}
      >
        <img
          src={IMG[dogPose]}
          alt="SolarDog"
          id="sd-dog-img"
          draggable={false}
        />
        {isSpeaking && <span id="sd-speaking-ring" aria-hidden="true" />}
        {isLoading  && <span id="sd-loading-dot"   aria-hidden="true" />}
      </div>

      {/* Chat panel */}
      {chatOpen && (
        <div id="sd-chat" role="dialog" aria-label="SolarDog chat">

          {/* Header */}
          <div id="sd-header">
            <div id="sd-header-left">
              <span id="sd-title">🐾 SolarDog</span>
              {modeBadge && (
                <span className="sd-mode-badge">{modeBadge}</span>
              )}
            </div>
            <div id="sd-header-right">
              <span id="sd-subtitle-sm">AI Agent • LLM-powered</span>
              <button
                id="sd-voice-btn"
                onClick={() => setShowVoicePanel(p => !p)}
                title={voiceHint ?? voiceLabel}
                className={voiceIsOff ? 'voice-off' : ''}
              >
                {voiceLabel}
              </button>
              <button id="sd-close-btn" onClick={() => setChatOpen(false)} aria-label="Close">✕</button>
              <button id="sd-hide-btn"  onClick={hideDog}  aria-label="Hide SolarDog">_</button>
            </div>
          </div>

          {/* Project pill */}
          {projectPill && (
            <div id="sd-project-pill">{projectPill}</div>
          )}

          {/* Voice panel */}
          {showVoicePanel && (
            <div id="sd-voice-panel">
              <div className="sd-voice-row">
                <span className="sd-vp-label">Volume</span>
                <input
                  type="range" min="0" max="100"
                  value={Math.round(volume * 100)}
                  onChange={e => setVolume(Number(e.target.value) / 100)}
                  className="sd-vol-slider"
                  aria-label="Volume"
                />
                <span className="sd-vol-pct">{Math.round(volume * 100)}%</span>
              </div>
              <div className="sd-voice-row">
                <button
                  className={`sd-mute-btn${isMuted ? ' muted' : ''}`}
                  onClick={toggleMute}
                >
                  {isMuted ? '🔇 Unmute' : '🔊 Mute'}
                </button>
                {voiceHint && <span className="sd-vp-hint">{voiceHint}</span>}
              </div>
              {serverVoiceEnabled === false && (
                <div className="sd-vp-hint" style={{ color: '#f87171' }}>
                  ⚠️ Voice not configured on server (no ELEVENLABS_API_KEY)
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          <div id="sd-messages" role="log" aria-live="polite">
            {messages.length === 0 ? (
              <div id="sd-welcome">
                <p><strong>SolarDog</strong> — what are we building?</p>
                <p>I know your projects, the full platform, and NEC cold. Navigate, fix issues, or ask me anything.</p>
                <div id="sd-welcome-actions">
                  {getPageName(pathname) === 'engineering' ? (
                    <>
                      <button className="sd-quick-btn" onClick={() => sendMessage('what warnings do I have')}>⚠️ My warnings</button>
                      <button className="sd-quick-btn" onClick={() => sendMessage('explain my DC/AC ratio')}>📊 DC/AC ratio</button>
                      <button className="sd-quick-btn" onClick={() => sendMessage('help me get this to pass')}>✅ Get to pass</button>
                      <button className="sd-quick-btn" onClick={() => sendMessage('explain the STRING_VOC_VOLTAGE_CLAMP warning')}>🔌 VOC clamp</button>
                    </>
                  ) : getPageName(pathname) === 'projects' ? (
                    <>
                      <button className="sd-quick-btn" onClick={() => sendMessage('show me my projects')}>📁 My projects</button>
                      <button className="sd-quick-btn" onClick={() => sendMessage('create a new project')}>➕ New project</button>
                      <button className="sd-quick-btn" onClick={() => sendMessage('what can you do')}>What can you do?</button>
                    </>
                  ) : getPageName(pathname) === 'dashboard' ? (
                    <>
                      <button className="sd-quick-btn" onClick={() => sendMessage('take me to engineering')}>⚡ Engineering</button>
                      <button className="sd-quick-btn" onClick={() => sendMessage('show me my projects')}>📁 Projects</button>
                      <button className="sd-quick-btn" onClick={() => sendMessage('what can you do')}>What can you do?</button>
                      <button className="sd-quick-btn" onClick={runTour}>🐾 Tour</button>
                    </>
                  ) : (
                    <>
                      <button className="sd-quick-btn" onClick={() => sendMessage('take me to engineering')}>⚡ Engineering</button>
                      <button className="sd-quick-btn" onClick={() => sendMessage('show me my projects')}>📁 Projects</button>
                      <button className="sd-quick-btn" onClick={() => sendMessage('what can you do')}>What can you do?</button>
                      <button className="sd-quick-btn" onClick={runTour}>🐾 Tour</button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              messages.map((m, i) => {
                const badge = typeBadge(m.type);
                return (
                  <div
                    key={i}
                    className={`sd-msg sd-msg-${m.role}`}
                    style={{ borderLeft: m.role === 'assistant' ? `2px solid ${severityColor(m.severity)}` : undefined }}
                  >
                    {badge && m.role === 'assistant' && (
                      <span
                        className="sd-type-badge"
                        style={{ background: badge.bg, color: badge.color }}
                      >
                        {badge.label}
                      </span>
                    )}
                    <span className="sd-msg-text">{renderMarkdown(m.content)}</span>
                    {m.highlight && (
                      <button
                        className="sd-highlight-btn"
                        onClick={() => highlightElement(m.highlight!)}
                      >
                        🔍 Show me
                      </button>
                    )}
                    {/* v61.16: Suggested action buttons */}
                    {m.role === 'assistant' && m.suggestedActions && m.suggestedActions.length > 0 && (
                      <div className="sd-suggested-actions">
                        <span className="sd-sugg-label">Suggested actions:</span>
                        {m.suggestedActions.map(sa => (
                          <button
                            key={sa.id}
                            className="sd-sugg-action-btn"
                            style={{ opacity: 0.6 + sa.confidence * 0.4 }}
                            onClick={() => {
                              executeAction(sa.id);
                              postUIEvent(sa.id, 'clicked');
                            }}
                          >
                            {sa.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* v61.16: Next step pill */}
                    {m.role === 'assistant' && m.nextStep && (
                      <div className="sd-next-step-pill">
                        <span>Next: {m.nextStep}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Guided mode — next step button */}
            {guidedState && (
              <div className="sd-guided-bar">
                <span className="sd-guided-label">
                  Step {guidedState.step + 1}/{guidedState.steps.length}
                </span>
                <button className="sd-guided-next" onClick={advanceGuided}>
                  Next step →
                </button>
                <button className="sd-guided-stop" onClick={() => setGuidedState(null)}>
                  Stop guide
                </button>
              </div>
            )}

            {/* Pending confirm (medium confidence nav) */}
            {pendingConfirm && (
              <div className="sd-pending-nav">
                <span>Navigating to <strong>{pendingConfirm.label}</strong>…</span>
                <button onClick={() => { setPendingConfirm(null); }} className="sd-cancel-nav">Cancel</button>
              </div>
            )}

            {isLoading && (
              <div className="sd-msg sd-msg-assistant">
                <span className="sd-typing">●●●</span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Learned aliases panel (dev mode) */}
          {(currentMode === 'developer' || currentMode === 'debug') && learnedAliases.length > 0 && (
            <div id="sd-aliases-panel">
              <button
                className="sd-aliases-toggle"
                onClick={() => setShowAliases(p => !p)}
              >
                🧠 {learnedAliases.length} learned alias{learnedAliases.length !== 1 ? 'es' : ''} {showAliases ? '▲' : '▼'}
              </button>
              {showAliases && (
                <div className="sd-aliases-list">
                  {learnedAliases.map((a, i) => (
                    <div key={i} className="sd-alias-row">
                      <span className="sd-alias-phrase">"{a.phrase}"</span>
                      <span className="sd-alias-arrow">→</span>
                      <span className="sd-alias-route">{a.route}</span>
                      <button
                        className="sd-alias-del"
                        onClick={async () => {
                          await fetch(`/api/solardog/aliases?phrase=${encodeURIComponent(a.phrase)}`, { method: 'DELETE' });
                          setLearnedAliases(prev => prev.filter(x => x.phrase !== a.phrase));
                        }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Input bar */}
          <div id="sd-input-bar">
            <input
              ref={inputRef}
              id="sd-input"
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={guidedState ? "Reply to continue the guide…" : "Ask or say 'go to engineering'…"}
              disabled={isLoading}
              autoComplete="off"
              aria-label="Message SolarDog"
            />
            <button
              id="sd-send-btn"
              onClick={() => sendMessage()}
              disabled={isLoading || !input.trim()}
              aria-label="Send"
            >
              {isLoading ? '…' : '▶'}
            </button>
          </div>

          {/* Suggested actions — context-aware per page */}
          <div id="sd-suggestions">
            {getPageName(pathname) === 'engineering' ? (
              <>
                <button className="sd-sugg-btn" onClick={() => sendMessage('what warnings do I have')}>⚠️ warnings</button>
                <button className="sd-sugg-btn" onClick={() => sendMessage('help me get this to pass')}>✅ get to pass</button>
                <button className="sd-sugg-btn" onClick={() => sendMessage('explain my DC/AC ratio')}>📊 DC/AC</button>
                <button className="sd-sugg-btn" onClick={() => sendMessage('take me to engineering BOM')}>🔩 BOM</button>
              </>
            ) : getPageName(pathname) === 'design' ? (
              <>
                <button className="sd-sugg-btn" onClick={() => sendMessage('how do I place panels')}>🏠 place panels</button>
                <button className="sd-sugg-btn" onClick={() => sendMessage('take me to engineering')}>⚡ engineering</button>
                <button className="sd-sugg-btn" onClick={() => sendMessage('what is auto layout')}>🤖 auto layout</button>
              </>
            ) : getPageName(pathname) === 'projects' ? (
              <>
                <button className="sd-sugg-btn" onClick={() => sendMessage('show me my projects')}>📁 projects</button>
                <button className="sd-sugg-btn" onClick={() => sendMessage('take me to engineering')}>⚡ engineering</button>
                <button className="sd-sugg-btn" onClick={() => sendMessage('create a new project')}>➕ new project</button>
              </>
            ) : (
              <>
                <button className="sd-sugg-btn" onClick={() => sendMessage('where am I')}>📍 where am I</button>
                <button className="sd-sugg-btn" onClick={() => sendMessage('go home')}>🏠 home</button>
                <button className="sd-sugg-btn" onClick={() => sendMessage('take me to engineering')}>⚡ engineering</button>
                <button className="sd-sugg-btn" onClick={() => sendMessage('guide me through design')}>📋 guide me</button>
              </>
            )}
          </div>

        </div>
      )}

      {/* Tour overlay */}
      {isTour && (
        <div id="sd-tour-overlay">
          <div id="sd-tour-card">
            <div id="sd-tour-progress">
              {TOUR_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`sd-tour-dot${i === tourStep ? ' active' : i < tourStep ? ' done' : ''}`}
                />
              ))}
            </div>
            <p id="sd-tour-text">{TOUR_STEPS[tourStep]}</p>
            <button id="sd-tour-skip" onClick={stopTour}>Skip tour</button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const RECALL_CSS = `
#sd-recall {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9998;
  background: #1e293b;
  color: #f59e0b;
  border: 1px solid #334155;
  border-radius: 50%;
  width: 44px;
  height: 44px;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 12px rgba(0,0,0,0.4);
  transition: transform 0.15s;
}
#sd-recall:hover { transform: scale(1.1); }
`;

const WIDGET_CSS = `
/* ── Base ───────────────────────────────────────── */
#sd-widget {
  position: fixed;
  bottom: 20px;
  right: 24px;
  z-index: 9999;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  filter: drop-shadow(0 4px 16px rgba(0,0,0,0.5));
  transition: transform 0.15s;
}
#sd-widget:hover { transform: scale(1.04); }
#sd-dog-img {
  width: 80px;
  height: auto;
  display: block;
  pointer-events: none;
}
#sd-speaking-ring {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 2px solid #f59e0b;
  animation: sdPulse 1s ease-in-out infinite;
  pointer-events: none;
}
#sd-loading-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 10px;
  height: 10px;
  background: #60a5fa;
  border-radius: 50%;
  animation: sdBlink 0.8s ease-in-out infinite;
}
@keyframes sdPulse {
  0%,100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(1.18); }
}
@keyframes sdBlink {
  0%,100% { opacity: 1; }
  50%      { opacity: 0.2; }
}

/* ── Subtitle bar ───────────────────────────────── */
#sd-subtitle {
  position: fixed;
  bottom: calc(20px + 92px);
  right: 24px;
  z-index: 9999;
  background: rgba(15,23,42,0.95);
  border: 1px solid #334155;
  border-radius: 10px;
  padding: 8px 14px;
  max-width: 340px;
  font-size: 12px;
  color: #e2e8f0;
  line-height: 1.5;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  pointer-events: none;
}
.sd-sub-text { display: block; }
.sd-sub-skip {
  display: block;
  margin-top: 6px;
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 11px;
  cursor: pointer;
  pointer-events: all;
}

/* ── Chat panel ─────────────────────────────────── */
#sd-chat {
  position: fixed;
  bottom: calc(20px + 90px);
  right: 24px;
  z-index: 9999;
  width: 360px;
  max-height: 580px;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: ui-monospace, 'JetBrains Mono', monospace;
  font-size: 12px;
}

/* ── Header ─────────────────────────────────────── */
#sd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #0a0f1a;
  border-bottom: 1px solid #1e293b;
  flex-shrink: 0;
}
#sd-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
#sd-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
#sd-title {
  font-weight: 700;
  font-size: 13px;
  color: #f8fafc;
  letter-spacing: 0.02em;
}
.sd-mode-badge {
  font-size: 10px;
  background: #1e3a2e;
  color: #4ade80;
  border-radius: 4px;
  padding: 1px 6px;
  font-weight: 600;
}
#sd-subtitle-sm {
  font-size: 10px;
  color: #475569;
}
#sd-voice-btn {
  font-size: 10px;
  background: #1e293b;
  color: #94a3b8;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 3px 8px;
  cursor: pointer;
  transition: background 0.15s;
}
#sd-voice-btn.voice-off { color: #64748b; }
#sd-voice-btn:hover { background: #334155; }
#sd-close-btn, #sd-hide-btn {
  background: none;
  border: none;
  color: #64748b;
  font-size: 13px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.15s;
}
#sd-close-btn:hover, #sd-hide-btn:hover { color: #f8fafc; }

/* ── Project pill ───────────────────────────────── */
#sd-project-pill {
  font-size: 10px;
  padding: 4px 14px;
  background: #0a1628;
  color: #60a5fa;
  border-bottom: 1px solid #1e293b;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Voice panel ────────────────────────────────── */
#sd-voice-panel {
  background: #0a1628;
  border-bottom: 1px solid #1e293b;
  padding: 10px 14px;
  flex-shrink: 0;
}
.sd-voice-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.sd-voice-row:last-child { margin-bottom: 0; }
.sd-vp-label {
  color: #94a3b8;
  font-size: 10px;
  width: 44px;
  flex-shrink: 0;
}
.sd-vol-slider {
  flex: 1;
  height: 4px;
  accent-color: #f59e0b;
  cursor: pointer;
}
.sd-vol-pct {
  color: #f59e0b;
  font-size: 10px;
  width: 28px;
  text-align: right;
}
.sd-mute-btn {
  background: #1e293b;
  color: #94a3b8;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
}
.sd-mute-btn.muted { color: #f87171; border-color: #7f1d1d; }
.sd-vp-hint {
  font-size: 9px;
  color: #64748b;
  flex: 1;
}

/* ── Messages ───────────────────────────────────── */
#sd-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scrollbar-width: thin;
  scrollbar-color: #1e293b transparent;
}
.sd-msg {
  padding: 8px 10px;
  border-radius: 8px;
  line-height: 1.5;
  word-break: break-word;
  position: relative;
}
.sd-msg-user {
  background: #1e3a5f;
  color: #bfdbfe;
  align-self: flex-end;
  max-width: 85%;
  text-align: right;
  border-left: none !important;
}
.sd-msg-assistant {
  background: #0f1f35;
  color: #e2e8f0;
  align-self: flex-start;
  max-width: 92%;
}
.sd-msg-text { display: block; }

.sd-suggested-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  align-items: center;
}
.sd-sugg-label {
  font-size: 10px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  width: 100%;
  margin-bottom: 2px;
}
.sd-sugg-action-btn {
  background: rgba(255,165,0,0.15);
  border: 1px solid rgba(255,165,0,0.4);
  color: #f5a623;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s;
}
.sd-sugg-action-btn:hover {
  background: rgba(255,165,0,0.3);
}
.sd-next-step-pill {
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  background: rgba(100,200,100,0.12);
  border: 1px solid rgba(100,200,100,0.35);
  border-radius: 10px;
  padding: 2px 10px;
  font-size: 10px;
  color: #5bc85b;
}
.sd-next-step-pill span::before {
  content: "→  ";
}
.sd-type-badge {
  display: inline-block;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  margin-bottom: 4px;
  font-weight: 700;
  letter-spacing: 0.05em;
}
.sd-highlight-btn {
  display: block;
  margin-top: 5px;
  background: none;
  border: none;
  color: #f59e0b;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  padding: 0;
}
.sd-typing {
  display: inline-block;
  color: #475569;
  font-size: 14px;
  animation: sdBlink 0.8s ease-in-out infinite;
  letter-spacing: 2px;
}

/* ── Welcome ────────────────────────────────────── */
#sd-welcome {
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.6;
  padding: 4px;
}
#sd-welcome strong { color: #f8fafc; }
#sd-welcome em { color: #60a5fa; }
#sd-welcome p { margin: 0 0 8px; }
#sd-welcome-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.sd-quick-btn {
  background: #1e293b;
  color: #94a3b8;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
.sd-quick-btn:hover { background: #334155; color: #f8fafc; }

/* ── Guided mode ────────────────────────────────── */
.sd-guided-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1a2010;
  border: 1px solid #2d4a1a;
  border-radius: 8px;
  padding: 8px 10px;
  margin-top: 4px;
}
.sd-guided-label {
  font-size: 10px;
  color: #fbbf24;
  flex-shrink: 0;
}
.sd-guided-next {
  background: #2d4a1a;
  color: #4ade80;
  border: 1px solid #4ade80;
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
}
.sd-guided-stop {
  background: none;
  color: #64748b;
  border: none;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
  margin-left: auto;
}

/* ── Pending nav confirm ────────────────────────── */
.sd-pending-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #0a1628;
  border: 1px solid #1e3a5f;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 11px;
  color: #93c5fd;
}
.sd-pending-nav strong { color: #60a5fa; }
.sd-cancel-nav {
  margin-left: auto;
  background: none;
  border: none;
  color: #64748b;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
}

/* ── Aliases panel (dev mode) ───────────────────── */
#sd-aliases-panel {
  border-top: 1px solid #1e293b;
  padding: 6px 14px;
  flex-shrink: 0;
  background: #08111e;
}
.sd-aliases-toggle {
  background: none;
  border: none;
  color: #c084fc;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
  padding: 0;
}
.sd-aliases-list {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 100px;
  overflow-y: auto;
}
.sd-alias-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
}
.sd-alias-phrase { color: #c084fc; }
.sd-alias-arrow  { color: #475569; }
.sd-alias-route  { color: #60a5fa; flex: 1; }
.sd-alias-del {
  background: none;
  border: none;
  color: #475569;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
  padding: 0 2px;
}
.sd-alias-del:hover { color: #f87171; }

/* ── Input bar ──────────────────────────────────── */
#sd-input-bar {
  display: flex;
  padding: 8px 10px;
  border-top: 1px solid #1e293b;
  gap: 6px;
  background: #0a0f1a;
  flex-shrink: 0;
}
#sd-input {
  flex: 1;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 6px 10px;
  color: #f8fafc;
  font-family: inherit;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
#sd-input:focus { border-color: #f59e0b; }
#sd-input::placeholder { color: #475569; }
#sd-input:disabled { opacity: 0.5; }
#sd-send-btn {
  background: #f59e0b;
  color: #0a0f1a;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
  flex-shrink: 0;
}
#sd-send-btn:hover:not(:disabled) { background: #fbbf24; }
#sd-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Suggestions bar ────────────────────────────── */
#sd-suggestions {
  display: flex;
  gap: 4px;
  padding: 6px 10px 8px;
  background: #0a0f1a;
  flex-wrap: wrap;
  flex-shrink: 0;
  border-top: 1px solid #1e293b;
}
.sd-sugg-btn {
  background: #0f172a;
  color: #64748b;
  border: 1px solid #1e293b;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.sd-sugg-btn:hover { background: #1e293b; color: #94a3b8; }

/* ── Tour overlay ───────────────────────────────── */
#sd-tour-overlay {
  position: fixed;
  bottom: calc(20px + 90px);
  right: 24px;
  z-index: 9998;
  pointer-events: none;
}
#sd-tour-card {
  background: rgba(10,15,26,0.97);
  border: 1px solid #1e293b;
  border-radius: 14px;
  padding: 18px 20px;
  max-width: 320px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  pointer-events: all;
  font-family: ui-monospace, monospace;
}
#sd-tour-progress {
  display: flex;
  gap: 5px;
  margin-bottom: 12px;
}
.sd-tour-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #1e293b;
  transition: background 0.2s;
}
.sd-tour-dot.active { background: #f59e0b; }
.sd-tour-dot.done   { background: #4ade80; }
#sd-tour-text {
  font-size: 12px;
  color: #e2e8f0;
  line-height: 1.6;
  margin: 0 0 12px;
}
#sd-tour-skip {
  background: none;
  border: none;
  color: #475569;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
#sd-tour-skip:hover { color: #94a3b8; }
`;