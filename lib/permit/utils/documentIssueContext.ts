// ═══════════════════════════════════════════════════════════════════════════
// documentIssueContext — D6 (Planset 19): THE ONE project-facing document date.
//
// Planset 19 printed issue/revision date 8/3/2026 on all 17 sheets for an
// artifact generated the evening of 2026-08-02 America/Chicago. The date was
// produced by:
//
//     new Date().toLocaleDateString('en-US')      // generatePermit.ts
//
// `toLocaleDateString` with NO `timeZone` option formats in the HOST's zone. On
// a serverless host (UTC) that IS the UTC calendar date, so every sheet in the
// package advanced a day at 19:00 local. A permit document date is a legal
// calendar date in the JURISDICTION's zone; it is never a property of whichever
// machine happened to render the sheet.
//
// This module resolves the document date ONCE, explicitly, from a declared
// timezone. Every project-facing date on every sheet propagates from the single
// object it returns — no sheet generator calls `new Date()` for a printed date.
//
// RESOLUTION PRECEDENCE (first match wins, and every outcome is RECORDED in
// `timezoneSource` / `issueDateSource` so the artifact states how it decided):
//
//   1. explicit document issue date   — an operator/AHJ-supplied issue date is
//                                       an authority; it is used verbatim.
//   2. explicit project timezone      — project.timezone (IANA)
//   3. project jurisdiction timezone  — derived from the project's state, and
//                                       ONLY for states that occupy exactly one
//                                       zone. A split-zone state has no single
//                                       correct answer from a state code alone,
//                                       so it deliberately falls through rather
//                                       than guess.
//   4. tenant timezone                — the installing organisation's zone
//   5. configured default             — PLANSET_DEFAULT_TIMEZONE, documented
//                                       default 'America/Chicago'
//
// An INVALID timezone never silently degrades to UTC — the UTC fallback is the
// exact defect this module exists to remove. It falls back to the ONE configured
// default, warns, and records `timezoneSource: 'configured-default-after-invalid'`.
// ═══════════════════════════════════════════════════════════════════════════

/** The documented application default. A permit set must print SOME calendar
 *  date; when nothing upstream declares a zone this is the one documented,
 *  deterministic answer — never the host's zone and never UTC. */
export const DEFAULT_DOCUMENT_TIMEZONE = 'America/Chicago';

export type DocumentTimezoneSource =
  | 'explicit-issue-date'
  | 'project-timezone'
  | 'project-jurisdiction'
  | 'tenant-timezone'
  | 'configured-default'
  | 'configured-default-after-invalid';

export type DocumentIssueDateSource = 'explicit-issue-date' | 'generation-timestamp';

/** D6 — the ONE object every project-facing date on every sheet derives from. */
export type DocumentIssueContext = {
  /** the generation instant, always in UTC ISO form (the unambiguous record). */
  generatedAtUtc: string;
  /** the IANA zone the calendar date was computed in. */
  timezone: string;
  /** how `timezone` was decided. */
  timezoneSource: DocumentTimezoneSource;
  /** the printed calendar date, 'M/D/YYYY' — what every title block shows. */
  issueDateLocal: string;
  /** the same date, ISO 'YYYY-MM-DD', for metadata and machine comparison. */
  issueDateIso: string;
  /** whether the date came from an explicit override or from the timestamp. */
  issueDateSource: DocumentIssueDateSource;
};

/** States that occupy exactly ONE IANA zone. A state code is a legitimate
 *  jurisdiction signal only where it is unambiguous; the split-zone states
 *  (AK AZ FL ID IN KS KY MI NE ND NV OR SD TN TX) are deliberately ABSENT so a
 *  Florida project falls through to the tenant/configured zone instead of being
 *  told, wrongly, that it is Eastern. */
