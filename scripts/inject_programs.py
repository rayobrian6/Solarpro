#!/usr/bin/env python3
"""
inject_programs.py — v48.28
Injects generated utility program additions into lib/utilityPrograms.ts
"""

import re

TARGET = 'lib/utilityPrograms.ts'
TOU_FILE = 'scripts/tou_additions.ts'
BATTERY_SOLAR_FILE = 'scripts/battery_solar_additions.ts'
NEM_FILE = 'scripts/nem_additions.ts'

# ── Read source files ──────────────────────────────────────────────────────────

with open(TARGET, 'r', encoding='utf-8') as f:
    original = f.read()

with open(TOU_FILE, 'r', encoding='utf-8') as f:
    tou_content = f.read()

with open(BATTERY_SOLAR_FILE, 'r', encoding='utf-8') as f:
    bs_content = f.read()

with open(NEM_FILE, 'r', encoding='utf-8') as f:
    nem_content = f.read()

# ── Split battery_solar_additions.ts into battery vs solar sections ─────────────
# The solar rebate section begins at "// v48.28 EXPANSION — Solar Rebate Programs"
SOLAR_DIVIDER = '// v48.28 EXPANSION \u2014 Solar Rebate Programs'
divider_pos = bs_content.find(SOLAR_DIVIDER)
if divider_pos == -1:
    raise ValueError("Could not find Solar Rebate Programs divider in battery_solar_additions.ts")

# Everything before the divider (minus the box-line above it) = battery entries
# Everything from divider onwards = solar rebate entries
# Find the start of the ═══ box line before the divider
box_before_solar = bs_content.rfind('  // \u2550', 0, divider_pos)
battery_section = bs_content[:box_before_solar].rstrip()
solar_section = bs_content[box_before_solar:].strip()

print(f"TOU additions: {len(tou_content.splitlines())} lines")
print(f"Battery section: {len(battery_section.splitlines())} lines")
print(f"Solar section: {len(solar_section.splitlines())} lines")
print(f"NEM additions: {len(nem_content.splitlines())} lines")

# ── Verify injection anchors exist ─────────────────────────────────────────────

# We look for the closing ]; of each array.
# Strategy: find the 4 occurrences of ^]; in the file (they are at lines 856, 1040, 1121, 1245)
# and inject before each one.

lines = original.split('\n')

# Find all line indices (0-based) where the line is exactly "];"
closing_bracket_lines = [i for i, line in enumerate(lines) if line.strip() == '];']
print(f"\nFound ]; at line numbers (1-based): {[i+1 for i in closing_bracket_lines]}")

if len(closing_bracket_lines) < 4:
    raise ValueError(f"Expected at least 4 ]; lines, found {len(closing_bracket_lines)}")

# The arrays are in order: TOU_RATE_PLANS, BATTERY_INCENTIVE_PROGRAMS, SOLAR_REBATE_PROGRAMS, NEM_SPECIAL_PROGRAMS
# Take the first 4 closing brackets
tou_close_idx = closing_bracket_lines[0]
bat_close_idx = closing_bracket_lines[1]
sol_close_idx = closing_bracket_lines[2]
nem_close_idx = closing_bracket_lines[3]

print(f"TOU close at line {tou_close_idx+1}")
print(f"Battery close at line {bat_close_idx+1}")
print(f"Solar close at line {sol_close_idx+1}")
print(f"NEM close at line {nem_close_idx+1}")

# ── Build new file by injecting before each closing bracket ────────────────────
# We need to inject in REVERSE order to keep line indices valid

# Convert to list for mutation
new_lines = lines[:]

# Helper to insert content before a given line index
def insert_before(line_list, idx, content_str):
    content_lines = content_str.split('\n')
    # Remove trailing empty line if present
    while content_lines and content_lines[-1].strip() == '':
        content_lines.pop()
    # Insert at idx
    for i, cl in enumerate(content_lines):
        line_list.insert(idx + i, cl)
    return len(content_lines)

# Inject in reverse order (NEM → Solar → Battery → TOU) to preserve indices
# NEM
shift = insert_before(new_lines, nem_close_idx, nem_content)
print(f"Injected {shift} NEM lines before line {nem_close_idx+1}")

# Solar (nem_close_idx has shifted by `shift`, but sol_close_idx hasn't changed yet)
shift2 = insert_before(new_lines, sol_close_idx, solar_section)
print(f"Injected {shift2} Solar lines before line {sol_close_idx+1}")

# Battery
shift3 = insert_before(new_lines, bat_close_idx, battery_section)
print(f"Injected {shift3} Battery lines before line {bat_close_idx+1}")

# TOU
shift4 = insert_before(new_lines, tou_close_idx, tou_content)
print(f"Injected {shift4} TOU lines before line {tou_close_idx+1}")

# ── Write output ───────────────────────────────────────────────────────────────
result = '\n'.join(new_lines)

with open(TARGET, 'w', encoding='utf-8') as f:
    f.write(result)

print(f"\n✅ Done! {TARGET} expanded from {len(lines)} → {len(new_lines)} lines")
print(f"   Total injected: {shift + shift2 + shift3 + shift4} lines")
