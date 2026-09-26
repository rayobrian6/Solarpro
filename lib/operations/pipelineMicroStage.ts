/**
 * lib/operations/pipelineMicroStage.ts
 *
 * ONE MAP FROM THE OPS PIPELINE STAGE TO THE CUSTOMER-FACING MICRO-STAGE.
 *
 * 🚨 WHY IT IS ITS OWN MODULE. This table used to live inside
 * `app/api/projects/transition/route.ts` — a route whose own docblock calls
 * itself the authorised path and which has **ZERO UI callers**. Every real stage
 * change in the product goes through `app/api/projects/update-status/route.ts`,
 * which wrote `project_status` and the legacy `status` and nothing else. So the
 * internal 13-stage pipeline advanced while `homeowner_stage` and the
 * `project_micro_stages` log — the two things the customer portal renders — did
 * not move at all. An operator marked a job `permit_submitted`; the homeowner's
 * portal went on saying whatever it last said.
 *
 * Wiring the second route up meant either importing this map or copying it, and
 * a copied mapping table is how this codebase produced five copies of NEC 310.16
 * and four of the ambient-correction ladder in a single week. So it lives here,
 * once, and both routes read it.
 */
import type { MicroStage } from '@/lib/microStage';

/**
 * Forward-moving, meaningful pipeline events only.
 *
 * 🚨 `inspection` DELIBERATELY MAPS TO NOTHING, and this is the load-bearing
 * entry in the table — moved here verbatim with its reasoning, because a future
 * editor filling in the "gap" would ship the exact defect it prevents.
 *
 * Every other entry records something that HAS happened on entering the stage:
 * entering `installation` means the install started, entering `pto` means PTO
 * was submitted. Entering `inspection` means an inspection is PENDING — it does
 * not mean it passed, and roughly the whole point of an inspection is that it
 * can fail.
 *
 * `writeMicroStage` also forward-syncs `homeowner_stage`, and the homeowner
 * portal renders micro-stages as milestones. So every project entering
 * inspection would have told its homeowner the inspection had PASSED. That is a
 * lie the customer acts on, and it would arrive as a side effect of fixing
 * something else.
 *
 * There is no `inspection_scheduled` in the 34-value vocabulary, and inventing
 * one is a vocabulary decision rather than a bug fix. Writing nothing is the
 * honest option: a stage entry is not an outcome, and `inspection_passed`
 * remains available to whatever observes a real pass.
 */
export const PIPELINE_STAGE_TO_MICRO: Partial<Record<string, MicroStage>> = {
  site_assessment:   'survey_scheduled',
  design_complete:   'layout_completed',
  proposal_sent:     'proposal_sent',
  contract_signed:   'contract_signed',
  engineering:       'engineering_started',
  permit_submitted:  'permit_submitted',
  permit_approved:   'permit_approved',
  install_scheduled: 'install_scheduled',
  installation:      'install_started',
  // inspection: deliberately absent — see above.
  pto:               'pto_submitted',
  complete:          'system_live',
};

/** The micro-stage a pipeline stage records on entry, or null when it records none. */
export function microStageForPipelineStage(stage: string): MicroStage | null {
  return PIPELINE_STAGE_TO_MICRO[stage] ?? null;
}
