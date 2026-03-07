#!/usr/bin/env python3
"""Make buildConductorCallout produce more concise labels."""

with open('lib/segment-schedule.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find and replace the function content
output = []
in_function = False
function_start = 321  # 0-indexed: line 322 is the start
i = 0

while i < len(lines):
    line = lines[i]
    
    # Check if this is the start of buildConductorCallout
    if i == function_start and 'export function buildConductorCallout' in line:
        # Skip old function and write new one
        output.append(line)  # function signature
        # Skip old body (lines 322-336 inclusive)
        i += 1
        # Output new concise function body
        new_body = """  // Build concise conductor description: e.g., "2×#6 THWN-2"
  const hotCount = bundle.filter(c => c.isCurrentCarrying && c.color !== 'GRN').reduce((s, c) => s + c.qty, 0);
  const primaryGauge = bundle.find(c => c.isCurrentCarrying && c.color !== 'GRN')?.gauge ?? '#10 AWG';
  const gaugeNum = primaryGauge.replace('#', '').replace(' AWG', '');
  const insulation = bundle[0]?.insulation ?? 'THWN-2';
  const conductorDesc = `${hotCount}×#${gaugeNum} ${insulation}`;
  
  if (isOpenAir) {
    return `${conductorDesc} (OPEN AIR)`;
  }
  const conduitAbbrev = conduitType === 'EMT' ? 'EMT'
    : conduitType === 'PVC Sch 40' ? 'PVC'
    : conduitType === 'PVC Sch 80' ? 'PVC'
    : conduitType;
  return `${conductorDesc} · ${conduitSize} ${conduitAbbrev}`;
}
"""
        output.append(new_body)
        # Skip the rest of old function (15 lines total: 322-336)
        i += 15
        continue
    
    output.append(line)
    i += 1

with open('lib/segment-schedule.ts', 'w', encoding='utf-8') as f:
    f.writelines(output)

print("SUCCESS: buildConductorCallout updated to produce concise labels")