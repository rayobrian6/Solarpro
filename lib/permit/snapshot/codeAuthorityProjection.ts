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


function labelOf(kind: CodeEditionKind, ed: string | null, source?: string | null): string {
  if (ed) return `${FAMILY_PREFIX[kind]} ${ed}`;
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

  const proj: CodeAuthorityProjection = {
    present: !!record,
    record,
    nec, ibc, irc, ifc, asce,
    necLabel: labelOf('nec', nec, src('nec')),
    ibcLabel: labelOf('ibc', ibc, src('ibc')),
    ircLabel: labelOf('irc', irc, src('irc')),
    ifcLabel: labelOf('ifc', ifc, src('ifc')),
    asceLabel: labelOf('asce', asce, src('asce')),
    amendments: record?.localAmendments ?? [],
    verificationStatus: record?.verificationStatus ?? 'absent',
    verified: record?.verificationStatus === 'verified',
    ahjName: record?.ahjName ?? null,
    stateCode: record?.stateCode ?? null,
    incompleteEditions: record?.incompleteEditions ?? CODE_EDITION_KINDS.slice(),
    edition(kind) { return ed(kind); },
    label(kind) { return labelOf(kind, ed(kind), src(kind)); },
    tag(kind) {
      // NOTE: the tag shape is a HARNESS CONTRACT — tests and the evidence scripts extract with
      // `data-code-edition="<kind>">([^<]*)`. Do not add attributes between the kind and the `>`;
      // the edition SOURCE is available on the snapshot record (codeAuthority.editions[k].source).
      return `<span data-code-edition="${kind}">${labelOf(kind, ed(kind), src(kind))}</span>`;
    },
  };
  return proj;
}

/** Convenience: project straight from a PermitInput (renderers hold `input`).
 *  Non-throwing — an absent snapshot yields an empty projection whose labels are
 *  all PENDING, so a standalone path degrades honestly instead of fabricating. */
export function projectCodeAuthorityFromInput(input: PermitInput): CodeAuthorityProjection {
  return projectCodeAuthority(peekSnapshot(input));
}
