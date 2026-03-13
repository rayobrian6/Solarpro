#!/usr/bin/env python3
"""
Safe script to add `export const runtime = 'nodejs';` to all API route files
that are missing it. Inserts after `export const dynamic = 'force-dynamic';`
if present, otherwise inserts at the very top of the file.
"""

import os
import glob

RUNTIME_LINE = "export const runtime = 'nodejs';\n"
DYNAMIC_LINE = "export const dynamic = 'force-dynamic';"

repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
routes = glob.glob(os.path.join(repo_root, 'app/api/**/*.ts'), recursive=True)
routes = [r for r in routes if r.endswith('route.ts')]
routes.sort()

already_has = 0
modified = 0
errors = []

for route_path in routes:
    try:
        with open(route_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Skip if already has runtime = 'nodejs'
        if "runtime = 'nodejs'" in content or 'runtime = "nodejs"' in content:
            already_has += 1
            continue

        lines = content.split('\n')

        # Find insertion point: after `export const dynamic = 'force-dynamic';`
        insert_after = -1
        for i, line in enumerate(lines):
            if line.strip().startswith("export const dynamic") and "force-dynamic" in line:
                insert_after = i
                break

        if insert_after >= 0:
            # Insert runtime line right after the dynamic line
            lines.insert(insert_after + 1, "export const runtime = 'nodejs';")
        else:
            # No dynamic line found — insert at top
            lines.insert(0, "export const runtime = 'nodejs';")

        new_content = '\n'.join(lines)

        with open(route_path, 'w', encoding='utf-8') as f:
            f.write(new_content)

        rel_path = os.path.relpath(route_path, repo_root)
        print(f"  ADDED: {rel_path}")
        modified += 1

    except Exception as e:
        errors.append(f"ERROR: {route_path}: {e}")

print(f"\n{'='*60}")
print(f"Already had runtime = 'nodejs': {already_has}")
print(f"Modified (added runtime):       {modified}")
print(f"Errors:                         {len(errors)}")
for e in errors:
    print(f"  {e}")