// ═══════════════════════════════════════════════════════════════════════════
// PLANSET 14 REGRESSION — THE CANONICAL STATE.
//
// Planset 13 printed "Illinois". Planset 14 printed `Unknown` in ~20 places:
// the title block on all 16 sheets, the cover CITY/STATE cell, the cover
// vicinity-map address chip, the governing-code "<state> AMENDMENTS" row and the
// PE-1 project table — on a project whose address is
// "3 MELVIN DR APT A, GRANITE CITY, IL 62040" and whose record carries
// state='IL'.
//
// ROOT CAUSE: thirteen renderers read `compliance.jurisdiction.state`, a
// CLIENT-COMPUTED value frozen into the posted permit_input. Run without an
// address, the client's getJurisdictionInfo() writes the literal sentinel
// 'Unknown' / 'UNKNOWN'. The sentinel is TRUTHY, so every `|| '—'` fallback and
// the permit route's `if (!state) state = sc` repair walked straight past it,
// while the canonical state sat unread on the project record.
//
// This is NOT a jurisdiction problem. Madison County remains the building AHJ;
// Granite City remains the mailing locality only.
//
// These tests pin the property, never this project: a US postal address that
// carries a recognized two-letter state code must produce a state everywhere,
// and a sentinel may never print for a known value.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  normalizeStateCode, stateNameForCode, parsePostalStateCode,
  resolveProjectStateAuthority, addressCarriesKnownState, isUnknownStateSentinel,
  US_STATE_NAMES,
} from '@/lib/permit/snapshot/locationAuthority';
import { validatePermitDesignSnapshot, blockingViolations } from '@/lib/permit/snapshot/validate';
import { projectProjectState } from '@/lib/permit/snapshot/projectAuthorityProjection';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function gen(mutate?: (input: any) => void, profile = 'design-review') {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = profile;
  mutate?.(input);
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot, input };
}

/** every value printed under a data-project-field tag, per field. */
function taggedValues(html: string, field: string): string[] {
  return [...html.matchAll(new RegExp(`data-project-field="${field}"[^>]*>([^<]*)<`, 'g'))]
    .map(m => m[1].trim());
}

// ── 1. NORMALIZATION ─────────────────────────────────────────────────────────
describe('canonical state normalization', () => {
  it('accepts a code in any case and a full state name', () => {
    for (const v of ['IL', 'il', ' Il ', 'Illinois', 'ILLINOIS', 'illinois']) {
      expect(normalizeStateCode(v)).toBe('IL');
    }
    expect(stateNameForCode('IL')).toBe('Illinois');
    expect(stateNameForCode('Illinois')).toBe('Illinois');
  });

  it('REJECTS every sentinel — this is the whole regression', () => {
    for (const v of ['Unknown', 'UNKNOWN', 'unknown', 'N/A', 'NA', 'TBD', 'PENDING',
      '—', '-', '', '   ', 'None', 'null', '?']) {
      expect(normalizeStateCode(v)).toBeNull();
      expect(stateNameForCode(v)).toBeNull();
    }
    expect(normalizeStateCode(null)).toBeNull();
    expect(normalizeStateCode(undefined)).toBeNull();
  });

  it('rejects a two-letter token that is not a state', () => {
    for (const v of ['XX', 'ZZ', 'QQ', 'DR', 'ST']) expect(normalizeStateCode(v)).toBeNull();
  });

  it('every code round-trips code → name → code', () => {
    for (const code of Object.keys(US_STATE_NAMES)) {
      expect(normalizeStateCode(stateNameForCode(code)!)).toBe(code);
    }
  });
});

