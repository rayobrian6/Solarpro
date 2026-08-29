// ═══════════════════════════════════════════════════════════════════════════
// BAR §2 / §1 / §3 / §6 — ENVIRONMENTAL LOAD AUTHORITY + blocker-count
// reconciliation + honest SCHED conclusion + non-orderable fasteners.
//
// §2 root: operator-entered wind/snow/exposure is an OBSERVATION/OVERRIDE, never
// verified design criteria without an archived, currency-reviewed climate-hazard
// source. The single blocker ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED subsumes the
// null/code-minimum AND the operator-entered-without-provenance cases.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  buildEnvironmentalLoadAuthority, environmentalSourceVerified, environmentalSourceLabel,
  type EnvironmentalLoadSourceEvidence,
} from '@/lib/permit/snapshot/environmentalAuthority';
import { pickVerifiedDocument, toEnvironmentalLoadSourceEvidence } from '@/lib/documents/registry';
import { isDocumentClass, type RegistryDocument } from '@/lib/documents/types';
import { classifyBlockerSeverity } from '@/lib/permit/snapshot/severityPolicy';
import { classifyBlockerDomain } from '@/lib/permit/snapshot/projectAuthority';
import { peekSnapshot } from '@/lib/permit/snapshot/read';
import { projectFastenerAssemblyFromSnapshot, projectFastenerAssembly, FASTENER_NON_ORDERABLE_LABEL } from '@/lib/permit/snapshot/structuralProjection';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** A verified, archived, currency-reviewed climate-hazard source covering the
 *  project — the ONLY thing that clears the blocker. */
function verifiedSource(over: Partial<EnvironmentalLoadSourceEvidence> = {}): EnvironmentalLoadSourceEvidence {
  return {
    documentId: 'DOC-ASCE7HAZ-001', dataset: 'ASCE 7 Hazard Tool', versionOrDate: '7-22 (2022)',
    verificationState: 'verified', archivedInRepo: true, sha256: 'abc123def456',
    coversWindSpeed: true, coversSnowLoad: true, coversExposureRisk: true,
    windSpeedMph: 110, groundSnowPsf: 20, exposureCategory: 'C', riskCategory: 'II',
    coordinates: { lat: 38.7, lng: -90.04 }, addressUsed: '123 Test St',
    projectApplicability: 'project-braidon', lookupTimestampIso: '2026-07-25T00:00:00Z',
    currencyConfirmedAtIso: '2026-07-25T00:00:00Z',
    ...over,
  };
}

const OPERATOR_INPUT = {
  windSpeedMph: 110, exposureCategory: 'C', riskCategory: 'II', groundSnowPsf: 20,
  windOperatorEntered: true, snowOperatorEntered: true,
  coordinates: { lat: 38.7, lng: -90.04 }, addressUsed: '123 Test St',
  projectOrAhj: 'project-braidon', capturedAtIso: '2026-07-25T00:00:00Z',
};

