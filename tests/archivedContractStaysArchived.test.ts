/**
 * tests/archivedContractStaysArchived.test.ts
 *
 * ARCHIVING A SIGNED CONTRACT LOOKED LIKE IT DID NOTHING.
 *
 * The archive path was just corrected so that filing a proposal no longer
 * rewrites an executed contract's status. That was the right call and it fixed a
 * worse bug: `rowToProposal` reads a proposal's status from `data_json.status`
 * and nowhere else, so one `jsonb_set` was what the entire website displayed — a
 * signed contract read "Archived" everywhere, and the value it replaced was
 * written down nowhere, so un-archiving was a guess.
 *
 * 🚨 BUT THE FILING FACT THEN WENT NOWHERE VISIBLE. `archivedAt` is written into
 * `data_json` on every archive. `rowToProposal` does not map it and `Proposal`
 * had no field for it, so the value existed in the database and could not be
 * read by anything. The proposals page filters the active list on
 * `status === 'archived'`, and an executed contract's status is now correctly
 * left as `accepted` — so archiving one appeared to work until the next reload,
 * at which point it was back in the active list with no explanation.
 *
 * That is a worse experience than the bug it replaced, for the specific user who
 * most wants signed work out of the way. The two halves have to agree: if the
 * filing fact moves off the status field, whatever reads the list has to read it
 * where it now lives.
 *
 * This pins the whole path — written, mapped, typed, filtered — because each
 * link is individually plausible and the chain is what was broken.
 *
 * 🚨 READS COMMENT-STRIPPED SOURCE, and with `stripComments` rather than the
 * strings-too variant: the latter is unsafe on `.tsx`, where a lone apostrophe
 * in JSX text opens a string it never closes and blanks real code to the next
 * apostrophe. `app/proposals/page.tsx` is full of user-facing prose.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

const TYPES = read('types', 'index.ts');
const LIST  = read('app', 'api', 'proposals', 'route.ts');
const BULK  = read('app', 'api', 'proposals', 'bulk', 'route.ts');
const PAGE  = read('app', 'proposals', 'page.tsx');

describe('🚨 the filing fact is written, and it is written for BOTH kinds', () => {
  it('every archive records archivedAt', () => {
    // Two statements — one for a row whose status is also being set, one for an
    // executed contract where it is not — and both must carry it.
    const writes = (BULK.match(/'\{archivedAt\}'/g) ?? []).length;
    expect(writes, 'the archive path stopped recording when it was archived')
      .toBeGreaterThanOrEqual(2);
  });

  it('and an executed contract\'s status is still left alone', () => {
    // The thing that must not regress: the whole website reads status from
    // data_json, so rewriting it on a signed row is what erased the signature's
    // own record of itself.
    expect(BULK).toMatch(/isIssued\(/);
  });
});

describe('🚨 ...and it can actually be READ', () => {
  it('the Proposal type has a field for it', () => {
    expect(TYPES, 'Proposal has no archivedAt, so nothing downstream can see it')
      .toMatch(/archivedAt\?:\s*string/);
  });

  it('🚨 rowToProposal maps it out of data_json', () => {
    // 🚨 THE BROKEN LINK. Without this the value is in the database and
    // unreachable: written on every archive, read by nothing.
    const i = LIST.indexOf('function rowToProposal(');
    expect(i, 'rowToProposal moved — this guard is blind').toBeGreaterThan(-1);
    const end = LIST.indexOf('\n}', i);
    expect(end).toBeGreaterThan(i);
    expect(LIST.slice(i, end), 'rowToProposal does not carry archivedAt')
      .toMatch(/archivedAt:\s*\(?dj\.archivedAt/);
  });

  it('it is taken from data_json, not from a column that does not exist', () => {
    // There is no `archived_at` column — the fact lives in the JSON document,
    // same as `status`. A guard that accepted `row.archived_at` would pass on
    // code that always reads undefined.
    const i = LIST.indexOf('function rowToProposal(');
    const end = LIST.indexOf('\n}', i);
    expect(LIST.slice(i, end)).not.toMatch(/archivedAt:\s*row\.archived_at/);
  });
});

describe('🚨 and the list treats it as archived', () => {
  it('🚨 the active-list filter reads archivedAt, not only the status', () => {
    // 🚨 THE USER-VISIBLE HALF. An executed contract keeps status 'accepted' by
    // design, so a filter that only asks about status puts it straight back in
    // the active list on the next reload — archiving it appeared to work and
    // then silently undid itself.
    // 🚨 PINS THE REQUIREMENT, NOT THE LITERAL. A first version demanded the
    // word `archivedAt` on the filter line itself, and failed on correct code:
    // the filter delegates to the shared predicate, which is better than
    // re-spelling the rule inline. What matters is that the filter consults the
    // rule; that the rule reads `archivedAt` is asserted on its own below.
    const i = PAGE.indexOf('if (!showArchived');
    expect(i, 'the archive filter moved — this guard is blind').toBeGreaterThan(-1);
    const line = PAGE.slice(i, PAGE.indexOf('\n', i));
    expect(line, 'the filter cannot see an archived executed contract')
      .toMatch(/isProposalArchived\(/);
    expect(line, 'the filter went back to asking about the status directly')
      .not.toMatch(/status === 'archived'/);
  });

  it('🚨 ...and the rule\'s ANSWER depends on archivedAt, not just its signature', () => {
    // 🚨 THE MOST IMPORTANT MUTATION ESCAPED THIS FIRST TIME. Deleting
    // `archivedAt` from the predicate's return — which is precisely the defect
    // being fixed, executed contracts back in the active list — left the file
    // green, because the guard scanned the whole declaration and the PARAMETER
    // TYPE names the field: `(p: { status?: ProposalStatus; archivedAt?: string })`.
    // A type mentioning a field is not a rule consulting it.
    //
    // So the assertion is scoped to the returned expression.
    const i = PAGE.indexOf('function isProposalArchived');
    expect(i, 'the shared predicate is gone').toBeGreaterThan(-1);
    const r = PAGE.indexOf('return', i);
    expect(r, 'the predicate has no return').toBeGreaterThan(i);
    const answer = PAGE.slice(r, PAGE.indexOf(';', r));

    expect(answer, 'the predicate ignores archivedAt — every archived contract comes back')
      .toMatch(/archivedAt/);
    // Both halves, and each one matters on its own: a status-only rule puts
    // executed contracts back in the list, and an archivedAt-only rule loses the
    // rows archived before this change, whose status genuinely is 'archived'.
    expect(answer, 'the predicate dropped the legacy archived status')
      .toMatch(/status === 'archived'/);
  });

  it('and the same rule decides how a row is DRAWN, and whether Archive is offered', () => {
    // A contract that the filter hides but the card still styles as active is
    // the same disagreement one layer down — and an Archive menu item still
    // offered on an already-filed contract is the same disagreement again. Both
    // used to ask about the status directly.
    expect(PAGE, 'the row styling still asks about the status alone')
      .toMatch(/isProposalArchived\(proposal\) \? 'bg-slate-700/);
    expect(PAGE, 'the Archive menu item is still offered on a filed contract')
      .toMatch(/\{!isProposalArchived\(proposal\) \? \(/);
  });

  it('the predicate is shared, not re-spelled at each site', () => {
    // 🚨 PINS THE REQUIREMENT, NOT A SPELLING. Three separate places asked
    // `status === 'archived'` before. The failure mode of fixing them
    // individually is that the fourth one is missed, so the rule becomes one
    // function and the sites call it.
    expect(PAGE).toMatch(/function isProposalArchived|const isProposalArchived/);
    const uses = (PAGE.match(/isProposalArchived\(/g) ?? []).length;
    expect(uses, 'the shared archive predicate is declared but barely used')
      .toBeGreaterThanOrEqual(2);
  });
});
