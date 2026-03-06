#!/usr/bin/env python3
"""
Fix battery wire label and backup panel wire label in renderer.
Replace hardcoded gauges with computed conductorCallout from run segments.
"""

with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Loaded: {len(lines)} lines")

# ─── Fix 1: Battery wire label (around line 1281) ─────────────────────────────
bat_wire_start = None
bat_wire_end = None
for i, line in enumerate(lines):
    if "bfA <= 20 ? '#12 AWG THWN-2'" in line:
        bat_wire_start = i
    if bat_wire_start is not None and i > bat_wire_start:
        if '{sz: F.tiny, anc:' in line and 'fill:' in line and '#1565C0' in line:
            bat_wire_end = i
            break

if bat_wire_start is None or bat_wire_end is None:
    print(f"ERROR: battery wire block not found (start={bat_wire_start}, end={bat_wire_end})")
else:
    print(f"Battery wire block: lines {bat_wire_start+1} to {bat_wire_end+1}")
    for i in range(bat_wire_start, bat_wire_end+1):
        print(f"  L{i+1}: {repr(lines[i][:100])}")

    new_bat_block = """    // BUILD v24: Use computed conductorCallout from BATTERY_TO_BUI_RUN (NEC-sized)
    // Fallback to legacy hardcoded gauge only if segment not computed
    const batWireGauge = batToBuiRun?.wireGauge
      ? `${batToBuiRun.wireGauge} THWN-2`
      : (bfA <= 20 ? '#12 AWG THWN-2' : bfA <= 30 ? '#10 AWG THWN-2' : '#8 AWG THWN-2');
    const batCalloutLines = batToBuiRun?.conductorCallout
      ? batToBuiRun.conductorCallout.split('\\n').filter((l:string)=>l.trim()).slice(0,2)
      : [batWireGauge, `${bfA}A CIRCUIT`];
    parts.push(tspan(batCX + 8, batCY + (buiResult.batPortY - batResult.by)/2,
      batCalloutLines,
      {sz: F.tiny, anc: 'start', fill: '#1565C0'}));
"""
    lines = lines[:bat_wire_start] + [new_bat_block] + lines[bat_wire_end+1:]
    print(f"OK 1: Battery wire label replaced")

# ─── Fix 2: Backup panel wire label ───────────────────────────────────────────
# Re-scan after modification
bp_wire_line = None
for i, line in enumerate(lines):
    if "'#6 AWG THWN-2', 'CRITICAL LOADS'" in line:
        bp_wire_line = i
        break

if bp_wire_line is None:
    print("ERROR: backup panel wire label not found")
else:
    print(f"Backup panel wire: line {bp_wire_line+1}: {repr(lines[bp_wire_line][:100])}")
    new_bp_line = """      // BUILD v24: Use computed BUI_TO_MSP_RUN conductorCallout for backup panel feeder
      const bpCalloutLines = buiToMspRun?.conductorCallout
        ? buiToMspRun.conductorCallout.split('\\n').filter((l:string)=>l.trim()).slice(0,2)
        : ['#6 AWG THWN-2', 'CRITICAL LOADS'];
      parts.push(tspan(bpCX - 40 + 6, bpCY - 10, bpCalloutLines, {sz: F.tiny, anc: 'start', fill: '#6A1B9A'}));
"""
    lines = lines[:bp_wire_line] + [new_bp_line] + lines[bp_wire_line+1:]
    print(f"OK 2: Backup panel wire label replaced")

# ─── Fix 3: Also fix the #6 AWG check in verify (it's a min-start hint in computed-system.ts) ──
# The verify check was: cs.count("'#6 AWG'") <= 2
# Let's check what's in computed-system.ts
with open('lib/computed-system.ts', 'r', encoding='utf-8') as f:
    cs = f.read()
count_6awg = cs.count("'#6 AWG'")
print(f"\ncomputed-system.ts '#6 AWG' count: {count_6awg}")
# These are min-start hints in autoSizeWire calls — acceptable (they're lower bounds, not hardcoded outputs)

with open('lib/sld-professional-renderer.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f"\nALL DONE — sld-professional-renderer.ts: {len(lines)} lines")