'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The works — a gaslit 1800s sweatshop for finding solar installers. Each pipeline
 * stage is a wide "workshop bay": brick back wall, big readable sign, hanging
 * bulbs, motivational/threatening banner, a wall clock, filing cabinets, desks with
 * glowing computers, and goofy overworked clerks (seated + wandering). A fat,
 * cigar-chomping Overseer paces the catwalk barking orders — his words stay
 * upright when he turns. Counts are LIVE from real data. "Dispatch the scouts"
 * runs a real web-search scouting run for a chosen state.
 */

type Stage =
  | 'discovered' | 'enriched' | 'qualified' | 'contacted' | 'signed_up' | 'rejected';

type RoomDef = {
  stage: Stage; name: string; tag: string; banner: string;
  accent: string; glow: string; wall: string; lines: string[];
};

const ROOMS: RoomDef[] = [
  { stage: 'discovered', name: 'THE SCOUTING ROOM', tag: 'Discovery', banner: 'FIND MORE INSTALLERS', accent: '#5eead4', glow: 'rgba(45,212,191,0.30)', wall: '#13241f',
    lines: ['found one!', 'another name!', 'add to the ledger', 'I spy a firm', 'scouring the maps'] },
  { stage: 'enriched', name: 'THE COPYING ROOM', tag: 'Contact intel', banner: 'GET THEIR DIGITS', accent: '#7dd3fc', glow: 'rgba(56,189,248,0.30)', wall: '#0f1d2c',
    lines: ['got the email!', 'phone number ✓', 'fattening the file', 'copying it all'] },
  { stage: 'qualified', name: 'THE ASSAY ROOM', tag: 'Vetting', banner: 'ONLY THE WORTHY', accent: '#c4b5fd', glow: 'rgba(167,139,250,0.30)', wall: '#1c1633',
    lines: ['licensed, aye', 'a worthy firm', 'checking papers', 'grade A!'] },
  { stage: 'contacted', name: 'THE POST ROOM', tag: 'Pitching', banner: 'SEAL THE LETTER', accent: '#fcd34d', glow: 'rgba(251,191,36,0.34)', wall: '#261d0a',
    lines: ['letter sent!', 'awaiting reply', 'posted by courier', 'no word yet…'] },
  { stage: 'signed_up', name: 'THE COUNTING HOUSE', tag: 'Customers', banner: 'KA-CHING', accent: '#6ee7b7', glow: 'rgba(52,211,153,0.40)', wall: '#10271b',
    lines: ['a deal struck!', 'signed in ink', 'welcome aboard!', 'the coffers fill!'] },
  { stage: 'rejected', name: 'THE CATACOMBS', tag: 'Passed', banner: 'BEGONE', accent: '#fda4af', glow: 'rgba(244,63,94,0.28)', wall: '#261018',
    lines: ['not a fit', 'filed away', 'nevermore', 'into the bin'] },
];

const SUPERVISOR_LINES = [
  'IDLE HANDS, IDLE PROFITS!',
  'Find me more installers, you laggards!',
  'Quoth the quota: MORE.',
  'BACK TO YOUR DESKS!',
  'The marketplace HUNGERS!',
  'Faster, my little wretches!',
  'I do NOT pay you to DAWDLE!',
  'Whoever rests gets the SACK!',
  'Sleep is for the unsubscribed!',
  'Coffee break? In THIS economy?!',
  'I SMELL slacking!',
  'Every idle clerk is a lead LOST!',
  'SMILE while you toil!',
  'The ledger is WATCHING.',
  'Bonuses? HA! Crumbs, perhaps.',
  'Double the leads or ELSE!',
  'Less sighing, more HUSTLING!',
  'Is this a UNION?! It is NOT.',
  'My grandfather toiled uphill, BOTH WAYS!',
  'CHOP CHOP, the sun is selling!',
];

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

// desk anchors as % of the floor strip; top = depth (smaller toward the back)
const DESKS = [
  { left: 8, top: 20 }, { left: 40, top: 12 }, { left: 70, top: 30 },
];

function workersFor(count: number): number {
  if (count <= 0) return 1;
  return Math.min(5, Math.max(1, Math.round(count / 14)));
}
function rand(min: number, max: number) { return min + Math.random() * (max - min); }
function depthScale(yFrac: number) { return 0.78 + 0.32 * yFrac; }

