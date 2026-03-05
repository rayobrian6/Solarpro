#!/usr/bin/env python3
"""Fix direct cost.annualSavings / cost.paybackYears / cost.lifetimeSavings references
   to use the computed variables instead."""

FILE = 'app/proposals/page.tsx'

with open(FILE, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace direct cost.X references with computed variables
replacements = [
    ('cost.annualSavings.toLocaleString()',  'annualSavings.toLocaleString()'),
    ('cost.paybackYears',                    'paybackYears'),
    ('cost.lifetimeSavings.toLocaleString()', 'lifetimeSavings.toLocaleString()'),
]

for old, new in replacements:
    count = content.count(old)
    content = content.replace(old, new)
    print(f"Replaced {count}x: '{old}' -> '{new}'")

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")