const SINGLE_ZONE_STATE_TIMEZONES: Readonly<Record<string, string>> = {
  AL: 'America/Chicago',    AR: 'America/Chicago',    CA: 'America/Los_Angeles',
  CO: 'America/Denver',     CT: 'America/New_York',   DC: 'America/New_York',
  DE: 'America/New_York',   GA: 'America/New_York',   HI: 'Pacific/Honolulu',
  IA: 'America/Chicago',    IL: 'America/Chicago',    LA: 'America/Chicago',
  MA: 'America/New_York',   MD: 'America/New_York',   ME: 'America/New_York',
  MN: 'America/Chicago',    MO: 'America/Chicago',    MS: 'America/Chicago',
  MT: 'America/Denver',     NC: 'America/New_York',   NH: 'America/New_York',
  NJ: 'America/New_York',   NM: 'America/Denver',     NY: 'America/New_York',
  OH: 'America/New_York',   OK: 'America/Chicago',    PA: 'America/New_York',
  RI: 'America/New_York',   SC: 'America/New_York',   UT: 'America/Denver',
  VA: 'America/New_York',   VT: 'America/New_York',   WA: 'America/Los_Angeles',
  WI: 'America/Chicago',    WV: 'America/New_York',   WY: 'America/Denver',
};

/** Is this string an IANA zone this runtime can actually format in? Fail-closed:
 *  anything Intl rejects is invalid, including '' and undefined. */
export function isValidTimezone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** The configured application default, from the environment when set. An invalid
 *  configured value falls back to the in-code documented default rather than
 *  taking the whole resolution down. */
export function configuredDefaultTimezone(): string {
  const env = typeof process !== 'undefined' ? process.env?.PLANSET_DEFAULT_TIMEZONE : undefined;
  if (env && isValidTimezone(env)) return env;
  if (env) {
    console.warn('[PLANSET] PLANSET_DEFAULT_TIMEZONE is not a valid IANA timezone:',
      JSON.stringify(env), '— using', DEFAULT_DOCUMENT_TIMEZONE);
  }
  return DEFAULT_DOCUMENT_TIMEZONE;
}

/** The IANA zone for a US state code, ONLY where the state occupies one zone. */
export function timezoneForStateCode(stateCode: string | null | undefined): string | null {
  const k = String(stateCode ?? '').trim().toUpperCase();
  return SINGLE_ZONE_STATE_TIMEZONES[k] ?? null;
}

/** Format an instant as the calendar date in `timezone`.
 *  Uses `Intl.DateTimeFormat` with an EXPLICIT `timeZone` — the whole point.
 *  Returns both the printed 'M/D/YYYY' and the ISO 'YYYY-MM-DD' for the SAME
 *  local day, so the two can never describe different dates. */
export function formatLocalCalendarDate(at: Date, timezone: string): {
  local: string; iso: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(at);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const y = get('year'), m = get('month'), d = get('day');
  return {
    local: `${Number(m)}/${Number(d)}/${y}`,
    iso: `${y}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`,
  };
}

/** D6 — read the resolved context off a permit input. generatePermit freezes it
 *  there before any sheet renders; a sheet reached without it gets null and the
 *  formatter falls back to the ONE configured default — never the host's zone. */
export function documentIssueContextOf(input: unknown): DocumentIssueContext | null {
  return (input as { _documentIssueContext?: DocumentIssueContext } | null)?._documentIssueContext ?? null;
}

/** D6 — format ANY instant as a calendar date in the DOCUMENT's zone. Sheets that
 *  print a date other than the issue date (an override log entry, a retrieval
 *  stamp) use this, so no sheet ever falls back to `toLocaleDateString()` with no
 *  `timeZone` — which formats in the host's zone and shifts a UTC-stored instant
 *  by a day. An unparsable instant prints the honest em dash, never a fresh clock. */
export function formatInDocumentTimezone(
  instant: string | number | Date | null | undefined,
  ctx: Pick<DocumentIssueContext, 'timezone'> | null | undefined,
): string {
  if (instant == null || instant === '') return '—';
  const d = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(d.getTime())) return '—';
  const tz = ctx?.timezone && isValidTimezone(ctx.timezone) ? ctx.timezone : configuredDefaultTimezone();
  return formatLocalCalendarDate(d, tz).local;
}

/** Accept an explicit issue date in either 'YYYY-MM-DD' or 'M/D/YYYY' form and
 *  normalise both representations. Returns null for anything else, so a garbage
 *  override falls through to the timestamp path instead of printing garbage. */