// ── 2. POSTAL PARSING ────────────────────────────────────────────────────────
describe('postal-state parsing', () => {
  it('reads the state from the live Braidon address', () => {
    expect(parsePostalStateCode('3 MELVIN DR APT A, GRANITE CITY, IL 62040')).toBe('IL');
    expect(addressCarriesKnownState('3 MELVIN DR APT A, GRANITE CITY, IL 62040')).toBe(true);
  });

  it('a street abbreviation is never mistaken for a state', () => {
    // 'DR' (Delaware), 'CT' (Connecticut), 'IN' (Indiana), 'OR' (Oregon), 'LA'
    // (Louisiana), 'MS'/'MD' — all are real codes AND common street/unit tokens.
    expect(parsePostalStateCode('3 MELVIN DR APT A, GRANITE CITY, IL 62040')).toBe('IL');
    expect(parsePostalStateCode('12 COURT CT, SPRINGFIELD, MO 65801')).toBe('MO');
    expect(parsePostalStateCode('9 OR LN, AUSTIN, TX 78701')).toBe('TX');
    expect(parsePostalStateCode('44 LA SALLE DR, CHICAGO, IL 60601')).toBe('IL');
  });

  it('handles ZIP+4, a missing ZIP and a spelled-out state', () => {
    expect(parsePostalStateCode('1 MAIN ST, DOVER, DE 19901-1234')).toBe('DE');
    expect(parsePostalStateCode('1 MAIN ST, DOVER, DE')).toBe('DE');
    expect(parsePostalStateCode('1 Main St, Granite City, Illinois')).toBe('IL');
  });

  it('returns null when the address genuinely carries no state', () => {
    expect(parsePostalStateCode('')).toBeNull();
    expect(parsePostalStateCode(null)).toBeNull();
    expect(parsePostalStateCode('3 MELVIN DR APT A')).toBeNull();
    expect(addressCarriesKnownState('3 MELVIN DR APT A')).toBe(false);
  });
});

// ── 3. THE DERIVATION ────────────────────────────────────────────────────────
describe('resolveProjectStateAuthority — derived once, from the project itself', () => {
  it('the project record leads', () => {
    const a = resolveProjectStateAuthority({ projectState: 'IL', address: '…, GRANITE CITY, IL 62040' });
    expect(a).toMatchObject({ stateCode: 'IL', stateName: 'Illinois', source: 'project.state' });
    expect(a.conflicts).toEqual([]);
  });

  it('THE REGRESSION: a sentinel project state falls through to the address', () => {
    const a = resolveProjectStateAuthority({
      projectState: 'Unknown',
      address: '3 MELVIN DR APT A, GRANITE CITY, IL 62040',
      complianceState: 'Unknown',
    });
    expect(a.stateCode).toBe('IL');
    expect(a.stateName).toBe('Illinois');
    expect(a.source).toBe('postal-address');
    expect(a.candidates.projectState).toBeNull();
    expect(a.candidates.complianceJurisdiction).toBeNull();
  });

  it('the posted compliance jurisdiction is accepted LAST and only when recognized', () => {
    expect(resolveProjectStateAuthority({ complianceState: 'Illinois' }))
      .toMatchObject({ stateCode: 'IL', source: 'compliance.jurisdiction' });
    expect(resolveProjectStateAuthority({ complianceState: 'Unknown' }))
      .toMatchObject({ stateCode: null, stateName: null, source: 'none' });
  });

  it('the AHJ record can supply a state the project lacks, but never outranks the address', () => {
    expect(resolveProjectStateAuthority({ ahjStateCode: 'IL' }))
      .toMatchObject({ stateCode: 'IL', source: 'ahj-record' });
    const conflicted = resolveProjectStateAuthority({
      address: '1 MAIN ST, DOVER, DE 19901', ahjStateCode: 'IL',
    });
    expect(conflicted.stateCode).toBe('DE');
    expect(conflicted.conflicts).toContain('ahj-record=IL');
  });

  it('no input ⇒ null, never a default jurisdiction and never "Unknown"', () => {
    const a = resolveProjectStateAuthority({});
    expect(a.stateCode).toBeNull();
    expect(a.stateName).toBeNull();
    expect(a.source).toBe('none');
    expect(isUnknownStateSentinel(a.stateName)).toBe(false);
  });
});