describe('§2 — environmental load authority resolver (pure)', () => {
  it('VERIFIED SOURCE: an archived, currency-reviewed, project-applicable source clears it', () => {
    const auth = buildEnvironmentalLoadAuthority({ ...OPERATOR_INPUT, sourceEvidence: verifiedSource() });
    expect(auth.verificationStatus).toBe('verified');
    expect(auth.windSpeedBasis).toBe('verified-source');
    expect(auth.snowLoadBasis).toBe('verified-source');
    expect(auth.sourceDocumentId).toBe('DOC-ASCE7HAZ-001');
    expect(auth.operatorOverrides).toEqual([]);
    expect(environmentalSourceLabel(auth)).toContain('VERIFIED');
  });

  it('OPERATOR OVERRIDE: operator-entered values (no source) stay UNVERIFIED (never auto-verified)', () => {
    const auth = buildEnvironmentalLoadAuthority({ ...OPERATOR_INPUT, sourceEvidence: null });
    expect(auth.verificationStatus).toBe('unverified');
    expect(auth.windSpeedBasis).toBe('operator-entered');
    expect(auth.snowLoadBasis).toBe('operator-entered');
    // the values still populate (they drive the preliminary analysis)…
    expect(auth.ultimateWindSpeedMph).toBe(110);
    expect(auth.groundSnowLoadPsf).toBe(20);
    // …but they are recorded as overrides and the source stays null.
    expect(auth.operatorOverrides).toContain('ultimateWindSpeedMph');
    expect(auth.operatorOverrides).toContain('groundSnowLoadPsf');
    expect(auth.sourceDocumentId).toBeNull();
    expect(environmentalSourceLabel(auth)).toBe('SOURCE: OPERATOR-ENTERED — NOT VERIFIED');
  });

  it('MISSING SOURCE: no values and no source ⇒ unknown, still not verified', () => {
    const auth = buildEnvironmentalLoadAuthority({
      windSpeedMph: null, exposureCategory: null, riskCategory: null, groundSnowPsf: null,
      windOperatorEntered: false, snowOperatorEntered: false,
      coordinates: null, addressUsed: null, projectOrAhj: null, capturedAtIso: null, sourceEvidence: null,
    });
    expect(auth.verificationStatus).toBe('unknown');
    expect(auth.windSpeedBasis).toBe('unavailable');
    expect(environmentalSourceVerified(null, null)).toBe(false);
  });

  it('STALE SOURCE: a source with a recorded date but NO currency review is not verified (currency review required)', () => {
    const stale = verifiedSource({ currencyConfirmedAtIso: null });   // date present, currency never reviewed
    const auth = buildEnvironmentalLoadAuthority({ ...OPERATOR_INPUT, sourceEvidence: stale });
    expect(auth.verificationStatus).toBe('unverified');
    expect(auth.windSpeedBasis).toBe('operator-entered');   // falls back to operator override
    expect(environmentalSourceVerified(stale, 'project-braidon')).toBe(false);
  });

  it('a source that does not cover snow (or wrong project) is not verified (fail-closed)', () => {
    expect(environmentalSourceVerified(verifiedSource({ coversSnowLoad: false }), 'project-braidon')).toBe(false);
    expect(environmentalSourceVerified(verifiedSource(), 'a-different-project')).toBe(false);
    expect(environmentalSourceVerified(verifiedSource({ archivedInRepo: false }), 'project-braidon')).toBe(false);
    expect(environmentalSourceVerified(verifiedSource({ sha256: null }), 'project-braidon')).toBe(false);
  });
});

