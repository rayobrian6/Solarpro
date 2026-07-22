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

function labelOf(kind: CodeEditionKind, ed: string | null): string {
  return `${FAMILY_PREFIX[kind]} ${ed ?? PENDING_EDITION}`;
}

/** Build the code-authority projection from a snapshot (null-safe). */
export function projectCodeAuthority(
  snap: PermitDesignSnapshot | null | undefined,
): CodeAuthorityProjection {
  const record = (snap as unknown as { codeAuthority?: CodeAuthorityRecord } | null)?.codeAuthority ?? null;
  const ed = (k: CodeEditionKind): string | null => record?.editions?.[k]?.edition ?? null;
  const nec = ed('nec'), ibc = ed('ibc'), irc = ed('irc'), ifc = ed('ifc'), asce = ed('asce');

  const proj: CodeAuthorityProjection = {
    present: !!record,
    record,
    nec, ibc, irc, ifc, asce,
    necLabel: labelOf('nec', nec),
    ibcLabel: labelOf('ibc', ibc),
    ircLabel: labelOf('irc', irc),
    ifcLabel: labelOf('ifc', ifc),
    asceLabel: labelOf('asce', asce),
    amendments: record?.localAmendments ?? [],
    verificationStatus: record?.verificationStatus ?? 'absent',
    verified: record?.verificationStatus === 'verified',
    ahjName: record?.ahjName ?? null,
    stateCode: record?.stateCode ?? null,
    incompleteEditions: record?.incompleteEditions ?? CODE_EDITION_KINDS.slice(),
    edition(kind) { return ed(kind); },
    label(kind) { return labelOf(kind, ed(kind)); },
    tag(kind) {
      return `<span data-code-edition="${kind}">${labelOf(kind, ed(kind))}</span>`;
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
