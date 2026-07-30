// ═══════════════════════════════════════════════════════════════════════════
// THE CANONICAL PROJECT LOCATION (STATE) AUTHORITY.
//
// Planset 14 printed `Unknown` in ~20 places — the title block on all 16
// sheets, the cover CITY/STATE cell, the cover address chip, the governing-code
// amendments row and the PE-1 project table — on a project whose address is
// "3 MELVIN DR APT A, GRANITE CITY, IL 62040" and whose project record carries
// state='IL'. Planset 13 printed "Illinois" everywhere.
//
// THE DEFECT was never the jurisdiction determination (Madison County is and
// stays the building AHJ). It was that every sheet read the state off
// `compliance.jurisdiction.state` — a value computed CLIENT-SIDE by
// getJurisdictionInfo() and then FROZEN into the posted permit_input. When that
// client call ran without an address it produced the literal sentinel
// 'Unknown' / 'UNKNOWN', and the sentinel is TRUTHY: every `|| '—'` fallback and
// the route's `if (!state) state = sc` repair walked straight past it, and the
// canonical state sitting on the project record two fields away was never
// consulted.
//
// So: the state is derived ONCE, here, from the project's own identity, and
// every projection consumes THIS record. Two forms are retained because
// consumers genuinely need different ones — a title block wants "Illinois", a
// utility-profile lookup wants "IL" (that lookup was silently matching nothing
// because it uppercased the display name and compared it to a 2-letter code).
//
// RULES
//   • A sentinel is not a value. 'Unknown' / 'UNKNOWN' / 'N/A' / '—' resolve to
//     null, never to a state.
//   • null is honest and prints '—'. This module never invents a state, and
//     never falls back to a default jurisdiction.
//   • Nothing here reads the mailing city, the county or the AHJ name to infer
//     a state for the project. It reads the state.
// ═══════════════════════════════════════════════════════════════════════════

/** The 50 states + DC + the US territories a permit set can be issued in. */
export const US_STATE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', GU: 'Guam', AS: 'American Samoa',
  MP: 'Northern Mariana Islands',
});

const NAME_TO_CODE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(US_STATE_NAMES).map(([c, n]) => [n.toUpperCase(), c])),
);

/** Values that LOOK like data and are not. The whole regression is that
 *  'Unknown' is truthy, so every one of these must be rejected explicitly. */
const SENTINELS = new Set(['', '-', '--', '—', '–', 'N/A', 'NA', 'NONE', 'NULL',
  'UNKNOWN', 'UNSPECIFIED', 'TBD', 'PENDING', '?', '...']);

/**
 * Normalize anything a caller might hold into a canonical 2-letter state code.
 * Accepts a code ('IL', 'il', ' Il ') or a full state name ('Illinois').
 * Returns null for a sentinel, an unrecognized code, or an empty value.
 */
export function normalizeStateCode(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const up = raw.toUpperCase().replace(/\s+/g, ' ');
  if (SENTINELS.has(up)) return null;
  if (up.length === 2 && Object.prototype.hasOwnProperty.call(US_STATE_NAMES, up)) return up;
  const byName = NAME_TO_CODE[up];
  return byName ?? null;
}

/** The full state name for a code ('IL' → 'Illinois'). null when unrecognized. */
export function stateNameForCode(code: string | null | undefined): string | null {
  const c = normalizeStateCode(code);
  return c ? US_STATE_NAMES[c] : null;
}

/**
 * Extract the state code from a US postal address line.
 *
 * Deliberately anchored on the POSTAL SHAPE — a 2-letter token immediately
 * before a 5(+4)-digit ZIP, or the final 2-letter token of the line — so a
 * street abbreviation ('DR', 'ST', 'LN', 'CT') can never be mistaken for a
 * state. 'MELVIN DR' does not make this project Delaware.
 */
