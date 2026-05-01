#!/usr/bin/env python3
"""
Move the Battery Card from the left column to the right column.

Battery card block: lines 6129-6287 (0-indexed 6128-6286) — 159 lines
Insert point: line 7005 (0-indexed 7004) — before {/* ── System Configuration ── */}

After removal of 159 lines and addition of 1 blank line, net delta = -158 lines.
So insert_point shifts to: 7004 - 158 = 6846 (0-indexed)
"""

with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")

# ── Step 1: Verify landmarks ──────────────────────────────────────────────
assert 'Battery Card' in lines[6128] and 'Toggleable' in lines[6128], f"Expected Battery Card at 6129, got: {lines[6128][:60]}"
assert '</div>' in lines[6286], f"Expected </div> at 6287, got: {lines[6286][:60]}"
assert 'System Configuration' in lines[7004], f"Expected System Config at 7005, got: {lines[7004][:60]}"

print("✅ All landmarks verified")
print(f"  Battery start: {repr(lines[6128][:70])}")
print(f"  Battery end:   {repr(lines[6286][:70])}")
print(f"  Insert point:  {repr(lines[7004][:70])}")

# ── Step 2: Extract battery block (6129–6287, i.e. 0-idx 6128–6286 inclusive) ──
bat_block = lines[6128:6287]  # 159 lines
print(f"  Extracted {len(bat_block)} lines")

# ── Step 3: Remove battery block from left col ────────────────────────────
# Replace it with a single blank line to keep spacing
new_lines = lines[:6128] + ['\n'] + lines[6287:]

# Update left column comment
for i, line in enumerate(new_lines):
    if 'LEFT COLUMN: Project Info + Electrical + Battery + Generator' in line:
        new_lines[i] = line.replace(
            'LEFT COLUMN: Project Info + Electrical + Battery + Generator',
            'LEFT COLUMN: Project Info + Electrical'
        )
        print(f"  Updated left col comment at new line {i+1}")
        break

print(f"  After removal: {len(new_lines)} lines (was {len(lines)})")

# ── Step 4: Find shifted insert point ────────────────────────────────────
# Removed 159 lines, added 1 blank = net -158 lines
# Original insert_point 7004 (0-indexed) → 7004 - 158 = 6846
new_insert = 7004 - 158
print(f"  Shifted insert point: line {new_insert+1} → {repr(new_lines[new_insert][:70])}")

# Verify it's still the System Config comment
assert 'System Configuration' in new_lines[new_insert], \
    f"Shifted insert point doesn't have System Configuration: {new_lines[new_insert][:60]}"
print("✅ Shifted insert point verified")

# ── Step 5: Insert battery block before System Configuration ──────────────
new_lines = new_lines[:new_insert] + bat_block + ['\n'] + new_lines[new_insert:]

print(f"  After insertion: {len(new_lines)} lines")

# ── Step 6: Write back ─────────────────────────────────────────────────────
with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("\n✅ File written successfully")

# ── Step 7: Final verification ────────────────────────────────────────────
with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    verify = f.readlines()

bat_positions  = [i+1 for i,l in enumerate(verify) if 'Battery Card' in l and 'Toggleable' in l]
sys_config_pos = [i+1 for i,l in enumerate(verify) if 'System Configuration' in l and i > 6800 and '{/*' in l]
left_col_end   = [i+1 for i,l in enumerate(verify) if 'end left col' in l]
right_col_start= [i+1 for i,l in enumerate(verify) if 'RIGHT COLUMN' in l]

print(f"\nVerification:")
print(f"  Battery Card at:        {bat_positions}")
print(f"  System Config comment:  {sys_config_pos}")
print(f"  Left col end:           {left_col_end}")
print(f"  Right col start:        {right_col_start}")

if bat_positions and left_col_end and bat_positions[0] > left_col_end[0]:
    print("✅ Battery card is OUTSIDE left col (good)")
elif bat_positions and right_col_start and bat_positions[0] > right_col_start[0]:
    print("✅ Battery card is in right col area")
if bat_positions and sys_config_pos and bat_positions[0] < sys_config_pos[0]:
    print("✅ Battery card is BEFORE System Config (good)")

print(f"\nTotal lines: {len(verify)} (was {len(lines)})")