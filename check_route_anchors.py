#!/usr/bin/env python3
with open('app/api/engineering/sld/route.ts', 'r', encoding='utf-8') as f:
    src = f.read()

a1 = "    let computedRuns: ReturnType<typeof computeSystem>['runs'] | undefined;\n    try {\n      const csInput: ComputedSystemInput = {"
a2 = "        maxACVoltageDropPct:           Number(body.maxACVoltageDropPct ?? 2),\n        maxDCVoltageDropPct:           Number(body.maxDCVoltageDropPct ?? 3),\n      };"
a3 = "import {\n  generateStringConfig,\n  moduleSpecsFromRegistry,\n  inverterSpecsFromRegistry,\n} from '@/lib/string-generator';"

print(f"a1 found: {a1 in src}")
print(f"a2 found: {a2 in src}")
print(f"a3 found: {a3 in src}")

# Show exact text around line 115
lines = src.split('\n')
for i in range(113, 120):
    print(f"  L{i+1}: {repr(lines[i])}")

# Show exact text around line 159-163
for i in range(158, 165):
    print(f"  L{i+1}: {repr(lines[i])}")