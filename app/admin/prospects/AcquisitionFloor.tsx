'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The sweatshop floor. A top-down "tabletop" of neon rooms — one per pipeline
 * stage — with little robot workers that wander around. Worker counts and the
 * stage tallies are driven by the REAL prospect data. Click a room to drop into
 * those leads (switches the parent page to the filtered list view).
 */

type Stage =
  | 'discovered' | 'enriched' | 'qualified' | 'contacted' | 'signed_up' | 'rejected';

type RoomDef = {
  stage: Stage;
  name: string;
  tag: string;
  color: string;   // neon line color
  glow: string;    // box-shadow glow
  body: string;    // robot body accent
  lines: string[]; // speech bubble pool
};

const ROOMS: RoomDef[] = [
  { stage: 'discovered', name: 'SCOUTING', tag: 'Discovery', color: '#5eead4', glow: 'rgba(45,212,191,0.35)', body: '#2dd4bf',
    lines: ['found one! 🔍', 'scanning…', 'new installer!', 'Google says…', 'got a lead', 'another!'] },
  { stage: 'enriched', name: 'ENRICHING', tag: 'Contact intel', color: '#7dd3fc', glow: 'rgba(56,189,248,0.35)', body: '#38bdf8',
    lines: ['got the email ✉️', 'phone ✓', 'scraping site', 'nice rating ⭐', 'website found'] },
  { stage: 'qualified', name: 'QUALIFYING', tag: 'Vetting', color: '#c4b5fd', glow: 'rgba(167,139,250,0.35)', body: '#a78bfa',
    lines: ['licensed ✓', 'looks legit', 'vetting…', 'grade A?', 'NABCEP ✓'] },
  { stage: 'contacted', name: 'OUTREACH', tag: 'Pitching', color: '#fcd34d', glow: 'rgba(251,191,36,0.35)', body: '#fbbf24',
    lines: ['sent! 📨', 'following up', 'left a vm', 'warming up…'] },
  { stage: 'signed_up', name: 'CLOSED', tag: 'Customers', color: '#6ee7b7', glow: 'rgba(52,211,153,0.4)', body: '#34d399',
    lines: ['🎉 closed!', 'ka-ching 💰', 'welcome aboard', 'subscribed!'] },
  { stage: 'rejected', name: 'ARCHIVE', tag: 'Passed', color: '#fda4af', glow: 'rgba(244,63,94,0.3)', body: '#fb7185',
    lines: ['no thanks', 'not a fit', 'maybe later', '💤'] },
];

function workersFor(count: number): number {
  if (count <= 0) return 1;            // a lonely idle bot
  return Math.min(6, Math.max(1, Math.round(count / 12)));
}

type Worker = { id: string; stage: Stage; body: string };
type Pos = { x: number; y: number; tx: number; ty: number; speed: number; dir: number };

// deterministic-ish pseudo-random seeded by index (Math.random is fine here —
// purely cosmetic, client-only, never persisted)
function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function Robot({ body }: { body: string }) {
  return (
    <svg width="24" height="26" viewBox="0 0 24 26" style={{ display: 'block' }}>
      {/* antenna */}
      <line x1="12" y1="2" x2="12" y2="6" stroke="#94a3b8" strokeWidth="1.5" />
      <circle cx="12" cy="2" r="1.5" fill={body} />
      {/* head */}
      <rect x="5" y="5" width="14" height="10" rx="2.5" fill="#1e293b" stroke={body} strokeWidth="1.5" />
      <circle cx="9.5" cy="10" r="1.6" fill={body} />
      <circle cx="14.5" cy="10" r="1.6" fill={body} />
      {/* body */}
      <rect x="6" y="15" width="12" height="8" rx="2" fill="#0f172a" stroke={body} strokeWidth="1.3" />
      <rect x="9" y="17" width="6" height="2" rx="1" fill={body} opacity="0.7" />
      {/* legs */}
      <rect x="8" y="23" width="2.5" height="2.5" fill="#475569" />
      <rect x="13.5" y="23" width="2.5" height="2.5" fill="#475569" />
    </svg>
  );
}

