'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The works — a gaslit 1800s-Poe-esque acquisition house. One candlelit chamber
 * per pipeline stage, each crammed with desks + glowing computers, clerk-bots
 * typing or wandering, a top-hatted supervisor pacing the mezzanine barking
 * orders, drifting embers. Worker counts + chamber tallies are LIVE from the
 * real prospect data. Click a chamber to open those leads. "Dispatch the scouts"
 * seeds the floor directly (no migration runner).
 */

type Stage =
  | 'discovered' | 'enriched' | 'qualified' | 'contacted' | 'signed_up' | 'rejected';

type RoomDef = {
  stage: Stage; name: string; tag: string;
  accent: string; glow: string; lines: string[];
};

const ROOMS: RoomDef[] = [
  { stage: 'discovered', name: 'THE SCOUTING ROOM', tag: 'Discovery', accent: '#5eead4', glow: 'rgba(45,212,191,0.28)',
    lines: ['a new prospect…', 'found in the ledger', 'another name!', 'by candlelight I spy one', 'the search continues'] },
  { stage: 'enriched', name: 'THE COPYING ROOM', tag: 'Contact intel', accent: '#7dd3fc', glow: 'rgba(56,189,248,0.28)',
    lines: ['their telegraph № ✓', 'an address!', 'the dossier grows', 'copying particulars…'] },
  { stage: 'qualified', name: 'THE ASSAY ROOM', tag: 'Vetting', accent: '#c4b5fd', glow: 'rgba(167,139,250,0.28)',
    lines: ['licensed, I deem', 'a worthy firm', 'inspecting credentials…', 'grade A, surely'] },
  { stage: 'contacted', name: 'THE POST ROOM', tag: 'Pitching', accent: '#fcd34d', glow: 'rgba(251,191,36,0.30)',
    lines: ['a letter is sent ✉', 'awaiting reply…', 'posted by courier', 'no word yet…'] },
  { stage: 'signed_up', name: 'THE COUNTING HOUSE', tag: 'Customers', accent: '#6ee7b7', glow: 'rgba(52,211,153,0.34)',
    lines: ['a deal struck! 🎉', 'signed in ink', 'welcome, partner', 'the coffers fill 💰'] },
  { stage: 'rejected', name: 'THE CATACOMBS', tag: 'Passed', accent: '#fda4af', glow: 'rgba(244,63,94,0.26)',
    lines: ['nevermore', 'filed away', 'not this one', 'dust to dust'] },
];

const SUPERVISOR_LINES = [
  'Idle hands, idle profits!',
  'Find me more installers!',
  'Quoth the quota: MORE.',
  'Back to your desks, the lot of you!',
  'The marketplace hungers.',
  'Faster, my little engines!',
];

// fixed desk anchors (% of chamber floor) — "computers everywhere"
const DESKS = [
  { left: 16, top: 24 }, { left: 60, top: 20 }, { left: 38, top: 58 },
];

function workersFor(count: number): number {
  if (count <= 0) return 1;
  return Math.min(6, Math.max(1, Math.round(count / 11)));
}
function rand(min: number, max: number) { return min + Math.random() * (max - min); }

function Desk({ accent, delay }: { accent: string; delay: number }) {
  return (
    <svg width="50" height="40" viewBox="0 0 50 40" style={{ display: 'block' }}>
      {/* desk */}
      <rect x="4" y="30" width="42" height="7" rx="1.5" fill="#3b2a1c" stroke="#1c130b" strokeWidth="1" />
      <rect x="7" y="36" width="3" height="4" fill="#241a10" />
      <rect x="40" y="36" width="3" height="4" fill="#241a10" />
      {/* monitor */}
      <rect x="14" y="9" width="22" height="17" rx="2" fill="#0a0f1a" stroke="#241a10" strokeWidth="1.5" />
      <rect x="16.5" y="11.5" width="17" height="12" rx="1" fill={accent} opacity="0.85"
        style={{ animation: `screenFlicker 2.6s ease-in-out ${delay}s infinite` }} />
      {/* scanlines */}
      <rect x="16.5" y="14" width="17" height="0.8" fill="#0a0f1a" opacity="0.4" />
      <rect x="16.5" y="18" width="17" height="0.8" fill="#0a0f1a" opacity="0.4" />
      <rect x="22" y="26" width="6" height="4" fill="#1c130b" /> {/* stand */}
      {/* keyboard */}
      <rect x="17" y="30" width="16" height="3" rx="1" fill="#2a1d12" />
    </svg>
  );
}

