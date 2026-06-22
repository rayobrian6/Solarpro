'use client';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Rocket, Calendar, MapPin, Zap, CheckCircle2, Clock, AlertCircle,
  Sparkles, Filter, GitCommit, Package, FileCode,
  Target, Trophy, ArrowRight,
} from 'lucide-react';
import {
  ROADMAP_ITEMS, TRACK_META, RE_PLUS_2026,
  msUntilReplus, formatCountdown, getRoadmapCounts,
  type RoadmapItem, type RoadmapStatus, type RoadmapPriority, type RoadmapTrack,
} from '@/lib/roadmapRE26';

// ─── Status / Priority config ─────────────────────────────────────────
const STATUS_CONFIG: Record<RoadmapStatus, { label: string; badge: string; dot: string; icon: React.ElementType }> = {
  'idea':        { label: 'Idea',        badge: 'bg-zinc-500/15 border-zinc-500/30 text-zinc-300',     dot: 'bg-zinc-400',     icon: Sparkles },
  'planned':     { label: 'Planned',     badge: 'bg-blue-500/15 border-blue-500/30 text-blue-300',     dot: 'bg-blue-400',     icon: Target },
  'in-progress': { label: 'In Progress', badge: 'bg-amber-500/15 border-amber-500/30 text-amber-300',  dot: 'bg-amber-400 animate-pulse', icon: Zap },
  'blocked':     { label: 'Blocked',     badge: 'bg-rose-500/15 border-rose-500/30 text-rose-300',     dot: 'bg-rose-400',     icon: AlertCircle },
  'done':        { label: 'Done',        badge: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300', dot: 'bg-emerald-400', icon: CheckCircle2 },
};

const PRIORITY_CONFIG: Record<RoadmapPriority, { label: string; badge: string; weight: number }> = {
  p0: { label: 'P0 · Release Critical', badge: 'bg-rose-500/20 border-rose-500/40 text-rose-200 font-semibold',   weight: 0 },
  p1: { label: 'P1 · Important',         badge: 'bg-amber-500/20 border-amber-500/40 text-amber-200',             weight: 1 },
  p2: { label: 'P2 · Nice-to-have',      badge: 'bg-blue-500/15 border-blue-500/30 text-blue-300',                weight: 2 },
  p3: { label: 'P3 · Future',            badge: 'bg-zinc-500/15 border-zinc-500/30 text-zinc-400',                weight: 3 },
};

const TRACK_COLOR_MAP: Record<string, { bg: string; text: string; ring: string; bar: string; glow: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-300', ring: 'ring-emerald-500/30', bar: 'bg-emerald-500', glow: 'shadow-emerald-500/20' },
  blue:    { bg: 'bg-blue-500/10',    text: 'text-blue-300',    ring: 'ring-blue-500/30',    bar: 'bg-blue-500',    glow: 'shadow-blue-500/20' },
  amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-300',   ring: 'ring-amber-500/30',   bar: 'bg-amber-500',   glow: 'shadow-amber-500/20' },
  violet:  { bg: 'bg-violet-500/10',  text: 'text-violet-300',  ring: 'ring-violet-500/30',  bar: 'bg-violet-500',  glow: 'shadow-violet-500/20' },
  pink:    { bg: 'bg-pink-500/10',    text: 'text-pink-300',    ring: 'ring-pink-500/30',    bar: 'bg-pink-500',    glow: 'shadow-pink-500/20' },
  sky:     { bg: 'bg-sky-500/10',     text: 'text-sky-300',     ring: 'ring-sky-500/30',     bar: 'bg-sky-500',     glow: 'shadow-sky-500/20' },
  cyan:    { bg: 'bg-cyan-500/10',    text: 'text-cyan-300',    ring: 'ring-cyan-500/30',    bar: 'bg-cyan-500',    glow: 'shadow-cyan-500/20' },
  slate:   { bg: 'bg-slate-500/10',   text: 'text-slate-300',   ring: 'ring-slate-500/30',   bar: 'bg-slate-500',   glow: 'shadow-slate-500/20' },
  rose:    { bg: 'bg-rose-500/10',    text: 'text-rose-300',    ring: 'ring-rose-500/30',    bar: 'bg-rose-500',    glow: 'shadow-rose-500/20' },
  zinc:    { bg: 'bg-zinc-500/10',    text: 'text-zinc-300',    ring: 'ring-zinc-500/30',    bar: 'bg-zinc-500',    glow: 'shadow-zinc-500/20' },
};

const EFFORT_LABEL: Record<string, string> = { s: 'S', m: 'M', l: 'L', xl: 'XL' };

// ─── Countdown component ──────────────────────────────────────────────
function Countdown() {
  const [ms, setMs] = useState<number>(() => msUntilReplus());

  useEffect(() => {
    const id = setInterval(() => setMs(msUntilReplus()), 1000);
    return () => clearInterval(id);
  }, []);

  const { days, hours, minutes, seconds, past } = formatCountdown(ms);

  if (past) {
    return (
      <div className="text-center">
        <div className="text-sm uppercase tracking-[0.2em] text-emerald-400 font-semibold mb-2">SHOW IS LIVE 🎉</div>
        <div className="text-2xl text-zinc-300">Hope you made it to Vegas.</div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-3 sm:gap-5">
      {[
        { v: days,    l: 'Days' },
        { v: hours,   l: 'Hours' },
        { v: minutes, l: 'Min' },
        { v: seconds, l: 'Sec' },
      ].map((b, i) => (
        <React.Fragment key={b.l}>
          <div className="text-center">
            <div className="font-mono text-4xl sm:text-5xl md:text-6xl font-black bg-gradient-to-br from-white via-amber-100 to-amber-300 bg-clip-text text-transparent tabular-nums">
              {String(b.v).padStart(2, '0')}
            </div>
            <div className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-amber-400/80 mt-1 font-semibold">{b.l}</div>
          </div>
          {i < 3 ? <div className="text-3xl sm:text-4xl text-amber-500/30 font-thin">·</div> : null}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Track progress bar ───────────────────────────────────────────────
function TrackProgress({ track }: { track: RoadmapTrack }) {
  const items = ROADMAP_ITEMS.filter(i => i.track === track);
  const meta  = TRACK_META[track];
  const pal   = TRACK_COLOR_MAP[meta.color] || TRACK_COLOR_MAP.slate;

  if (items.length === 0) return null;

  const done        = items.filter(i => i.status === 'done').length;
  const inProgress  = items.filter(i => i.status === 'in-progress').length;
  const planned     = items.filter(i => i.status === 'planned').length;
  const blocked     = items.filter(i => i.status === 'blocked').length;
  const ideas       = items.filter(i => i.status === 'idea').length;
  const active      = items.length - ideas; // exclude ideas from denominator for meaningful %
  const pctDone     = active === 0 ? 0 : Math.round((done / active) * 100);

  return (
    <div className={`rounded-xl border border-white/5 ${pal.bg} p-4 transition hover:ring-1 ${pal.ring}`}>
      <div className="flex items-center justify-between mb-2">
        <div className={`font-semibold text-sm ${pal.text}`}>{meta.label}</div>
        <div className="font-mono text-xs text-zinc-400 tabular-nums">
          {done}/{active} <span className="text-zinc-600">· {pctDone}%</span>
        </div>
      </div>
      <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
        <div
          className={`h-full ${pal.bar} transition-all duration-500`}
          style={{ width: `${pctDone}%` }}
        />
      </div>
      <div className="flex gap-3 mt-3 text-[10px] text-zinc-500 font-medium">
        {done       > 0 ? <span className="text-emerald-400">✓ {done} done</span> : null}
        {inProgress > 0 ? <span className="text-amber-400">⚡ {inProgress} active</span> : null}
        {planned    > 0 ? <span className="text-blue-400">◯ {planned} planned</span> : null}
        {blocked    > 0 ? <span className="text-rose-400">⚠ {blocked} blocked</span> : null}
        {ideas      > 0 ? <span className="text-zinc-500">💡 {ideas} ideas</span> : null}
      </div>
    </div>
  );
}

// ─── Roadmap card ─────────────────────────────────────────────────────
function RoadmapCard({ item }: { item: RoadmapItem }) {
  const status   = STATUS_CONFIG[item.status];
  const priority = PRIORITY_CONFIG[item.priority];
  const meta     = TRACK_META[item.track];
  const pal      = TRACK_COLOR_MAP[meta.color] || TRACK_COLOR_MAP.slate;
  const StatusIcon = status.icon;

  return (
    <div className={`group rounded-xl border border-white/5 bg-zinc-950/60 p-4 hover:ring-1 ${pal.ring} hover:bg-zinc-900/60 transition-all duration-200`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full ${status.dot} shrink-0`} />
          <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${pal.text} ${pal.bg} ${pal.ring} ring-1 whitespace-nowrap`}>
            {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${priority.badge}`}>
            {item.priority}
          </span>
          {item.effort ? (
            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-white/10 bg-black/40 text-zinc-400">
              {EFFORT_LABEL[item.effort]}
            </span>
          ) : null}
        </div>
      </div>

      {/* Title */}
      <h3 className="text-white font-semibold text-sm leading-snug mb-1.5">{item.title}</h3>

      {/* Summary */}
      <p className="text-zinc-400 text-xs leading-relaxed mb-3 line-clamp-3">{item.summary}</p>

      {/* Status footer */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${status.badge}`}>
          <StatusIcon className="h-3 w-3" />
          {status.label}
          {item.shippedIn ? <span className="font-mono text-[10px] opacity-80 ml-1">· {item.shippedIn}</span> : null}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-mono">
          {item.commits && item.commits.length > 0 ? (
            <span title={`${item.commits.length} commit(s)`} className="inline-flex items-center gap-0.5">
              <GitCommit className="h-3 w-3" /> {item.commits[0].slice(0, 7)}
            </span>
          ) : null}
          {item.files && item.files.length > 0 ? (
            <span title={`${item.files.length} file(s)`} className="inline-flex items-center gap-0.5">
              <FileCode className="h-3 w-3" /> {item.files.length}
            </span>
          ) : null}
          {item.dependsOn && item.dependsOn.length > 0 ? (
            <span title={`depends on ${item.dependsOn.length}`} className="inline-flex items-center gap-0.5">
              <ArrowRight className="h-3 w-3" /> {item.dependsOn.length}
            </span>
          ) : null}
        </div>
      </div>

      {item.notes ? (
        <details className="mt-2">
          <summary className="text-[10px] text-zinc-600 hover:text-zinc-400 cursor-pointer">notes</summary>
          <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed italic">{item.notes}</p>
        </details>
      ) : null}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────
export default function RoadmapPage() {
  const counts = useMemo(() => getRoadmapCounts(), []);
  const [statusFilter,   setStatusFilter]   = useState<RoadmapStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<RoadmapPriority | 'all'>('all');
  const [trackFilter,    setTrackFilter]    = useState<RoadmapTrack | 'all'>('all');

  const filtered = useMemo(() => {
    let items = [...ROADMAP_ITEMS];
    if (statusFilter   !== 'all') items = items.filter(i => i.status   === statusFilter);
    if (priorityFilter !== 'all') items = items.filter(i => i.priority === priorityFilter);
    if (trackFilter    !== 'all') items = items.filter(i => i.track    === trackFilter);
    // Sort: in-progress first, then by priority, then by status order
    const statusOrder: Record<RoadmapStatus, number> = {
      'in-progress': 0, 'blocked': 1, 'planned': 2, 'idea': 3, 'done': 4,
    };
    items.sort((a, b) => {
      const s = statusOrder[a.status] - statusOrder[b.status];
      if (s !== 0) return s;
      return PRIORITY_CONFIG[a.priority].weight - PRIORITY_CONFIG[b.priority].weight;
    });
    return items;
  }, [statusFilter, priorityFilter, trackFilter]);

  const activeFilterCount =
    (statusFilter   !== 'all' ? 1 : 0) +
    (priorityFilter !== 'all' ? 1 : 0) +
    (trackFilter    !== 'all' ? 1 : 0);

  const pctDone = Math.round(
    ((counts.byStatus.done ?? 0) / Math.max(1, counts.total - (counts.byStatus.idea ?? 0))) * 100,
  );

  const tracks = Object.keys(TRACK_META) as RoadmapTrack[];

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-black to-zinc-950 text-white">
      {/* ═══ HERO ═══════════════════════════════════════════════════════ */}
      <div className="relative overflow-hidden border-b border-white/5">
        {/* Animated gradient backdrop */}
        <div className="absolute inset-0 bg-gradient-to-br from-amber-600/20 via-rose-600/10 to-blue-600/20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(245,158,11,0.15),_transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(59,130,246,0.15),_transparent_50%)]" />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative px-6 py-10 sm:px-10 sm:py-14 max-w-7xl mx-auto">
          {/* Eyebrow */}
          <div className="flex items-center gap-2 mb-4">
            <Rocket className="h-4 w-4 text-amber-400" />
            <span className="text-xs uppercase tracking-[0.25em] text-amber-400 font-semibold">
              Roadmap · Mission Control
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black leading-none mb-3">
            <span className="bg-gradient-to-r from-white via-amber-100 to-white bg-clip-text text-transparent">
              Road to
            </span>{' '}
            <span className="bg-gradient-to-r from-amber-400 via-rose-400 to-violet-400 bg-clip-text text-transparent">
              RE+ 2026
            </span>
          </h1>
          <p className="text-zinc-400 text-base sm:text-lg max-w-2xl mb-6">
            Every to-do, shipped feature, and open question between now and the booth. One board, one
            destination.
          </p>

          {/* Venue badges */}
          <div className="flex flex-wrap gap-2 mb-8">
            <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-200">
              <Calendar className="h-3.5 w-3.5" /> Nov 16–19, 2026
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-200">
              <MapPin className="h-3.5 w-3.5" /> Las Vegas Convention Center
            </span>
            <a
              href={RE_PLUS_2026.website}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 transition"
            >
              re-plus.com <ArrowRight className="h-3 w-3" />
            </a>
          </div>

          {/* Countdown */}
          <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-black/60 via-amber-950/30 to-black/60 backdrop-blur-sm p-6 sm:p-8 shadow-2xl shadow-amber-500/10">
            <div className="text-center mb-4">
              <div className="text-[10px] sm:text-xs uppercase tracking-[0.3em] text-amber-400/80 font-semibold">
                ⏱ Countdown to Doors Open
              </div>
            </div>
            <Countdown />
          </div>
        </div>
      </div>

      {/* ═══ STATS STRIP ═══════════════════════════════════════════════ */}
      <div className="max-w-7xl mx-auto px-6 py-8 sm:px-10">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Total"      value={counts.total}                      icon={Package}      tint="text-white"         glow="from-zinc-500/10" />
          <StatCard label="Done"       value={counts.byStatus.done       ?? 0}   icon={Trophy}       tint="text-emerald-400"   glow="from-emerald-500/10" />
          <StatCard label="In Progress" value={counts.byStatus['in-progress'] ?? 0} icon={Zap}        tint="text-amber-400"     glow="from-amber-500/10" />
          <StatCard label="Planned"    value={counts.byStatus.planned    ?? 0}   icon={Target}       tint="text-blue-400"      glow="from-blue-500/10" />
          <StatCard label="P0 Critical" value={counts.byPriority.p0      ?? 0}   icon={AlertCircle}  tint="text-rose-400"      glow="from-rose-500/10" />
        </div>

        {/* Overall progress */}
        <div className="mt-6 rounded-2xl border border-white/5 bg-zinc-950/60 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-semibold text-white">Overall Progress</span>
              <span className="text-xs text-zinc-500">
                (ideas excluded — {counts.byStatus.done ?? 0} done of {counts.total - (counts.byStatus.idea ?? 0)} active)
              </span>
            </div>
            <span className="font-mono text-lg font-black bg-gradient-to-r from-emerald-400 to-emerald-300 bg-clip-text text-transparent tabular-nums">
              {pctDone}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-black/40 overflow-hidden ring-1 ring-white/5">
            <div
              className="h-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-emerald-300 transition-all duration-700 shadow-lg shadow-emerald-500/30"
              style={{ width: `${pctDone}%` }}
            />
          </div>
        </div>
      </div>

      {/* ═══ TRACK PROGRESS GRID ══════════════════════════════════════ */}
      <div className="max-w-7xl mx-auto px-6 pb-8 sm:px-10">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-4 w-4 text-violet-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">Tracks</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {tracks.map(t => <TrackProgress key={t} track={t} />)}
        </div>
      </div>

      {/* ═══ FILTERS + BOARD ══════════════════════════════════════════ */}
      <div className="max-w-7xl mx-auto px-6 pb-16 sm:px-10">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-zinc-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
              Board
              <span className="ml-2 text-zinc-600 font-mono font-normal text-xs normal-case tracking-normal">
                ({filtered.length} of {counts.total})
              </span>
            </h2>
          </div>
          {activeFilterCount > 0 ? (
            <button
              onClick={() => { setStatusFilter('all'); setPriorityFilter('all'); setTrackFilter('all'); }}
              className="text-xs text-zinc-400 hover:text-white px-3 py-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition"
            >
              Clear filters ({activeFilterCount})
            </button>
          ) : null}
        </div>

        {/* Filter chips */}
        <div className="space-y-2 mb-5">
          <FilterRow
            label="Status"
            value={statusFilter}
            onChange={v => setStatusFilter(v as RoadmapStatus | 'all')}
            options={[
              { v: 'all',         l: `All · ${counts.total}` },
              { v: 'in-progress', l: `⚡ In Progress · ${counts.byStatus['in-progress'] ?? 0}` },
              { v: 'planned',     l: `◯ Planned · ${counts.byStatus.planned ?? 0}` },
              { v: 'blocked',     l: `⚠ Blocked · ${counts.byStatus.blocked ?? 0}` },
              { v: 'done',        l: `✓ Done · ${counts.byStatus.done ?? 0}` },
              { v: 'idea',        l: `💡 Ideas · ${counts.byStatus.idea ?? 0}` },
            ]}
          />
          <FilterRow
            label="Priority"
            value={priorityFilter}
            onChange={v => setPriorityFilter(v as RoadmapPriority | 'all')}
            options={[
              { v: 'all', l: `All` },
              { v: 'p0',  l: `P0 · ${counts.byPriority.p0 ?? 0}` },
              { v: 'p1',  l: `P1 · ${counts.byPriority.p1 ?? 0}` },
              { v: 'p2',  l: `P2 · ${counts.byPriority.p2 ?? 0}` },
              { v: 'p3',  l: `P3 · ${counts.byPriority.p3 ?? 0}` },
            ]}
          />
          <FilterRow
            label="Track"
            value={trackFilter}
            onChange={v => setTrackFilter(v as RoadmapTrack | 'all')}
            options={[
              { v: 'all', l: 'All tracks' },
              ...(Object.keys(TRACK_META) as RoadmapTrack[]).map(t => ({
                v: t, l: `${TRACK_META[t].label} · ${counts.byTrack[t] ?? 0}`,
              })),
            ]}
          />
        </div>

        {/* Card grid */}
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-white/5 bg-zinc-950/60 p-10 text-center">
            <div className="text-zinc-600 text-sm">No items match the current filters.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(item => <RoadmapCard key={item.id} item={item} />)}
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center">
          <p className="text-xs text-zinc-600 font-mono">
            Edit this board → <code className="text-zinc-400">lib/roadmapRE26.ts</code>
          </p>
          <p className="text-[10px] text-zinc-700 mt-1">
            One source of truth. Git-versioned. Ship-ready.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable atoms ───────────────────────────────────────────────────
function StatCard({
  label, value, icon: Icon, tint, glow,
}: {
  label: string; value: number; icon: React.ElementType; tint: string; glow: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-white/5 bg-zinc-950/60 p-4`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${glow} to-transparent opacity-60`} />
      <div className="relative flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-0.5">{label}</div>
          <div className={`font-black text-2xl tabular-nums ${tint}`}>{value}</div>
        </div>
        <Icon className={`h-5 w-5 ${tint} opacity-50`} />
      </div>
    </div>
  );
}

function FilterRow({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold w-16 shrink-0">{label}</span>
      <div className="flex gap-1.5 flex-wrap">
        {options.map(o => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
              value === o.v
                ? 'bg-white text-black border-white font-semibold'
                : 'bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10 hover:text-white'
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}