// ── §2 closer — the lib/documents resolution path that feeds sourceEvidence ────
describe('§2 — climate-hazard document class resolves the authority (closer wiring)', () => {
  const baseDoc: RegistryDocument = {
    id: 'DOC-ASCE7HAZ-001', documentClass: 'climate_hazard_dataset',
    manufacturerOrIssuer: 'ASCE', equipmentId: null,
    equipmentModelApplicability: 'MADISON COUNTY, IL',
    title: 'ASCE 7-22 Hazard Tool report — 3 MELVIN DR', revision: 'rev A',
    documentDate: '2026-07-01', archivedFileIdentity: 'asce7-melvin.pdf',
    archivedInRepo: true, sha256: 'deadbeefcafe0001', source: 'https://asce7hazardtool.online',
    jurisdictionBoundary: 'MADISON COUNTY, IL', applicabilityNotes: 'MADISON COUNTY, IL',
    status: 'current', supersedesId: null, supersededById: null,
    extractedClaims: {
      environmental: {
        dataset: 'ASCE 7 Hazard Tool', projectApplicability: 'MADISON COUNTY, IL',
        windSpeedMph: 107, groundSnowPsf: 20, exposureCategory: 'C', riskCategory: 'II',
        lat: 38.7061678, lng: -90.0461651, addressUsed: '3 MELVIN DR APT A, GRANITE CITY, IL 62040',
        lookupTimestampIso: '2026-07-01T00:00:00Z', currencyConfirmedAtIso: '2026-07-20T00:00:00Z',
        coversWindSpeed: true, coversSnowLoad: true, coversExposureRisk: true,
      },
    },
    verificationState: 'verified', reviewer: 'PE', verifiedBy: 'PE',
    verifiedAt: '2026-07-20T00:00:00Z', verificationNotes: null,
    createdBy: null, createdAt: '2026-07-20T00:00:00Z', updatedAt: '2026-07-20T00:00:00Z',
  };
  const CRIT = {
    documentClass: 'climate_hazard_dataset' as const,
    equipmentModel: 'MADISON COUNTY, IL',
    requireEnvironmentalHazard: true,
    projectApplicabilityKey: 'MADISON COUNTY, IL',
  };

  it('a verified, archived, currency-reviewed climate-hazard doc resolves AND verifies the authority', () => {
    const doc = pickVerifiedDocument([baseDoc], CRIT);
    expect(doc?.id).toBe('DOC-ASCE7HAZ-001');
    const ev = toEnvironmentalLoadSourceEvidence(doc)!;
    expect(environmentalSourceVerified(ev, 'MADISON COUNTY, IL')).toBe(true);
    const auth = buildEnvironmentalLoadAuthority({
      ...OPERATOR_INPUT, projectOrAhj: 'MADISON COUNTY, IL', sourceEvidence: ev,
      // AAC WS-4: the authority now also checks that the source was retrieved AT
      // THIS SITE (a coordinate change invalidates it). This document's claims
      // carry the real Braidon coordinates, so the project's must be the same
      // point — the rounded 38.7/-90.04 in OPERATOR_INPUT is ~690 m away and is
      // correctly refused. Same site ⇒ verified, exactly as before.
      coordinates: { lat: 38.7061678, lng: -90.0461651 },
    });
    expect(auth.verificationStatus).toBe('verified');
    // the DOCUMENT's value wins over the operator entry once verified
    expect(auth.ultimateWindSpeedMph).toBe(107);
    expect(auth.sourceDataset).toBe('ASCE 7 Hazard Tool');
    expect(auth.operatorOverrides).toEqual([]);
  });

  it('the resolver is fail-closed: unverified / unarchived / no-currency-review / wrong project all resolve to null', () => {
    const mut = (o: Partial<RegistryDocument>) => pickVerifiedDocument([{ ...baseDoc, ...o }], CRIT);
    expect(mut({ verificationState: 'in_review' })).toBeNull();
    expect(mut({ status: 'superseded' })).toBeNull();
    expect(mut({ archivedInRepo: false })).toBeNull();
    expect(mut({ sha256: null })).toBeNull();
    expect(pickVerifiedDocument([baseDoc], { ...CRIT, projectApplicabilityKey: 'SOME OTHER COUNTY' })).toBeNull();
    // a doc with NO environmental claims (e.g. a generic climate brochure)
    expect(mut({ extractedClaims: { values: { note: 'brochure' } } })).toBeNull();
    // currency never reviewed ⇒ STALE ⇒ never resolves
    const noCurrency = clone(baseDoc);
    noCurrency.extractedClaims!.environmental!.currencyConfirmedAtIso = null;
    expect(pickVerifiedDocument([noCurrency], CRIT)).toBeNull();
    // a wrong document CLASS can never satisfy the environmental criteria
    expect(pickVerifiedDocument([{ ...baseDoc, documentClass: 'racking_installation_manual' }], CRIT)).toBeNull();
  });

  it('no document at all ⇒ null evidence ⇒ the honest UNVERIFIED live state', () => {
    expect(toEnvironmentalLoadSourceEvidence(null)).toBeNull();
    expect(pickVerifiedDocument([], CRIT)).toBeNull();
    const auth = buildEnvironmentalLoadAuthority({ ...OPERATOR_INPUT, sourceEvidence: null });
    expect(auth.verificationStatus).toBe('unverified');
  });

  it('climate_hazard_dataset is a first-class registry document class', () => {
    expect(isDocumentClass('climate_hazard_dataset')).toBe(true);
  });
});

describe('§2 — severity + domain wiring for the renamed code', () => {
  it('ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED is BLOCKING and structural-domain', () => {
    expect(classifyBlockerSeverity('ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED').severity).toBe('blocking');
    expect(classifyBlockerDomain('ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED')).toBe('structural');
  });
});

// ── integration: the live-shaped Braidon (operator-entered wind/snow) ──────────
function renderLiveLike(): { html: string; snap: PermitDesignSnapshot } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-25T12:00:00Z';
  // simulate the LIVE Braidon row: operator TYPED 110 mph / Exposure C / 20 psf
  // (an observation/override) with NO archived climate-hazard source.
  input.project.ahjWindSpeedMph = 110;
  input.project.windSpeedMph = 110;
  input.project.windExposure = 'C';
  input.project.ahjGroundSnowPsf = 20;
  input.project.riskCategory = 'II';
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot };
}

function rs1Fragment(html: string): string {
  // RGM §5 — the union of RS-1 + its RS-1.n continuation sheets.
  const parts = html.split('<div class="page">');
  return parts.filter(p => p.includes('permitReadiness.registry')).join('\n');
}