function ClerkBot({ accent, seated }: { accent: string; seated?: boolean }) {
  return (
    <svg width="22" height="24" viewBox="0 0 24 26" style={{ display: 'block' }}>
      <line x1="12" y1="2" x2="12" y2="6" stroke="#7c6a52" strokeWidth="1.4" />
      <circle cx="12" cy="2" r="1.4" fill={accent} />
      <rect x="5" y="5" width="14" height="10" rx="2.5" fill="#1a130c" stroke={accent} strokeWidth="1.4" />
      <circle cx="9.5" cy="10" r="1.5" fill={accent} />
      <circle cx="14.5" cy="10" r="1.5" fill={accent} />
      <rect x="6" y="15" width="12" height="8" rx="2" fill="#120c06" stroke={accent} strokeWidth="1.2" />
      <rect x="9" y="17" width="6" height="2" rx="1" fill={accent} opacity="0.7" />
      {!seated && <><rect x="8" y="23" width="2.5" height="2.5" fill="#5b4636" /><rect x="13.5" y="23" width="2.5" height="2.5" fill="#5b4636" /></>}
    </svg>
  );
}

function Supervisor() {
  return (
    <svg width="30" height="40" viewBox="0 0 30 40" style={{ display: 'block' }}>
      {/* top hat */}
      <rect x="8" y="1" width="14" height="9" rx="1" fill="#0c0c0f" stroke="#b8860b" strokeWidth="1" />
      <rect x="5" y="9" width="20" height="2.5" rx="1" fill="#0c0c0f" stroke="#b8860b" strokeWidth="0.8" />
      <rect x="8" y="7" width="14" height="1.6" fill="#b8860b" opacity="0.7" />
      {/* head */}
      <rect x="9" y="12" width="12" height="9" rx="2.5" fill="#161009" stroke="#d4af37" strokeWidth="1.4" />
      <circle cx="13" cy="16.5" r="1.5" fill="#d4af37" />
      <circle cx="17" cy="16.5" r="1.5" fill="#d4af37" />
      {/* body w/ sash */}
      <rect x="8" y="21" width="14" height="12" rx="2" fill="#0f0a05" stroke="#d4af37" strokeWidth="1.3" />
      <line x1="9" y1="22" x2="21" y2="32" stroke="#b8860b" strokeWidth="1.6" opacity="0.8" />
      {/* legs + cane */}
      <rect x="11" y="33" width="3" height="6" fill="#5b4636" />
      <rect x="16" y="33" width="3" height="6" fill="#5b4636" />
      <line x1="24" y1="22" x2="24" y2="39" stroke="#b8860b" strokeWidth="1.6" />
      <circle cx="24" cy="21" r="1.6" fill="#d4af37" />
    </svg>
  );
}

type Pos = { x: number; y: number; tx: number; ty: number; speed: number; dir: number };

