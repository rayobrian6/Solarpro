#!/usr/bin/env python3
"""Apply resolveSegY() to all wireSeg calls in the main render function."""

with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the main render function body (after renderSLDProfessional)
# We need to replace wireSeg calls that use a fixed Y with resolveSegY-wrapped Y

import re

# Pattern: wireSeg(x1, x2, BUS_Y, lines, opts)
# Replace with: wireSeg(x1, x2, resolveSegY(x1, x2, BUS_Y), lines, opts)
# But we need to handle variable names too

# Strategy: replace wireSeg(expr1, expr2, YEXPR, lines with
# wireSeg(expr1, expr2, resolveSegY(expr1, expr2, YEXPR), lines
# Only in the main render function (after line 1046)

# Split at the export function
split_marker = 'export function renderSLDProfessional'
idx = content.find(split_marker)
if idx == -1:
    print("ERROR: Could not find renderSLDProfessional")
    exit(1)

before = content[:idx]
after = content[idx:]

# Replace wireSeg calls with resolveSegY-wrapped Y
# Match: parts.push(wireSeg(X1, X2, Y, lines
# We'll do targeted replacements for each known pattern

replacements = [
    # PV → JBox (open air)
    ('wireSeg(pvOutX, jbCX-jbW/2, BUS_Y, lines',
     'wireSeg(pvOutX, jbCX-jbW/2, resolveSegY(pvOutX, jbCX-jbW/2, BUS_Y), lines'),
    # JBox → Combiner (micro)
    ('wireSeg(jbCX+jbW/2, cr.lx, BUS_Y, lines',
     'wireSeg(jbCX+jbW/2, cr.lx, resolveSegY(jbCX+jbW/2, cr.lx, BUS_Y), lines'),
    # JBox → DC Disco (string)
    ('wireSeg(jbCX+jbW/2, dcX-dW/2, BUS_Y, lines',
     'wireSeg(jbCX+jbW/2, dcX-dW/2, resolveSegY(jbCX+jbW/2, dcX-dW/2, BUS_Y), lines'),
    # DC Disco → Inverter (terminal Y)
    ('wireSeg(node3RX, invBox.dcInX, segY, lines',
     'wireSeg(node3RX, invBox.dcInX, resolveSegY(node3RX, invBox.dcInX, segY), lines'),
    # Combiner/Inverter → AC Disco (terminal Y)
    ('wireSeg(invRX, discoResult.loadInX, segY, lines',
     'wireSeg(invRX, discoResult.loadInX, resolveSegY(invRX, discoResult.loadInX, segY), lines'),
    # AC Disco → MSP (terminal Y)
    ('wireSeg(discoResult.lineOutX, mspResult.bkfdInX, segY, lines',
     'wireSeg(discoResult.lineOutX, mspResult.bkfdInX, resolveSegY(discoResult.lineOutX, mspResult.bkfdInX, segY), lines'),
    # MSP → Utility (terminal Y)
    ('wireSeg(buiRX, utilCX-mR-10, segY, lines',
     'wireSeg(buiRX, utilCX-mR-10, resolveSegY(buiRX, utilCX-mR-10, segY), lines'),
]

count = 0
for old, new in replacements:
    if old in after:
        after = after.replace(old, new)
        count += 1
        print(f"  Replaced: {old[:60]}...")
    else:
        print(f"  NOT FOUND: {old[:60]}...")

content = before + after

with open('lib/sld-professional-renderer.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"\nDone: {count}/{len(replacements)} replacements applied")