// ═══════════════════════════════════════════════════════════════════════════
// ECD §7 — RACKING BONDING AUTHORITY (docs/ENGINE-CLOSURE-DIRECTIVE.md §7,
// docs/ECD-ROOT-CAUSE-MAP.md W2-B).
//
// The BONDING REQUIREMENT and the BONDING METHOD are two different facts and the
// engine used to conflate them in four separate renderer-local literals:
//
//   lib/drafting/templates/roof.ts:2496        ['BONDING','UL 2703 INTEGRATED — NEC 690.43']  (verified branch)
//   lib/drafting/templates/roof.ts:2504        the SAME literal in the PENDING branch
//   lib/drafting/sheetComposition.ts:833       callout ⑦ 'BONDING JUMPER' / 'NEC 690.43'
//   lib/permit/sections/electricalPages.ts     SVG text 'MODULE RAIL — BONDED (UL 2703)'
//   lib/permit/sections/compliancePages.ts     APP-A 'UL Listing' row, fail-OPEN 'UL 2703'
//
// None consulted an authority. On the Braidon package the PV-3 table printed
// FASTENER ASSEMBLY: PENDING VERIFIED SELECTION, INSTALLATION DETAILS: NOT
// ESTABLISHED, EMBEDMENT / TORQUE / PILOT: WITHHELD — NO VERIFIED SOURCE … and
// then BONDING: UL 2703 INTEGRATED.
//
// The authority the statement needs was ALREADY computed: the canonical
// RackingAssemblyRecord (lib/permit/snapshot/rackingAssembly.ts) knows the mount
// SKU is null, the rail is unpinned, the UL 2703 listing basis, and the assembly
// verification state. This module projects those facts into the three-outcome
// bonding result the directive specifies, and the drafting stack consumes it.
//
// Standing rules honoured:
//   • product-name topology/listing inference is PROHIBITED — a UL 2703 listing
//     basis string on the record is evidence; a model name is not;
//   • no fabricated bonding authority: every field is an honest null while pending;
//   • the general NEC bonding REQUIREMENT is preserved unconditionally.
// ═══════════════════════════════════════════════════════════════════════════
import type {
  PermitDesignSnapshot, RackingAssemblyRecord, RackingBondingAuthority, RackingBondingResult,
} from './types';

/** The REQUIREMENT text. Code, not a method claim — always rendered. */
export const BONDING_REQUIREMENT_CODE_BASIS = 'NEC 250.134 / 690.43';
export const BONDING_REQUIREMENT_LABEL =
  `BONDING REQUIRED — BOND MODULE FRAMES AND RACKING PER ${BONDING_REQUIREMENT_CODE_BASIS}`;

/** ECD §7 — the exact wording the directive mandates while the method is pending. */
export const BONDING_METHOD_PENDING_LABEL =
  'BONDING REQUIRED / METHOD PENDING VERIFIED RACKING ASSEMBLY';
/** Dense-schedule / SVG form of the same statement (identical meaning). */
export const BONDING_METHOD_PENDING_SHORT_LABEL =
  'BONDING REQUIRED — METHOD PENDING VERIFIED ASSEMBLY';
/** In-drawing (SVG) form — same statement, sized for a detail label. */
export const BONDING_METHOD_PENDING_COMPACT_LABEL =
  'PENDING VERIFIED RACKING ASSEMBLY';

/** The assembly-verification sidecar fields the racking record carries. */
type AssemblyVerification = {
  railSku?: 'verified' | 'pending' | 'unverified';
  fastener?: 'verified' | 'pending' | 'unverified';
  overall?: 'verified' | 'pending';
};

export interface RackingBondingInputs {
  assembly: RackingAssemblyRecord | null | undefined;
  /** ECD §8 — the document state of the cited manufacturer document, when known. */
  documentApplicability?: {
    state: string;
    applicabilityVerified: boolean;
    documentTitle: string | null;
  } | null;
  /** the selected module frame identity, when the design has one. */
  moduleFrame?: string | null;
  /** BOM rows carrying bonding material, when any are ORDERABLE (never a
   *  candidate row — a non-orderable row is not a selected component). */
  orderableBondingBomLineIds?: string[];
}

