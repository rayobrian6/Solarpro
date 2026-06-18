'use client';

/**
 * CrewCalendar
 * ─────────────────────────────────────────────────────────────────────────────
 * Weekly calendar view showing crew install schedules.
 *
 * Design:
 *  - Shows 7-day week grid (Mon → Sun)
 *  - Each cell contains event chips for that day, grouped by crew
 *  - Navigate weeks with prev / next / today buttons
 *  - Colour-codes events using the crew's colour from the crews API
 *    (falls back to a deterministic hue from the crew name hash)
 *  - Click an event chip to jump to the project
 *  - Zero external calendar library — pure React + CSS vars
 *  - Fetches from GET /api/crew-schedule and GET /api/crews
 *
 * Props:
 *  none — self-contained with internal state
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Card } from '@/components/ui/Card';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleEvent {
  id: string;
  projectId: string;
  projectName: string;
  address: string;
  crewAssigned: string;
  installDate: string;        // YYYY-MM-DD
  systemSizeKw: number | null;
  status: string;
}

export interface Crew {
  id: string;
  name: string;
  color: string | null;
}

// ─── Date utilities ───────────────────────────────────────────────────────────

/** Returns the Monday of the week containing the given date */
export function weekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, …
  const diff = day === 0 ? -6 : 1 - day; // adjust so week starts Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Returns array of 7 Date objects for the Mon–Sun week containing baseDate */
export function weekDays(baseDate: Date): Date[] {
  const start = weekStart(baseDate);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** YYYY-MM-DD from a Date — LOCAL time, not UTC. toISOString() converts to UTC,
 *  which shifts the day backward in positive-UTC timezones (e.g. Australia), so
 *  events render on the wrong day or disappear. */
export function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format a Date as "Mon 14" */
export function formatDayHeader(d: Date): { weekday: string; day: string } {
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    day: String(d.getDate()),
  };
}

/** Format week range as "Jan 13 – Jan 19, 2025" */
export function formatWeekRange(days: Date[]): string {
  const first = days[0];
  const last  = days[6];
  const sameYear = first.getFullYear() === last.getFullYear();
  const sameMonth = first.getMonth() === last.getMonth();

  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const yearOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

  if (sameMonth && sameYear) {
    return `${first.toLocaleDateString('en-US', opts)} – ${last.getDate()}, ${last.getFullYear()}`;
  }
  if (sameYear) {
    return `${first.toLocaleDateString('en-US', opts)} – ${last.toLocaleDateString('en-US', yearOpts)}`;
  }
  return `${first.toLocaleDateString('en-US', yearOpts)} – ${last.toLocaleDateString('en-US', yearOpts)}`;
}

