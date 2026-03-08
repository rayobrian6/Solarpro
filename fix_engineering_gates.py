with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

fixed = 0
for i, line in enumerate(lines):
    # Line numbers are 1-based, so line 6168 is index 6167, line 6570 is index 6569
    if i in (6167, 6569):
        stripped = line.strip()
        if stripped == ')})':
            old = line
            lines[i] = line.replace(')})','  ))}' if line.startswith('          ') else '))}')
            # Preserve exact indentation
            indent = len(line) - len(line.lstrip())
            lines[i] = ' ' * indent + '))}\n'
            print(f"Fixed line {i+1}: {repr(old.rstrip())} -> {repr(lines[i].rstrip())}")
            fixed += 1
        else:
            print(f"Line {i+1} content: {repr(stripped)} (not ')}})')")

print(f"Total fixed: {fixed}")

with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Done.")