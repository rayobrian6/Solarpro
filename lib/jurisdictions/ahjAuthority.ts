// ═══════════════════════════════════════════════════════════════════════════
// THE CANONICAL PROJECT AHJ AUTHORITY — one object, per scope, with evidence.
//
// ── THE RULE THIS FILE EXISTS TO ENFORCE ──────────────────────────────────
// REGISTRY ABSENCE MUST NEVER BECOME AUTHORITY SUBSTITUTION.
//
// If legal geography proves the parcel is inside Municipality X, and the
// delegation policy says X administers building permits, and SolarPro holds no
// AHJ row for X, then the answer is:
//
//     governing authority identified · registry record missing · discovery required
//
// It is NOT "the county". It is not the neighbouring municipality. It is not the
// existing row whose name happens to resemble the mailing address. Those
// substitutions all produce a package that names a government which does not
// administer the parcel — and every one of them was reachable before this file.
//
// The reverse is equally forbidden: an unincorporated parcel administered by the
// county must not acquire the mailing municipality.
//
// ── WHY A TYPED MISSING STATE ─────────────────────────────────────────────
// `AHJ_RECORD_MISSING` is deliberately NOT the same as "unverified". Unverified
// means we do not know who governs. Record-missing means WE KNOW EXACTLY WHO
// GOVERNS and have no row for them — which is an entirely different piece of
// work (discovery + ingestion, §5), and a state a coverage audit can count.
// ═══════════════════════════════════════════════════════════════════════════

import {
  atLeast, requiredFacetsSatisfied, completenessBasis, BUILDING_AUTHORITY_CONTRACT,
  type LegalGeographyAuthority, type FacetGrade, type FacetProvenance,
} from './legalGeography';
import {
  resolveDelegation, type AuthorityScope, type AuthorityEntityType,
  type DelegationPolicy, type JurisdictionDelegationRule,
} from './delegationPolicy';

/** Where the resolution got to. Every value is a DIFFERENT piece of work. */
export type AhjResolutionStatus =
  /** legal geography is not established — we do not yet know who governs. */
  | 'BOUNDARY_UNRESOLVED'
  /** geography is established but no delegation policy covers it. */
  | 'AUTHORITY_SCOPE_UNRESOLVED'
  /** THE governing entity is identified and SolarPro has no registry row for it. */
  | 'BOUNDARY_ESTABLISHED_AHJ_RECORD_MISSING'
  /** a registry row was matched on stable identity. */
  | 'AHJ_RECORD_FOUND'
  /** matched, and the row itself carries official-source provenance. */
  | 'AHJ_VERIFIED'
  /** sources of comparable standing disagree about who governs. */
  | 'AUTHORITY_CONFLICT';

/** The government a scope resolves to, whether or not we hold a row for it. */
export interface GoverningEntity {
  type: AuthorityEntityType;
  name: string;
  /** stable legal-geography identity — the primary key, never the name. */
  stateFips: string | null;
  countyFips: string | null;
  placeGeoid: string | null;
  countySubdivisionGeoid: string | null;
}

export interface ScopeAuthority {
  scope: AuthorityScope;
  status: AhjResolutionStatus;
  /** who governs — present whenever the status is anything but BOUNDARY_UNRESOLVED. */
  entity: GoverningEntity | null;
  /** the SolarPro registry row, when one exists for that entity. */
  ahjRecordId: string | null;
  ahjName: string | null;
  /** the delegation rule that decided it, cited by id. */
  delegationRuleId: string | null;
  delegatedFrom: AuthorityEntityType | null;
  delegatedTo: AuthorityEntityType | null;
  grade: FacetGrade;
  provenance: FacetProvenance[];
  /** one sentence a reviewer can act on. */
  basis: string;
}

export interface ProjectAhjAuthority {
  /** the geography every scope was derived from — carried so no consumer has to
   *  (or is able to) re-derive it from an address string. */
  legalGeography: LegalGeographyAuthority;
  scopes: Record<AuthorityScope, ScopeAuthority>;
  /**
   * ⚠ NOT A RELEASE GATE. True only when EVERY requested scope reached a record,
   * and today that is structurally unreachable: the `fire` scope delegates to a
   * fire protection district, nothing in SolarPro retrieves fire-district
   * boundaries, and fire districts do not follow municipal limits — so fire
   * correctly stays UNRESOLVED rather than inheriting the building AHJ. Gating a
   * package on this flag would block 100% of packages nationally, for a reason
   * that has nothing to do with the package.
   *
   * Gate on the SCOPE you actually need — `scopes.building.status` for a
   * building permit. This flag is for coverage reporting: it answers "do we know
   * every authority for this site", which is a question about SolarPro's data,
   * not about the design.
   */
  allScopesResolved: boolean;
  /** entities we know govern something here but hold no row for — the input to
   *  the discovery pipeline, and the thing the national coverage audit counts. */
  missingRecords: GoverningEntity[];
}

