#!/usr/bin/env python3
"""Wire writeMicroStage calls into app/api/projects/transition/route.ts"""

import sys

fpath = "app/api/projects/transition/route.ts"

with open(fpath, "r", encoding="utf-8") as f:
    src = f.read()

# 1. Add writeMicroStage to import block
old_import = "import { syncHomeownerStage } from '@/lib/homeownerStageSync';"
new_import = """import { syncHomeownerStage } from '@/lib/homeownerStageSync';
import { writeMicroStage, type MicroStage } from '@/lib/microStage';"""

if old_import not in src:
    print("❌ Could not find syncHomeownerStage import — no changes made")
    sys.exit(1)

src = src.replace(old_import, new_import, 1)
print("✅ Added writeMicroStage import")

# 2. Add micro stage mapping constant + wire call after syncHomeownerStage block.
# Target: the syncHomeownerStage try/catch block, then the commands/generate block.
# We insert a new non-fatal block between them.

old_sync_block = """    // \u2500\u2500 Auto-advance homeowner_stage (non-fatal) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    try {
      await syncHomeownerStage(projectId, newStage, user.id ?? null);
    } catch {
      // Non-fatal \u2014 handled inside syncHomeownerStage
    }"""

new_sync_block = """    // \u2500\u2500 Auto-advance homeowner_stage (non-fatal) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    try {
      await syncHomeownerStage(projectId, newStage, user.id ?? null);
    } catch {
      // Non-fatal \u2014 handled inside syncHomeownerStage
    }

    // \u2500\u2500 Write micro stage (non-fatal, fire-and-forget) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Maps DEAL_TRANSITIONS newStage values to the corresponding micro stage.
    // Only fires for forward-moving, meaningful pipeline events.
    const PIPELINE_STAGE_TO_MICRO: Partial<Record<string, MicroStage>> = {
      site_assessment:  'survey_scheduled',
      design_complete:  'layout_completed',
      proposal_sent:    'proposal_sent',
      contract_signed:  'contract_signed',
      engineering:      'engineering_started',
      permit_submitted: 'permit_submitted',
      permit_approved:  'permit_approved',
      install_scheduled:'install_scheduled',
      installation:     'install_started',
      inspection:       'inspection_passed',
      pto:              'pto_submitted',
      complete:         'system_live',
    };
    const mappedMicro = PIPELINE_STAGE_TO_MICRO[newStage];
    if (mappedMicro) {
      void writeMicroStage(projectId, mappedMicro, user.id ?? null, {
        action,
        from_stage: prevStage,
        to_stage: newStage,
      });
    }"""

if old_sync_block not in src:
    print("❌ Could not find syncHomeownerStage block — no changes made")
    sys.exit(1)

src = src.replace(old_sync_block, new_sync_block, 1)
print("✅ Wired PIPELINE_STAGE_TO_MICRO + writeMicroStage after syncHomeownerStage")

with open(fpath, "w", encoding="utf-8") as f:
    f.write(src)

print("✅ File written successfully")