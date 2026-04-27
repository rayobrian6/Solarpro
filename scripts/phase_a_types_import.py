#!/usr/bin/env python3
"""
Phase A: Replace inline type definitions in all 4 structural engine files
with imports from lib/structural/types.ts.
"""

import re

TYPES_PATH = 'lib/structural/types.ts'

# ─────────────────────────────────────────────────────────────
# V1: structural-calc.ts
# Replace 3 export type lines (lines 17-19) with import + re-exports
# ─────────────────────────────────────────────────────────────
def fix_v1():
    path = 'lib/structural-calc.ts'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    old = (
        "export type WindExposureCategory = 'B' | 'C' | 'D';\n"
        "export type RoofType = 'shingle' | 'tile' | 'metal_standing_seam' | 'metal_corrugated' | 'flat_tpo' | 'flat_epdm' | 'flat_gravel';\n"
        "export type RafterSpecies = 'Douglas Fir-Larch' | 'Southern Pine' | 'Hem-Fir' | 'Spruce-Pine-Fir';"
    )

    new = (
        "// ── Types: imported from canonical source ─────────────────────────────────\n"
        "// @deprecated V1 engine — use structural-engine-v4.ts for new code\n"
        "export type {\n"
        "  WindExposure,\n"
        "  WindExposureCategory,   // alias for WindExposure — backward compat\n"
        "  RoofType,\n"
        "  WoodSpecies,\n"
        "  RafterSpecies,          // alias for WoodSpecies — backward compat\n"
        "  StructuralIssue,\n"
        "} from './structural/types';"
    )

    if old not in content:
        print(f"  ERROR: V1 target string not found in {path}")
        return False

    content = content.replace(old, new)

    # Also replace the StructuralIssue interface definition in V1
    old_issue = (
        "export interface StructuralIssue {\n"
        "  code: string;\n"
        "  severity: 'error' | 'warning' | 'info';\n"
        "  message: string;\n"
        "  value?: number | string;\n"
        "  limit?: number | string;\n"
        "  reference?: string;\n"
        "  suggestion?: string;\n"
        "}"
    )
    new_issue = (
        "// StructuralIssue re-exported from structural/types.ts above"
    )
    if old_issue in content:
        content = content.replace(old_issue, new_issue)
        print(f"  V1: replaced StructuralIssue interface")
    else:
        print(f"  WARNING: V1 StructuralIssue interface not found as expected — skipping")

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"  V1: done")
    return True


# ─────────────────────────────────────────────────────────────
# V2: structural-engine-v2.ts
# Replace 6 export type lines + StructuralIssue interface
# ─────────────────────────────────────────────────────────────
def fix_v2():
    path = 'lib/structural-engine-v2.ts'
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Find the TYPES section header and the type definitions
    # They start right after the section divider comment
    new_lines = []
    i = 0
    types_replaced = False
    issue_replaced = False

    while i < len(lines):
        line = lines[i]

        # Replace the 6 type definition lines (they're contiguous after the TYPES header)
        if (not types_replaced and
            line.strip() == "export type WindExposureCategory = 'B' | 'C' | 'D';"):
            # Check next 5 lines are the other type defs
            block = [lines[i+j].rstrip('\n') for j in range(6)]
            expected = [
                "export type WindExposureCategory = 'B' | 'C' | 'D';",
                "export type RoofType = 'shingle' | 'tile' | 'metal_standing_seam' | 'metal_corrugated' | 'flat_tpo' | 'flat_epdm' | 'flat_gravel';",
                "export type FramingType = 'truss' | 'rafter' | 'unknown';",
                "export type RafterSpecies = 'Douglas Fir-Larch' | 'Southern Pine' | 'Hem-Fir' | 'Spruce-Pine-Fir';",
                "export type RoofZone = 'interior' | 'edge' | 'corner';",
                "export type PanelOrientation = 'portrait' | 'landscape';",
            ]
            if block == expected:
                new_lines.append(
                    "// ── Types: imported from canonical source ─────────────────────────────────\n"
                    "// @deprecated V2 engine — use structural-engine-v4.ts for new code\n"
                    "export type {\n"
                    "  WindExposure,\n"
                    "  WindExposureCategory,   // alias — backward compat\n"
                    "  RoofType,\n"
                    "  FramingType,\n"
                    "  WoodSpecies,\n"
                    "  RafterSpecies,          // alias — backward compat\n"
                    "  RoofZone,\n"
                    "  PanelOrientation,\n"
                    "  StructuralIssue,\n"
                    "} from './structural/types';\n"
                )
                i += 6
                types_replaced = True
                print(f"  V2: replaced 6 type definitions")
                continue
            else:
                print(f"  WARNING: V2 type block mismatch at line {i+1}")

        # Replace StructuralIssue interface
        if (not issue_replaced and
            line.strip() == "export interface StructuralIssue {"):
            # Check it's the 4-line version
            block = [lines[i+j].rstrip('\n') for j in range(5)]
            if (block[1].strip() == "code: string;" and
                block[4].strip() == "}"):
                new_lines.append("// StructuralIssue re-exported from structural/types.ts above\n")
                i += 5
                issue_replaced = True
                print(f"  V2: replaced StructuralIssue interface")
                continue

        new_lines.append(line)
        i += 1

    if not types_replaced:
        print(f"  ERROR: V2 type block not found")
        return False

    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f"  V2: done")
    return True


