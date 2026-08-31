// ═══════════════════════════════════════════════════════════════════════════
// W4 §2 — CODE-AUTHORITY PROJECTION.
// THE read/format seam every renderer consumes for code editions. Mirrors
// structuralProjection / computeSystemProjection: sheets read edition text
// THROUGH here and never hold an NEC/IBC/IRC/IFC/ASCE literal of their own.
//
// Rules (Ray, W4 §2):
//   • Every displayed edition comes from snapshot.codeAuthority (one record).
//   • A missing (null) edition renders PENDING — never a fabricated year and
//     never a sheet-local literal.
//   • Editions the harness must compare cross-sheet are TAGGED with a
//     data-code-edition="<kind>" attribute so the evidence harness can extract
//     the printed edition per sheet and prove identity + literal-freedom.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitInput } from '../types';
import type { PermitDesignSnapshot } from './types';
import type {
  CodeAuthorityRecord, CodeEditionKind, CodeVerificationStatus,
} from './codeAuthority';
import { CODE_EDITION_KINDS } from './codeAuthority';
import { peekSnapshot } from './read';

/** Printed when an edition is unknown (null). Explicit, never blank. */
export const PENDING_EDITION = 'PENDING';

const FAMILY_PREFIX: Record<CodeEditionKind, string> = {
  nec: 'NEC', ibc: 'IBC', irc: 'IRC', ifc: 'IFC', asce: 'ASCE',
};

export interface CodeAuthorityProjection {
  present: boolean;
  record: CodeAuthorityRecord | null;
  // raw edition tokens (null ⇒ unknown)
  nec: string | null; ibc: string | null; irc: string | null; ifc: string | null; asce: string | null;
  // display labels ('NEC 2023' | 'NEC PENDING'; 'ASCE 7-22' | 'ASCE PENDING')
  necLabel: string; ibcLabel: string; ircLabel: string; ifcLabel: string; asceLabel: string;
  amendments: string[];
  verificationStatus: CodeVerificationStatus | 'absent';
  verified: boolean;
  ahjName: string | null;
  stateCode: string | null;
  incompleteEditions: CodeEditionKind[];
  /** raw edition token for a kind (null ⇒ unknown). */
  edition(kind: CodeEditionKind): string | null;
  /** display label for a kind ('NEC 2023' / 'NEC PENDING'). */
  label(kind: CodeEditionKind): string;
  /** HTML span carrying data-code-edition="<kind>" for harness extraction. */
  tag(kind: CodeEditionKind): string;
}

/** NATIONWIDE BASELINE (2026-08-27) — printed when the standard applies but its adopted EDITION is
 *  deferred to the AHJ. "IBC PENDING" reads as unfinished work on a drawing; "IBC PER AHJ ADOPTION"
 *  states the truth: the code family governs, the year is the AHJ's to confirm at plan review, and
 *  no design value depends on it. PENDING is still used for a genuinely unresolved edition. */
export const PER_AHJ_EDITION = 'PER AHJ ADOPTION';

// ── 2026-08-29 - "PENDING IBC" WAS NEVER A CODE EDITION ────────────────────
// These sheets read the RAW edition token (`cp.ibc ?? 'PENDING'`) and prepended
// it to the family name, so an unresolved adoption printed as though PENDING
// were a year:
//     "Prepared under ASCE 7-22 - PENDING IBC - PENDING IRC - NEC 2020"
//     "...per ASCE 7-22 26/27 and PENDING IBC/IRC."
// The projection has published the correct label all along - `cp.ibcLabel`,
// which reads "IBC PER AHJ ADOPTION" when the family governs but the year is the
// AHJ's to confirm, and "IBC PENDING" only when the adoption is genuinely
// unresolved. 63 places on this package already printed it correctly; these did
// not, and they are the ones a reviewer reads first.


// ── 2026-08-30 — A PRESENT EDITION WAS INDISTINGUISHABLE FROM A VERIFIED ONE ──
// `labelOf` consulted `source` ONLY when the edition was null, to choose between
// two wordings for "unknown". When an edition was PRESENT it printed bare — so a
// year read out of an unprovenanced state table rendered EXACTLY like one
// retrieved from the AHJ with a source hash:
//
//     NEC 2020                     <- state-adoption-table, 0 evidence
//     NEC 2020                     <- ahj-registry-retrieval, cited + hashed
//
// The same title block printed that bare year beside `IBC PER AHJ ADOPTION`,
// which reads as "the NEC edition is settled and the I-codes are not". Both are
// equally unprovenanced: the NEC producer audit puts 5 of 6 producers at zero
// adoption evidence and finds 1,757 jurisdictions where they DISAGREE.
//
// The edition SELECTION is unchanged — precedence is deliberately untouched, as
// it was when `project-record-unprovenanced` replaced the false `operator-entry`.
// What changes is that an unverified adoption now says so.
const EVIDENCE_BEARING_SOURCES = new Set([
  'ahj-registry-retrieval',   // a real retrieval: sourcesQueried + sourceHash
  'structural-engine-basis',  // self-describing — the engine RAN under this edition
]);

/** Printed after an edition that is real but whose ADOPTION is unverified. Uses
 *  the campaign's own vocabulary: the year is what SolarPro designed to, not a
 *  claim about what the authority adopted. The engineering summary already said
 *  "CALC BASIS: NEC 2020" in prose; this makes the drawing agree with it. */