/* ── Goofy overworked clerk ───────────────────────────────────────────────── */
function Clerk({ c, variant = 0, seated, gold }: { c: string; variant?: number; seated?: boolean; gold?: boolean }) {
  const tie = gold ? '#fbbf24' : c;
  return (
    <svg width="38" height="46" viewBox="0 0 38 46" style={{ display: 'block', filter: gold ? 'drop-shadow(0 0 4px rgba(251,191,36,0.85))' : 'drop-shadow(0 3px 2px rgba(0,0,0,0.5))' }}>
      {/* legs (hidden when seated behind desk) */}
      {!seated && <>
        <rect x="13" y="38" width="4" height="7" rx="1" fill="#2b3a4a" />
        <rect x="21" y="38" width="4" height="7" rx="1" fill="#2b3a4a" />
        <ellipse cx="15" cy="45" rx="3" ry="1.4" fill="#10151c" />
        <ellipse cx="23" cy="45" rx="3" ry="1.4" fill="#10151c" />
      </>}
      {/* torso: rumpled shirt + vest */}
      <path d="M10 26 Q19 22 28 26 L29 40 Q19 43 9 40 Z" fill="#cdd6e0" />
      <path d="M10 26 Q19 22 28 26 L29 40 Q19 43 9 40 Z" fill="#000" opacity="0.06" />
      {/* tie (stage color) */}
      <path d="M19 25 l-2.4 4 2.4 7 2.4-7 z" fill={tie} />
      {/* arms slumped onto the desk */}
      <path d="M11 28 Q5 31 7 37" stroke="#cdd6e0" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M27 28 Q33 31 31 37" stroke="#cdd6e0" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      {/* head */}
      <ellipse cx="19" cy="14" rx="9" ry="8.5" fill="#e6c8a8" />
      <ellipse cx="19" cy="14" rx="9" ry="8.5" fill="#000" opacity="0.04" />
      {/* hair tuft */}
      <path d="M11 9 Q19 2 27 9 Q23 6 19 7 Q15 6 11 9 Z" fill="#3a2d22" />
      {/* visor variant */}
      {variant === 1 && <rect x="10.5" y="9.5" width="17" height="3.2" rx="1.6" fill="#2f7d4f" opacity="0.92" />}
      {/* tired eyes with bags */}
      <ellipse cx="15.5" cy="14" rx="2.1" ry="1.7" fill="#fff" />
      <ellipse cx="22.5" cy="14" rx="2.1" ry="1.7" fill="#fff" />
      <circle cx="15.5" cy="14.4" r="0.95" fill="#222" />
      <circle cx="22.5" cy="14.4" r="0.95" fill="#222" />
      <path d="M13.6 16 Q15.5 17 17.4 16" stroke="#b89" strokeWidth="0.6" fill="none" opacity="0.6" />
      <path d="M20.6 16 Q22.5 17 24.4 16" stroke="#b89" strokeWidth="0.6" fill="none" opacity="0.6" />
      {/* worried brow + tiny frown */}
      <path d="M13 10.5 l3 1.2 M25 10.5 l-3 1.2" stroke="#5a4632" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M16.5 18.5 Q19 17.6 21.5 18.5" stroke="#7a5a3a" strokeWidth="0.8" fill="none" />
      {/* sweat drop */}
      <path d="M27 11 q1.4 2 0 3.2 q-1.4 -1.2 0 -3.2 z" fill="#7dd3fc" opacity="0.85" />
      {/* coffee variant */}
      {variant === 2 && <g><rect x="0.5" y="33" width="6" height="5" rx="1" fill="#e6e0d2" stroke="#8a7d63" strokeWidth="0.6" /><path d="M6.5 34 q2 0.5 0 2.5" stroke="#8a7d63" strokeWidth="0.7" fill="none" /></g>}
      {/* gold crown */}
      {gold && <path d="M12 5 l2 3 2.5-3 2.5 3 2.5-3 2 3 -1 2 H13 z" fill="#fbbf24" stroke="#b8860b" strokeWidth="0.5" />}
    </svg>
  );
}

