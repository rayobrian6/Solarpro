#!/usr/bin/env python3
"""Wire writeMicroStage(survey_submitted) into lib/survey/ingest/ingestPipeline.ts"""

import sys

fpath = "lib/survey/ingest/ingestPipeline.ts"

with open(fpath, "r", encoding="utf-8") as f:
    src = f.read()

# 1. Add import at the top (after the last existing import line)
old_import = "import { getDbReady, createSiteSurvey, bulkAddSiteSurveyFiles, isValidUUID } from '@/lib/db-neon';"

new_import = """import { getDbReady, createSiteSurvey, bulkAddSiteSurveyFiles, isValidUUID } from '@/lib/db-neon';
import { writeMicroStage } from '@/lib/microStage';"""

if old_import not in src:
    print("❌ Could not find import anchor — no changes made")
    sys.exit(1)

src = src.replace(old_import, new_import, 1)
print("✅ Added writeMicroStage import")

# 2. Wire micro stage call just before the final `return { status: 'ingested', ... }`
# We insert between the vision pipeline block and the return statement.

old_return = "  return {\n    status: 'ingested',\n    projectId,\n    created,\n    transformSummary,\n    durationMs,\n  };"

new_return = """  // \u2500\u2500 Write micro stage: survey_submitted (non-fatal, fire-and-forget) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  void writeMicroStage(projectId, 'survey_submitted', ownerId ?? null, {
    survey_id: event.survey_id,
    event_id: event.event_id,
    deliveryId,
    created,
  });

  return {
    status: 'ingested',
    projectId,
    created,
    transformSummary,
    durationMs,
  };"""

if old_return not in src:
    print("❌ Could not find return block — no changes made")
    sys.exit(1)

src = src.replace(old_return, new_return, 1)
print("✅ Wired writeMicroStage('survey_submitted') before return")

with open(fpath, "w", encoding="utf-8") as f:
    f.write(src)

print("✅ File written successfully")