export const UNVERIFIED_ADOPTION_SUFFIX = '(DESIGN BASIS)';

function labelOf(
  kind: CodeEditionKind, ed: string | null, source?: string | null, verified?: boolean,
): string {
  if (ed) {
    // A record-level `verificationStatus: 'verified'` means an ARCHIVED ADOPTION
    // DOCUMENT was obtained — codeAuthority holds a state adoption to be a
    // "stated basis, NOT an archived adoption document" and refuses to mark it
    // verified. So a verified record is evidence in its own right, independently
    // of which per-edition source token carried the year.
    return (verified || EVIDENCE_BEARING_SOURCES.has(source ?? ''))
      ? `${FAMILY_PREFIX[kind]} ${ed}`
      : `${FAMILY_PREFIX[kind]} ${ed} ${UNVERIFIED_ADOPTION_SUFFIX}`;
  }
  return `${FAMILY_PREFIX[kind]} ${source === 'edition-per-ahj-adoption' ? PER_AHJ_EDITION : PENDING_EDITION}`;
}

/** Build the code-authority projection from a snapshot (null-safe). */
export function projectCodeAuthority(
  snap: PermitDesignSnapshot | null | undefined,
): CodeAuthorityProjection {
  const record = (snap as unknown as { codeAuthority?: CodeAuthorityRecord } | null)?.codeAuthority ?? null;
  const ed = (k: CodeEditionKind): string | null => record?.editions?.[k]?.edition ?? null;
  const src = (k: CodeEditionKind): string | null => record?.editions?.[k]?.source ?? null;
  const nec = ed('nec'), ibc = ed('ibc'), irc = ed('irc'), ifc = ed('ifc'), asce = ed('asce');
  const isVerified = record?.verificationStatus === 'verified';

  const proj: CodeAuthorityProjection = {
    present: !!record,
    record,
    nec, ibc, irc, ifc, asce,
    necLabel: labelOf('nec', nec, src('nec'), isVerified),
    ibcLabel: labelOf('ibc', ibc, src('ibc'), isVerified),
    ircLabel: labelOf('irc', irc, src('irc'), isVerified),
    ifcLabel: labelOf('ifc', ifc, src('ifc'), isVerified),
    asceLabel: labelOf('asce', asce, src('asce'), isVerified),
    amendments: record?.localAmendments ?? [],
    verificationStatus: record?.verificationStatus ?? 'absent',
    verified: record?.verificationStatus === 'verified',
    ahjName: record?.ahjName ?? null,
    stateCode: record?.stateCode ?? null,
    incompleteEditions: record?.incompleteEditions ?? CODE_EDITION_KINDS.slice(),
    edition(kind) { return ed(kind); },
    label(kind) { return labelOf(kind, ed(kind), src(kind), isVerified); },
    tag(kind) {
      // NOTE: the tag shape is a HARNESS CONTRACT — tests and the evidence scripts extract with
      // `data-code-edition="<kind>">([^<]*)`. Do not add attributes between the kind and the `>`;
      // the edition SOURCE is available on the snapshot record (codeAuthority.editions[k].source).
      return `<span data-code-edition="${kind}">${labelOf(kind, ed(kind), src(kind), isVerified)}</span>`;
    },
  };
  return proj;
}

/** Convenience: project straight from a PermitInput (renderers hold `input`).
 *  Non-throwing — an absent snapshot yields an empty projection whose labels are
 *  all PENDING, so a standalone path degrades honestly instead of fabricating. */
// ══ 2026-08-29 — ONE ADOPTION STATE, ONE WORDING ══════════════════
// `PER_AHJ_EDITION` exists because "IBC PENDING" reads as unfinished work on a
// drawing while "IBC PER AHJ ADOPTION" states the truth: the family governs, the
// year is the AHJ's to confirm at plan review, and no design value depends on
// it. `labelOf` applies that, and 21 places per family already printed it.
//
// These consumers did not. They read the RAW edition token
// (`cp.ibc ?? 'PENDING'`) and composed their own sentence, so the SAME package
// said, on the SAME sheet:
//     governing codes strip .... IBC PER AHJ ADOPTION / IRC PER AHJ ADOPTION
//     engineering summary ...... AHJ-ADOPTED IBC / IRC / IFC: PENDING VERIFICATION
// Two presentations of one adoption state, and a reviewer cannot tell whether
// they describe the same thing.
//
// The label is the projection's to decide. A consumer that needs the family
// names in a sentence asks for them.
export const ADOPTED_ICODE_KINDS: CodeEditionKind[] = ['ibc', 'irc', 'ifc'];

/** The ONE sentence fragment naming the AHJ-adopted I-code editions. Every sheet
 *  that mentions them prints THIS, so the cover strip and the engineering
 *  summary cannot describe one adoption state two ways. */
export function adoptedICodePhrase(cp: CodeAuthorityProjection): string {
  return ADOPTED_ICODE_KINDS.map(k => cp.label(k)).join(' / ');
}

export function projectCodeAuthorityFromInput(input: PermitInput): CodeAuthorityProjection {
  return projectCodeAuthority(peekSnapshot(input));
}
