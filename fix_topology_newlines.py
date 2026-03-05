#!/usr/bin/env python3
"""Fix literal newlines inside string literals in topology-engine.ts.
The Python patch script wrote actual \n characters inside TS string literals,
which breaks the TypeScript parser. Replace them with a space or remove them."""

import re

filepath = '/workspace/solarpro-v5/solarpro-v3.1/lib/topology-engine.ts'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# The problematic patterns are string literals like:
#   'ROOF RUN\n(DC Wiring)'  — where \n is a real newline
# We need to find these inside single-quoted strings and replace the newline with ' '

# Strategy: find all single-quoted string literals that span multiple lines
# and collapse the newline + leading whitespace into a single space

# Pattern: inside single quotes, find a newline followed by optional whitespace
# We'll do this carefully to avoid breaking other things

# Find patterns like: 'TEXT\n  MORE TEXT' and replace with 'TEXT MORE TEXT'
# Only within the appended section (after line 437)

lines = content.split('\n')

# Find where the appended section starts
append_start = 0
for i, line in enumerate(lines):
    if 'RUN_SEGMENT Topology Model' in line:
        append_start = i
        break

print(f"Appended section starts at line {append_start + 1}")

# Process lines from append_start onwards
# Look for lines that are continuations of broken string literals
# The pattern is: a line ending with a string that has no closing quote,
# followed by a line that starts with the rest of the string

fixed_lines = lines[:append_start]
i = append_start

while i < len(lines):
    current = lines[i]
    
    # Check if this line has an unclosed single-quoted string that contains
    # what should be \n (i.e., the string continues on the next line)
    # Simple heuristic: if a line has makeRunNode( with an odd number of single quotes
    # before the newline, it's a broken string
    
    # Better approach: just join lines that look like broken string continuations
    # A broken string continuation looks like:
    #   makeRunNode('ID', 'LABEL TEXT
    #   (more label)', order, {
    # The second line starts with whitespace then '(' or text then ')'
    
    # Check if current line ends mid-string (has makeRunNode with unclosed quote)
    if ("makeRunNode('" in current or "label: '" in current) and current.rstrip().endswith("'") == False:
        # Count single quotes - if odd, string is unclosed
        # But we need to be careful about escaped quotes
        stripped = current.rstrip()
        # Simple check: does the line contain an odd number of unescaped single quotes?
        quote_count = stripped.count("'")
        if quote_count % 2 == 1:
            # String is unclosed - join with next line
            if i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                # Join: replace the newline with a space
                joined = stripped + ' ' + next_line
                fixed_lines.append(joined)
                i += 2
                continue
    
    fixed_lines.append(current)
    i += 1

result = '\n'.join(fixed_lines)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(result)

print(f"Fixed. Total lines: {len(fixed_lines)}")