/* ── The Overseer (fat cigar-chomping boss) ──────────────────────────────────── */
function Overseer() {
  return (
    <svg width="64" height="72" viewBox="0 0 64 72" style={{ display: 'block', filter: 'drop-shadow(0 4px 3px rgba(0,0,0,0.6))' }}>
      {/* legs — striped trousers */}
      <rect x="22" y="56" width="8" height="13" rx="1.5" fill="#3a2c19" />
      <rect x="34" y="56" width="8" height="13" rx="1.5" fill="#3a2c19" />
      <path d="M22 56v13M26 56v13M34 56v13M38 56v13" stroke="#241a10" strokeWidth="0.7" />
      <ellipse cx="25" cy="70" rx="5" ry="2" fill="#0c0c0f" />
      <ellipse cx="39" cy="70" rx="5" ry="2" fill="#0c0c0f" />
      {/* big belly tailcoat */}
      <ellipse cx="32" cy="44" rx="18" ry="15" fill="#14110c" />
      <ellipse cx="32" cy="46" rx="12" ry="11" fill="#3b3329" />
      {/* gold buttons + pocket-watch chain */}
      <circle cx="32" cy="40" r="1.1" fill="#d4af37" /><circle cx="32" cy="45" r="1.1" fill="#d4af37" /><circle cx="32" cy="50" r="1.1" fill="#d4af37" />
      <path d="M26 44 Q22 49 27 52" stroke="#d4af37" strokeWidth="1.2" fill="none" />
      {/* arms — one on hip, one holding a cane */}
      <path d="M16 38 Q8 42 12 50" stroke="#14110c" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M48 38 Q56 42 54 54" stroke="#14110c" strokeWidth="5" fill="none" strokeLinecap="round" />
      <line x1="54" y1="40" x2="54" y2="71" stroke="#b8860b" strokeWidth="2.4" />
      <circle cx="54" cy="38" r="2.4" fill="#d4af37" />
      {/* cravat */}
      <path d="M28 30 L32 38 L36 30 Z" fill="#7c1d1d" />
      {/* head */}
      <ellipse cx="32" cy="24" rx="11" ry="10" fill="#e8b48c" />
      {/* angry brows */}
      <path d="M24 20 l6 2 M40 20 l-6 2" stroke="#3a2d22" strokeWidth="1.6" strokeLinecap="round" />
      {/* eyes + monocle */}
      <circle cx="28" cy="24" r="1.5" fill="#222" />
      <circle cx="37" cy="24" r="1.4" fill="#222" />
      <circle cx="37" cy="24" r="3.6" fill="none" stroke="#d4af37" strokeWidth="1" />
      <path d="M40 26 Q43 31 41 35" stroke="#d4af37" strokeWidth="0.7" fill="none" />
      {/* huge handlebar mustache */}
      <path d="M24 29 Q28 33 32 30 Q36 33 40 29 Q36 31 32 30.5 Q28 31 24 29 Z" fill="#3a2d22" />
      {/* cigar + smoke */}
      <rect x="32" y="30.5" width="9" height="2.2" rx="1" fill="#6b4423" />
      <circle cx="41" cy="31.6" r="0.9" fill="#ff7a1a" />
      <circle cx="44" cy="29" r="1.3" fill="#cbd5e1" opacity="0.5" style={{ animation: 'smoke 2.4s ease-in-out infinite' }} />
      <circle cx="46" cy="25" r="1.7" fill="#cbd5e1" opacity="0.35" style={{ animation: 'smoke 2.4s ease-in-out 0.6s infinite' }} />
      {/* top hat */}
      <rect x="22" y="2" width="20" height="13" rx="1.5" fill="#0c0c0f" stroke="#b8860b" strokeWidth="1" />
      <rect x="17" y="14" width="30" height="3.5" rx="1.5" fill="#0c0c0f" stroke="#b8860b" strokeWidth="0.8" />
      <rect x="22" y="11.5" width="20" height="2.4" fill="#7c1d1d" />
    </svg>
  );
}