function parseExplicitIssueDate(v: string | null | undefined): { local: string; iso: string } | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  const isoM = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const usM = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (isoM) { y = +isoM[1]; m = +isoM[2]; d = +isoM[3]; }
  else if (usM) { m = +usM[1]; d = +usM[2]; y = +usM[3]; }
  else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject impossible civil dates (2026-02-30) via a UTC round-trip — this is a
  // calendar-validity check on Y/M/D only, never a timezone conversion.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return {
    local: `${m}/${d}/${y}`,
    iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}

export interface DocumentIssueContextArgs {
  /** the generation instant. A caller may inject a fixed ISO string for
   *  deterministic output (tests / regen harnesses); absent ⇒ now. */
  generatedAtIso?: string | null;
  /** an operator/AHJ-supplied issue date — the highest authority. */
  explicitIssueDate?: string | null;
  /** IANA zone declared on the project. */
  projectTimezone?: string | null;
  /** the project's US state code, for the single-zone jurisdiction derivation. */
  projectStateCode?: string | null;
  /** IANA zone declared on the installing organisation. */
  tenantTimezone?: string | null;
}

/** D6 — resolve THE document issue context. Pure with respect to its arguments;
 *  the only impurity is `new Date()` when no `generatedAtIso` is supplied, which
 *  is exactly what a frozen-clock caller overrides. */
export function resolveDocumentIssueContext(args: DocumentIssueContextArgs): DocumentIssueContext {
  // ── the instant ──────────────────────────────────────────────────────────
  const parsed = args.generatedAtIso ? new Date(args.generatedAtIso) : null;
  const at = parsed && Number.isFinite(parsed.getTime()) ? parsed : new Date();
  if (args.generatedAtIso && !(parsed && Number.isFinite(parsed.getTime()))) {
    console.warn('[PLANSET] generatedAtIso is not a parsable instant:',
      JSON.stringify(args.generatedAtIso), '— using the current time');
  }
  const generatedAtUtc = at.toISOString();

  // ── the zone (recorded, never inferred from the host) ─────────────────────
  const fallback = configuredDefaultTimezone();
  let timezone: string;
  let timezoneSource: DocumentTimezoneSource;
  const declared = args.projectTimezone ?? null;
  const tenant = args.tenantTimezone ?? null;
  const jurisdiction = timezoneForStateCode(args.projectStateCode);

  if (declared && isValidTimezone(declared)) {
    timezone = declared; timezoneSource = 'project-timezone';
  } else if (declared) {
    console.warn('[PLANSET] project timezone is not a valid IANA zone:',
      JSON.stringify(declared), '— falling back to', fallback, '(NOT UTC)');
    timezone = fallback; timezoneSource = 'configured-default-after-invalid';
  } else if (jurisdiction) {
    timezone = jurisdiction; timezoneSource = 'project-jurisdiction';
  } else if (tenant && isValidTimezone(tenant)) {
    timezone = tenant; timezoneSource = 'tenant-timezone';
  } else if (tenant) {
    console.warn('[PLANSET] tenant timezone is not a valid IANA zone:',
      JSON.stringify(tenant), '— falling back to', fallback, '(NOT UTC)');
    timezone = fallback; timezoneSource = 'configured-default-after-invalid';
  } else {
    timezone = fallback; timezoneSource = 'configured-default';
  }

  // ── the date ─────────────────────────────────────────────────────────────
  // An explicit issue date OUTRANKS the timestamp: it is a stated authority, and
  // re-rendering a set on a later day must not silently re-date it. The zone is
  // still resolved and recorded so the artifact says how it would have decided.
  const explicit = parseExplicitIssueDate(args.explicitIssueDate);
  if (explicit) {
    return {
      generatedAtUtc, timezone,
      timezoneSource: 'explicit-issue-date',
      issueDateLocal: explicit.local,
      issueDateIso: explicit.iso,
      issueDateSource: 'explicit-issue-date',
    };
  }
  const { local, iso } = formatLocalCalendarDate(at, timezone);
  return {
    generatedAtUtc, timezone, timezoneSource,
    issueDateLocal: local, issueDateIso: iso,
    issueDateSource: 'generation-timestamp',
  };
}
