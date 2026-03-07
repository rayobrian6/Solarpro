with open('lib/mounting-hardware-db.ts', 'r') as f:
    content = f.read()

# Fix the HTML entities that got introduced
content = content.replace(
    '    description: &quot;World\'s most deployed single-axis tracker \u2014 independent row design, self-powered, AI-optimized&quot;,',
    '    description: "World\'s most deployed single-axis tracker \u2014 independent row design, self-powered, AI-optimized",'
)

with open('lib/mounting-hardware-db.ts', 'w') as f:
    f.write(content)

# Verify
with open('lib/mounting-hardware-db.ts', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'World' in line or 'quot' in line:
        print(f"Line {i+1}: {repr(line.rstrip())}")