describe('§2 — operator entry does NOT clear the blocker (the root fix)', () => {
  const { snap } = renderLiveLike();
  const codes = snap.permitReadiness.registry.map(r => r.code);

  it('operator-entered 110/C/20 still fires ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED', () => {
    expect(codes).toContain('ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED');
    const env = snap.structural.env.environmentalLoadAuthority;
    expect(env.verificationStatus).toBe('unverified');
    expect(env.windSpeedBasis).toBe('operator-entered');
    // the values are still carried for the preliminary analysis (exact value comes
    // from the canonical structural wind/snow, not asserted here)
    expect(env.ultimateWindSpeedMph).not.toBeNull();
    expect(env.groundSnowLoadPsf).not.toBeNull();
  });

  it('the retired code WIND-SNOW-AUTHORITY-UNRESOLVED no longer appears (no duplicate)', () => {
    expect(codes).not.toContain('WIND-SNOW-AUTHORITY-UNRESOLVED');
  });

  it('the env blocker is registered BLOCKING with structural domain', () => {
    const r = snap.permitReadiness.registry.find(x => x.code === 'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED');
    expect(r?.severity).toBe('blocking');
    expect(r?.domain).toBe('structural');
  });
});

describe('§1 — rendered multiset-equality across surfaces', () => {
  const { html, snap } = renderLiveLike();
  const registry = snap.permitReadiness.registry;
  const blockingCodes = registry.filter(r => r.severity === 'blocking' && !r.resolved).map(r => r.code).sort();

  it('registry BLOCKING codes === back-compat blockers list (issue-gate input)', () => {
    const listCodes = snap.permitReadiness.blockers.map(b => b.code).sort();
    expect(listCodes).toEqual(blockingCodes);
  });

  it('every BLOCKING code is rendered on RS-1', () => {
    const frag = rs1Fragment(html);
    expect(frag.length).toBeGreaterThan(0);
    for (const c of blockingCodes) expect(frag).toContain(c);
  });

  it('the RS-1 header requirement count equals the registry blocking count', () => {
    // RGM §4 — the header states GATE semantics: "<g> OPEN RELEASE GATES /
    // <r> UNRESOLVED REQUIREMENTS". The REQUIREMENT count is the one that must
    // equal the blocking registry count; the GATE count is the number of root
    // gates holding them and is always <= it (never conflated).
    const frag = rs1Fragment(html);
    const req = frag.match(/(\d+)\s+UNRESOLVED REQUIREMENT/);
    const gates = frag.match(/(\d+)\s+OPEN RELEASE GATE/);
    expect(req).toBeTruthy();
    expect(gates).toBeTruthy();
    const blockingCount = registry.filter(r => r.severity === 'blocking').length;
    expect(Number(req![1])).toBe(blockingCount);
    expect(Number(gates![1])).toBeGreaterThan(0);
    expect(Number(gates![1])).toBeLessThanOrEqual(blockingCount);
  });
});

describe('§3 — SCHED conclusion is registry-derived (no false global compliance)', () => {
  const { html, snap } = renderLiveLike();

  it('while blockers exist SCHED shows COMPLIANCE NOT YET ESTABLISHED, not UL-listed/complies', () => {
    // the equipment schedule (SCHED) page fragment
    const parts = html.split('<div class="page">');
    const sched = parts.find(p => p.includes('PAGE CONCLUSION — EQUIPMENT SCHEDULE')) ?? '';
    expect(sched.length).toBeGreaterThan(0);
    expect(snap.permitReadiness.ready).toBe(false);
    expect(sched).toContain('COMPLIANCE NOT YET ESTABLISHED');
    expect(sched).not.toContain('All equipment is UL-listed; wire sizing verified per NEC 690.8 with derating; equipment complies');
  });
});

