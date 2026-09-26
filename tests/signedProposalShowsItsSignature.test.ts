/**
 * tests/signedProposalShowsItsSignature.test.ts
 *
 * 🚨 A HOMEOWNER WHO SIGNED SAW "Sign & Accept" AGAIN, AND SIGNING AGAIN FAILED.
 *
 * On the homeowner share view, `accepted` and `signerName` were React state
 * initialised to false/null, and NOTHING derived them from the loaded row.
 * Someone who signed, closed the tab and came back to their own share link — or
 * forwarded it to a spouse — saw no evidence they had ever signed: no banner, no
 * signer name, no date, and a live "Sign & Accept Proposal" button. Retyping
 * their name produced a hard error, "Proposal has already been signed.", from the
 * idempotency guard in app/api/proposals/[id]/route.ts.
 *
 * So on the highest-stakes screen in the product, the signer could not tell
 * whether their contract had been recorded. Not a cosmetic defect: the two
 * available readings were "it did not save" and "something is broken", and both
 * are wrong.
 *
 * SECOND DEFECT, SAME MAPPING: `status: raw.status || 'sent'` was assigned ABOVE
 * the `...dataJson` spread, so a stale `data_json.status` of 'draft' silently
 * replaced the authoritative column — including the 'accepted' this page's own
 * signing flow had just written. Pure ordering. The types are identical either
 * way, which is exactly why it survived.
 *
 * WHY THIS IS BEHAVIOURAL AND NOT A SOURCE SCAN: the mapping was lifted out of a
 * 2,500-line client component's fetch callback into a pure function,
 * lib/proposal/hydrateProposalFromRow.ts, precisely so a test could reach it. An
 * ordering bug cannot be caught by a type check and should not be caught by
 * grepping for a line number.
 */

import { describe, it, expect } from 'vitest';
import { hydrateProposalFromRow, parseProposalDataJson } from '@/lib/proposal/hydrateProposalFromRow';

const BASE = {
  id: 'p-1',
  project_id: 'proj-1',
  name: 'Solar Proposal',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-20T10:00:00Z',
};

/** The row state a returning signer's share link actually loads. */
const SIGNED_ROW = {
  ...BASE,
  status: 'accepted',
  signed_at: '2026-09-20T10:00:00Z',
  signer_name: 'Jane Doe',
  data_json: {
    // 🚨 STILL 'draft'. The signing path writes the COLUMN and never this field.
    status: 'draft',
    title: 'Solar Proposal',
    project: { name: 'Doe Residence' },
    signature: { signedAt: '2026-09-20T10:00:00Z', signerName: 'Jane Doe', signerEmail: 'jane@x.com' },
  },
};

describe('🚨 a returning signer is not invited to sign again', () => {
  it('a signed row hydrates to accepted', () => {
    const { signed } = hydrateProposalFromRow(SIGNED_ROW);
    expect(signed, 'the page starts unsigned and shows "Sign & Accept" to a signer').toBe(true);
  });

  it('the signer name comes back so the page can say who signed', () => {
    const { signerName } = hydrateProposalFromRow(SIGNED_ROW);
    expect(signerName).toBe('Jane Doe');
  });

  it('signed_at ALONE is enough — the json signature may be absent', () => {
    const { signed, signerName } = hydrateProposalFromRow({
      ...BASE, status: 'sent', signed_at: '2026-09-20T10:00:00Z', signer_name: 'Bob Roe',
      data_json: { status: 'sent' },
    });
    expect(signed).toBe(true);
    expect(signerName).toBe('Bob Roe');
  });

  it("the column's 'accepted' ALONE is enough — no signed_at column on an old database", () => {
    const { signed } = hydrateProposalFromRow({
      ...BASE, status: 'accepted', data_json: { status: 'draft' },
    });
    expect(signed).toBe(true);
  });

  it('data_json.signature ALONE is enough — the pre-migration-020 fallback path', () => {
    // The signature branch writes data_json first and only then tries the
    // columns, precisely because they may not exist. That row must still read as
    // signed.
    const { signed, signerName } = hydrateProposalFromRow({
      ...BASE, status: 'sent',
      data_json: { status: 'sent', signature: { signerName: 'Old Row', signedAt: 'x' } },
    });
    expect(signed).toBe(true);
    expect(signerName).toBe('Old Row');
  });

  it('a genuinely unsigned proposal is NOT marked signed', () => {
    // The suppression has to be conditional or every homeowner is told they
    // already signed — the opposite error, and worse.
    const { signed, signerName } = hydrateProposalFromRow({
      ...BASE, status: 'sent', signed_at: null, signer_name: null,
      data_json: { status: 'sent', project: {} },
    });
    expect(signed).toBe(false);
    expect(signerName).toBe('');
  });

  it('a signed row with no recorded name yields "" rather than crashing the banner', () => {
    const { signed, signerName } = hydrateProposalFromRow({
      ...BASE, status: 'accepted', signed_at: '2026-09-20T10:00:00Z', signer_name: null,
      data_json: { status: 'draft' },
    });
    expect(signed).toBe(true);
    expect(signerName).toBe('');
  });
});

describe('🚨 the status COLUMN survives the data_json spread', () => {
  it('a signed contract does not read back as the json\'s stale "draft"', () => {
    const { proposal } = hydrateProposalFromRow(SIGNED_ROW);
    expect(proposal.status,
      'data_json.status clobbered the authoritative column — the assignment is above the spread')
      .toBe('accepted');
  });

  it('data_json.status is still the fallback when the column is null', () => {
    // Load-bearing: rows that predate the column have their only status here.
    const { proposal } = hydrateProposalFromRow({
      ...BASE, status: null, data_json: { status: 'viewed' },
    });
    expect(proposal.status).toBe('viewed');
  });

  it("neither present falls through to 'sent'", () => {
    const { proposal } = hydrateProposalFromRow({ ...BASE, status: null, data_json: {} });
    expect(proposal.status).toBe('sent');
  });

  it('the rest of data_json still lands on the proposal', () => {
    // The spread must not have been dropped in the course of reordering.
    const { proposal } = hydrateProposalFromRow(SIGNED_ROW);
    expect(proposal.title).toBe('Solar Proposal');
    expect((proposal as any).project?.name).toBe('Doe Residence');
    expect((proposal as any).signature?.signerName).toBe('Jane Doe');
  });

  it('dbUtilityRate is read off the row, not out of data_json', () => {
    const { proposal } = hydrateProposalFromRow({ ...BASE, status: 'sent', data_json: {}, dbUtilityRate: 0.137 });
    expect(proposal.dbUtilityRate).toBe(0.137);
  });
});

describe('data_json arrives as an object or a string', () => {
  it('a JSON string is parsed', () => {
    const row = { ...BASE, status: 'accepted', data_json: JSON.stringify({ status: 'draft', title: 'T' }) };
    expect(parseProposalDataJson(row).title).toBe('T');
    const { proposal, signed } = hydrateProposalFromRow(row);
    expect(proposal.status).toBe('accepted');
    expect(signed).toBe(true);
  });

  it('unparseable JSON degrades to {} instead of throwing the page away', () => {
    const row = { ...BASE, status: 'accepted', data_json: '{not json' };
    expect(parseProposalDataJson(row)).toEqual({});
    expect(hydrateProposalFromRow(row).signed).toBe(true);
  });
});
