with open('app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Remove duplicate import line
seen_resolver = False
new_lines = []
for line in lines:
    if "from '@/lib/systemEquipmentResolver'" in line:
        if not seen_resolver:
            seen_resolver = True
            new_lines.append(line)
        else:
            print(f"Removed duplicate: {line.rstrip()}")
    else:
        new_lines.append(line)

with open('app/proposals/page.tsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("✅ Duplicate import removed")