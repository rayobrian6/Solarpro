#!/usr/bin/env python3
"""Activate sungrow-sg5rs, sg7.6rs, sg10rs — keep sg15rs inactive."""

import re

with open('lib/equipment-db.ts', 'r') as f:
    lines = f.readlines()

# Lines to activate (1-indexed): 576, 853, 876
# Line 899 = sg15rs — keep inactive
activate_lines = {576, 853, 876}

changed = 0
for i, line in enumerate(lines):
    lineno = i + 1
    if lineno in activate_lines:
        if "active: false" in line and "Sungrow has no US residential catalog" in line:
            lines[i] = line.replace(
                "active: false, // v47.404: Sungrow has no US residential catalog; deactivated pending SKU confirmation",
                "active: true, // v61.10: Sungrow RS models activated — UL 1741 listed, available via Sungrow US distributors"
            )
            changed += 1
            print(f"  Line {lineno}: activated")

print(f"Total lines changed: {changed}")

with open('lib/equipment-db.ts', 'w') as f:
    f.writelines(lines)