#!/usr/bin/env python3
"""
v47.417 — Apply integratedDcDisconnect: true to each string inverter in
equipment-db.ts. All 25 models in the STRING_INVERTERS array ship with
factory-integrated DC disconnect switches per their datasheets.

Strategy: insert `integratedDcDisconnect: true,` immediately BEFORE the
`datasheetUrl:` line for each inverter. This keeps the edit precise and
lossless (no risk of hitting the wrong entry).
"""
import re
import sys

PATH = 'lib/equipment-db.ts'

# All 25 string inverter IDs
IDS = [
    'se-7600h', 'se-10000h', 'se-3800h', 'se-6000h', 'se-11400h',
    'fronius-primo-7.6', 'fronius-primo-5.0', 'fronius-primo-8.2', 'fronius-primo-10.0',
    'sma-sb-7.7', 'sma-sb-5.0', 'sma-sb-10.0',
    'sungrow-sg10rs', 'sungrow-sg5rs', 'sungrow-sg7.6rs', 'sungrow-sg15rs',
    'goodwe-gw5000-ns', 'goodwe-gw10k-ms',
    'ecoflow-power-ocean-5kw', 'ecoflow-power-ocean-10kw', 'ecoflow-power-ocean-20kw',
    'solark-8k-2p', 'solark-12k-2p', 'solark-15k-2p', 'solark-30k-3p-208v',
]

with open(PATH, 'r') as f:
    src = f.read()

edits = 0
out_lines = []
# Find each inverter object by its id, then insert the flag before the first
# `datasheetUrl:` or `rapidShutdownCompliant:` line after the id.
# Use regex to find blocks starting with `id: '<matching>'`.

for inv_id in IDS:
    # Find the block starting at `id: '<inv_id>'`. Take all lines up to the
    # next `},` (end of object). Insert the flag before `datasheetUrl:` if
    # not already present.
    pattern = re.compile(
        r"(\n    id: '" + re.escape(inv_id) + r"',.*?)(    datasheetUrl:)",
        re.DOTALL,
    )
    match = pattern.search(src)
    if not match:
        print(f"WARN: could not locate block for id='{inv_id}' in {PATH}", file=sys.stderr)
        continue
    block = match.group(1)
    if 'integratedDcDisconnect' in block:
        print(f"SKIP: {inv_id} already tagged")
        continue
    # Replace: insert integratedDcDisconnect: true line before datasheetUrl
    new_block = block + "    // v47.417 — Factory-integrated DC disconnect per datasheet\n    integratedDcDisconnect: true,\n"
    src = src[: match.start(1)] + new_block + match.group(2) + src[match.end():]
    edits += 1
    print(f"OK: tagged {inv_id}")

with open(PATH, 'w') as f:
    f.write(src)

print(f"\n{edits}/{len(IDS)} inverters tagged.")