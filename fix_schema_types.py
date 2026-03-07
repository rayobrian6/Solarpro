#!/usr/bin/env python3
"""Fix incorrect systemType and attachmentMethod values in mounting-hardware-db.ts"""

with open('lib/mounting-hardware-db.ts', 'r') as f:
    content = f.read()

replacements = [
    # Fix systemType values
    ("systemType: 'ballasted',", "systemType: 'ballasted_flat',"),
    ("systemType: 'ground_fixed_tilt',", "systemType: 'ground_driven_pile',"),
    ("systemType: 'single_axis_tracker',", "systemType: 'tracker_single_axis',"),
    # Fix attachmentMethod values
    ("attachmentMethod: 'screw_pile',", "attachmentMethod: 'helical_pile',"),
    ("attachmentMethod: 'lag_bolt',", "attachmentMethod: 'l_foot_lag',"),
]

for old, new in replacements:
    count = content.count(old)
    content = content.replace(old, new)
    print(f"Replaced {count}x: {old!r} -> {new!r}")

with open('lib/mounting-hardware-db.ts', 'w') as f:
    f.write(content)

print("\n✅ Schema types fixed")

# Verify no bad values remain
bad_values = ['ballasted,', 'ground_fixed_tilt', 'single_axis_tracker', 'screw_pile', 'lag_bolt']
for b in bad_values:
    count = content.count(b)
    status = "⚠️  WARNING" if count > 0 else "✅ OK"
    print(f"{status}: '{b}' appears {count} times")