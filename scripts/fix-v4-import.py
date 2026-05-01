#!/usr/bin/env python3
"""Fix the import in bom-engine-v4.ts after STAGE 5b removal."""

filepath = 'lib/bom-engine-v4.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

old_import = "import { deriveStructuralBOM, type StructuralBOMItem, type BOMSystemType } from './bom-system-profiles';"
new_import = "// MASTER TASK: deriveStructuralBOM removed from V4 — now called in API route merge layer\nimport { type BOMSystemType } from './bom-system-profiles';"

if old_import in content:
    content = content.replace(old_import, new_import)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: Updated import")
else:
    print("ERROR: Import not found")