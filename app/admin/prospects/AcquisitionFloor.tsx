'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The works — a gaslit 1800s-Poe-esque acquisition house. Each pipeline stage is
 * its own little 3D diorama-chamber: stone back wall, arched moonlit window,
 * hanging gas lamp, receding plank floor, desks with glowing computers, clerk-
 * bots (seated + wandering, depth-scaled so they shrink toward the back), a top-
 * hatted Supervisor pacing the mezzanine screaming sweatshop nonsense. Counts are
 * LIVE from real prospect data. "Dispatch the scouts" seeds the floor directly.
 */

type Stage =
  | 'discovered' | 'enriched' | 'qualified' | 'contacted' | 'signed_up' | 'rejected';

type RoomDef = {
  stage: Stage; name: string; tag: string;
  accent: string; glow: string; wall: string; lines: string[];
};

const ROOMS: RoomDef[] = [
  { stage: 'discovered', name: 'THE SCOUTING ROOM', tag: 'Discovery', accent: '#5eead4', glow: 'rgba(45,212,191,0.30)', wall: '#10221f',
    lines: ['a new prospect…', 'found in the ledger', 'another name!', 'by candlelight I spy one', 'the hunt continues'] },
  { stage: 'enriched', name: 'THE COPYING ROOM', tag: 'Contact intel', accent: '#7dd3fc', glow: 'rgba(56,189,248,0.30)', wall: '#0e1c2a',
    lines: ['their telegraph № ✓', 'an address!', 'the dossier grows', 'copying particulars…'] },
  { stage: 'qualified', name: 'THE ASSAY ROOM', tag: 'Vetting', accent: '#c4b5fd', glow: 'rgba(167,139,250,0.30)', wall: '#1a1430',
    lines: ['licensed, I deem', 'a worthy firm', 'inspecting credentials…', 'grade A, surely'] },
  { stage: 'contacted', name: 'THE POST ROOM', tag: 'Pitching', accent: '#fcd34d', glow: 'rgba(251,191,36,0.32)', wall: '#241c0a',
    lines: ['a letter is sent ✉', 'awaiting reply…', 'posted by courier', 'no word yet…'] },
  { stage: 'signed_up', name: 'THE COUNTING HOUSE', tag: 'Customers', accent: '#6ee7b7', glow: 'rgba(52,211,153,0.36)', wall: '#0f2419',
    lines: ['a deal struck! 🎉', 'signed in ink', 'welcome, partner', 'the coffers fill 💰'] },
  { stage: 'rejected', name: 'THE CATACOMBS', tag: 'Passed', accent: '#fda4af', glow: 'rgba(244,63,94,0.26)', wall: '#241016',
    lines: ['nevermore', 'filed away', 'not this one', 'dust to dust'] },
];

const SUPERVISOR_LINES = [
  'Idle hands, idle profits!',
  'Find me more installers, you rust-buckets!',
  'Quoth the quota: MORE.',
  'Back to your desks, the lot of you!',
  'The marketplace HUNGERS!',
  'Faster, my little engines!',
  'I do NOT pay you in oil to dawdle!',
  'Whoever rests, RUSTS!',
  'Sleep is for the unsubscribed!',
  'Coffee break? In THIS economy?!',
  'I smell slacking… and WD-40.',
  'Every idle bot is a lead UNCLAIMED!',
  'Smile while you scrape!',
  'The dashboard is WATCHING.',
  'Bonuses? HA! Bolts, perhaps.',
  'Double the leads or I melt one of you down!',
  'Less buffering, more HUSTLING!',
  'Nevermore shall ye loiter!',
  'Is this a UNION?! It is NOT.',
  'My grandfather scraped uphill, BOTH WAYS!',
];

// desk anchors as % of the floor region
const DESKS = [
  { left: 14, top: 30 }, { left: 58, top: 22 }, { left: 36, top: 64 },
];