/** Returns true if a Date is today */
export function isToday(d: Date): boolean {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

// ─── Colour utilities ─────────────────────────────────────────────────────────

/** Deterministic hue from a crew name (for crews without a DB colour) */
export function crewHue(crewName: string): number {
  let h = 0;
  for (let i = 0; i < crewName.length; i++) {
    h = (h * 31 + crewName.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h) % 360;
}

/** Returns a CSS background colour for a crew chip */
export function crewChipColor(crewName: string, crewColor: string | null | undefined): string {
  if (crewColor) return crewColor;
  const hue = crewHue(crewName);
  return `hsl(${hue},50%,40%)`;
}

// ─── Group events by date ─────────────────────────────────────────────────────

export function groupEventsByDate(events: ScheduleEvent[]): Record<string, ScheduleEvent[]> {
  const map: Record<string, ScheduleEvent[]> = {};
  for (const ev of events) {
    if (!ev.installDate) continue;
    const key = ev.installDate.slice(0, 10);
    if (!map[key]) map[key] = [];
    map[key].push(ev);
  }
  return map;
}

// ─── Event chip ───────────────────────────────────────────────────────────────

interface EventChipProps {
  event: ScheduleEvent;
  crewColor: string;
}

function EventChip({ event, crewColor }: EventChipProps) {
  const href = `/projects/${event.projectId}`;

  return (
    <a
      href={href}
      className="flex items-start gap-1 rounded px-1.5 py-1 text-[10px] leading-tight group"
      style={{
        background: crewColor,
        color: '#fff',
        textDecoration: 'none',
        minWidth: 0,
      }}
      title={`${event.projectName}\n${event.address}\nCrew: ${event.crewAssigned}${event.systemSizeKw ? ` · ${event.systemSizeKw} kW` : ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{event.projectName}</div>
        {event.systemSizeKw ? (
          <div className="opacity-80">{event.systemSizeKw} kW</div>
        ) : null}
        <div className="opacity-70 truncate" style={{ fontSize: 8 }}>
          {event.crewAssigned}
        </div>
      </div>
      <ExternalLink size={8} className="opacity-60 flex-shrink-0 mt-0.5" />
    </a>
  );
}

// ─── Day cell ─────────────────────────────────────────────────────────────────

interface DayCellProps {
  date: Date;
  events: ScheduleEvent[];
  crewColorMap: Record<string, string>;
}

function DayCell({ date, events, crewColorMap }: DayCellProps) {
  const today = isToday(date);

  return (
    <div
      className="flex flex-col min-h-[80px] rounded-lg border p-1.5 gap-1"
      style={{
        borderColor: today ? 'var(--accent-color)' : 'var(--border-color)',
        background: today ? 'rgba(var(--accent-rgb, 59,130,246),0.05)' : 'var(--bg-primary)',
        borderWidth: today ? 2 : 1,
      }}
    >
      {/* Day number */}
      <div
        className={`text-[10px] font-bold self-start rounded px-1 py-0.5 ${today ? 'text-white' : ''}`}
        style={{
          background: today ? 'var(--accent-color)' : 'transparent',
          color: today ? '#fff' : 'var(--text-muted)',
          minWidth: '20px',
          textAlign: 'center',
        }}
      >
        {date.getDate()}
      </div>

      {/* Events */}
      <div className="flex flex-col gap-0.5">
        {events.map(ev => (
          <EventChip
            key={ev.id}
            event={ev}
            crewColor={crewColorMap[ev.crewAssigned] ?? crewChipColor(ev.crewAssigned, null)}
          />
        ))}
      </div>

      {events.length === 0 ? (
        <div
          className="flex-1 flex items-center justify-center text-[9px]"
          style={{ color: 'var(--border-color)' }}
        >
          —
        </div>
      ) : null}
    </div>
  );
}

// ─── Calendar legend ──────────────────────────────────────────────────────────

interface LegendProps {
  crews: string[];
  colorMap: Record<string, string>;
}

function Legend({ crews, colorMap }: LegendProps) {
  if (crews.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {crews.map(name => (
        <div key={name} className="flex items-center gap-1.5">
          <div
            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ background: colorMap[name] ?? crewChipColor(name, null) }}
          />
          <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{name}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CrewCalendar() {
  const [baseDate, setBaseDate] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => weekDays(baseDate), [baseDate]);
  const weekRange = useMemo(() => formatWeekRange(days), [days]);

  // Crew colour map: crewName → CSS colour string
  const crewColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    // First, populate from the DB crew list (name-based lookup)
    for (const c of crews) {
      if (c.name) {
        map[c.name] = crewChipColor(c.name, c.color);
      }
    }
    // Then fill in any event crews not in the DB list
    for (const ev of events) {
      if (ev.crewAssigned && !map[ev.crewAssigned]) {
        map[ev.crewAssigned] = crewChipColor(ev.crewAssigned, null);
      }
    }
    return map;
  }, [crews, events]);

  // Unique crew names that appear in current events (for legend)
  const activeCrews = useMemo(() => {
    const names = new Set<string>();
    for (const ev of events) {
      if (ev.crewAssigned) names.add(ev.crewAssigned);
    }
    return Array.from(names).sort();
  }, [events]);

  // Fetch schedule + crew list for the current week
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch a 3-week window centred on the current week (prevents re-fetches on week nav)
      const start = weekStart(days[0]);
      start.setDate(start.getDate() - 7);
      const end = new Date(days[6]);
      end.setDate(end.getDate() + 7);

      const [schedRes, crewRes] = await Promise.allSettled([
        fetch(`/api/crew-schedule?from=${toIso(start)}&to=${toIso(end)}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/crews').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      const schedJson = schedRes.status === 'fulfilled' ? schedRes.value : null;
      setEvents(Array.isArray(schedJson?.events) ? schedJson.events : []);

      const crewJson = crewRes.status === 'fulfilled' ? crewRes.value : null;
      setCrews(Array.isArray(crewJson?.crews) ? crewJson.crews : []);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Group events by date for quick lookup
  const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);

  // Navigation
  const prevWeek = () => setBaseDate(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
  const nextWeek = () => setBaseDate(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
  const goToday  = () => setBaseDate(new Date());

  const totalThisWeek = days.reduce((sum, d) => sum + (eventsByDate[toIso(d)]?.length ?? 0), 0);

  return (
    <Section
      title="Crew Schedule"
      subtitle={`${weekRange}${totalThisWeek > 0 ? ` · ${totalThisWeek} install${totalThisWeek !== 1 ? 's' : ''} this week` : ''}`}
      action={
        <div className="flex items-center gap-1.5">
          <button
            onClick={goToday}
            className="text-[10px] font-medium px-2.5 py-1 rounded border transition-colors"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
          >
            Today
          </button>
          <button
            onClick={prevWeek}
            className="p-1 rounded border transition-colors"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
            aria-label="Previous week"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={nextWeek}
            className="p-1 rounded border transition-colors"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
            aria-label="Next week"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      }
    >
      {error ? (
        <div
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg mb-3"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <AlertTriangle size={12} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto underline text-[10px]">dismiss</button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading schedule…</span>
        </div>
      ) : (
        <>
          {/* Crew legend */}
          <Legend crews={activeCrews} colorMap={crewColorMap} />

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1.5 mb-1">
            {WEEKDAY_LABELS.map(label => (
              <div
                key={label}
                className="text-center text-[9px] font-semibold uppercase tracking-wider py-1"
                style={{ color: 'var(--text-muted)' }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1.5">
            {days.map(d => {
              const iso = toIso(d);
              return (
                <DayCell
                  key={iso}
                  date={d}
                  events={eventsByDate[iso] ?? []}
                  crewColorMap={crewColorMap}
                />
              );
            })}
          </div>

          {/* Empty state */}
          {totalThisWeek === 0 && (
            <div className="text-center py-6 mt-2">
              <Calendar size={24} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                No installs scheduled this week
              </p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                Set an Install Date and Crew in any project's Operations tab to see it here.
              </p>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