/** What a registry lookup must provide. Kept as a function type so this module
 *  never imports a concrete table — the registry is a CACHE, not the resolver. */
export interface AhjRegistryLookup {
  /** find a row by STABLE IDENTITY. Name matching is deliberately not offered
   *  here: a name match is a search hint, and hints do not select authorities. */
  byIdentity(e: GoverningEntity): { id: string; name: string; hasOfficialProvenance: boolean } | null;
}

function entityFromGeography(
  type: AuthorityEntityType, geo: LegalGeographyAuthority,
): GoverningEntity | null {
  const st = geo.state.value, co = geo.county.value;
  const pl = geo.incorporatedPlace.value, cs = geo.countySubdivision.value;
  const base = {
    stateFips: st?.fips ?? null,
    countyFips: co?.fips ?? null,
    placeGeoid: null as string | null,
    countySubdivisionGeoid: null as string | null,
  };
  switch (type) {
    case 'place':
      if (!pl) return null;
      return { ...base, type, name: pl.name, placeGeoid: pl.geoid };
    case 'county':
      if (!co) return null;
      return { ...base, type, name: co.name };
    case 'county-subdivision':
      if (!cs) return null;
      return { ...base, type, name: cs.name, countySubdivisionGeoid: cs.geoid };
    case 'state':
      if (!st) return null;
      return { ...base, type, name: st.name ?? st.code };
    case 'consolidated':
      // A consolidated city-county is ONE government wearing both hats —
      // Nashville-Davidson, Athens-Clarke, Augusta-Richmond, Louisville/Jefferson,
      // Honolulu. It was returning null, so any delegation rule naming it
      // produced AUTHORITY_SCOPE_UNRESOLVED and the parcel had no authority at
      // all. It carries BOTH identities: the place where one exists, and the
      // county it is coextensive with. `identityKey` prefers the place.
      if (!pl && !co) return null;
      return {
        ...base, type,
        name: pl?.name ?? co!.name,
        placeGeoid: pl?.geoid ?? null,
      };
    default:
      // 'special-district' has no boundary provider — nothing in SolarPro
      // retrieves fire-district geography, and a fire district does not follow
      // municipal limits, so it stays unresolved rather than inheriting one.
      return null;
  }
}

const UNRESOLVED = (scope: AuthorityScope, status: AhjResolutionStatus, basis: string): ScopeAuthority => ({
  scope, status, entity: null, ahjRecordId: null, ahjName: null,
  delegationRuleId: null, delegatedFrom: null, delegatedTo: null,
  grade: 'UNKNOWN', provenance: [], basis,
});

/**
 * Resolve ONE scope's governing authority.
 *
 * Order is the campaign's canonical order and is not negotiable:
 *   legal geography → delegation policy → governing entity → registry match.
 * A registry row is consulted LAST and only to attach a cached record to an
 * entity the geography and policy already named.
 */
