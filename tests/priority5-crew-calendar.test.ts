/**
 * Priority 5 — Crew Calendar View
 *
 * Tests cover:
 *   1. weekStart() — correct Monday calculation for any input day
 *   2. weekDays() — returns 7 days Mon–Sun
 *   3. toIso() — correct YYYY-MM-DD format
 *   4. formatDayHeader() — weekday + day number
 *   5. formatWeekRange() — various same/different month/year combos
 *   6. isToday() — today detection
 *   7. crewHue() — deterministic + in 0-359 range
 *   8. crewChipColor() — uses crewColor when provided, falls back to HSL
 *   9. groupEventsByDate() — grouping by installDate
 *  10. Component export surface
 *  11. Source-code assertions: CrewCalendar render contract
 *  12. Source-code assertions: /api/crew-schedule route
 *  13. Source-code assertions: dashboard integration
 *  14. weekStart() property tests (idempotent, always Monday)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  weekStart,
  weekDays,
  toIso,
  formatDayHeader,
  formatWeekRange,
  isToday,
  crewHue,
  crewChipColor,
  groupEventsByDate,
  type ScheduleEvent,
} from '@/components/crew/CrewCalendar';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
}

function makeEvent(id: string, date: string, crew: string): ScheduleEvent {
  return {
    id,
    projectId: id,
    projectName: `Project ${id}`,
    address: '123 Main St',
    crewAssigned: crew,
    installDate: date,
    systemSizeKw: 8.5,
    status: 'installation',
  };
}

// ─── 1. weekStart() ───────────────────────────────────────────────────────────

describe('weekStart()', () => {
  it('returns Monday for a Monday input', () => {
    const mon = new Date('2025-01-13'); // Monday
    const start = weekStart(mon);
    expect(start.getDay()).toBe(1); // 1 = Monday
    expect(toIso(start)).toBe('2025-01-13');
  });

  it('returns Monday for a Wednesday input', () => {
    const wed = new Date('2025-01-15'); // Wednesday
    const start = weekStart(wed);
    expect(start.getDay()).toBe(1);
    expect(toIso(start)).toBe('2025-01-13');
  });

  it('returns Monday for a Sunday input (previous week)', () => {
    const sun = new Date('2025-01-19'); // Sunday
    const start = weekStart(sun);
    expect(start.getDay()).toBe(1);
    expect(toIso(start)).toBe('2025-01-13');
  });

  it('returns Monday for a Saturday input', () => {
    const sat = new Date('2025-01-18'); // Saturday
    const start = weekStart(sat);
    expect(start.getDay()).toBe(1);
    expect(toIso(start)).toBe('2025-01-13');
  });

  it('weekStart of a Monday is idempotent', () => {
    const mon = new Date('2025-03-10');
    const start1 = weekStart(mon);
    const start2 = weekStart(start1);
    expect(toIso(start1)).toBe(toIso(start2));
  });

  it('always returns day-of-week === 1 (Monday)', () => {
    const dates = [
      '2025-01-13', '2025-01-14', '2025-01-15', '2025-01-16',
      '2025-01-17', '2025-01-18', '2025-01-19',
    ];
    for (const d of dates) {
      const result = weekStart(new Date(d));
      expect(result.getDay()).toBe(1);
    }
  });

  it('does not mutate the input date', () => {
    const input = new Date('2025-06-15');
    const inputDay = input.getDate();
    weekStart(input);
    expect(input.getDate()).toBe(inputDay);
  });
});

// ─── 2. weekDays() ───────────────────────────────────────────────────────────

describe('weekDays()', () => {
  it('returns exactly 7 days', () => {
    expect(weekDays(new Date('2025-01-15'))).toHaveLength(7);
  });

  it('first day is Monday, last is Sunday', () => {
    const days = weekDays(new Date('2025-01-15')); // Wednesday
    expect(days[0].getDay()).toBe(1); // Monday
    expect(days[6].getDay()).toBe(0); // Sunday
  });

  it('days are consecutive (each is 1 day after the previous)', () => {
    const days = weekDays(new Date('2025-01-20'));
    for (let i = 1; i < days.length; i++) {
      const diff = days[i].getTime() - days[i - 1].getTime();
      expect(diff).toBe(24 * 60 * 60 * 1000); // 1 day in ms
    }
  });

  it('Mon–Sun range is correct for a Wednesday input', () => {
    const days = weekDays(new Date('2025-01-15')).map(toIso);
    expect(days[0]).toBe('2025-01-13');
    expect(days[6]).toBe('2025-01-19');
  });
});

// ─── 3. toIso() ──────────────────────────────────────────────────────────────

describe('toIso()', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(toIso(new Date('2025-01-05'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('pads month and day with zeros', () => {
    // Use UTC to avoid timezone offset issues in toIso
    const d = new Date('2025-01-05T12:00:00Z');
    const iso = toIso(d);
    // Either 2025-01-05 or 2025-01-04 depending on local TZ — we just check format
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── 4. formatDayHeader() ────────────────────────────────────────────────────

describe('formatDayHeader()', () => {
  it('returns weekday and day number', () => {
    const d = new Date('2025-01-13T12:00:00'); // Monday Jan 13
    const { weekday, day } = formatDayHeader(d);
    expect(typeof weekday).toBe('string');
    expect(weekday.length).toBeGreaterThan(0);
    expect(day).toBe('13');
  });

  it('weekday is a valid 3-letter abbreviation', () => {
    const days = weekDays(new Date('2025-01-13T12:00:00'));
    const expected = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    days.forEach((d, i) => {
      const { weekday } = formatDayHeader(d);
      expect(weekday).toBe(expected[i]);
    });
  });
});

// ─── 5. formatWeekRange() ────────────────────────────────────────────────────

describe('formatWeekRange()', () => {
  it('returns a non-empty string', () => {
    const days = weekDays(new Date('2025-01-15'));
    expect(formatWeekRange(days).length).toBeGreaterThan(0);
  });

  it('includes the year somewhere in the output', () => {
    const days = weekDays(new Date('2025-01-15'));
    expect(formatWeekRange(days)).toContain('2025');
  });

  it('handles week spanning two months', () => {
    // Jan 27 – Feb 2
    const days = weekDays(new Date('2025-01-29'));
    const range = formatWeekRange(days);
    expect(range.length).toBeGreaterThan(0);
  });

  it('handles week spanning two years', () => {
    // Dec 29, 2025 – Jan 4, 2026
    const days = weekDays(new Date('2025-12-31'));
    const range = formatWeekRange(days);
    expect(range.length).toBeGreaterThan(0);
  });
});

// ─── 6. isToday() ────────────────────────────────────────────────────────────

describe('isToday()', () => {
  it('returns true for today', () => {
    expect(isToday(new Date())).toBe(true);
  });

  it('returns false for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isToday(yesterday)).toBe(false);
  });

  it('returns false for tomorrow', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isToday(tomorrow)).toBe(false);
  });

  it('returns false for a far-future date', () => {
    expect(isToday(new Date('2030-01-01'))).toBe(false);
  });
});

// ─── 7. crewHue() ────────────────────────────────────────────────────────────

describe('crewHue()', () => {
  it('returns a number in [0, 359]', () => {
    const names = ['Team Alpha', 'Team Bravo', 'Team Charlie', 'X', 'a very long crew name here'];
    for (const name of names) {
      const hue = crewHue(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('is deterministic (same input → same output)', () => {
    expect(crewHue('Team Alpha')).toBe(crewHue('Team Alpha'));
    expect(crewHue('X')).toBe(crewHue('X'));
  });

  it('returns different values for different names (not all zero)', () => {
    const hues = new Set(['Team Alpha', 'Team Bravo', 'Crew 1', 'Crew 2'].map(crewHue));
    expect(hues.size).toBeGreaterThan(1);
  });

  it('handles empty string', () => {
    const hue = crewHue('');
    expect(typeof hue).toBe('number');
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
});

// ─── 8. crewChipColor() ──────────────────────────────────────────────────────

describe('crewChipColor()', () => {
  it('returns the provided crewColor when not null', () => {
    expect(crewChipColor('Team Alpha', '#ff0000')).toBe('#ff0000');
    expect(crewChipColor('Team Beta', 'blue')).toBe('blue');
  });

  it('returns an HSL string when crewColor is null', () => {
    const color = crewChipColor('Team Alpha', null);
    expect(color).toMatch(/^hsl\(/);
  });

  it('returns an HSL string when crewColor is undefined', () => {
    const color = crewChipColor('Team Alpha', undefined);
    expect(color).toMatch(/^hsl\(/);
  });

  it('is deterministic for the fallback path', () => {
    expect(crewChipColor('Team Alpha', null)).toBe(crewChipColor('Team Alpha', null));
  });
});

// ─── 9. groupEventsByDate() ──────────────────────────────────────────────────

describe('groupEventsByDate()', () => {
  it('returns empty object for no events', () => {
    expect(groupEventsByDate([])).toEqual({});
  });

  it('groups events by installDate', () => {
    const events = [
      makeEvent('e1', '2025-01-13', 'Team Alpha'),
      makeEvent('e2', '2025-01-13', 'Team Beta'),
      makeEvent('e3', '2025-01-14', 'Team Alpha'),
    ];
    const grouped = groupEventsByDate(events);
    expect(grouped['2025-01-13']).toHaveLength(2);
    expect(grouped['2025-01-14']).toHaveLength(1);
    expect(Object.keys(grouped)).toHaveLength(2);
  });

  it('normalises YYYY-MM-DD timestamps (truncates time portion)', () => {
    const events = [
      makeEvent('e1', '2025-01-13T00:00:00Z', 'Alpha'),
    ];
    const grouped = groupEventsByDate(events);
    expect(grouped['2025-01-13']).toHaveLength(1);
  });

  it('skips events with null installDate', () => {
    const events: ScheduleEvent[] = [
      { ...makeEvent('e1', '2025-01-13', 'Alpha'), installDate: null as any },
      makeEvent('e2', '2025-01-14', 'Beta'),
    ];
    const grouped = groupEventsByDate(events);
    expect(Object.keys(grouped)).toHaveLength(1);
    expect(grouped['2025-01-14']).toHaveLength(1);
  });

  it('handles 50 events across 5 days evenly', () => {
    const dates = ['2025-01-13', '2025-01-14', '2025-01-15', '2025-01-16', '2025-01-17'];
    const events = dates.flatMap((d, di) =>
      Array.from({ length: 10 }, (_, i) => makeEvent(`e${di * 10 + i}`, d, 'Alpha')),
    );
    const grouped = groupEventsByDate(events);
    for (const d of dates) {
      expect(grouped[d]).toHaveLength(10);
    }
  });
});

// ─── 10. Export surface ───────────────────────────────────────────────────────

describe('CrewCalendar exports', () => {
  it('ScheduleEvent type — duck-type check', () => {
    const ev: ScheduleEvent = makeEvent('x', '2025-01-13', 'Alpha');
    expect(ev.crewAssigned).toBe('Alpha');
    expect(ev.installDate).toBe('2025-01-13');
  });
});

// ─── 11. CrewCalendar source assertions ──────────────────────────────────────

describe('CrewCalendar source — render contract', () => {
  const src = readSrc('components/crew/CrewCalendar.tsx');

  it('has Lightbox-free weekly grid (7 day cells)', () => {
    expect(src).toContain('grid-cols-7');
  });

  it('has prev/next week navigation', () => {
    expect(src).toContain('prevWeek');
    expect(src).toContain('nextWeek');
  });

  it('has "Today" button', () => {
    expect(src).toContain('goToday');
    expect(src).toContain('Today');
  });

  it('fetches from /api/crew-schedule', () => {
    expect(src).toContain('/api/crew-schedule');
  });

  it('fetches from /api/crews for colour data', () => {
    expect(src).toContain('/api/crews');
  });

  it('has keyboard arrow nav NOT required (not a lightbox pattern)', () => {
    // CrewCalendar does not use keyboard nav — that is in InstallPhotos lightbox
    // Just assert the component has onClick nav buttons instead
    expect(src).toContain('aria-label="Previous week"');
    expect(src).toContain('aria-label="Next week"');
  });

  it('has crew colour legend', () => {
    expect(src).toContain('Legend');
  });

  it('has empty state guidance for scheduling', () => {
    expect(src).toContain('Install Date');
    expect(src).toContain('Operations tab');
  });

  it('displays event chips linking to project pages', () => {
    expect(src).toContain('/projects/${event.projectId}');
  });

  it('uses DayCellProps with events array', () => {
    expect(src).toContain('DayCellProps');
    expect(src).toContain('events: ScheduleEvent[]');
  });
});

// ─── 12. /api/crew-schedule route ────────────────────────────────────────────

describe('/api/crew-schedule route source', () => {
  const src = readSrc('app/api/crew-schedule/route.ts');

  it('exports async GET', () => {
    expect(src).toContain('export async function GET');
  });

  it('validates user authentication', () => {
    expect(src).toContain('getUserFromRequest');
    expect(src).toContain('Unauthorized');
  });

  it('filters by install_date IS NOT NULL', () => {
    expect(src).toContain('install_date  IS NOT NULL');
  });

  it('filters by crew_assigned IS NOT NULL', () => {
    expect(src).toContain('crew_assigned IS NOT NULL');
  });

  it('queries within date range (from/to params)', () => {
    expect(src).toContain('from');
    expect(src).toContain('to');
    expect(src).toContain('BETWEEN');
  });

  it('validates ISO date format (YYYY-MM-DD)', () => {
    expect(src).toContain('isIsoDate');
    expect(src).toContain('\\d{4}-\\d{2}-\\d{2}');
  });

  it('returns { events: [...] } shape', () => {
    expect(src).toContain('{ events }');
  });

  it('orders by install_date ASC, crew_assigned ASC', () => {
    expect(src).toContain('install_date ASC');
    expect(src).toContain('crew_assigned ASC');
  });

  it('only returns projects owned by the user', () => {
    expect(src).toContain('user_id       = ${user.id}');
  });

  it('excludes soft-deleted projects', () => {
    expect(src).toContain('deleted_at    IS NULL');
  });

  it('has default 7-days-past through 60-days-future window', () => {
    expect(src).toContain('- 7');
    expect(src).toContain('+ 60');
  });
});

// ─── 13. Dashboard integration ───────────────────────────────────────────────

describe('Dashboard source — CrewCalendar integration', () => {
  const src = readSrc('app/dashboard/page.tsx');

  it('imports CrewCalendar via dynamic()', () => {
    expect(src).toContain("import('@/components/crew/CrewCalendar')");
  });

  it('uses ssr: false for CrewCalendar', () => {
    expect(src).toContain('ssr: false');
  });

  it('renders <CrewCalendar />', () => {
    expect(src).toContain('<CrewCalendar');
  });
});
