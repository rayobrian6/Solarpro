#!/usr/bin/env python3
"""Wire writeMicroStage into app/api/admin/projects/[id]/route.ts set-stage handler"""

import sys

fpath = "app/api/admin/projects/[id]/route.ts"

with open(fpath, "r", encoding="utf-8") as f:
    src = f.read()

# 1. Add writeMicroStage import after existing imports
old_import = "import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';"
new_import = """import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { writeMicroStage } from '@/lib/microStage';"""

if old_import not in src:
    print("❌ Could not find rateLimiter import — no changes made")
    sys.exit(1)

src = src.replace(old_import, new_import, 1)
print("✅ Added writeMicroStage import")

# 2. Wire micro stage call after history insert, before the success return.
# Map homeowner_stage values to a sentinel micro stage representing admin override.
# We use a HOMEOWNER_TO_MICRO mapping: each homeowner stage maps to its terminal micro stage.

old_success = """      return NextResponse.json({
        success: true,
        project: updated[0],
      });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });"""

new_success = """      // \u2500\u2500 Write micro stage for admin-set homeowner_stage (non-fatal, fire-and-forget) \u2500
      // Maps homeowner_stage \u2192 representative micro stage so the audit log
      // reflects the manual override with consistent granularity.
      const HOMEOWNER_TO_MICRO_OVERRIDE: Partial<Record<string, import('@/lib/microStage').MicroStage>> = {
        lead_submitted:  'lead_created',
        under_review:    'bill_uploaded',
        site_survey:     'survey_submitted',
        design:          'layout_completed',
        proposal:        'proposal_sent',
        installation:    'install_started',
        completed:       'system_live',
      };
      const microOverride = HOMEOWNER_TO_MICRO_OVERRIDE[stage as string];
      if (microOverride) {
        void writeMicroStage(id, microOverride, adminId, {
          source: 'admin_set_stage',
          stage,
          note: safeNote,
        });
      }

      return NextResponse.json({
        success: true,
        project: updated[0],
      });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });"""

if old_success not in src:
    print("❌ Could not find success return block — no changes made")
    sys.exit(1)

src = src.replace(old_success, new_success, 1)
print("✅ Wired writeMicroStage after set-stage history insert")

with open(fpath, "w", encoding="utf-8") as f:
    f.write(src)

print("✅ File written successfully")