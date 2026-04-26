#!/usr/bin/env python3
"""
Fix <select> elements that got eng-input class — they should be eng-select.
Uses line-by-line context: if a <select tag is on the previous non-whitespace line,
change className="eng-input" to className="eng-select".
"""

TARGET = 'app/engineering/page.tsx'

with open(TARGET, 'r', encoding='utf-8') as f:
    lines = f.readlines()

changed = 0
# Track whether we're "inside" a <select ... > block that hasn't closed yet
in_select = False

for i, line in enumerate(lines):
    stripped = line.strip()
    
    # Detect opening of a <select element
    if '<select' in line and not '</select' in line:
        in_select = True
    
    # While in a select, if we see eng-input, replace with eng-select
    if in_select and 'className="eng-input"' in line:
        lines[i] = line.replace('className="eng-input"', 'className="eng-select"')
        changed += 1
    
    # Also handle multi-line: className="eng-input" on same line as <select
    if '<select' in line and 'className="eng-input"' in line:
        lines[i] = lines[i].replace('className="eng-input"', 'className="eng-select"')
        changed += 1  # might double-count but replace is idempotent
    
    # Detect close of select element
    if '</select>' in line or (in_select and stripped.endswith('>')):
        # A /> or > closes the opening tag but not necessarily the element
        # Simple heuristic: if line has > and we were tracking select
        if '>' in line and not '<select' in line:
            in_select = False

with open(TARGET, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f"✅ Fixed {changed} select elements: eng-input → eng-select")