export function resolveScopeAuthority(
  scope: AuthorityScope,
  geo: LegalGeographyAuthority,
  policy: DelegationPolicy,
  registry: AhjRegistryLookup,
): ScopeAuthority {
  // 1 — geography, to the grade the decision requires.
  if (!requiredFacetsSatisfied(geo, BUILDING_AUTHORITY_CONTRACT)) {
    return UNRESOLVED(scope, 'BOUNDARY_UNRESOLVED',
      `legal geography is not established, so no governing authority can be named: ${completenessBasis(geo)}`);
  }
  if (geo.incorporatedPlace.grade === 'CONFLICT' || geo.county.grade === 'CONFLICT') {
    return UNRESOLVED(scope, 'AUTHORITY_CONFLICT',
      'sources of comparable standing disagree about the legal geography; the governing authority '
      + 'cannot be determined until the conflict is resolved by evidence');
  }

  const incorporated = geo.unincorporated.value === false;
  const st = geo.state.value;
  if (!st) {
    return UNRESOLVED(scope, 'BOUNDARY_UNRESOLVED', 'no state identity on the legal geography');
  }

  // 2 — policy.
  const match = resolveDelegation(policy, {
    state: st.code, scope, incorporated,
    placeGeoid: geo.incorporatedPlace.value?.geoid ?? null,
    countyFips: geo.county.value?.fips ?? null,
  });
  if (!match) {
    return UNRESOLVED(scope, 'AUTHORITY_SCOPE_UNRESOLVED',
      `SolarPro holds no delegation rule for ${scope} permits in ${st.code} `
      + `(${incorporated ? 'incorporated' : 'unincorporated'} territory) — who administers this scope is not established`);
  }
  if (match.ambiguous) {
    return UNRESOLVED(scope, 'AUTHORITY_CONFLICT',
      `two equally-specific delegation rules name different administrators for ${scope} in ${st.code}: `
      + match.considered.slice(0, 2).map(r => `${r.id} → ${r.delegate}`).join(' vs '));
  }

  // 3 — the entity the rule points at.
  const entity = entityFromGeography(match.rule.delegate, geo);
  if (!entity) {
    return UNRESOLVED(scope, 'AUTHORITY_SCOPE_UNRESOLVED',
      `${match.rule.id} delegates ${scope} to a ${match.rule.delegate}, but the legal geography carries `
      + `no such entity for this coordinate`);
  }

  // 4 — the registry, LAST, and only to attach a cached row.
  const row = registry.byIdentity(entity);
  const provenance: FacetProvenance[] = [
    ...(geo.incorporatedPlace.provenance ? [geo.incorporatedPlace.provenance] : []),
    ...(match.rule.provenance ? [match.rule.provenance] : []),
  ];

  if (!row) {
    // ══ THE WHOLE POINT ══════════════════════════════════════════════════
    return {
      scope, status: 'BOUNDARY_ESTABLISHED_AHJ_RECORD_MISSING',
      entity, ahjRecordId: null, ahjName: entity.name,
      delegationRuleId: match.rule.id,
      delegatedFrom: match.rule.delegator, delegatedTo: match.rule.delegate,
      grade: match.rule.grade, provenance,
      basis: `the governing ${scope} authority for this parcel is ${entity.name} `
        + `(${entity.type}${entity.placeGeoid ? ` GEOID ${entity.placeGeoid}` : entity.countyFips ? ` FIPS ${entity.countyFips}` : ''}), `
        + `established from legal geography and ${match.rule.id}. SolarPro holds NO AHJ record for it. `
        + 'No other jurisdiction may be substituted; the record must be discovered and verified.',
    };
  }

  return {
    scope,
    status: row.hasOfficialProvenance ? 'AHJ_VERIFIED' : 'AHJ_RECORD_FOUND',
    entity, ahjRecordId: row.id, ahjName: row.name,
    delegationRuleId: match.rule.id,
    delegatedFrom: match.rule.delegator, delegatedTo: match.rule.delegate,
    // The authority is never graded better than the weaker of the geography that
    // located it and the rule that assigned it. A well-provenanced row does not
    // make a CURATED delegation VERIFIED.
    grade: weaker(geo.incorporatedPlace.grade, match.rule.grade),
    provenance,
    basis: `${row.name} administers ${scope} permits for this parcel: `
      + `${incorporated ? `the coordinate is inside ${geo.incorporatedPlace.value?.name}` : 'the parcel is unincorporated'}, `
      + `and ${match.rule.id} assigns the scope to the ${match.rule.delegate}.`,
  };
}

function weaker(a: FacetGrade, b: FacetGrade): FacetGrade {
  return atLeast(a, b) ? b : a;
}

/** Resolve every scope, and collect the entities we have no row for. */
export function resolveProjectAhjAuthority(
  geo: LegalGeographyAuthority,
  policy: DelegationPolicy,
  registry: AhjRegistryLookup,
  scopes: AuthorityScope[] = ['building', 'electrical', 'fire', 'zoning'],
): ProjectAhjAuthority {
  const out = {} as Record<AuthorityScope, ScopeAuthority>;
  for (const s of scopes) out[s] = resolveScopeAuthority(s, geo, policy, registry);

  const missing: GoverningEntity[] = [];
  const seen = new Set<string>();
  for (const s of scopes) {
    const a = out[s];
    if (a.status !== 'BOUNDARY_ESTABLISHED_AHJ_RECORD_MISSING' || !a.entity) continue;
    const k = identityKey(a.entity);
    if (seen.has(k)) continue;
    seen.add(k);
    missing.push(a.entity);
  }

  return {
    legalGeography: geo,
    scopes: out,
    allScopesResolved: scopes.every(s => out[s].status === 'AHJ_RECORD_FOUND' || out[s].status === 'AHJ_VERIFIED'),
    missingRecords: missing,
  };
}