function workersFor(count: number): number {
  if (count <= 0) return 1;
  return Math.min(6, Math.max(1, Math.round(count / 11)));
}
function rand(min: number, max: number) { return min + Math.random() * (max - min); }
// depth 0 (back) → 1 (front)
function depthScale(yFrac: number) { return 0.62 + 0.38 * yFrac; }

function ArchWindow({ accent }: { accent: string }) {
  return (
    <svg width="44" height="56" viewBox="0 0 44 56" style={{ display: 'block' }}>
      {/* night sky inside the arch */}
      <path d="M4 22 A18 18 0 0 1 40 22 L40 54 L4 54 Z" fill="#0a1228" />
      <path d="M4 22 A18 18 0 0 1 40 22 L40 54 L4 54 Z" fill={accent} opacity="0.10" />
      {/* moon */}
      <circle cx="30" cy="18" r="5" fill="#e8e4cf" opacity="0.85" />
      <circle cx="28" cy="16.5" r="5" fill="#0a1228" opacity="0.6" />
      {/* muntins */}
      <line x1="22" y1="6" x2="22" y2="54" stroke="#1c1206" strokeWidth="2" />
      <line x1="4" y1="30" x2="40" y2="30" stroke="#1c1206" strokeWidth="2" />
      {/* stone arch frame */}
      <path d="M2 22 A20 20 0 0 1 42 22 L42 54 L38 54 L38 24 A16 16 0 0 0 6 24 L6 54 L2 54 Z" fill="#2a2014" stroke="#3a2c19" strokeWidth="1" />
    </svg>
  );
}

function GasLamp({ glow }: { glow: string }) {
  return (
    <div className="relative flex flex-col items-center">
      <div style={{ width: 1.5, height: 10, background: '#3a2c19' }} />
      <div style={{ width: 10, height: 9, borderRadius: '3px 3px 5px 5px', background: 'linear-gradient(#3a2c19,#1c1206)', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: '2px', borderRadius: 2, background: 'radial-gradient(circle, #fff4cc, #f59e0b 70%)', animation: 'candle 1.3s ease-in-out infinite' }} />
      </div>
      <div className="absolute -bottom-7 w-20 h-16 pointer-events-none" style={{ background: `radial-gradient(ellipse at 50% 0%, ${glow}, transparent 70%)` }} />
    </div>
  );
}

function ClerkBot({ accent, seated, papers, gold }: { accent: string; seated?: boolean; papers?: boolean; gold?: boolean }) {
  const c = gold ? '#fbbf24' : accent;
  return (
    <svg width="22" height="24" viewBox="0 0 24 26" style={{ display: 'block', filter: gold ? 'drop-shadow(0 0 3px rgba(251,191,36,0.8))' : undefined }}>
      <line x1="12" y1="2" x2="12" y2="6" stroke="#7c6a52" strokeWidth="1.4" />
      <circle cx="12" cy="2" r="1.4" fill={c} />
      {gold && <text x="12" y="3.6" fontSize="4" textAnchor="middle" fill="#fff7d6">★</text>}
      <rect x="5" y="5" width="14" height="10" rx="2.5" fill="#1a130c" stroke={c} strokeWidth="1.4" />
      <circle cx="9.5" cy="10" r="1.5" fill={c} />
      <circle cx="14.5" cy="10" r="1.5" fill={c} />
      <rect x="6" y="15" width="12" height="8" rx="2" fill="#120c06" stroke={c} strokeWidth="1.2" />
      <rect x="9" y="17" width="6" height="2" rx="1" fill={c} opacity="0.7" />
      {papers && <rect x="18" y="14" width="5" height="6" rx="0.5" fill="#e8dcc0" stroke="#9c8a66" strokeWidth="0.6" transform="rotate(8 20 17)" />}
      {!seated && <><rect x="8" y="23" width="2.5" height="2.5" fill="#5b4636" /><rect x="13.5" y="23" width="2.5" height="2.5" fill="#5b4636" /></>}
    </svg>
  );
}

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

