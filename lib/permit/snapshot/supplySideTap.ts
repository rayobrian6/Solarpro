// ═══════════════════════════════════════════════════════════════════════════
// ECD §5 (W1-F, 2026-07-26) — SupplySideTapConnectionAuthority.
//
// The BOM shipped `NSI Polaris | Insulated Multi-Tap Connector (350 kcmil–#6) |
// IPLD350-3 | qty 3` as an ORDERABLE, EXPORTABLE line whose own description
// said "Verify lug range against actual service conductor size". That caveat
// was a hardcoded literal inside the row's description — the SIXTH positional
// argument of two separate addItem calls (bom-engine-v4.ts:1581 and :2831) —
// with no authority object behind it and no effect on the row's orderability.
//
// The facts that caveat is about are: what the EXISTING service-entrance
// conductors actually are, and whether the candidate connector's LISTED
// conductor range covers them. Neither is known on this project — no service
// conductor survey exists, and nothing in the design records one. This module
// builds the record that says so HONESTLY (every unknown is `null`, never a
// default, never inferred from the service ampacity or from the product name),
// and derives the ONE label the connector row renders while unverified.
//
// PURE + deterministic (digest-safe). Fail-closed: `lugRangeCompatibility` is
// `null` — NOT `true` — whenever the existing conductor is unknown, and
// `verificationStatus` is 'verified' only when EVERY listed fact is present.
// ═══════════════════════════════════════════════════════════════════════════
import type { Provenance, ServiceTopologyObject, SupplySideTapConnectionAuthority } from './types';
import { SUPPLY_SIDE_TAP_CANDIDATE_LABEL } from './types';

export { SUPPLY_SIDE_TAP_CANDIDATE_LABEL };

/** The candidate connector the BOM emits for a supply-side tap. It is a
 *  CANDIDATE — the design has not verified it against the existing service. */
export const SUPPLY_SIDE_TAP_CANDIDATE_CONNECTOR = {
  manufacturer: 'NSI Polaris',
  sku: 'IPLD350-3',
  /** verbatim from the product's listing — a RANGE, not a verified match. */
  listedConductorRange: '350 kcmil–#6 AWG',
  ports: 3,
  connectionMethod: 'insulated multi-tap (insulation-piercing-free set-screw connector)',
} as const;

/** ECD §5 — the EXISTING open registry requirement that already governs the
 *  supply-side tap connection. Deliberately NOT a new requirement code: the §11
 *  architecture freeze fixes the requirement set, and this authority record is a
 *  row-state input, not a new gate. The row's blocking code is this one when it
 *  is open; the record's own `verificationStatus` carries the rest. */
export const SUPPLY_SIDE_TAP_GOVERNING_REQUIREMENT = 'TAP-CONDUCTOR-LENGTH-PENDING';

export interface BuildSupplySideTapArgs {
  /** the design's declared interconnection method. */
  interconnectionMethod: string;
  /** canonical service-topology objects (the tap-conductor object carries the
   *  tap conductor spec + its length authority). */
  serviceTopology: readonly ServiceTopologyObject[];
  /** raw project record — read ONLY for explicitly-surveyed service-conductor
   *  facts. An absent field stays null; nothing is inferred. */
  project: Record<string, unknown>;
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return s.length ? s : null;
};
const material = (v: unknown): 'Cu' | 'Al' | null => {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'CU' || s === 'COPPER') return 'Cu';
  if (s === 'AL' || s === 'ALUMINUM' || s === 'ALUMINIUM') return 'Al';
  return null;
};

/**
 * Build the tap-connection authority. Returns null for a non-supply-side
 * design (there is no tap connection to have an authority about).
 */
