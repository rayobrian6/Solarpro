with open('lib/mounting-hardware-db.ts', 'r') as f:
    content = f.read()

# Fix the unescaped apostrophe in "World's"
old = "description: 'World's most deployed single-axis tracker"
new = "description: &quot;World's most deployed single-axis tracker"

# Also need to fix the closing quote
old2 = "description: &quot;World's most deployed single-axis tracker \u2014 independent row design, self-powered, AI-optimized',"
new2 = "description: &quot;World's most deployed single-axis tracker \u2014 independent row design, self-powered, AI-optimized&quot;,"

if old in content:
    content = content.replace(old, new)
    print(f"Fixed opening quote")
    # Now fix the closing quote on the same line
    content = content.replace(
        "description: &quot;World's most deployed single-axis tracker \u2014 independent row design, self-powered, AI-optimized',",
        "description: &quot;World's most deployed single-axis tracker \u2014 independent row design, self-powered, AI-optimized&quot;,"
    )
    print(f"Fixed closing quote")
else:
    print(f"Pattern not found, trying alternate...")
    # Try to find and fix any line with World's
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if "World" in line and "description" in line:
            print(f"Line {i+1}: {repr(line)}")
            # Replace with double-quoted version
            lines[i] = '    description: "World\'s most deployed single-axis tracker \u2014 independent row design, self-powered, AI-optimized",'
            print(f"Fixed to: {repr(lines[i])}")
    content = '\n'.join(lines)

with open('lib/mounting-hardware-db.ts', 'w') as f:
    f.write(content)

# Verify
import subprocess
result = subprocess.run(['grep', '-n', 'World', 'lib/mounting-hardware-db.ts'], capture_output=True, text=True)
print(f"After fix: {result.stdout}")