/**
 * The stable identity key for an entity — never its display name.
 *
 * ── THE COUNTY KEY MUST CARRY ITS STATE ───────────────────────────────────
 * This emitted `county:${countyFips}` from the county code alone, and the
 * provider supplies the THREE-DIGIT county code, not the five-digit national
 * one (censusPropertyProvider derives it as `fips_code.slice(2,5)`). So
 * `county:119` is Madison County, Illinois — and simultaneously county 119 in
 * every other state that has one. A key that collides across states is not an
 * identity, and this key exists specifically so that resolution stops depending
 * on names.
 *
 * A bare county code with no state is therefore NOT a national identity and is
 * refused: it falls through to the name key, which is explicitly marked as such
 * so a caller can see it is not identity-grade.
 */
export function identityKey(e: GoverningEntity): string {
  /** 5-digit national county FIPS, composed from the state when needed. Never
   *  the bare 3-digit code, which collides across all 50 states. */
  const countyKey = (): string | null => {
    if (!e.countyFips) return null;
    const c = e.countyFips.trim();
    if (c.length >= 5) return `county:${c}`;
    if (e.stateFips) return `county:${e.stateFips.trim().padStart(2, '0')}${c.padStart(3, '0')}`;
    return null;
  };
  /** No identity of the RIGHT KIND exists. Deliberately not matchable by the
   *  registry, which indexes on GEOID — so the resolver reports the record as
   *  missing instead of finding something that is not this government. */
  const unidentified = () => `name:${e.type}:${e.name.toUpperCase()}`;

  // ── THE KEY MAY NEVER FALL ACROSS ENTITY TYPES ──────────────────────────
  // This used to try placeGeoid, then cousub, then countyFips, then stateFips
  // in one chain regardless of what KIND of government `e` is. But
  // `entityFromGeography` puts the county FIPS on EVERY entity as context, so a
  // PLACE whose GEOID we do not hold degraded to its county's key — and the
  // registry then returned the COUNTY's row for a municipality.
  //
  // The dry run caught it binding 51 cities to their counties, including
  // Nashville to Davidson County, Boise to Ada County and Louisville to
  // Jefferson County. That is the substitution this entire module exists to
  // prevent, committed by the module itself.
  //
  // A government with no identity of its own kind is UNIDENTIFIED. That is a
  // real and useful answer: it becomes AHJ_RECORD_MISSING, which names the gap.
  switch (e.type) {
    case 'place':
      return e.placeGeoid ? `place:${e.placeGeoid}` : unidentified();
    case 'county-subdivision':
      return e.countySubdivisionGeoid ? `cousub:${e.countySubdivisionGeoid}` : unidentified();
    case 'county':
      return countyKey() ?? unidentified();
    case 'consolidated':
      // A consolidated city-county is one government wearing both hats, so
      // either identity legitimately names it — place first, as the more specific.
      return e.placeGeoid ? `place:${e.placeGeoid}` : (countyKey() ?? unidentified());
    case 'state':
      return e.stateFips ? `state:${e.stateFips}` : unidentified();
    default:
      return unidentified();
  }
}

/** Rules an invariant test can assert directly, and the resolver upholds. */
export const NO_SUBSTITUTION_INVARIANTS = {
  /** A county may not stand in for a municipality, or a municipality for a
   *  county, without a delegation rule that says so. */
  entityMatchesDelegation(a: ScopeAuthority): boolean {
    if (!a.entity || !a.delegatedTo) return true;
    return a.entity.type === a.delegatedTo;
  },
  /** A missing record never carries a registry id — that is the substitution. */
  missingRecordHasNoRow(a: ScopeAuthority): boolean {
    return a.status !== 'BOUNDARY_ESTABLISHED_AHJ_RECORD_MISSING' || a.ahjRecordId === null;
  },
  /** Nothing is resolved without geography. */
  resolvedImpliesGeography(a: ScopeAuthority, geo: LegalGeographyAuthority): boolean {
    if (a.status !== 'AHJ_RECORD_FOUND' && a.status !== 'AHJ_VERIFIED') return true;
    return requiredFacetsSatisfied(geo, BUILDING_AUTHORITY_CONTRACT);
  },
} as const;

export type { JurisdictionDelegationRule };