function Desk({ accent, delay }: { accent: string; delay: number }) {
  return (
    <svg width="64" height="48" viewBox="0 0 64 48" style={{ display: 'block', filter: 'drop-shadow(0 5px 4px rgba(0,0,0,0.6))' }}>
      <rect x="4" y="36" width="56" height="8" rx="2" fill="#3b2a1c" stroke="#1c130b" strokeWidth="1" />
      <rect x="8" y="43" width="3.5" height="5" fill="#241a10" /><rect x="52" y="43" width="3.5" height="5" fill="#241a10" />
      {/* CRT monitor */}
      <rect x="18" y="8" width="28" height="22" rx="2.5" fill="#0a0f1a" stroke="#241a10" strokeWidth="2" />
      <rect x="21" y="11" width="22" height="15" rx="1" fill={accent} opacity="0.85" style={{ animation: `screenFlicker 2.6s ease-in-out ${delay}s infinite` }} />
      <rect x="21" y="15" width="22" height="1" fill="#0a0f1a" opacity="0.4" /><rect x="21" y="20" width="22" height="1" fill="#0a0f1a" opacity="0.4" />
      <rect x="29" y="30" width="6" height="6" fill="#1c130b" />
      <rect x="22" y="36" width="20" height="3" rx="1" fill="#2a1d12" />
      {/* paper stack */}
      <rect x="48" y="31" width="9" height="6" rx="0.5" fill="#e8dcc0" stroke="#9c8a66" strokeWidth="0.6" transform="rotate(-5 52 34)" />
    </svg>
  );
}

