#!/usr/bin/env python3
"""Add phase and conductorMaterial fields to all segment objects in segment-builder.ts."""

with open('lib/segment-builder.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Each segment push ends with conductorCallout: buildConductorCallout(...),
# We need to add phase and conductorMaterial after conductorCallout line
# Strategy: find each "conductorCallout: buildConductorCallout" and add the fields after

import re

# Pattern: conductorCallout: buildConductorCallout(...),\n    });
# Replace with: conductorCallout: buildConductorCallout(...),\n      phase: '1Ø',\n      conductorMaterial: 'CU',\n    });

# Find all occurrences of conductorCallout followed by });
# The closing }); can be at different indentation levels

old_pattern = "conductorCallout: buildConductorCallout("
count = 0

lines = content.split('\n')
new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    new_lines.append(line)
    
    # Check if this line contains conductorCallout: buildConductorCallout(
    if 'conductorCallout: buildConductorCallout(' in line:
        # Get the indentation of this line
        indent = len(line) - len(line.lstrip())
        indent_str = ' ' * indent
        
        # Check if the next non-empty line is });
        j = i + 1
        while j < len(lines) and lines[j].strip() == '':
            new_lines.append(lines[j])
            j += 1
        
        # Check if next line is }); or });
        if j < len(lines) and lines[j].strip() in ['});', '});']:
            # Insert phase and conductorMaterial before the closing });
            new_lines.append(f"{indent_str}phase: '1\u00d8',")
            new_lines.append(f"{indent_str}conductorMaterial: 'CU',")
            count += 1
            print(f"  Added fields after line {i+1}: {line.strip()[:60]}")
    
    i += 1

content = '\n'.join(new_lines)

with open('lib/segment-builder.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"\nDone: Added phase/conductorMaterial to {count} segments")