export default function AcquisitionFloor({
  byStage,
  total,
  onEnterRoom,
}: {
  byStage: Record<string, number>;
  total: number;
  onEnterRoom: (stage: Stage) => void;
}) {
  const floorRefs = useRef<Map<Stage, HTMLDivElement | null>>(new Map());
  const workerEls = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const spriteEls = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const posRef = useRef<Map<string, Pos>>(new Map());
  const [bubbles, setBubbles] = useState<Record<string, string>>({});

  // Build the worker roster from the real counts.
  const workers = useMemo<Worker[]>(() => {
    const list: Worker[] = [];
    for (const room of ROOMS) {
      const n = workersFor(byStage[room.stage] ?? 0);
      for (let i = 0; i < n; i++) {
        list.push({ id: `${room.stage}-${i}`, stage: room.stage, body: room.body });
      }
    }
    return list;
  }, [byStage]);

  // Seed positions whenever the roster changes.
  useEffect(() => {
    const next = new Map<string, Pos>();
    for (const w of workers) {
      const prev = posRef.current.get(w.id);
      next.set(w.id, prev ?? {
        x: rand(10, 120), y: rand(10, 90),
        tx: rand(10, 120), ty: rand(10, 90),
        speed: rand(0.25, 0.6), dir: 1,
      });
    }
    posRef.current = next;
  }, [workers]);

  // The wander loop — mutates DOM directly, no React re-render per frame.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (const w of workers) {
        const p = posRef.current.get(w.id);
        const el = workerEls.current.get(w.id);
        const floor = floorRefs.current.get(w.stage);
        if (!p || !el || !floor) continue;
        const maxX = Math.max(20, floor.clientWidth - 24);
        const maxY = Math.max(20, floor.clientHeight - 30);
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 2) {
          p.tx = rand(6, maxX);
          p.ty = rand(6, maxY);
        } else {
          p.x += (dx / dist) * p.speed;
          p.y += (dy / dist) * p.speed;
          const newDir = dx >= 0 ? 1 : -1;
          if (newDir !== p.dir) {
            p.dir = newDir;
            const sprite = spriteEls.current.get(w.id);
            if (sprite) sprite.style.transform = `scaleX(${newDir})`;
          }
        }
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [workers]);

  // Occasional speech bubbles.
  useEffect(() => {
    if (workers.length === 0) return;
    const lineFor = (stage: Stage) => {
      const room = ROOMS.find((r) => r.stage === stage)!;
      return room.lines[Math.floor(Math.random() * room.lines.length)];
    };
    const iv = setInterval(() => {
      const w = workers[Math.floor(Math.random() * workers.length)];
      // idle rooms (no leads) stay mostly quiet
      if ((byStage[w.stage] ?? 0) === 0 && Math.random() > 0.3) return;
      setBubbles((b) => ({ ...b, [w.id]: lineFor(w.stage) }));
      setTimeout(() => {
        setBubbles((b) => {
          const n = { ...b };
          delete n[w.id];
          return n;
        });
      }, 1900);
    }, 1400);
    return () => clearInterval(iv);
  }, [workers, byStage]);

  const workersByRoom = useMemo(() => {
    const m = new Map<Stage, Worker[]>();
    for (const w of workers) {
      const arr = m.get(w.stage) ?? [];
      arr.push(w);
      m.set(w.stage, arr);
    }
    return m;
  }, [workers]);

  return (
    <div className="relative">
      <style>{`
        @keyframes floorBob { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-2.5px) } }
        @keyframes bubblePop { 0%{ opacity:0; transform: translateY(4px) scale(.8) } 15%{ opacity:1; transform: translateY(0) scale(1) } 85%{ opacity:1 } 100%{ opacity:0 } }
        @keyframes gridPulse { 0%,100%{ opacity:.25 } 50%{ opacity:.4 } }
        .floor-grid {
          background-image:
            linear-gradient(rgba(45,212,191,0.12) 1px, transparent 1px),
            linear-gradient(90deg, rgba(45,212,191,0.12) 1px, transparent 1px);
          background-size: 26px 26px;
        }
      `}</style>

      {/* Tabletop */}
      <div
        className="rounded-2xl border border-white/5 bg-[#070b16] p-6 md:p-10 overflow-hidden"
        style={{ perspective: '1500px' }}
      >
        <div
          className="floor-grid rounded-xl"
          style={{ transform: 'rotateX(20deg)', transformStyle: 'preserve-3d' }}
        >
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-5 p-2">
            {ROOMS.map((room) => {
              const count = byStage[room.stage] ?? 0;
              const roomWorkers = workersByRoom.get(room.stage) ?? [];
              const idle = count === 0;
              return (
                <button
                  key={room.stage}
                  onClick={() => onEnterRoom(room.stage)}
                  className="group text-left rounded-lg p-3 transition-transform hover:-translate-y-1 focus:outline-none"
                  style={{
                    border: `1.5px solid ${room.color}`,
                    boxShadow: `0 0 18px ${room.glow}, inset 0 0 24px rgba(0,0,0,0.5)`,
                    background: 'linear-gradient(180deg, rgba(13,20,36,0.9), rgba(7,11,22,0.95))',
                  }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <div className="text-[11px] font-bold tracking-[0.2em]" style={{ color: room.color }}>
                        {room.name}
                      </div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">{room.tag}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-extrabold text-white leading-none">{count}</div>
                      <div className="text-[8px] text-slate-500 uppercase">leads</div>
                    </div>
                  </div>

                  {/* Floor area where bots wander */}
                  <div
                    ref={(el) => { floorRefs.current.set(room.stage, el); }}
                    className="relative h-28 md:h-32 rounded-md overflow-hidden"
                    style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,255,255,0.03), transparent 70%)' }}
                  >
                    {roomWorkers.map((w) => (
                      <div
                        key={w.id}
                        ref={(el) => { workerEls.current.set(w.id, el); }}
                        className="absolute top-0 left-0 will-change-transform"
                        style={{ transform: 'translate(20px, 20px)' }}
                      >
                        {/* speech bubble */}
                        {bubbles[w.id] && (
                          <div
                            className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 rounded text-[8px] font-medium text-slate-900 bg-white/90"
                            style={{ animation: 'bubblePop 1.9s ease-in-out forwards' }}
                          >
                            {bubbles[w.id]}
                          </div>
                        )}
                        {/* sprite: outer=flip, inner=bob */}
                        <div ref={(el) => { spriteEls.current.set(w.id, el); }} style={{ transform: 'scaleX(1)' }}>
                          <div style={{ animation: `floorBob ${idle ? 0 : 1.4}s ease-in-out infinite`, opacity: idle ? 0.5 : 1 }}>
                            <Robot body={room.body} />
                          </div>
                        </div>
                      </div>
                    ))}

                    {idle && (
                      <div className="absolute inset-0 flex items-center justify-center text-[9px] text-slate-600 pointer-events-none">
                        nobody here yet 💤
                      </div>
                    )}
                  </div>

                  <div className="mt-2 text-[9px] text-slate-500 group-hover:text-white transition-colors">
                    click to open →
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Caption */}
      <div className="mt-3 text-center text-xs text-slate-500">
        {total} installers on the floor · {workers.length} bots clocked in · counts are live from your pipeline
      </div>
    </div>
  );
}