/** Build the canonical racking-bonding authority. Pure; fail-closed. */
export function buildRackingBondingAuthority(inp: RackingBondingInputs): RackingBondingAuthority {
  const ra = (inp.assembly ?? null) as (RackingAssemblyRecord & {
    assemblyVerification?: AssemblyVerification;
  }) | null;
  const reasons: string[] = [];

  // ── the exact-assembly precondition ──────────────────────────────────────
  // A bonding METHOD is a property of an exact assembly. While the mount SKU is
  // unpinned or the rail is unpinned, there IS no exact assembly to carry a
  // listing, no matter what the product family is called.
  const railPending = ra
    ? (ra.railSku == null && (ra.railModel == null || /PENDING/i.test(ra.railModel)))
    : true;
  const exactAssemblySelected = !!ra && ra.mountSku != null && !railPending;
  if (!ra) reasons.push('No canonical racking-assembly record — no assembly to establish a bonding method.');
  else {
    if (ra.mountSku == null) reasons.push('Mount SKU is not pinned on the canonical racking assembly.');
    if (railPending) reasons.push('Rail SKU is not pinned on the canonical racking assembly.');
  }

  const assemblyVerified = ra?.assemblyVerification?.overall === 'verified';
  if (ra && !assemblyVerified) reasons.push('Racking-assembly verification state is not `verified`.');
  const assemblySupported = ra ? ra.assemblySupported !== false : false;
  if (ra && !assemblySupported) {
    reasons.push('The mixed-manufacturer assembly is not documented as supported.');
  }

  // ── the LISTING evidence ─────────────────────────────────────────────────
  // `ul2703ListingBasis` is a SOURCE string on the canonical record (e.g. an
  // ICC-ES / UL file reference). A null means no listing source — never inferred
  // from the product name.
  const listingSource = ra?.ul2703ListingBasis ?? null;
  if (!listingSource) reasons.push('No UL 2703 listing source is recorded for the assembly.');

  // ── SEPARATE bonding components ──────────────────────────────────────────
  // `groundingBonding` names the assembly's bonding component when the assembly
  // uses discrete hardware (WEEB / jumper / lug). A component is only SELECTED
  // when the exact assembly is selected — otherwise it is a family default.
  const separateComponents = exactAssemblySelected && ra?.groundingBonding
    ? [String(ra.groundingBonding)]
    : [];

  // ── the document that the method would be read from ──────────────────────
  const docApplicable = inp.documentApplicability?.applicabilityVerified === true;
  if (inp.documentApplicability && !docApplicable) {
    reasons.push('The cited manufacturer document is not APPLICABLE to the selected products.');
  }

  // ── the outcome ──────────────────────────────────────────────────────────
  const methodEstablished = exactAssemblySelected && assemblyVerified && assemblySupported && docApplicable;
  let result: RackingBondingResult = 'METHOD_PENDING_ASSEMBLY_SELECTION';
  if (methodEstablished && listingSource) result = 'INTEGRATED_LISTED_BONDING_VERIFIED';
  else if (methodEstablished && separateComponents.length) result = 'SEPARATE_BONDING_COMPONENTS_VERIFIED';

  const pending = result === 'METHOD_PENDING_ASSEMBLY_SELECTION';
  if (!pending) reasons.length = 0;

  const integrated = result === 'INTEGRATED_LISTED_BONDING_VERIFIED';
  const methodLabel = integrated
    ? `BONDING METHOD: INTEGRATED LISTED BONDING (UL 2703) — VERIFIED FOR THE SELECTED ASSEMBLY · ${BONDING_REQUIREMENT_CODE_BASIS}`
    : result === 'SEPARATE_BONDING_COMPONENTS_VERIFIED'
      ? `BONDING METHOD: SEPARATE LISTED BONDING COMPONENTS — ${separateComponents.join(', ').toUpperCase()} · ${BONDING_REQUIREMENT_CODE_BASIS}`
      : BONDING_METHOD_PENDING_LABEL;
  const methodShortLabel = integrated
    ? 'UL 2703 INTEGRATED BONDING — VERIFIED'
    : result === 'SEPARATE_BONDING_COMPONENTS_VERIFIED'
      ? `LISTED BONDING COMPONENTS — ${separateComponents.join(', ').toUpperCase()}`
      : BONDING_METHOD_PENDING_SHORT_LABEL;

  return {
    // The REQUIREMENT is code and is never gated by the method.
    bondingRequired: true,
    requirementCodeBasis: BONDING_REQUIREMENT_CODE_BASIS,
    result,
    bondingMethod: integrated
      ? 'integrated-listed'
      : result === 'SEPARATE_BONDING_COMPONENTS_VERIFIED' ? 'separate-components' : null,
    selectedAssemblyId: exactAssemblySelected ? (ra?.assemblyId ?? null) : null,
    selectedBondingComponents: pending ? [] : separateComponents,
    ul2703ListingSource: integrated ? listingSource : null,
    manufacturerDocument: inp.documentApplicability?.documentTitle ?? null,
    documentApplicabilityState: inp.documentApplicability?.state ?? null,
    documentApplicable: docApplicable,
    compatibleModuleFrame: pending ? null : (inp.moduleFrame ?? null),
    compatibleRailOrMount: pending
      ? null
      : [ra?.railManufacturer, ra?.railModel].filter(Boolean).join(' ') || ra?.mountModel || null,
    verificationState: pending ? (ra ? 'pending' : 'unverified') : 'verified',
    // A PENDING method orders nothing: a candidate row is not a selected component.
    bomLineIds: pending ? [] : (inp.orderableBondingBomLineIds ?? []),
    methodLabel,
    methodShortLabel,
    methodCompactLabel: integrated
      ? 'UL 2703 INTEGRATED — VERIFIED'
      : result === 'SEPARATE_BONDING_COMPONENTS_VERIFIED'
        ? 'LISTED BONDING COMPONENTS'
        : BONDING_METHOD_PENDING_COMPACT_LABEL,
    requirementLabel: BONDING_REQUIREMENT_LABEL,
    reasons,
    provenance: {
      source: 'ECD §7 buildRackingBondingAuthority (structural.rackingAssembly + document applicability)',
      ref: ra?.assemblyId ?? null,
    },
  };
}

/** Fail-closed accessor for renderers: no snapshot / no record ⇒ the PENDING
 *  outcome, so no sheet can assert a method from a missing authority. */
export function projectRackingBondingAuthority(
  snap: PermitDesignSnapshot | null | undefined,
): RackingBondingAuthority {
  const stored = (snap?.structural as unknown as {
    rackingBonding?: RackingBondingAuthority;
  } | undefined)?.rackingBonding;
  if (stored) return stored;
  return buildRackingBondingAuthority({ assembly: null });
}