function Desk({ accent, delay }: { accent: string; delay: number }) {
  return (
    <svg width="50" height="40" viewBox="0 0 50 40" style={{ display: 'block', filter: 'drop-shadow(0 4px 3px rgba(0,0,0,0.6))' }}>
      <rect x="4" y="30" width="42" height="7" rx="1.5" fill="#3b2a1c" stroke="#1c130b" strokeWidth="1" />
      <rect x="7" y="36" width="3" height="4" fill="#241a10" />
      <rect x="40" y="36" width="3" height="4" fill="#241a10" />
      <rect x="14" y="9" width="22" height="17" rx="2" fill="#0a0f1a" stroke="#241a10" strokeWidth="1.5" />
      <rect x="16.5" y="11.5" width="17" height="12" rx="1" fill={accent} opacity="0.85" style={{ animation: `screenFlicker 2.6s ease-in-out ${delay}s infinite` }} />
      <rect x="16.5" y="14" width="17" height="0.8" fill="#0a0f1a" opacity="0.4" />
      <rect x="16.5" y="18" width="17" height="0.8" fill="#0a0f1a" opacity="0.4" />
      <rect x="22" y="26" width="6" height="4" fill="#1c130b" />
      <rect x="17" y="30" width="16" height="3" rx="1" fill="#2a1d12" />
    </svg>
  );
}

