#!/usr/bin/env python3
with open('lib/computed-system.ts', 'r', encoding='utf-8') as f:
    src = f.read()
print(f'File size: {len(src)} chars')

checks = [
    ('RunSegmentId union', "export type RunSegmentId ="),
    ('ARRAY_CONDUIT_RUN in union', "ARRAY_CONDUIT_RUN"),
    ('BATTERY_TO_BUI already patched?', 'BATTERY_TO_BUI_RUN'),
    ('ComputedSystemInput batteryIds', "batteryIds?: string[];"),
    ('defaultRunLengths block', 'const defaultRunLengths: Record<RunSegmentId, number> = {'),
    ('ARRAY_CONDUIT_RUN in defaults', 'ARRAY_CONDUIT_RUN: rl.ARRAY_CONDUIT_RUN'),
    ('120% battery impact', 'Sum battery backfeed breaker contributions'),
    ('Validate conduit fill anchor', 'Validate conduit fill on all runs'),
    ('makeRunSegment function', 'function makeRunSegment'),
    ('conductorMaterial in file', 'conductorMaterial'),
    ('autoSizeWire function', 'function autoSizeWire'),
    ('getSmallestConduit function', 'function getSmallestConduit'),
    ('getEGCGauge function', 'function getEGCGauge'),
    ('nextStandardOCPD function', 'function nextStandardOCPD'),
    ('CONDUCTOR_AREA_IN2', 'CONDUCTOR_AREA_IN2'),
]
for name, anchor in checks:
    found = anchor in src
    print(f'  [{"OK" if found else "MISSING"}] {name}')

# Show the exact text around the RunSegmentId union
idx = src.find("export type RunSegmentId =")
if idx >= 0:
    print("\n--- RunSegmentId union (first 400 chars) ---")
    print(repr(src[idx:idx+400]))

# Show the exact text around batteryIds
idx2 = src.find("batteryIds?: string[];")
if idx2 >= 0:
    print("\n--- batteryIds context (50 chars before, 200 after) ---")
    print(repr(src[idx2-50:idx2+200]))

# Show defaultRunLengths end
idx3 = src.find('const defaultRunLengths: Record<RunSegmentId, number> = {')
if idx3 >= 0:
    print("\n--- defaultRunLengths block (first 600 chars) ---")
    print(repr(src[idx3:idx3+600]))