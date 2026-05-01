#!/usr/bin/env python3
"""
Phase A Step 3: Add @deprecated notices to V1 and V2 structural engines.
Inserts a deprecation banner right after the opening comment block header.
"""
import os
os.chdir('/workspace/Solarpro-git')

V1_OLD = (
    "// ============================================================\n"
    "// Structural Calculation Engine \u2014 ASCE 7-22 / NDS 2018\n"
    "// Full audit & correction \u2014 Phase 1-10\n"
    "// ============================================================\n"
)

V1_NEW = (
    "// ============================================================\n"
    "// Structural Calculation Engine \u2014 ASCE 7-22 / NDS 2018\n"
    "// Full audit & correction \u2014 Phase 1-10\n"
    "// ============================================================\n"
    "//\n"
    "// @deprecated  V1 \u2014 Superseded by structural-engine-v4.ts\n"
    "//              Used by: /api/engineering/structural, siteSurvey/engineeringIntegration, rules-engine\n"
    "//              Migration: update callers to use calculateStructuralV4() from structural-engine-v4.ts\n"
    "//              Retained for backward compatibility \u2014 do not add new features here\n"
    "//\n"
)

V2_OLD = (
    "// ============================================================\n"
    "// Structural Calculation Engine V2 \u2014 ASCE 7-22 / NDS 2018 / BCSI\n"
    "// Realistic residential rooftop solar structural analysis\n"
    "// ============================================================\n"
)

V2_NEW = (
    "// ============================================================\n"
    "// Structural Calculation Engine V2 \u2014 ASCE 7-22 / NDS 2018 / BCSI\n"
    "// Realistic residential rooftop solar structural analysis\n"
    "// ============================================================\n"
    "//\n"
    "// @deprecated  V2 \u2014 Superseded by structural-engine-v4.ts\n"
    "//              Used by: structural-resolver.ts (internal only, not a public API route)\n"
    "//              Migration: update structural-resolver to use V4 engine directly\n"
    "//              Retained for backward compatibility \u2014 do not add new features here\n"
    "//\n"
)

for path, old, new in [
    ('lib/structural-calc.ts', V1_OLD, V1_NEW),
    ('lib/structural-engine-v2.ts', V2_OLD, V2_NEW),
]:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    if old in content:
        content = content.replace(old, new, 1)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  {path}: @deprecated banner added OK")
    else:
        print(f"  {path}: header not found as expected — skipping")