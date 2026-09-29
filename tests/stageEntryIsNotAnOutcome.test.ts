/**
 * tests/stageEntryIsNotAnOutcome.test.ts
 *
 * ENTERING "INSPECTION" WOULD HAVE TOLD THE HOMEOWNER IT PASSED.
 *
 * 🚨 A LANDMINE IN DORMANT CODE, ARMED BY THE FIX THAT WAS ABOUT TO LAND.
 *
 * `/api/projects/transition` is a governed stage machine whose docblock calls
 * it "the ONLY authorised path". It has **zero callers** — every real stage
 * write goes to `update-status`, which validates set membership and nothing
 * else. Repointing those writers at the governed route is the top recommendation
 * from the CRM research lane, and it also unlocks the homeowner lane's top item,
 * because this route's map already covers `permit_submitted`, `permit_approved`,
 * `install_scheduled` and `pto_submitted`.
 *
 * Which is exactly what made this dangerous. The map contained
 * `inspection: 'inspection_passed'`. `writeMicroStage` forward-syncs
 * `homeowner_stage`, and the customer portal renders micro-stages as
 * milestones — so the moment anyone wired this route up, every project ENTERING
 * inspection would have announced to its homeowner that the inspection had
 * PASSED. A customer acts on that. And it would have arrived as a side effect
 * of an unrelated improvement, which is the worst way for a defect to ship.
 *
 * THE RULE: a stage ENTRY is not an OUTCOME. Every other entry in that map
 * records something that has genuinely happened by the time the stage begins.
 * Inspection is the one stage whose entire purpose is that it can fail.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { stripComments } from './support/stripSource';
import { MICRO_STAGES } from '../lib/microStage';
import { microStageForPipelineStage } from '@/lib/operations/pipelineMicroStage';

const ROOT = join(__dirname, '..');
/**
 * 🚨 THE MAP MOVED, AND THIS GUARD MOVED WITH IT.
 *
 * It used to read `app/api/projects/transition/route.ts`, which was the map's
 * only home while that route was its only reader. It is not any more:
 * `app/api/projects/update-status` — the route the UI actually calls, where every
 * real stage change arrives — needs the same mapping, and the transition route
 * has zero UI callers. Rather than copy the table (which is how this codebase
 * grew five copies of NEC 310.16), it lives in lib/operations/pipelineMicroStage.ts
 * and both routes read it.
 *
 * This guard protects the `inspection` omission, which is the reason the table
 * needs guarding at all — so it follows the table, not the route.
 */
const ROUTE = stripComments(
  readFileSync(join(ROOT, 'lib', 'operations', 'pipelineMicroStage.ts'), 'utf8'),
);

/** The map body, anchored on real syntax rather than a character count. */
function mapBody(): string {
  const i = ROUTE.indexOf('const PIPELINE_STAGE_TO_MICRO');
  expect(i, 'the stage-to-micro map is gone').toBeGreaterThan(-1);
  const end = ROUTE.indexOf('};', i);
  expect(end).toBeGreaterThan(i);
  return ROUTE.slice(i, end);
}

