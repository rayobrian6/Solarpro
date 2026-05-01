#!/usr/bin/env python3
"""
Fix the remaining StructuralIssue interface definitions in V2 and V3
that weren't caught by the first pass (they're further down in the file,
not adjacent to the type block).
"""
import os
os.chdir('/workspace/Solarpro-git')

INTERFACE_BLOCK = (
    "export interface StructuralIssue {\n"
    "  code: string;\n"
    "  message: string;\n"
    "  severity: 'error' | 'warning' | 'info';\n"
    "  suggestion?: string;\n"
    "}"
)

REPLACEMENT = "// StructuralIssue re-exported from structural/types.ts above"

for path in ['lib/structural-engine-v2.ts', 'lib/structural-engine-v3.ts']:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    if INTERFACE_BLOCK in content:
        content = content.replace(INTERFACE_BLOCK, REPLACEMENT)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  {path}: StructuralIssue interface removed OK")
    else:
        print(f"  {path}: interface block not found (may already be clean)")