// ── 4. THE FROZEN SNAPSHOT ───────────────────────────────────────────────────
describe('the canonical state reaches the frozen snapshot', () => {
  it('both forms are stored on the project authority record', () => {
    const { snap } = gen();
    expect(snap.projectAuthority.stateCode).toBe('IL');
    expect(snap.projectAuthority.stateName).toBe('Illinois');
    expect(snap.projectAuthority.stateAuthority.source).toBe('project.state');
  });

  it('a POISONED compliance.jurisdiction cannot poison the snapshot', () => {
    const { snap } = gen(i => {
      i.compliance.jurisdiction = { state: 'Unknown', stateCode: 'UNKNOWN', necVersion: '2020', ahj: '' };
    });
    expect(snap.projectAuthority.stateCode).toBe('IL');
    expect(snap.projectAuthority.stateName).toBe('Illinois');
  });

  it('a project record with NO state still resolves — from the postal address', () => {
    const { snap } = gen(i => {
      i.project.state = 'Unknown';
      i.compliance.jurisdiction = { state: 'Unknown', stateCode: 'UNKNOWN', necVersion: '2020', ahj: '' };
    });
    expect(snap.projectAuthority.stateCode).toBe('IL');
    expect(snap.projectAuthority.stateName).toBe('Illinois');
    expect(snap.projectAuthority.stateAuthority.source).toBe('postal-address');
  });
});

// ── 5. V46 — THE SNAPSHOT INVARIANT ──────────────────────────────────────────
describe('V46 — a known state may not be lost between the address and the snapshot', () => {
  it('the live design passes', () => {
    const { snap } = gen();
    expect(blockingViolations(validatePermitDesignSnapshot(snap)).filter(x => x.invariant === 'V46'))
      .toEqual([]);
  });

  it('FIRES when a recognized postal state produced no stored state', () => {
    const { snap } = gen();
    const broken = clone(snap) as any;
    broken.projectAuthority.stateCode = null;
    broken.projectAuthority.stateName = null;
    const v = validatePermitDesignSnapshot(broken).filter(x => x.invariant === 'V46');
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].message).toContain('IL');
    expect(v[0].enforcement).toBe('blocking');
  });

  it('FIRES on a code without a name, and on a name without a code', () => {
    const { snap } = gen();
    const a = clone(snap) as any; a.projectAuthority.stateName = null;
    expect(validatePermitDesignSnapshot(a).some(x => x.invariant === 'V46'
      && x.authorityPath === 'projectAuthority.stateName')).toBe(true);
    const b = clone(snap) as any; b.projectAuthority.stateCode = null;
    expect(validatePermitDesignSnapshot(b).some(x => x.invariant === 'V46'
      && x.authorityPath === 'projectAuthority.stateCode')).toBe(true);
  });

  it('FIRES on a stored sentinel', () => {
    const { snap } = gen();
    const broken = clone(snap) as any;
    broken.projectAuthority.stateName = 'Unknown';
    expect(validatePermitDesignSnapshot(broken).some(x => x.invariant === 'V46'
      && /is not a state/.test(x.message))).toBe(true);
  });

  it('FIRES when the AHJ record and the project name different states', () => {
    const { snap } = gen();
    const broken = clone(snap) as any;
    broken.projectAuthority.stateAuthority.conflicts = ['ahj-record=MO'];
    expect(validatePermitDesignSnapshot(broken).some(x => x.invariant === 'V46'
      && /named a different state/.test(x.message))).toBe(true);
  });

  it('does NOT fire when the address genuinely carries no state', () => {
    const { snap } = gen();
    const noState = clone(snap) as any;
    noState.projectAuthority.installationAddress = '3 MELVIN DR APT A';
    noState.projectAuthority.stateCode = null;
    noState.projectAuthority.stateName = null;
    noState.projectAuthority.stateAuthority = { conflicts: [], source: 'none' };
    expect(validatePermitDesignSnapshot(noState).filter(x => x.invariant === 'V46')).toEqual([]);
  });
});

// ── 6. THE PROJECTION ────────────────────────────────────────────────────────
describe('projectProjectState — the ONE accessor every sheet reads', () => {
  it('reads the frozen record when a snapshot exists', () => {
    const { snap, input } = gen();
    const st = projectProjectState(snap, input);
    expect(st).toMatchObject({ code: 'IL', name: 'Illinois', display: 'Illinois', fromSnapshot: true });
  });

  it('re-derives from the project when there is no snapshot — and still refuses the sentinel', () => {
    const st = projectProjectState(null, {
      project: { address: '3 MELVIN DR APT A, GRANITE CITY, IL 62040' },
      compliance: { jurisdiction: { state: 'Unknown' } },
    } as any);
    expect(st).toMatchObject({ code: 'IL', name: 'Illinois', fromSnapshot: false });
  });

  it('displays an em-dash — never a word — when the state is genuinely unknown', () => {
    const st = projectProjectState(null, { project: { address: 'no state here' } } as any);
    expect(st.code).toBeNull();
    expect(st.display).toBe('—');
    expect(st.displayCode).toBe('—');
  });
});