describe('🚨 entering a stage never claims its outcome', () => {
  it('inspection maps to nothing', () => {
    expect(mapBody(), 'entering inspection announces a result the inspection has not had')
      .not.toMatch(/inspection:\s*'inspection_passed'/);
    expect(mapBody(), 'inspection is mapped to something again — a stage entry is not an outcome')
      .not.toMatch(/^\s*inspection:\s*'/m);
  });

  it('and `inspection_passed` still exists for whatever observes a real pass', () => {
    // Removing the mapping must not remove the vocabulary — a genuine pass
    // still needs somewhere to be recorded.
    expect(MICRO_STAGES as readonly string[]).toContain('inspection_passed');
  });

  it('the entries that DID survive all record something that has happened', () => {
    // Entering installation means the install started; entering pto means PTO
    // was submitted. Those are entry-true. Kept explicitly so a future edit has
    // to think about which kind it is adding.
    const b = mapBody();
    expect(b).toMatch(/installation:\s*'install_started'/);
    expect(b).toMatch(/pto:\s*'pto_submitted'/);
    expect(b).toMatch(/permit_submitted:\s*'permit_submitted'/);
  });

  it('🚨 no surviving entry asserts a PASS, APPROVAL or COMPLETION it cannot know', () => {
    // The general form of the defect, so the next one is caught by SHAPE rather
    // than by name.
    //
    // The exemption is principled, not a list: a stage whose OWN NAME asserts
    // the outcome is entry-true, because you only enter it once the outcome has
    // happened. `permit_approved -> permit_approved` and
    // `design_complete -> layout_completed` both qualify — the second is why
    // this rule had to be stated properly rather than matched on equality,
    // since "design complete" and "layout completed" are the same fact in
    // different words. `inspection` asserts nothing, which is the whole point.
    const ASSERTS_OUTCOME = /(passed|approved|complete|completed)/;
    const b = mapBody();
    const suspicious = [...b.matchAll(/^\s*(\w+):\s*'([a-z_]+)'/gm)]
      .filter(([, stage, micro]) =>
        ASSERTS_OUTCOME.test(micro) && !ASSERTS_OUTCOME.test(stage));
    expect(suspicious.map(m => `${m[1]} -> ${m[2]}`),
      'a stage entry is claiming a pass, approval or completion that has not been observed')
      .toEqual([]);
  });
});

describe('🚨 BOTH routes write the micro-stage, and both no-op on an unmapped stage', () => {
  // This block used to be titled "the route this protects is still the dormant
  // one" and checked only the transition route. That is no longer the shape of
  // the world: the transition route has zero UI callers, and
  // `app/api/projects/update-status` — where every real stage change arrives —
  // now performs the same customer-facing sync, because before it did not and
  // the homeowner portal simply never moved.
  //
  // So the protection has to cover both, or the live route is the unguarded one.
  const routeSrc = (...p: string[]) =>
    stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

  const ROUTES: Array<[string, () => string]> = [
    ['transition', () => routeSrc('app', 'api', 'projects', 'transition', 'route.ts')],
    ['update-status', () => routeSrc('app', 'api', 'projects', 'update-status', 'route.ts')],
  ];

  it.each(ROUTES)('%s writes the micro-stage', (_name, src) => {
    expect(src()).toMatch(/writeMicroStage\(/);
  });

  it.each(ROUTES)('%s writes NOTHING when a stage has no mapping', (name, src) => {
    // The whole repair depends on an unmapped stage — `inspection` above all —
    // being a no-op rather than falling through to some default. Both routes ask
    // the shared resolver and both guard on its result.
    const s = src();
    expect(s, `${name} no longer asks the shared mapping`)
      .toMatch(/microStageForPipelineStage\(/);
    expect(s, `${name} calls writeMicroStage without checking there IS a mapping`)
      .toMatch(/if \(mappedMicro\) \{/);
  });

  it('and the shared resolver returns null for an unmapped stage', () => {
    // The behavioural half: the source guards above only prove the routes ask
    // and branch. This proves the answer they branch on is the right one.
    expect(microStageForPipelineStage('inspection')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE WIDENING: EVERY MICRO-STAGE WRITER, NOT JUST THE DORMANT ROUTE
// ═══════════════════════════════════════════════════════════════════════════
//
// Everything above guards ONE table, reached from two routes — and the table it
// guards is the careful one. Two OTHER writers were quietly doing the thing this
// file exists to forbid, in the paths real UI actually calls:
//
//   • app/api/admin/projects/[id] held `HOMEOWNER_TO_MICRO_OVERRIDE`, mapping
//     every stage an admin can select onto a "representative" milestone. One
//     click on "Save Stage" told the homeowner their utility bill had been
//     received (on a screen still asking them to upload it), that a site visit
//     report had been submitted (while the card said a technician WILL visit), or
//     that the installation crew had ARRIVED AT THEIR HOME (while the card said
//     permits were still being handled). Dated, customer-visible, and false.
//
//   • app/api/projects/[id]/homeowner-stage mapped `installation` to
//     `contract_signed`. Advancing a customer to Installation made that
//     customer's own portal state, with today's date, that THEY had signed the
//     agreement — on projects where no proposal was ever sent.
//
// A guard on one map is not a guard on the rule. The rule is:
//
//   A STAGE→MICRO-STAGE MAPPING MAY ONLY RECORD SOMETHING THAT IS TRUE BY THE
//   FACT OF ENTERING THAT STAGE.
//
// That cannot be decided by a regex on the micro-stage's name — `bill_uploaded`
// and `survey_submitted` assert no "pass" or "approval", and both were lies. It
// is a judgement per PAIR. So the pairs are enumerated here, per file, and any
// pair that is not on the list fails until someone states why entering that
// stage makes that milestone true. A new writer with any stage→micro map fails
// by default, which is the only way a rule survives the next author.
//
// SCOPE, stated so the next reader does not assume more coverage than exists:
// this scans stage-KEYED MAPS. A direct `writeMicroStage(id, 'bill_parsed')` at
// the point the bill is actually parsed is a specific observed event, not a
// mapping, and is not what this rule is about.

/** Repo-relative path, with forward slashes on every platform. */
const relPath = (abs: string): string => relative(ROOT, abs).split(sep).join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Anything that writes a micro-stage, or defines a map of them.
 *
 * Matched on RAW text (cheap, and a comment cannot create a call). The files it
 * selects are then comment-stripped before being scanned for pairs, because the
 * repairs' own docblocks quote the mappings they removed — the exact way two
 * Phase-4 guards were satisfied by the comment documenting the fix.
 */
const WRITER_SIGNALS = /writeMicroStage\(|INSERT INTO project_micro_stages|MicroStage>/;

const MICRO_STAGE_FILES: string[] = walk(join(ROOT, 'app'))
  .concat(walk(join(ROOT, 'lib')))
  .filter(f => WRITER_SIGNALS.test(readFileSync(f, 'utf8')))
  // The vocabulary itself: it maps micro → homeowner stage, the other direction.
  .filter(f => relPath(f) !== 'lib/microStage.ts')
  .map(relPath)
  .sort();

/**
 * The ONLY stage→micro mappings in the codebase, and why each is entry-true.
 *
 * Keyed by file, not by stage name, because the same word means different things
 * in different vocabularies — and that is not hypothetical. `installation` in the
 * ops pipeline means the crew is working (13-stage internal pipeline, an operator
 * moves it when work starts). `installation` in the homeowner's 7-stage journey
 * means "your installation is being planned… you'll receive a confirmed date
 * soon". Mapping it to `install_started` is right in the first and was one of the
 * three lies in the second.
 */
const ENTRY_TRUE_MAPPINGS: Record<string, Record<string, string>> = {
  // The ops pipeline. Each stage is entered by an operator asserting the event.
  'lib/operations/pipelineMicroStage.ts': {
    site_assessment:   'survey_scheduled',
    design_complete:   'layout_completed',
    proposal_sent:     'proposal_sent',
    contract_signed:   'contract_signed',   // stage name IS the outcome
    engineering:       'engineering_started',
    permit_submitted:  'permit_submitted',
    permit_approved:   'permit_approved',
    install_scheduled: 'install_scheduled',
    installation:      'install_started',
    pto:               'pto_submitted',
    complete:          'system_live',
    // `inspection` is absent, and §1 above is what keeps it absent.
  },
  // The installer's manual customer-stage control.
  'app/api/projects/[id]/homeowner-stage/route.ts': {
    proposal:  'proposal_sent',       // the stage is entered by sending it
    completed: 'install_completed',   // entered once the system is live
    // `installation` is absent: it used to map to `contract_signed`.
  },
  // 🚨 THE SIGNATURE PATH ITSELF — the one place `contract_signed` is established
  // rather than asserted. This is NOT a stage→micro mapping: it is the
  // `toStage` argument handed to `applyStageChange` in the SAME operation that
  // writes `proposals.signed_at` and the signer's name. The customer really did
  // just sign; nothing is being inferred from a phase selection.
  //
  // This entry exists because the scan is deliberately broad and CAUGHT this pair
  // when it was added, which is the guard working. The rule it enforces is
  // unchanged: `contract_signed` may be reached only by the code that records the
  // signature, and `app/api/projects/[id]/homeowner-stage/route.ts` is still
  // forbidden from reaching it by selecting a phase.
  'app/api/proposals/[id]/sign/route.ts': {
    toStage: 'contract_signed',
  },
};

const MICRO_SET = new Set<string>(MICRO_STAGES as readonly string[]);

/** `key: 'micro_stage'` pairs — an object literal mapping something to a micro. */
function stageMicroPairs(src: string): Array<[string, string]> {
  return [...src.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([a-z_]+)'/g)]
    .filter(m => MICRO_SET.has(m[2]))
    .map(m => [m[1], m[2]] as [string, string]);
}

describe('🚨 EVERY micro-stage writer, not just the one with a test', () => {
  it('the scan finds the writers it is supposed to find', () => {
    // A predicate that silently matches nothing is the failure mode this whole
    // file is about. These four are known writers; the list is not exhaustive by
    // design — anything else the walk finds is scanned too.
    for (const known of [
      'app/api/projects/transition/route.ts',
      'app/api/projects/update-status/route.ts',
      'app/api/portal/bill-upload/route.ts',
      'lib/operations/pipelineMicroStage.ts',
    ]) {
      expect(MICRO_STAGE_FILES, `${known} is not being scanned`).toContain(known);
    }
    expect(MICRO_STAGE_FILES.length).toBeGreaterThanOrEqual(4);
  });

  it('no file maps a stage onto a milestone that entering it does not establish', () => {
    const offences: string[] = [];
    for (const file of MICRO_STAGE_FILES) {
      const src = stripComments(readFileSync(join(ROOT, file), 'utf8'));
      const allowed = ENTRY_TRUE_MAPPINGS[file] ?? {};
      for (const [stage, micro] of stageMicroPairs(src)) {
        if (allowed[stage] !== micro) offences.push(`${file}: ${stage} -> ${micro}`);
      }
    }
    expect(
      offences,
      'a stage selection is recording a milestone as having happened. If entering ' +
      'that stage really does make that milestone true, add the pair to ' +
      'ENTRY_TRUE_MAPPINGS with the reason — do not widen the pattern. ' +
      'If the pair is not a stage→micro mapping at all (for example an audit field ' +
      'like `from_stage: \'contract_signed\'` that happens to hold a micro-stage ' +
      'NAME), say so in a comment next to the ENTRY_TRUE_MAPPINGS entry you add ' +
      'for it — the scan is deliberately broad, because a narrow one is how the ' +
      'admin route\'s map went unnoticed for months.',
    ).toEqual([]);
  });

  it('and the enumerated mappings are all still there (the list is not stale)', () => {
    // Without this, deleting a legitimate mapping and the whole scan going quiet
    // would read as success.
    for (const [file, pairs] of Object.entries(ENTRY_TRUE_MAPPINGS)) {
      const src = stripComments(readFileSync(join(ROOT, file), 'utf8'));
      const found = new Map(stageMicroPairs(src));
      for (const [stage, micro] of Object.entries(pairs)) {
        expect(found.get(stage), `${file} no longer maps ${stage} -> ${micro}`).toBe(micro);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 `contract_signed` IS A FACT ABOUT A SIGNATURE
// ═══════════════════════════════════════════════════════════════════════════
//
// The portal renders it as "You signed — you're locked in!". A customer disputing
// a contract must never be shown the vendor's own system asserting they signed
// one, dated, because an installer clicked a stage dropdown. So the census is
// explicit: the only things that may write it are the proposal signature path
// (POST .../sign — the PATCH branch that used to be the second one is retired),
// which sets `proposals.signed_at` in the same operation — and
// the ops pipeline stage whose own name is `contract_signed`.

describe('🚨 nothing invents a signature', () => {
  /**
   * Files that can put `contract_signed` into `project_micro_stages`.
   *
   * 🚨 NOT "files that contain the string". That version failed for the right
   * reason and the wrong finding: `app/api/projects/update-status` contains
   * `contract_signed: 'approved'` (micro-stage name as a KEY, mapping to a
   * PIPELINE status) and `transition` tests `newStage === 'contract_signed'`.
   * Neither writes the milestone; both reach it, legitimately, through the shared
   * pipeline map whose key is the identically-named stage — and update-status sets
   * `contract_signed_at = NOW()` when it does. Counting a mention as a write
   * would have made this suite demand the removal of correct code.
   *
   * A WRITE is: the literal handed to `writeMicroStage`, the literal inside an
   * INSERT into the table, or a stage→micro pair whose value is it (the last of
   * which is what the third test below generalises).
   */
  const writesContractSigned = (src: string): boolean =>
    /INSERT INTO project_micro_stages[\s\S]{0,400}?'contract_signed'/.test(src) ||
    /writeMicroStage\([^;]{0,300}'contract_signed'/.test(src) ||
    stageMicroPairs(src).some(([, micro]) => micro === 'contract_signed');

  const WRITERS = MICRO_STAGE_FILES
    .filter(f => writesContractSigned(stripComments(readFileSync(join(ROOT, f), 'utf8'))))
    .sort();

  it('only the signature paths and the identically-named pipeline stage write it', () => {
    expect(WRITERS).toEqual([
      // Raw INSERT, in the same block that sets signed_at. The PATCH signing
      // branch in app/api/proposals/[id]/route.ts was retired (410) — the
      // e-signature workflow is now the ONLY proposal signature path — so the
      // census is one writer SHORTER, never longer.
      'app/api/proposals/[id]/sign/route.ts',
      // The map entry keyed by the identically-named pipeline stage.
      'lib/operations/pipelineMicroStage.ts',
    ]);
  });

  it('each signature path records the signature itself, not just the milestone', () => {
    for (const f of ['app/api/proposals/[id]/sign/route.ts']) {
      const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
      expect(src, `${f} writes the milestone without recording a signature`)
        .toMatch(/signed_at\s*=\s*NOW\(\)|signed_at\)/);
    }
  });

  it('and no stage-keyed mapping reaches it except one named for it', () => {
    // The specific defect: `installation: 'contract_signed'`. Generalised — any
    // key that is not itself `contract_signed`.
    //
    // 🚨 THIS CASE NOW HONOURS ENTRY_TRUE_MAPPINGS, and that is a fix to the guard
    // pair rather than a weakening of it. Its sibling above consults the allow-list;
    // this one hard-coded `stage !== 'contract_signed'`, so the documented escape
    // hatch — "add the pair with the reason" — was unusable for the one stage it
    // matters most for. The two assertions disagreed about the rule they enforce.
    //
    // The rule is unchanged: a PHASE SELECTION may never claim a signature. What the
    // allow-list admits is the signature path's own `toStage` argument, in the same
    // operation that writes `signed_at` — and the case below this one independently
    // requires every file on that list to record the signature itself, so an entry
    // here cannot buy a milestone without the fact.
    const offences: string[] = [];
    for (const file of MICRO_STAGE_FILES) {
      const src = stripComments(readFileSync(join(ROOT, file), 'utf8'));
      const allowed = ENTRY_TRUE_MAPPINGS[file] ?? {};
      for (const [stage, micro] of stageMicroPairs(src)) {
        if (micro === 'contract_signed' && stage !== 'contract_signed'
            && allowed[stage] !== micro) {
          offences.push(`${file}: ${stage} -> contract_signed`);
        }
      }
    }
    expect(offences, 'a stage selection is claiming the customer signed').toEqual([]);
  });

  it('🚨 the allow-list cannot admit a phase selection — the defect stays caught', () => {
    // The mutation that matters: if `installation: 'contract_signed'` came back in the
    // homeowner-stage route, the case above must still fail. Proven by construction
    // here rather than by trusting the loop, because the allow-list is now consulted.
    const homeownerRoute = 'app/api/projects/[id]/homeowner-stage/route.ts';
    const allowed = ENTRY_TRUE_MAPPINGS[homeownerRoute] ?? {};
    expect(allowed.installation,
      'the homeowner-stage route has been allow-listed to claim a signature from a '
      + 'phase selection — that is the original defect, restored',
    ).toBeUndefined();
    // And no file may be allow-listed for `contract_signed` unless it also records
    // the signature; the case above enforces that for the signature paths, so assert
    // the allow-list holds nothing else.
    const claimants = Object.entries(ENTRY_TRUE_MAPPINGS)
      .filter(([, pairs]) => Object.values(pairs).includes('contract_signed'))
      .map(([f]) => f)
      .sort();
    expect(claimants).toEqual([
      'app/api/proposals/[id]/sign/route.ts',   // the signature itself
      'lib/operations/pipelineMicroStage.ts',   // stage name IS the outcome
    ]);
  });
});
