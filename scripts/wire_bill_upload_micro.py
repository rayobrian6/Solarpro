#!/usr/bin/env python3
"""Wire writeMicroStage calls into portal/bill-upload/route.ts"""

import sys

fpath = "app/api/portal/bill-upload/route.ts"

with open(fpath, "r", encoding="utf-8") as f:
    src = f.read()

# Insert micro stage calls after the fallback save block, before stage advance block.
# We find the stage advance comment block and insert before it.

old_block = "    // \u2500\u2500 Advance stage: lead_submitted \u2192 under_review"

new_insert = """    // \u2500\u2500 Write micro stages: bill_uploaded + bill_parsed \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Non-fatal: always fire-and-forget (writeMicroStage handles retries internally)
    void writeMicroStage(projectId, 'bill_uploaded', session.clientId, {
      uploadedVia: 'portal',
      fileType: file.type,
    });
    void writeMicroStage(projectId, 'bill_parsed', session.clientId, {
      utilityProvider: billData.utilityProvider ?? null,
      monthlyKwh:      billData.monthlyKwh ?? null,
      annualKwh:       billData.annualKwh ?? null,
      confidence:      billData.confidence ?? null,
    });

    // \u2500\u2500 Advance stage: lead_submitted \u2192 under_review"""

if old_block in src:
    src = src.replace(old_block, new_insert, 1)
    print("✅ Injected writeMicroStage calls (bill_uploaded + bill_parsed)")
else:
    print("❌ Could not find target block — no changes made")
    sys.exit(1)

with open(fpath, "w", encoding="utf-8") as f:
    f.write(src)

print("✅ File written successfully")