export function buildSupplySideTapConnectionAuthority(
  args: BuildSupplySideTapArgs,
): SupplySideTapConnectionAuthority | null {
  const { interconnectionMethod, serviceTopology, project } = args;
  if (!/SUPPLY|LINE/i.test(String(interconnectionMethod))) return null;

  const tapObj = serviceTopology.find(o => o.type === 'tap-conductors') ?? null;

  // ── the EXISTING service conductors. Recorded ONLY from an explicit survey
  //    field. There is no such field on this project ⇒ every value is null. ──
  const existingServiceConductorMaterial = material(project.existingServiceConductorMaterial);
  const existingServiceConductorSize = str(project.existingServiceConductorSize);
  const existingServiceConductorInsulation = str(project.existingServiceConductorInsulation);
  const existingServiceConductorCount = typeof project.existingServiceConductorCount === 'number'
    && project.existingServiceConductorCount > 0
    ? project.existingServiceConductorCount : null;
  const existingServiceConductorSource = str(project.existingServiceConductorSource);

  // ── the TAP conductors — from the canonical service-topology object. ───────
  const tapSpec = tapObj?.conductorSpec ?? null;
  const tapConductorSize = tapSpec ? (tapSpec.match(/#?\d+(?:\/0)?\s*(?:AWG|kcmil)/i)?.[0] ?? null) : null;
  const tapConductorMaterial = material(project.tapConductorMaterial)
    ?? (tapSpec && /\bAL\b|ALUMIN/i.test(tapSpec) ? 'Al' : tapSpec ? 'Cu' : null);
  const tapConductorLengthFt = typeof tapObj?.lengthFt === 'number' ? tapObj.lengthFt : null;
  const tapConductorLengthAuthority = tapObj?.lengthSource ?? null;

  // ── the CANDIDATE connector. Its listed range is a product fact; whether it
  //    COVERS the existing conductor cannot be evaluated while that conductor
  //    is unknown, so the compatibility verdict is null — never a default. ────
  const c = SUPPLY_SIDE_TAP_CANDIDATE_CONNECTOR;
  // NOT EVALUABLE, always, today: declaring the match requires BOTH a surveyed
  // existing conductor AND the connector's archived listing document to compare
  // it against. Neither exists. A future pass that ingests the listing and a
  // service survey sets this true/false — it is never defaulted to true here.
  const lugRangeCompatibility: boolean | null = null;

  const unresolvedFacts: string[] = [];
  if (existingServiceConductorSize == null) unresolvedFacts.push('existing service-entrance conductor SIZE not surveyed');
  if (existingServiceConductorMaterial == null) unresolvedFacts.push('existing service-entrance conductor MATERIAL not surveyed');
  if (existingServiceConductorInsulation == null) unresolvedFacts.push('existing service-entrance conductor INSULATION not surveyed');
  if (existingServiceConductorCount == null) unresolvedFacts.push('existing service-entrance conductor COUNT not surveyed');
  if (lugRangeCompatibility !== true) unresolvedFacts.push(`connector LISTED RANGE (${c.listedConductorRange}) not verified against the existing conductor`);
  unresolvedFacts.push('connector ENCLOSURE / installation-space compatibility not verified');
  if (tapConductorLengthFt == null) unresolvedFacts.push('tap-conductor LENGTH not measured (NEC 705.11(C) ≤10 ft)');
  unresolvedFacts.push('connector manufacturer LISTING DOCUMENT not archived');

  const provenance: Provenance = {
    source: 'supplySideTapConnectionAuthority',
    ref: tapObj?.objectId ?? null,
    note: 'Existing service-conductor facts are recorded ONLY from an explicit survey; '
      + 'nothing is inferred from service ampacity, panel rating or the connector product name.',
  };

  return {
    interconnectionMethod: String(interconnectionMethod),
    existingServiceConductorMaterial,
    existingServiceConductorSize,
    existingServiceConductorInsulation,
    existingServiceConductorCount,
    existingServiceConductorSource,
    tapConductorMaterial,
    tapConductorSize,
    tapConductorLengthFt,
    tapConductorLengthAuthority,
    connectorManufacturer: c.manufacturer,
    connectorSku: c.sku,
    listedConductorRange: c.listedConductorRange,
    connectorPorts: c.ports,
    lugRangeCompatibility,
    enclosureCompatibility: null,
    installationSpaceVerified: null,
    connectionMethod: c.connectionMethod,
    manufacturerDocumentId: null,
    listingEvidence: null,
    verificationStatus: 'unverified',
    unresolvedFacts,
    candidateLabel: SUPPLY_SIDE_TAP_CANDIDATE_LABEL,
    provenance,
  };
}

/** The one-line machine + rendered reason for an unverified tap connection. */
export function supplySideTapReason(a: SupplySideTapConnectionAuthority): string {
  return `${a.candidateLabel} · EXISTING SERVICE CONDUCTOR: `
    + `${a.existingServiceConductorSize ?? 'NOT SURVEYED'}`
    + `${a.existingServiceConductorMaterial ? ` ${a.existingServiceConductorMaterial}` : ''}`
    + ` · CONNECTOR LISTED RANGE: ${a.listedConductorRange ?? '—'}`
    + ` · LUG-RANGE COMPATIBILITY: ${a.lugRangeCompatibility == null ? 'NOT EVALUABLE' : a.lugRangeCompatibility ? 'VERIFIED' : 'FAILS'}`
    + ` · ${a.unresolvedFacts.length} unresolved fact${a.unresolvedFacts.length === 1 ? '' : 's'} (see RS-1)`;
}