# ─────────────────────────────────────────────────────────────
# V3: structural-engine-v3.ts
# Replace 4 export type lines + StructuralIssue interface
# ─────────────────────────────────────────────────────────────
def fix_v3():
    path = 'lib/structural-engine-v3.ts'
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    i = 0
    types_replaced = False
    issue_replaced = False

    while i < len(lines):
        line = lines[i]

        # V3 type block — 4 lines
        if (not types_replaced and
            "export type WindExposure = 'B' | 'C' | 'D';" in line):
            block = [lines[i+j].rstrip('\n') for j in range(4)]
            expected = [
                "export type WindExposure = 'B' | 'C' | 'D';",
                "export type FramingType  = 'truss' | 'rafter' | 'unknown';",
                "export type RoofZone     = 'interior' | 'edge' | 'corner';",
                "export type WoodSpecies  = 'Douglas Fir-Larch' | 'Southern Pine' | 'Hem-Fir' | 'Spruce-Pine-Fir';",
            ]
            if block == expected:
                new_lines.append(
                    "// ── Types: imported from canonical source ─────────────────────────────────\n"
                    "export type {\n"
                    "  WindExposure,\n"
                    "  WindExposureCategory,   // alias — backward compat\n"
                    "  FramingType,\n"
                    "  RoofZone,\n"
                    "  WoodSpecies,\n"
                    "  RafterSpecies,          // alias — backward compat\n"
                    "  StructuralIssue,\n"
                    "} from './structural/types';\n"
                )
                i += 4
                types_replaced = True
                print(f"  V3: replaced 4 type definitions")
                continue
            else:
                print(f"  WARNING: V3 type block mismatch — found: {block}")

        # Replace StructuralIssue interface (4-line version same as V2)
        if (not issue_replaced and
            line.strip() == "export interface StructuralIssue {"):
            block = [lines[i+j].rstrip('\n') for j in range(5)]
            if (block[1].strip() == "code: string;" and
                block[4].strip() == "}"):
                new_lines.append("// StructuralIssue re-exported from structural/types.ts above\n")
                i += 5
                issue_replaced = True
                print(f"  V3: replaced StructuralIssue interface")
                continue

        new_lines.append(line)
        i += 1

    if not types_replaced:
        print(f"  ERROR: V3 type block not found")
        return False

    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f"  V3: done")
    return True


# ─────────────────────────────────────────────────────────────
# V4: structural-engine-v4.ts
# Replace 5 export type lines + StructuralIssue interface
# ─────────────────────────────────────────────────────────────
def fix_v4():
    path = 'lib/structural-engine-v4.ts'
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    i = 0
    types_replaced = False
    issue_replaced = False

    while i < len(lines):
        line = lines[i]

        # V4 type block — 5 lines
        if (not types_replaced and
            "export type InstallationType = " in line):
            block = [lines[i+j].rstrip('\n') for j in range(5)]
            expected = [
                "export type InstallationType = 'roof_residential' | 'roof_commercial' | 'commercial_ballasted' | 'ground_mount' | 'tracker' | 'carport';",
                "export type FramingType = 'truss' | 'rafter' | 'unknown';",
                "export type WoodSpecies = 'Douglas Fir-Larch' | 'Southern Pine' | 'Hem-Fir' | 'Spruce-Pine-Fir';",
                "export type WindExposure = 'B' | 'C' | 'D';",
                "export type RoofZone = 'interior' | 'edge' | 'corner';",
            ]
            if block == expected:
                new_lines.append(
                    "// ── Types: imported from canonical source ─────────────────────────────────\n"
                    "export type {\n"
                    "  InstallationType,\n"
                    "  WindExposure,\n"
                    "  WindExposureCategory,   // alias — backward compat\n"
                    "  FramingType,\n"
                    "  WoodSpecies,\n"
                    "  RafterSpecies,          // alias — backward compat\n"
                    "  RoofZone,\n"
                    "  PanelOrientation,\n"
                    "  StructuralIssue,\n"
                    "} from './structural/types';\n"
                )
                i += 5
                types_replaced = True
                print(f"  V4: replaced 5 type definitions")
                continue
            else:
                print(f"  WARNING: V4 type block mismatch — found: {block}")

        # Replace StructuralIssue interface (V4's 6-line version)
        if (not issue_replaced and
            line.strip() == "export interface StructuralIssue {"):
            # Find closing brace
            j = i + 1
            while j < len(lines) and lines[j].strip() != "}":
                j += 1
            new_lines.append("// StructuralIssue re-exported from structural/types.ts above\n")
            i = j + 1
            issue_replaced = True
            print(f"  V4: replaced StructuralIssue interface")
            continue

        new_lines.append(line)
        i += 1

    if not types_replaced:
        print(f"  ERROR: V4 type block not found")
        return False

    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f"  V4: done")
    return True


if __name__ == '__main__':
    import os
    os.chdir('/workspace/Solarpro-git')

    print("Phase A — replacing inline type definitions with imports from structural/types.ts")
    print()

    results = {
        'V1': fix_v1(),
        'V2': fix_v2(),
        'V3': fix_v3(),
        'V4': fix_v4(),
    }

    print()
    print("Results:")
    for k, v in results.items():
        print(f"  {k}: {'OK' if v else 'FAILED'}")

    all_ok = all(results.values())
    print()
    print("All OK!" if all_ok else "SOME FAILURES — check output above")
    exit(0 if all_ok else 1)