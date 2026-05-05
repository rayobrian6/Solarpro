#!/usr/bin/env python3
"""
Phase 4.12 Part 1 — Convert void writeMicroStage -> await for critical events.
Uses direct string replacement rather than regex to avoid grouping issues.
"""

import sys

CRITICAL_STAGES = [
    'bill_uploaded', 'bill_parsed', 'survey_submitted', 'survey_reviewed',
    'layout_completed', 'engineering_completed', 'proposal_sent', 'contract_signed',
    'install_started', 'install_completed', 'inspection_passed', 'pto_approved',
    'survey_scheduled', 'permit_submitted', 'permit_approved',
    'pto_submitted', 'system_live',
]

# Files to process (admin override intentionally excluded - non-critical manual action)
FILES = [
    "app/api/portal/bill-upload/route.ts",
    "lib/survey/ingest/ingestPipeline.ts",
    "app/api/projects/transition/route.ts",
]

total_changes = 0

for fpath in FILES:
    with open(fpath, "r", encoding="utf-8") as f:
        src = f.read()

    orig = src
    file_changes = 0

    for stage in CRITICAL_STAGES:
        # Standard pattern: void writeMicroStage(projectId, 'stage',
        needle = "void writeMicroStage(projectId, '" + stage + "'"
        if needle in src:
            src = src.replace(needle, "await writeMicroStage(projectId, '" + stage + "'")
            file_changes += 1
            print("  CHANGED " + fpath + ": void->await '" + stage + "'")

    if src != orig:
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(src)
        print("  WRITTEN " + fpath + " (" + str(file_changes) + " change(s))")
        total_changes += file_changes
    else:
        print("  NO_CHANGE " + fpath + ": no void critical literal calls found")

# Special: transition route uses a variable 'mappedMicro' not a string literal
# This call covers ALL stages in PIPELINE_STAGE_TO_MICRO (all critical) - must await
fpath2 = "app/api/projects/transition/route.ts"
with open(fpath2, "r", encoding="utf-8") as f:
    src2 = f.read()

old_call = "      void writeMicroStage(projectId, mappedMicro, user.id ?? null, {"
new_call = "      await writeMicroStage(projectId, mappedMicro, user.id ?? null, {"
if old_call in src2:
    src2 = src2.replace(old_call, new_call, 1)
    with open(fpath2, "w", encoding="utf-8") as f:
        f.write(src2)
    print("  CHANGED transition/route.ts: void->await mappedMicro call")
    total_changes += 1
else:
    # Already converted or different indentation
    if "await writeMicroStage(projectId, mappedMicro" in src2:
        print("  ALREADY_AWAITED transition/route.ts: mappedMicro call")
    else:
        print("  NOT_FOUND transition/route.ts: mappedMicro call not found")

print("\nDONE: " + str(total_changes) + " total void->await conversions")