export function parsePostalStateCode(address: string | null | undefined): string | null {
  if (!address) return null;
  const line = String(address).trim();
  if (!line) return null;
  // 1) "…, GRANITE CITY, IL 62040" / "… IL 62040-1234" — state immediately
  //    before the ZIP is the unambiguous postal position.
  const withZip = line.match(/\b([A-Za-z]{2})\s*,?\s+(\d{5})(?:-\d{4})?\b\s*(?:USA?|UNITED STATES)?\s*$/i)
    ?? line.match(/\b([A-Za-z]{2})\s*,?\s+(\d{5})(?:-\d{4})?\b/);
  if (withZip) {
    const c = normalizeStateCode(withZip[1]);
    if (c) return c;
  }
  // 2) "…, GRANITE CITY, IL" — no ZIP; the last comma-separated token.
  const parts = line.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].replace(/\b(USA?|UNITED STATES)\b/i, '').trim();
    const c = normalizeStateCode(last);
    if (c) return c;
  }
  // 3) A spelled-out state name anywhere in the line ("…, Granite City, Illinois").
  const up = ` ${line.toUpperCase().replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (up.includes(` ${name} `)) return code;
  }
  return null;
}

/** Where the canonical state came from. Recorded so a reviewer can audit it. */
export type StateAuthoritySource =
  | 'project.state'
  | 'postal-address'
  | 'ahj-record'
  | 'compliance.jurisdiction'
  | 'none';

export interface StateAuthorityCandidates {
  projectState: string | null;
  postalAddress: string | null;
  ahjRecord: string | null;
  complianceJurisdiction: string | null;
}

export interface ProjectStateAuthority {
  /** canonical 2-letter code ('IL'). null ⇒ genuinely unknown; print '—'. */
  stateCode: string | null;
  /** canonical full name ('Illinois'). Always consistent with stateCode. */
  stateName: string | null;
  source: StateAuthoritySource;
  basis: string;
  /** what each input offered, NORMALIZED (a sentinel shows as null). */
  candidates: StateAuthorityCandidates;
  /** sources that produced a DIFFERENT recognized code than the winner. */
  conflicts: string[];
  /** a recognized state code was available on some input but the winner is
   *  null — impossible by construction; kept so the invariant can assert it. */
  droppedKnownValue: boolean;
}

export interface ResolveStateAuthorityInput {
  /** the project record's own state field (operator/enrichment value). */
  projectState?: string | null;
  /** the installation address line. */
  address?: string | null;
  /** the bound AHJ registry record's state. */
  ahjStateCode?: string | null;
  /** the CLIENT-COMPUTED compliance jurisdiction state — accepted last and only
   *  when it normalizes; this is the field that carried 'Unknown'. */
  complianceState?: string | null;
}

/**
 * THE derivation. Pure, total, and the only place a project state is decided.
 *
 * Precedence: the project record's own state field, then the postal address,
 * then the bound AHJ record, then the client-computed compliance jurisdiction.
 * The stored project field leads because it is the field an operator edits and
 * the field the snapshot already freezes; the address is what rescues a project
 * whose stored field is empty or a sentinel — which is exactly the live defect.
 */
export function resolveProjectStateAuthority(
  input: ResolveStateAuthorityInput,
): ProjectStateAuthority {
  const candidates: StateAuthorityCandidates = {
    projectState: normalizeStateCode(input.projectState),
    postalAddress: parsePostalStateCode(input.address),
    ahjRecord: normalizeStateCode(input.ahjStateCode),
    complianceJurisdiction: normalizeStateCode(input.complianceState),
  };

  const order: [StateAuthoritySource, string | null, string][] = [
    ['project.state', candidates.projectState, 'the project record\'s own state field'],
    ['postal-address', candidates.postalAddress, 'the installation address\'s postal state token'],
    ['ahj-record', candidates.ahjRecord, 'the bound AHJ registry record'],
    ['compliance.jurisdiction', candidates.complianceJurisdiction, 'the posted compliance jurisdiction'],
  ];

  const winner = order.find(([, code]) => !!code);
  const stateCode = winner?.[1] ?? null;
  const conflicts = order
    .filter(([src, code]) => code && stateCode && code !== stateCode && src !== winner?.[0])
    .map(([src, code]) => `${src}=${code}`);

  return {
    stateCode,
    stateName: stateCode ? US_STATE_NAMES[stateCode] : null,
    source: winner?.[0] ?? 'none',
    basis: winner
      ? `state ${winner[1]} derived from ${winner[2]}`
      : 'no input carried a recognized US state code (a sentinel such as "Unknown" is not a state)',
    candidates,
    conflicts,
    // By construction the winner is the first non-null candidate, so this can
    // only be true if the precedence list above is ever edited incorrectly.
    droppedKnownValue: !stateCode && Object.values(candidates).some(Boolean),
  };
}

/** Convenience: does this address carry a recognized US state code? The
 *  invariant's precondition — "a valid United States postal address contains a
 *  recognized two-letter state code". */
export function addressCarriesKnownState(address: string | null | undefined): boolean {
  return parsePostalStateCode(address) !== null;
}

/** True when a rendered/stored value is the `Unknown`-class sentinel this
 *  repair exists to eliminate. Used by the render-level invariant. */
export function isUnknownStateSentinel(value: string | null | undefined): boolean {
  if (value == null) return false;
  const up = String(value).trim().toUpperCase();
  return up === 'UNKNOWN' || up === 'UNSPECIFIED';
}
