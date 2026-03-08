#!/usr/bin/env python3
"""Fix the extra ) in engineering page from SLD gate patch"""

with open('/workspace/app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# The bad pattern: )}) followed by equipment schedule tab
# Should be: )} followed by equipment schedule tab
BAD = """            </div>
          )})

          {/* \u2500\u2500 EQUIPMENT SCHEDULE TAB \u2500\u2500 */}"""

GOOD = """            </div>
          )}

          {/* \u2500\u2500 EQUIPMENT SCHEDULE TAB \u2500\u2500 */}"""

if BAD in content:
    content = content.replace(BAD, GOOD, 1)
    print("✅ Fixed extra ) in SLD gate")
else:
    # Try to find it differently
    idx = content.find(')})\\n\\n          {/* \u2500\u2500 EQUIPMENT SCHEDULE TAB')
    if idx < 0:
        idx = content.find(')})') 
        if idx >= 0:
            print(f"Found )}) at char {idx}")
            print(f"Context: {repr(content[idx-100:idx+100])}")
        else:
            print("❌ Pattern not found")

with open('/workspace/app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ File written")