// ═══════════════════════════════════════════════════════════════════════════
// THE OPS PIPELINE MOVED AND THE CUSTOMER'S VIEW OF IT DID NOT
//
// `syncHomeownerStage` and `writeMicroStage` — the two writers behind everything
// the homeowner portal renders — were reachable from exactly ONE route:
// `app/api/projects/transition/route.ts`, whose own docblock calls it the
// authorised path and which has **ZERO UI callers**. Verified: the only reference
// to `projects/transition` anywhere in app/, lib/, components/ or hooks/ is a
// comment inside `lib/homeownerStageSync.ts`.
//
// Every real stage change arrives at `app/api/projects/update-status`, which
// wrote `project_status` and the legacy `status` and stopped. So an operator
// moved a job to `permit_submitted` and the homeowner's portal — which renders
// `homeowner_stage` and the micro-stage log, and deliberately never reads
// `project_status` — went on saying whatever it last said. The internal pipeline
// and the customer's view were two separate stories and only one was being told.
//
// 🚨 AND THE MAPPING TABLE CARRIES A DECISION THAT MUST SURVIVE BEING MOVED.
// `inspection` maps to NOTHING, on purpose: entering the inspection stage means
// an inspection is PENDING, and `writeMicroStage` forward-syncs the homeowner
// stage, so mapping it to `inspection_passed` would tell every customer their
// inspection had passed on the day it was merely booked. Wiring up the second
// route is exactly the change that would have shipped that, as a side effect.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PIPELINE_STAGE_TO_MICRO, microStageForPipelineStage,
} from '@/lib/operations/pipelineMicroStage';
import { PROJECT_PIPELINE } from '@/lib/operations/pipeline';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

describe('🚨 the stage a pipeline move records for the customer', () => {
  it('maps the stages that record a real event', () => {
    expect(microStageForPipelineStage('permit_submitted')).toBe('permit_submitted');
    expect(microStageForPipelineStage('permit_approved')).toBe('permit_approved');
    expect(microStageForPipelineStage('contract_signed')).toBe('contract_signed');
    expect(microStageForPipelineStage('installation')).toBe('install_started');
    expect(microStageForPipelineStage('complete')).toBe('system_live');
  });

  it('🚨 inspection records NOTHING — a stage entry is not an outcome', () => {
    // The single most important assertion in this file. If this ever returns a
    // value, every customer entering inspection is told it passed.
    expect(microStageForPipelineStage('inspection')).toBeNull();
    expect('inspection' in PIPELINE_STAGE_TO_MICRO).toBe(false);
  });

  it('never maps any stage to inspection_passed', () => {
    // The generalisation: no stage ENTRY may claim an inspection outcome, however
    // the table is later edited.
    expect(Object.values(PIPELINE_STAGE_TO_MICRO)).not.toContain('inspection_passed');
  });

  it('an unknown stage maps to nothing rather than guessing', () => {
    expect(microStageForPipelineStage('not_a_stage')).toBeNull();
    expect(microStageForPipelineStage('')).toBeNull();
  });

  it('every mapped key is a real pipeline stage', () => {
    // A key that is not a stage can never fire, which is a silent no-op dressed
    // as coverage.
    for (const key of Object.keys(PIPELINE_STAGE_TO_MICRO)) {
      expect(PROJECT_PIPELINE as readonly string[], `'${key}' is not a pipeline stage`)
        .toContain(key);
    }
  });
});

describe('🚨 the route the UI actually calls advances the customer view', () => {
  // SOURCE GUARDS, said plainly: both routes need a database, an authenticated
  // request and the two stage tables, so the wiring cannot be driven here. The
  // MAPPING above is pure and is tested behaviourally; these cover the wiring.
  const updateStatus = () => read('app', 'api', 'projects', 'update-status', 'route.ts');
  const transition = () => read('app', 'api', 'projects', 'transition', 'route.ts');

  it('update-status syncs the homeowner stage', () => {
    const src = updateStatus();
    expect(src, 'the route every UI calls still does not advance homeowner_stage')
      .toMatch(/await syncHomeownerStage\(/);
  });

  it('update-status writes the micro-stage', () => {
    expect(updateStatus(), 'the route every UI calls still records no micro-stage')
      .toMatch(/await writeMicroStage\(/);
  });

  it('🚨 and both are NON-FATAL — a stage change must not fail on them', () => {
    // `homeowner_stage` and `project_micro_stages` are created only by migrations
    // in the directory the runner does not scan, so they may not exist at all.
    // Making the hot path depend on them would turn a schema gap into an outage.
    const src = updateStatus();
    const at = src.indexOf('await syncHomeownerStage(');
    const before = src.slice(Math.max(0, at - 400), at);
    expect(before, 'syncHomeownerStage is not wrapped — a missing table would fail the stage change')
      .toMatch(/try\s*\{/);
  });

  it('🚨 there is ONE mapping table, not one per route', () => {
    // Two routes needing the same map is how this codebase grew five copies of
    // NEC 310.16. Neither route may declare its own.
    for (const [name, src] of [['update-status', updateStatus()], ['transition', transition()]] as const) {
      expect(src, `${name} declares its own stage→micro-stage map again`)
        .not.toMatch(/PIPELINE_STAGE_TO_MICRO\s*:\s*Partial<Record/);
    }
    expect(transition(), 'the transition route no longer reads the shared map')
      .toMatch(/microStageForPipelineStage\(/);
  });
});
