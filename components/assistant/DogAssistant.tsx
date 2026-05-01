'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Minimize2, Maximize2, Zap, AlertTriangle, CheckCircle, Info } from 'lucide-react';

// ─── types ────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: 'user' | 'dog';
  text: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
  timestamp: Date;
}

interface AssistantResponse {
  message: string;
  highlight?: string | null;
  action?: string | null;
  severity?: 'info' | 'warning' | 'error' | 'success';
}

export interface DogContext {
  page: string;
  [key: string]: any;
}

interface DogAssistantProps {
  context: DogContext;
  onAction?: (action: string, context: DogContext) => void;
  defaultOpen?: boolean;
}

// ─── severity icon ─────────────────────────────────────────────────────────
function SeverityIcon({ severity }: { severity?: string }) {
  if (severity === 'error')   return <AlertTriangle size={11} className="text-red-400 shrink-0 mt-0.5" />;
  if (severity === 'warning') return <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-0.5" />;
  if (severity === 'success') return <CheckCircle   size={11} className="text-green-400 shrink-0 mt-0.5" />;
  return <Info size={11} className="text-blue-400 shrink-0 mt-0.5" />;
}

// ─── markdown-lite renderer (bold + newlines only) ─────────────────────────
function renderText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    }
    return part.split('\n').map((line, j) => (
      <span key={`${i}-${j}`}>{line}{j < part.split('\n').length - 1 && <br />}</span>
    ));
  });
}

// ─── typing indicator ──────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map(i => (
        <div key={i}
          className="w-1.5 h-1.5 rounded-full bg-yellow-400/70 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

// ─── quick prompts by page ─────────────────────────────────────────────────
const PAGE_QUICK: Record<string, string[]> = {
  engineering:  ['Check wire sizing', 'NEC violations?', 'Interconnect limit ok?', 'Review my BOM'],
  design:       ['Panel placement tips', 'Best azimuth for my roof', 'How many panels fit?', 'Shading impact?'],
  dashboard:    ['What needs attention?', 'Next steps?', 'Any red flags?'],
  projects:     ['Review this project', 'Missing anything?', 'Permit ready?'],
  proposals:    ['Financials look right?', 'Payback period?', 'ITC calculation?'],
  clients:      ['Client follow-up tips', 'Proposal ready?'],
  hardware:     ['Panel compatibility?', 'Inverter match?', 'String sizing help'],
  default:      ['What can you do?', 'Help me with NEC code', 'Explain net metering'],
};