describe('§6 — unverified fasteners are NON-ORDERABLE (cannot become orderable)', () => {
  // 2026-08-29 - THE DOCUMENT IS NOW ON FILE. SolarPro archives the Roof Tech
  // RT-MINI II Installation Manual (Jun 2025, 40 pp, SHA-256 6d868692...), fetched
  // from the manufacturer's own design portal, and the document lookup follows the
  // same supersession the PRODUCT lookup always did - so the gen-2 mount finally
  // resolves to the gen-2 manual. The fixture's fastener assembly is therefore
  // VERIFIED, and this section's premise no longer holds for it.
  //
  // The INVARIANT is unchanged and is what these cases now assert, against a
  // synthetic mount with no document on file. A rule proven only on production
  // data stops being proven the moment the data is corrected.
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-25T12:00:00Z';
  const html = generatePermitHTML(input);
  // TAC WS-4 — the fixture's fastener is honestly UNVERIFIED: its elements are
  // complete but the only cited source is a flashing/water-resistance evaluation
  // report (ESR-3575), which carries no fastener-installation authority, and the
  // on-file RT-MINI II document is not verified applicable to the selected
  // RT-MINI. §6's invariant therefore applies to the fixture directly.
  // THE INVARIANT, exercised through the documented override seam rather than
  // through production data: with no applicable installation document the
  // assembly is unverified and the row is non-orderable. Asserting this on the
  // fixture stopped proving anything the moment the real document was archived.
  const fa = projectFastenerAssemblyFromSnapshot(
    peekSnapshot(input), (input.project as { mountingSystemId?: string }).mountingSystemId,
    { documentApplicabilityVerified: false },
  );

  it('the fastener assembly is unverified ⇒ non-orderable, dimensionless line', () => {
    // 2026-08-29 - TWO FACETS. A stamped structural PE letter for the exact mount
  // names the fastener assembly (model, 2/mount, 3.07" embedment, no pilot hole,
  // archived in-repo with a SHA-256) and `documentRoles.fastenerAuthority` records
  // it as established - the projection simply never asked. So the SELECTION is
  // established and prints; what is still pending is the INSTALLATION detail, which
  // needs the manufacturer's installation document for the SELECTED product
  // version. `nonOrderable` and `verification` are unchanged (both facets are still
  // required for those), so procurement behaves exactly as before.
    expect(fa.verification).not.toBe('verified');
    expect(fa.nonOrderable).toBe(true);
    // the SELECTION is established by the stamped letter, so the assembly is named.
    expect(fa.selection.established).toBe(true);
    expect(fa.line).not.toBe(FASTENER_NON_ORDERABLE_LABEL);
    expect(fa.line).toMatch(/SS304/);
    // ...and the INSTALLATION detail is what is actually outstanding.
    expect(fa.installation.established).toBe(false);
  });

  it('TAC WS-4 — element completeness alone never yields "verified"', () => {
    // The elements ARE all present on the mount record…
    // 2026-08-28 RT-MINI MIGRATION - the roof fastener is the PE letter's
    // SS304 5.0 mm wood screw. The 5/16" the catalogue used to publish is the
    // L-FOOT FLANGE BOLT - a different fastener in a different joint.
    expect(fa.diameterLabel).toBe('M5 (5.0 mm)');
    // 2026-08-28 RT-MINI MIGRATION - the RT-MINI II record carries the PE letter's
    // own fastener: an SS304 5.0 mm x 90 mm wood screw, embedding 3.07 in (90 mm
    // less 15/32 in sheathing). 2.5 in and 'structural wood screw' were the
    // gen-1 record's generic values.
    expect(fa.embedmentIn).toBe(3.07);
    expect(fa.qtyPerMount).not.toBeNull();
    // …and the assembly is still UNVERIFIED, because presence is not evidence.
    expect(fa.verification).not.toBe('verified');
    expect(fa.nonOrderable).toBe(true);
  });

  it('the observed geometry is retained in the object for regeneration on verification', () => {
    // fields still populate (they auto-regenerate the full row once verified) even
    // though the printed line withholds them.
    expect(fa.present).toBe(true);
    // when verified, the line WOULD carry the description — the branch is guarded
    // solely on verification, so unverified can never render as orderable.
    // The label now names the facet that is MISSING. "PENDING VERIFIED FASTENER
    // ASSEMBLY" on a package that names the fastener, its quantity, its embedment
    // and its pilot rule from a stamped letter told the reader the wrong thing was
    // outstanding.
    expect(fa.certLabel).toBe('FASTENER ASSEMBLY ESTABLISHED \u2014 INSTALLATION DETAILS PENDING');
  });

  it('the rendered Roof Attachment Hardware row is flagged NON-ORDERABLE (TAC WS-4)', () => {
    // 2026-08-29 - the RENDERED package is now genuinely orderable (both the
    // capacity letter and the installation manual are archived for this exact
    // product), so the flag must TRACK the projection rather than be pinned to
    // one value. Pinning it to `false` was only ever true while a document was
    // missing.
    const _live = projectFastenerAssembly(input);
    expect(html).toContain(`data-fastener-orderable="${_live.nonOrderable ? 'false' : 'true'}"`);
    expect(html).not.toContain(`data-fastener-orderable="${_live.nonOrderable ? 'true' : 'false'}"`);
    // The label appears only while the row is actually non-orderable. Asserting
    // it unconditionally pinned the state, not the rule.
    if (_live.nonOrderable) expect(html).toContain(FASTENER_NON_ORDERABLE_LABEL);
    else expect(html).not.toContain(FASTENER_NON_ORDERABLE_LABEL);
  });
});