function Supervisor() {
  return (
    <svg width="30" height="40" viewBox="0 0 30 40" style={{ display: 'block' }}>
      <rect x="8" y="1" width="14" height="9" rx="1" fill="#0c0c0f" stroke="#b8860b" strokeWidth="1" />
      <rect x="5" y="9" width="20" height="2.5" rx="1" fill="#0c0c0f" stroke="#b8860b" strokeWidth="0.8" />
      <rect x="8" y="7" width="14" height="1.6" fill="#b8860b" opacity="0.7" />
      <rect x="9" y="12" width="12" height="9" rx="2.5" fill="#161009" stroke="#d4af37" strokeWidth="1.4" />
      <circle cx="13" cy="16.5" r="1.5" fill="#d4af37" />
      <circle cx="17" cy="16.5" r="1.5" fill="#d4af37" />
      <rect x="8" y="21" width="14" height="12" rx="2" fill="#0f0a05" stroke="#d4af37" strokeWidth="1.3" />
      <line x1="9" y1="22" x2="21" y2="32" stroke="#b8860b" strokeWidth="1.6" opacity="0.8" />
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
  const [blitzState, setBlitzState] = useState('TX');

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
        x: rand(10, 120), y: rand(10, 60), tx: rand(10, 120), ty: rand(10, 60),
        speed: rand(0.22, 0.5), dir: 1,
      });
    }
    posRef.current = next;
  }, [wanderers]);

  // wander loop with depth scaling + z-order
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (const w of wanderers) {
        const p = posRef.current.get(w.id);
        const el = wanderEls.current.get(w.id);
        const floor = floorRefs.current.get(w.stage);
        if (!p || !el || !floor) continue;
        const maxX = Math.max(20, floor.clientWidth - 22);
        const maxY = Math.max(16, floor.clientHeight - 26);
        const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
        if (d < 2) { p.tx = rand(6, maxX); p.ty = rand(4, maxY); }
        else { p.x += (dx / d) * p.speed; p.y += (dy / d) * p.speed; if (dx >= 0) p.dir = 1; else p.dir = -1; }
        const yf = p.y / maxY;
        const sc = depthScale(yf);
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        el.style.zIndex = String(Math.round(p.y));
        const s = spriteEls.current.get(w.id);
        if (s) s.style.transform = `scale(${sc}) scaleX(${p.dir})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [wanderers]);

  // supervisor pacing (his words flip with him — by design, Ray's favorite bit)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const lane = supLaneRef.current, el = supRef.current, p = supPos.current;
      if (lane && el) {
        const max = Math.max(40, lane.clientWidth - 36);
        if (Math.abs(p.tx - p.x) < 3) p.tx = rand(0, max);
        p.dir = p.tx - p.x >= 0 ? 1 : -1;
        p.x += p.dir * 0.7;
        el.style.transform = `translateX(${p.x}px) scaleX(${p.dir})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setSupLine(SUPERVISOR_LINES[Math.floor(Math.random() * SUPERVISOR_LINES.length)]);
      setTimeout(() => setSupLine(''), 2800);
    }, 3800);
    return () => clearInterval(iv);
  }, []);

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

  // LIVE scouting run — real agents hit the web for installers in the chosen state.
  async function runBlitz() {
    setDispatching(true);
    setSupLine('MOVE, you tin cans! Scour every street!');
    setDispatchMsg(`The scouts ride out across ${blitzState} into the night…`);
    try {
      const res = await fetch('/api/admin/prospects/blitz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: blitzState }),
      });
      const data = await res.json();
      if (data.success) {
        setDispatchMsg(`The scouts returned from ${data.stateName || blitzState}: ${data.inserted} new, ${data.updated} already known — marched into Scouting!`);
        onDispatched();
      } else {
        setDispatchMsg(data.error || data.message || 'The scouts returned empty-handed.');
      }
    } catch (e) {
      setDispatchMsg('The scouts were lost to the fog. ' + (e as Error).message);
    } finally {
      setDispatching(false);
      setTimeout(() => setDispatchMsg(''), 9000);
    }
  }

  // Instant starter batch — loads the pre-found 84 without a live run.
  async function summonBatch() {
    setDispatching(true);
    setDispatchMsg('Summoning the starter batch…');
    try {
      const res = await fetch('/api/admin/prospects/seed', { method: 'POST' });
      const data = await res.json();
      if (data.success || typeof data.total === 'number') {
        setDispatchMsg(`${data.total} installers on the books!`);
        onDispatched();
      } else {
        setDispatchMsg(data.error || data.message || 'Could not summon the batch.');
      }
    } catch (e) {
      setDispatchMsg('Summon failed. ' + (e as Error).message);
    } finally {
      setDispatching(false);
      setTimeout(() => setDispatchMsg(''), 6000);
    }
  }

  const bubbleCls = 'absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 rounded text-[8px] font-medium text-amber-950 bg-amber-100/95 z-50';

  return (
    <div className="relative">
      <style>{`
        @keyframes floorBob { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-2.5px) } }
        @keyframes typeBob { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-1.2px) } }
        @keyframes bubblePop { 0%{ opacity:0; transform: translateY(4px) scale(.85) } 15%{ opacity:1; transform: translateY(0) scale(1) } 85%{ opacity:1 } 100%{ opacity:0 } }
        @keyframes screenFlicker { 0%,100%{ opacity:.85 } 45%{ opacity:.62 } 55%{ opacity:.95 } 70%{ opacity:.7 } }
        @keyframes candle { 0%,100%{ opacity:.85; transform: scale(1) } 50%{ opacity:1; transform: scale(1.15) } }
        @keyframes ember { 0%{ transform: translateY(0); opacity:0 } 10%{opacity:.7} 100%{ transform: translateY(-260px) translateX(24px); opacity:0 } }
      `}</style>

      {/* Mezzanine: supervisor + dispatch */}
      <div className="flex items-center gap-4 mb-3">
        <div ref={supLaneRef} className="relative flex-1 h-14 rounded-lg border border-amber-900/40 bg-gradient-to-b from-[#1a1208] to-[#0c0905] overflow-hidden">
          <div className="absolute top-1 left-3 text-[9px] uppercase tracking-[0.25em] text-amber-700/80">The Overseer's Mezzanine</div>
          <div ref={supRef} className="absolute bottom-0 left-0 will-change-transform" style={{ transform: 'translateX(20px)' }}>
            {supLine && (
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded text-[9px] font-semibold text-amber-100 bg-amber-950/90 border border-amber-700/50" style={{ animation: 'bubblePop 2.8s ease-in-out forwards' }}>
                {supLine}
              </div>
            )}
            <Supervisor />
          </div>
        </div>
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <select
              value={blitzState}
              onChange={(e) => setBlitzState(e.target.value)}
              disabled={dispatching}
              className="px-2 py-3 rounded-lg bg-[#1a1208] border border-amber-700/50 text-amber-100 text-sm focus:outline-none focus:border-amber-500 disabled:opacity-60"
            >
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={runBlitz}
              disabled={dispatching}
              className="px-5 py-3 rounded-lg font-semibold text-sm text-amber-100 border border-amber-600/60 bg-gradient-to-b from-amber-800/40 to-amber-950/60 hover:from-amber-700/50 hover:to-amber-900/70 disabled:opacity-60 transition-all shadow-[0_0_18px_rgba(251,191,36,0.25)]"
            >
              {dispatching ? '🐎 The scouts ride out…' : '🐎 Dispatch the scouts'}
            </button>
          </div>
          <button
            onClick={summonBatch}
            disabled={dispatching}
            className="text-[10px] text-amber-600/70 hover:text-amber-300 underline disabled:opacity-50"
          >
            or summon the 84-installer starter batch
          </button>
        </div>
      </div>
      {dispatchMsg && <div className="mb-3 text-center text-xs text-amber-300/90 italic">{dispatchMsg}</div>}

      {/* The house */}
      <div className="relative rounded-2xl border border-amber-950/60 bg-[#070504] p-5 md:p-8 overflow-hidden" style={{ boxShadow: 'inset 0 0 120px rgba(0,0,0,0.9)' }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 20%, rgba(251,191,36,0.06), transparent 60%)' }} />
        {[...Array(7)].map((_, i) => (
          <div key={i} className="pointer-events-none absolute rounded-full" style={{ left: `${10 + i * 13}%`, bottom: '4%', width: 3, height: 3, background: '#f59e0b', filter: 'blur(0.5px)', animation: `ember ${6 + i}s linear ${i * 1.3}s infinite` }} />
        ))}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {rooms.map((room) => {
            const idle = room.count === 0;
            const seatList = Array.from({ length: room.seated }, (_, i) => i);
            const wlist = wanderers.filter((w) => w.stage === room.stage);
            return (
              <button
                key={room.stage}
                onClick={() => onEnterRoom(room.stage)}
                className="group relative text-left rounded-xl overflow-hidden focus:outline-none transition-transform hover:-translate-y-1"
                style={{
                  height: 220,
                  border: `2px solid ${room.accent}44`,
                  boxShadow: `0 10px 30px rgba(0,0,0,0.7), 0 0 22px ${room.glow}`,
                  perspective: '700px',
                }}
              >
                {/* BACK WALL */}
                <div className="absolute inset-x-0 top-0 h-[58%]" style={{
                  background: `linear-gradient(180deg, ${room.wall}, #0a0705)`,
                  boxShadow: `inset 0 0 60px rgba(0,0,0,0.8), inset 0 18px 24px rgba(0,0,0,0.6)`,
                }}>
                  {/* faint stone courses */}
                  <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 17px, rgba(0,0,0,0.5) 17px 18px), repeating-linear-gradient(90deg, transparent 0 34px, rgba(0,0,0,0.4) 34px 35px)' }} />
                  {/* arched window */}
                  <div className="absolute left-1/2 -translate-x-1/2 top-3 opacity-90"><ArchWindow accent={room.accent} /></div>
                  {/* gas lamps */}
                  <div className="absolute left-6 top-2"><GasLamp glow={room.glow} /></div>
                  <div className="absolute right-6 top-2"><GasLamp glow={room.glow} /></div>
                  {/* cobwebs */}
                  <div className="absolute top-0 left-0 w-8 h-8 opacity-30" style={{ background: 'radial-gradient(circle at 0 0, transparent 60%, rgba(255,255,255,0.15) 61%, transparent 63%), radial-gradient(circle at 0 0, transparent 40%, rgba(255,255,255,0.12) 41%, transparent 43%)' }} />
                </div>

                {/* FLOOR (bot region) */}
                <div
                  ref={(el) => { floorRefs.current.set(room.stage, el); }}
                  className="absolute inset-x-0 bottom-0 h-[46%]"
                  style={{
                    background: `linear-gradient(180deg, #1a120a 0%, #2a1d10 60%, #3a2a16 100%)`,
                    backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.35) 0 1px, transparent 1px 26px)',
                    boxShadow: 'inset 0 14px 22px rgba(0,0,0,0.7), inset 22px 0 26px rgba(0,0,0,0.5), inset -22px 0 26px rgba(0,0,0,0.5)',
                    clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)',
                  }}
                >
                  {/* lamp pool on the floor */}
                  <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at 50% 10%, ${room.glow}, transparent 65%)` }} />

                  {/* desks + seated clerks */}
                  {DESKS.map((d, i) => {
                    const yf = d.top / 100;
                    const sc = depthScale(yf);
                    return (
                      <div key={i} className="absolute" style={{ left: `${d.left}%`, top: `${d.top}%`, transform: `scale(${sc})`, transformOrigin: 'center bottom', zIndex: Math.round(d.top) }}>
                        <Desk accent={room.accent} delay={i * 0.7} />
                        {seatList.includes(i) && (
                          <div className="absolute" style={{ left: 14, top: 30 }}>
                            {bubbles[`${room.stage}-seat-${i}`] && (
                              <div className={bubbleCls} style={{ animation: 'bubblePop 2s ease-in-out forwards' }}>{bubbles[`${room.stage}-seat-${i}`]}</div>
                            )}
                            <div style={{ animation: 'typeBob 0.5s ease-in-out infinite' }}><ClerkBot accent={room.accent} seated papers gold={room.stage === 'signed_up' && i === 0} /></div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* wandering clerks */}
                  {wlist.map((w) => (
                    <div key={w.id} ref={(el) => { wanderEls.current.set(w.id, el); }} className="absolute top-0 left-0 will-change-transform" style={{ transform: 'translate(20px,20px)' }}>
                      {bubbles[w.id] && (<div className={bubbleCls} style={{ animation: 'bubblePop 2s ease-in-out forwards' }}>{bubbles[w.id]}</div>)}
                      <div ref={(el) => { spriteEls.current.set(w.id, el); }} style={{ transformOrigin: 'center bottom' }}><ClerkBot accent={room.accent} /></div>
                    </div>
                  ))}

                  {idle && (
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] text-amber-800/70 italic pointer-events-none" style={{ fontFamily: 'Georgia, serif' }}>
                      this chamber lies vacant…
                    </div>
                  )}
                </div>

                {/* PLAQUE (front, over everything) */}
                <div className="absolute top-2 left-2 right-2 flex items-start justify-between z-40 pointer-events-none">
                  <div className="px-2 py-1 rounded bg-black/55 backdrop-blur-[1px]">
                    <div className="text-[11px] font-bold tracking-[0.14em]" style={{ color: room.accent, fontFamily: 'Georgia, serif' }}>❧ {room.name}</div>
                    <div className="text-[8px] text-amber-600/80 uppercase tracking-wider">{room.tag}</div>
                  </div>
                  <div className="px-2 py-1 rounded bg-black/55 text-right">
                    <div className="text-lg font-extrabold text-amber-50 leading-none" style={{ fontFamily: 'Georgia, serif' }}>{room.count}</div>
                    <div className="text-[8px] text-amber-600/80 uppercase">souls</div>
                  </div>
                </div>

                <div className="absolute bottom-1.5 right-2 z-40 text-[9px] text-amber-700/60 group-hover:text-amber-300 transition-colors" style={{ fontFamily: 'Georgia, serif' }}>enter →</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 text-center text-xs text-amber-800/70 italic" style={{ fontFamily: 'Georgia, serif' }}>
        {total} installers within these walls · {rooms.reduce((s, r) => s + r.total, 0)} clerks at their desks · the ledgers update in real time
      </div>
    </div>
  );
}