// ─── main component ────────────────────────────────────────────────────────
export default function DogAssistant({ context, onAction, defaultOpen = false }: DogAssistantProps) {
  const [open, setOpen]         = useState(defaultOpen);
  const [minimized, setMin]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [input, setInput]       = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'dog',
      text: `Yo 👀 I'm **SolarDog** — your on-site AI. I know this page's context.\n\nAsk me anything about this project, NEC code, rates, or what looks wrong.`,
      severity: 'info',
      timestamp: new Date(),
    },
  ]);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  // auto-scroll on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // focus input when opened
  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, minimized]);

  const quickPrompts = PAGE_QUICK[context.page] ?? PAGE_QUICK.default;

  // ─── highlight helper ──────────────────────────────────────────────────
  const highlight = useCallback((id: string | null | undefined) => {
    if (!id) return;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px solid #facc15';
      el.style.boxShadow = '0 0 0 4px rgba(250,204,21,0.15)';
      setTimeout(() => {
        el.style.outline = '';
        el.style.boxShadow = '';
      }, 2500);
    }
  }, []);

  // ─── send message ──────────────────────────────────────────────────────
  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput('');

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: msg,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    // Build history for context (last 6 turns)
    const history = messages
      .filter(m => m.id !== 'welcome')
      .slice(-6)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant' as const, content: m.text }));

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, context, history }),
      });

      const data: AssistantResponse = await res.json();

      const dogMsg: Message = {
        id: `d-${Date.now()}`,
        role: 'dog',
        text: data.message ?? 'Woof — no response. Try again.',
        severity: data.severity,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, dogMsg]);

      // Highlight if requested
      if (data.highlight) highlight(data.highlight);

      // Fire action callback if provided
      if (data.action && onAction) onAction(data.action, context);

    } catch {
      setMessages(prev => [...prev, {
        id: `d-${Date.now()}`,
        role: 'dog',
        text: 'Network hiccup — try again in a sec 🐶',
        severity: 'warning',
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, context, highlight, onAction]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // ─── render ────────────────────────────────────────────────────────────
  return (
    <div className="fixed bottom-5 right-5 z-[9998] flex flex-col items-end gap-2 select-none">

      {/* ── chat panel ── */}
      {open && (
        <div className={`w-80 rounded-2xl shadow-2xl border border-white/10 bg-[#0d1420] flex flex-col overflow-hidden transition-all duration-200 ${
          minimized ? 'h-10' : 'h-[440px]'
        }`}>

          {/* header */}
          <div className="flex items-center gap-2 px-3 py-2 bg-[#111927] border-b border-white/[0.07] shrink-0">
            <span className="text-base leading-none">🐶</span>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-bold text-yellow-400">SolarDog</span>
              <span className="text-[10px] text-slate-500 ml-1.5">
                {context.page ? `on ${context.page}` : 'AI assistant'}
              </span>
            </div>
            {/* live dot */}
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" title="AI active"/>
            <button onClick={() => setMin(m => !m)}
              className="p-1 text-slate-600 hover:text-slate-300 transition-colors">
              {minimized ? <Maximize2 size={11}/> : <Minimize2 size={11}/>}
            </button>
            <button onClick={() => setOpen(false)}
              className="p-1 text-slate-600 hover:text-red-400 transition-colors">
              <X size={11}/>
            </button>
          </div>

          {!minimized && (
            <>
              {/* messages */}
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
                {messages.map(m => (
                  <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* avatar */}
                    <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${
                      m.role === 'user'
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-yellow-400/15 text-yellow-300'
                    }`}>
                      {m.role === 'user' ? '🧑' : '🐶'}
                    </div>
                    {/* bubble */}
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-blue-500/20 text-slate-200 rounded-tr-sm'
                        : 'bg-white/[0.05] text-slate-300 rounded-tl-sm'
                    }`}>
                      {m.role === 'dog' && (
                        <div className="flex items-start gap-1.5">
                          <SeverityIcon severity={m.severity}/>
                          <span>{renderText(m.text)}</span>
                        </div>
                      )}
                      {m.role === 'user' && <span>{m.text}</span>}
                    </div>
                  </div>
                ))}

                {/* typing indicator */}
                {loading && (
                  <div className="flex gap-2 items-start">
                    <div className="w-6 h-6 rounded-full bg-yellow-400/15 flex items-center justify-center text-[11px]">🐶</div>
                    <div className="bg-white/[0.05] rounded-xl rounded-tl-sm">
                      <TypingDots/>
                    </div>
                  </div>
                )}
                <div ref={bottomRef}/>
              </div>

              {/* quick prompts */}
              {messages.length <= 2 && !loading && (
                <div className="px-3 pb-2 flex flex-wrap gap-1">
                  {quickPrompts.map(q => (
                    <button key={q} onClick={() => send(q)}
                      className="text-[10px] px-2 py-1 rounded-lg bg-white/[0.05] text-slate-400 hover:bg-yellow-400/15 hover:text-yellow-300 border border-white/[0.07] transition-colors">
                      {q}
                    </button>
                  ))}
                </div>
              )}

              {/* input bar */}
              <div className="px-3 py-2.5 border-t border-white/[0.06] bg-[#0a1018] shrink-0">
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask SolarDog…"
                    maxLength={1000}
                    disabled={loading}
                    className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-yellow-400/40 disabled:opacity-50 transition-colors"
                  />
                  <button
                    onClick={() => send()}
                    disabled={!input.trim() || loading}
                    className="w-7 h-7 rounded-lg bg-yellow-400 hover:bg-yellow-300 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-all shrink-0"
                  >
                    <Send size={12} className="text-black"/>
                  </button>
                </div>
                <div className="text-[9px] text-slate-700 mt-1 text-center">
                  Context: {context.page} · AI-powered · not a substitute for engineer sign-off
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── launcher button ── */}
      <button
        onClick={() => { setOpen(o => !o); setMin(false); }}
        className={`w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-2xl transition-all duration-200 border-2 ${
          open
            ? 'bg-[#1a2030] border-white/20 scale-95'
            : 'bg-yellow-400 hover:bg-yellow-300 border-yellow-300/50 hover:scale-110 active:scale-95'
        }`}
        title="SolarDog AI Assistant"
      >
        {open ? '✕' : '🐶'}
      </button>

      {/* ── unread badge (shows when closed and messages > 1) ── */}
      {!open && messages.length > 1 && (
        <div className="absolute top-0 right-0 w-4 h-4 rounded-full bg-red-500 text-[9px] text-white font-bold flex items-center justify-center pointer-events-none">
          {messages.filter(m => m.role === 'dog').length - 1}
        </div>
      )}
    </div>
  );
}