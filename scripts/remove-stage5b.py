#!/usr/bin/env python3
"""Remove STAGE 5b from bom-engine-v4.ts and replace with comment."""

import re

filepath = 'lib/bom-engine-v4.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the STAGE 5b block — from the comment to just before STAGE 6
# Pattern: from "STAGE 5b" comment through to "STAGE 6: MONITORING" comment
pattern = r'  // [\u2500\u2550]+ STAGE 5b.*?console\.log\(`\[V4 SYSTEM PROFILE\].*?\);\n  \}\n\n  // [\u2500\u2550]+ STAGE 6: MONITORING'

replacement = """  // STAGE 5b REMOVED (MASTER TASK): Structural items now handled by merge layer.
  // V4 engine owns ONLY electrical. Structural (fence/ground) is derived by
  // bom-system-profiles.ts and merged via bom-merge.ts mergeBOM() in the API route.
  // See: app/api/engineering/bom/route.ts

  // \u2500\u2500 STAGE 6: MONITORING"""

match = re.search(pattern, content, re.DOTALL)
if match:
    content = content[:match.start()] + replacement + content[match.end():]
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"SUCCESS: Removed STAGE 5b ({match.end() - match.start()} chars)")
else:
    print("ERROR: Could not find STAGE 5b block")
    # Debug: show what's around STAGE 5b
    idx = content.find('STAGE 5b')
    if idx >= 0:
        print(f"Found 'STAGE 5b' at position {idx}")
        print(repr(content[idx-50:idx+200]))
    else:
        print("'STAGE 5b' not found in file at all")