with open('lib/mounting-hardware-db.ts', 'r') as f:
    content = f.read()

replacements = [
    ("'concrete_tile'", "'tile_concrete'"),
    ("'clay_tile'",     "'tile_clay'"),
]

for old, new in replacements:
    count = content.count(old)
    content = content.replace(old, new)
    print(f"Replaced {count}x: {old} -> {new}")

with open('lib/mounting-hardware-db.ts', 'w') as f:
    f.write(content)

print("✅ RoofType values fixed")

# Verify no bad values remain
bad = ["'concrete_tile'", "'clay_tile'"]
for b in bad:
    count = content.count(b)
    print(f"{'⚠️ ' if count else '✅'} '{b}': {count} occurrences")