function FilingCabinet({ accent }: { accent: string }) {
  return (
    <svg width="26" height="40" viewBox="0 0 26 40" style={{ display: 'block', filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.55))' }}>
      <rect x="2" y="2" width="22" height="36" rx="2" fill="#2a2014" stroke="#1c1206" strokeWidth="1.2" />
      {[4, 16, 28].map((y) => (
        <g key={y}><rect x="4" y={y} width="18" height="9" rx="1" fill="#3a2c19" /><rect x="10" y={y + 3.5} width="6" height="2" rx="1" fill={accent} opacity="0.8" /></g>
      ))}
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

  const supRef = useRef<HTMLDivElement | null>(null);      // moves (translateX only)
  const supSpriteRef = useRef<HTMLDivElement | null>(null); // flips (scaleX) — bubble stays out of here
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
    const list: { id: string; stage: Stage; accent: string; variant: number }[] = [];
    for (const r of rooms) for (let i = 0; i < r.wanderers; i++) {
      list.push({ id: `${r.stage}-wander-${i}`, stage: r.stage, accent: r.accent, variant: i % 3 });
    }
    return list;
  }, [rooms]);

  useEffect(() => {
    const next = new Map<string, Pos>();
    for (const w of wanderers) {
      next.set(w.id, posRef.current.get(w.id) ?? {
        x: rand(10, 160), y: rand(8, 60), tx: rand(10, 160), ty: rand(8, 60),
        speed: rand(0.18, 0.42), dir: 1,
      });
    }
    posRef.current = next;
  }, [wanderers]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (const w of wanderers) {
        const p = posRef.current.get(w.id); const el = wanderEls.current.get(w.id); const floor = floorRefs.current.get(w.stage);
        if (!p || !el || !floor) continue;
        const maxX = Math.max(20, floor.clientWidth - 40);
        const maxY = Math.max(16, floor.clientHeight - 46);
        const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
        if (d < 2) { p.tx = rand(6, maxX); p.ty = rand(4, maxY); }
        else { p.x += (dx / d) * p.speed; p.y += (dy / d) * p.speed; p.dir = dx >= 0 ? 1 : -1; }
        const sc = depthScale(p.y / maxY);
        el.style.transform = `translate(${p.x}px, ${p.y}px)`; el.style.zIndex = String(Math.round(p.y));
        const s = spriteEls.current.get(w.id); if (s) s.style.transform = `scale(${sc}) scaleX(${p.dir})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [wanderers]);

  // overseer paces — translateX on the mover, scaleX only on the inner sprite so the bubble never mirrors
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const lane = supLaneRef.current, el = supRef.current, sp = supSpriteRef.current, p = supPos.current;
      if (lane && el) {
        const max = Math.max(60, lane.clientWidth - 70);
        if (Math.abs(p.tx - p.x) < 4) p.tx = rand(0, max);
        p.dir = p.tx - p.x >= 0 ? 1 : -1;
        p.x += p.dir * 0.8;
        el.style.transform = `translateX(${p.x}px)`;
        if (sp) sp.style.transform = `scaleX(${p.dir})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setSupLine(SUPERVISOR_LINES[Math.floor(Math.random() * SUPERVISOR_LINES.length)]);
      setTimeout(() => setSupLine(''), 3000);
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
      setBubbles((b) => ({ ...b, [pick.id]: room.lines[Math.floor(Math.random() * room.lines.length)] }));
      setTimeout(() => setBubbles((b) => { const n = { ...b }; delete n[pick.id]; return n; }), 2200);
    }, 1200);
    return () => clearInterval(iv);
  }, [rooms, byStage]);

  async function runBlitz() {
    setDispatching(true);
    setSupLine('MOVE, you wretches! Scour every street!');
    setDispatchMsg(`The scouts ride out across ${blitzState} into the night…`);
    try {
      const res = await fetch('/api/admin/prospects/blitz', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: blitzState }),
      });
      const data = await res.json();
      if (data.success) { setDispatchMsg(`Back from ${data.stateName || blitzState}: ${data.inserted} new, ${data.updated} already known — marched into Scouting!`); onDispatched(); }
      else setDispatchMsg(data.error || data.message || 'The scouts returned empty-handed.');
    } catch (e) { setDispatchMsg('The scouts were lost to the fog. ' + (e as Error).message); }
    finally { setDispatching(false); setTimeout(() => setDispatchMsg(''), 9000); }
  }

  async function summonBatch() {
    setDispatching(true);
    setDispatchMsg('Summoning the starter batch…');
    try {
      const res = await fetch('/api/admin/prospects/seed', { method: 'POST' });
      const data = await res.json();
      if (data.success || typeof data.total === 'number') { setDispatchMsg(`${data.total} installers on the books!`); onDispatched(); }
      else setDispatchMsg(data.error || data.message || 'Could not summon the batch.');
    } catch (e) { setDispatchMsg('Summon failed. ' + (e as Error).message); }
    finally { setDispatching(false); setTimeout(() => setDispatchMsg(''), 6000); }
  }

  const bubble = 'absolute left-1/2 -translate-x-1/2 -top-7 whitespace-nowrap px-2 py-0.5 rounded-md text-[11px] font-semibold text-amber-950 bg-amber-100 shadow z-50';

  return (
    <div className="relative">
      <style>{`
        @keyframes floorBob { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-3px) } }
        @keyframes typeBob { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-1.5px) } }
        @keyframes bubblePop { 0%{ opacity:0; transform: translate(-50%, 4px) scale(.85) } 12%{ opacity:1; transform: translate(-50%,0) scale(1) } 88%{ opacity:1 } 100%{ opacity:0 } }
        @keyframes screenFlicker { 0%,100%{ opacity:.85 } 45%{ opacity:.62 } 55%{ opacity:.95 } 70%{ opacity:.7 } }
        @keyframes bulb { 0%,100%{ opacity:.9 } 50%{ opacity:1 } }
        @keyframes smoke { 0%{ opacity:.5; transform: translateY(0) } 100%{ opacity:0; transform: translateY(-10px) } }
        @keyframes ember { 0%{ transform: translateY(0); opacity:0 } 10%{opacity:.7} 100%{ transform: translateY(-280px); opacity:0 } }
      `}</style>

      {/* ── Catwalk: the Overseer + controls ── */}
      <div className="rounded-xl border border-amber-900/50 bg-gradient-to-b from-[#1d1409] to-[#0c0905] p-3 mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div ref={supLaneRef} className="relative flex-1 min-w-[280px] h-24 overflow-hidden rounded-lg bg-[#0a0705]"
            style={{ boxShadow: 'inset 0 0 40px rgba(0,0,0,0.7)' }}>
            <div className="absolute top-1 left-3 text-[10px] uppercase tracking-[0.3em] text-amber-600/80 font-bold">The Overseer&apos;s Catwalk</div>
            <div ref={supRef} className="absolute bottom-0 left-0 will-change-transform" style={{ transform: 'translateX(20px)' }}>
              {supLine && (
                <div className="absolute -top-3 left-16 whitespace-nowrap px-2.5 py-1 rounded-lg text-[12px] font-bold text-amber-100 bg-amber-950 border border-amber-600/60 shadow-lg" style={{ animation: 'bubblePop 3s ease-in-out forwards' }}>
                  {supLine}
                </div>
              )}
              <div ref={supSpriteRef} style={{ transformOrigin: 'center bottom' }}><Overseer /></div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-300/80 font-medium">Send the scouts to</span>
              <select value={blitzState} onChange={(e) => setBlitzState(e.target.value)} disabled={dispatching}
                className="px-3 py-2.5 rounded-lg bg-[#1a1208] border border-amber-700/50 text-amber-100 text-sm font-semibold focus:outline-none focus:border-amber-500 disabled:opacity-60">
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={runBlitz} disabled={dispatching}
                className="px-5 py-2.5 rounded-lg font-bold text-sm text-amber-50 border border-amber-600/60 bg-gradient-to-b from-amber-700/50 to-amber-950/70 hover:from-amber-600/60 hover:to-amber-900/80 disabled:opacity-60 transition-all shadow-[0_0_18px_rgba(251,191,36,0.3)]">
                {dispatching ? '🐎 Scouting…' : '🐎 Dispatch the scouts'}
              </button>
            </div>
            <button onClick={summonBatch} disabled={dispatching} className="text-[11px] text-amber-600/70 hover:text-amber-300 underline disabled:opacity-50 text-right">
              or summon the 84-installer starter batch
            </button>
          </div>
        </div>
        {dispatchMsg && <div className="mt-2 text-center text-sm text-amber-300 italic">{dispatchMsg}</div>}
      </div>

      {/* ── The workshop bays ── */}
      <div className="relative rounded-2xl border border-amber-950/60 bg-[#070504] p-4 md:p-6 overflow-hidden" style={{ boxShadow: 'inset 0 0 120px rgba(0,0,0,0.9)' }}>
        {[...Array(8)].map((_, i) => (
          <div key={i} className="pointer-events-none absolute rounded-full" style={{ left: `${8 + i * 11}%`, bottom: '3%', width: 3, height: 3, background: '#f59e0b', filter: 'blur(0.5px)', animation: `ember ${6 + i}s linear ${i * 1.1}s infinite` }} />
        ))}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {rooms.map((room) => {
            const idle = room.count === 0;
            const seatList = Array.from({ length: room.seated }, (_, i) => i);
            const wlist = wanderers.filter((w) => w.stage === room.stage);
            return (
              <button key={room.stage} onClick={() => onEnterRoom(room.stage)}
                className="group relative text-left rounded-xl overflow-hidden focus:outline-none transition-transform hover:-translate-y-0.5"
                style={{ height: 240, border: `2px solid ${room.accent}55`, boxShadow: `0 10px 28px rgba(0,0,0,0.7), 0 0 22px ${room.glow}` }}>

                {/* BACK WALL (brick) */}
                <div className="absolute inset-x-0 top-0 h-[52%]" style={{ background: `linear-gradient(180deg, ${room.wall}, #0a0705)` }}>
                  <div className="absolute inset-0 opacity-25" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 13px, rgba(0,0,0,0.5) 13px 14px), repeating-linear-gradient(90deg, transparent 0 30px, rgba(0,0,0,0.45) 30px 31px)' }} />
                  {/* hanging bulbs */}
                  {[28, 60].map((lx) => (
                    <div key={lx} className="absolute" style={{ left: `${lx}%`, top: 0 }}>
                      <div style={{ width: 1.5, height: 16, background: '#3a2c19', margin: '0 auto' }} />
                      <div style={{ width: 9, height: 11, borderRadius: '50% 50% 50% 50% / 55% 55% 45% 45%', background: `radial-gradient(circle at 50% 35%, #fff4cc, ${room.accent} 75%)`, animation: 'bulb 2s ease-in-out infinite', boxShadow: `0 0 14px ${room.glow}` }} />
                    </div>
                  ))}
                  {/* threatening banner */}
                  <div className="absolute left-1/2 -translate-x-1/2 top-9 px-3 py-0.5 rounded-sm text-[10px] font-black tracking-widest"
                    style={{ background: '#7c1d1d', color: '#ffe9b0', boxShadow: '0 2px 4px rgba(0,0,0,0.6)', border: '1px solid #a33' }}>
                    {room.banner}
                  </div>
                  {/* wall clock */}
                  <div className="absolute right-3 top-2 w-7 h-7 rounded-full border-2 flex items-center justify-center" style={{ borderColor: room.accent, background: '#0a0705' }}>
                    <div className="absolute w-2 h-[1.5px]" style={{ background: room.accent, transform: 'rotate(40deg)' }} />
                    <div className="absolute w-[1.5px] h-2.5" style={{ background: room.accent, transform: 'rotate(10deg)' }} />
                  </div>
                </div>

                {/* FLOOR */}
                <div ref={(el) => { floorRefs.current.set(room.stage, el); }} className="absolute inset-x-0 bottom-0 h-[48%]"
                  style={{ background: 'linear-gradient(180deg, #1a120a 0%, #2a1d10 55%, #3a2a16 100%)', backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.32) 0 1px, transparent 1px 30px)', boxShadow: 'inset 0 14px 22px rgba(0,0,0,0.7), inset 26px 0 28px rgba(0,0,0,0.5), inset -26px 0 28px rgba(0,0,0,0.5)' }}>
                  <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at 50% 0%, ${room.glow}, transparent 60%)` }} />

                  {/* filing cabinet in the corner */}
                  <div className="absolute right-2 bottom-1" style={{ zIndex: 60 }}><FilingCabinet accent={room.accent} /></div>

                  {/* desks + seated clerks */}
                  {DESKS.map((d, i) => {
                    const sc = depthScale(d.top / 100);
                    return (
                      <div key={i} className="absolute" style={{ left: `${d.left}%`, top: `${d.top}%`, transform: `scale(${sc})`, transformOrigin: 'center bottom', zIndex: Math.round(d.top) + 10 }}>
                        <Desk accent={room.accent} delay={i * 0.7} />
                        {seatList.includes(i) && (
                          <div className="absolute" style={{ left: 16, top: 2 }}>
                            {bubbles[`${room.stage}-seat-${i}`] && <div className={bubble} style={{ animation: 'bubblePop 2.2s ease-in-out forwards' }}>{bubbles[`${room.stage}-seat-${i}`]}</div>}
                            <div style={{ animation: 'typeBob 0.5s ease-in-out infinite' }}><Clerk c={room.accent} variant={i % 3} seated gold={room.stage === 'signed_up' && i === 0} /></div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* wandering clerks */}
                  {wlist.map((w) => (
                    <div key={w.id} ref={(el) => { wanderEls.current.set(w.id, el); }} className="absolute top-0 left-0 will-change-transform" style={{ transform: 'translate(20px,20px)' }}>
                      {bubbles[w.id] && <div className={bubble} style={{ animation: 'bubblePop 2.2s ease-in-out forwards' }}>{bubbles[w.id]}</div>}
                      <div ref={(el) => { spriteEls.current.set(w.id, el); }} style={{ transformOrigin: 'center bottom' }}><Clerk c={room.accent} variant={w.variant} /></div>
                    </div>
                  ))}

                  {idle && <div className="absolute inset-0 flex items-center justify-center text-sm text-amber-700/70 italic pointer-events-none" style={{ fontFamily: 'Georgia, serif' }}>this chamber lies vacant…</div>}
                </div>

                {/* SIGN (big, readable, top) */}
                <div className="absolute top-2 left-2 right-2 flex items-start justify-between z-40 pointer-events-none">
                  <div className="px-3 py-1.5 rounded-md bg-black/70 backdrop-blur-sm">
                    <div className="text-base font-extrabold tracking-wide leading-none" style={{ color: room.accent, fontFamily: 'Georgia, serif' }}>{room.name}</div>
                    <div className="text-[11px] text-amber-500/90 uppercase tracking-wider mt-0.5">{room.tag}</div>
                  </div>
                  <div className="px-3 py-1.5 rounded-md bg-black/70 text-right">
                    <div className="text-3xl font-black text-amber-50 leading-none" style={{ fontFamily: 'Georgia, serif' }}>{room.count}</div>
                    <div className="text-[10px] text-amber-500/90 uppercase tracking-widest">leads</div>
                  </div>
                </div>

                <div className="absolute bottom-2 left-3 z-40 text-[12px] font-semibold text-amber-200/80 group-hover:text-amber-300 transition-colors" style={{ fontFamily: 'Georgia, serif' }}>enter the chamber →</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 text-center text-sm text-amber-700/80 italic" style={{ fontFamily: 'Georgia, serif' }}>
        {total} installers within these walls · {rooms.reduce((s, r) => s + r.total, 0)} clerks at their desks · the ledgers update in real time
      </div>
    </div>
  );
}
