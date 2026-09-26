/**
 * lib/proposal/hydrateProposalFromRow.ts
 *
 * Turns the raw `proposals` row that GET /api/proposals/[id] returns into the
 * typed Proposal the homeowner share view renders, PLUS the signed state that
 * view must start in.
 *
 * 🚨 TWO DEFECTS LIVED IN THIS MAPPING, AND BOTH WERE ORDERING/OMISSION BUGS
 *    THAT A TYPE CHECK CANNOT SEE — which is why it is a pure function now.
 *
 * 1. `status` WAS ASSIGNED ABOVE THE `...dataJson` SPREAD.
 *    The `status` COLUMN is the authority — the signing path writes it, the
 *    homeowner 'viewed' path writes it — and `data_json.status` is a legacy
 *    field that those paths never update. Assigning the column first and then
 *    spreading data_json over it meant a stale `data_json.status` of 'draft'
 *    silently replaced the 'accepted' this page's own signing flow had just
 *    written. The fix is one line lower down, and nothing about the types
 *    changed, so only a behavioural check can hold it.
 *
 * 2. NOTHING SEEDED THE SIGNED STATE.
 *    `accepted` and `signerName` were React state initialised to false/null and
 *    never derived from the loaded row. A homeowner who signed, closed the tab
 *    and returned to their own share link — or forwarded it to a spouse — saw no
 *    evidence they had ever signed: no banner, no signer name, no date, and a
 *    live "Sign & Accept" button. Retyping their name produced a hard
 *    "Proposal has already been signed." from the idempotency guard in
 *    app/api/proposals/[id]/route.ts. They could not tell whether their contract
 *    had been recorded, on the highest-stakes screen in the product.
 *
 *    Three independent signals are checked because they are not redundant: a
 *    database predating migrations 020/031 has no `signed_at` and no
 *    `signer_name` columns, and only `data_json.signature` survives there.
 */

import type { Proposal } from '@/types';

/** The shape of the row the GET handler returns (SELECT * plus dbUtilityRate). */
export interface RawProposalRow {
  id?: string;
  project_id?: string;
  name?: string;
  title?: string;
  status?: string | null;
  created_at?: string;
  updated_at?: string;
  signed_at?: string | null;
  signer_name?: string | null;
  share_expires_at?: string | null;
  data_json?: unknown;
  dbUtilityRate?: number | null;
  [key: string]: unknown;
}

export interface HydratedProposal {
  proposal: Proposal;
  /** True when this proposal has already been signed, by any of three signals. */
  signed: boolean;
  /** The signer's name when recorded; '' when signed but the name was not stored. */
  signerName: string;
}

/** Parse `data_json`, which arrives as an object from pg and a string from some drivers. */
export function parseProposalDataJson(raw: RawProposalRow): Record<string, any> {
  const dj = raw?.data_json;
  if (typeof dj === 'string') {
    try {
      return JSON.parse(dj) ?? {};
    } catch {
      return {};
    }
  }
  return (dj as Record<string, any>) || {};
}

export function hydrateProposalFromRow(raw: RawProposalRow): HydratedProposal {
  const dataJson = parseProposalDataJson(raw);

  const proposal = {
    id:        raw.id,
    projectId: raw.project_id,
    title:     raw.title || raw.name || 'Solar Proposal',
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    project:   dataJson.project || null,
    ...dataJson,
    // 🚨 AFTER THE SPREAD. See (1) in the file header — above it, a stale
    // data_json.status clobbered the authoritative column.
    status:    raw.status || dataJson.status || 'sent',
    // dbUtilityRate is top-level on the row, not inside data_json.
    dbUtilityRate: raw.dbUtilityRate ?? null,
  } as unknown as Proposal;

  // 🚨 See (2) in the file header. `accepted` must be true for a row that is
  // already signed, or the homeowner is invited to sign an executed contract.
  const signed =
    Boolean(raw.signed_at) ||
    raw.status === 'accepted' ||
    Boolean(dataJson.signature);

  const signerName = signed
    ? ((dataJson.signature?.signerName as string | undefined) ??
       (raw.signer_name as string | null | undefined) ??
       '')
    : '';

  return { proposal, signed, signerName: signerName || '' };
}