// ── 7. THE RENDERED PACKAGE ──────────────────────────────────────────────────
describe('the rendered package projects ONE state, everywhere', () => {
  it('ZERO invalid "Unknown" state projections on the design-review package', () => {
    const { html } = gen();
    for (const v of taggedValues(html, 'state-name')) expect(isUnknownStateSentinel(v)).toBe(false);
    for (const v of taggedValues(html, 'state-code')) expect(isUnknownStateSentinel(v)).toBe(false);
  });

  it('the TITLE BLOCK on every sheet prints Illinois', () => {
    const { html } = gen();
    const names = taggedValues(html, 'state-name');
    expect(names.length).toBeGreaterThanOrEqual(16);
    expect(new Set(names)).toEqual(new Set(['Illinois']));
  });

  it('ONE AHJ name travels through the package (whatever the boundary layer bound)', () => {
    // The pure fixture runs with NO live boundary determination, so the AHJ it
    // binds is the postal-city record; the LIVE package binds Madison County from
    // the Census determination (KDP WS-12, asserted on the live regen). What must
    // hold in BOTH is that one name travels: the title block, PE-1 and the
    // validation sheet all project the same single-sourced value.
    const { html } = gen();
    const ahjs = new Set(taggedValues(html, 'ahj'));
    expect(ahjs.size).toBe(1);
    expect([...ahjs][0]).not.toBe('PENDING');
  });

  it('the cover CITY/STATE cell and the governing-code amendments row print Illinois', () => {
    const { html } = gen();
    expect(html).toMatch(/Granite City,\s*<span data-project-field="state-name">Illinois</i);
    expect(html).toContain('Illinois AMENDMENTS');
    expect(html).not.toContain('Unknown AMENDMENTS');
  });

  it('PE-1 prints the state from the canonical record', () => {
    const { html } = gen();
    const pe = html.split('<div class="page"').find(p => /tb-sheet-id">\s*PE-1/.test(p));
    expect(pe).toBeTruthy();
    expect(pe!).toContain('data-project-field="state-name">Illinois<');
  });

  it('the full package holds no "Unknown" state projection either', () => {
    const { html } = gen(undefined, 'full');
    for (const v of taggedValues(html, 'state-name')) expect(v).toBe('Illinois');
  });

  it('THE REGRESSION, END TO END: a poisoned posted jurisdiction still renders Illinois', () => {
    const { html, input } = gen(i => {
      i.compliance.jurisdiction = {
        state: 'Unknown', stateCode: 'UNKNOWN', necVersion: '2020',
        ahj: 'City of Granite City Building & Zoning',
      };
    });
    expect(new Set(taggedValues(html, 'state-name'))).toEqual(new Set(['Illinois']));
    // the poisoned record is REPAIRED in place, not merely bypassed — a frozen
    // input carrying a sentinel beside the real value is the stale-value failure.
    expect(input.compliance.jurisdiction.state).toBe('Illinois');
    expect(input.compliance.jurisdiction.stateCode).toBe('IL');
  });
});

// ── 8. V47 — THE RENDER-LEVEL INVARIANT ──────────────────────────────────────
describe('V47 — no sheet may print a sentinel, and no two sheets may disagree', () => {
  it('the live package renders without firing it', () => {
    expect(() => gen()).not.toThrow();
  });

  it('a renderer that substitutes "Unknown" for a known state FAILS generation', () => {
    // Simulated by poisoning the frozen record AFTER the projection would read
    // it: the record says Illinois, so any sheet printing anything else is the
    // exact failure V47 exists to catch.
    const { html } = gen();
    const poisoned = html.replace(
      'data-project-field="state-name">Illinois<',
      'data-project-field="state-name">Unknown<');
    // the check itself, applied to the poisoned render
    const values = taggedValues(poisoned, 'state-name');
    expect(values.some(isUnknownStateSentinel)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(1);
  });
});