export default function AcquisitionFloor({
  byStage, total, onEnterRoom, onDispatched,
}: {
  byStage: Record<string, number>;
  total: number;
  onEnterRoom: (stage: Stage) => void;
  onDispatched: () => void;
}) {
  const floorRefs = useRef<Map<Stage, HTMLDivElement | null>>(new Map());
  const wanderEls = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const spriteEls = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const posRef = useRef<Map<string, Pos>>(new Map());
  const [bubbles, setBubbles] = useState<Record<string, string>>({});

  const supRef = useRef<HTMLDivElement | null>(null);
  const supLaneRef = useRef<HTMLDivElement | null>(null);
  const supPos = useRef({ x: 20, tx: 200, dir: 1 });
  const [supLine, setSupLine] = useState<string>('');

  const [dispatching, setDispatching] = useState(false);
  const [dispatchMsg, setDispatchMsg] = useState<string>('');

  // roster per room: seated (at desks) + wanderers
  const rooms = useMemo(() => ROOMS.map((r) => {
    const count = byStage[r.stage] ?? 0;
    const n = workersFor(count);
    const seated = Math.min(n, DESKS.length);
    return { ...r, count, total: n, seated, wanderers: Math.max(0, n - seated) };
  }), [byStage]);

  const wanderers = useMemo(() => {
    const list: { id: string; stage: Stage; accent: string }[] = [];
    for (const r of rooms) for (let i = 0; i < r.wanderers; i++) {
      list.push({ id: `${r.stage}-wander-${i}`, stage: r.stage, accent: r.accent });
    }
    return list;
  }, [rooms]);

  useEffect(() => {
    const next = new Map<string, Pos>();
    for (const w of wanderers) {
      next.set(w.id, posRef.current.get(w.id) ?? {
        x: rand(10, 120), y: rand(10, 80), tx: rand(10, 120), ty: rand(10, 80),
        speed: rand(0.22, 0.5), dir: 1,
      });
    }
    posRef.current = next;
  }, [wanderers]);

  // wander loop (DOM-direct)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (const w of wanderers) {
        const p = posRef.current.get(w.id);
        const el = wanderEls.current.get(w.id);
        const floor = floorRefs.current.get(w.stage);
        if (!p || !el || !floor) continue;
        const maxX = Math.max(20, floor.clientWidth - 22);
        const maxY = Math.max(20, floor.clientHeight - 26);
        const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
        if (d < 2) { p.tx = rand(6, maxX); p.ty = rand(6, maxY); }
        else {
          p.x += (dx / d) * p.speed; p.y += (dy / d) * p.speed;
          const nd = dx >= 0 ? 1 : -1;
          if (nd !== p.dir) { p.dir = nd; const s = spriteEls.current.get(w.id); if (s) s.style.transform = `scaleX(${nd})`; }
        }
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [wanderers]);

  // supervisor pacing
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const lane = supLaneRef.current, el = supRef.current, p = supPos.current;
      if (lane && el) {
        const max = Math.max(40, lane.clientWidth - 36);
        if (Math.abs(p.tx - p.x) < 3) { p.tx = rand(0, max); }
        const dir = p.tx - p.x >= 0 ? 1 : -1;
        if (dir !== p.dir) { p.dir = dir; el.style.transform = `translateX(${p.x}px) scaleX(${dir})`; }
        p.x += dir * 0.7;
        el.style.transform = `translateX(${p.x}px) scaleX(${p.dir})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // supervisor barks
  useEffect(() => {
    const iv = setInterval(() => {
      setSupLine(SUPERVISOR_LINES[Math.floor(Math.random() * SUPERVISOR_LINES.length)]);
      setTimeout(() => setSupLine(''), 2600);
    }, 4200);
    return () => clearInterval(iv);
  }, []);

  // worker speech bubbles (seated + wanderers)
  useEffect(() => {
    const ids: { id: string; stage: Stage }[] = [];
    for (const r of rooms) {
      for (let i = 0; i < r.seated; i++) ids.push({ id: `${r.stage}-seat-${i}`, stage: r.stage });
      for (let i = 0; i < r.wanderers; i++) ids.push({ id: `${r.stage}-wander-${i}`, stage: r.stage });
    }
    if (ids.length === 0) return;
    const iv = setInterval(() => {
      const pick = ids[Math.floor(Math.random() * ids.length)];
      if ((byStage[pick.stage] ?? 0) === 0 && Math.random() > 0.25) return;
      const room = ROOMS.find((r) => r.stage === pick.stage)!;
      const line = room.lines[Math.floor(Math.random() * room.lines.length)];
      setBubbles((b) => ({ ...b, [pick.id]: line }));
      setTimeout(() => setBubbles((b) => { const n = { ...b }; delete n[pick.id]; return n; }), 2000);
    }, 1300);
    return () => clearInterval(iv);
  }, [rooms, byStage]);

  async function dispatch() {
    setDispatching(true);
    setDispatchMsg('The scouts ride out into the night…');
    try {
      const res = await fetch('/api/admin/prospects/seed', { method: 'POST' });
      const data = await res.json();
      if (data.success || typeof data.total === 'number') {
        setDispatchMsg(`${data.total} installers rounded up and marched in!`);
        onDispatched();
      } else {
        setDispatchMsg(data.error || data.message || 'The scouts returned empty-handed.');
      }
    } catch (e) {
      setDispatchMsg('The scouts were lost to the fog. ' + (e as Error).message);
    } finally {
      setDispatching(false);
      setTimeout(() => setDispatchMsg(''), 6000);
    }
  }

  return (
    <div className="relative">
      <style>{`
        @keyframes floorBob { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-2.5px) } }
        @keyframes typeBob { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-1.2px) } }
        @keyframes bubblePop { 0%{ opacity:0; transform: translateY(4px) scale(.85) } 15%{ opacity:1; transform: translateY(0) scale(1) } 85%{ opacity:1 } 100%{ opacity:0 } }
        @keyframes screenFlicker { 0%,100%{ opacity:.85 } 45%{ opacity:.62 } 55%{ opacity:.95 } 70%{ opacity:.7 } }
        @keyframes candle { 0%,100%{ opacity:.85; transform: scaleY(1) } 50%{ opacity:1; transform: scaleY(1.12) } }
        @keyframes ember { 0%{ transform: translateY(0) translateX(0); opacity:0 } 10%{opacity:.7} 100%{ transform: translateY(-220px) translateX(20px); opacity:0 } }
        .paper-grid {
          background-image: radial-gradient(rgba(212,175,55,0.06) 1px, transparent 1px);
          background-size: 22px 22px;
        }
      `}</style>

      {/* Mezzanine: supervisor + dispatch */}
      <div className="flex items-center gap-4 mb-3">
        <div ref={supLaneRef} className="relative flex-1 h-14 rounded-lg border border-amber-900/40 bg-gradient-to-b from-[#1a1208] to-[#0c0905] overflow-hidden">
          <div className="absolute top-1 left-3 text-[9px] uppercase tracking-[0.25em] text-amber-700/80">The Overseer's Mezzanine</div>
          <div ref={supRef} className="absolute bottom-0 left-0 will-change-transform" style={{ transform: 'translateX(20px)' }}>
            {supLine && (
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded text-[9px] font-semibold text-amber-100 bg-amber-950/90 border border-amber-700/50" style={{ animation: 'bubblePop 2.6s ease-in-out forwards' }}>
                {supLine}
              </div>
            )}
            <Supervisor />
          </div>
        </div>
        <button
          onClick={dispatch}
          disabled={dispatching}
          className="flex-shrink-0 px-5 py-3 rounded-lg font-semibold text-sm text-amber-100 border border-amber-600/60 bg-gradient-to-b from-amber-800/40 to-amber-950/60 hover:from-amber-700/50 hover:to-amber-900/70 disabled:opacity-60 transition-all shadow-[0_0_18px_rgba(251,191,36,0.25)]"
        >
          {dispatching ? '🐎 The scouts ride out…' : '🐎 Dispatch the scouts'}
        </button>
      </div>
      {dispatchMsg && (
        <div className="mb-3 text-center text-xs text-amber-300/90 italic">{dispatchMsg}</div>
      )}

      {/* The house */}
      <div className="relative rounded-2xl border border-amber-950/60 bg-[#070504] p-6 md:p-10 overflow-hidden"
        style={{ perspective: '1500px', boxShadow: 'inset 0 0 120px rgba(0,0,0,0.9)' }}>
        {/* warm vignette */}
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(251,191,36,0.07), transparent 60%)' }} />
        {/* drifting embers */}
        {[...Array(7)].map((_, i) => (
          <div key={i} className="pointer-events-none absolute rounded-full" style={{
            left: `${10 + i * 13}%`, bottom: '4%', width: 3, height: 3, background: '#f59e0b',
            filter: 'blur(0.5px)', animation: `ember ${6 + i}s linear ${i * 1.3}s infinite`,
          }} />
        ))}

        <div className="paper-grid rounded-xl relative" style={{ transform: 'rotateX(18deg)', transformStyle: 'preserve-3d' }}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-5 p-2">
            {rooms.map((room) => {
              const idle = room.count === 0;
              const seatList = Array.from({ length: room.seated }, (_, i) => i);
              const wlist = wanderers.filter((w) => w.stage === room.stage);
              return (
                <button
                  key={room.stage}
                  onClick={() => onEnterRoom(room.stage)}
                  className="group text-left rounded-lg p-3 transition-transform hover:-translate-y-1 focus:outline-none"
                  style={{
                    border: `1.5px solid ${room.accent}55`,
                    boxShadow: `0 0 16px ${room.glow}, inset 0 0 30px rgba(0,0,0,0.7)`,
                    background: 'linear-gradient(180deg, rgba(26,18,10,0.95), rgba(10,7,4,0.97))',
                  }}
                >
                  {/* plaque */}
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <div className="text-[11px] font-bold tracking-[0.16em]" style={{ color: room.accent, fontFamily: 'Georgia, serif' }}>
                        ❧ {room.name}
                      </div>
                      <div className="text-[9px] text-amber-700/70 uppercase tracking-wider">{room.tag}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-extrabold text-amber-50 leading-none" style={{ fontFamily: 'Georgia, serif' }}>{room.count}</div>
                      <div className="text-[8px] text-amber-700/70 uppercase">souls</div>
                    </div>
                  </div>

                  {/* chamber floor */}
                  <div
                    ref={(el) => { floorRefs.current.set(room.stage, el); }}
                    className="relative h-32 md:h-36 rounded-md overflow-hidden"
                    style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(251,191,36,0.05), transparent 70%)' }}
                  >
                    {/* candle in the corner */}
                    <div className="absolute top-1.5 right-1.5">
                      <div style={{ width: 3, height: 8, background: '#e8d8b0', margin: '0 auto', borderRadius: 1 }} />
                      <div style={{ width: 4, height: 6, margin: '-3px auto 0', borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                        background: 'radial-gradient(circle, #fff6cc, #f59e0b 60%, transparent)', animation: 'candle 1.1s ease-in-out infinite', transformOrigin: 'bottom' }} />
                    </div>

                    {/* desks (computers everywhere) */}
                    {DESKS.map((d, i) => (
                      <div key={i} className="absolute" style={{ left: `${d.left}%`, top: `${d.top}%` }}>
                        <Desk accent={room.accent} delay={i * 0.7} />
                        {/* seated clerk in front of the desk */}
                        {seatList.includes(i) && (
                          <div className="absolute" style={{ left: 14, top: 30 }}>
                            {bubbles[`${room.stage}-seat-${i}`] && (
                              <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 rounded text-[8px] font-medium text-amber-950 bg-amber-100/95" style={{ animation: 'bubblePop 2s ease-in-out forwards' }}>
                                {bubbles[`${room.stage}-seat-${i}`]}
                              </div>
                            )}
                            <div style={{ animation: 'typeBob 0.5s ease-in-out infinite' }}>
                              <ClerkBot accent={room.accent} seated />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* wandering clerks */}
                    {wlist.map((w) => (
                      <div key={w.id} ref={(el) => { wanderEls.current.set(w.id, el); }} className="absolute top-0 left-0 will-change-transform" style={{ transform: 'translate(20px,20px)' }}>
                        {bubbles[w.id] && (
                          <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 rounded text-[8px] font-medium text-amber-950 bg-amber-100/95" style={{ animation: 'bubblePop 2s ease-in-out forwards' }}>
                            {bubbles[w.id]}
                          </div>
                        )}
                        <div ref={(el) => { spriteEls.current.set(w.id, el); }} style={{ transform: 'scaleX(1)' }}>
                          <div style={{ animation: 'floorBob 1.4s ease-in-out infinite' }}>
                            <ClerkBot accent={room.accent} />
                          </div>
                        </div>
                      </div>
                    ))}

                    {idle && (
                      <div className="absolute inset-0 flex items-center justify-center text-[9px] text-amber-800/70 italic pointer-events-none" style={{ fontFamily: 'Georgia, serif' }}>
                        this chamber lies vacant…
                      </div>
                    )}
                  </div>

                  <div className="mt-2 text-[9px] text-amber-700/60 group-hover:text-amber-300 transition-colors" style={{ fontFamily: 'Georgia, serif' }}>
                    enter →
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 text-center text-xs text-amber-800/70 italic" style={{ fontFamily: 'Georgia, serif' }}>
        {total} installers within these walls · {rooms.reduce((s, r) => s + r.total, 0)} clerks at their desks · the ledgers update in real time
      </div>
    </div>
  );
}
