/**
 * Proposal signature authority — the single answer to "may this write make a
 * proposal signed?".
 *
 * A proposal is an executed contract once the homeowner completes the
 * e-signature at POST /api/proposals/[id]/sign. That endpoint is the ONLY
 * writer allowed to produce the signed state, because it is the only one that
 * verifies the share token, records who signed and when, writes the
 * proposal_signatures audit row and advances the pipeline.
 *
 * Every other writer — the homeowner PATCH, the installer's PATCH/PUT merge,
 * the bulk status action — must refuse to produce any of the three signals the
 * rest of the product reads as "signed":
 *
 *   1. status column 'accepted' or 'signed'
 *   2. signed_at stamped
 *   3. data_json.signature present (hydrateProposalFromRow treats it alone as
 *      proof of signature — the pre-migration-020 fallback)
 *
 * Before this module each route kept its own copy of TERMINAL_STATUSES, and
 * three of them happily wrote status 'accepted' without a signature: a share
 * link holder could PATCH { status: 'accepted' } and the proposal read as
 * signed with no signer, no signature row, and the real /sign then refused
 * with 409.
 */

/** Statuses that mean "this contract has been executed". */
export const SIGNED_STATUSES: ReadonlySet<string> = new Set(['accepted', 'signed']);

/** Is this row already an executed contract? (Issued-artifact rule.) */
export function isIssued(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (row.signed_at) return true;
  return typeof row.status === 'string' && SIGNED_STATUSES.has(row.status);
}

/** A status value only the canonical e-signature workflow may write. */
export function isSignatureOnlyStatus(status: unknown): boolean {
  return typeof status === 'string' && SIGNED_STATUSES.has(status.trim().toLowerCase());
}

export const SIGNATURE_ONLY_MESSAGE =
  'A proposal becomes signed only when the homeowner completes the e-signature from the share link.';

export interface NonSignatureWriteVerdict {
  ok:     boolean;
  status: 403 | 409 | null;
  error:  string | null;
  reason: 'signature-field' | 'signature-status' | null;
}

/**
 * Gate for every proposal writer that is NOT the /sign workflow.
 *
 * Refuses a body that would forge any of the signed signals. It does not judge
 * ownership or tokens — callers still do that — and it does not judge the
 * issued-artifact freeze, which is a separate rule about already-signed rows.
 */
export function checkNonSignatureWrite(body: Record<string, unknown> | null | undefined): NonSignatureWriteVerdict {
  if (body && body.signature !== undefined) {
    return { ok: false, status: 403, error: SIGNATURE_ONLY_MESSAGE, reason: 'signature-field' };
  }
  if (body && isSignatureOnlyStatus(body.status)) {
    return { ok: false, status: 409, error: SIGNATURE_ONLY_MESSAGE, reason: 'signature-status' };
  }
  return { ok: true, status: null, error: null, reason: null };
}
