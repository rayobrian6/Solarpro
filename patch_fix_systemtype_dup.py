#!/usr/bin/env python3
"""Remove duplicate systemType declaration in proposals/page.tsx"""

FILE = 'app/proposals/page.tsx'

with open(FILE, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the second occurrence of "const systemType" (the duplicate from the old Equipment resolver block)
count = 0
dup_line = None
for i, line in enumerate(lines):
    if "const systemType" in line and "proj?.systemType" in line:
        count += 1
        if count == 2:
            dup_line = i
            break

print(f"Duplicate systemType at line {dup_line}: {lines[dup_line].rstrip() if dup_line else 'NOT FOUND'}")

if dup_line is not None:
    # Remove that line
    lines.pop(dup_line)
    with open(FILE, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print("Removed duplicate systemType line")
else:
    print("No duplicate found — nothing to do")